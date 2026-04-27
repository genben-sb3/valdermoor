# Valdermoor — Setup-Anleitung

Alles was du selbst machen musst, damit das Spiel komplett läuft.
Reihenfolge: 1 → 2 → (3) → (4). Punkte 3 & 4 sind optional.

---

## 1. Erste Schritte (immer nötig)

```bash
cd "C:\Users\angel\OneDrive\Desktop\Game"
npm install
```

Wenn `node_modules` schon existiert, überspring `npm install`.

---

## 2. LM Studio einrichten (für die KI)

Ohne LM Studio antwortet der DM nicht. Nur einmalig nötig.

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

---

## 3. App starten

```bash
npm run dev
```

Browser öffnet sich auf http://localhost:5173. Fertig.

- **Erste Nutzung:** Registrieren → Code aus Modal eintragen → Helden anlegen → Spielen.
- **Wiederkommen:** Spielstand wird automatisch geladen.
- **Neue Geschichte:** "🆕 Neue Runde" oben rechts.

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

---

## 5. (Optional) GitHub-Remote für Push

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
| "DM-Server nicht erreichbar" | LM Studio läuft nicht oder Modell nicht geladen. → Schritt 2 prüfen. |
| Code im Modal kommt nicht im Postfach an | EmailJS nicht konfiguriert (= Demo-Modus). Code wird im Modal angezeigt. |
| Spielstand verloren nach F5 | Browser hat localStorage gelöscht (Inkognito? "Cookies löschen"?). |
| Phi-3.5 stürzt ab | Zu wenig RAM. Auf SmolLM2 360M wechseln. |
| Antworten kommen wirr / wiederholen sich | Modell zu klein. Versuch Phi-3.5 wenn RAM reicht. |
| "Module not found" beim Start | `npm install` vergessen. |

---

## Was du **NICHT** machen musst

- ❌ Backend / Server programmieren — alles läuft im Browser
- ❌ Datenbank einrichten — localStorage reicht
- ❌ API-Keys von OpenAI/Anthropic — LM Studio ist lokal & kostenlos
- ❌ HTTPS / Domain — `localhost` reicht für Demo
