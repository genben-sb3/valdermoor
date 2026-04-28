# Valdermoor — Setup-Anleitung

Alles was du selbst machen musst, damit das Spiel komplett läuft.
Reihenfolge: 1 → 2 → (3) → (4) → (5). Schritte 3, 4 und 5 sind optional.

> **Kurzfassung:** Mit Schritt 1 + 2 läufst du im **Cloud-Modus** (DM via
> Pollinations.ai, kostenlos, kein Account). Schritt 3 ist nur nötig, wenn
> du den DM **lokal** (offline, ohne Internet) laufen lassen willst.

---

## 1. Erste Schritte (immer nötig)

```bash
cd "C:\Users\angel\OneDrive\Desktop\Game"
npm install
```

Wenn `node_modules` schon existiert, überspring `npm install`.

---

## 2. App starten

```bash
npm run dev
```

Browser öffnet sich auf http://localhost:5173. Fertig.

Im Spielfenster steht oben rechts der DM-Status:

| Anzeige | Bedeutung |
|---------|-----------|
| `Cloud · Pollinations (openai)` | DM läuft via Internet — keine Installation nötig |
| `Lokal · <modellname>` | LM Studio ist erkannt und wird genutzt (siehe Schritt 3) |
| `DM offline` | Weder LM Studio noch Internet erreichbar |

**Cloud-Modus reicht für Schule, Demo, Hausaufgaben.** Du brauchst nichts
zusätzlich zu installieren — die App spricht direkt mit
`text.pollinations.ai`, das ist gratis und ohne Account.

---

## 3. (Optional) LM Studio für lokalen, offlinefähigen DM

Vorteile: läuft offline, schnellere Antworten, deine Daten bleiben lokal.
Nachteil: einmalige Installation + RAM-hungrig.

1. **LM Studio runterladen** → https://lmstudio.ai/
2. **Modell laden** (dein 4-GB-RAM-Laptop schafft):
   - **SmolLM2 360M Instruct Q4** → sicher, sehr schnell, einfacher Stil
   - **Phi-3.5 Mini Q4** → bessere Geschichten, knapp aber machbar
   - In LM Studio: **Discover-Tab** → Suchen → Download
3. **Modell aktivieren**: Tab **Chat** → Modell oben auswählen
4. **Server starten**: Tab **Local Server** (oder **Developer**) → **Start Server**
   - Port muss **1234** sein (Standard)
   - Status muss "Running" sein

> **Schnelltest:** im Browser http://localhost:1234/v1/models öffnen.
> Wenn JSON erscheint → Server läuft.

> **Auto-Start:** Wenn LM Studio nicht läuft, versucht Vite ihn beim
> `npm run dev` automatisch zu starten — entweder via `lms server start`
> (LM-Studio-CLI, falls installiert) oder über `C:\llama\start-server.bat`.
> Klappt's nicht innerhalb ~10s, schaltet die App automatisch auf Cloud um.

> **Reiner Cloud-Modus erzwingen** (überspringt den LM-Auto-Start, schnellerer
> `npm run dev`):
> ```bash
> SKIP_LM_AUTOSTART=1 npm run dev
> ```

### Welches lokale Modell?

Im `C:\llama\` Ordner liegen zwei Bat-Dateien — wähle nach Bedarf:

| Datei | Modell | Größe | Geschwindigkeit | Qualität |
|-------|--------|-------|----------------|----------|
| `start-server.bat` | Qwen 2.5 0.5B Q8_0 | 670 MB | ⚡ ~9 tok/s | 😬 sehr basic, papagei't oft |
| `start-server-phi.bat` | Phi-3.5 Mini IQ2_M | 1.2 GB | 🐢 ~1-2 tok/s | ✨ deutlich besser, kohärenter |

**Empfehlung:** Phi-3.5 für besseres Storytelling, Qwen wenn Antworten schnell kommen sollen.
Vor Wechsel: aktiven Server (schwarzes Fenster) schließen, dann andere Bat-Datei doppelklicken.

### Welches Cloud-Modell?

Pollinations bietet mehrere Modelle. Standard ist `openai`. Du kannst per
`.env` umschalten:

```
VITE_CLOUD_MODEL=openai-large
```

Verfügbare Modelle (Stand 2026-04):

| Wert | Beschreibung | Geschwindigkeit | Qualität |
|------|--------------|-----------------|----------|
| `openai` | gpt-4o-mini-Klasse, gut für Storytelling | ⚡ schnell | ✨ sehr gut |
| `openai-large` | gpt-4o-Klasse, beste Qualität | 🐢 langsamer | 🌟 hervorragend |
| `mistral` | Mistral-Variante, anderer Stil | ⚡ schnell | ✨ gut |
| `llama` | Llama-Variante | mittel | gut |

Hinweise zur Bedienung:
- **Erste Nutzung:** Registrieren → Code aus Modal eintragen → Helden anlegen → Spielen.
- **Wiederkommen:** Spielstand wird automatisch geladen.
- **Neue Geschichte:** "🆕 Neue Runde" oben rechts.

---

## 3.5. (Optional) Groq als schnellerer Cloud-DM

Groq ist eine kostenlose API mit Llama-3.3-70B und ähnlichen Top-Modellen — **deutlich besser und schneller als Pollinations**, aber benötigt einen API-Key (kostenlos, ohne Kreditkarte).

### Setup
1. https://console.groq.com → **Sign in with Google** (mit 278487459+genben-sb3@users.noreply.github.com)
2. Linker Menüpunkt **API Keys** → **Create API Key**
3. Name z.B. "valdermoor", **Submit** → den Key sofort kopieren (wird nur einmal gezeigt!)
4. Im Projekt: `.env`-Datei öffnen (oder `.env.example` kopieren falls noch nicht da)
5. Eintragen:
   ```
   VITE_GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. `npm run dev` neu starten

**Erkennung:** Status oben rechts zeigt jetzt `Cloud · Groq (llama-3.3-70b-versatile)` statt Pollinations.

### Andere Modelle
Setze `VITE_GROQ_MODEL=` in der `.env` zu einem der:
- `llama-3.3-70b-versatile` (Default — beste Qualität)
- `llama-3.1-8b-instant` (schneller, simpler)
- `mixtral-8x7b-32768` (großer Kontext)

Komplette Liste: https://console.groq.com/docs/models

### Hinweise zum Public-Deploy mit Groq
- Der Key wird im JS-Bundle ausgeliefert (Frontend-only). Für Schul-Demo völlig okay — Groq Free-Tier hat Rate-Limits, die Missbrauch verhindern.
- Wenn du den Key vor anderen verstecken willst: Backend-Proxy (Vercel Edge Function o.ä.) — kompliziertere Lösung, frag wenn du das willst.

---

## 4. (Optional) Echte E-Mail-Codes via EmailJS

Per default zeigt die App den Bestätigungscode direkt im Modal an (Demo-Modus, völlig okay für ein Schulprojekt).
Wenn du ECHTE Mails verschicken willst:

### 4.1 EmailJS-Konto anlegen
1. https://www.emailjs.com/ → **Sign Up** (kostenlos, 200 Mails/Monat)
2. Dashboard → **Email Services** → **Add New Service**
   - Wähl **Gmail** (oder dein Anbieter)
   - Verbinde dein Konto → **Service ID** notieren (z.B. `service_abc123`)

### 4.2 Template anlegen
3. Dashboard → **Email Templates** → **Create New Template**
4. Im Template diese Variablen verwenden:
   - **To Email:** `{{to_email}}`
   - **Subject:** `Dein Valdermoor-Code`
   - **Body** (Beispiel):
     ```
     Hallo,

     dein Bestätigungscode für {{app_name}} lautet:

     {{code}}

     Gültig {{expiry_minutes}} Minuten.
     ```
5. Speichern → **Template ID** notieren (z.B. `template_xyz789`)

### 4.3 Public Key holen
6. Dashboard → **Account** → **General** → **Public Key** kopieren
   (z.B. `AbCdEf123XyZ`)

### 4.4 In der App eintragen
7. Im Projektordner `.env.example` zu `.env` kopieren:
   ```bash
   cp .env.example .env
   ```
   (oder im Explorer manuell duplizieren und umbenennen)
8. `.env` öffnen, Werte einsetzen:
   ```
   VITE_EMAILJS_SERVICE_ID=service_abc123
   VITE_EMAILJS_TEMPLATE_ID=template_xyz789
   VITE_EMAILJS_PUBLIC_KEY=AbCdEf123XyZ
   ```
9. `npm run dev` neu starten — fertig.

> Wenn EmailJS-Versand fehlschlägt (z.B. offline), fällt die App automatisch
> auf den Demo-Modus zurück und zeigt den Code im Modal an.

> **Wenn du die App publizierst:** im EmailJS-Dashboard → **Account →
> Security → Allowed Origins** muss deine Live-Domain (z.B.
> `https://valdermoor.vercel.app`) eingetragen sein, sonst lehnt EmailJS
> die Mails ab. Für Localhost ist `http://localhost:5173` zu erlauben.

---

## 5. (Optional) App online stellen — Vercel oder Netlify

Beide sind kostenlos, brauchen keine Kreditkarte und deployen Vite-Apps mit einem Klick. **Vercel** ist am einfachsten, **Netlify** ist gleichwertig.

### Variante A: Vercel (empfohlen)

1. Auf https://vercel.com → **Sign Up** mit GitHub-Account (genben-sb3)
2. Dashboard → **Add New… → Project**
3. Liste der GitHub-Repos erscheint → **valdermoor** auswählen → **Import**
4. Optionen lassen wie sie sind (Vite wird auto-erkannt durch `vercel.json`)
5. Falls du Groq nutzen willst: **Environment Variables** aufklappen → eintragen:
   - `VITE_GROQ_API_KEY` = dein Groq-Key
   - `VITE_GROQ_MODEL` = `llama-3.3-70b-versatile` (oder leer für Default)
   - `VITE_EMAILJS_*` falls eingerichtet
6. **Deploy** klicken → 30 Sekunden warten → fertig

Live-URL: `https://valdermoor.vercel.app` (oder ähnlich, Vercel zeigt sie an).

**Bei Code-Änderung**: einfach `git push` → Vercel deployed automatisch neu.

### Variante B: Netlify

1. Auf https://netlify.com → **Sign Up** mit GitHub
2. Dashboard → **Add new site → Import an existing project**
3. **GitHub** wählen → **valdermoor** Repo auswählen
4. Build-Settings werden aus `netlify.toml` gelesen — direkt **Deploy site**
5. Environment-Variablen (falls Groq/EmailJS): **Site settings → Environment variables**

### Wichtig nach dem Deploy

- **EmailJS-Domain whitelisten**: EmailJS-Dashboard → **Account → Security → Allowed Origins** → deine Live-Domain hinzufügen.
- **Groq-Key wechseln**: Wenn du den Key während Entwicklung in Chats/Logs geteilt hast, regeneriere ihn auf https://console.groq.com vor dem Public-Deploy.
- **App testen**: einmal die Live-URL öffnen, Account anlegen, kurze Runde spielen.

---

## 6. (Optional) GitHub-Remote für Push

Aktuell speicherst du nur lokal. Wenn du `git push` willst:

1. Auf https://github.com/new ein leeres Repo anlegen (z.B. `valdermoor`).
   **Wichtig:** keine README, kein .gitignore, kein License — komplett leer.
2. URL kopieren (z.B. `https://github.com/DeinName/valdermoor.git`)
3. In Bash:
   ```bash
   git remote add origin https://github.com/DeinName/valdermoor.git
   git push -u origin main
   ```
4. Einmalig fragt es nach Login. Token statt Passwort verwenden:
   GitHub → Settings → Developer settings → Personal access tokens.

---

## Schnell-Troubleshooting

| Problem | Lösung |
|---------|--------|
| Status zeigt "DM offline" | Internet checken (für Cloud) ODER LM Studio starten (für Lokal). Kein Internet & kein LM Studio = kein DM. |
| Cloud antwortet wirr / hängt | Pollinations hat manchmal Lastspitzen. Auf "Nochmal versuchen" klicken oder anderes Modell wählen (`VITE_CLOUD_MODEL=mistral` in `.env`). |
| Code im Modal kommt nicht im Postfach an | EmailJS nicht konfiguriert (= Demo-Modus). Code wird im Modal angezeigt. |
| Spielstand verloren nach F5 | Browser hat localStorage gelöscht (Inkognito? "Cookies löschen"?). |
| Phi-3.5 stürzt ab | Zu wenig RAM. Auf SmolLM2 360M wechseln, oder einfach Cloud nutzen. |
| Lokales Modell antwortet wirr / wiederholt sich | Modell zu klein. Auf Phi-3.5 oder direkt Cloud wechseln. |
| "Module not found" beim Start | `npm install` vergessen. |
| `npm run dev` hängt 10s am Anfang | Vite versucht LM Studio zu starten. Mit `SKIP_LM_AUTOSTART=1 npm run dev` überspringen. |

---

## Was du **NICHT** machen musst

- ❌ Backend / Server programmieren — alles läuft im Browser
- ❌ Datenbank einrichten — localStorage reicht
- ❌ API-Keys kaufen — Pollinations.ai ist gratis ohne Key, LM Studio ist lokal
- ❌ HTTPS / Domain — `localhost` reicht für Demo, fürs Publishen genügt Vercel/Netlify (kostenlos)
