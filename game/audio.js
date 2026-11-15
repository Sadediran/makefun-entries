// GLASSKEEP v2 — audio.js: WebAudio-synthesised sound, no files.
//
// Every sound is built from oscillators at run time: clicks, glass chimes
// for the beam, a crack for a kill, a low toll for a breach, a win sting
// and a lose toll. The AudioContext is created lazily on the first user
// gesture (browsers block audio before one). Mute is a toggle (M key /
// Sound button). Guarded so importing this file under Node never throws.

let ctx = null;
let muted = false;

/** Create (or reuse) the AudioContext. Null where WebAudio is absent. */
function ac() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Is sound on? */
export function isMuted() {
  return muted;
}

/** Toggle mute. Returns the new state. */
export function toggleMute() {
  muted = !muted;
  return muted;
}

/** One tone: frequency, start time offset, duration, wave shape, volume. */
function tone(freq, at, dur, type = 'sine', vol = 0.12) {
  const c = ac();
  if (!c || muted) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, c.currentTime + at);
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + at);
  osc.stop(c.currentTime + at + dur + 0.02);
}

/** A soft click for buttons and card picks. */
export function playClick() {
  tone(660, 0, 0.07, 'triangle', 0.08);
}

/** A glass tick for flipping a mirror. */
export function playFlip() {
  tone(880, 0, 0.09, 'sine', 0.1);
  tone(1320, 0.03, 0.08, 'sine', 0.06);
}

/** The beam: a rising glass arpeggio. */
export function playFire() {
  tone(523, 0, 0.12, 'sine', 0.1);
  tone(659, 0.05, 0.12, 'sine', 0.1);
  tone(784, 0.1, 0.16, 'sine', 0.1);
  tone(1047, 0.15, 0.2, 'sine', 0.08);
}

/** A hit: a short bright ping. */
export function playHit() {
  tone(1175, 0, 0.08, 'sine', 0.09);
}

/** A kill: a glass crack plus chimes. */
export function playKill() {
  tone(1568, 0, 0.1, 'triangle', 0.1);
  tone(2093, 0.05, 0.16, 'sine', 0.08);
  tone(2637, 0.1, 0.2, 'sine', 0.05);
}

/** A breach: a low descending toll. */
export function playBreach() {
  tone(196, 0, 0.35, 'sine', 0.16);
  tone(147, 0.12, 0.4, 'sine', 0.14);
}

/** A relic drafted: a warm chord. */
export function playDraft() {
  tone(392, 0, 0.2, 'sine', 0.1);
  tone(494, 0.06, 0.2, 'sine', 0.1);
  tone(587, 0.12, 0.3, 'sine', 0.1);
}

/** A craft bought: a coin-like chime. */
export function playCraft() {
  tone(1047, 0, 0.1, 'triangle', 0.1);
  tone(1568, 0.08, 0.18, 'triangle', 0.09);
}

/** Victory: a six-note sting. */
export function playWin() {
  [523, 659, 784, 880, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.28, 'sine', 0.1));
}

/** Defeat: a four-note toll. */
export function playLose() {
  [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.22, 0.4, 'sine', 0.12));
}
