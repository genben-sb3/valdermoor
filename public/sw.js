/* Valdermoor Service Worker — Offline-Cache für die App-Shell.
 * Strategie:
 *   - Statische Assets (HTML, JS, CSS, Fonts, Bilder): cache-first
 *   - API-Calls (Groq, Pollinations, EmailJS): network-only (nie cachen)
 *   - Navigation: network-first mit Offline-Fallback auf cached index.html
 *
 * CACHE_VERSION wird beim Build automatisch durch package.json-Version
 * ersetzt (siehe vite.config.ts -> swVersionPlugin). Jedes Release bumpt
 * den Cache, alte Caches werden im activate-Event gelöscht.
 */

const CACHE_VERSION = '__SW_VERSION__'; // wird beim Build ersetzt
const CACHE_NAME = `valdermoor-${CACHE_VERSION}`;

// Mindest-Assets die beim Install gecached werden (App-Shell).
// Vite-Hash-Filenames werden zur Laufzeit eingefangen (siehe fetch-Handler).
const APP_SHELL = [
  '/',
  '/index.html',
  '/install.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
];

// Hosts die NIEMALS gecached werden (immer live abrufen)
const NEVER_CACHE_HOSTS = [
  'api.groq.com',
  'text.pollinations.ai',
  'image.pollinations.ai',
  'api.emailjs.com',
  'api.elevenlabs.io',
  'api.github.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => { /* einzelne 404s ignorieren */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('valdermoor-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // Nach Cache-Wechsel: alle offenen Tabs per postMessage informieren,
      // damit die App eine "Neue Version geladen"-Meldung anzeigen kann.
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) {
        client.postMessage({ type: 'sw-updated', version: CACHE_VERSION });
      }
    })(),
  );
});

// Erlaubt der App, sofortiges Aktivieren zu triggern (z.B. nach Bestätigung
// "Neu laden" in der UI).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Niemals API-Calls cachen (Cloud-DM braucht Live-Daten)
  if (NEVER_CACHE_HOSTS.some((host) => url.hostname.includes(host))) {
    return; // Default-Network-Verhalten
  }

  // Navigation: Network-First mit Offline-Fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Erfolgreichen HTML-Response in den Cache
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { /* */ });
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Same-Origin-Assets + cross-origin Static (Fonts, Pollinations-Bilder einmal-cached): cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Nur erfolgreiche, vollständige Responses cachen (kein opaque/206)
        if (res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { /* */ });
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
