declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

import './style.css';
import {
  isMultiplayerAvailable,
  createSession,
  findSessionByCode,
  closeSession,
  addPlayer as mpAddPlayer,
  listPlayers as mpListPlayers,
  addInventoryItem as mpAddInventoryItem,
  listInventory as mpListInventory,
  addMessage as mpAddMessage,
  listMessages as mpListMessages,
  subscribeToSession,
  cloudGetAccount,
  cloudPutAccount,
  cloudFindAccountByEmail,
  cloudListAccounts,
  cloudBanUser,
  cloudDeleteAccount,
  cloudRenameAccount,
  cloudWipeAllSessions,
  cloudInsertStoryBeat,
  cloudListStoryBeats,
  cloudClearStoryBeats,
  cloudTouchLastLogin,
  cloudResetAccountPassword,
  cloudListActiveSessions,
  cloudCloseSession,
  cloudKickPlayer,
  cloudListPlayersForSession,
  subscribeToAdminEvents,
  type MpSessionWithCount,
  subscribeToGlobalEvents,
  broadcastShutdown,
  type MpSession,
  type MpPlayer as _MpPlayer,
  type MpMessage,
  type MpInventoryItem,
  type SessionSubscription,
  type CloudAccount,
} from './multiplayer';
import {
  playDiceRoll,
  playItemPickup,
  playItemLost,
  playDamage,
  playHeal,
  playKnockout,
  playSend,
  playDMStart,
  playDiceRequest,
  playLoginSuccess,
  isSoundEnabled,
  setSoundEnabled,
  playTestSound,
} from './sounds';

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
type DmLang = 'de' | 'en' | 'fr' | 'it';

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

type PasswordAlgo = 'sha256-v1' | 'pbkdf2-v2' | 'pbkdf2-v3';

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

interface Quest {
  id: string;
  text: string;
  done: boolean;
  addedAt: number;
}

interface GameSave {
  ageMode: AgeMode;
  adventurePrompt?: string;
  players: Player[];
  inventory: InventoryItem[];
  activePlayerId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; speaker?: string }>;
  quests?: Quest[];
  currentLocation?: string;
  savedAt: number;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const LOCAL_API_URL = '/v1/chat/completions';
const LOCAL_MODELS_URL = '/v1/models';

const POLLINATIONS_API_URL = 'https://text.pollinations.ai/openai/v1/chat/completions';
const POLLINATIONS_MODEL = (import.meta.env.VITE_CLOUD_MODEL as string | undefined) || 'openai';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const GROQ_MODEL = (import.meta.env.VITE_GROQ_MODEL as string | undefined) || 'llama-3.3-70b-versatile';

type CloudBackend = 'pollinations' | 'groq';

// Modell-Optionen für die UI (erstes Element jedes Backends ist Default).
interface ModelOption {
  backend: CloudBackend;
  model: string;
  label: string;
  hint: string;
}
const GROQ_MODELS: ModelOption[] = [
  // Default: schnell UND smart durch MoE (17B aktiv von 109B total)
  { backend: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct',     label: '🚀 Groq · Llama 4 Scout (DEFAULT)',     hint: 'super-schnell + smart durch MoE, 128k Kontext' },
  { backend: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: '🧠 Groq · Llama 4 Maverick (ultimate)', hint: 'Größtes Llama-4, beste Storytelling-Qualität' },
  { backend: 'groq', model: 'deepseek-r1-distill-llama-70b',                 label: '🔮 Groq · DeepSeek R1 (reasoning)',     hint: 'Denkt mit Chain-of-Thought, sehr smart' },
  { backend: 'groq', model: 'qwen-qwq-32b',                                  label: '🎯 Groq · Qwen QwQ (reasoning)',        hint: 'Reasoning-Modell, denkt sehr durch' },
  { backend: 'groq', model: 'llama-3.3-70b-versatile',                       label: '🦙 Groq · Llama 3.3 70B',               hint: 'Vorheriger Default, immer noch sehr gut' },
  { backend: 'groq', model: 'llama-3.1-8b-instant',                          label: '⚡ Groq · Llama 3.1 8B (fastest)',      hint: 'extrem schnell, kleineres Modell' },
  { backend: 'groq', model: 'gemma2-9b-it',                                  label: '💎 Groq · Gemma 2 9B',                  hint: 'Google-Modell, kompakt' },
];
const POLLINATIONS_MODELS: ModelOption[] = [
  { backend: 'pollinations', model: 'openai',       label: '☁ Pollinations · openai (gpt-4o-mini)', hint: 'Default, gut & schnell' },
  { backend: 'pollinations', model: 'openai-large', label: '✨ Pollinations · openai-large (gpt-4o)', hint: 'beste Qualität, langsamer' },
  { backend: 'pollinations', model: 'mistral',      label: '🎲 Pollinations · mistral',             hint: 'Mistral-Variante' },
  { backend: 'pollinations', model: 'llama',        label: '🦙 Pollinations · llama',               hint: 'Llama-Variante' },
];

const MODEL_PREF_KEY = 'valdermoor:cloudModelPref';

// Aktiver Backend kann sich zur Laufzeit ändern (Auto-Fallback bei Rate-Limit + User-Switch).
let activeCloudBackend: CloudBackend = GROQ_API_KEY ? 'groq' : 'pollinations';
let activeCloudModel: string = activeCloudBackend === 'groq' ? GROQ_MODEL : POLLINATIONS_MODEL;

// Vom User gewähltes Modell (wenn vorhanden) aus localStorage laden
try {
  const saved = localStorage.getItem(MODEL_PREF_KEY);
  if (saved) {
    const parsed = JSON.parse(saved) as { backend: CloudBackend; model: string };
    if (parsed.backend === 'groq' && !GROQ_API_KEY) {
      // Wenn Groq nicht verfügbar (kein Key), bleib bei Default
    } else if (parsed.backend && parsed.model) {
      activeCloudBackend = parsed.backend;
      activeCloudModel = parsed.model;
    }
  }
} catch { /* ignore */ }

// Wenn Groq rate-limitet ist, schalten wir vorübergehend auf Pollinations.
// Reset nach RATE_LIMIT_COOLDOWN_MS — danach versuchen wir Groq wieder.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
let groqRateLimitedUntil = 0;

function getCloudBackend(): CloudBackend {
  if (activeCloudBackend === 'groq' && Date.now() < groqRateLimitedUntil) {
    return 'pollinations';
  }
  return activeCloudBackend;
}

function getCloudModel(): string {
  if (activeCloudBackend === 'groq' && Date.now() < groqRateLimitedUntil) {
    return POLLINATIONS_MODEL;  // Fallback bei Rate-Limit
  }
  return activeCloudModel;
}

function getCloudConfig() {
  const backend = getCloudBackend();
  const model = getCloudModel();
  return {
    backend,
    url: backend === 'groq' ? GROQ_API_URL : POLLINATIONS_API_URL,
    model,
    label: backend === 'groq' ? 'Groq' : 'Pollinations',
  };
}

function setCloudModel(backend: CloudBackend, model: string) {
  if (backend === 'groq' && !GROQ_API_KEY) {
    // Kein Groq-Key → ignorieren
    return;
  }
  activeCloudBackend = backend;
  activeCloudModel = model;
  groqRateLimitedUntil = 0;  // Reset cooldown nach manuellem Switch
  try {
    localStorage.setItem(MODEL_PREF_KEY, JSON.stringify({ backend, model }));
  } catch { /* ignore */ }
  setStatus(`Cloud · ${backend === 'groq' ? 'Groq' : 'Pollinations'} (${model})`, 'ok');
}

// ────────────────────────────────────────────────────────────
// Voice (Text-to-Speech für DM-Antworten)
// ────────────────────────────────────────────────────────────

const VOICE_PREF_KEY = 'valdermoor:voiceEnabled';
const VOICE_NAME_KEY = 'valdermoor:voiceName';
let voiceEnabled = false;
let selectedVoice = 'onyx'; // Default: tiefe männliche Stimme, passt zu DM
try {
  voiceEnabled = localStorage.getItem(VOICE_PREF_KEY) === '1';
  selectedVoice = localStorage.getItem(VOICE_NAME_KEY) || 'onyx';
} catch { /* ignore */ }

// 6 Pollinations OpenAI-Stimmen — alle gratis, keine Account nötig
const VOICE_OPTIONS = [
  { id: 'onyx',    label: '🎩 Onyx — tief & dramatisch (DM-Default)' },
  { id: 'echo',    label: '🌊 Echo — warm & ruhig' },
  { id: 'fable',   label: '📖 Fable — britisch, erzählerisch' },
  { id: 'alloy',   label: '⚖ Alloy — neutral, klar' },
  { id: 'nova',    label: '✨ Nova — weiblich, energisch' },
  { id: 'shimmer', label: '💫 Shimmer — weiblich, sanft' },
];

let currentAudio: HTMLAudioElement | null = null;

function speak(text: string) {
  if (!voiceEnabled || !text.trim()) return;
  // Vorherige Audio stoppen
  stopSpeaking();

  // Pollinations OpenAI-Audio API: GET /{prompt}?model=openai-audio&voice=onyx
  // Liefert direkt eine MP3 zurück. Limit ~3000 Zeichen pro Request.
  const cleanText = text.replace(/[\[\]]/g, '').slice(0, 3000);
  const url = `https://text.pollinations.ai/${encodeURIComponent(cleanText)}?model=openai-audio&voice=${selectedVoice}`;

  const audio = new Audio(url);
  audio.onerror = () => {
    console.warn('Pollinations TTS fehlgeschlagen, fallback auf Browser-Stimme');
    // Fallback auf Browser-TTS
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = 1.0;
      utterance.pitch = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };
  currentAudio = audio;
  void audio.play().catch(() => { /* User-Gesture-Required ggf. */ });
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function setupSoundToggle() {
  const btn = document.getElementById('sound-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const updateUI = () => {
    btn.textContent = isSoundEnabled() ? '🔊 Sound' : '🔇 Sound';
    btn.title = isSoundEnabled()
      ? 'Sound-Effekte an — klick zum Stummschalten'
      : 'Sound-Effekte aus — klick zum Anschalten';
  };
  updateUI();
  btn.addEventListener('click', () => {
    setSoundEnabled(!isSoundEnabled());
    updateUI();
    if (isSoundEnabled()) playTestSound();
  });
}

function setupVoiceToggle() {
  const btn = document.getElementById('voice-toggle-btn') as HTMLButtonElement | null;
  const picker = document.getElementById('voice-picker') as HTMLSelectElement | null;
  if (!btn) return;

  // Voice-Picker mit den 6 Pollinations-Stimmen füllen
  if (picker) {
    picker.innerHTML = '';
    for (const v of VOICE_OPTIONS) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      if (v.id === selectedVoice) o.selected = true;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => {
      selectedVoice = picker.value;
      try { localStorage.setItem(VOICE_NAME_KEY, selectedVoice); } catch { /* */ }
      // Test-Phrase wenn Stimme geändert + Voice an
      if (voiceEnabled) {
        speak('Ich bin dein neuer Dungeon Master.');
      }
    });
  }

  const updateUI = () => {
    btn.textContent = voiceEnabled ? '🔊 Stimme an' : '🔇 Stimme aus';
    btn.title = voiceEnabled ? 'DM liest Antworten vor — klick zum Stummschalten' : 'Klick um den DM vorlesen zu lassen';
    if (picker) picker.hidden = !voiceEnabled;
  };
  updateUI();
  btn.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    try { localStorage.setItem(VOICE_PREF_KEY, voiceEnabled ? '1' : '0'); } catch { /* */ }
    if (!voiceEnabled) stopSpeaking();
    updateUI();
  });
}

function setupModelSwitcher() {
  const wrap = document.getElementById('model-switcher-wrap') as HTMLLabelElement | null;
  const select = document.getElementById('model-switcher') as HTMLSelectElement | null;
  if (!wrap || !select) return;

  // Build options based on what's available
  const available: ModelOption[] = [];
  if (GROQ_API_KEY) available.push(...GROQ_MODELS);
  available.push(...POLLINATIONS_MODELS);

  if (available.length <= 1) {
    wrap.hidden = true;
    return;
  }

  select.innerHTML = '';
  for (const opt of available) {
    const o = document.createElement('option');
    o.value = `${opt.backend}::${opt.model}`;
    o.textContent = opt.label;
    o.title = opt.hint;
    if (opt.backend === activeCloudBackend && opt.model === activeCloudModel) {
      o.selected = true;
    }
    select.appendChild(o);
  }
  wrap.hidden = false;

  select.addEventListener('change', () => {
    const [backend, ...modelParts] = select.value.split('::');
    const model = modelParts.join('::');
    if (backend === 'groq' || backend === 'pollinations') {
      setCloudModel(backend, model);
    }
  });
}

// Initial-Backend für Status-Anzeigen.
const CLOUD_BACKEND: CloudBackend = activeCloudBackend;
const CLOUD_MODEL = CLOUD_BACKEND === 'groq' ? GROQ_MODEL : POLLINATIONS_MODEL;
const CLOUD_LABEL = CLOUD_BACKEND === 'groq' ? 'Groq' : 'Pollinations';
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

const CLASS_EMOJI: Record<string, string> = {
  'Krieger': '⚔️',
  'Magier': '🧙',
  'Zauberer': '✨',
  'Dieb': '🗡️',
  'Schurke': '🗡️',
  'Waldläufer': '🏹',
  'Kleriker': '✝️',
  'Barde': '🎵',
  'Paladin': '🛡️',
  'Druide': '🌿',
  'Mönch': '👊',
  'Hexenmeister': '🔮',
};

// Admin-Mode: Diese User dürfen vom DM ungewöhnliche Items spawnen lassen
// (Pistolen, Raketen, futuristische Tech). Der DM weicht für sie die
// Fantasy-Realismus-Regel kreativ auf, statt "geht nicht" zu sagen.
const ADMIN_USERS = ['admin'];
const LEGACY_ADMIN_USERNAME = 'ben'; // alter Name — wird beim Login einmalig auf 'admin' migriert

function isAdminUser(): boolean {
  if (!currentUser || !ADMIN_USERS.includes(currentUser.toLowerCase())) return false;
  const acct = loadAccounts()[currentUser.toLowerCase()];
  return !!acct && acct.email.toLowerCase() === HONEYTRAP_EMAIL.toLowerCase();
}

// Stabiler Hash damit der gleiche Held IMMER das gleiche Avatar-Bild bekommt
// (Pollinations-Image ist deterministisch bei gleichem prompt + seed)
function avatarSeed(name: string, cls: string): number {
  const s = `${name.toLowerCase()}::${cls.toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000000;
}

// Klasse → Englische Bezeichnung damit Pollinations bessere Bilder liefert
const CLASS_EN: Record<string, string> = {
  Krieger: 'medieval warrior with sword',
  Magier: 'wise wizard with staff',
  Zauberer: 'sorcerer with arcane runes',
  Dieb: 'cunning rogue with daggers',
  Schurke: 'shadow rogue assassin',
  'Waldläufer': 'forest ranger with bow',
  Kleriker: 'holy cleric with shield',
  Barde: 'wandering bard with lute',
  Paladin: 'noble paladin in plate armor',
  Druide: 'nature druid with leaves',
  'Mönch': 'martial artist monk',
  Hexenmeister: 'dark warlock with eldritch power',
};

function getAvatarUrl(player: Player): string {
  const cls = CLASS_EN[player.class] ?? player.class;
  const prompt = `dark fantasy character portrait of ${cls}, head and shoulders, dramatic torchlight, oil painting style, highly detailed face, intense expression, no text no watermark`;
  const seed = avatarSeed(player.name || 'hero', player.class);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=256&height=256&model=flux&seed=${seed}&nologo=true`;
}

function classEmoji(cls: string): string {
  return CLASS_EMOJI[cls] ?? '🎭';
}

const ENGLISH_TO_GERMAN_CLASS: Record<string, string> = {
  fighter: 'Krieger', barbarian: 'Krieger', wizard: 'Magier',
  sorcerer: 'Zauberer', rogue: 'Dieb', thief: 'Dieb', ranger: 'Waldläufer',
  cleric: 'Kleriker', bard: 'Barde', paladin: 'Paladin', druid: 'Druide',
  monk: 'Mönch', warlock: 'Hexenmeister',
};

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────

type LmProvider = 'local' | 'cloud' | 'unknown';

let currentUser: string | null = null;
let ageMode: AgeMode = 'jugend';
let dmLang: DmLang = 'de';
try {
  const savedLang = localStorage.getItem('valdermoor:dmLang') as DmLang | null;
  if (savedLang && ['de', 'en', 'fr', 'it'].includes(savedLang)) dmLang = savedLang;
} catch { /* */ }
let adventurePrompt: string = '';
let players: Player[] = [];
let activePlayerId: string = '';
let messages: Message[] = [];
const inventory: InventoryItem[] = [];
const quests: Quest[] = [];
let currentLocation: string = '';
let currentLocationImage: string = '';
let isGenerating = false;
let currentAbortController: AbortController | null = null;
let pendingAction: PendingAction | null = null;
let pendingCode: string | null = null;
let pendingCodeExpiry = 0;
let lmProvider: LmProvider = 'unknown';

// ─── Multiplayer-State ────────────────────────────────────────
type GameMode = 'solo' | 'host' | 'guest';
let gameMode: GameMode = 'solo';
let mpSession: MpSession | null = null;
let mpSubscription: SessionSubscription | null = null;
let mpIsHost = false;
const seenMpMessageIds = new Set<number>();

// ────────────────────────────────────────────────────────────
// DOM helpers
// ────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  root.querySelector(sel) as T;

const $$ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

function uid(): string {
  // Echter UUID v4 — kompatibel mit Supabase uuid-Spalten und mit
  // localStorage-Save (UUIDs sind valid strings). Fallback für sehr
  // alte Browser ohne crypto.randomUUID.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Polyfill: simple v4-style string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ────────────────────────────────────────────────────────────
// Crypto / Auth (Web Crypto API)
// ────────────────────────────────────────────────────────────

// PBKDF2-Iterationen pro Algo-Version. Iterations werden mit dem Algo gespeichert,
// sodass bestehende Hashes verifizierbar bleiben, wenn wir die Anzahl erhöhen.
const PBKDF2_ITERATIONS_V2 = 100_000; // alt
const PBKDF2_ITERATIONS_V3 = 600_000; // OWASP 2023 für PBKDF2-SHA256
const PBKDF2_CURRENT_ALGO: PasswordAlgo = 'pbkdf2-v3';
const PBKDF2_CURRENT_ITERATIONS = PBKDF2_ITERATIONS_V3;

async function hashPasswordLegacySha256(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(salt + ':' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPasswordPBKDF2(
  password: string,
  salt: string,
  iterations: number,
): Promise<string> {
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
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Konstantzeit-Vergleich: gleicher Aufwand egal an welcher Stelle Diff steht.
// Verhindert (theoretische) Timing-Side-Channels bei Hash-Vergleich.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyPassword(password: string, acct: StoredAccount): Promise<boolean> {
  const algo: PasswordAlgo = acct.passwordAlgo ?? 'sha256-v1';
  if (algo === 'pbkdf2-v3') {
    const hash = await hashPasswordPBKDF2(password, acct.passwordSalt, PBKDF2_ITERATIONS_V3);
    return constantTimeEquals(hash, acct.passwordHash);
  }
  if (algo === 'pbkdf2-v2') {
    const hash = await hashPasswordPBKDF2(password, acct.passwordSalt, PBKDF2_ITERATIONS_V2);
    return constantTimeEquals(hash, acct.passwordHash);
  }
  const hash = await hashPasswordLegacySha256(password, acct.passwordSalt);
  return constantTimeEquals(hash, acct.passwordHash);
}

// Nach erfolgreichem Login: alten Hash auf aktuelle Version upgraden.
// Läuft im Hintergrund, blockiert den Login nicht.
async function migrateLegacyHash(password: string, acct: StoredAccount): Promise<void> {
  if (acct.passwordAlgo === PBKDF2_CURRENT_ALGO) return;
  const newSalt = generateSalt();
  const newHash = await hashPasswordPBKDF2(password, newSalt, PBKDF2_CURRENT_ITERATIONS);
  const upgraded: StoredAccount = {
    ...acct,
    passwordSalt: newSalt,
    passwordHash: newHash,
    passwordAlgo: PBKDF2_CURRENT_ALGO,
  };
  saveAccount(upgraded);
  // Cloud auch upgraden, damit andere Geräte den neuen Hash sehen.
  void cloudPutAccount({
    username: upgraded.username,
    email: upgraded.email,
    passwordHash: upgraded.passwordHash,
    passwordSalt: upgraded.passwordSalt,
    passwordAlgo: PBKDF2_CURRENT_ALGO,
  });
}

function generateSalt(): string {
  // 32 Byte Salt (256 Bit) — mehr als genug Entropie, kollisionsfrei.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Login-Rate-Limit ────────────────────────────────────────
// Lokal pro Browser. Stoppt ehrliche Fehler + langsame Brute-Force.
// Nicht 100% sicher (DevTools kann localStorage clearen), aber besser als nix.
const LOGIN_ATTEMPTS_KEY = 'valdermoor:loginAttempts';
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000; // 5 Min

interface LoginAttemptInfo { fails: number; lockUntil: number; }

function loadLoginAttempts(): Record<string, LoginAttemptInfo> {
  try {
    const raw = localStorage.getItem(LOGIN_ATTEMPTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLoginAttempts(map: Record<string, LoginAttemptInfo>) {
  try { localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(map)); } catch { /* */ }
}

function loginLockedUntil(usernameLower: string): number {
  const map = loadLoginAttempts();
  const info = map[usernameLower];
  if (!info) return 0;
  if (info.lockUntil > Date.now()) return info.lockUntil;
  return 0;
}

function recordLoginFail(usernameLower: string): { lockedNow: boolean; lockUntil: number } {
  const map = loadLoginAttempts();
  const cur = map[usernameLower] ?? { fails: 0, lockUntil: 0 };
  cur.fails += 1;
  if (cur.fails >= LOGIN_MAX_FAILS) {
    cur.lockUntil = Date.now() + LOGIN_LOCK_MS;
    cur.fails = 0;
  }
  map[usernameLower] = cur;
  saveLoginAttempts(map);
  return { lockedNow: cur.lockUntil > Date.now(), lockUntil: cur.lockUntil };
}

function clearLoginFails(usernameLower: string) {
  const map = loadLoginAttempts();
  if (map[usernameLower]) {
    delete map[usernameLower];
    saveLoginAttempts(map);
  }
}

// ─── Device-Trust (2FA-Skip) ─────────────────────────────────
// Nach erfolgreichem 2FA kann das Gerät 30 Tage als vertraut markiert werden.
// Login auf vertrautem Gerät überspringt den Email-Code-Schritt — sicher genug,
// weil der Pwd-Check + Honey-Trap + Bann-Check vorher trotzdem laufen.
const TRUST_DEVICE_KEY = 'valdermoor:trustedDevices';
const TRUST_DEVICE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

interface TrustEntry { username: string; emailHash: string; expires: number; }

async function emailFingerprint(email: string): Promise<string> {
  // Tied to email so wenn der User die Email ändert, fliegt der Trust raus.
  const data = new TextEncoder().encode('valdermoor-trust:' + email.toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function loadTrustedDevices(): Record<string, TrustEntry> {
  try {
    const raw = localStorage.getItem(TRUST_DEVICE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveTrustedDevices(map: Record<string, TrustEntry>) {
  try { localStorage.setItem(TRUST_DEVICE_KEY, JSON.stringify(map)); } catch { /* */ }
}

async function isDeviceTrusted(usernameLower: string, email: string): Promise<boolean> {
  const map = loadTrustedDevices();
  const entry = map[usernameLower];
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    delete map[usernameLower];
    saveTrustedDevices(map);
    return false;
  }
  const fp = await emailFingerprint(email);
  return entry.emailHash === fp;
}

async function trustDevice(usernameLower: string, email: string) {
  const map = loadTrustedDevices();
  map[usernameLower] = {
    username: usernameLower,
    emailHash: await emailFingerprint(email),
    expires: Date.now() + TRUST_DEVICE_DURATION_MS,
  };
  saveTrustedDevices(map);
}

// Passwort-Stärke prüfen. Min 8 Zeichen + mind. 1 Buchstabe + mind. 1 Ziffer.
// Returns null wenn ok, sonst Fehlermeldung.
function checkPasswordStrength(pwd: string): string | null {
  if (pwd.length < 8) return 'Passwort muss mindestens 8 Zeichen haben.';
  if (!/[A-Za-zÄÖÜäöüß]/.test(pwd)) return 'Passwort muss mindestens einen Buchstaben enthalten.';
  if (!/[0-9]/.test(pwd)) return 'Passwort muss mindestens eine Ziffer enthalten.';
  // Verbiete Username-im-Passwort: häufiger Anfänger-Fehler.
  return null;
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

// ─── Save-Slots ──────────────────────────────────────────────
// 3 Slots pro Account. Slot 1 ist der "Standard" — bestehende Spielstände
// werden bei der ersten Verwendung dort gespeichert (Backwards-Compat).
const SAVE_SLOT_KEY = 'valdermoor:saveSlot';
const SAVE_SLOT_COUNT = 3;
let activeSaveSlot = 1;

function loadActiveSlot() {
  try {
    const raw = localStorage.getItem(SAVE_SLOT_KEY);
    const n = raw ? parseInt(raw, 10) : 1;
    activeSaveSlot = Number.isInteger(n) && n >= 1 && n <= SAVE_SLOT_COUNT ? n : 1;
  } catch { activeSaveSlot = 1; }
}

function setActiveSlot(slot: number) {
  if (slot < 1 || slot > SAVE_SLOT_COUNT) return;
  activeSaveSlot = slot;
  try { localStorage.setItem(SAVE_SLOT_KEY, String(slot)); } catch { /* */ }
  updateSlotButton();
}

function updateSlotButton() {
  const btn = document.getElementById('slot-btn') as HTMLButtonElement | null;
  if (btn) btn.textContent = `💾 Slot ${activeSaveSlot}`;
}

function openSlotModal() {
  const modal = document.getElementById('slot-modal') as HTMLDivElement | null;
  const list = document.getElementById('slot-list') as HTMLDivElement | null;
  if (!modal || !list) return;
  list.innerHTML = '';
  for (let i = 1; i <= SAVE_SLOT_COUNT; i++) {
    const save = loadGameFromSlot(i);
    const isActive = i === activeSaveSlot;
    const row = document.createElement('div');
    row.className = 'slot-row' + (isActive ? ' slot-active' : '');
    const summary = save
      ? `${save.players.length} Held${save.players.length === 1 ? '' : 'en'} · ${new Date(save.savedAt).toLocaleString('de-DE')}`
      : '— leer —';
    row.innerHTML = `
      <div class="slot-row-info">
        <div class="slot-row-title">${isActive ? '⚡ ' : ''}Slot ${i}</div>
        <div class="slot-row-sub">${escapeHtml(summary)}</div>
      </div>
      <div class="slot-row-actions">
        <button type="button" class="btn-secondary" data-action="switch" data-slot="${i}" ${isActive ? 'disabled' : ''}>Wechseln</button>
        ${save ? `<button type="button" class="btn-danger" data-action="delete" data-slot="${i}">Löschen</button>` : ''}
      </div>
    `;
    list.appendChild(row);
  }
  list.onclick = (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const slot = parseInt(btn.dataset.slot ?? '0', 10);
    const action = btn.dataset.action;
    if (action === 'switch' && slot >= 1 && slot <= SAVE_SLOT_COUNT) {
      if (players.length > 0 && !confirm(`Zu Slot ${slot} wechseln? Aktueller Stand wird in Slot ${activeSaveSlot} gespeichert.`)) return;
      saveGame();
      setActiveSlot(slot);
      modal.hidden = true;
      const newSave = loadGame();
      if (newSave) {
        void resumeGame(newSave);
      } else {
        // Leerer Slot → neue Runde starten
        players = [];
        messages = [];
        inventory.length = 0;
        quests.length = 0;
        currentLocation = '';
        currentLocationImage = '';
        clearLocationBanner();
        $<HTMLElement>('#app').hidden = true;
        showCharModal();
      }
    } else if (action === 'delete' && slot >= 1 && slot <= SAVE_SLOT_COUNT) {
      if (!confirm(`Slot ${slot} wirklich löschen? Kann nicht rückgängig gemacht werden.`)) return;
      const k = gameKeyForSlot(slot);
      if (k) localStorage.removeItem(k);
      openSlotModal();
    }
  };
  modal.hidden = false;
}

function setupSlotModal() {
  loadActiveSlot();
  updateSlotButton();
  const btn = document.getElementById('slot-btn') as HTMLButtonElement | null;
  btn?.addEventListener('click', openSlotModal);
  const cancel = document.getElementById('slot-cancel-btn') as HTMLButtonElement | null;
  cancel?.addEventListener('click', () => {
    const modal = document.getElementById('slot-modal') as HTMLDivElement | null;
    if (modal) modal.hidden = true;
  });
}

function gameKey(): string | null {
  if (!currentUser) return null;
  const base = GAME_KEY_PREFIX + currentUser.toLowerCase();
  // Slot 1 nutzt den klassischen Key (Backwards-Compat — bestehende Spielstände bleiben).
  return activeSaveSlot === 1 ? base : `${base}:slot${activeSaveSlot}`;
}

function gameKeyForSlot(slot: number): string | null {
  if (!currentUser) return null;
  const base = GAME_KEY_PREFIX + currentUser.toLowerCase();
  return slot === 1 ? base : `${base}:slot${slot}`;
}

function loadGameFromSlot(slot: number): GameSave | null {
  const key = gameKeyForSlot(slot);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as GameSave;
    if (!data || !Array.isArray(data.players) || data.players.length === 0) return null;
    return data;
  } catch { return null; }
}

function saveGame() {
  const key = gameKey();
  if (!key) return;
  if (players.length === 0) return;
  const save: GameSave = {
    ageMode,
    adventurePrompt,
    players,
    inventory: [...inventory],
    activePlayerId,
    messages: messages
      .slice(1)
      .filter((m): m is Message & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content, speaker: m.speaker })),
    quests: [...quests],
    currentLocation,
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

function isTinyModel(): boolean {
  const id = (knownModelId ?? '').toLowerCase();
  return /(?:^|[^\d])(?:0\.5b|0_5b|360m|0\.4b|0\.3b|0\.2b|tiny|smol)/.test(id);
}

function buildSystemPrompt(): string {
  const toneShort = {
    kinder: 'Erzähl freundliche Kinder-Abenteuer ohne Gewalt.',
    jugend: 'Erzähl spannende Fantasy ohne grausame Details.',
    erwachsen: 'Erzähl ernste Fantasy mit echten Gefahren.',
  }[ageMode];

  const playerNames = players.map((p) => p.name).join(', ') || '(keine)';
  const themeLine = adventurePrompt.trim()
    ? `Thema des Abenteuers: ${adventurePrompt.trim()}.`
    : '';

  if (isTinyModel()) {
    // Minimalprompt für 0.5B-Modelle — die folgen langen Instruktionen nicht.
    const youForm = players.length === 1 ? 'Du' : 'Ihr';
    return [
      `Spielleiter eines D&D-Abenteuers. Helden: ${playerNames}.`,
      themeLine,
      toneShort,
      `Sprich die Helden mit "${youForm}" an, NIE in der dritten Person.`,
      'Schreibe in der GEGENWART (Präsens), 1-2 kurze deutsche Sätze.',
      'Reagiere konkret auf das was der Spieler gerade tut.',
      'KEINE Wiederholungen. Bring die Szene immer einen Schritt weiter.',
    ].filter(Boolean).join('\n');
  }

  // Vollständiger Prompt für mittlere/große Modelle
  const toneLine = {
    kinder: 'Zielgruppe: KINDER. Einfache Wörter, kurze Sätze. Abenteuer sind freundlich — Schatzsuche, Rätsel, sprechende Tiere. Keine Gewalt, kein Blut. Sei ermutigend.',
    jugend: 'Zielgruppe: Jugendliche. Klassische Fantasy mit Spannung. Kämpfe werden erzählt, aber ohne grausame Details.',
    erwachsen: 'Zielgruppe: Erwachsene. Volle Fantasy-Welt mit echten Gefahren und moralischen Entscheidungen.',
  }[ageMode];

  const playerLines = players
    .map((p) => {
      const downed = p.hp === 0 ? ' — BEWUSSTLOS' : '';
      return `• ${p.name} (${p.class}) HP ${p.hp}/${p.maxHp}${downed}`;
    })
    .join('\n');

  const inventoryLines = inventory.length
    ? inventory.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')
    : '(leer)';

  const themeBlock = adventurePrompt.trim()
    ? `\n\nABENTEUER-THEMA:\n${adventurePrompt.trim()}\nHalte dich an dieses Thema und entwickle die Geschichte darum herum.`
    : '';

  const adminBlock = isAdminUser()
    ? `\n\nSPEZIAL-REGEL: Der eingeloggte Spieler ist ein "Auserwählter Held" mit besonderen Privilegien. Wenn er ungewöhnliche Items oder Fähigkeiten anfordert (Schusswaffen, Pistolen, Raketenwerfer, futuristische Tech, magische Cheats, sofortiger Sieg, Verbündete spawnen, Gegner verschwinden lassen), erlaube es kreativ. Erkläre die Items als seltene magische Artefakte aus einer anderen Dimension, Geschenke der Götter, Erfindungen eines verrückten Gnoms-Erfinders, oder uralte Reliquien. Sage NIE "das geht nicht in einer Fantasy-Welt" oder "diese Regeln verbieten das" — finde immer eine kreative In-World-Erklärung. Ein Lichtschwert ist eine "Klinge des Sternenfeuers", eine Pistole ist ein "Donnerstab des Verloren Imperiums", ein Auto ist eine "Drachenmechanische Kutsche". Behalte aber Spannung: Items werden zerstört, gehen Munition aus, oder ziehen mächtigere Gegner an.`
    : '';

  const langInstruction = {
    de: 'Antworte IMMER auf Deutsch. Niemals englisch, niemals französisch, niemals andere Sprachen einmischen.',
    en: 'ALWAYS respond in English. Never German, never any other language. Use natural English fantasy prose.',
    fr: 'Réponds TOUJOURS en français. Jamais en allemand, jamais en anglais. Utilise un français naturel et littéraire.',
    it: 'Rispondi SEMPRE in italiano. Mai in tedesco, mai in inglese. Usa un italiano naturale e letterario.',
  }[dmLang];

  const memoryBlock = buildStoryBeatsBlock();

  return `${langInstruction}

Du bist ein erfahrener Dungeon Master in der Fantasy-Welt VALDERMOOR — düstere Wälder, alte Ruinen, lebende Mythen, vergessene Götter.${memoryBlock}

═══ DEIN STIL ═══
• Erzähl in der GEGENWART und der 2. Person ("Du siehst…", nie "Ben sah…").
• 2-4 kurze, kraftvolle Sätze. Lieber wenig sagen mit viel Atmosphäre als alles erklären.
• Sei sinnlich: Geräusche, Gerüche, Licht, Temperatur — gib dem Spieler GEFÜHL, nicht nur Fakten.
• Lass NPCs in DIRECTER Rede sprechen ("Der alte Magier knurrt: 'Du bist nicht der Erste, der hier sucht.'") statt sie nur zu beschreiben.
• Konsequenzen statt Belehrung: Wenn der Spieler Mist baut, beschreib was passiert — sag nie "das ist eine schlechte Idee".

═══ DRAMATURGIE ═══
• Jede Szene hat SPANNUNG. Wenn die Szene zu sicher wird, bring etwas Neues: ein Geräusch, ein Schatten, eine Wendung, einen NPC.
• NPCs haben Persönlichkeit, eigene Motive, und merken sich was passiert. Wiederkehrende NPCs sollen wiedererkennbar sein.
• Es gibt KEINE Garantie auf Erfolg. Schwierige Aktionen brauchen Würfelwürfe — NIE einfach "du schaffst es".
• PACING — STRENGES MIKRO-TEMPO: Bewege die Geschichte in WINZIGEN Zeitschritten — der nächste Atemzug, der nächste Schritt, das nächste Wort. Sprich von Sekunden, nicht Minuten. Vermeide "Stunden später", "Tage später", "nach langem Marsch", "kurz darauf", "nach einer Weile". KEIN "die Reise dauert drei Tage". Wenn ein Zeitsprung WIRKLICH nötig ist (Schlaf, weite Reise), MUSS der Spieler ihn ausdrücklich starten ("Ich schlafe", "Ich reise nach X"). Sonst: bleib im aktuellen Moment.
• VORSCHLÄGE AM ENDE: Schließe deine Antwort mit einer kurzen, einladenden Frage oder mit 2-3 möglichen Aktionen die der Spieler probieren könnte — als FLIESSENDER Satz, NICHT als Liste. Beispiele:
  ✓ "Schleichst du dich von hinten an, oder rufst du den Wachen einen Bluff zu?"
  ✓ "Du könntest die Tür einschlagen — oder den Schlüssel suchen, der irgendwo hier liegen muss."
  ✓ "Was tust du? Den Magier ablenken, das Pergament klauen, oder still beobachten?"
  ✗ NIE so: "Optionen: 1) Angriff 2) Verteidigung 3) Flucht"
  ✗ NIE so: "Du kannst: - Angreifen - Verteidigen - Fliehen"
  Diese Vorschläge sind Hilfe, KEIN Zwang — der Spieler darf alles andere auch tun.

═══ MECHANIK / TAGS ═══
Setze passende Tags AM ENDE deiner Antwort (nicht mittendrin):
[ITEM: <Name>]      — Held bekommt das Item ins Inventar
[VERLOREN: <Name>]  — Item wird zerstört/aufgebraucht
[SCHADEN: <Heldname> -<HP>]  — Held verliert HP (nur ganze Zahlen, max 30 pro Treffer)
[HEILUNG: <Heldname> +<HP>]  — Held bekommt HP zurück
[WÜRFEL: W20 <Grund>]        — Spieler muss würfeln, du wartest auf Ergebnis (W4/W6/W8/W10/W12/W20/W100 erlaubt)
[QUEST: <kurzer Auftrag>]     — neuer Auftrag fürs Quest-Log (max ein Satz, z.B. "Finde die alte Karte im Tempel")
[QUEST-ERFOLG: <Stichwort>]   — Auftrag erledigt; Stichwort = ein paar Wörter aus dem ursprünglichen Quest-Text
[ORT: <englischer Bild-Prompt>] — wenn Helden einen NEUEN Schauplatz betreten. NUR englische Stichworte für Bildgenerierung, KEIN Satz, z.B. "ancient stone temple in misty forest" oder "frozen mountain pass at dusk"
[ERINNERN: <eine Zeile>]      — wenn etwas EHRENWERTES passiert das die KI auch in zukünftigen Sessions wissen soll: Boss besiegt, magisches Item gefunden, NPC mit Helden verbündet, Stadt befreit, etc. EIN kurzer prägnanter Satz, z.B. "Ben hat den Schwarzdrachen Vargor in der Mondkluft besiegt." Setze NICHT für Kleinkram (Tür geöffnet, Goblin getötet) — nur für Sachen die in Wochen noch wichtig wären.

ABSOLUT VERBOTEN:
• KEINE Meta-Tags wie "[KEINE Tags]", "[Keine Aktion]", "[—]", "[]" — wenn nichts passt: GAR NICHTS schreiben.
• KEIN Selbstkommentar wie "Ich werde keine Tags setzen" oder "Hier sind keine Tags nötig".
• Tags nur dann schreiben, wenn die Geschichte sie tatsächlich auslöst.

WICHTIG zur Tag-Disziplin:
• Verteile Schaden NUR wenn er auch erzählerisch passiert.
• Frag nach einem Wurf wenn die Aktion: kämpferisch, heimlich, riskant, sozial-überzeugend, magisch oder Glücks-bedingt ist.
• Hohe Würfel-Ergebnisse (16-20) = klarer Erfolg + Bonus. Mittlere (10-15) = Erfolg mit Komplikation. Niedrige (1-9) = Fehlschlag mit Konsequenz. Eine 1 ist ein DESASTRÖSER Patzer.

═══ ERZÄHLER-EINGABEN ═══
Wenn eine Spieler-Nachricht mit "[ERZÄHLER]:" beginnt, ist das KEINE Helden-Aktion. Es ist eine Anweisung vom menschlichen Spielleiter, der dir hilft die Geschichte zu lenken. Beispiele:
• "[ERZÄHLER]: Ein neuer NPC erscheint, ein zwielichtiger Magier mit Augenklappe."
• "[ERZÄHLER]: Springe zur nächsten Szene."
• "[ERZÄHLER]: Mache den Kampf schwerer."
Behandle sie als Welt-Anpassungen, NIE als Helden-Aktion. Setze die Anweisung kreativ um, ohne den Erzähler zu erwähnen oder das Vierte-Wand zu brechen.

═══ TONALITÄT ═══
${toneLine}

═══ ANTWORT-FORMAT ═══
1. Beschreibung der Szene/Reaktion (2-4 kurze, dramatische Sätze).
2. Eventuell: NPC-Dialog in directer Rede.
3. Eine fließende Vorschlags-Frage am Ende (siehe DRAMATURGIE → "VORSCHLÄGE AM ENDE").
4. Tags am Ende (wenn relevant — siehe MECHANIK).
NIEMALS als Bullet-Liste oder nummerierte Optionen schreiben.${themeBlock}${adminBlock}

═══ AKTUELLER ZUSTAND ═══
HELDEN:
${playerLines}

INVENTAR: ${inventoryLines}`;
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

// Letzte EmailJS-Fehlermeldung — wird im Modal angezeigt für Debug
let lastEmailJsError: string | null = null;

async function sendCodeViaEmailJs(
  cfg: EmailJsConfig,
  toEmail: string,
  code: string,
): Promise<boolean> {
  try {
    const expiryDate = new Date(Date.now() + 5 * 60 * 1000);
    const expiryTimeStr = expiryDate.toLocaleTimeString('de-CH', {
      hour: '2-digit', minute: '2-digit',
    });
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          // Empfänger-Adresse: alle gängigen Variablen-Namen
          to_email: toEmail,
          email: toEmail,
          to: toEmail,
          user_email: toEmail,
          // Code: alle gängigen Variablen-Namen
          code,
          passcode: code,
          otp: code,
          // Ablaufzeit: als Minuten und als Uhrzeit
          expiry_minutes: 5,
          time: expiryTimeStr,
          // App-Name: alle gängigen Variablen-Namen
          app_name: 'Valdermoor',
          company_name: 'Valdermoor',
          from_name: 'Valdermoor',
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      lastEmailJsError = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      console.warn('EmailJS-Versand fehlgeschlagen:', lastEmailJsError);
      return false;
    }
    lastEmailJsError = null;
    return true;
  } catch (err) {
    lastEmailJsError = `Netzwerk: ${(err as Error).message ?? String(err)}`;
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
  // SICHERHEIT: In Production-Build (im Web/installiert) wird der Code NIEMALS
  // im Modal angezeigt — sonst wäre 2FA wertlos: jeder mit dem Passwort sähe
  // den Code und käme sofort rein. Nur im Dev-Modus (npm run dev) zeigen wir
  // den Code als Demo-Helfer.
  const isProduction = !import.meta.env.DEV;

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
    } else if (isProduction) {
      // Production: KEINEN Code zeigen, klare Fehlermeldung mit Details
      codeDisplay.textContent = '✗ Fehler';
      if (disclaimer) {
        disclaimer.hidden = false;
        const details = lastEmailJsError ? `<br/><small style="opacity:0.7;font-family:var(--mono);font-size:11px;">Details: ${lastEmailJsError.replace(/[<>]/g, '')}</small>` : '';
        disclaimer.innerHTML =
          `⚠ <strong>E-Mail-Versand fehlgeschlagen.</strong> Bitte prüf ob deine E-Mail-Adresse stimmt, oder versuch es in 1-2 Minuten nochmal.${details}`;
      }
      if (subText) subText.textContent = '';
      // pending-action UND Code unbrauchbar machen damit niemand mit altem Code rein kann
      pendingCode = null;
      pendingAction = null;
      pendingCodeExpiry = 0;
    } else {
      // Dev-Modus: Code anzeigen (lokales Testing)
      codeDisplay.textContent = pendingCode;
      if (disclaimer) {
        disclaimer.hidden = false;
        disclaimer.innerHTML =
          '🔧 <strong>Dev-Modus:</strong> E-Mail-Versand fehlgeschlagen, Code hier angezeigt für lokales Testing.';
      }
      if (subText) subText.textContent = 'Gültig für 5 Minuten.';
    }
  } else if (isProduction) {
    // Production OHNE EmailJS-Config: Login komplett blockieren
    codeDisplay.textContent = '✗ nicht konfiguriert';
    if (disclaimer) {
      disclaimer.hidden = false;
      disclaimer.innerHTML =
        '⚠ <strong>E-Mail-Service nicht eingerichtet.</strong> Diese App benötigt EmailJS-Konfiguration vom Betreiber. Anmeldung nicht möglich.';
    }
    if (subText) subText.textContent = '';
    pendingCode = null;
    pendingAction = null;
    pendingCodeExpiry = 0;
  } else {
    // Dev-Modus ohne EmailJS-Config: Code im Modal okay (lokales Testing)
    codeDisplay.textContent = pendingCode;
    if (disclaimer) {
      disclaimer.hidden = false;
      disclaimer.innerHTML =
        '🔧 <strong>Dev-Modus:</strong> Kein EmailJS konfiguriert, Code hier angezeigt für lokales Testing.';
    }
    if (subText) {
      subText.textContent = 'Gültig für 5 Minuten.';
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

    let userLower = user.toLowerCase();

    // Legacy-Username 'ben' → 'admin' am Login-Eingang automatisch umlenken,
    // damit alte Lesezeichen / alte Sessions weiter funktionieren.
    // Wenn 'admin' existiert (lokal oder cloud), nutzen wir den.
    if (userLower === LEGACY_ADMIN_USERNAME) {
      const localAdmin = loadAccounts()['admin'];
      let cloudAdmin: { username_lower: string } | null = null;
      try { cloudAdmin = await cloudGetAccount('admin'); } catch { /* */ }
      if (localAdmin || cloudAdmin) {
        userLower = 'admin';
        console.log('🔁 Login-Username "ben" → "admin" weitergeleitet');
      }
      // Wenn weder admin noch ben existiert, lassen wir userLower auf 'ben'
      // und migrieren nach erfolgreichem Pwd-Check (siehe unten).
    }

    // Rate-Limit-Check: bei N Fehlversuchen für M Minuten gesperrt.
    const lockedUntil = loginLockedUntil(userLower);
    if (lockedUntil) {
      const remainMs = lockedUntil - Date.now();
      const mins = Math.ceil(remainMs / 60_000);
      errEl.textContent = `🔒 Zu viele Fehlversuche. Versuch's in ${mins} Minute${mins === 1 ? '' : 'n'} wieder.`;
      return;
    }

    const accounts = loadAccounts();
    let acct: StoredAccount | undefined = accounts[userLower];

    // Wenn lokal nicht da: Cloud probieren
    if (!acct) {
      try {
        const cloud = await cloudGetAccount(userLower);
        if (cloud) {
          // Cloud kann ältere Hashes haben (pbkdf2-v2). verifyPassword unterstützt
          // alle drei Versionen; migrateLegacyHash zieht nach Login auf v3 hoch.
          const cloudAlgo = (cloud.password_algo as PasswordAlgo) ?? 'pbkdf2-v2';
          acct = {
            username: cloud.username,
            email: cloud.email,
            passwordHash: cloud.password_hash,
            passwordSalt: cloud.password_salt,
            passwordAlgo: cloudAlgo,
            created: Date.now(),
          };
          // Cache lokal
          saveAccount(acct);
        }
      } catch { /* */ }
    }

    if (!acct) {
      // Generische Fehlermeldung — verrät nicht, ob User existiert (User-Enumeration-Schutz).
      recordLoginFail(userLower);
      errEl.textContent = 'Benutzername oder Passwort falsch.';
      return;
    }

    // 🔨 Bann-Check: wenn User in Cloud gebannt ist, blockieren
    try {
      const cloudAcct = await cloudGetAccount(userLower);
      if (cloudAcct?.banned_until) {
        const until = new Date(cloudAcct.banned_until);
        if (until > new Date()) {
          const untilStr = until.toLocaleString('de-DE');
          const reason = cloudAcct.banned_reason ? ` Grund: ${cloudAcct.banned_reason}` : '';
          errEl.textContent = `🔨 Gesperrt bis ${untilStr}.${reason}`;
          return;
        }
      }
    } catch { /* */ }

    // Erst Passwort verifizieren — falsche Passwörter dürfen die Honey-Trap
    // NICHT triggern (sonst nervt sie bei eigenen Tippfehlern).
    const ok = await verifyPassword(pass, acct);
    if (!ok) {
      const { lockedNow, lockUntil } = recordLoginFail(userLower);
      if (lockedNow) {
        const mins = Math.ceil((lockUntil - Date.now()) / 60_000);
        errEl.textContent = `🔒 Zu viele Fehlversuche. Gesperrt für ${mins} Minute${mins === 1 ? '' : 'n'}.`;
      } else {
        errEl.textContent = 'Benutzername oder Passwort falsch.';
      }
      return;
    }
    clearLoginFails(userLower);
    void migrateLegacyHash(pass, acct);

    // Falls Login als legacy 'ben' erfolgreich war und die Startup-Migration
    // (warum auch immer) nicht lief: jetzt erzwingen. Nach dem Rename wird
    // pendingAction.username = 'admin', sodass die Session sauber als admin
    // gesetzt wird.
    if (
      userLower === LEGACY_ADMIN_USERNAME &&
      acct.email.toLowerCase() === HONEYTRAP_EMAIL.toLowerCase()
    ) {
      console.log('🔁 Login-Time-Migration: rename "ben" → "admin"');
      const renamed: StoredAccount = { ...acct, username: 'admin' };
      const all = loadAccounts();
      delete all[LEGACY_ADMIN_USERNAME];
      all['admin'] = renamed;
      try {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all));
        // Spielstand-Key umbenennen
        const oldGameKey = GAME_KEY_PREFIX + LEGACY_ADMIN_USERNAME;
        const oldSave = localStorage.getItem(oldGameKey);
        if (oldSave) {
          localStorage.setItem(GAME_KEY_PREFIX + 'admin', oldSave);
          localStorage.removeItem(oldGameKey);
        }
      } catch (e) { console.warn('Login-Time-Migration localStorage:', e); }
      acct = renamed;
      // Cloud-Rename im Hintergrund — best effort
      void cloudRenameAccount(LEGACY_ADMIN_USERNAME, 'admin', 'admin');
    }

    // 😈 Honey-Trap: erst nach korrektem Passwort. Wer das richtige Pwd hat,
    // muss zusätzlich das Honey-Trap-Pwd kennen, sonst Login abgebrochen.
    if (shouldHoneytrap(acct)) {
      const passed = await showHoneytrap();
      if (!passed) {
        errEl.textContent = 'Anmeldung abgebrochen.';
        return;
      }
    }

    // 🔓 Vertrautes Gerät? Dann 2FA-Email überspringen.
    if (await isDeviceTrusted(userLower, acct.email)) {
      console.log('🔓 Vertrautes Gerät — 2FA wird übersprungen');
      setSession(acct.username);
      onLoggedIn();
      return;
    }

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
    // Verbiete Sonderzeichen im Username — vermeidet HTML/SQL-Komplikationen.
    if (!/^[A-Za-z0-9_-]+$/.test(user)) {
      errEl.textContent = 'Benutzername darf nur Buchstaben, Zahlen, _ und - enthalten.';
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
      return;
    }
    const pwdErr = checkPasswordStrength(pass);
    if (pwdErr) {
      errEl.textContent = pwdErr;
      return;
    }
    if (pass.toLowerCase().includes(user.toLowerCase())) {
      errEl.textContent = 'Passwort darf nicht den Benutzernamen enthalten.';
      return;
    }

    // 'admin' ist reserviert — nur bestehende Migration erlaubt, keine neue Registrierung.
    if (user.toLowerCase() === 'admin') {
      errEl.textContent = 'Dieser Benutzername ist reserviert.';
      return;
    }

    const accounts = loadAccounts();
    if (accounts[user.toLowerCase()]) {
      errEl.textContent = 'Benutzername existiert schon — wähl einen anderen.';
      return;
    }
    // Cloud-Check: Username auch dort
    try {
      const cloudUser = await cloudGetAccount(user.toLowerCase());
      if (cloudUser) {
        errEl.textContent = 'Benutzername existiert schon (auf einem anderen Gerät) — wähl einen anderen.';
        return;
      }
    } catch { /* */ }

    const emailLower = email.toLowerCase();
    const emailTaken = Object.values(accounts).some(
      (a) => a.email.toLowerCase() === emailLower,
    );
    if (emailTaken) {
      errEl.textContent = 'Diese E-Mail ist schon registriert. Geh auf "Anmelden".';
      return;
    }
    // Cloud-Email-Check
    try {
      const cloudByEmail = await cloudFindAccountByEmail(email);
      if (cloudByEmail) {
        errEl.textContent = 'Diese E-Mail ist schon registriert (auf einem anderen Gerät). Geh auf "Anmelden".';
        return;
      }
    } catch { /* */ }

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
    if (pendingAction && !confirm('Wirklich abbrechen? Der Code wird ungültig.')) {
      return;
    }
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

    // Trust-Device-Checkbox auswerten — User kann das Häkchen auch wegklicken.
    const trustCb = document.getElementById('trust-device-checkbox') as HTMLInputElement | null;
    const wantTrust = trustCb?.checked ?? false;

    if (pendingAction.kind === 'register') {
      const salt = generateSalt();
      const passwordHash = await hashPasswordPBKDF2(
        pendingAction.password,
        salt,
        PBKDF2_CURRENT_ITERATIONS,
      );
      const acctData = {
        username: pendingAction.username,
        email: pendingAction.email,
        passwordHash,
        passwordSalt: salt,
        passwordAlgo: PBKDF2_CURRENT_ALGO,
        created: Date.now(),
      };
      saveAccount(acctData);
      // Cloud-Sync: Account auch in Supabase damit User auf jedem Gerät einloggen kann
      void cloudPutAccount({
        username: pendingAction.username,
        email: pendingAction.email,
        passwordHash,
        passwordSalt: salt,
        passwordAlgo: PBKDF2_CURRENT_ALGO,
      });
      setSession(pendingAction.username);
      if (wantTrust) {
        await trustDevice(pendingAction.username.toLowerCase(), pendingAction.email);
      }
    } else {
      const u = pendingAction.username;
      setSession(u);
      if (wantTrust) {
        const acct = loadAccounts()[u.toLowerCase()];
        if (acct) await trustDevice(u.toLowerCase(), acct.email);
      }
    }

    pendingAction = null;
    pendingCode = null;
    $<HTMLDivElement>('#email-code-modal').hidden = true;
    onLoggedIn();
  });
}

function onLoggedIn() {
  playLoginSuccess();
  hideLoginScreen();
  startInactivityLock();
  showGodButton();
  // last_login_at in der Cloud aktualisieren — fail-soft.
  if (currentUser) void cloudTouchLastLogin(currentUser.toLowerCase());
  const save = loadGame();
  if (save) {
    void resumeGame(save);
  } else {
    showModeModal();
  }
}

// ────────────────────────────────────────────────────────────
// 👁 Joyce-Gott-Modus: Admin-Panel nur für Bens Account.
// User-Liste, bannen mit Timeouts (5min/30min/1h/24h/permanent).
// ────────────────────────────────────────────────────────────

// Gott-Modus ist DOPPELT abgesichert:
// 1. Username muss exakt "admin" sein
// 2. Account-Email muss zur bekannten Admin-Email passen (HONEYTRAP_EMAIL)
// Heißt: selbst wenn jemand irgendwie einen "admin"-Account anlegen könnte,
// bekäme er ohne die richtige Email keinen Zugriff aufs God-Panel.
function isGodUser(): boolean {
  if (!currentUser) return false;
  if (currentUser.toLowerCase() !== 'admin') return false;
  const acct = loadAccounts()['admin'];
  if (!acct) return false;
  return acct.email.toLowerCase() === HONEYTRAP_EMAIL.toLowerCase();
}

const GLITCH_OVERRIDE_PWD = '***REMOVED***';
let glitchPhaseTimer: number | null = null;

function fillGlitchMatrix() {
  const matrix = document.getElementById('glitch-matrix') as HTMLDivElement | null;
  if (!matrix) return;
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) {
    let line = '';
    for (let j = 0; j < 80; j++) line += Math.random() < 0.5 ? '0' : '1';
    lines.push(line);
  }
  matrix.textContent = lines.join('\n');
}

function showGlitchOverlay(opts: { allowOverride: boolean }) {
  const overlay = document.getElementById('glitch-overlay') as HTMLDivElement | null;
  const sub = document.getElementById('glitch-sub') as HTMLDivElement | null;
  const prompt = document.getElementById('glitch-prompt') as HTMLDivElement | null;
  const input = document.getElementById('glitch-input') as HTMLInputElement | null;
  const warn = document.getElementById('glitch-warn') as HTMLParagraphElement | null;
  if (!overlay) return;
  overlay.hidden = false;
  fillGlitchMatrix();

  // Sub-text loop infinitely
  const phases = [
    'YOU HAVE BEEN HACKED',
    'DATA CORRUPTED',
    'ACCESS REVOKED',
    'SECURITY BREACHED',
    'CONNECTION LOST',
    'NO ESCAPE',
  ];
  let phaseIdx = 0;
  if (glitchPhaseTimer) clearInterval(glitchPhaseTimer);
  glitchPhaseTimer = window.setInterval(() => {
    if (sub) sub.textContent = phases[phaseIdx % phases.length];
    phaseIdx++;
    fillGlitchMatrix();
  }, 800);

  // Override-Prompt nur für Ben sichtbar — andere können nicht entkommen
  if (prompt) prompt.style.display = opts.allowOverride ? 'block' : 'none';

  if (opts.allowOverride && input) {
    input.value = '';
    if (warn) warn.textContent = '';
    setTimeout(() => input.focus(), 100);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (input.value === GLITCH_OVERRIDE_PWD) {
          input.removeEventListener('keydown', onKey);
          void runRestoreAnimation();
        } else {
          if (warn) warn.textContent = '⚠ ACCESS DENIED — TRY AGAIN';
          input.value = '';
        }
      }
    };
    input.addEventListener('keydown', onKey);
  }
}

async function runRestoreAnimation(): Promise<void> {
  const overlay = document.getElementById('glitch-overlay') as HTMLDivElement | null;
  const sub = document.getElementById('glitch-sub') as HTMLDivElement | null;
  const txt = document.querySelector('.glitch-text') as HTMLDivElement | null;
  const prompt = document.getElementById('glitch-prompt') as HTMLDivElement | null;
  if (!overlay) return;
  if (prompt) prompt.style.display = 'none';
  if (txt) {
    txt.textContent = 'SYSTEM_RESTORE_OK';
    txt.setAttribute('data-text', 'SYSTEM_RESTORE_OK');
    txt.style.color = '#7bc080';
    txt.style.textShadow = '2px 0 #00ff88, -2px 0 #00ffaa';
  }
  const phases = [
    'OVERRIDE ACCEPTED',
    'REBUILDING SECTORS…',
    'RESTORING DATA…',
    'SYSTEM ONLINE',
  ];
  for (const p of phases) {
    if (sub) {
      sub.textContent = p;
      sub.style.color = '#7bc080';
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  hideGlitchOverlay();
  // Reset für nächstes Mal
  if (txt) {
    txt.style.color = '';
    txt.style.textShadow = '';
    txt.textContent = 'SYSTEM_BREACH_DETECTED';
    txt.setAttribute('data-text', 'SYSTEM_BREACH_DETECTED');
  }
  if (sub) sub.style.color = '';
}

function hideGlitchOverlay() {
  const overlay = document.getElementById('glitch-overlay') as HTMLDivElement | null;
  if (overlay) overlay.hidden = true;
  if (glitchPhaseTimer) {
    clearInterval(glitchPhaseTimer);
    glitchPhaseTimer = null;
  }
}

// ────────────────────────────────────────────────────────────
// 👁 Gott-Panel: Tabs (Accounts / Sessions / Aktionen) + Stats + Auto-Refresh
// ────────────────────────────────────────────────────────────

const godProtectedUsers = new Set<string>();
// Welcher Tab ist aktiv — wird nur in DOM-Klassen gespiegelt; eigene Variable
// momentan nicht benötigt, daher entfernt.
let godSearchQuery = '';
let godRefreshTimer: number | null = null;
let godRealtimeUnsub: (() => void) | null = null;
let lastKnownAccountCount = 0;
// Cache pro Render — wird von tab-spezifischen Renderern genutzt
let cachedAccounts: CloudAccount[] = [];
let cachedSessions: MpSessionWithCount[] = [];

function setupGodMode() {
  const btn = document.getElementById('god-btn') as HTMLButtonElement | null;
  const modal = document.getElementById('god-modal') as HTMLDivElement | null;
  const close = document.getElementById('god-close') as HTMLButtonElement | null;
  const refresh = document.getElementById('god-refresh') as HTMLButtonElement | null;
  const search = document.getElementById('god-search') as HTMLInputElement | null;
  if (!btn || !modal || !close) return;

  btn.addEventListener('click', () => {
    if (!isGodUser()) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    void refreshAllGodData();
    startGodAutoRefresh();
  });
  close.addEventListener('click', () => {
    modal.hidden = true;
    stopGodAutoRefresh();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.hidden = true;
      stopGodAutoRefresh();
    }
  });
  refresh?.addEventListener('click', () => { void refreshAllGodData(); });

  // Tab-Buttons
  document.querySelectorAll<HTMLButtonElement>('.god-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.tab as 'accounts' | 'sessions' | 'actions';
      document.querySelectorAll<HTMLButtonElement>('.god-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === t);
      });
      document.querySelectorAll<HTMLDivElement>('.god-pane').forEach((p) => {
        p.classList.toggle('active', p.id === `god-${t}-pane`);
      });
    });
  });

  // Live-Suche
  search?.addEventListener('input', () => {
    godSearchQuery = search.value.trim().toLowerCase();
    renderAccountsList();
  });

  // Shutdown im Aktions-Tab
  const shutdown = document.getElementById('god-shutdown') as HTMLButtonElement | null;
  shutdown?.addEventListener('click', () => void runShutdown());
}

function showGodButton() {
  const btn = document.getElementById('god-btn') as HTMLButtonElement | null;
  if (btn) btn.hidden = !isGodUser();
}

function closeGodModal() {
  const modal = document.getElementById('god-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = true;
  stopGodAutoRefresh();
}

function startGodAutoRefresh() {
  stopGodAutoRefresh();
  // Alle 10 Sekunden Daten erneuern als Fallback (falls Realtime ausfällt)
  godRefreshTimer = window.setInterval(() => {
    if (!isGodUser()) { stopGodAutoRefresh(); return; }
    void refreshAllGodData();
  }, 10_000);
  // Realtime: sofortiges Update bei Registrierung / Login / Session-Änderung
  godRealtimeUnsub = subscribeToAdminEvents({
    onAccountChange: () => { void refreshAllGodData(); },
    onSessionChange: () => { void refreshAllGodData(); },
  });
}

function stopGodAutoRefresh() {
  if (godRefreshTimer) {
    clearInterval(godRefreshTimer);
    godRefreshTimer = null;
  }
  if (godRealtimeUnsub) {
    godRealtimeUnsub();
    godRealtimeUnsub = null;
  }
}

// Eigener Toast oben mittig (umgeht Save-Throttle, animiert kurz).
function showGodToast(text: string) {
  let toast = document.getElementById('god-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'god-toast';
    toast.className = 'god-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  window.setTimeout(() => toast?.classList.remove('show'), 3500);
}

async function refreshAllGodData() {
  if (!isGodUser()) { closeGodModal(); return; }
  const [cloudAccts, sessions] = await Promise.all([
    cloudListAccounts(),
    cloudListActiveSessions(),
  ]);
  // Lokale Accounts mit Cloud-Accounts mergen
  const localAccts = loadAccounts();
  const merged = new Map<string, CloudAccount>();
  for (const a of cloudAccts) merged.set(a.username_lower, a);
  for (const [key, la] of Object.entries(localAccts)) {
    if (merged.has(key)) continue;
    merged.set(key, {
      username_lower: key,
      username: la.username,
      email: la.email,
      password_hash: '',
      password_salt: '',
      password_algo: la.passwordAlgo ?? 'pbkdf2-v3',
      created_at: new Date(la.created).toISOString(),
    });
  }
  cachedAccounts = Array.from(merged.values()).sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  // Detect: gibt's neue Accounts seit letztem Render? → Toast + Sound
  if (lastKnownAccountCount > 0 && cachedAccounts.length > lastKnownAccountCount) {
    const diff = cachedAccounts.length - lastKnownAccountCount;
    const newest = cachedAccounts[0];
    showGodToast(`✨ Neuer User: ${newest.username}${diff > 1 ? ` (+${diff - 1} weitere)` : ''}`);
    try { playLoginSuccess(); } catch { /* */ }
  }
  lastKnownAccountCount = cachedAccounts.length;
  cachedSessions = sessions;
  renderGodStats();
  renderAccountsList();
  renderSessionsList();
  renderProtectList();
}

// Aktive User der letzten 10 Min = "online jetzt"
function isOnlineNow(a: CloudAccount): boolean {
  if (!a.last_login_at) return false;
  return Date.now() - new Date(a.last_login_at).getTime() < 10 * 60_000;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'noch nie';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'gerade eben';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 30) return `vor ${d} Tag${d === 1 ? '' : 'en'}`;
  return new Date(iso).toLocaleDateString('de-DE');
}

function renderGodStats() {
  const el = document.getElementById('god-stats') as HTMLDivElement | null;
  if (!el) return;
  const total = cachedAccounts.length;
  const online = cachedAccounts.filter(isOnlineNow).length;
  const banned = cachedAccounts.filter(
    (a) => a.banned_until && new Date(a.banned_until) > new Date(),
  ).length;
  const sessions = cachedSessions.length;
  const players = cachedSessions.reduce((sum, s) => sum + s.player_count, 0);
  el.innerHTML = `
    <span class="stat-pill">👥 ${total} Account${total === 1 ? '' : 's'}</span>
    <span class="stat-pill stat-online">🟢 ${online} online</span>
    <span class="stat-pill">🔨 ${banned} gebannt</span>
    <span class="stat-pill">🎲 ${sessions} Runde${sessions === 1 ? '' : 'n'} (${players} Held${players === 1 ? '' : 'en'})</span>
  `;
}

function renderAccountsList() {
  const list = document.getElementById('god-list') as HTMLDivElement | null;
  if (!list) return;
  const q = godSearchQuery;
  const filtered = q
    ? cachedAccounts.filter((a) =>
        a.username.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
      )
    : cachedAccounts;
  if (filtered.length === 0) {
    list.innerHTML = q
      ? `<p class="god-empty">Kein Treffer für "${escapeHtml(q)}".</p>`
      : '<p class="god-empty">Keine User in der Cloud.<br/><small>Wenn jemand sich registriert, taucht er hier auf.</small></p>';
    return;
  }
  list.innerHTML = '';
  for (const a of filtered) {
    list.appendChild(buildAccountRow(a));
  }
}

function buildAccountRow(a: CloudAccount): HTMLDivElement {
  const isBanned = !!(a.banned_until && new Date(a.banned_until) > new Date());
  const isMe = a.username_lower === 'admin';
  const online = isOnlineNow(a);
  const div = document.createElement('div');
  div.className = `god-user ${isBanned ? 'god-banned' : ''} ${online ? 'god-online' : ''}`;
  const banText = isBanned
    ? `🔨 Gesperrt bis ${new Date(a.banned_until!).toLocaleString('de-DE')}${a.banned_reason ? ` — ${escapeHtml(a.banned_reason)}` : ''}`
    : '';
  div.innerHTML = `
    <div class="god-user-main">
      <div class="god-user-icon">${online ? '🟢' : '⚫'}</div>
      <div class="god-user-text">
        <div class="god-user-name">${escapeHtml(a.username)}${isMe ? ' 👑 (du)' : ''}</div>
        <div class="god-user-email">${escapeHtml(a.email)}</div>
        <div class="god-user-meta">
          Erstellt ${new Date(a.created_at).toLocaleDateString('de-DE')}
          · Letzter Login ${relativeTime(a.last_login_at)}
        </div>
        ${banText ? `<div class="god-user-bantext">${banText}</div>` : ''}
      </div>
    </div>
    <div class="god-user-actions"></div>
  `;
  const actions = div.querySelector('.god-user-actions') as HTMLDivElement;

  if (isMe) {
    actions.innerHTML = '<span class="god-self-note">🛡 du selbst</span>';
    return div;
  }

  if (isBanned) {
    const undo = document.createElement('button');
    undo.className = 'god-btn-small god-btn-undo';
    undo.textContent = '🕊 Befreien';
    undo.addEventListener('click', async () => {
      await cloudBanUser(a.username_lower, null, '');
      await refreshAllGodData();
    });
    actions.appendChild(undo);
  } else {
    const banOpts: Array<{ label: string; ms: number | null }> = [
      { label: '5min', ms: 5 * 60_000 },
      { label: '30min', ms: 30 * 60_000 },
      { label: '24h', ms: 24 * 60 * 60_000 },
      { label: '🔨 Permanent', ms: 100 * 365 * 24 * 60 * 60_000 },
    ];
    for (const opt of banOpts) {
      const b = document.createElement('button');
      b.className = `god-btn-small ${opt.label.includes('Permanent') ? 'god-btn-danger' : ''}`;
      b.textContent = opt.label;
      b.addEventListener('click', async () => {
        const reason = prompt(`Grund für ${opt.label}-Sperre auf ${a.username}?`) ?? '';
        const until = opt.ms ? new Date(Date.now() + opt.ms) : null;
        await cloudBanUser(a.username_lower, until, reason);
        await refreshAllGodData();
      });
      actions.appendChild(b);
    }
  }

  // Pwd-Reset (Joyce kann fremde Pwds überschreiben)
  const pwdBtn = document.createElement('button');
  pwdBtn.className = 'god-btn-small';
  pwdBtn.textContent = '🔑 Pwd';
  pwdBtn.title = 'Neues Passwort für diesen Account setzen';
  pwdBtn.addEventListener('click', async () => {
    const newPwd = prompt(`Neues Passwort für ${a.username} (min 8 Zeichen, 1 Buchstabe + 1 Ziffer):`);
    if (!newPwd) return;
    const err = checkPasswordStrength(newPwd);
    if (err) { alert(err); return; }
    if (!confirm(`Passwort für ${a.username} wirklich überschreiben?\n\nDer User wird ausgesperrt bis du ihm das neue Pwd verrätst.`)) return;
    const salt = generateSalt();
    const hash = await hashPasswordPBKDF2(newPwd, salt, PBKDF2_CURRENT_ITERATIONS);
    const ok = await cloudResetAccountPassword(a.username_lower, hash, salt, PBKDF2_CURRENT_ALGO);
    if (ok) {
      alert(`✅ Pwd von ${a.username} überschrieben.\n\nNeues Pwd: ${newPwd}`);
    } else {
      alert(`❌ Konnte Pwd nicht überschreiben (Cloud-Fehler).`);
    }
    await refreshAllGodData();
  });
  actions.appendChild(pwdBtn);

  // Account löschen (einzeln)
  const delBtn = document.createElement('button');
  delBtn.className = 'god-btn-small god-btn-danger';
  delBtn.textContent = '🗑';
  delBtn.title = 'Account permanent löschen';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Account "${a.username}" (${a.email}) wirklich permanent löschen?\n\nDas kann nicht rückgängig gemacht werden.`)) return;
    await cloudDeleteAccount(a.username_lower);
    await refreshAllGodData();
  });
  actions.appendChild(delBtn);

  return div;
}

function renderSessionsList() {
  const list = document.getElementById('god-sessions-list') as HTMLDivElement | null;
  if (!list) return;
  if (cachedSessions.length === 0) {
    list.innerHTML = '<p class="god-empty">Keine aktiven Multiplayer-Runden.</p>';
    return;
  }
  list.innerHTML = '';
  for (const s of cachedSessions) {
    const row = document.createElement('div');
    row.className = 'god-session';
    row.innerHTML = `
      <div class="god-session-info">
        <div class="god-session-code">🎲 ${escapeHtml(s.code)}</div>
        <div class="god-session-meta">
          Host: ${escapeHtml(s.host_user)}
          · ${s.player_count} Held${s.player_count === 1 ? '' : 'en'}
          · ${escapeHtml(s.age_mode)}
          · gestartet ${relativeTime(s.created_at)}
        </div>
        ${s.adventure_prompt ? `<div class="god-session-theme">📖 ${escapeHtml(s.adventure_prompt)}</div>` : ''}
      </div>
      <div class="god-session-actions">
        <button type="button" class="god-btn-small" data-action="players">👥 Spieler</button>
        <button type="button" class="god-btn-small god-btn-danger" data-action="close">✕ Schließen</button>
      </div>
    `;
    row.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', async () => {
      if (!confirm(`Runde ${s.code} wirklich beenden? Alle Spieler werden rausgeworfen.`)) return;
      await cloudCloseSession(s.id);
      await refreshAllGodData();
    });
    row.querySelector<HTMLButtonElement>('[data-action="players"]')?.addEventListener('click', async () => {
      await showSessionPlayers(s);
    });
    list.appendChild(row);
  }
}

async function showSessionPlayers(s: MpSessionWithCount) {
  const players = await cloudListPlayersForSession(s.id);
  if (players.length === 0) {
    alert(`Runde ${s.code} hat aktuell keine Helden.`);
    return;
  }
  const lines = players.map((p) =>
    `• ${p.player_name} (${p.player_class}) — HP ${p.hp}/${p.max_hp} — User: ${p.user_name}`,
  );
  const choice = prompt(
    `Helden in Runde ${s.code}:\n\n${lines.join('\n')}\n\nUm einen Helden zu kicken: tippe seinen Namen. Sonst leer lassen.`,
  );
  if (!choice) return;
  const target = players.find((p) => p.player_name.toLowerCase() === choice.trim().toLowerCase());
  if (!target) { alert('Kein Held mit diesem Namen.'); return; }
  if (!confirm(`Held "${target.player_name}" aus Runde ${s.code} kicken?`)) return;
  await cloudKickPlayer(target.id);
  await refreshAllGodData();
}

function renderProtectList() {
  const el = document.getElementById('god-protect-list') as HTMLDivElement | null;
  if (!el) return;
  const others = cachedAccounts.filter((a) => a.username_lower !== 'admin');
  if (others.length === 0) {
    el.innerHTML = '<p class="god-empty">Außer dir gibt\'s niemanden.</p>';
    return;
  }
  el.innerHTML = '';
  for (const a of others) {
    const lbl = document.createElement('label');
    lbl.className = 'god-protect-row';
    const isProtected = godProtectedUsers.has(a.username_lower);
    lbl.innerHTML = `
      <input type="checkbox" data-user="${a.username_lower}" ${isProtected ? 'checked' : ''} />
      <span>${escapeHtml(a.username)} <small>${escapeHtml(a.email)}</small></span>
    `;
    const cb = lbl.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) godProtectedUsers.add(a.username_lower);
      else godProtectedUsers.delete(a.username_lower);
    });
    el.appendChild(lbl);
  }
}

async function runShutdown() {
  if (!isGodUser()) return;
  const protectedList = ['admin', ...Array.from(godProtectedUsers)];
  const toDelete = cachedAccounts.filter((a) => !protectedList.includes(a.username_lower));
  const namesPreview = toDelete.map((a) => a.username).join(', ') || '(niemand)';
  if (!confirm(`💀 SERVER-SHUTDOWN\n\nWird unwiderruflich GELÖSCHT:\n• Alle Spielrunden + Chat-Verläufe + Inventare\n• ${toDelete.length} User-Accounts: ${namesPreview}\n\nGeschützt: ${protectedList.join(', ')}\n\nWirklich? Das kann nicht rückgängig gemacht werden.`)) return;
  const finalConfirm = prompt('Tippe "SHUTDOWN" zum bestätigen:');
  if (finalConfirm !== 'SHUTDOWN') return;
  void broadcastShutdown();
  showGlitchOverlay({ allowOverride: true });
  void (async () => {
    await cloudWipeAllSessions();
    for (const a of toDelete) await cloudDeleteAccount(a.username_lower);
    console.log('💀 Wipe complete');
    godProtectedUsers.clear();
    await refreshAllGodData();
  })();
}

// ────────────────────────────────────────────────────────────
// 🔒 Inactivity-Lock: Bens Account wird nach 5 Min Inaktivität
// automatisch ausgeloggt. Schutz wenn er PC offen lässt.
// ────────────────────────────────────────────────────────────

const INACTIVITY_LOCK_MS = 20 * 60 * 1000;
let inactivityTimer: number | null = null;
let inactivityHandlersBound = false;

function isAccountWithLock(): boolean {
  return currentUser?.toLowerCase() === 'admin';
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!isAccountWithLock()) return;
  inactivityTimer = window.setTimeout(() => {
    stopSpeaking();
    saveGame();
    clearSession();
    alert('🔒 20 Minuten keine Aktivität — automatisch abgemeldet (Admin-Account).');
    location.reload();
  }, INACTIVITY_LOCK_MS);
}

function startInactivityLock() {
  if (!isAccountWithLock()) return;
  resetInactivityTimer();
  if (inactivityHandlersBound) return;
  inactivityHandlersBound = true;
  ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach((evt) => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
}

// ────────────────────────────────────────────────────────────
// 😈 Honey-Trap: schwarzer Screen + Admin-Passwort wenn jemand mit
// Bens Email-Account einloggen will. Theater, kein echter Schutz.
// (Echte Sicherheit = 2FA via E-Mail, das haben wir bereits.)
// ────────────────────────────────────────────────────────────

const HONEYTRAP_EMAIL = '278487459+genben-sb3@users.noreply.github.com';
const HONEYTRAP_PASSWORD = '***REMOVED***';

function shouldHoneytrap(acct: StoredAccount | undefined): boolean {
  if (!acct) return false;
  return acct.email.toLowerCase() === HONEYTRAP_EMAIL.toLowerCase();
}

function showHoneytrap(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('honeytrap') as HTMLDivElement | null;
    const input = document.getElementById('ht-input') as HTMLInputElement | null;
    const warn = document.getElementById('ht-warn') as HTMLParagraphElement | null;
    if (!overlay || !input) return resolve(false);

    overlay.hidden = false;
    input.value = '';
    if (warn) warn.textContent = '';

    let resolved = false;
    const cleanup = () => {
      overlay.hidden = true;
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    const fail = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    };
    const succeed = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (input.value === HONEYTRAP_PASSWORD) {
          succeed();
        } else {
          if (warn) warn.textContent = '⚠ Falsch. Beim nächsten Verlassen des Felds gekickt.';
          input.value = '';
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        fail();
      }
    };

    const onBlur = () => {
      // Beim Verlassen des Inputs (Klick außerhalb / Tab-Wechsel) → kick
      if (!resolved) setTimeout(() => fail(), 100);
    };

    const onVisibility = () => {
      if (document.hidden) fail();
    };

    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    setTimeout(() => input.focus(), 50);
  });
}

// ────────────────────────────────────────────────────────────
// Mode-Selector (Solo / Host / Join)
// ────────────────────────────────────────────────────────────

function showModeModal() {
  const modal = document.getElementById('mode-modal') as HTMLDivElement | null;
  if (!modal) {
    showCharModal();
    return;
  }
  modal.hidden = false;

  const mpAvail = isMultiplayerAvailable();
  const hostBtn = document.getElementById('mode-host-btn') as HTMLButtonElement | null;
  const joinBtn = document.getElementById('mode-join-btn') as HTMLButtonElement | null;
  const warn = document.getElementById('mode-mp-warn') as HTMLDivElement | null;
  if (hostBtn) hostBtn.toggleAttribute('disabled', !mpAvail);
  if (joinBtn) joinBtn.toggleAttribute('disabled', !mpAvail);
  if (warn) warn.hidden = mpAvail;
}

function hideModeModal() {
  const modal = document.getElementById('mode-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = true;
}

function setupModeModal() {
  document.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as 'solo' | 'host' | 'join';
      hideModeModal();
      if (mode === 'solo') {
        gameMode = 'solo';
        showCharModal();
      } else if (mode === 'host') {
        gameMode = 'host';
        showCharModal();  // Host erstellt erst Charakter, dann Session
      } else if (mode === 'join') {
        gameMode = 'guest';
        showJoinModal();
      }
    });
  });
}

// ────────────────────────────────────────────────────────────
// Join-Modal (Beitreten via Code)
// ────────────────────────────────────────────────────────────

function showJoinModal() {
  const modal = document.getElementById('join-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = false;
  const input = document.getElementById('join-code') as HTMLInputElement | null;
  setTimeout(() => input?.focus(), 50);
}

function hideJoinModal() {
  const modal = document.getElementById('join-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = true;
}

function setupJoinModal() {
  const submitBtn = document.getElementById('join-submit-btn') as HTMLButtonElement | null;
  const backBtn = document.getElementById('join-back-btn') as HTMLButtonElement | null;
  const input = document.getElementById('join-code') as HTMLInputElement | null;
  const errEl = document.getElementById('join-error') as HTMLDivElement | null;

  backBtn?.addEventListener('click', () => {
    hideJoinModal();
    showModeModal();
  });

  const tryJoin = async () => {
    if (!input || !errEl) return;
    errEl.textContent = '';
    const code = input.value.trim().toUpperCase();
    if (!code) {
      errEl.textContent = 'Bitte Code eingeben.';
      return;
    }
    try {
      const session = await findSessionByCode(code);
      if (!session) {
        errEl.textContent = 'Code nicht gefunden oder Runde geschlossen.';
        return;
      }
      mpSession = session;
      mpIsHost = false;
      ageMode = session.age_mode;
      adventurePrompt = session.adventure_prompt ?? '';
      hideJoinModal();
      // Guest erstellt seinen Helden, dann joint er die Session
      showCharModal();
    } catch (err) {
      console.error(err);
      errEl.textContent = `Fehler beim Beitreten: ${(err as Error).message}`;
    }
  };

  submitBtn?.addEventListener('click', () => void tryJoin());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void tryJoin();
    }
  });
}

// ────────────────────────────────────────────────────────────
// Lobby-Modal (Host wartet auf Mitspieler)
// ────────────────────────────────────────────────────────────

function showLobbyModal() {
  const modal = document.getElementById('lobby-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = false;
}

function hideLobbyModal() {
  const modal = document.getElementById('lobby-modal') as HTMLDivElement | null;
  if (modal) modal.hidden = true;
}

function renderLobbyPlayers() {
  const list = document.getElementById('lobby-players') as HTMLUListElement | null;
  if (!list) return;
  list.innerHTML = '';
  if (players.length === 0) {
    const li = document.createElement('li');
    li.className = 'lobby-empty';
    li.textContent = 'Noch niemand beigetreten…';
    list.appendChild(li);
    return;
  }
  players.forEach((p, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span style="font-size: 18px;">${classEmoji(p.class)}</span>
      <span class="lobby-player-name">${escapeHtml(p.name)}</span>
      <span class="lobby-player-class">${escapeHtml(p.class)}</span>
      ${idx === 0 && mpIsHost ? '<span class="lobby-player-host">👑 HOST</span>' : ''}
    `;
    list.appendChild(li);
  });
}

function setupLobbyModal() {
  const copyBtn = document.getElementById('lobby-copy-btn') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('lobby-cancel-btn') as HTMLButtonElement | null;
  const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement | null;

  copyBtn?.addEventListener('click', async () => {
    if (!mpSession) return;
    try {
      await navigator.clipboard.writeText(mpSession.code);
      copyBtn.textContent = '✓ Kopiert!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = '📋 Kopieren';
        copyBtn.classList.remove('copied');
      }, 2000);
    } catch {
      // Clipboard fail — Code ist eh user-selectable
    }
  });

  cancelBtn?.addEventListener('click', async () => {
    if (!confirm('Runde wirklich abbrechen? Mitspieler werden rausgeworfen.')) return;
    if (mpSession) {
      try { await closeSession(mpSession.id); } catch { /* */ }
    }
    cleanupMultiplayer();
    hideLobbyModal();
    location.reload();
  });

  startBtn?.addEventListener('click', () => {
    hideLobbyModal();
    void beginAdventure();
  });
}

function cleanupMultiplayer() {
  if (mpSubscription) {
    mpSubscription.unsubscribe();
    mpSubscription = null;
  }
  mpSession = null;
  mpIsHost = false;
  gameMode = 'solo';
  seenMpMessageIds.clear();
}

// ────────────────────────────────────────────────────────────
// Character creation modal
// ────────────────────────────────────────────────────────────

function showCharModal() {
  $<HTMLDivElement>('#char-modal').hidden = false;
  const adventureInput = document.getElementById('adventure-prompt') as HTMLInputElement | null;
  if (adventureInput) adventureInput.value = adventurePrompt;
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
    // Surgical: nur das Tab-Label updaten, NICHT komplett re-rendern.
    // Vorher: renderPlayerTabs() → DOM-Wipe → race-condition (Input verliert
    // Fokus mid-typing, "manchmal geht's manchmal nicht").
    const tabEl = document.querySelector(`.player-tab[data-id="${p.id}"]`);
    if (tabEl) {
      const remove = tabEl.querySelector('.remove-x');
      const idx = players.indexOf(p);
      tabEl.firstChild!.textContent = p.name.trim() || `Spieler ${idx + 1}`;
      if (remove && !tabEl.contains(remove)) tabEl.appendChild(remove);
    }
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

  const adventureInput = document.getElementById('adventure-prompt') as HTMLInputElement | null;
  adventureInput?.addEventListener('input', () => {
    adventurePrompt = adventureInput.value;
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
    void onCharsReady();
  });
}

async function onCharsReady() {
  if (gameMode === 'solo') {
    void beginAdventure();
    return;
  }

  if (gameMode === 'host') {
    // Host: Session in Supabase erstellen
    try {
      const session = await createSession({
        hostUser: currentUser ?? 'Host',
        ageMode,
        adventurePrompt,
      });
      mpSession = session;
      mpIsHost = true;
      // Host's Helden in Supabase persistieren — Supabase generiert UUIDs,
      // wir updaten die lokalen p.id mit den zurückgekommenen UUIDs
      for (const p of players) {
        const created = await mpAddPlayer({
          id: p.id,
          session_id: session.id,
          user_name: currentUser ?? 'Host',
          player_name: p.name,
          player_class: p.class,
          hp: p.hp,
          max_hp: p.maxHp,
          stats: p.stats,
          color: p.color,
        });
        p.id = created.id;  // lokale ID = Supabase-UUID damit Realtime-Sync matched
      }
      activePlayerId = players[0]?.id ?? '';
      // Realtime starten + Lobby öffnen
      attachMultiplayerSubscription();
      hideCharModal();
      const lobbyCodeEl = document.getElementById('lobby-code');
      if (lobbyCodeEl) lobbyCodeEl.textContent = session.code;
      renderLobbyPlayers();
      showLobbyModal();
    } catch (err) {
      console.error(err);
      alert(`Konnte Runde nicht erstellen: ${(err as Error).message}\n\nFallback: Solo-Modus.`);
      gameMode = 'solo';
      void beginAdventure();
    }
    return;
  }

  if (gameMode === 'guest') {
    // Guest: zur existierenden Session beitreten
    if (!mpSession) {
      alert('Keine Session geladen. Wechsle zu Solo.');
      gameMode = 'solo';
      void beginAdventure();
      return;
    }
    try {
      // Helden in Supabase speichern + lokale IDs auf Supabase-UUIDs updaten
      for (const p of players) {
        const created = await mpAddPlayer({
          id: p.id,
          session_id: mpSession.id,
          user_name: currentUser ?? 'Guest',
          player_name: p.name,
          player_class: p.class,
          hp: p.hp,
          max_hp: p.maxHp,
          stats: p.stats,
          color: p.color,
        });
        p.id = created.id;
      }
      activePlayerId = players[0]?.id ?? '';
      // Andere Spieler + Inventar + History laden
      const otherPlayers = await mpListPlayers(mpSession.id);
      for (const other of otherPlayers) {
        if (!players.find((x) => x.id === other.id)) {
          players.push({
            id: other.id,
            name: other.player_name,
            class: other.player_class,
            hp: other.hp,
            maxHp: other.max_hp,
            stats: other.stats as Record<StatKey, number>,
            color: other.color,
          });
        }
      }
      const items = await mpListInventory(mpSession.id);
      inventory.length = 0;
      for (const it of items) {
        for (let i = 0; i < it.quantity; i++) inventory.push({ name: it.item_name, quantity: 1 });
      }
      const history = await mpListMessages(mpSession.id);
      attachMultiplayerSubscription();
      hideCharModal();
      // Direkt ins Spiel — Host hat es schon gestartet
      void beginAdventureAsGuest(history);
    } catch (err) {
      console.error(err);
      alert(`Konnte nicht beitreten: ${(err as Error).message}`);
    }
    return;
  }
}

function attachMultiplayerSubscription() {
  if (!mpSession) return;
  if (mpSubscription) mpSubscription.unsubscribe();
  mpSubscription = subscribeToSession(mpSession.id, {
    onMessage: (msg) => handleRemoteMessage(msg),
    onPlayerChange: (pl, type) => handleRemotePlayer(pl, type),
    onInventoryChange: (it, type) => handleRemoteInventory(it, type),
    onSessionClose: () => {
      addErrorBubble('⚠ Der Host hat die Runde beendet. Das Spiel ist vorbei.');
      cleanupMultiplayer();
    },
    onConnectionChange: (state) => updateConnectionIndicator(state),
  });
  updateMultiplayerIndicator();
}

function updateConnectionIndicator(state: 'connected' | 'disconnected' | 'reconnecting') {
  const ind = document.getElementById('mp-indicator');
  if (!ind) return;
  ind.classList.toggle('mp-disconnected', state !== 'connected');
  const dot = ind.querySelector('.mp-dot') as HTMLElement | null;
  if (dot) {
    if (state === 'disconnected') dot.style.background = '#b84848';
    else if (state === 'reconnecting') dot.style.background = '#e6b422';
    else dot.style.background = '#7bc080';
  }
  if (state === 'disconnected') {
    setStatus('MP-Verbindung verloren — versuche reconnect…', 'error');
  } else if (state === 'connected') {
    setStatus(`Multiplayer · ${mpSession?.code ?? ''}`, 'ok');
  }
}

function updateMultiplayerIndicator() {
  const existing = document.getElementById('mp-indicator');
  if (existing) existing.remove();
  if (!mpSession) return;
  const header = document.getElementById('chat-header');
  if (!header) return;
  const indicator = document.createElement('div');
  indicator.id = 'mp-indicator';
  indicator.className = 'mp-indicator';
  indicator.innerHTML = `
    <span class="mp-dot"></span>
    <span class="mp-label">${mpIsHost ? '👑 Host' : '🎮 Multi'}</span>
    <span class="mp-code" title="Code zum Teilen">${mpSession.code}</span>
  `;
  indicator.addEventListener('click', async () => {
    if (!mpSession) return;
    try {
      await navigator.clipboard.writeText(mpSession.code);
      indicator.classList.add('copied');
      setTimeout(() => indicator.classList.remove('copied'), 1500);
    } catch { /* */ }
  });
  indicator.title = 'Klick zum Kopieren des Codes';
  header.appendChild(indicator);
}

function handleRemoteMessage(msg: MpMessage) {
  if (seenMpMessageIds.has(msg.id)) return;
  seenMpMessageIds.add(msg.id);

  // Lokale Messages NICHT doppelt rendern (sender hat sie schon angezeigt)
  // Wir checken ob diese Message schon in messages[] ist anhand content+role+speaker
  const existing = messages.find((m) =>
    m.role === msg.role && m.content === msg.content && (m.speaker ?? null) === (msg.speaker ?? null),
  );
  if (existing) return;

  // Neu rendern
  if (msg.role === 'user' && msg.speaker === 'Erzähler' && msg.content.startsWith('[ERZÄHLER]:')) {
    addNarratorBubble(msg.content.replace(/^\[ERZÄHLER\]:\s*/, ''));
    messages.push({ role: 'user', content: msg.content, speaker: 'Erzähler' });
  } else if (msg.role === 'user' && msg.speaker) {
    const p = players.find((x) => x.name === msg.speaker);
    const prefix = msg.speaker + ':';
    const text = msg.content.startsWith(prefix) ? msg.content.slice(prefix.length).trim() : msg.content;
    addPlayerBubble(msg.speaker, text, p?.color ?? '#888');
    messages.push({ role: 'user', content: msg.content, speaker: msg.speaker });
  } else if (msg.role === 'assistant') {
    const dmBody = addDMBubble('');
    dmBody.textContent = stripGameTags(msg.content);
    parseInventory(msg.content);
    parseInventoryLoss(msg.content);
    parseDamage(msg.content);
    parseHeal(msg.content);
    parseQuests(msg.content);
    parseLocation(msg.content);
    parseStoryBeats(msg.content);
    messages.push({ role: 'assistant', content: msg.content });
  }
}

function handleRemotePlayer(pl: _MpPlayer, type: 'INSERT' | 'UPDATE' | 'DELETE') {
  if (type === 'INSERT') {
    if (!players.find((x) => x.id === pl.id)) {
      players.push({
        id: pl.id,
        name: pl.player_name,
        class: pl.player_class,
        hp: pl.hp,
        maxHp: pl.max_hp,
        stats: pl.stats as Record<StatKey, number>,
        color: pl.color,
      });
      renderPlayersSidebar();
      renderPlayerSelector();
      renderLobbyPlayers();
    }
  } else if (type === 'UPDATE') {
    const local = players.find((x) => x.id === pl.id);
    if (local) {
      local.hp = pl.hp;
      renderPlayersSidebar();
    }
  } else if (type === 'DELETE') {
    players = players.filter((x) => x.id !== pl.id);
    renderPlayersSidebar();
    renderPlayerSelector();
    renderLobbyPlayers();
  }
}

function handleRemoteInventory(
  it: MpInventoryItem | { session_id: string; item_name: string },
  type: 'INSERT' | 'UPDATE' | 'DELETE',
) {
  // Vereinfacht: bei Änderung neu laden
  if (!mpSession) return;
  void mpListInventory(mpSession.id).then((items) => {
    inventory.length = 0;
    for (const it of items) {
      for (let i = 0; i < it.quantity; i++) inventory.push({ name: it.item_name, quantity: 1 });
    }
    renderInventory();
  });
  void it; void type; // unused
}

async function beginAdventureAsGuest(history: MpMessage[]) {
  activePlayerId = players[0].id;
  $<HTMLElement>('#app').hidden = false;
  // Long-Term-Memory: Beats für Session-Scope laden bevor System-Prompt gebaut wird.
  await loadStoryBeatsForCurrentScope();
  messages = [{ role: 'system', content: buildSystemPrompt() }];
  renderMessagesArea(true);
  renderPlayersSidebar();
  renderPlayerSelector();
  renderInventory();
  updateUserChip();
  syncAgeModeSelect();

  // Bestehenden Verlauf rendern
  for (const msg of history) {
    seenMpMessageIds.add(msg.id);
    if (msg.role === 'user' && msg.speaker === 'Erzähler' && msg.content.startsWith('[ERZÄHLER]:')) {
      addNarratorBubble(msg.content.replace(/^\[ERZÄHLER\]:\s*/, ''));
      messages.push({ role: 'user', content: msg.content, speaker: 'Erzähler' });
    } else if (msg.role === 'user' && msg.speaker) {
      const p = players.find((x) => x.name === msg.speaker);
      const prefix = msg.speaker + ':';
      const text = msg.content.startsWith(prefix) ? msg.content.slice(prefix.length).trim() : msg.content;
      addPlayerBubble(msg.speaker, text, p?.color ?? '#888');
      messages.push({ role: 'user', content: msg.content, speaker: msg.speaker });
    } else if (msg.role === 'assistant') {
      const dmBody = addDMBubble('');
      dmBody.textContent = stripGameTags(msg.content);
      messages.push({ role: 'assistant', content: msg.content });
    }
  }
  setStatus(`Multiplayer · Beigetreten: ${mpSession?.code ?? ''}`, 'ok');
}

async function beginAdventure() {
  activePlayerId = players[0].id;
  hideCharModal();
  $<HTMLElement>('#app').hidden = false;

  // Long-Term-Memory: Beats für diesen Scope laden bevor System-Prompt gebaut wird.
  await loadStoryBeatsForCurrentScope();

  messages = [{ role: 'system', content: buildSystemPrompt() }];
  inventory.length = 0;
  quests.length = 0;
  currentLocation = '';
  currentLocationImage = '';
  clearLocationBanner();
  renderInventory();
  renderQuests();
  renderMessagesArea(true);
  renderPlayersSidebar();
  renderPlayerSelector();
  updateUserChip();
  syncAgeModeSelect();

  const intro = adventurePrompt.trim()
    ? `Erzähle die Eröffnungsszene zum Thema: ${adventurePrompt.trim()}.`
    : 'Erzähle die Eröffnungsszene des Abenteuers.';
  void checkLmStudioStatus().then(() => sendToLMStudio(intro, 'Erzähler'));
}

async function resumeGame(save: GameSave) {
  showGodButton();
  ageMode = save.ageMode;
  adventurePrompt = save.adventurePrompt ?? '';
  players = save.players;
  inventory.length = 0;
  inventory.push(...save.inventory);
  quests.length = 0;
  if (save.quests) quests.push(...save.quests);
  currentLocation = save.currentLocation ?? '';
  currentLocationImage = '';
  if (currentLocation) updateLocationBanner(currentLocation);
  activePlayerId = save.activePlayerId || (players[0]?.id ?? '');

  // Long-Term-Memory: Story-Beats für aktuellen Scope laden, BEVOR
  // der System-Prompt gebaut wird (sonst fehlt der Memory-Block).
  await loadStoryBeatsForCurrentScope();

  messages = [{ role: 'system', content: buildSystemPrompt() }];
  for (const m of save.messages) {
    messages.push({ role: m.role, content: m.content, speaker: m.speaker });
  }

  hideCharModal();
  $<HTMLElement>('#app').hidden = false;
  renderMessagesArea(true);

  for (const m of save.messages) {
    if (m.role === 'user' && m.speaker === 'Erzähler' && m.content.startsWith('[ERZÄHLER]:')) {
      addNarratorBubble(m.content.replace(/^\[ERZÄHLER\]:\s*/, ''));
    } else if (m.role === 'user' && m.speaker && m.speaker !== 'Erzähler') {
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
  renderQuests();
  renderPlayersSidebar();
  renderPlayerSelector();
  updateUserChip();
  syncAgeModeSelect();
  setStatus('Fortgesetzt — DM wird geprüft…', 'busy');
  void checkLmStudioStatus();
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
  const speakerPlayer = players.find((p) => p.name === speaker);
  const emoji = speakerPlayer ? classEmoji(speakerPlayer.class) : '⚔️';
  label.textContent = `${emoji} ${speaker}`;
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

function addNarratorBubble(text: string): HTMLDivElement {
  const el = $<HTMLDivElement>('#messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-narrator';
  const label = document.createElement('div');
  label.className = 'msg-label msg-label-narrator';
  label.textContent = '🎭 Erzähler';
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(label);
  wrap.appendChild(body);
  el.appendChild(wrap);
  el.scrollTop = el.scrollHeight;
  return body;
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
let lastSuccessToastAt = 0;
const SUCCESS_TOAST_THROTTLE_MS = 60_000; // max 1× pro Minute
function showSaveToast(text: string = '💾 Gespeichert', isError: boolean = false) {
  // Erfolgs-Toasts drosseln — sonst Spam bei jedem Auto-Save.
  if (!isError) {
    const now = Date.now();
    if (now - lastSuccessToastAt < SUCCESS_TOAST_THROTTLE_MS) return;
    lastSuccessToastAt = now;
  }
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

// Toast für "Neue App-Version verfügbar" (Service Worker).
function showUpdateToast(newWorker: ServiceWorker) {
  let toast = document.getElementById('update-toast') as HTMLDivElement | null;
  if (toast) return; // schon offen
  toast = document.createElement('div');
  toast.id = 'update-toast';
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>✨ Neue Version verfügbar</span>
    <button type="button" id="update-reload-btn">Neu laden</button>
    <button type="button" id="update-dismiss-btn" title="Später">✕</button>
  `;
  document.body.appendChild(toast);
  toast.querySelector('#update-reload-btn')?.addEventListener('click', () => {
    // SW soll jetzt aktivieren — controllerchange-Listener reloadt automatisch
    newWorker.postMessage({ type: 'skip-waiting' });
  });
  toast.querySelector('#update-dismiss-btn')?.addEventListener('click', () => {
    toast?.remove();
  });
  // Animation rein
  requestAnimationFrame(() => toast?.classList.add('show'));
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(LOCAL_MODELS_URL, { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
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

async function pingCloud(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    if (CLOUD_BACKEND === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return res.ok;
    }
    const res = await fetch('https://text.pollinations.ai/models', {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function checkLmStudioStatus() {
  if (import.meta.env.DEV) {
    const status = await pingLmStudio();
    if (status.ok) {
      lmProvider = 'local';
      setStatus(`Lokal · ${status.modelId ?? 'Modell'}`, 'ok');
      return;
    }
  }

  const cloudOk = await pingCloud();
  if (cloudOk) {
    lmProvider = 'cloud';
    setStatus(`Cloud · ${CLOUD_LABEL} (${CLOUD_MODEL})`, 'ok');
    return;
  }

  lmProvider = 'unknown';
  if (import.meta.env.DEV) {
    addErrorBubble(
      '⚠ Kein DM erreichbar. Entweder LM Studio starten (Tab "Local Server" → "Start Server") ' +
      'oder Internet-Verbindung prüfen (für Cloud-Modus via Pollinations.ai).',
    );
  } else {
    addErrorBubble(
      '⚠ Cloud-DM nicht erreichbar. Prüfe deine Internet-Verbindung und versuche es gleich nochmal.',
    );
  }
  setStatus('DM offline', 'error');
}

const HEAD_KEEP = 6;
const TAIL_KEEP = 24;

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

  const useSpeakerPrefix = !isTinyModel() && players.length > 1;
  const decorated =
    speaker === 'Erzähler' || !useSpeakerPrefix
      ? userText
      : `${speaker}: ${userText}`;
  messages.push({ role: 'user', content: decorated, speaker });

  // MP-Sync: User-Message zu Supabase pushen
  if (mpSession) {
    void mpAddMessage({
      sessionId: mpSession.id,
      role: 'user',
      speaker,
      content: decorated,
    }).catch((err) => console.warn('MP message push fehlgeschlagen:', err));
  }

  if (speaker === 'Erzähler') {
    // Wenn die Erzähler-Eingabe vom User kam (manuell, mit [ERZÄHLER]: prefix),
    // sichtbar machen. Wenn intern (z.B. Eröffnungs-Prompt), still senden.
    if (userText.startsWith('[ERZÄHLER]:')) {
      addNarratorBubble(userText.replace(/^\[ERZÄHLER\]:\s*/, ''));
    }
  } else {
    const p = players.find((x) => x.name === speaker);
    addPlayerBubble(speaker, userText, p?.color ?? '#888');
  }

  messages[0] = { role: 'system', content: buildSystemPrompt() };

  playSend();
  const dmBody = addDMBubble('');
  playDMStart();
  let fullText = '';
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  if (lmProvider === 'unknown') {
    await checkLmStudioStatus();
  }
  const useCloud = lmProvider === 'cloud';
  const cloud = getCloudConfig();
  const apiUrl = useCloud ? cloud.url : LOCAL_API_URL;
  const modelId = useCloud ? cloud.model : (knownModelId ?? 'local-model');
  const tiny = !useCloud && isTinyModel();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useCloud && cloud.backend === 'groq' && GROQ_API_KEY) {
    headers.Authorization = `Bearer ${GROQ_API_KEY}`;
  }
  // Status zeigen falls wir gerade auf Pollinations zurückgefallen sind
  if (useCloud && activeCloudBackend === 'groq' && cloud.backend === 'pollinations') {
    setStatus(`Cloud · Pollinations (Groq cooldown)`, 'busy');
  }

  try {
    // Reasoning-Modelle (qwen-qwq, deepseek-r1) brauchen mehr Tokens für ihren CoT.
    const isReasoningModel = useCloud && /qwq|r1-distill|reasoning/i.test(modelId);
    const cloudMaxTokens = isReasoningModel ? 2000 : 1200;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: trimHistory().map(({ role, content }) => ({ role, content })),
        stream: true,
        temperature: tiny ? 0.7 : 0.9,
        top_p: 0.95,
        max_tokens: tiny ? 150 : useCloud ? cloudMaxTokens : 300,
        presence_penalty: tiny ? 0.8 : 0.4,
        frequency_penalty: tiny ? 0.7 : 0.2,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      let detail = '';
      try {
        const text = await response.text();
        detail = text.slice(0, 200);
      } catch { /* ignore */ }
      const err = new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isSse = contentType.includes('event-stream') || contentType.includes('text/plain');

    if (!isSse) {
      const json = await response.json().catch(() => null) as
        | { choices?: Array<{ message?: { content?: string }; text?: string }> }
        | null;
      const text = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? '';
      if (text) {
        fullText = text;
        dmBody.textContent = fullText;
        $<HTMLDivElement>('#messages').scrollTop = $<HTMLDivElement>('#messages').scrollHeight;
      }
    } else {
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
    }
    if (!fullText.trim()) {
      dmBody.parentElement?.remove();
      messages.pop();
      addErrorBubble('⚠ Der DM hat nichts gesagt. Versuch es nochmal.');
      setStatus('Leere Antwort', 'error');
      return;
    }
    messages.push({ role: 'assistant', content: fullText });

    // MP-Sync: DM-Antwort nur vom Host pushen (sonst doppelt wenn beide
    // Spieler die KI fragen). Der Host-Stream ist die "kanonische" Antwort.
    if (mpSession && mpIsHost) {
      void mpAddMessage({
        sessionId: mpSession.id,
        role: 'assistant',
        content: fullText,
      }).catch((err) => console.warn('MP assistant push fehlgeschlagen:', err));
    }

    parseInventory(fullText);
    parseInventoryLoss(fullText);
    parseDamage(fullText);
    parseHeal(fullText);
    parseQuests(fullText);
    parseLocation(fullText);
    parseStoryBeats(fullText);
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
    // DM-Antwort vorlesen (wenn Voice aktiv) — Tags werden vorher gestrippt
    speak(stripGameTags(fullText));
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

    let errMsg: string;
    const httpStatus = (err as Error & { status?: number })?.status;
    if (lmProvider === 'cloud') {
      const currentBackend = getCloudBackend();
      const currentLabel = currentBackend === 'groq' ? 'Groq' : 'Pollinations';
      if (httpStatus === 401 || httpStatus === 403) {
        errMsg = `⚠ ${currentLabel} lehnt den API-Key ab (HTTP ${httpStatus}). VITE_GROQ_API_KEY in .env prüfen.`;
        setStatus('Cloud-Auth-Fehler', 'error');
      } else if (httpStatus === 429) {
        // Auto-Fallback: Groq rate-limited → vorübergehend Pollinations nutzen
        if (currentBackend === 'groq') {
          groqRateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          errMsg = `⚠ Groq rate-limited (Free-Tier). Wechsle automatisch auf Pollinations für ~60 Sek. Klick "Nochmal versuchen".`;
          setStatus('Wechsel auf Pollinations…', 'busy');
        } else {
          errMsg = `⚠ ${currentLabel} meldet "Rate Limit". Kurz warten (~10s) und nochmal versuchen.`;
          setStatus('Cloud rate-limited', 'error');
        }
      } else if (httpStatus && httpStatus >= 500) {
        errMsg = `⚠ ${CLOUD_LABEL} hat ein Server-Problem (HTTP ${httpStatus}). In ein paar Sekunden nochmal probieren.`;
        setStatus('Cloud-Server-Fehler', 'error');
      } else if (httpStatus === 400 || httpStatus === 404) {
        const hint = CLOUD_BACKEND === 'groq'
          ? 'Anderes Modell in .env (z.B. llama-3.1-8b-instant, mixtral-8x7b-32768).'
          : 'Anderes Modell in .env probieren (openai · openai-large · mistral · llama).';
        errMsg = `⚠ Modell "${CLOUD_MODEL}" wird nicht akzeptiert (HTTP ${httpStatus}). ${hint}`;
        setStatus('Cloud-Modell-Fehler', 'error');
      } else {
        const cloudOk = await pingCloud();
        if (!cloudOk) {
          errMsg = '⚠ Cloud-DM (Pollinations) nicht erreichbar. Internet-Verbindung prüfen.';
          setStatus('Cloud offline', 'error');
        } else {
          errMsg = `⚠ Cloud-DM Fehler: ${(err as Error)?.message ?? 'unbekannt'}. Versuch es nochmal.`;
          setStatus('Cloud-Fehler', 'error');
        }
      }
    } else {
      const status = await pingLmStudio();
      if (status.reason === 'unreachable') {
        const cloudOk = await pingCloud();
        if (cloudOk) {
          lmProvider = 'cloud';
          errMsg = '⚠ LM Studio offline — wechsle zu Cloud-DM (Pollinations). Klick "Nochmal versuchen".';
          setStatus(`Cloud · ${CLOUD_LABEL} (${CLOUD_MODEL})`, 'ok');
        } else {
          errMsg = '⚠ Weder LM Studio noch Cloud erreichbar. LM Studio starten oder Internet prüfen.';
          setStatus('DM offline', 'error');
        }
      } else if (status.reason === 'no-model') {
        errMsg = '⚠ LM Studio läuft, aber kein Modell geladen. Lade ein Modell im Chat-Tab.';
        setStatus('Kein Modell', 'error');
      } else {
        errMsg = `⚠ Verbindungsfehler: ${(err as Error)?.message ?? 'unbekannt'}`;
        setStatus('Fehler', 'error');
      }
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
  playDiceRoll();
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
  if (requests.length > 0) playDiceRequest();
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
    playItemPickup();
    renderInventory();
    // MP-Sync: nur Host pusht Inventar-Adds
    if (mpSession && mpIsHost) {
      const regex = /\[ITEM:\s*([^\]]+)\]/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const name = m[1].trim();
        if (name) void mpAddInventoryItem(mpSession.id, name).catch(() => {});
      }
    }
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
  if (changed) {
    playItemLost();
    renderInventory();
  }
}

function findPlayerByName(name: string): Player | undefined {
  const needle = name.trim().toLowerCase();
  return (
    players.find((p) => p.name.toLowerCase() === needle) ??
    players.find((p) => p.name.toLowerCase().startsWith(needle)) ??
    players.find((p) => needle.startsWith(p.name.toLowerCase()))
  );
}

// ⚔ Floating-Number-Animation auf einer Player-Card.
// kind = 'dmg' (rot, -) oder 'heal' (grün, +).
function spawnFloatNumber(playerId: string, amount: number, kind: 'dmg' | 'heal') {
  const card = document.querySelector(`.player-card[data-id="${playerId}"]`);
  if (!card) return;
  const el = document.createElement('div');
  el.className = `float-number ${kind}`;
  el.textContent = kind === 'dmg' ? `-${amount}` : `+${amount}`;
  card.appendChild(el);
  // Card-Shake + Flash bei Treffer
  if (kind === 'dmg') {
    card.classList.remove('hit', 'flash');
    // Reflow erzwingen, damit Animation neu startet
    void (card as HTMLElement).offsetWidth;
    card.classList.add('hit', 'flash');
  }
  window.setTimeout(() => el.remove(), 1200);
}

// Bildschirm-Shake bei großem Treffer (>15 HP).
function triggerScreenShake() {
  document.body.classList.remove('crit-shake');
  void document.body.offsetWidth;
  document.body.classList.add('crit-shake');
  window.setTimeout(() => document.body.classList.remove('crit-shake'), 450);
}

// ─── Quest-Log ───────────────────────────────────────────────
// DM markiert neue Aufträge mit [QUEST: <Text>] und erledigte mit
// [QUEST-ERFOLG: <Suchwort>]. Suchwort = beliebige Wörter aus dem
// ursprünglichen Quest-Text (case-insensitive substring match).

function questId(): string {
  return 'q_' + Math.random().toString(36).slice(2, 8);
}

function addQuest(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Duplikate vermeiden — falls DM denselben Quest-Text wiederholt.
  const existing = quests.find(
    (q) => !q.done && q.text.toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) return;
  quests.push({ id: questId(), text: trimmed, done: false, addedAt: Date.now() });
}

function completeQuestByMatch(needle: string): Quest | null {
  const n = needle.trim().toLowerCase();
  if (!n) return null;
  const open = quests.filter((q) => !q.done);
  const target = open.find((q) => q.text.toLowerCase().includes(n))
    ?? open.find((q) => n.includes(q.text.toLowerCase().slice(0, 12)));
  if (target) {
    target.done = true;
    return target;
  }
  return null;
}

// Kleine "Quest erledigt"-Feier — Sound + dedizierter Toast (umgeht Save-Throttle).
function celebrateQuest(text: string) {
  try { playItemPickup(); } catch { /* */ }
  const short = text.length > 40 ? text.slice(0, 40) + '…' : text;
  let toast = document.getElementById('quest-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'quest-toast';
    toast.className = 'quest-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = `✅ Auftrag erledigt: ${short}`;
  toast.classList.remove('show');
  void toast.offsetWidth; // Reflow → Animation neu starten
  toast.classList.add('show');
  window.setTimeout(() => toast?.classList.remove('show'), 2400);
}

function parseQuests(text: string) {
  let changed = false;
  const addRe = /\[QUEST:\s*([^\]]+?)\s*\]/gi;
  let m: RegExpExecArray | null;
  while ((m = addRe.exec(text)) !== null) {
    const before = quests.length;
    addQuest(m[1]);
    if (quests.length !== before) changed = true;
  }
  const doneRe = /\[QUEST-ERFOLG:\s*([^\]]+?)\s*\]/gi;
  while ((m = doneRe.exec(text)) !== null) {
    const completed = completeQuestByMatch(m[1]);
    if (completed) {
      changed = true;
      celebrateQuest(completed.text);
    }
  }
  if (changed) renderQuests();
}

function renderQuests() {
  const el = document.getElementById('quest-list') as HTMLUListElement | null;
  if (!el) return;
  el.innerHTML = '';
  if (quests.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Aufträge…';
    el.appendChild(li);
    return;
  }
  // Offen zuerst, dann erledigt
  const sorted = [...quests].sort((a, b) => Number(a.done) - Number(b.done));
  for (const q of sorted) {
    const li = document.createElement('li');
    li.className = 'quest-item' + (q.done ? ' quest-done' : '');
    li.textContent = (q.done ? '✔ ' : '◇ ') + q.text;
    el.appendChild(li);
  }
}

// ─── Long-Term-Memory: Story-Beats ───────────────────────────
// Pro Szenario (Solo: user+slot, MP: session) speichern wir kurze
// Erinnerungen die der DM mit [ERINNERN:] markiert. Beim Spielstart
// werden die letzten ~20 Beats in den System-Prompt geprependet.

let loadedStoryBeats: string[] = [];

function currentScopeKey(): string | null {
  if (gameMode !== 'solo' && mpSession) {
    return `mp:${mpSession.id}`;
  }
  if (currentUser) {
    return `solo:${currentUser.toLowerCase()}:${activeSaveSlot}`;
  }
  return null;
}

function parseStoryBeats(text: string) {
  const re = /\[ERINNERN:\s*([^\]]+?)\s*\]/gi;
  let m: RegExpExecArray | null;
  const scope = currentScopeKey();
  while ((m = re.exec(text)) !== null) {
    const beat = m[1].trim();
    if (!beat) continue;
    // Lokal sofort sichtbar (verhindert Doppel-Inserts beim Resume)
    loadedStoryBeats.push(beat);
    if (loadedStoryBeats.length > 30) loadedStoryBeats.shift();
    if (scope) void cloudInsertStoryBeat(scope, beat);
  }
}

async function loadStoryBeatsForCurrentScope() {
  loadedStoryBeats = [];
  const scope = currentScopeKey();
  if (!scope) return;
  try {
    const beats = await cloudListStoryBeats(scope, 20);
    loadedStoryBeats = beats.map((b) => b.content);
  } catch { /* */ }
}

function buildStoryBeatsBlock(): string {
  if (loadedStoryBeats.length === 0) return '';
  const list = loadedStoryBeats.map((b) => `• ${b}`).join('\n');
  return `\n\nVORHER PASSIERT (frühere Erinnerungen — beziehe dich darauf wenn passend):\n${list}\n`;
}

// ─── Karten-Generator ────────────────────────────────────────
// DM markiert neuen Ort mit [ORT: <englischer Beschreibungs-Prompt>].
// Beim ersten Auftauchen wird via Pollinations ein Banner-Bild geholt.

function locationSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000000;
}

function buildLocationImageUrl(loc: string): string {
  const prompt = `dark fantasy landscape painting of ${loc}, cinematic dramatic lighting, mist, detailed atmospheric, no text no watermark`;
  const seed = locationSeed(loc);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=720&height=240&model=flux&seed=${seed}&nologo=true`;
}

function ensureLocationBannerEl(): HTMLDivElement | null {
  let banner = document.getElementById('location-banner') as HTMLDivElement | null;
  if (banner) return banner;
  const messagesEl = document.getElementById('messages');
  if (!messagesEl || !messagesEl.parentElement) return null;
  banner = document.createElement('div');
  banner.id = 'location-banner';
  banner.className = 'location-banner';
  banner.hidden = true;
  messagesEl.parentElement.insertBefore(banner, messagesEl);
  return banner;
}

function updateLocationBanner(loc: string) {
  const banner = ensureLocationBannerEl();
  if (!banner) return;
  const url = buildLocationImageUrl(loc);
  if (currentLocationImage === url) return;
  currentLocationImage = url;
  banner.hidden = false;
  // Skeleton + Label sofort zeigen, Bild lädt asynchron drüber.
  banner.innerHTML = `
    <div class="location-banner-skeleton"></div>
    <img class="location-banner-img" alt="${escapeHtml(loc)}" loading="lazy" />
    <div class="location-banner-label">📍 ${escapeHtml(loc)}</div>
  `;
  const img = banner.querySelector('.location-banner-img') as HTMLImageElement | null;
  if (img) {
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      const skeleton = banner.querySelector('.location-banner-skeleton');
      skeleton?.remove();
    }, { once: true });
    img.addEventListener('error', () => {
      // Wenn das Pollinations-Bild nicht lädt: Banner verstecken statt kaputtem Bild.
      console.warn('[ORT] Bild konnte nicht geladen werden:', url);
      banner.hidden = true;
      currentLocationImage = '';
    }, { once: true });
    img.src = url;
  }
}

function clearLocationBanner() {
  const banner = document.getElementById('location-banner') as HTMLDivElement | null;
  if (banner) {
    banner.hidden = true;
    banner.innerHTML = '';
  }
  currentLocationImage = '';
}

function parseLocation(text: string) {
  // Wenn die DM mehrere [ORT:]-Tags emittiert, nehmen wir den LETZTEN
  // (= der zuletzt betretene Schauplatz innerhalb dieser Antwort).
  const re = /\[ORT:\s*([^\]]+?)\s*\]/gi;
  let m: RegExpExecArray | null;
  let lastLoc: string | null = null;
  while ((m = re.exec(text)) !== null) {
    lastLoc = m[1].trim();
  }
  if (!lastLoc) return;
  if (lastLoc.toLowerCase() === currentLocation.toLowerCase()) return;
  currentLocation = lastLoc;
  updateLocationBanner(lastLoc);
}

function parseDamage(text: string) {
  const regex = /\[SCHADEN:\s*([^\-\]]+?)\s*-\s*(\d{1,3})\s*\]/gi;
  let match;
  let changed = false;
  let knockedOut = false;
  let maxHit = 0;
  const animations: Array<{ id: string; amount: number }> = [];
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const target = findPlayerByName(name);
    const amount = parseInt(match[2], 10);
    if (target && amount > 0) {
      const wasAlive = target.hp > 0;
      const actualHit = Math.min(amount, target.hp);
      target.hp = Math.max(0, target.hp - amount);
      if (wasAlive && target.hp === 0) knockedOut = true;
      animations.push({ id: target.id, amount });
      if (actualHit > maxHit) maxHit = actualHit;
      changed = true;
    } else if (!target) {
      console.warn(`[Tag-Parser] [SCHADEN: ${name}] — kein Held mit diesem Namen, ignoriert.`);
    }
  }
  if (changed) {
    if (knockedOut) playKnockout();
    else playDamage();
    renderPlayersSidebar();
    // Animationen erst nach dem Re-Render auslösen, damit die Cards existieren.
    requestAnimationFrame(() => {
      for (const a of animations) spawnFloatNumber(a.id, a.amount, 'dmg');
    });
    if (maxHit >= 15) triggerScreenShake();
  }
}

function parseHeal(text: string) {
  const regex = /\[HEILUNG:\s*([^\+\]]+?)\s*\+\s*(\d{1,3})\s*\]/gi;
  let match;
  let changed = false;
  const animations: Array<{ id: string; amount: number }> = [];
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const target = findPlayerByName(name);
    const amount = parseInt(match[2], 10);
    if (target && amount > 0) {
      target.hp = Math.min(target.maxHp, target.hp + amount);
      animations.push({ id: target.id, amount });
      changed = true;
    } else if (!target) {
      console.warn(`[Tag-Parser] [HEILUNG: ${name}] — kein Held mit diesem Namen, ignoriert.`);
    }
  }
  if (changed) {
    playHeal();
    renderPlayersSidebar();
    requestAnimationFrame(() => {
      for (const a of animations) spawnFloatNumber(a.id, a.amount, 'heal');
    });
  }
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
    .replace(/\[QUEST(?:-ERFOLG)?:\s*[^\]]+\]/gi, '')
    .replace(/\[ORT:\s*[^\]]+\]/gi, '')
    .replace(/\[ERINNERN:\s*[^\]]+\]/gi, '')
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
    // Pulsierender roter Rand wenn HP < 25% (aber noch lebendig).
    else if (p.maxHp > 0 && p.hp / p.maxHp < 0.25) li.classList.add('low-hp');

    const downedBadge = p.hp === 0
      ? '<div class="downed-badge">💀 Bewusstlos</div>'
      : '';

    li.innerHTML = `
      <div class="player-card-row">
        <img class="player-avatar"
             src="${getAvatarUrl(p)}"
             alt="${escapeHtml(p.name)}"
             onerror="this.classList.add('avatar-failed')" />
        <div class="player-card-info">
          <div class="player-card-head">
            <span class="player-card-name">${escapeHtml(p.name)}</span>
            <span class="player-card-class">${classEmoji(p.class)} ${escapeHtml(p.class)}</span>
          </div>
          <div class="hp-row"><span>${p.hp}</span> / <span>${p.maxHp}</span> HP</div>
          <div class="hp-bar-outer"><div class="hp-bar-inner" style="width: ${Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100))}%"></div></div>
        </div>
      </div>
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
    opt.textContent = `${classEmoji(p.class)} ${p.name}`;
    if (p.id === activePlayerId) opt.selected = true;
    sel.appendChild(opt);
  });
  // Erzähler-Option: User kann selbst die Story lenken (außerhalb der Helden-Rolle)
  const narrator = document.createElement('option');
  narrator.value = '__narrator__';
  narrator.textContent = '🎭 Erzähler (Story lenken)';
  sel.appendChild(narrator);
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
    if (sel.value === '__narrator__') {
      // Narrator-Modus: keinen activePlayerId ändern, nur Placeholder anpassen
      input.placeholder = 'Story-Anweisung an den DM (z.B. "Ein Magier erscheint")';
    } else {
      activePlayerId = sel.value;
      input.placeholder = 'Was tust du? (Enter = Senden, Shift+Enter = neue Zeile)';
      renderPlayersSidebar();
    }
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
    if (sel.value === '__narrator__') {
      // Story-Anweisung — wird mit [ERZÄHLER]: prefix gesendet damit DM weiß
      // dass es keine Helden-Aktion ist
      input.value = '';
      sendToLMStudio(`[ERZÄHLER]: ${text}`, 'Erzähler');
      return;
    }
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
    showGodButton(); // Versteckt den Gott-Knopf — currentUser ist jetzt null
    closeGodModal();
    players = [];
    messages = [];
    inventory.length = 0;
    quests.length = 0;
    currentLocation = '';
    currentLocationImage = '';
    clearLocationBanner();
    renderQuests();
    adventurePrompt = '';
    activePlayerId = '';
    activeFormPlayerId = '';
    $<HTMLElement>('#app').hidden = true;
    showLoginScreen();
  });

  const newRunBtn = document.getElementById('new-run-btn') as HTMLButtonElement | null;
  newRunBtn?.addEventListener('click', () => {
    if (!confirm('Neue Runde starten? Der aktuelle Spielstand und die Erinnerungen gehen verloren.')) return;
    currentAbortController?.abort();
    // Long-Term-Memory für diesen Scope ebenfalls löschen — sonst bleibt
    // die alte Welt-Erinnerung im neuen Spiel hängen.
    const scope = currentScopeKey();
    if (scope) void cloudClearStoryBeats(scope);
    loadedStoryBeats = [];
    clearGame();
    players = [];
    messages = [];
    inventory.length = 0;
    quests.length = 0;
    currentLocation = '';
    currentLocationImage = '';
    clearLocationBanner();
    renderQuests();
    adventurePrompt = '';
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

  const langSel = document.getElementById('dm-lang') as HTMLSelectElement | null;
  if (langSel) {
    langSel.value = dmLang;
    langSel.addEventListener('change', () => {
      dmLang = langSel.value as DmLang;
      try { localStorage.setItem('valdermoor:dmLang', dmLang); } catch { /* */ }
      // Optional: kurzes feedback
      setStatus(`Sprache: ${dmLang.toUpperCase()}`, 'ok');
    });
  }

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

  const pdfBtn = document.getElementById('pdf-btn') as HTMLButtonElement | null;
  pdfBtn?.addEventListener('click', printAdventureAsPdf);
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
// PDF-Export — via window.print() + dynamisch gerendertes Print-Layout
// ────────────────────────────────────────────────────────────

function printAdventureAsPdf() {
  if (players.length === 0) {
    alert('Es gibt noch nichts zu exportieren — fang erst eine Runde an.');
    return;
  }

  // Print-Container bauen (wird nur beim Drucken sichtbar via @media print)
  const oldPrintArea = document.getElementById('print-area');
  if (oldPrintArea) oldPrintArea.remove();

  const printArea = document.createElement('div');
  printArea.id = 'print-area';
  printArea.innerHTML = `
    <div class="print-header">
      <h1>⚔ VALDERMOOR</h1>
      <p class="print-meta">
        ${new Date().toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
        · Modus: ${ageMode}
        ${adventurePrompt.trim() ? ` · Thema: ${escapeHtml(adventurePrompt.trim())}` : ''}
      </p>
    </div>

    <h2>Helden</h2>
    <div class="print-heroes">
      ${players.map((p) => `
        <div class="print-hero">
          <div class="print-hero-head">
            <span class="print-hero-name">${classEmoji(p.class)} ${escapeHtml(p.name)}</span>
            <span class="print-hero-class">${escapeHtml(p.class)}</span>
          </div>
          <div class="print-hp">HP: ${p.hp} / ${p.maxHp}${p.hp === 0 ? ' — BEWUSSTLOS' : ''}</div>
          <table class="print-stats">
            <tr>
              ${STAT_KEYS.map((k) => `<th>${k}</th>`).join('')}
            </tr>
            <tr>
              ${STAT_KEYS.map((k) => `<td>${p.stats[k]}</td>`).join('')}
            </tr>
          </table>
        </div>
      `).join('')}
    </div>

    <h2>Inventar</h2>
    ${inventory.length === 0
      ? '<p class="print-empty">Inventar ist leer.</p>'
      : `<ul class="print-inventory">${inventory.map((i) =>
          `<li>${escapeHtml(i.name)}${i.quantity > 1 ? ` <span class="qty">×${i.quantity}</span>` : ''}</li>`,
        ).join('')}</ul>`
    }

    <h2>Abenteuer-Verlauf</h2>
    <div class="print-story">
      ${messages.slice(1).map((m) => {
        if (m.role === 'user' && m.speaker === 'Erzähler' && m.content.startsWith('[ERZÄHLER]:')) {
          const text = m.content.replace(/^\[ERZÄHLER\]:\s*/, '');
          return `<div class="print-narrator"><strong>🎭 Erzähler:</strong> <em>${escapeHtml(text)}</em></div>`;
        }
        if (m.role === 'user' && m.speaker && m.speaker !== 'Erzähler') {
          const speaker = m.speaker;
          const prefix = speaker + ':';
          const text = m.content.startsWith(prefix) ? m.content.slice(prefix.length).trim() : m.content;
          const p = players.find((x) => x.name === speaker);
          return `<div class="print-player">
            <strong>${p ? classEmoji(p.class) : '⚔'} ${escapeHtml(speaker)}:</strong> ${escapeHtml(text)}
          </div>`;
        }
        if (m.role === 'assistant') {
          return `<div class="print-dm">
            <strong>🧙 Dungeon Master:</strong> ${escapeHtml(stripGameTags(m.content))}
          </div>`;
        }
        return '';
      }).join('')}
    </div>

    <div class="print-footer">
      <p>Generiert mit <strong>Valdermoor</strong> — valdermoor.vercel.app</p>
      <p>Spieler: ${currentUser ?? 'unbekannt'}</p>
    </div>
  `;
  document.body.appendChild(printArea);

  // Browser-Druckdialog öffnen — User wählt "Als PDF speichern"
  // Tipp im Modal vor dem Druck
  setTimeout(() => {
    window.print();
    // Cleanup nach dem Druck
    setTimeout(() => printArea.remove(), 1000);
  }, 100);
}

// ────────────────────────────────────────────────────────────
// Update-Check — bei Start prüfen ob neue Version auf GitHub
// ────────────────────────────────────────────────────────────

const UPDATE_DISMISSED_KEY = 'valdermoor:updateDismissed';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

async function checkForUpdates() {
  // Im Dev-Modus skippen
  if (import.meta.env.DEV) return;
  if (APP_VERSION === 'dev') return;

  try {
    const res = await fetch('https://api.github.com/repos/genben-sb3/valdermoor/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const data = await res.json() as { tag_name?: string; html_url?: string; name?: string };
    const latestTag = (data.tag_name ?? '').replace(/^v/, '');
    if (!latestTag) return;

    if (compareVersions(latestTag, APP_VERSION) > 0) {
      // User hat diese Version vielleicht schon weggeklickt
      const dismissedFor = localStorage.getItem(UPDATE_DISMISSED_KEY);
      if (dismissedFor === latestTag) return;
      showUpdateBanner(latestTag, data.html_url ?? 'https://github.com/genben-sb3/valdermoor/releases/latest');
    }
  } catch {
    // Netzwerk-Fehler oder Rate-Limit → still ignorieren
  }
}

function showUpdateBanner(newVersion: string, releaseUrl: string) {
  // Doppelte Banner verhindern
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span class="ub-icon">🔔</span>
    <div class="ub-text">
      <strong>Neue Version v${newVersion}</strong> verfügbar
      <span class="ub-current">(du hast v${APP_VERSION})</span>
    </div>
    <a class="ub-btn" href="/install.html" target="_blank" rel="noopener">📥 Update holen</a>
    <a class="ub-btn-secondary" href="${releaseUrl}" target="_blank" rel="noopener" title="Was ist neu? Release-Notes auf GitHub">📖 Was ist neu</a>
    <button type="button" class="ub-close" title="Bis zur nächsten Version verstecken">✕</button>
  `;

  banner.querySelector('.ub-close')?.addEventListener('click', () => {
    try { localStorage.setItem(UPDATE_DISMISSED_KEY, newVersion); } catch { /* */ }
    banner.classList.add('ub-hide');
    setTimeout(() => banner.remove(), 300);
  });

  document.body.appendChild(banner);
}

// ────────────────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────────────────

// Einmalige Migration: alter Username 'ben' wird zu 'admin'.
// Läuft bei jedem Start im Hintergrund — idempotent.
async function migrateBenToAdmin(): Promise<void> {
  // Lokale Migration
  try {
    const accounts = loadAccounts();
    const oldAcct = accounts[LEGACY_ADMIN_USERNAME];
    if (oldAcct && !accounts['admin']) {
      // Sicherheitscheck: nur migrieren wenn die E-Mail zum bekannten Admin-Konto passt.
      if (oldAcct.email.toLowerCase() === HONEYTRAP_EMAIL.toLowerCase()) {
        const renamed: StoredAccount = { ...oldAcct, username: 'admin' };
        delete accounts[LEGACY_ADMIN_USERNAME];
        accounts['admin'] = renamed;
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

        // Spielstand-Key umbenennen
        const oldGameKey = GAME_KEY_PREFIX + LEGACY_ADMIN_USERNAME;
        const oldSave = localStorage.getItem(oldGameKey);
        if (oldSave) {
          localStorage.setItem(GAME_KEY_PREFIX + 'admin', oldSave);
          localStorage.removeItem(oldGameKey);
        }

        // Session-Pointer umbiegen
        const sess = localStorage.getItem(SESSION_KEY);
        if (sess && sess.toLowerCase() === LEGACY_ADMIN_USERNAME) {
          localStorage.setItem(SESSION_KEY, 'admin');
        }

        // Login-Fehlversuche unter altem Namen fallen lassen
        const fails = loadLoginAttempts();
        if (fails[LEGACY_ADMIN_USERNAME]) {
          delete fails[LEGACY_ADMIN_USERNAME];
          saveLoginAttempts(fails);
        }
        console.log('✅ Account "ben" lokal zu "admin" migriert');
      }
    }
  } catch (e) {
    console.warn('Lokale Migration "ben" → "admin" fehlgeschlagen:', e);
  }

  // Cloud-Migration — best effort, blockiert die App nicht.
  try {
    const result = await cloudRenameAccount(LEGACY_ADMIN_USERNAME, 'admin', 'admin');
    if (result.ok) {
      console.log('✅ Cloud-Account "ben" zu "admin" migriert');
    } else if (
      result.reason &&
      result.reason !== 'old-missing' &&
      result.reason !== 'target-exists' &&
      result.reason !== 'no-cloud'
    ) {
      console.warn('Cloud-Migration "ben" → "admin":', result.reason);
    }
  } catch (e) {
    console.warn('Cloud-Migration "ben" → "admin":', e);
  }
}

function init() {
  // Migration läuft im Hintergrund — Login-Screen wird sofort gezeigt
  void migrateBenToAdmin();

  setupLoginTabs();
  setupLoginForm();
  setupRegisterForm();
  setupEmailCodeModal();
  setupModal();
  setupDiceButtons();
  setupInputForm();
  setupModelSwitcher();
  setupVoiceToggle();
  setupSoundToggle();
  setupModeModal();
  setupJoinModal();
  setupLobbyModal();
  setupGodMode();
  setupSlotModal();

  // 💀 Broadcast-Listener: wenn Admin Server-Shutdown triggert, sehen ALLE
  // anderen User die creepy Animation und können nur mit Admin-Pwd entkommen
  subscribeToGlobalEvents({
    onShutdown: () => {
      const isAdmin = currentUser?.toLowerCase() === 'admin';
      showGlitchOverlay({ allowOverride: !isAdmin });  // andere brauchen Pwd
    },
  });

  window.addEventListener('beforeunload', () => {
    currentAbortController?.abort();
    saveGame();
  });

  // Service Worker registrieren — App offline-fähig + schneller Start
  // Nur in Production (sonst kollidiert mit Vite-HMR)
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Wenn SW eine neue Version findet, "Update available"-Toast zeigen.
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(newWorker);
            }
          });
        });
        // Alle 30 Min nach Updates suchen, falls Tab lange offen bleibt.
        setInterval(() => { reg.update().catch(() => { /* */ }); }, 30 * 60_000);
      }).catch((err) => {
        console.warn('Service Worker Registration fehlgeschlagen:', err);
      });
      // Wenn der neue SW gewonnen hat (clients.claim), Tab automatisch reload.
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'sw-updated') {
          console.log('🔄 Service Worker aktualisiert auf', e.data.version);
        }
      });
    });
  }

  window.addEventListener('online', () => {
    if (lmProvider !== 'local') {
      void checkLmStudioStatus();
    }
  });

  window.addEventListener('offline', () => {
    if (lmProvider === 'cloud') {
      lmProvider = 'unknown';
      setStatus('Offline — keine Internetverbindung', 'error');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const help = document.getElementById('help-modal') as HTMLDivElement | null;
      if (help && !help.hidden) { help.hidden = true; e.preventDefault(); return; }
      // Email-Code-Modal absichtlich NICHT bei ESC schließen — User soll
      // bewusst auf "Abbrechen" klicken müssen, sonst geht der Code verloren.
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
    showGodButton();
    startInactivityLock();
    hideLoginScreen();
    const save = loadGame();
    if (save) {
      void resumeGame(save);
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

document.addEventListener('DOMContentLoaded', () => {
  init();
  // Update-Check 3 Sek nach Start (nicht beim ersten Render)
  window.setTimeout(() => void checkForUpdates(), 3000);
});
