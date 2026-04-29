# Multiplayer-Architektur — Roadmap fürs Wochenend-Projekt

## Was wir bauen wollen

Mehrere Spieler in **derselben Spiel-Session** in Echtzeit:
- Ben (DM/Spielleiter) erstellt eine Runde, kriegt einen Code (z.B. `VALDR-7B3F`)
- Sina, Max, Tim geben den Code in ihrer App ein → joinen die Runde
- Alle sehen denselben Chat, dasselbe Inventar, dieselben HP der Helden
- Wenn einer würfelt, sehen die anderen das Ergebnis sofort
- DM-Antworten werden an alle gestreamt
- Ein Spieler ist gleichzeitig "Erzähler" (kann via Erzähler-Modus die Story lenken)

## Was es NICHT ist

- ❌ Kein async/forum-style "ich antworte morgen, du in 3 Tagen" — alles real-time
- ❌ Kein public Matchmaking — Code muss geteilt werden, sonst kommt niemand rein
- ❌ Kein Spectator-Mode (zumindest nicht in v1)

---

## Tech-Stack-Optionen (Vergleich)

| Stack | Komplexität | Kosten | Einsteig | Skalierung |
|-------|-------------|--------|----------|-----------|
| **Supabase Realtime** ⭐ | mittel | Free-Tier 200 concurrent | mittel | bis 200 User gratis |
| **Cloudflare Durable Objects** | hoch | $5/Monat ab 1 GB | schwer | praktisch unbegrenzt |
| **PartyKit** | niedrig | Free-Tier 10k Verbindungen | einfach | gut, kommt aus dem Cloudflare-Ökosystem |
| **Vercel + Pusher** | niedrig | Pusher Free 200 Verbindungen | einfach | begrenzt |
| **Eigener Node-WS-Server** | hoch | Hosting nötig | schwer | manuell |

### Empfehlung: **Supabase Realtime + Postgres**

Warum:
- ✅ **Free-Tier** reicht für 50 gleichzeitige Spieler easily
- ✅ **Postgres-DB** für Spielstand-Persistierung *(bereits enthalten)*
- ✅ **Auth** *(bereits enthalten — könnte EmailJS ersetzen oder ergänzen)*
- ✅ **Realtime via Postgres-Replikation** — sehr saubere API
- ✅ **Row-Level-Security** für "nur Mitspieler sehen die Runde"
- ✅ Open-Source, läuft auch self-hosted falls wir später mal woanders hin müssen
- ⚠ Kein zero-config-deploy wie bei PartyKit — mehr SQL/Schema-Arbeit

Alternativen:
- **PartyKit**: Wenn wir nur Realtime ohne DB brauchen → einfacher Setup. Aber Spielstand-Persistierung müssten wir extra lösen.
- **Vercel KV + Pusher**: Wenn wir bei Vercel-only bleiben wollen. Begrenzt.

---

## Daten-Modell (Postgres-Schema, Vorschlag)

```sql
-- Eine Spielrunde = "Lobby" / "Session"
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- z.B. 'VALDR-7B3F'
  host_user text not null,            -- der Erfinder/DM-Master
  created_at timestamptz default now(),
  age_mode text not null,
  adventure_prompt text,
  active_player_id uuid,              -- wer ist gerade dran (Soft-Lock)
  closed_at timestamptz               -- null = aktive Runde
);

-- Spieler einer Session
create table session_players (
  session_id uuid references sessions(id) on delete cascade,
  user_name text not null,
  player_id uuid not null,
  player_name text not null,
  player_class text not null,
  hp int not null, max_hp int not null,
  stats jsonb not null,
  color text not null,
  joined_at timestamptz default now(),
  primary key (session_id, player_id)
);

-- Inventar pro Session (geteilt)
create table session_inventory (
  session_id uuid references sessions(id) on delete cascade,
  item_name text not null,
  quantity int not null default 1,
  added_at timestamptz default now(),
  primary key (session_id, item_name)
);

-- Chat-Verlauf
create table session_messages (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  role text not null,                 -- 'user' | 'assistant' | 'system'
  speaker text,
  content text not null,
  created_at timestamptz default now()
);
create index on session_messages (session_id, created_at);
```

Realtime-Subscriptions:
- Jeder Client subscribed auf `session_messages` / `session_players` / `session_inventory` für seine Session
- Postgres-Replikation pusht Änderungen sofort an alle Subscribers

---

## UI-Änderungen

### Hauptmenü erweitern
Nach Login + Charakter-Erstellung jetzt 3 Optionen:
- **🎲 Solo spielen** *(wie bisher)*
- **👥 Runde erstellen** *(als DM-Host) → Code anzeigen + share-button*
- **🚪 Runde beitreten** *(Code eingeben → joinen)*

### Im Spiel
- Header zeigt **Session-Code + Mitspieler-Liste** (Avatar + Name + online-Indikator)
- Wenn ein anderer Spieler tippt: "Sina schreibt…" Indikator
- Würfel-Würfe werden farblich nach Werfer-Spieler markiert
- Disconnect-Recovery: bei Reconnect wird der letzte Spielstand vom Server geladen

### Wer darf was
- **Host** kann: Runde schließen, Spieler kicken, neuen DM-Modell-Wechsel
- **Alle Spieler** können: ihren Helden steuern, würfeln, an DM schreiben
- **Erzähler-Modus**: nur Host darf das benutzen *(sonst chaotisch)*

---

## Implementierungs-Schritte (geschätzt 10-15 Stunden)

### Phase 1 — Setup (~2h)
- [ ] Supabase-Account anlegen (gratis), neues Projekt
- [ ] Schema migrieren (oben)
- [ ] Row-Level-Security-Policies einrichten
- [ ] `@supabase/supabase-js` Client installieren
- [ ] Connection in `src/multiplayer.ts` initialisieren

### Phase 2 — Lobby-System (~2-3h)
- [ ] Hauptmenü-Erweiterung: Solo/Erstellen/Beitreten
- [ ] Code-Generator (z.B. `VALDR-` + 4 hex chars)
- [ ] `createSession()` / `joinSession(code)` Funktionen
- [ ] Lobby-Screen: Mitspieler werden in Echtzeit angezeigt während sie joinen
- [ ] "Spiel starten"-Button (nur Host)

### Phase 3 — Realtime-Sync (~3-4h)
- [ ] Lokale Spiel-State (`messages`, `players`, `inventory`) → Supabase-Mirror
- [ ] Supabase-Subscriptions für alle drei Tabellen
- [ ] Konflikt-Auflösung: gleichzeitige Sends → Server-Order via `created_at`
- [ ] Optimistic Updates lokal, Rollback wenn Server ablehnt
- [ ] DM-Antworten werden vom HOST gestreamt und in DB geschrieben — Mitspieler sehen Tokens via Realtime

### Phase 4 — UX-Polish (~2-3h)
- [ ] "Sina schreibt…"-Indikator (Presence-API von Supabase)
- [ ] Disconnect-Banner + Auto-Reconnect
- [ ] Online/Offline-Punkte neben Mitspielern
- [ ] Host-only-Buttons (Spieler kicken, Runde schließen)
- [ ] Spielstand-Wiederherstellung bei Reconnect

### Phase 5 — Testing + Deploy (~1-2h)
- [ ] Test mit 2-3 Browsern parallel auf gleichem Code
- [ ] Edge-Cases: Host disconnected mid-game, was passiert?
- [ ] Vercel-ENV: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- [ ] Tag v2.0.0 → Public-Release

---

## Kritische Design-Entscheidungen

### Wer streamt die DM-Antwort?
**Option A**: Host streamt → schreibt jeden Token in `session_messages` → Realtime pusht zu allen
- ✅ Einfach
- ❌ Wenn Host's Internet langsam ist, sehen alle die Antwort langsam
- ❌ Host's Groq-API-Limit wird belastet

**Option B**: Backend-Function streamt → schreibt zu `session_messages`
- ✅ Konsistente Erfahrung für alle
- ❌ Braucht Vercel-Edge-Function, mehr Code, eigener API-Key

→ **Wir starten mit A** (Host streamt). Bei Bedarf später auf B migrieren.

### Wer hat den Groq-Key?
Frontend-Bundle hat den Key (wie aktuell). Heißt: jeder Spieler in der Runde kann theoretisch DM-Calls machen. Konflikt-Vermeidung: nur der Spieler dessen Turn es ist (oder der Host) darf senden. UI deaktiviert Send-Button für andere.

### Was passiert wenn DM mid-stream disconnected?
- Lokal: Bubble bleibt halb-geschrieben
- Andere Spieler: sehen unvollständige Bubble
- Lösung: Client-seitig Heartbeat → wenn Host >5s offline, Bubble auf "[unterbrochen]" setzen
- Recovery: Host kommt zurück → letzte unvollständige Message zurücksetzen, neu senden

### Spielstand teilen vs. private Helden
**Entscheidung**: Inventar + Chat sind GETEILT. Helden sind **persönlich** (jeder Spieler hat seinen eigenen, andere Spieler sehen aber HP/Stats für Story-Konsistenz).

Heißt: Sina sieht Bens Helden und seine HP, kann aber nicht für ihn handeln.

---

## Wann anfangen?

**Wochenende mit 4-6h Block** — nicht in 30-Min-Häppchen. Realtime-Bugs sind nervig zu debuggen, brauchen Konzentration.

**Vorbereitung in Schul-Pausen okay**:
- Supabase-Account anlegen
- Schema lesen, ggf. anpassen
- README für sich selbst nochmal durchgehen

**Alternativer Ansatz**: Erstmal **PartyKit** für einen Quick-MVP (~3-4h) — weniger DB, mehr Flow. Wenn das Spaß macht → später Supabase-Migration. Wenn nicht → einfach so lassen.

---

*Letzte Änderung: 2026-04-29 — vor dem Wochenend-Sprint.*
