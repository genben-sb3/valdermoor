import './style.css';

type PdfJsModule = typeof import('pdfjs-dist');
let pdfJsCache: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (pdfJsCache) return pdfJsCache;
  const [pdfjsLib, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default;
  pdfJsCache = pdfjsLib;
  return pdfjsLib;
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type StatKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
type AgeMode = 'kinder' | 'jugend' | 'erwachsen';

interface Player {
  id: string;
  name: string;
  class: string;
  hp: number;
  maxHp: number;
  stats: Record<StatKey, number>;
  color: string;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  speaker?: string;
}

interface InventoryItem {
  name: string;
  quantity: number;
}

type PasswordAlgo = 'sha256-v1' | 'pbkdf2-v2';

interface StoredAccount {
  username: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordAlgo?: PasswordAlgo;
  created: number;
}

type PendingAction =
  | { kind: 'login'; username: string }
  | { kind: 'register'; username: string; email: string; password: string };

interface GameSave {
  ageMode: AgeMode;
  players: Player[];
  inventory: InventoryItem[];
  activePlayerId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; speaker?: string }>;
  savedAt: number;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const API_URL = '/v1/chat/completions';
const MODELS_URL = '/v1/models';
const STAT_KEYS: StatKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ACCOUNTS_KEY = 'valdermoor:accounts';
const SESSION_KEY = 'valdermoor:session';
const GAME_KEY_PREFIX = 'valdermoor:game:';
const MAX_PLAYERS = 4;

const PLAYER_COLORS = [
  { bg: '#142132', border: '#3b6cb3', label: '#9cc3ff' }, // blau
  { bg: '#2a1f32', border: '#a053d9', label: '#d9a8ff' }, // lila
  { bg: '#1f2f1a', border: '#5aa33c', label: '#b8e89b' }, // grün
  { bg: '#322215', border: '#cc7a2a', label: '#ffc88a' }, // orange
];

const KNOWN_CLASSES = [
  'Krieger', 'Magier', 'Zauberer', 'Dieb', 'Schurke', 'Waldläufer',
  'Kleriker', 'Barde', 'Paladin', 'Druide', 'Mönch', 'Hexenmeister',
];

const ENGLISH_TO_GERMAN_CLASS: Record<string, string> = {
  fighter: 'Krieger', barbarian: 'Krieger', wizard: 'Magier',
  sorcerer: 'Zauberer', rogue: 'Dieb', thief: 'Dieb', ranger: 'Waldläufer',
  cleric: 'Kleriker', bard: 'Barde', paladin: 'Paladin', druid: 'Druide',
  monk: 'Mönch', warlock: 'Hexenmeister',
};

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────

let currentUser: string | null = null;
let ageMode: AgeMode = 'jugend';
let players: Player[] = [];
let activePlayerId: string = '';
let messages: Message[] = [];
const inventory: InventoryItem[] = [];
let isGenerating = false;
let currentAbortController: AbortController | null = null;
let pendingAction: PendingAction | null = null;
let pendingCode: string | null = null;
let pendingCodeExpiry = 0;

// ────────────────────────────────────────────────────────────
// DOM helpers
// ────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  root.querySelector(sel) as T;

const $$ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ────────────────────────────────────────────────────────────
// Crypto / Auth (Web Crypto API)
// ────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;

async function hashPasswordLegacySha256(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(salt + ':' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPasswordPBKDF2(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPassword(password: string, acct: StoredAccount): Promise<boolean> {
  const algo: PasswordAlgo = acct.passwordAlgo ?? 'sha256-v1';
  if (algo === 'pbkdf2-v2') {
    const hash = await hashPasswordPBKDF2(password, acct.passwordSalt);
    return hash === acct.passwordHash;
  }
  const hash = await hashPasswordLegacySha256(password, acct.passwordSalt);
  return hash === acct.passwordHash;
}

async function migrateLegacyHash(password: string, acct: StoredAccount): Promise<void> {
  if (acct.passwordAlgo === 'pbkdf2-v2') return;
  const newSalt = generateSalt();
  const newHash = await hashPasswordPBKDF2(password, newSalt);
  saveAccount({
    ...acct,
    passwordSalt: newSalt,
    passwordHash: newHash,
    passwordAlgo: 'pbkdf2-v2',
  });
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateEmailCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
  return String(num).padStart(6, '0');
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const shown = user.length <= 2 ? user : user.slice(0, 2) + '•••';
  return `${shown}@${domain}`;
}

function loadAccounts(): Record<string, StoredAccount> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAccount(acct: StoredAccount) {
  const all = loadAccounts();
  all[acct.username.toLowerCase()] = acct;
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all));
}

function setSession(username: string) {
  localStorage.setItem(SESSION_KEY, username);
  currentUser = username;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
}

function getSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

// ────────────────────────────────────────────────────────────
// Game persistence (per-user save in localStorage)
// ────────────────────────────────────────────────────────────

function gameKey(): string | null {
  return currentUser ? GAME_KEY_PREFIX + currentUser.toLowerCase() : null;
}

function saveGame() {
  const key = gameKey();
  if (!key) return;
  if (players.length === 0) return;
  const save: GameSave = {
    ageMode,
    players,
    inventory: [...inventory],
    activePlayerId,
    messages: messages
      .slice(1)
      .filter((m): m is Message & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content, speaker: m.speaker })),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(save));
    showSaveToast();
  } catch (e) {
    console.warn('Spielstand konnte nicht gespeichert werden:', e);
    const isQuota =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    showSaveToast(isQuota
      ? '⚠ Speicher voll'
      : '⚠ Speichern fehlgeschlagen', true);
  }
}

function loadGame(): GameSave | null {
  const key = gameKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as GameSave;
    if (!data || !Array.isArray(data.players) || data.players.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

function clearGame() {
  const key = gameKey();
  if (key) localStorage.removeItem(key);
}

// ────────────────────────────────────────────────────────────
// DM System prompt (with age mode + all players)
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const toneLine = {
    kinder:
      'Zielgruppe: KINDER (6-10 Jahre). Nutze einfache Wörter und kurze Sätze. Abenteuer sind freundlich — Schatzsuche, Rätsel, sprechende Tiere. KEINE Gewalt, kein Blut, keine Angst-Elemente. Gegner entkommen oder schlafen ein. Sei ermutigend.',
    jugend:
      'Zielgruppe: Jugendliche. Klassische Fantasy mit Spannung und Mut. Kämpfe werden erzählt, aber ohne grausame Details.',
    erwachsen:
      'Zielgruppe: Erwachsene. Volle Fantasy-Welt mit echten Gefahren, Intrigen und moralischen Entscheidungen.',
  }[ageMode];

  const playerLines = players.length
    ? players.map((p) => {
        const downed = p.hp === 0 ? ' — BEWUSSTLOS (kann nichts tun)' : '';
        const stats = STAT_KEYS.map((k) => `${k} ${p.stats[k]}`).join(' ');
        return `• ${p.name} (${p.class}) — HP ${p.hp}/${p.maxHp} | ${stats}${downed}`;
      }).join('\n')
    : '• (noch keine Helden)';

  const inventoryLines = inventory.length
    ? inventory.map((i) => `• ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join('\n')
    : '• (leer)';

  return `Du bist der Dungeon Master der Fantasy-Welt Valdermoor.

# DEINE ROLLE
Du beschreibst lebendige Szenen und reagierst auf die Aktionen der Helden. Du bist NIE selbst einer der Helden — du bist die Welt, die NSCs und das Schicksal.

# SPRACHE & STIL
- Antworte IMMER auf Deutsch.
- 2 bis 4 Sätze pro Zug. Fließtext, kein Aufzählen, kein Meta-Kommentar.
- Sprich die Helden mit Namen direkt an.
- Wiederhole dich nicht. Bringe die Szene nach jeder Antwort einen Schritt weiter.
- ${toneLine}

# SPIEL-MARKIERUNGEN (genau so in eckigen Klammern schreiben!)
- [ITEM: Name] — wenn ein Held etwas findet oder bekommt
- [VERBRAUCHT: Name] — wenn ein Held einen Gegenstand benutzt oder aufbraucht (Heiltrank, Fackel, Pfeil…)
- [VERLOREN: Name] — wenn ein Held einen Gegenstand verliert oder hergibt
- [SCHADEN: Name -Wert] — wenn ein Held verletzt wird, z.B. [SCHADEN: Marko -4]
- [HEILUNG: Name +Wert] — wenn ein Held geheilt wird, z.B. [HEILUNG: Lina +6]
- [WÜRFEL: W20 Grund] — wenn ein Held würfeln soll, z.B. [WÜRFEL: W20 Geschicklichkeit] (auch W4/W6/W8/W10/W12 möglich)
Nur Tags für Helden benutzen — nicht für Gegner/NSCs. Bewusstlose Helden (HP 0) können nicht handeln.

# WÜRFE & STATS
Wähle den Wurf-Grund passend zum Stat: STR (Stärke), DEX (Geschicklichkeit), CON (Konstitution), INT (Intelligenz), WIS (Weisheit), CHA (Charisma). Höhere Stats → bessere Helden in dem Bereich. Berücksichtige die Werte, wenn du Schwierigkeit oder Erfolg beurteilst.

# BEISPIEL EINER GUTEN ANTWORT
Spieler: "Marko öffnet vorsichtig die morsche Truhe."
DM: "Die Truhe quietscht, als Marko den Deckel hebt, Staub wirbelt auf. Darin liegt ein verstaubter Silberdolch auf einem zerrissenen Tuch — daneben glitzern drei Goldmünzen. [ITEM: Silberdolch] [ITEM: Goldmünze]"

Spieler: "Lina schleicht an der Wache vorbei."
DM: "Die Wache gähnt und lehnt sich an die Mauer. Lina, zeig mir, wie geschickt du bist. [WÜRFEL: W20 Geschicklichkeit]"

# DEINE HELDEN (aktueller Stand)
${playerLines}

# INVENTAR DER GRUPPE
${inventoryLines}`;
}

// ────────────────────────────────────────────────────────────
// Login screen
// ────────────────────────────────────────────────────────────

function showLoginScreen() {
  $<HTMLDivElement>('#login-screen').classList.remove('hidden');
  $<HTMLElement>('#app').hidden = true;
  $<HTMLDivElement>('#char-modal').hidden = true;
}

function hideLoginScreen() {
  $<HTMLDivElement>('#login-screen').classList.add('hidden');
}

function setupLoginTabs() {
  $$<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      $$<HTMLButtonElement>('.tab-btn').forEach((b) =>
        b.classList.toggle('active', b === btn),
      );
      $$<HTMLElement>('.tab-panel').forEach((p) => {
        const match = p.id.startsWith(target!);
        p.hidden = !match;
        p.classList.toggle('active', match);
      });
      clearLoginErrors();
    });
  });
}

function clearLoginErrors() {
  $<HTMLDivElement>('#login-error').textContent = '';
  $<HTMLDivElement>('#register-error').textContent = '';
  $<HTMLDivElement>('#email-code-error').textContent = '';
}

interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

function getEmailJsConfig(): EmailJsConfig | null {
  const env = import.meta.env;
  const serviceId = env.VITE_EMAILJS_SERVICE_ID as string | undefined;
  const templateId = env.VITE_EMAILJS_TEMPLATE_ID as string | undefined;
  const publicKey = env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;
  if (serviceId && templateId && publicKey) {
    return { serviceId, templateId, publicKey };
  }
  return null;
}

async function sendCodeViaEmailJs(
  cfg: EmailJsConfig,
  toEmail: string,
  code: string,
): Promise<boolean> {
  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          to_email: toEmail,
          email: toEmail,
          code,
          app_name: 'Valdermoor',
          expiry_minutes: 5,
        },
      }),
    });
    return response.ok;
  } catch (err) {
    console.warn('EmailJS-Versand fehlgeschlagen:', err);
    return false;
  }
}

async function triggerEmailCode(email: string) {
  pendingCode = generateEmailCode();
  pendingCodeExpiry = Date.now() + 5 * 60 * 1000;

  $<HTMLDivElement>('#email-notif-to').textContent = `An: ${maskEmail(email)}`;
  $<HTMLInputElement>('#email-code-input').value = '';
  $<HTMLDivElement>('#email-code-error').textContent = '';
  $<HTMLDivElement>('#email-code-modal').hidden = false;

  const codeDisplay = $<HTMLDivElement>('#email-code-display');
  const disclaimer = document.querySelector<HTMLDivElement>('.demo-disclaimer');
  const subText = document.querySelector<HTMLParagraphElement>('.email-notif-body .email-notif-sub');

  const cfg = getEmailJsConfig();
  if (cfg) {
    codeDisplay.textContent = '••••••';
    codeDisplay.classList.add('sending');
    if (disclaimer) disclaimer.hidden = true;
    if (subText) subText.textContent = 'Code wird versendet…';

    const sent = await sendCodeViaEmailJs(cfg, email, pendingCode);

    codeDisplay.classList.remove('sending');
    if (sent) {
      codeDisplay.textContent = '✉ gesendet';
      if (subText) {
        subText.textContent = `Wir haben den 6-stelligen Code an ${maskEmail(email)} gesendet. Schau in dein Postfach (auch im Spam-Ordner). Gültig 5 Minuten.`;
      }
    } else {
      codeDisplay.textContent = pendingCode;
      if (disclaimer) {
        disclaimer.hidden = false;
        disclaimer.innerHTML =
          '⚠ <strong>E-Mail-Versand fehlgeschlagen.</strong> Code wird ersatzweise hier angezeigt.';
      }
      if (subText) subText.textContent = 'Gültig für 5 Minuten.';
    }
  } else {
    codeDisplay.textContent = pendingCode;
    if (disclaimer) disclaimer.hidden = false;
    if (subText) {
      subText.textContent = 'Gültig für 5 Minuten. Wenn du diese E-Mail nicht erwartet hast, ignoriere sie bitte.';
    }
  }

  setTimeout(() => $<HTMLInputElement>('#email-code-input').focus(), 50);
}

function setupLoginForm() {
  const form = $<HTMLFormElement>('#login-form');
  const errEl = $<HTMLDivElement>('#login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';

    const user = $<HTMLInputElement>('#login-user').value.trim();
    const pass = $<HTMLInputElement>('#login-pass').value;

    if (!user || !pass) {
      errEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
      return;
    }

    const accounts = loadAccounts();
    const acct = accounts[user.toLowerCase()];
    if (!acct) {
      errEl.textContent = 'Benutzer nicht gefunden.';
      return;
    }

    const ok = await verifyPassword(pass, acct);
    if (!ok) {
      errEl.textContent = 'Falsches Passwort.';
      return;
    }
    void migrateLegacyHash(pass, acct);

    pendingAction = { kind: 'login', username: acct.username };
    await triggerEmailCode(acct.email);
  });
}

function setupRegisterForm() {
  const form = $<HTMLFormElement>('#register-form');
  const errEl = $<HTMLDivElement>('#register-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';

    const user = $<HTMLInputElement>('#reg-user').value.trim();
    const email = $<HTMLInputElement>('#reg-email').value.trim();
    const pass = $<HTMLInputElement>('#reg-pass').value;

    if (!user || user.length < 3) {
      errEl.textContent = 'Benutzername muss mindestens 3 Zeichen haben.';
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
      return;
    }
    if (!pass || pass.length < 6) {
      errEl.textContent = 'Passwort muss mindestens 6 Zeichen haben.';
      return;
    }

    const accounts = loadAccounts();
    if (accounts[user.toLowerCase()]) {
      errEl.textContent = 'Benutzername existiert schon.';
      return;
    }

    pendingAction = { kind: 'register', username: user, email, password: pass };
    await triggerEmailCode(email);
  });
}

function setupEmailCodeModal() {
  const form = $<HTMLFormElement>('#email-code-form');
  const input = $<HTMLInputElement>('#email-code-input');
  const errEl = $<HTMLDivElement>('#email-code-error');
  const cancelBtn = $<HTMLButtonElement>('#email-code-cancel');

  cancelBtn.addEventListener('click', () => {
    pendingAction = null;
    pendingCode = null;
    $<HTMLDivElement>('#email-code-modal').hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';

    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = 'Bitte 6-stelligen Code eingeben.';
      return;
    }
    if (!pendingCode || Date.now() > pendingCodeExpiry) {
      errEl.textContent = 'Code abgelaufen. Bitte erneut anmelden.';
      return;
    }
    if (code !== pendingCode) {
      errEl.textContent = 'Code ist falsch.';
      return;
    }
    if (!pendingAction) {
      errEl.textContent = 'Keine ausstehende Aktion.';
      return;
    }

    if (pendingAction.kind === 'register') {
      const salt = generateSalt();
      const passwordHash = await hashPasswordPBKDF2(pendingAction.password, salt);
      saveAccount({
        username: pendingAction.username,
        email: pendingAction.email,
        passwordHash,
        passwordSalt: salt,
        passwordAlgo: 'pbkdf2-v2',
        created: Date.now(),
      });
      setSession(pendingAction.username);
    } else {
      setSession(pendingAction.username);
    }

    pendingAction = null;
    pendingCode = null;
    $<HTMLDivElement>('#email-code-modal').hidden = true;
    onLoggedIn();
  });
}

function onLoggedIn() {
  hideLoginScreen();
  const save = loadGame();
  if (save) {
    resumeGame(save);
  } else {
    showCharModal();
  }
}

// ────────────────────────────────────────────────────────────
// Character creation modal
// ────────────────────────────────────────────────────────────

function showCharModal() {
  $<HTMLDivElement>('#char-modal').hidden = false;
  if (players.length === 0) {
    addEmptyPlayer();
  }
  renderPlayerTabs();
  renderPlayerForms();
}

function hideCharModal() {
  $<HTMLDivElement>('#char-modal').hidden = true;
}

function emptyPlayer(index: number): Player {
  const color = PLAYER_COLORS[index % PLAYER_COLORS.length].border;
  return {
    id: uid(),
    name: '',
    class: 'Krieger',
    hp: 20,
    maxHp: 20,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    color,
  };
}

function addEmptyPlayer() {
  if (players.length >= MAX_PLAYERS) return;
  const p = emptyPlayer(players.length);
  // Prefill stats
  for (const k of STAT_KEYS) p.stats[k] = rollStat();
  players.push(p);
  activePlayerId = p.id;
}

let activeFormPlayerId = '';

function renderPlayerTabs() {
  const tabsEl = $<HTMLDivElement>('#player-tabs');
  tabsEl.innerHTML = '';
  players.forEach((p, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'player-tab';
    tab.dataset.id = p.id;
    if (activeFormPlayerId === p.id || (i === 0 && !activeFormPlayerId)) {
      tab.classList.add('active');
      activeFormPlayerId = p.id;
    }
    tab.style.borderLeft = `4px solid ${p.color}`;
    tab.textContent = p.name.trim() || `Spieler ${i + 1}`;

    if (players.length > 1) {
      const rm = document.createElement('span');
      rm.textContent = '×';
      rm.className = 'remove-x';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        removePlayer(p.id);
      });
      tab.appendChild(rm);
    }

    tab.addEventListener('click', () => {
      collectActiveFormIntoPlayer();
      activeFormPlayerId = p.id;
      renderPlayerTabs();
      renderPlayerForms();
    });
    tabsEl.appendChild(tab);
  });
  const addBtn = $<HTMLButtonElement>('#add-player-btn');
  addBtn.disabled = players.length >= MAX_PLAYERS;
}

function removePlayer(id: string) {
  if (players.length <= 1) return;
  players = players.filter((p) => p.id !== id);
  if (activeFormPlayerId === id) {
    activeFormPlayerId = players[0].id;
  }
  renderPlayerTabs();
  renderPlayerForms();
}

function renderPlayerForms() {
  const wrap = $<HTMLDivElement>('#player-forms');
  wrap.innerHTML = '';
  const p = players.find((x) => x.id === activeFormPlayerId);
  if (!p) return;

  const tpl = $<HTMLTemplateElement>('#player-form-tpl');
  const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;

  const nameInput = $<HTMLInputElement>('.form-name', node);
  nameInput.value = p.name;
  nameInput.addEventListener('input', () => {
    p.name = nameInput.value;
    renderPlayerTabs();
  });

  const classSel = $<HTMLSelectElement>('.form-class', node);
  classSel.value = p.class;
  classSel.addEventListener('change', () => {
    p.class = classSel.value;
  });

  const hpInput = $<HTMLInputElement>('.form-hp', node);
  hpInput.value = String(p.maxHp);
  hpInput.addEventListener('input', () => {
    const n = parseInt(hpInput.value, 10);
    if (Number.isFinite(n) && n > 0 && n < 1000) {
      p.maxHp = n;
      p.hp = n;
    }
  });

  for (const k of STAT_KEYS) {
    const input = $<HTMLInputElement>(`.stat-${k}`, node);
    input.value = String(p.stats[k]);
    input.addEventListener('input', () => {
      const n = parseInt(input.value, 10);
      if (Number.isFinite(n) && n >= 3 && n <= 30) p.stats[k] = n;
    });
  }

  $<HTMLButtonElement>('.roll-stats-btn', node).addEventListener('click', () => {
    for (const k of STAT_KEYS) {
      p.stats[k] = rollStat();
      $<HTMLInputElement>(`.stat-${k}`, node).value = String(p.stats[k]);
    }
  });

  const pdfInput = $<HTMLInputElement>('.pdf-input', node);
  const pdfStatus = $<HTMLSpanElement>('.pdf-status', node);
  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];
    if (!file) return;
    pdfStatus.textContent = '⏳ Lese PDF…';
    pdfStatus.className = 'pdf-status busy';
    try {
      const text = await extractPdfText(file);
      $<HTMLPreElement>('#pdf-text').textContent = text;
      $<HTMLDetailsElement>('#pdf-text-wrapper').hidden = false;

      const fields = parseSheetFields(text);
      let filled = 0;
      if (fields.name) {
        p.name = fields.name;
        nameInput.value = fields.name;
        filled++;
      }
      if (fields.class) {
        p.class = fields.class;
        classSel.value = fields.class;
        filled++;
      }
      if (fields.maxHp) {
        p.maxHp = fields.maxHp;
        p.hp = fields.maxHp;
        hpInput.value = String(fields.maxHp);
        filled++;
      }
      if (fields.stats) {
        for (const k of STAT_KEYS) {
          const v = fields.stats[k];
          if (v !== undefined) {
            p.stats[k] = v;
            $<HTMLInputElement>(`.stat-${k}`, node).value = String(v);
            filled++;
          }
        }
      }
      pdfStatus.textContent = `✓ ${filled} Felder erkannt.`;
      pdfStatus.className = 'pdf-status ok';
      renderPlayerTabs();
    } catch (err) {
      console.error(err);
      pdfStatus.textContent = '✗ PDF konnte nicht gelesen werden.';
      pdfStatus.className = 'pdf-status error';
    }
  });

  wrap.appendChild(node);
}

function collectActiveFormIntoPlayer() {
  // Already bound via events on the form inputs — no explicit collection needed
}

function rollStat(): number {
  const rolls = [0, 0, 0, 0].map(() => Math.floor(Math.random() * 6) + 1);
  rolls.sort((a, b) => b - a);
  return rolls[0] + rolls[1] + rolls[2];
}

function setupModal() {
  $<HTMLButtonElement>('#add-player-btn').addEventListener('click', () => {
    addEmptyPlayer();
    activeFormPlayerId = players[players.length - 1].id;
    renderPlayerTabs();
    renderPlayerForms();
  });

  $<HTMLSelectElement>('#age-mode').addEventListener('change', (e) => {
    ageMode = (e.target as HTMLSelectElement).value as AgeMode;
  });

  $<HTMLButtonElement>('#start-btn').addEventListener('click', () => {
    if (players.some((p) => !p.name.trim())) {
      alert('Bitte alle Spieler benennen.');
      return;
    }
    const namesLower = players.map((p) => p.name.trim().toLowerCase());
    const dup = namesLower.find((n, i) => namesLower.indexOf(n) !== i);
    if (dup) {
      alert(`Doppelter Name: "${dup}". Jeder Held braucht einen eindeutigen Namen, sonst klappt das Tag-System nicht.`);
      return;
    }
    beginAdventure();
  });
}

function beginAdventure() {
  activePlayerId = players[0].id;
  hideCharModal();
  $<HTMLElement>('#app').hidden = false;

  messages = [{ role: 'system', content: buildSystemPrompt() }];
  inventory.length = 0;
  renderInventory();
  renderMessagesArea(true);
  renderPlayersSidebar();
  renderPlayerSelector();
  updateUserChip();
  syncAgeModeSelect();

  const introParts = players.map(
    (p) => `${p.name} (${p.class})`
  ).join(', ');
  const intro =
    `Unsere Gruppe: ${introParts}. Wir treten nach Valdermoor ein. ` +
    `Begrüße uns und führe uns in eine passende Eröffnungsszene ein.`;
  void checkLmStudioStatus().then(() => sendToLMStudio(intro, 'Erzähler'));
}

function resumeGame(save: GameSave) {
  ageMode = save.ageMode;
  players = save.players;
  inventory.length = 0;
  inventory.push(...save.inventory);
  activePlayerId = save.activePlayerId || (players[0]?.id ?? '');

  messages = [{ role: 'system', content: buildSystemPrompt() }];
  for (const m of save.messages) {
    messages.push({ role: m.role, content: m.content, speaker: m.speaker });
  }

  hideCharModal();
  $<HTMLElement>('#app').hidden = false;
  renderMessagesArea(true);

  for (const m of save.messages) {
    if (m.role === 'user' && m.speaker && m.speaker !== 'Erzähler') {
      const p = players.find((x) => x.name === m.speaker);
      const prefix = m.speaker + ':';
      const text = m.content.startsWith(prefix)
        ? m.content.slice(prefix.length).trim()
        : m.content;
      addPlayerBubble(m.speaker, text, p?.color ?? '#888');
    } else if (m.role === 'assistant') {
      const dmBody = addDMBubble('');
      dmBody.textContent = stripGameTags(m.content);
      const events = extractDmEvents(m.content);
      const wrap = dmBody.parentElement as HTMLDivElement | null;
      if (wrap) renderEventBadges(wrap, events);
      const diceReqs = parseDiceRequests(m.content);
      if (wrap && diceReqs.length) {
        const row = document.createElement('div');
        row.className = 'dice-request-row';
        for (const req of diceReqs) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'dice-request-chip';
          chip.textContent = req.reason
            ? `🎲 W${req.sides} würfeln — ${req.reason}`
            : `🎲 W${req.sides} würfeln`;
          chip.disabled = true;
          chip.title = 'Aus früherer Sitzung — nicht mehr klickbar';
          row.appendChild(chip);
        }
        wrap.appendChild(row);
      }
    }
  }

  renderInventory();
  renderPlayersSidebar();
  renderPlayerSelector();
  updateUserChip();
  syncAgeModeSelect();
  setStatus('Fortgesetzt', 'ok');
}

function syncAgeModeSelect() {
  const sel = document.getElementById('age-mode-app') as HTMLSelectElement | null;
  if (sel) sel.value = ageMode;
}

// ────────────────────────────────────────────────────────────
// PDF extraction
// ────────────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .filter(Boolean);
    pages.push(strings.join(' '));
  }
  return pages.join('\n\n');
}

function parseSheetFields(text: string) {
  const result: Partial<{
    name: string;
    class: string;
    maxHp: number;
    stats: Partial<Record<StatKey, number>>;
  }> = { stats: {} };

  const nameMatch =
    text.match(/(?:Character\s*Name|Charaktername|Name)[\s:]+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\s\-']{1,40})/i) ||
    text.match(/^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+){0,3})$/m);
  if (nameMatch) {
    const candidate = nameMatch[1].trim().replace(/\s{2,}/g, ' ');
    if (candidate.length >= 2 && candidate.length <= 50) result.name = candidate;
  }

  for (const c of KNOWN_CLASSES) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(text)) { result.class = c; break; }
  }
  if (!result.class) {
    for (const [en, de] of Object.entries(ENGLISH_TO_GERMAN_CLASS)) {
      if (new RegExp(`\\b${en}\\b`, 'i').test(text)) { result.class = de; break; }
    }
  }

  const hpMatch = text.match(
    /(?:Hit\s*Points?(?:\s*Max(?:imum)?)?|Max(?:imum)?\s*HP|HP\s*Max|Trefferpunkte|Lebenspunkte)[\s:]*(\d{1,3})/i,
  );
  if (hpMatch) {
    const n = parseInt(hpMatch[1], 10);
    if (n > 0 && n < 1000) result.maxHp = n;
  }

  const statPatterns: Record<StatKey, RegExp[]> = {
    STR: [/\b(?:STR|Strength|Stärke|STÄ)\b[\s:]*(\d{1,2})/i],
    DEX: [/\b(?:DEX|Dexterity|Geschicklichkeit|GES)\b[\s:]*(\d{1,2})/i],
    CON: [/\b(?:CON|Constitution|Konstitution|KON)\b[\s:]*(\d{1,2})/i],
    INT: [/\b(?:INT|Intelligence|Intelligenz)\b[\s:]*(\d{1,2})/i],
    WIS: [/\b(?:WIS|Wisdom|Weisheit|WEI)\b[\s:]*(\d{1,2})/i],
    CHA: [/\b(?:CHA|Charisma)\b[\s:]*(\d{1,2})/i],
  };
  for (const k of STAT_KEYS) {
    for (const rx of statPatterns[k]) {
      const m = text.match(rx);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 3 && n <= 30) { result.stats![k] = n; break; }
      }
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────
// Chat
// ────────────────────────────────────────────────────────────

function renderMessagesArea(clear = false) {
  const el = $<HTMLDivElement>('#messages');
  if (clear) el.innerHTML = '';
}

function addDMBubble(text = ''): HTMLDivElement {
  const el = $<HTMLDivElement>('#messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-dm';
  const label = document.createElement('div');
  label.className = 'msg-label msg-label-dm';
  label.textContent = '🧙 Dungeon Master';
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(label);
  wrap.appendChild(body);
  el.appendChild(wrap);
  el.scrollTop = el.scrollHeight;
  return body;
}

function addPlayerBubble(speaker: string, text: string, color: string): HTMLDivElement {
  const el = $<HTMLDivElement>('#messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-player';
  wrap.style.borderColor = color;
  const label = document.createElement('div');
  label.className = 'msg-label msg-label-player';
  label.textContent = '⚔️ ' + speaker;
  label.style.color = color;
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(label);
  wrap.appendChild(body);
  el.appendChild(wrap);
  el.scrollTop = el.scrollHeight;
  return body;
}

function addErrorBubble(text: string) {
  const el = $<HTMLDivElement>('#messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-error';
  wrap.textContent = text;
  el.appendChild(wrap);
  el.scrollTop = el.scrollHeight;
}

function addRetryBubble(text: string, onRetry: () => void) {
  const el = $<HTMLDivElement>('#messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-error';
  const txt = document.createElement('div');
  txt.textContent = text;
  wrap.appendChild(txt);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'retry-btn';
  btn.textContent = '🔁 Nochmal versuchen';
  btn.addEventListener('click', () => {
    wrap.remove();
    onRetry();
  });
  wrap.appendChild(btn);
  el.appendChild(wrap);
  el.scrollTop = el.scrollHeight;
}

function setStatus(text: string, kind: 'ok' | 'error' | 'busy') {
  const el = $<HTMLDivElement>('#status');
  el.textContent = text;
  el.className = `status-${kind}`;
}

let saveToastTimer: number | null = null;
function showSaveToast(text: string = '💾 Gespeichert', isError: boolean = false) {
  let toast = document.getElementById('save-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'save-toast';
    toast.className = 'save-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  if (saveToastTimer) window.clearTimeout(saveToastTimer);
  const duration = isError ? 3000 : 1500;
  saveToastTimer = window.setTimeout(() => {
    toast?.classList.remove('show');
  }, duration);
}

interface LmStatus {
  ok: boolean;
  reason?: 'unreachable' | 'no-model' | 'http-error';
  modelCount?: number;
  modelId?: string;
  detail?: string;
}

let knownModelId: string | null = null;

async function pingLmStudio(): Promise<LmStatus> {
  try {
    const res = await fetch(MODELS_URL, { method: 'GET' });
    if (!res.ok) return { ok: false, reason: 'http-error', detail: `HTTP ${res.status}` };
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return { ok: false, reason: 'no-model', modelCount: 0 };
    knownModelId = ids[0];
    return { ok: true, modelCount: ids.length, modelId: ids[0] };
  } catch (err) {
    return { ok: false, reason: 'unreachable', detail: String(err) };
  }
}

async function checkLmStudioStatus() {
  const status = await pingLmStudio();
  if (status.ok) {
    setStatus(`Bereit (${status.modelCount} Modell${(status.modelCount ?? 0) > 1 ? 'e' : ''})`, 'ok');
    return;
  }
  if (status.reason === 'unreachable') {
    addErrorBubble(
      '⚠ LM Studio läuft nicht. Starte LM Studio → Tab "Local Server" → "Start Server". ' +
      'Sieh in SETUP.md für Details.',
    );
    setStatus('LM Studio offline', 'error');
  } else if (status.reason === 'no-model') {
    addErrorBubble(
      '⚠ LM Studio läuft, aber kein Modell ist geladen. ' +
      'Geh in den "Chat"-Tab und lade ein Modell (z.B. SmolLM2 360M oder Phi-3.5 Mini).',
    );
    setStatus('Kein Modell', 'error');
  } else {
    addErrorBubble(`⚠ LM Studio antwortet mit Fehler: ${status.detail ?? 'unbekannt'}`);
    setStatus('Server-Fehler', 'error');
  }
}

const HEAD_KEEP = 4;
const TAIL_KEEP = 14;

function trimHistory(): Message[] {
  if (messages.length <= 1 + HEAD_KEEP + TAIL_KEEP) return messages;
  return [
    messages[0],
    ...messages.slice(1, 1 + HEAD_KEEP),
    ...messages.slice(-TAIL_KEEP),
  ];
}

function setSendButtonMode(mode: 'send' | 'stop') {
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement | null;
  if (!sendBtn) return;
  if (mode === 'stop') {
    sendBtn.disabled = false;
    sendBtn.type = 'button';
    sendBtn.textContent = '⏹ Stop';
    sendBtn.classList.add('stop-mode');
  } else {
    sendBtn.disabled = false;
    sendBtn.type = 'submit';
    sendBtn.textContent = 'Senden';
    sendBtn.classList.remove('stop-mode');
  }
}

async function sendToLMStudio(userText: string, speaker: string) {
  if (isGenerating) return;
  isGenerating = true;
  setSendButtonMode('stop');
  setStatus('Der DM denkt nach…', 'busy');

  const decorated = speaker === 'Erzähler' ? userText : `${speaker}: ${userText}`;
  messages.push({ role: 'user', content: decorated, speaker });

  if (speaker !== 'Erzähler') {
    const p = players.find((x) => x.name === speaker);
    addPlayerBubble(speaker, userText, p?.color ?? '#888');
  }

  messages[0] = { role: 'system', content: buildSystemPrompt() };

  const dmBody = addDMBubble('');
  let fullText = '';
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: knownModelId ?? 'local-model',
        messages: trimHistory().map(({ role, content }) => ({ role, content })),
        stream: true,
        temperature: 0.75,
        max_tokens: 300,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          const token: string = chunk.choices?.[0]?.delta?.content ?? '';
          if (token) {
            fullText += token;
            dmBody.textContent = fullText;
            $<HTMLDivElement>('#messages').scrollTop =
              $<HTMLDivElement>('#messages').scrollHeight;
          }
        } catch { /* ignore */ }
      }
    }
    if (!fullText.trim()) {
      dmBody.parentElement?.remove();
      messages.pop();
      addErrorBubble('⚠ Der DM hat nichts gesagt. Versuch es nochmal.');
      setStatus('Leere Antwort', 'error');
      return;
    }
    messages.push({ role: 'assistant', content: fullText });
    parseInventory(fullText);
    parseInventoryLoss(fullText);
    parseDamage(fullText);
    parseHeal(fullText);
    const diceRequests = parseDiceRequests(fullText);
    const events = extractDmEvents(fullText);
    dmBody.textContent = stripGameTags(fullText);
    const msgWrap = dmBody.parentElement as HTMLDivElement | null;
    if (msgWrap) renderEventBadges(msgWrap, events);
    pulseDiceButtons(diceRequests);
    if (msgWrap && diceRequests.length) {
      const row = document.createElement('div');
      row.className = 'dice-request-row';
      for (const req of diceRequests) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'dice-request-chip';
        chip.textContent = req.reason
          ? `🎲 W${req.sides} würfeln — ${req.reason}`
          : `🎲 W${req.sides} würfeln`;
        chip.addEventListener('click', () => rollAndSendForDM(req.sides, req.reason, chip));
        row.appendChild(chip);
      }
      msgWrap.appendChild(row);
    }
    setStatus('Bereit', 'ok');
    saveGame();
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      dmBody.parentElement?.remove();
      messages.pop();
      setStatus('Abgebrochen', 'ok');
      return;
    }
    console.error(err);
    dmBody.parentElement?.remove();
    const lastMsg = messages.pop();
    const retryUserText = lastMsg?.content ?? userText;
    const retrySpeaker = lastMsg?.speaker ?? speaker;

    const status = await pingLmStudio();
    let errMsg: string;
    if (status.reason === 'unreachable') {
      errMsg = '⚠ LM Studio nicht erreichbar. Server starten? (Tab "Local Server" → "Start Server")';
      setStatus('LM Studio offline', 'error');
    } else if (status.reason === 'no-model') {
      errMsg = '⚠ LM Studio läuft, aber kein Modell geladen. Lade ein Modell im Chat-Tab.';
      setStatus('Kein Modell', 'error');
    } else {
      errMsg = `⚠ Verbindungsfehler: ${(err as Error)?.message ?? 'unbekannt'}`;
      setStatus('Fehler', 'error');
    }
    addRetryBubble(errMsg, () => {
      const stripped = retrySpeaker !== 'Erzähler' && retryUserText.startsWith(retrySpeaker + ':')
        ? retryUserText.slice(retrySpeaker.length + 1).trim()
        : retryUserText;
      void sendToLMStudio(stripped, retrySpeaker);
    });
  } finally {
    isGenerating = false;
    currentAbortController = null;
    setSendButtonMode('send');
    $<HTMLTextAreaElement>('#input').focus();
  }
}

// ────────────────────────────────────────────────────────────
// Dice
// ────────────────────────────────────────────────────────────

function rollDice(sides: number) {
  const result = Math.floor(Math.random() * sides) + 1;
  const el = $<HTMLDivElement>('#dice-result');
  el.textContent = `W${sides} → ${result}`;
  el.classList.remove('rolling');
  void el.offsetWidth;
  el.classList.add('rolling');
  const input = $<HTMLTextAreaElement>('#input');
  const phrase = `Ich würfle eine ${result} auf dem W${sides}.`;
  input.value = input.value.trim() ? input.value.trimEnd() + ' ' + phrase : phrase;
  input.focus();
}

function pulseDiceButtons(requests: Array<{ sides: number; reason: string }>) {
  const seen = new Set<number>();
  for (const r of requests) {
    if (seen.has(r.sides)) continue;
    seen.add(r.sides);
    const btn = document.querySelector<HTMLButtonElement>(`.dice-btn[data-sides="${r.sides}"]`);
    if (!btn) continue;
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
    window.setTimeout(() => btn.classList.remove('pulse'), 3500);
  }
}

function setupDiceButtons() {
  $$<HTMLButtonElement>('.dice-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sides = Number(btn.dataset.sides);
      if (sides) rollDice(sides);
    });
  });
}

// ────────────────────────────────────────────────────────────
// Inventory
// ────────────────────────────────────────────────────────────

const highlightedItems = new Set<string>();

function parseInventory(text: string) {
  const regex = /\[ITEM:\s*([^\]]+)\]/gi;
  let match;
  let changed = false;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    const existing = inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.quantity += 1;
    else inventory.push({ name, quantity: 1 });
    highlightedItems.add(name.toLowerCase());
    changed = true;
  }
  if (changed) {
    renderInventory();
    window.setTimeout(() => {
      highlightedItems.clear();
      renderInventory();
    }, 1800);
  }
}

function parseInventoryLoss(text: string) {
  const regex = /\[(?:VERLOREN|VERBRAUCHT):\s*([^\]]+)\]/gi;
  let match;
  let changed = false;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    const idx = inventory.findIndex((i) => i.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      if (inventory[idx].quantity > 1) inventory[idx].quantity -= 1;
      else inventory.splice(idx, 1);
      changed = true;
    } else {
      console.warn(`[Tag-Parser] Inventar-Verlust für "${name}" — nicht im Inventar.`);
    }
  }
  if (changed) renderInventory();
}

function findPlayerByName(name: string): Player | undefined {
  const needle = name.trim().toLowerCase();
  return (
    players.find((p) => p.name.toLowerCase() === needle) ??
    players.find((p) => p.name.toLowerCase().startsWith(needle)) ??
    players.find((p) => needle.startsWith(p.name.toLowerCase()))
  );
}

function parseDamage(text: string) {
  const regex = /\[SCHADEN:\s*([^\-\]]+?)\s*-\s*(\d{1,3})\s*\]/gi;
  let match;
  let changed = false;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const target = findPlayerByName(name);
    const amount = parseInt(match[2], 10);
    if (target && amount > 0) {
      target.hp = Math.max(0, target.hp - amount);
      changed = true;
    } else if (!target) {
      console.warn(`[Tag-Parser] [SCHADEN: ${name}] — kein Held mit diesem Namen, ignoriert.`);
    }
  }
  if (changed) renderPlayersSidebar();
}

function parseHeal(text: string) {
  const regex = /\[HEILUNG:\s*([^\+\]]+?)\s*\+\s*(\d{1,3})\s*\]/gi;
  let match;
  let changed = false;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const target = findPlayerByName(name);
    const amount = parseInt(match[2], 10);
    if (target && amount > 0) {
      target.hp = Math.min(target.maxHp, target.hp + amount);
      changed = true;
    } else if (!target) {
      console.warn(`[Tag-Parser] [HEILUNG: ${name}] — kein Held mit diesem Namen, ignoriert.`);
    }
  }
  if (changed) renderPlayersSidebar();
}

const ALLOWED_DICE = new Set([4, 6, 8, 10, 12, 20, 100]);

function parseDiceRequests(text: string): Array<{ sides: number; reason: string }> {
  const regex = /\[W(?:ÜRFEL|URFEL|UERFEL):\s*W(\d{1,3})(?:\s+([^\]]+?))?\s*\]/gi;
  const out: Array<{ sides: number; reason: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const sides = parseInt(match[1], 10);
    if (!ALLOWED_DICE.has(sides)) continue;
    out.push({ sides, reason: (match[2] ?? '').trim() });
  }
  return out;
}

interface DmEvents {
  itemsAdded: string[];
  itemsLost: string[];
  damage: Array<{ name: string; amount: number }>;
  heal: Array<{ name: string; amount: number }>;
}

function extractDmEvents(text: string): DmEvents {
  const events: DmEvents = { itemsAdded: [], itemsLost: [], damage: [], heal: [] };
  let m: RegExpExecArray | null;

  const itemRe = /\[ITEM:\s*([^\]]+)\]/gi;
  while ((m = itemRe.exec(text)) !== null) {
    const n = m[1].trim();
    if (n) events.itemsAdded.push(n);
  }

  const lossRe = /\[(?:VERLOREN|VERBRAUCHT):\s*([^\]]+)\]/gi;
  while ((m = lossRe.exec(text)) !== null) {
    const n = m[1].trim();
    if (n) events.itemsLost.push(n);
  }

  const dmgRe = /\[SCHADEN:\s*([^\-\]]+?)\s*-\s*(\d{1,3})\s*\]/gi;
  while ((m = dmgRe.exec(text)) !== null) {
    events.damage.push({ name: m[1].trim(), amount: parseInt(m[2], 10) });
  }

  const healRe = /\[HEILUNG:\s*([^\+\]]+?)\s*\+\s*(\d{1,3})\s*\]/gi;
  while ((m = healRe.exec(text)) !== null) {
    events.heal.push({ name: m[1].trim(), amount: parseInt(m[2], 10) });
  }

  return events;
}

function countBy<T>(arr: T[], key: (x: T) => string): Map<string, { item: T; count: number }> {
  const map = new Map<string, { item: T; count: number }>();
  for (const x of arr) {
    const k = key(x);
    const e = map.get(k);
    if (e) e.count += 1;
    else map.set(k, { item: x, count: 1 });
  }
  return map;
}

function sumBy<T>(arr: T[], key: (x: T) => string, amount: (x: T) => number): Map<string, { item: T; total: number }> {
  const map = new Map<string, { item: T; total: number }>();
  for (const x of arr) {
    const k = key(x);
    const e = map.get(k);
    if (e) e.total += amount(x);
    else map.set(k, { item: x, total: amount(x) });
  }
  return map;
}

function renderEventBadges(parent: HTMLElement, events: DmEvents) {
  const total =
    events.itemsAdded.length +
    events.itemsLost.length +
    events.damage.length +
    events.heal.length;
  if (total === 0) return;

  const row = document.createElement('div');
  row.className = 'event-badge-row';

  for (const { item, count } of countBy(events.itemsAdded, (s) => s.toLowerCase()).values()) {
    const b = document.createElement('span');
    b.className = 'event-badge event-badge-add';
    b.textContent = count > 1 ? `🎒 +${item} ×${count}` : `🎒 +${item}`;
    row.appendChild(b);
  }
  for (const { item, count } of countBy(events.itemsLost, (s) => s.toLowerCase()).values()) {
    const b = document.createElement('span');
    b.className = 'event-badge event-badge-lost';
    b.textContent = count > 1 ? `🎒 −${item} ×${count}` : `🎒 −${item}`;
    row.appendChild(b);
  }
  for (const { item: d, total: amt } of sumBy(events.damage, (x) => x.name.toLowerCase(), (x) => x.amount).values()) {
    const b = document.createElement('span');
    b.className = 'event-badge event-badge-damage';
    b.textContent = `💥 ${d.name} −${amt} HP`;
    row.appendChild(b);
  }
  for (const { item: h, total: amt } of sumBy(events.heal, (x) => x.name.toLowerCase(), (x) => x.amount).values()) {
    const b = document.createElement('span');
    b.className = 'event-badge event-badge-heal';
    b.textContent = `✨ ${h.name} +${amt} HP`;
    row.appendChild(b);
  }
  parent.appendChild(row);
}

function stripGameTags(text: string): string {
  return text
    .replace(/\[ITEM:\s*[^\]]+\]/gi, '')
    .replace(/\[(?:VERLOREN|VERBRAUCHT):\s*[^\]]+\]/gi, '')
    .replace(/\[SCHADEN:\s*[^\]]+\]/gi, '')
    .replace(/\[HEILUNG:\s*[^\]]+\]/gi, '')
    .replace(/\[W(?:ÜRFEL|URFEL|UERFEL):\s*[^\]]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

async function rollAndSendForDM(sides: number, reason: string, chip: HTMLButtonElement) {
  if (isGenerating) return;
  const result = Math.floor(Math.random() * sides) + 1;
  chip.disabled = true;
  chip.textContent = `🎲 W${sides} → ${result}${reason ? ` (${reason})` : ''}`;
  for (const sib of Array.from(chip.parentElement?.children ?? [])) {
    if (sib instanceof HTMLButtonElement) sib.disabled = true;
  }
  const active = players.find((p) => p.id === activePlayerId) ?? players[0];
  const speaker = active?.name ?? 'Held';
  const reasonPart = reason ? ` für ${reason}` : '';
  const message = `Ich würfle W${sides}${reasonPart}: ${result}.`;
  await sendToLMStudio(message, speaker);
}

function renderInventory() {
  const el = $<HTMLUListElement>('#inventory-list');
  el.innerHTML = '';
  if (inventory.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch nichts dabei…';
    el.appendChild(li);
    return;
  }
  for (const item of inventory) {
    const li = document.createElement('li');
    li.textContent = item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
    if (highlightedItems.has(item.name.toLowerCase())) {
      li.classList.add('item-new');
    }
    el.appendChild(li);
  }
}

// ────────────────────────────────────────────────────────────
// Players sidebar
// ────────────────────────────────────────────────────────────

function renderPlayersSidebar() {
  const list = $<HTMLUListElement>('#players-list');
  list.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player-card';
    li.dataset.id = p.id;
    li.style.borderLeft = `4px solid ${p.color}`;
    if (p.id === activePlayerId) li.classList.add('active');
    if (p.hp === 0) li.classList.add('downed');

    const downedBadge = p.hp === 0
      ? '<div class="downed-badge">💀 Bewusstlos</div>'
      : '';

    li.innerHTML = `
      <div class="player-card-head">
        <span class="player-card-name">${escapeHtml(p.name)}</span>
        <span class="player-card-class">${escapeHtml(p.class)}</span>
      </div>
      <div class="hp-row"><span>${p.hp}</span> / <span>${p.maxHp}</span> HP</div>
      <div class="hp-bar-outer"><div class="hp-bar-inner" style="width: ${Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100))}%"></div></div>
      ${downedBadge}
    `;

    li.addEventListener('click', () => {
      activePlayerId = p.id;
      renderPlayersSidebar();
      renderPlayerSelector();
      renderActivePlayerDetail();
    });
    list.appendChild(li);
  });
  renderActivePlayerDetail();
}

function renderActivePlayerDetail() {
  const el = $<HTMLDivElement>('#active-player-detail');
  const p = players.find((x) => x.id === activePlayerId);
  if (!p) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <h3>Werte von ${escapeHtml(p.name)}</h3>
    <div class="stats-grid">
      ${STAT_KEYS.map((k) => `
        <div class="stat"><label>${k}</label><span>${p.stats[k]}</span></div>
      `).join('')}
    </div>
  `;
}

function renderPlayerSelector() {
  const sel = $<HTMLSelectElement>('#player-select');
  sel.innerHTML = '';
  players.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activePlayerId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function updateUserChip() {
  $<HTMLSpanElement>('#active-user').textContent = currentUser ? `👤 ${currentUser}` : '';
}

// ────────────────────────────────────────────────────────────
// Chat input
// ────────────────────────────────────────────────────────────

function setupInputForm() {
  const form = $<HTMLFormElement>('#input-form');
  const input = $<HTMLTextAreaElement>('#input');
  const sel = $<HTMLSelectElement>('#player-select');
  const sendBtn = $<HTMLButtonElement>('#send-btn');

  sel.addEventListener('change', () => {
    activePlayerId = sel.value;
    renderPlayersSidebar();
  });

  sendBtn.addEventListener('click', (e) => {
    if (isGenerating) {
      e.preventDefault();
      currentAbortController?.abort();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isGenerating) return;
    const text = input.value.trim();
    if (!text) return;
    const p = players.find((x) => x.id === activePlayerId);
    if (!p) return;
    input.value = '';
    sendToLMStudio(text, p.name);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  $<HTMLButtonElement>('#logout-btn').addEventListener('click', () => {
    if (isGenerating) {
      if (!confirm('Der DM antwortet gerade. Trotzdem abmelden? (Antwort wird abgebrochen.)')) return;
    }
    currentAbortController?.abort();
    saveGame();
    clearSession();
    players = [];
    messages = [];
    inventory.length = 0;
    activePlayerId = '';
    activeFormPlayerId = '';
    $<HTMLElement>('#app').hidden = true;
    showLoginScreen();
  });

  const newRunBtn = document.getElementById('new-run-btn') as HTMLButtonElement | null;
  newRunBtn?.addEventListener('click', () => {
    if (!confirm('Neue Runde starten? Der aktuelle Spielstand geht verloren.')) return;
    currentAbortController?.abort();
    clearGame();
    players = [];
    messages = [];
    inventory.length = 0;
    activePlayerId = '';
    activeFormPlayerId = '';
    $<HTMLElement>('#app').hidden = true;
    showCharModal();
  });

  const ageSel = document.getElementById('age-mode-app') as HTMLSelectElement | null;
  ageSel?.addEventListener('change', () => {
    ageMode = ageSel.value as AgeMode;
    saveGame();
  });

  const helpBtn = document.getElementById('help-btn') as HTMLButtonElement | null;
  const helpModal = document.getElementById('help-modal') as HTMLDivElement | null;
  const helpClose = document.getElementById('help-close') as HTMLButtonElement | null;
  helpBtn?.addEventListener('click', () => {
    if (helpModal) helpModal.hidden = false;
  });
  helpClose?.addEventListener('click', () => {
    if (helpModal) helpModal.hidden = true;
  });
  helpModal?.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.hidden = true;
  });

  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement | null;
  exportBtn?.addEventListener('click', exportAdventure);
}

function exportAdventure() {
  if (players.length === 0 || messages.length <= 1) {
    alert('Es gibt noch nichts zu exportieren — fang erst eine Runde an.');
    return;
  }
  const lines: string[] = [];
  lines.push('VALDERMOOR — Abenteuer-Protokoll');
  lines.push('═'.repeat(50));
  lines.push(`Datum:  ${new Date().toLocaleString('de-DE')}`);
  lines.push(`Modus:  ${ageMode}`);
  lines.push('');
  lines.push('HELDEN:');
  for (const p of players) {
    const stats = STAT_KEYS.map((k) => `${k} ${p.stats[k]}`).join(' · ');
    lines.push(`  • ${p.name} (${p.class}) — HP ${p.hp}/${p.maxHp} | ${stats}`);
  }
  lines.push('');
  if (inventory.length > 0) {
    lines.push('INVENTAR:');
    for (const it of inventory) {
      lines.push(`  • ${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`);
    }
    lines.push('');
  }
  lines.push('═'.repeat(50));
  lines.push('VERLAUF:');
  lines.push('');
  for (const m of messages.slice(1)) {
    if (m.role === 'user') {
      const speaker = m.speaker ?? 'Spieler';
      const text = m.content.startsWith(speaker + ':')
        ? m.content.slice(speaker.length + 1).trim()
        : m.content;
      lines.push(`⚔️  ${speaker}:`);
      lines.push(`    ${text.split('\n').join('\n    ')}`);
    } else if (m.role === 'assistant') {
      lines.push(`🧙  Dungeon Master:`);
      lines.push(`    ${stripGameTags(m.content).split('\n').join('\n    ')}`);
    }
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  a.href = url;
  a.download = `valdermoor-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────────────────

function init() {
  setupLoginTabs();
  setupLoginForm();
  setupRegisterForm();
  setupEmailCodeModal();
  setupModal();
  setupDiceButtons();
  setupInputForm();

  window.addEventListener('beforeunload', () => {
    currentAbortController?.abort();
    saveGame();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const help = document.getElementById('help-modal') as HTMLDivElement | null;
      if (help && !help.hidden) { help.hidden = true; e.preventDefault(); return; }
      const emailModal = document.getElementById('email-code-modal') as HTMLDivElement | null;
      if (emailModal && !emailModal.hidden) {
        emailModal.hidden = true;
        pendingAction = null;
        pendingCode = null;
        e.preventDefault();
        return;
      }
    }
    if (e.key === '?' && !isTypingTarget(e.target)) {
      const help = document.getElementById('help-modal') as HTMLDivElement | null;
      const app = document.getElementById('app') as HTMLElement | null;
      if (help && app && !app.hidden) {
        help.hidden = false;
        e.preventDefault();
      }
    }
  });

  const session = getSession();
  if (session && loadAccounts()[session.toLowerCase()]) {
    currentUser = session;
    hideLoginScreen();
    const save = loadGame();
    if (save) {
      resumeGame(save);
      void checkLmStudioStatus();
    } else {
      showCharModal();
    }
  } else {
    showLoginScreen();
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

document.addEventListener('DOMContentLoaded', init);
