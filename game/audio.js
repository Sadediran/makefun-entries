// GLASSKEEP — synthesised sound. WebAudio only, no audio files, no network.
// Glass chimes on fire and hits, a crack on destruction, a win sting and a
// defeat toll. The context is created lazily on the first user gesture.

let ctx = null;
let muted = false;

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  return muted;
}

function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A single struck-glass tone: sine partials with a fast attack and long decay.
function chime(ac, freq, when, dur, gain) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(when);
  osc.stop(when + dur + 0.05);
  // A faint high partial gives the glass its shimmer.
  const partial = ac.createOscillator();
  const pAmp = ac.createGain();
  partial.type = 'sine';
  partial.frequency.value = freq * 2.76;
  pAmp.gain.setValueAtTime(0.0001, when);
  pAmp.gain.exponentialRampToValueAtTime(gain * 0.25, when + 0.01);
  pAmp.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.6);
  partial.connect(pAmp).connect(ac.destination);
  partial.start(when);
  partial.stop(when + dur * 0.6 + 0.05);
}

// Short filtered-noise crack for a shattered moth.
function crack(ac, when) {
  const len = Math.floor(ac.sampleRate * 0.09);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 0.8;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.35, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(when);
}

export function playClick() {
  const ac = audio();
  if (!ac) return;
  chime(ac, 1180, ac.currentTime, 0.18, 0.12);
}

export function playFlip() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  chime(ac, 880, t, 0.22, 0.14);
  chime(ac, 1318, t + 0.05, 0.22, 0.1);
}

export function playFire() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  // Rising glass arpeggio as the beam leaves the emitter.
  chime(ac, 523.25, t, 0.5, 0.2);
  chime(ac, 659.25, t + 0.05, 0.5, 0.18);
  chime(ac, 783.99, t + 0.1, 0.6, 0.2);
  chime(ac, 1046.5, t + 0.15, 0.7, 0.16);
}

export function playHit() {
  const ac = audio();
  if (!ac) return;
  chime(ac, 1567.98, ac.currentTime, 0.35, 0.16);
}

export function playKill() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  crack(ac, t);
  chime(ac, 2093, t + 0.02, 0.5, 0.14);
  chime(ac, 2637, t + 0.06, 0.45, 0.1);
}

export function playBreach() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.3);
  amp.gain.setValueAtTime(0.25, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.connect(amp).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

export function playWin() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  notes.forEach((f, i) => chime(ac, f, t + i * 0.12, 0.9, 0.18));
}

export function playLose() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const notes = [392, 311.13, 261.63, 196];
  notes.forEach((f, i) => chime(ac, f, t + i * 0.35, 1.1, 0.16));
}
