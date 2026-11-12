// Tiny synth for game sounds. Everything is generated with WebAudio, so there
// are no audio files to load.

const KEY = 'quizreactor.muted';
let ac = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }

function audio() {
  if (muted) return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); } catch { return null; }
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

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

const semi = n => 2 ** (n / 12);

export const sfx = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    if (!muted) this.click();
    return muted;
  },
  click() { tone(700, 0, 0.05, { type: 'triangle', vol: 0.06 }); },
  beep() { tone(440, 0, 0.12, { vol: 0.04 }); },
  go() { tone(880, 0, 0.25, { vol: 0.05 }); },
  tick() { tone(1250, 0, 0.035, { type: 'triangle', vol: 0.05 }); },
  /** Rises in pitch as the streak grows. */
  correct(streak = 1) {
    const base = 523.25 * semi(Math.min(streak - 1, 6) * 2);
    tone(base, 0, 0.1, { vol: 0.05 });
    tone(base * semi(4), 0.07, 0.1, { vol: 0.05 });
    tone(base * semi(7), 0.14, 0.2, { vol: 0.05 });
  },
  wrong() {
    tone(190, 0, 0.32, { type: 'sawtooth', vol: 0.07, to: 70 });
    tone(95, 0, 0.32, { type: 'square', vol: 0.04, to: 50 });
  },
  finish(good) {
    const notes = good ? [0, 4, 7, 12, 16] : [0, -2, -5];
    notes.forEach((n, i) => tone(392 * semi(n), i * 0.11, i === notes.length - 1 ? 0.5 : 0.14, { vol: 0.05 }));
  },
};
