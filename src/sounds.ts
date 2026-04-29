// ────────────────────────────────────────────────────────────
// Sound-Engine — WebAudio-basiert, alles algorithmisch synthetisiert.
// Kein externer File-Download, keine Bundle-Größe-Erhöhung,
// funktioniert offline, klassisch Fantasy-Game-Feel.
// ────────────────────────────────────────────────────────────

const SOUND_PREF_KEY = 'valdermoor:soundEnabled';

let audioCtx: AudioContext | null = null;
let soundEnabled = true;

try {
  soundEnabled = (localStorage.getItem(SOUND_PREF_KEY) ?? '1') === '1';
} catch {
  /* ignore */
}

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  // Resume falls suspended (Autoplay-Policy)
  const ac = audioCtx;
  if (ac && ac.state === 'suspended') void ac.resume();
  return ac;
}

interface NoteOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  delay?: number;
  freqEnd?: number; // für Glissando/Pitch-Bend
}

function note(opts: NoteOpts) {
  if (!soundEnabled) return;
  const c = ctx();
  if (!c) return;
  const { freq, dur, type = 'sine', vol = 0.25, attack = 0.005, delay = 0, freqEnd } = opts;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  const t0 = c.currentTime + delay;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(dur: number, vol: number, freq: number, q: number, delay = 0) {
  if (!soundEnabled) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.floor(dur * c.sampleRate), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const decay = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t0);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(t0);
}

// ────────────────────────────────────────────────────────────
// Konkrete Sounds
// ────────────────────────────────────────────────────────────

/** Würfel-Roll: rasselndes Geräusch + finales "Ding" */
export function playDiceRoll() {
  noiseBurst(0.35, 0.18, 700, 4);
  noiseBurst(0.25, 0.12, 1200, 6, 0.05);
  // Final ding nach dem rollen
  note({ freq: 880, dur: 0.18, type: 'triangle', vol: 0.22, delay: 0.3 });
  note({ freq: 1320, dur: 0.18, type: 'sine', vol: 0.15, delay: 0.32 });
}

/** Item-Pickup: aufsteigender Glitter-Chime (3 Töne) */
export function playItemPickup() {
  note({ freq: 659, dur: 0.12, type: 'sine', vol: 0.22, delay: 0 });
  note({ freq: 880, dur: 0.15, type: 'sine', vol: 0.22, delay: 0.07 });
  note({ freq: 1318, dur: 0.30, type: 'sine', vol: 0.22, delay: 0.15 });
  // Sparkle
  note({ freq: 2000, dur: 0.12, type: 'triangle', vol: 0.10, delay: 0.20 });
}

/** Item-Verlust: absteigend, gedämpft */
export function playItemLost() {
  note({ freq: 880, dur: 0.10, type: 'triangle', vol: 0.18 });
  note({ freq: 659, dur: 0.12, type: 'triangle', vol: 0.18, delay: 0.07 });
  note({ freq: 440, dur: 0.20, type: 'triangle', vol: 0.18, delay: 0.15 });
}

/** Schaden: dumpfer Hit */
export function playDamage() {
  noiseBurst(0.10, 0.4, 200, 1);
  note({ freq: 120, dur: 0.18, type: 'sawtooth', vol: 0.30, freqEnd: 60 });
  note({ freq: 80, dur: 0.20, type: 'square', vol: 0.20, delay: 0.02, freqEnd: 40 });
}

/** Heilung: warmer aufsteigender Akkord */
export function playHeal() {
  note({ freq: 523, dur: 0.20, type: 'sine', vol: 0.20 });          // C5
  note({ freq: 659, dur: 0.25, type: 'sine', vol: 0.20, delay: 0.06 }); // E5
  note({ freq: 784, dur: 0.40, type: 'sine', vol: 0.22, delay: 0.12 }); // G5
}

/** Held bewusstlos / KO */
export function playKnockout() {
  note({ freq: 440, dur: 0.30, type: 'sawtooth', vol: 0.30, freqEnd: 100 });
  note({ freq: 220, dur: 0.50, type: 'square', vol: 0.20, delay: 0.20, freqEnd: 60 });
}

/** Senden: kurzes "click" / "whoosh" */
export function playSend() {
  note({ freq: 1500, dur: 0.04, type: 'sine', vol: 0.12 });
  noiseBurst(0.05, 0.06, 4000, 8);
}

/** DM beginnt zu antworten: subtile, mystische Glocke */
export function playDMStart() {
  note({ freq: 220, dur: 0.40, type: 'sine', vol: 0.12 });
  note({ freq: 440, dur: 0.60, type: 'sine', vol: 0.10, delay: 0.05 });
}

/** Würfel wird vom DM angefordert: alarmierender Ping */
export function playDiceRequest() {
  note({ freq: 880, dur: 0.10, type: 'triangle', vol: 0.20 });
  note({ freq: 1100, dur: 0.20, type: 'triangle', vol: 0.20, delay: 0.10 });
}

/** Login erfolgreich: kleine Fanfare */
export function playLoginSuccess() {
  note({ freq: 523, dur: 0.15, type: 'triangle', vol: 0.22 });
  note({ freq: 659, dur: 0.15, type: 'triangle', vol: 0.22, delay: 0.08 });
  note({ freq: 784, dur: 0.30, type: 'triangle', vol: 0.25, delay: 0.16 });
  note({ freq: 1047, dur: 0.40, type: 'sine', vol: 0.22, delay: 0.30 });
}

/** Fehler / abgelehnt: dissonanter Buzz */
export function playError() {
  note({ freq: 200, dur: 0.20, type: 'square', vol: 0.18, freqEnd: 100 });
}

// ────────────────────────────────────────────────────────────
// Public API: Toggle + State
// ────────────────────────────────────────────────────────────

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Test-Sound zum Probehören wenn Sound ein-/ausgeschaltet wird */
export function playTestSound() {
  if (!soundEnabled) return;
  note({ freq: 880, dur: 0.10, type: 'sine', vol: 0.20 });
  note({ freq: 1318, dur: 0.20, type: 'sine', vol: 0.20, delay: 0.08 });
}
