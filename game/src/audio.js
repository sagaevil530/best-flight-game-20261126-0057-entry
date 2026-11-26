// audio.js — every sound is synthesised with WebAudio, so the game
// ships no audio files. Engine drone, wind rush, ring chimes, gear clunks
// and a stall warning, all from oscillators and filtered noise.

export function makeAudio() {
  return {
    ctx: null,
    muted: false,
    engineOsc: null,
    engineGain: null,
    windGain: null,
    windFilter: null,
    started: false,
  };
}

// Must be called from a user gesture at least once; afterwards it is safe
// to call again (it no-ops). Headless browsers without audio just stay silent.
export function ensureAudio(audio) {
  if (audio.started) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    audio.ctx = ctx;

    // Engine: two detuned sawtooths through a low-pass, pitch follows rpm.
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 62;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 93;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.5;
    osc1.connect(oscGain);
    osc2.connect(oscGain);
    oscGain.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    audio.engineOsc = [osc1, osc2];
    audio.engineGain = engineGain;
    audio.engineFilter = engineFilter;

    // Wind: looped noise buffer through a band-pass, gain follows speed.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    noise.start();
    audio.windGain = windGain;
    audio.windFilter = windFilter;

    audio.started = true;
  } catch {
    audio.started = false;
  }
}

// Continuous engine/wind mix, called every frame with the flight state.
export function updateAudio(audio, { throttle, speed, stalled, airborne }) {
  if (!audio.started || !audio.ctx) return;
  const t = audio.ctx.currentTime;
  const mute = audio.muted ? 0 : 1;
  const rpm = 0.25 + throttle * 0.75;
  audio.engineOsc[0].frequency.setTargetAtTime(52 + rpm * 68, t, 0.1);
  audio.engineOsc[1].frequency.setTargetAtTime(78 + rpm * 102, t, 0.1);
  audio.engineFilter.frequency.setTargetAtTime(300 + rpm * 700, t, 0.1);
  audio.engineGain.gain.setTargetAtTime(mute * (0.05 + throttle * 0.075), t, 0.15);
  const wind = airborne ? Math.min(1, speed / 120) : Math.min(1, speed / 160);
  audio.windGain.gain.setTargetAtTime(mute * wind * 0.12, t, 0.2);
  audio.windFilter.frequency.setTargetAtTime(500 + speed * 9, t, 0.2);
  void stalled;
}

// One-shot beep: a short sine blip, used for rings, warnings and clicks.
export function beep(audio, freq, dur, vol, type = 'sine') {
  if (!audio.started || !audio.ctx || audio.muted) return;
  try {
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch {
    // Silent is fine; never let a sound break the game.
  }
}

export function ringChime(audio) {
  beep(audio, 880, 0.18, 0.22);
  setTimeout(() => beep(audio, 1318, 0.28, 0.18), 70);
}

export function warningBeep(audio) {
  beep(audio, 220, 0.22, 0.2, 'square');
}

export function thud(audio) {
  beep(audio, 70, 0.3, 0.3, 'triangle');
}
