# 🏰 Valdermoor

Ein Fantasy-Abenteuer wie **Dungeons & Dragons**, nur dass der Spielleiter eine **KI** ist.
Du schreibst, was dein Held tun will, und der KI-Dungeon-Master erzählt die Geschichte weiter:
mit Würfeln, Inventar, Schaden und Heilung. Ursprünglich ein Schulprojekt.

Läuft im Browser und als Desktop-App für Windows, Mac und Linux.

## Features

- 🎲 **KI-Dungeon-Master**: lokal über LM Studio oder in der Cloud (Groq, Pollinations.ai)
- ⚔️ **Multiplayer in Echtzeit**: Runde erstellen, Code teilen, alle sehen denselben Chat, dieselben Würfe und HP
- 🎒 **Inventar, Quest-Log, Karten-Generator und Speicherstände**
- 📄 **PDF-Import**: Ausrüstung aus einem Charakterbogen direkt ins Inventar übernehmen
- 🌍 **Vier Sprachen**: Deutsch, Englisch, Französisch, Italienisch
- 🔐 **Konten** mit E-Mail-Bestätigung und gehärtetem Login
- 🖥 **Desktop-Apps** mit automatischen Updates, gebaut von GitHub Actions bei jedem Versions-Tag

## Technik

**TypeScript** und **Vite** ohne Framework, **Supabase** für Multiplayer und Konten,
**Electron** für die Desktop-Apps.

| Datei / Ordner | Inhalt |
|---|---|
| `src/main.ts` | App-Logik: Spiel, KI-Anbindung, Konten, Admin-Panel |
| `src/multiplayer.ts` | Echtzeit-Runden über Supabase |
| `supabase/schema.sql` | Datenbank-Schema |
| `electron/` | Desktop-App und Auto-Update |
| `MULTIPLAYER.md` | Wie der Multiplayer aufgebaut ist |

## Starten

```bash
npm install
npm run dev
```

Ohne weitere Einrichtung läuft der Dungeon-Master über Pollinations.ai (gratis, kein Konto).
Alles Optionale (lokales Modell, Groq, E-Mail-Codes, Multiplayer, Admin-Konto) steht in
[`SETUP.md`](SETUP.md) und [`.env.example`](.env.example).
