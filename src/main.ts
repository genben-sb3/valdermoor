import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type StatKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

interface Character {
  name: string;
  class: string;
  hp: number;
  maxHp: number;
  stats: Record<StatKey, number>;
}

interface InventoryItem {
  name: string;
  quantity: number;
}

const API_URL = 'http://localhost:1234/v1/chat/completions';

const STAT_KEYS: StatKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

const KNOWN_CLASSES = [
  'Krieger',
  'Magier',
  'Zauberer',
  'Dieb',
  'Schurke',
  'Waldläufer',
  'Kleriker',
  'Barde',
  'Paladin',
  'Druide',
  'Mönch',
  'Hexenmeister',
];

const ENGLISH_TO_GERMAN_CLASS: Record<string, string> = {
  fighter: 'Krieger',
  barbarian: 'Krieger',
  wizard: 'Magier',
  sorcerer: 'Zauberer',
  rogue: 'Dieb',
  thief: 'Dieb',
  ranger: 'Waldläufer',
  cleric: 'Kleriker',
  bard: 'Barde',
  paladin: 'Paladin',
  druid: 'Druide',
  monk: 'Mönch',
  warlock: 'Hexenmeister',
};

function buildSystemPrompt(c: Character): string {
  const statsLine = STAT_KEYS.map((k) => `${k} ${c.stats[k]}`).join(', ');
  return [
    `Du bist Dungeon Master in Valdermoor. Regeln:`,
    `1. Antworte NUR auf Deutsch, max. 3 Sätze.`,
    `2. Würfel-Aufforderung: [WÜRFEL: W20]. Fundgegenstand: [ITEM: Kurzschwert].`,
    `3. Bleib immer im Rollenspiel. Keine Meta-Kommentare, keine "Entschuldigung".`,
    `4. Sprich den Spieler mit "du" an.`,
    ``,
    `Der Spieler:`,
    `- Name: ${c.name}`,
    `- Klasse: ${c.class}`,
    `- Lebenspunkte: ${c.hp}/${c.maxHp}`,
    `- Werte: ${statsLine}`,
  ].join('\n');
}

const character: Character = {
  name: 'Held',
  class: 'Krieger',
  hp: 20,
  maxHp: 20,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
};

const messages: Message[] = [];
const inventory: InventoryItem[] = [];

let isGenerating = false;

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const $$ = <T extends HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll(sel)) as T[];

const messagesEl = $<HTMLDivElement>('#messages');
const inputEl = $<HTMLTextAreaElement>('#input');
const inputForm = $<HTMLFormElement>('#input-form');
const sendBtn = $<HTMLButtonElement>('#send-btn');
const statusEl = $<HTMLDivElement>('#status');
const diceResultEl = $<HTMLDivElement>('#dice-result');
const inventoryListEl = $<HTMLUListElement>('#inventory-list');

const modalEl = $<HTMLDivElement>('#char-modal');
const pdfInputEl = $<HTMLInputElement>('#pdf-input');
const pdfStatusEl = $<HTMLSpanElement>('#pdf-status');
const pdfTextWrapperEl = $<HTMLDetailsElement>('#pdf-text-wrapper');
const pdfTextEl = $<HTMLPreElement>('#pdf-text');
const startBtnEl = $<HTMLButtonElement>('#start-btn');
const rollStatsBtnEl = $<HTMLButtonElement>('#roll-stats-btn');
const formNameEl = $<HTMLInputElement>('#form-name');
const formClassEl = $<HTMLSelectElement>('#form-class');
const formHpEl = $<HTMLInputElement>('#form-hp');

function addMessageBubble(
  role: 'user' | 'assistant',
  text = '',
): HTMLDivElement {
  const bubble = document.createElement('div');
  bubble.className = `msg msg-${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function setStatus(text: string, kind: 'ok' | 'error' | 'busy') {
  statusEl.textContent = text;
  statusEl.className = `status-${kind}`;
}

async function sendToLMStudio(userText: string) {
  if (isGenerating) return;
  isGenerating = true;
  sendBtn.disabled = true;
  setStatus('Der DM denkt nach…', 'busy');

  messages.push({ role: 'user', content: userText });
  if (userText.trim()) addMessageBubble('user', userText);

  const dmBubble = addMessageBubble('assistant', '');
  let fullText = '';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local-model',
        messages,
        stream: true,
        temperature: 0.8,
        max_tokens: 150,
      }),
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
            dmBubble.textContent = fullText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    messages.push({ role: 'assistant', content: fullText });
    parseInventory(fullText);
    setStatus('Bereit', 'ok');
  } catch (err) {
    console.error(err);
    dmBubble.textContent =
      '⚠ DM-Server nicht erreichbar. Läuft C:\\llama\\start-server.bat auf Port 1234?';
    dmBubble.classList.add('msg-error');
    setStatus('Keine Verbindung', 'error');
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

function rollDice(sides: number) {
  const result = Math.floor(Math.random() * sides) + 1;
  diceResultEl.textContent = `W${sides} → ${result}`;
  diceResultEl.classList.remove('rolling');
  void diceResultEl.offsetWidth;
  diceResultEl.classList.add('rolling');

  const phrase = `Ich würfle eine ${result} auf dem W${sides}.`;
  if (inputEl.value.trim()) {
    inputEl.value = inputEl.value.trimEnd() + ' ' + phrase;
  } else {
    inputEl.value = phrase;
  }
  inputEl.focus();
}

function parseInventory(text: string) {
  const regex = /\[ITEM:\s*([^\]]+)\]/gi;
  let match;
  let changed = false;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    const existing = inventory.find(
      (i) => i.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) existing.quantity += 1;
    else inventory.push({ name, quantity: 1 });
    changed = true;
  }
  if (changed) renderInventory();
}

function renderInventory() {
  inventoryListEl.innerHTML = '';
  if (inventory.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch nichts dabei…';
    inventoryListEl.appendChild(li);
    return;
  }
  for (const item of inventory) {
    const li = document.createElement('li');
    li.textContent =
      item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
    inventoryListEl.appendChild(li);
  }
}

function updateCharacterPanel() {
  $<HTMLDivElement>('#char-name').textContent = character.name;
  $<HTMLDivElement>('#char-class').textContent = character.class;
  $<HTMLSpanElement>('#char-hp').textContent = String(character.hp);
  $<HTMLSpanElement>('#char-max-hp').textContent = String(character.maxHp);
  for (const k of STAT_KEYS) {
    const el = $<HTMLSpanElement>(`#stat-${k}`);
    if (el) el.textContent = String(character.stats[k]);
  }
  const pct = Math.max(
    0,
    Math.min(100, (character.hp / character.maxHp) * 100),
  );
  $<HTMLDivElement>('#char-hp-bar').style.width = `${pct}%`;
}

function rollStat(): number {
  const rolls = [0, 0, 0, 0].map(() => Math.floor(Math.random() * 6) + 1);
  rolls.sort((a, b) => b - a);
  return rolls[0] + rolls[1] + rolls[2];
}

function rollAllStatsIntoForm() {
  for (const k of STAT_KEYS) {
    const el = $<HTMLInputElement>(`#form-${k}`);
    if (el) el.value = String(rollStat());
  }
}

async function extractPdfText(file: File): Promise<string> {
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
    if (candidate.length >= 2 && candidate.length <= 50) {
      result.name = candidate;
    }
  }

  for (const c of KNOWN_CLASSES) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(text)) {
      result.class = c;
      break;
    }
  }
  if (!result.class) {
    for (const [en, de] of Object.entries(ENGLISH_TO_GERMAN_CLASS)) {
      if (new RegExp(`\\b${en}\\b`, 'i').test(text)) {
        result.class = de;
        break;
      }
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
        if (n >= 3 && n <= 30) {
          result.stats![k] = n;
          break;
        }
      }
    }
  }

  return result;
}

async function handlePdfUpload(file: File) {
  pdfStatusEl.textContent = '⏳ Lese PDF…';
  pdfStatusEl.className = 'pdf-status busy';
  try {
    const text = await extractPdfText(file);
    pdfTextEl.textContent = text;
    pdfTextWrapperEl.hidden = false;

    const fields = parseSheetFields(text);
    let filled = 0;
    if (fields.name) {
      formNameEl.value = fields.name;
      filled++;
    }
    if (fields.class) {
      formClassEl.value = fields.class;
      filled++;
    }
    if (fields.maxHp) {
      formHpEl.value = String(fields.maxHp);
      filled++;
    }
    if (fields.stats) {
      for (const k of STAT_KEYS) {
        const v = fields.stats[k];
        if (v !== undefined) {
          const el = $<HTMLInputElement>(`#form-${k}`);
          if (el) el.value = String(v);
          filled++;
        }
      }
    }
    pdfStatusEl.textContent = `✓ ${filled} Felder erkannt — bitte prüfen.`;
    pdfStatusEl.className = 'pdf-status ok';
  } catch (err) {
    console.error(err);
    pdfStatusEl.textContent = '✗ PDF konnte nicht gelesen werden.';
    pdfStatusEl.className = 'pdf-status error';
  }
}

function collectCharacterFromForm(): Character {
  const stats: Record<StatKey, number> = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  for (const k of STAT_KEYS) {
    const el = $<HTMLInputElement>(`#form-${k}`);
    const n = el ? parseInt(el.value, 10) : NaN;
    stats[k] = Number.isFinite(n) && n >= 3 && n <= 30 ? n : 10;
  }
  const maxHp = Math.max(
    1,
    Math.min(999, parseInt(formHpEl.value, 10) || 20),
  );
  return {
    name: formNameEl.value.trim() || 'Held',
    class: formClassEl.value || 'Krieger',
    maxHp,
    hp: maxHp,
    stats,
  };
}

function beginAdventure() {
  const c = collectCharacterFromForm();
  Object.assign(character, c);
  updateCharacterPanel();

  messages.length = 0;
  messages.push({ role: 'system', content: buildSystemPrompt(character) });

  modalEl.classList.add('hidden');

  const intro =
    `Ich bin ${character.name}, ${character.class}, und trete nach Valdermoor ein. ` +
    `Führe mich in eine passende Eröffnungsszene ein.`;
  sendToLMStudio(intro);
}

function setupModal() {
  rollStatsBtnEl.addEventListener('click', rollAllStatsIntoForm);

  pdfInputEl.addEventListener('change', () => {
    const file = pdfInputEl.files?.[0];
    if (file) handlePdfUpload(file);
  });

  startBtnEl.addEventListener('click', () => {
    if (!formNameEl.value.trim()) {
      formNameEl.focus();
      formNameEl.classList.add('input-error');
      setTimeout(() => formNameEl.classList.remove('input-error'), 1200);
      return;
    }
    beginAdventure();
  });
}

function setupDiceButtons() {
  $$<HTMLButtonElement>('.dice-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sides = Number(btn.dataset.sides);
      if (sides) rollDice(sides);
    });
  });
}

function setupInputForm() {
  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || isGenerating) return;
    inputEl.value = '';
    sendToLMStudio(text);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.requestSubmit();
    }
  });
}

function init() {
  setupModal();
  setupDiceButtons();
  setupInputForm();
  updateCharacterPanel();
  renderInventory();
  rollAllStatsIntoForm();
}

document.addEventListener('DOMContentLoaded', init);
