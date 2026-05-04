// ════════════════════════════════════════════════════════════
// Valdermoor Multiplayer — Supabase Realtime
// ════════════════════════════════════════════════════════════
// Lobbys, Realtime-Sync von Messages/Players/Inventory.
// Wer den Session-Code kennt, kann einer Runde beitreten.
// Host = der User der die Session erstellt hat (kann sie schließen).

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function isMultiplayerAvailable(): boolean {
  return !!URL && !!KEY;
}

function getClient(): SupabaseClient {
  if (!client) {
    if (!URL || !KEY) throw new Error('Supabase nicht konfiguriert');
    client = createClient(URL, KEY, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

// ─── Typen ───────────────────────────────────────────────────

export interface MpSession {
  id: string;
  code: string;
  host_user: string;
  age_mode: 'kinder' | 'jugend' | 'erwachsen';
  adventure_prompt: string;
  created_at: string;
  closed_at: string | null;
}

export interface MpPlayer {
  id: string;
  session_id: string;
  user_name: string;
  player_name: string;
  player_class: string;
  hp: number;
  max_hp: number;
  stats: Record<string, number>;
  color: string;
  joined_at: string;
}

export interface MpInventoryItem {
  session_id: string;
  item_name: string;
  quantity: number;
  added_at: string;
}

export interface MpMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  speaker: string | null;
  content: string;
  created_at: string;
}

// ─── Cloud-Account-Sync ──────────────────────────────────────
// Account-Daten in Supabase persistiert damit User auf jedem Gerät einloggen kann.
// PBKDF2-Hash bleibt one-way, public-read der Hashes ist OK.

export interface CloudAccount {
  username_lower: string;
  username: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_algo: string;
  created_at: string;
  banned_until?: string | null;
  banned_reason?: string | null;
}

export async function cloudGetAccount(usernameLower: string): Promise<CloudAccount | null> {
  if (!isMultiplayerAvailable()) return null;
  const supa = getClient();
  const { data, error } = await supa
    .from('accounts')
    .select('*')
    .eq('username_lower', usernameLower)
    .maybeSingle();
  if (error) {
    console.warn('cloudGetAccount fehlgeschlagen:', error.message);
    return null;
  }
  return (data as CloudAccount | null) ?? null;
}

export async function cloudPutAccount(acct: {
  username: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordAlgo: string;
}): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  const supa = getClient();
  const { error } = await supa.from('accounts').upsert({
    username_lower: acct.username.toLowerCase(),
    username: acct.username,
    email: acct.email,
    password_hash: acct.passwordHash,
    password_salt: acct.passwordSalt,
    password_algo: acct.passwordAlgo,
  });
  if (error) {
    console.warn('cloudPutAccount fehlgeschlagen:', error.message);
    return false;
  }
  return true;
}

export async function cloudListAccounts(): Promise<CloudAccount[]> {
  if (!isMultiplayerAvailable()) return [];
  const supa = getClient();
  const { data, error } = await supa
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('cloudListAccounts:', error.message);
    return [];
  }
  return (data as CloudAccount[]) ?? [];
}

export async function cloudBanUser(usernameLower: string, until: Date | null, reason: string): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  const supa = getClient();
  const { error } = await supa
    .from('accounts')
    .update({ banned_until: until ? until.toISOString() : null, banned_reason: reason || null })
    .eq('username_lower', usernameLower);
  if (error) {
    console.warn('cloudBanUser:', error.message);
    return false;
  }
  return true;
}

export async function cloudDeleteAccount(usernameLower: string): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  const supa = getClient();
  const { error } = await supa.from('accounts').delete().eq('username_lower', usernameLower);
  if (error) { console.warn('cloudDeleteAccount:', error.message); return false; }
  return true;
}

// 💀 Globaler Broadcast-Channel für creepy Server-Events
let globalChannel: RealtimeChannel | null = null;

export function subscribeToGlobalEvents(handlers: { onShutdown?: () => void }): () => void {
  if (!isMultiplayerAvailable()) return () => {};
  const supa = getClient();
  globalChannel = supa
    .channel('valdermoor-global', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'shutdown' }, () => handlers.onShutdown?.())
    .subscribe();
  return () => {
    if (globalChannel) {
      void supa.removeChannel(globalChannel);
      globalChannel = null;
    }
  };
}

export async function broadcastShutdown(): Promise<void> {
  if (!isMultiplayerAvailable()) return;
  const supa = getClient();
  const ch = supa.channel('valdermoor-global');
  await ch.subscribe();
  await ch.send({ type: 'broadcast', event: 'shutdown', payload: { ts: Date.now() } });
  setTimeout(() => void supa.removeChannel(ch), 1000);
}

export async function cloudWipeAllSessions(): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  const supa = getClient();
  // CASCADE löscht players + inventory + messages
  const { error } = await supa.from('sessions').delete().not('id', 'is', null);
  if (error) { console.warn('cloudWipeAllSessions:', error.message); return false; }
  return true;
}

// Username umbenennen — kopiert den Account auf den neuen username_lower und löscht den alten.
// Idempotent: macht nichts, wenn der Ziel-Username schon existiert (= bereits migriert).
export async function cloudRenameAccount(
  oldLower: string,
  newLower: string,
  newUsername: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isMultiplayerAvailable()) return { ok: false, reason: 'no-cloud' };
  const supa = getClient();
  const { data: existing } = await supa
    .from('accounts')
    .select('username_lower')
    .eq('username_lower', newLower)
    .maybeSingle();
  if (existing) return { ok: false, reason: 'target-exists' };

  const { data: old, error: getErr } = await supa
    .from('accounts')
    .select('*')
    .eq('username_lower', oldLower)
    .maybeSingle();
  if (getErr || !old) return { ok: false, reason: 'old-missing' };

  const oldRow = old as CloudAccount;
  const { error: insErr } = await supa.from('accounts').insert({
    username_lower: newLower,
    username: newUsername,
    email: oldRow.email,
    password_hash: oldRow.password_hash,
    password_salt: oldRow.password_salt,
    password_algo: oldRow.password_algo,
    banned_until: oldRow.banned_until ?? null,
    banned_reason: oldRow.banned_reason ?? null,
  });
  if (insErr) return { ok: false, reason: 'insert-failed: ' + insErr.message };

  const { error: delErr } = await supa.from('accounts').delete().eq('username_lower', oldLower);
  if (delErr) {
    console.warn('cloudRenameAccount: alten Eintrag konnte nicht gelöscht werden:', delErr.message);
  }
  return { ok: true };
}

// ─── Long-Term-Memory (Story-Beats) ──────────────────────────
// Hält pro Spielszenario kurze Erinnerungen die der DM mit [ERINNERN:]
// markiert. Werden beim Resume als Kontext-Block in den System-Prompt
// geprependet, damit die KI vorherige Sessions nicht vergisst.

export interface StoryBeat {
  id: number;
  scope_key: string;
  content: string;
  created_at: string;
}

// Wenn die story_beats-Tabelle (noch) nicht existiert: einmal warnen, dann
// den Feature-Aufruf still überspringen — App soll nicht crashen.
let storyBeatsAvailable: boolean | null = null;

function setStoryBeatsUnavailable(reason: string) {
  if (storyBeatsAvailable === false) return;
  storyBeatsAvailable = false;
  console.warn(`[LTM] Story-Beats deaktiviert: ${reason}. Lass das aktuelle schema.sql in Supabase laufen, um Long-Term-Memory zu aktivieren.`);
}

export async function cloudInsertStoryBeat(scopeKey: string, content: string): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  if (storyBeatsAvailable === false) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  const supa = getClient();
  const { error } = await supa.from('story_beats').insert({
    scope_key: scopeKey,
    content: trimmed.slice(0, 500),
  });
  if (error) {
    if (error.code === 'PGRST205' || /not find the table/i.test(error.message)) {
      setStoryBeatsUnavailable('Tabelle fehlt');
    } else {
      console.warn('cloudInsertStoryBeat:', error.message);
    }
    return false;
  }
  storyBeatsAvailable = true;
  return true;
}

export async function cloudListStoryBeats(scopeKey: string, limit: number = 20): Promise<StoryBeat[]> {
  if (!isMultiplayerAvailable()) return [];
  if (storyBeatsAvailable === false) return [];
  const supa = getClient();
  const { data, error } = await supa
    .from('story_beats')
    .select('*')
    .eq('scope_key', scopeKey)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === 'PGRST205' || /not find the table/i.test(error.message)) {
      setStoryBeatsUnavailable('Tabelle fehlt');
    } else {
      console.warn('cloudListStoryBeats:', error.message);
    }
    return [];
  }
  storyBeatsAvailable = true;
  return ((data as StoryBeat[]) ?? []).reverse(); // älteste zuerst (chronologisch)
}

// Lösche alle Beats für einen Scope (z.B. bei "Neue Runde" oder Slot-Reset).
export async function cloudClearStoryBeats(scopeKey: string): Promise<boolean> {
  if (!isMultiplayerAvailable()) return false;
  if (storyBeatsAvailable === false) return false;
  const supa = getClient();
  const { error } = await supa.from('story_beats').delete().eq('scope_key', scopeKey);
  if (error) {
    if (!(error.code === 'PGRST205' || /not find the table/i.test(error.message))) {
      console.warn('cloudClearStoryBeats:', error.message);
    }
    return false;
  }
  return true;
}

export async function cloudFindAccountByEmail(email: string): Promise<CloudAccount | null> {
  if (!isMultiplayerAvailable()) return null;
  const supa = getClient();
  const { data, error } = await supa
    .from('accounts')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) return null;
  return (data as CloudAccount | null) ?? null;
}

// ─── Code-Generator ──────────────────────────────────────────
// 4 Hex-Chars, leicht teilbar mit Freunden ("VALDR-7B3F")

function generateCode(): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I/O zur Lesbarkeit
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `VALDR-${s}`;
}

// ─── Session Management ──────────────────────────────────────

export async function createSession(opts: {
  hostUser: string;
  ageMode: 'kinder' | 'jugend' | 'erwachsen';
  adventurePrompt?: string;
}): Promise<MpSession> {
  const supa = getClient();
  // Versuche bis zu 5 mal eindeutigen Code zu finden
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data, error } = await supa
      .from('sessions')
      .insert({
        code,
        host_user: opts.hostUser,
        age_mode: opts.ageMode,
        adventure_prompt: opts.adventurePrompt ?? '',
      })
      .select()
      .single();
    if (!error && data) return data as MpSession;
    if (error && !error.message.includes('duplicate')) throw error;
  }
  throw new Error('Konnte keinen eindeutigen Session-Code generieren — versuch nochmal');
}

export async function findSessionByCode(code: string): Promise<MpSession | null> {
  const supa = getClient();
  const normalized = code.trim().toUpperCase();
  const { data, error } = await supa
    .from('sessions')
    .select('*')
    .eq('code', normalized)
    .is('closed_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as MpSession | null) ?? null;
}

export async function closeSession(sessionId: string): Promise<void> {
  const supa = getClient();
  const { error } = await supa
    .from('sessions')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

// ─── Players ─────────────────────────────────────────────────

export async function addPlayer(player: Omit<MpPlayer, 'joined_at' | 'id'> & { id?: string }): Promise<MpPlayer> {
  const supa = getClient();
  // Wenn p.id ein echter UUID ist, nutze ihn; sonst lass Supabase einen generieren
  const isUuid = !!player.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player.id);
  const insertData: Record<string, unknown> = {
    session_id: player.session_id,
    user_name: player.user_name,
    player_name: player.player_name,
    player_class: player.player_class,
    hp: player.hp,
    max_hp: player.max_hp,
    stats: player.stats,
    color: player.color,
  };
  if (isUuid) insertData.id = player.id;
  const { data, error } = await supa
    .from('session_players')
    .insert(insertData)
    .select()
    .single();
  if (error) throw error;
  return data as MpPlayer;
}

export async function updatePlayerHp(playerId: string, hp: number): Promise<void> {
  const supa = getClient();
  const { error } = await supa
    .from('session_players')
    .update({ hp })
    .eq('id', playerId);
  if (error) throw error;
}

export async function listPlayers(sessionId: string): Promise<MpPlayer[]> {
  const supa = getClient();
  const { data, error } = await supa
    .from('session_players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data as MpPlayer[]) ?? [];
}

export async function removePlayer(playerId: string): Promise<void> {
  const supa = getClient();
  const { error } = await supa
    .from('session_players')
    .delete()
    .eq('id', playerId);
  if (error) throw error;
}

// ─── Inventory ───────────────────────────────────────────────

export async function addInventoryItem(sessionId: string, name: string): Promise<void> {
  const supa = getClient();
  // Upsert: bei Konflikt quantity erhöhen
  const { data: existing } = await supa
    .from('session_inventory')
    .select('quantity')
    .eq('session_id', sessionId)
    .eq('item_name', name)
    .maybeSingle();
  if (existing) {
    await supa
      .from('session_inventory')
      .update({ quantity: existing.quantity + 1 })
      .eq('session_id', sessionId)
      .eq('item_name', name);
  } else {
    await supa.from('session_inventory').insert({ session_id: sessionId, item_name: name, quantity: 1 });
  }
}

export async function removeInventoryItem(sessionId: string, name: string): Promise<void> {
  const supa = getClient();
  const { data: existing } = await supa
    .from('session_inventory')
    .select('quantity')
    .eq('session_id', sessionId)
    .eq('item_name', name)
    .maybeSingle();
  if (!existing) return;
  if (existing.quantity > 1) {
    await supa
      .from('session_inventory')
      .update({ quantity: existing.quantity - 1 })
      .eq('session_id', sessionId)
      .eq('item_name', name);
  } else {
    await supa
      .from('session_inventory')
      .delete()
      .eq('session_id', sessionId)
      .eq('item_name', name);
  }
}

export async function listInventory(sessionId: string): Promise<MpInventoryItem[]> {
  const supa = getClient();
  const { data, error } = await supa
    .from('session_inventory')
    .select('*')
    .eq('session_id', sessionId)
    .order('added_at', { ascending: true });
  if (error) throw error;
  return (data as MpInventoryItem[]) ?? [];
}

// ─── Messages (Chat) ─────────────────────────────────────────

export async function addMessage(opts: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  speaker?: string;
  content: string;
}): Promise<MpMessage> {
  const supa = getClient();
  const { data, error } = await supa
    .from('session_messages')
    .insert({
      session_id: opts.sessionId,
      role: opts.role,
      speaker: opts.speaker ?? null,
      content: opts.content,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MpMessage;
}

export async function listMessages(sessionId: string, limit = 200): Promise<MpMessage[]> {
  const supa = getClient();
  const { data, error } = await supa
    .from('session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data as MpMessage[]) ?? [];
}

// ─── Realtime Subscriptions ──────────────────────────────────

export interface SessionSubscription {
  unsubscribe: () => void;
}

export function subscribeToSession(
  sessionId: string,
  handlers: {
    onMessage?: (msg: MpMessage) => void;
    onPlayerChange?: (player: MpPlayer, type: 'INSERT' | 'UPDATE' | 'DELETE') => void;
    onInventoryChange?: (item: MpInventoryItem | { session_id: string; item_name: string }, type: 'INSERT' | 'UPDATE' | 'DELETE') => void;
    onSessionClose?: () => void;
    onConnectionChange?: (state: 'connected' | 'disconnected' | 'reconnecting') => void;
  },
): SessionSubscription {
  const supa = getClient();
  const channel: RealtimeChannel = supa
    .channel(`session-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'session_messages', filter: `session_id=eq.${sessionId}` },
      (payload) => handlers.onMessage?.(payload.new as MpMessage),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_players', filter: `session_id=eq.${sessionId}` },
      (payload) => handlers.onPlayerChange?.(
        (payload.new ?? payload.old) as MpPlayer,
        payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      ),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_inventory', filter: `session_id=eq.${sessionId}` },
      (payload) => handlers.onInventoryChange?.(
        (payload.new ?? payload.old) as MpInventoryItem,
        payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      ),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const newRow = payload.new as MpSession;
        if (newRow.closed_at) handlers.onSessionClose?.();
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') handlers.onConnectionChange?.('connected');
      else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') handlers.onConnectionChange?.('disconnected');
      else if (status === 'TIMED_OUT') handlers.onConnectionChange?.('reconnecting');
    });

  return {
    unsubscribe: () => {
      void supa.removeChannel(channel);
    },
  };
}
