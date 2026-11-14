// Synthesised sound, no audio files: every effect is an oscillator or filtered noise
// through WebAudio. Created lazily on the first user gesture so the browser allows it.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    return buffer;
  }

  function burst(freq, duration, type = 'square', gain = 0.5, slide = 0) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  function noise(duration, filterFreq, gain = 0.5) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(master);
    source.start(t);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    toggle() { enabled = !enabled; return enabled; },
    shot(kind) {
      if (kind === 'sniper') { noise(0.28, 900, 0.9); burst(140, 0.18, 'sawtooth', 0.5, -90); }
      else if (kind === 'smg') { noise(0.09, 1800, 0.55); burst(320, 0.06, 'square', 0.3, -140); }
      else if (kind === 'pistol') { noise(0.1, 1500, 0.6); burst(260, 0.07, 'square', 0.35, -110); }
      else { noise(0.14, 1400, 0.7); burst(220, 0.09, 'sawtooth', 0.4, -120); }
    },
    distantShot() { noise(0.12, 700, 0.16); },
    hit() { burst(880, 0.05, 'sine', 0.35); },
    kill() { burst(660, 0.08, 'sine', 0.4); burst(990, 0.12, 'sine', 0.35); },
    reload() { burst(1200, 0.03, 'square', 0.18); setTimeout(() => burst(900, 0.03, 'square', 0.18), 260); },
    empty() { burst(1500, 0.03, 'square', 0.2); },
    beep() { burst(1040, 0.09, 'sine', 0.4); },
    plant() { burst(520, 0.12, 'sine', 0.4); setTimeout(() => burst(780, 0.12, 'sine', 0.4), 140); },
    explosion() { noise(0.7, 320, 1.0); burst(70, 0.5, 'sine', 0.8, -40); },
    hurt() { burst(180, 0.12, 'sawtooth', 0.3, -60); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => burst(f, 0.16, 'sine', 0.35), i * 130)); },
    roundLoss() { [392, 330, 262].forEach((f, i) => setTimeout(() => burst(f, 0.18, 'sine', 0.35), i * 140)); },
  };
}
