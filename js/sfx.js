// Tiny synth for game sounds. Everything is generated with WebAudio, so there
// are no audio files to load.

import { audioContext, noiseBuffer } from './audio.js';

const KEY = 'quizreactor.muted';
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }

const audio = () => (muted ? null : audioContext());

function tone(freq, at, dur, { type = 'square', vol = 0.05, to = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** A burst of filtered noise: whooshes, cracks, splinters. */
function noise(at, dur, { vol = 0.1, type = 'lowpass', freq = 1000, to = 0, q = 0.8 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.03);
}

const semi = n => 2 ** (n / 12);

export const sfx = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    if (!muted) this.click();
    return muted;
  },
  // these sit a little above the music, so answers are always heard over it
  click() { tone(700, 0, 0.05, { type: 'triangle', vol: 0.08 }); },
  beep() { tone(440, 0, 0.12, { vol: 0.06 }); },
  go() { tone(880, 0, 0.25, { vol: 0.07 }); },
  tick() { tone(1250, 0, 0.035, { type: 'triangle', vol: 0.07 }); },
  flip() { noise(0, 0.09, { vol: 0.08, type: 'bandpass', freq: 1800, to: 3600 }); },
  /** Rises in pitch as the streak grows. */
  correct(streak = 1) {
    const base = 523.25 * semi(Math.min(streak - 1, 6) * 2);
    tone(base, 0, 0.1, { vol: 0.08 });
    tone(base * semi(4), 0.07, 0.1, { vol: 0.08 });
    tone(base * semi(7), 0.14, 0.2, { vol: 0.08 });
  },
  wrong() {
    tone(190, 0, 0.32, { type: 'sawtooth', vol: 0.1, to: 70 });
    tone(95, 0, 0.32, { type: 'square', vol: 0.06, to: 50 });
  },
  finish(good) {
    const notes = good ? [0, 4, 7, 12, 16] : [0, -2, -5];
    notes.forEach((n, i) => tone(392 * semi(n), i * 0.11, i === notes.length - 1 ? 0.5 : 0.14, { vol: 0.08 }));
  },

  // ---- battle sounds ----
  cannon() {
    tone(120, 0, 0.5, { type: 'sine', vol: 0.3, to: 36 });
    noise(0, 0.4, { vol: 0.28, freq: 1400, to: 160 });
  },
  musket(at = 0) { noise(at, 0.07, { vol: 0.12, type: 'bandpass', freq: 2600, q: 0.6 }); },
  /** Cannonball into timber. */
  crash() {
    noise(0, 0.25, { vol: 0.22, type: 'bandpass', freq: 900, to: 300, q: 0.5 });
    tone(150, 0, 0.2, { type: 'triangle', vol: 0.14, to: 55 });
  },
  /** A light disc leaving the hand. */
  disc() {
    tone(480, 0, 0.26, { type: 'sawtooth', vol: 0.05, to: 1500 });
    noise(0, 0.28, { vol: 0.05, type: 'bandpass', freq: 2500, to: 6000, q: 2 });
  },
  zap() {
    tone(1500, 0, 0.22, { type: 'square', vol: 0.07, to: 160 });
    noise(0, 0.12, { vol: 0.08, type: 'highpass', freq: 3200 });
  },
  /** A spear or rock through the air. */
  whoosh(low = false) {
    noise(0, 0.3, { vol: 0.1, type: 'bandpass', freq: low ? 500 : 900, to: low ? 1400 : 2600, q: 1.4 });
  },
  thud() {
    tone(160, 0, 0.22, { type: 'sine', vol: 0.24, to: 52 });
    noise(0, 0.09, { vol: 0.12, freq: 700 });
  },
  roar() {
    // two low saws a few hertz apart beat against each other, like a growl
    tone(96, 0, 0.7, { type: 'sawtooth', vol: 0.09, to: 62 });
    tone(103, 0, 0.7, { type: 'sawtooth', vol: 0.09, to: 68 });
    noise(0, 0.6, { vol: 0.07, freq: 600, to: 250 });
  },
};
