import './style.css';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Character {
  name: string;
  class: string;
  hp: number;
  maxHp: number;
  stats: Record<'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA', number>;
}

interface InventoryItem {
  name: string;
  quantity: number;
}

const DM_SYSTEM_PROMPT = `Du bist ein Dungeon Master in der Fantasy-Welt Valdermoor. Antworte IMMER auf Deutsch.
Regeln:
- Halte Beschreibungen kurz: 2 bis 3 Sätze.
- Wenn der Spieler würfeln muss, schreibe [WÜRFEL: W20] oder [WÜRFEL: W6] usw.
- Wenn der Spieler etwas findet, schreibe [ITEM: Name des Gegenstands].
- Zu Beginn frage nach Name und Klasse des Charakters.`;

const API_URL = 'http://localhost:1234/v1/chat/completions';

const messages: Message[] = [{ role: 'system', content: DM_SYSTEM_PROMPT }];
const character: Character = {
  name: '???',
  class: '???',
  hp: 20,
  maxHp: 20,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
};
const inventory: InventoryItem[] = [];

let isGenerating = false;

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const messagesEl = $<HTMLDivElement>('#messages');
const inputEl = $<HTMLTextAreaElement>('#input');
const inputForm = $<HTMLFormElement>('#input-form');
const sendBtn = $<HTMLButtonElement>('#send-btn');
const statusEl = $<HTMLDivElement>('#status');
const diceResultEl = $<HTMLDivElement>('#dice-result');
const inventoryListEl = $<HTMLUListElement>('#inventory-list');

function addMessageBubble(role: 'user' | 'assistant', text = ''): HTMLDivElement {
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
        max_tokens: 250,
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
    parseCharacterInfo(fullText);
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

function parseCharacterInfo(text: string) {
  if (character.name === '???') {
    const m = text.match(
      /(?:heißt|nennst dich|dein Name (?:ist|lautet))\s+([A-ZÄÖÜ][a-zäöüß]+)/,
    );
    if (m) {
      character.name = m[1];
      $<HTMLDivElement>('#char-name').textContent = character.name;
    }
  }
  if (character.class === '???') {
    const classes = [
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
    for (const c of classes) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(text)) {
        character.class = c;
        $<HTMLDivElement>('#char-class').textContent = c;
        break;
      }
    }
  }
}

function updateHpBar() {
  const pct = Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100));
  $<HTMLDivElement>('#char-hp-bar').style.width = `${pct}%`;
  $<HTMLSpanElement>('#char-hp').textContent = String(character.hp);
  $<HTMLSpanElement>('#char-max-hp').textContent = String(character.maxHp);
}

function setupDiceButtons() {
  document.querySelectorAll<HTMLButtonElement>('.dice-btn').forEach((btn) => {
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
  setupDiceButtons();
  setupInputForm();
  updateHpBar();
  renderInventory();
  inputEl.focus();
  sendToLMStudio('Beginne die Session mit einer kurzen Eröffnungsszene.');
}

document.addEventListener('DOMContentLoaded', init);
