# D&D Dungeon Master App — Implementierungsplan

## Context

Ben baut ein Schulprojekt: eine D&D-Dungeon-Master-App in TypeScript, die ein lokales LLM via LM Studio konsumiert. Das Projekt startet in einem leeren Verzeichnis (`c:\Users\angel\OneDrive\Desktop\Game`). Ben hat begrenzte Erfahrung, daher ist Einfachheit oberste Priorität. Die App soll vollständig auf Deutsch sein.

---

## Tech Stack

- **Vite + Vanilla TypeScript** (Browser-App, kein Framework)
- **Nativer `fetch()`** für LM Studio API — kein `openai` npm-Paket nötig
- **LM Studio** läuft lokal auf `http://localhost:1234/v1` (OpenAI-kompatibler Endpunkt)
- **Keine zusätzlichen npm-Pakete** außer was Vite mitbringt

---

## Dateistruktur (nach Setup)

```
Game/
├── index.html          ← Layout: 3 Spalten (Charakter | Chat | Inventar)
├── src/
│   ├── main.ts         ← Gesamte App-Logik (~250 Zeilen)
│   └── style.css       ← Dark-Fantasy-Styling
├── package.json        (von Vite generiert)
└── tsconfig.json       (von Vite generiert)
```

---

## Implementierungsschritte

### Schritt 1 — Projekt initialisieren

```bash
cd "C:\Users\angel\OneDrive\Desktop\Game"
npm create vite@latest . -- --template vanilla-ts
npm install
```

### Schritt 2 — LM Studio einrichten (einmalig)

1. LM Studio öffnen → **Discover**-Tab → Modell suchen und herunterladen
2. Empfohlen für schwache Laptops: **Gemma 4 E4B** (~2–3 GB RAM)
3. Modell laden: **Chat**-Tab → Modell oben auswählen
4. Server starten: **Local Server**-Tab → **Start Server** klicken (Port 1234)

### Schritt 3 — `index.html` ersetzen

3-Spalten-Layout:
- **Links:** Charakter-Panel (Name, Klasse, HP-Balken, 6 Stats: STR/DEX/CON/INT/WIS/CHA)
- **Mitte:** Chat/Story-Bereich (Message-Log + Texteingabe + Senden-Button)
- **Rechts:** Würfelsystem (W4/W6/W8/W10/W12/W20 Buttons + Ergebnis-Anzeige) + Inventar-Liste

### Schritt 4 — `src/main.ts` implementieren

**Typen:**
```typescript
interface Message { role: 'system' | 'user' | 'assistant'; content: string; }
interface Character { name: string; class: string; hp: number; maxHp: number; stats: Record<string, number>; }
interface InventoryItem { name: string; quantity: number; }
```

**State (globale Variablen — bewusst einfach):**
```typescript
const messages: Message[] = [{ role: 'system', content: DM_SYSTEM_PROMPT }];
const character: Character = { name: '???', class: '???', hp: 20, maxHp: 20, stats: {STR:10,DEX:10,...} };
const inventory: InventoryItem[] = [];
```

**DM System-Prompt (Deutsch):**
```
Du bist ein epischer Dungeon Master für Dungeons & Dragons 5e in der Welt Valdermoor.
- Beschreibe Szenen in 2-4 lebhaften Sätzen
- Lass Spielerentscheidungen die Geschichte beeinflussen
- Wenn ein Würfelwurf nötig ist, schreibe: [WÜRFEL: W20] und warte auf das Ergebnis
- Führe neue Spieler mit Charaktererstellung ein (frage nach Name, Rasse, Klasse)
- Wenn der Spieler Gegenstände findet, schreibe: [ITEM: Gegenstandsname]
- Antworte immer auf Deutsch, max. 150 Wörter
- Beginne mit einer dramatischen Eröffnungsszene
```

**LM Studio Streaming (`sendToLMStudio`):**
```typescript
// POST http://localhost:1234/v1/chat/completions mit stream: true
// ReadableStream + TextDecoder → Token für Token in DM-Blase einfügen
// Nach Abschluss: [ITEM: ...] Tags parsen → Inventar aktualisieren
// Fehlerbehandlung: "LM Studio nicht erreichbar?" Meldung anzeigen
```

**Würfelsystem:**
```typescript
// rollDice(sides) → Math.random() * sides + 1
// Ergebnis wird in Eingabefeld eingefügt: "Ich würfle eine X auf dem WY."
// Würfelanimation (CSS-Klasse für 500ms)
```

**Inventar:**
```typescript
// parseInventory(text): [ITEM: name] aus DM-Antwort extrahieren → inventory[] aktualisieren
// renderInventory(): #inventory-list DOM neu aufbauen
```

**Charakter-Parsing:**
```typescript
// parseCharacterInfo(text): Name und Klasse aus DM-Antwort heuristisch extrahieren
// updateCharacterPanel(): DOM-Elemente aktualisieren, HP-Balken animieren
```

**Init:**
```typescript
// DOMContentLoaded → setupDiceButtons() + updateCharacterPanel() + renderInventory()
// Enter (ohne Shift) = Senden
// Automatische Begrüßung: sendToLMStudio('Starte die Session mit einer Eröffnungsszene!')
```

### Schritt 5 — `src/style.css` Dark-Fantasy-Theme

- Hintergrund: `#0d0d0d`
- Akzentfarbe: Gold `#c9a84c`
- Schrift: Google Fonts `Cinzel` (Überschriften) + `Crimson Text` (Text)
- HP-Balken: CSS-Gradient Rot→Grün mit `transition: width 0.5s`
- DM-Nachrichten: linksbündig, dunkles Braun-Hintergrund
- Spieler-Nachrichten: rechtsbündig, dunkles Blau
- Würfelbuttons: rund, Hover-Glow in Gold
- Layout: `display: grid; grid-template-columns: 260px 1fr 220px; height: 100vh;`

---

## Kritische Dateien

| Datei | Aktion |
|-------|--------|
| `index.html` | Komplett ersetzen (Vite-Standard entfernen) |
| `src/main.ts` | Komplett ersetzen mit App-Logik |
| `src/style.css` | Komplett ersetzen mit Dark-Fantasy-CSS |
| `vite.config.ts` | Unverändert lassen |
| `package.json` | Unverändert lassen |

---

## Verifikation / Testen

1. `npm run dev` starten → Browser öffnet sich auf `http://localhost:5173`
2. LM Studio: Modell geladen + Server auf Port 1234 gestartet
3. App lädt → DM-Begrüßungsnachricht erscheint automatisch (Streaming sichtbar)
4. Text eingeben + Enter → DM antwortet
5. Würfel-Button klicken → Ergebnis erscheint + wird in Eingabefeld eingefügt
6. DM erwähnt [ITEM: Schwert] → Inventar aktualisiert sich rechts
7. Fehlertest: LM Studio stoppen → Fehlermeldung erscheint statt Absturz
