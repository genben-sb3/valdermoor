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

> **Hinweis:** Ben's Laptop hat nur 4 GB RAM gesamt — Modellwahl ist kritisch.

| Modell | RAM-Bedarf | Hinweis |
|--------|-----------|---------|
| **SmolLM2 360M Q4** | ~250 MB | Sicherste Wahl, sehr schnell, begrenzte Kreativität |
| **Phi-3.5 Mini Q4** | ~2.3 GB | Bessere DM-Qualität, knapp aber machbar auf 4 GB |

1. LM Studio öffnen → **Discover**-Tab → `SmolLM2` oder `Phi-3.5 Mini` suchen
2. Modell laden: **Chat**-Tab → Modell oben auswählen
3. Server starten: **Local Server**-Tab → **Start Server** klicken (Port 1234)

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

**DM System-Prompt (Deutsch, kurz gehalten für kleine Modelle):**
```
Du bist ein Dungeon Master in der Welt Valdermoor. Antworte immer auf Deutsch.
Regeln: Beschreibe kurz (2-3 Sätze). Wenn Würfeln nötig: schreibe [WÜRFEL: W20].
Wenn Spieler etwas findet: schreibe [ITEM: Name]. Frage zuerst nach Name und Klasse.
```

> **Warum so kurz?** Kleine Modelle (360M–3.8B) folgen langen Prompts schlecht.
> Weniger Anweisungen = zuverlässigere Ausgaben. `max_tokens: 250` setzen.

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

---

## Status (28.04.2026)

Was schon läuft:
- ✅ Live auf https://valdermoor.vercel.app
- ✅ Cloud-DM via Pollinations + Groq (Llama 4 Scout default, Modell-Switcher)
- ✅ Auto-Fallback bei Rate-Limit
- ✅ EmailJS-2FA mit Sicherheits-Fix (Code in Production NIE im Modal)
- ✅ Mobile-responsive + PWA-installierbar
- ✅ Native Apps: Windows .exe, macOS .dmg, Linux .AppImage (GitHub Releases)
- ✅ Stremio-Style Install-Page mit Plattform-Auto-Detection
- ✅ DM-Stimme: 6 OpenAI-Stimmen via Pollinations (Onyx-Default)
- ✅ Erzähler-Modus: User kann selbst Story lenken via [ERZÄHLER]-Marker
- ✅ Admin-Mode für Username "ben": DM erlaubt Cheat-Items kreativ
- ✅ Klassen-Emojis in Sidebar + Bubbles
- ✅ Animationen, Glows, Polish

---

## Ideen für die nächsten Sessions

Reihenfolge nach geschätztem Wert (oben = größter Wow-Effekt):

### Quick Wins (je ~30-60 Min)
- [ ] **Voice-Input**: Mikro-Button, du sprichst, App tippt es ein. Web Speech Recognition API, gratis. (HTML-Button schon da, JS fehlt)
- [ ] **Charakter-Avatare**: KI-generierte Bilder pro Held (Pollinations Image-API mit Klasse + Name als Prompt, in Sidebar anzeigen)
- [ ] **Sound-Effekte**: Würfel-Roll-Sound, Item-Pickup-Klang, Schaden-Hit. Free-Sounds von freesound.org oder selbst aufnehmen.
- [ ] **Stats-Page**: Modal mit Würfel-Statistik, Items-Sammlung, Spielzeit, längste Session.

### Mittel (je 1-3 Stunden)
- [ ] **Hintergrundmusik**: Atmosphärische Fantasy-Tracks, schaltbar, Lautstärkeregler. Lizenzfreie Musik von incompetech.com oder pixabay.
- [ ] **Save-Slots**: 3 parallele Spielstände parkbar (statt nur einem). UI im Header oder im Char-Modal.
- [ ] **Karte / Lokationen**: Kleine ASCII- oder SVG-Karte die DM-Lokationen markiert. DM gibt [ORT: ...]-Tags, Karte aktualisiert sich.
- [ ] **Achievements**: Trophäen-System (erste Quest, 100 Würfel, KO geschlagen, etc.)
- [ ] **Eltern-Werbevideo Storyboard**: 30-Sekunden-Clip, Schritt für Schritt mit Voice-Over-Text, AI-Bilder, CapCut-Anleitung.

### Größer (Wochenend-Projekte)
- [ ] **Multiplayer in Echtzeit**: Mehrere Spieler in derselben Runde via WebSocket. Erfordert Backend (Vercel-Edge-Functions, Supabase, oder Cloudflare Durable Objects).
- [ ] **Eleven Labs Voice-Cloning**: Eigene Stimme als DM. Braucht $5/Monat-Plan + 30 Sek Aufnahme. API-Key in .env / Vercel-ENV.
- [ ] **Charakter-Sheet PDF-Export**: aktueller Stand als druckbares PDF.
- [ ] **Service Worker**: App offline-fähig nach erstem Besuch (Cache-Strategie für statische Assets).
- [ ] **Mehrsprachig**: Englisch / Französisch / Italienisch dazu (System-Prompt + UI-Strings).

### Optional / Polish
- [ ] **Custom Domain kaufen** (z.B. valdermoor.ch via SwitchPlus für ~10 CHF/Jahr)
- [ ] **Eigene Icon-PNGs** (192x192, 512x512) statt favicon.svg im manifest.webmanifest
- [ ] **Code-Signing** für die EXE damit Windows-Smart-Screen nicht warnt (kostet ~€100/Jahr, nicht nötig für Schule)
- [ ] **Analytics** (Vercel Web Analytics, gratis): wie viele Besucher, woher, etc.
- [ ] **Discord-Embed**: Wenn jemand den Link in Discord teilt, schöne Vorschau-Card via Open-Graph-Tags.

---

## Notizen für später

- Groq-Free-Tier reicht für ~50 Spieler/Tag bei normaler Nutzung. Wenn die App wirklich viral geht, auf bezahlten Plan upgraden ($0.05 / 1M Tokens — extrem günstig).
- EmailJS Free: 200 Mails/Monat. Reicht für ~200 Registrierungen pro Monat. Ab 500/Monat $7/Monat upgraden.
- Vercel Free: 100 GB Bandwidth/Monat. Würde tausende User schaffen.
- GitHub Actions Free: 2000 Minuten/Monat für private Repos, **unlimited** für public Repos. Da `valdermoor` public ist → unlimited Builds.
