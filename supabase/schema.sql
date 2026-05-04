-- ════════════════════════════════════════════════════════════
-- Valdermoor Multiplayer Schema (idempotent — kann mehrfach laufen)
-- ════════════════════════════════════════════════════════════
-- Einmalig in Supabase ausführen:
--   1. Linke Sidebar → SQL Editor
--   2. New Query
--   3. Diesen Inhalt komplett einfügen
--   4. RUN klicken (oder Ctrl+Enter)

-- Extension für gen_random_uuid() (auf Supabase normalerweise schon da)
create extension if not exists pgcrypto;

-- ─── User-Accounts (Cloud-Sync, ersetzt nicht die EmailJS-2FA) ───────────
-- Login funktioniert auf jedem Gerät mit gleichem Username + Passwort.
-- PBKDF2-Hash + Salt werden hier gespeichert (one-way, kein Reverse möglich).
create table if not exists public.accounts (
  username_lower text primary key,
  username text not null,
  email text not null,
  password_hash text not null,
  password_salt text not null,
  password_algo text not null default 'pbkdf2-v2',
  created_at timestamptz not null default now()
);
create index if not exists idx_accounts_email on public.accounts(email);
-- Joyce-Gott-Modus: Bann + Timeout
alter table public.accounts add column if not exists banned_until timestamptz;
alter table public.accounts add column if not exists banned_reason text;
-- Letzter Login (für "online jetzt"-Anzeige im Admin-Panel)
alter table public.accounts add column if not exists last_login_at timestamptz;

-- ─── Username-Migration "ben" → "admin" ─────────────────────────────
-- Läuft normalerweise automatisch beim App-Start (siehe migrateBenToAdmin).
-- Falls die automatische Migration nicht laufen konnte (z.B. weil "admin" schon
-- als anderer Account existiert), kannst du manuell per SQL aufräumen:
--
--   delete from public.accounts where username_lower = 'ben';  -- alten Eintrag weg
--   -- ODER: alten Eintrag manuell auf 'admin' umtaufen, falls du das willst:
--   update public.accounts
--     set username_lower = 'admin', username = 'admin'
--     where username_lower = 'ben';

alter table public.accounts enable row level security;

-- ─── Spielrunden / Sessions ────────────────────────────────
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_user text not null,
  age_mode text not null default 'jugend',
  adventure_prompt text default '',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists idx_sessions_code on public.sessions(code);

-- ─── Helden (Spieler-Charaktere) pro Session ───────────────
create table if not exists public.session_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_name text not null,
  player_name text not null,
  player_class text not null,
  hp int not null,
  max_hp int not null,
  stats jsonb not null,
  color text not null,
  joined_at timestamptz not null default now()
);
create index if not exists idx_players_session on public.session_players(session_id);

-- ─── Geteiltes Inventar ────────────────────────────────────
create table if not exists public.session_inventory (
  session_id uuid not null references public.sessions(id) on delete cascade,
  item_name text not null,
  quantity int not null default 1,
  added_at timestamptz not null default now(),
  primary key (session_id, item_name)
);

-- ─── Long-Term-Memory (Story-Beats) ────────────────────────
-- Pro Spielszenario speichern wir kurze "Erinnerungen" die der DM mit
-- [ERINNERN: ...]-Tags markiert. Beim Resume werden die letzten ~20 Beats
-- als Kontext-Block in den System-Prompt geprependet — so vergisst die
-- KI vorherige Sessions nicht mehr.
--
-- scope_key:
--   solo:<usernameLower>:<slot>    z.B. solo:admin:1
--   mp:<session_uuid>              z.B. mp:9f3e...-abcd
create table if not exists public.story_beats (
  id bigint generated always as identity primary key,
  scope_key text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_story_beats_scope_time
  on public.story_beats(scope_key, created_at desc);

alter table public.story_beats enable row level security;

-- ─── Chat-Verlauf ──────────────────────────────────────────
create table if not exists public.session_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  speaker text,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_session_time on public.session_messages(session_id, created_at);

-- ════════════════════════════════════════════════════════════
-- Row-Level-Security: Wer den Code kennt, darf alles
-- (MVP-einfach für Schul-Demo)
-- ════════════════════════════════════════════════════════════

alter table public.sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.session_inventory enable row level security;
alter table public.session_messages enable row level security;

-- Bestehende Policies droppen (idempotent), dann neu erstellen
do $$
declare r record;
begin
  for r in
    select policyname, schemaname || '.' || tablename as full_table
    from pg_policies
    where schemaname = 'public'
      and tablename in ('sessions', 'session_players', 'session_inventory', 'session_messages', 'accounts', 'story_beats')
  loop
    execute format('drop policy if exists %I on %s', r.policyname, r.full_table);
  end loop;
end $$;

create policy "anon_all_sessions" on public.sessions
  for all using (true) with check (true);
create policy "anon_all_players" on public.session_players
  for all using (true) with check (true);
create policy "anon_all_inventory" on public.session_inventory
  for all using (true) with check (true);
create policy "anon_all_messages" on public.session_messages
  for all using (true) with check (true);

create policy "anon_all_accounts" on public.accounts
  for all using (true) with check (true);

create policy "anon_all_story_beats" on public.story_beats
  for all using (true) with check (true);

-- ════════════════════════════════════════════════════════════
-- Realtime aktivieren — defensiv, ignoriert "already exists"
-- ════════════════════════════════════════════════════════════
do $$
begin
  begin
    alter publication supabase_realtime add table public.sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.session_players;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.session_inventory;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.session_messages;
  exception when duplicate_object then null;
  end;
end $$;

-- ✅ Fertig — du solltest "Success. No rows returned" sehen
