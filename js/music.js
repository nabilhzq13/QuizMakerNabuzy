// Background music, generated live with WebAudio. There are no audio files:
// each theme has a short original loop written out below as step patterns and
// played by a handful of small synth voices.
//
// Pattern notation, one token per step:
//   D4        play a note            D4+F4+A4  play a chord
//   -         hold the previous note  .         rest
//   D2~       play it softly
//   X x o     drum hit: loud, medium, soft

import { audioContext, noiseBuffer } from './audio.js';

const KEY = 'quizreactor.music';
const LEVEL = 0.38; // overall music volume, kept under the sound effects
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function hz(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error('bad note: ' + name);
  const n = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12 - 9;
  return 440 * 2 ** (n / 12);
}

// ---------- synth voices ----------

/** Attack, decay, sustain, release. Returns the gain node and when it falls silent. */
function shaped(ac, t, dur, { a = 0.005, d = 0.1, s = 0.7, r = 0.1, peak = 1 }) {
  const g = ac.createGain();
  const hold = Math.max(dur, a + d);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.linearRampToValueAtTime(peak * s, t + a + d);
  g.gain.setValueAtTime(peak * s, t + hold);
  g.gain.linearRampToValueAtTime(0, t + hold + r);
  return { g, end: t + hold + r + 0.02 };
}

/** A struck or plucked sound: instant attack, then it rings out. */
function struck(ac, t, peak, ring, attack = 0.002) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + attack + ring);
  g.gain.linearRampToValueAtTime(0, t + attack + ring + 0.01);
  return { g, end: t + attack + ring + 0.03 };
}

function osc(ac, type, f, t, end, detune = 0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

function filter(ac, type, freq, q = 0.7) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function level(ac, v) {
  const g = ac.createGain();
  g.gain.value = v;
  return g;
}

function hiss(ac, t, end) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac);
  s.loop = true;
  s.start(t, Math.random() * 0.8);
  s.stop(end);
  return s;
}

/** Slow pitch wobble that fades in after the note starts. */
function vibrato(ac, oscs, t, end, rate, cents, delay) {
  const l = osc(ac, 'sine', rate, t, end);
  const depth = ac.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + delay);
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.15);
  l.connect(depth);
  oscs.forEach(o => depth.connect(o.detune));
}

const VOICES = {
  // synth bass: a saw through a filter that closes after the attack
  bass(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur * 0.85, { a: 0.005, d: 0.12, s: 0.6, r: 0.06, peak: vel });
    const lp = filter(ac, 'lowpass', f * 7, 2.5);
    lp.frequency.setValueAtTime(f * 7, t);
    lp.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.16);
    osc(ac, 'sawtooth', f, t, end).connect(level(ac, 0.6)).connect(lp);
    osc(ac, 'sine', f, t, end).connect(level(ac, 0.7)).connect(g);
    lp.connect(g).connect(out);
  },
  pluck(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, Math.max(0.2, dur * 1.3));
    const lp = filter(ac, 'lowpass', Math.min(7000, f * 8), 1);
    lp.frequency.setValueAtTime(Math.min(7000, f * 8), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 2), t + 0.22);
    osc(ac, 'sawtooth', f, t, end).connect(level(ac, 0.55)).connect(lp);
    osc(ac, 'square', f, t, end, 7).connect(level(ac, 0.3)).connect(lp);
    lp.connect(g).connect(out);
  },
  pad(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur, { a: 0.35, d: 0.3, s: 0.85, r: 0.6, peak: vel });
    const lp = filter(ac, 'lowpass', 1100, 0.5);
    for (const cents of [-9, 0, 9]) osc(ac, 'sawtooth', f, t, end, cents).connect(level(ac, 0.33)).connect(lp);
    lp.connect(g).connect(out);
  },
  lead(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur * 0.95, { a: 0.02, d: 0.12, s: 0.75, r: 0.14, peak: vel });
    const lp = filter(ac, 'lowpass', 2800, 1.2);
    const a = osc(ac, 'sawtooth', f, t, end, -6);
    const b = osc(ac, 'square', f, t, end, 6);
    vibrato(ac, [a, b], t, end, 5.4, 9, 0.18);
    a.connect(level(ac, 0.5)).connect(lp);
    b.connect(level(ac, 0.35)).connect(lp);
    lp.connect(g).connect(out);
  },
  // accordion: two reeds tuned slightly apart, plus one an octave up
  squeeze(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur * 0.92, { a: 0.03, d: 0.05, s: 0.9, r: 0.07, peak: vel });
    const lp = filter(ac, 'lowpass', 2400, 0.6);
    osc(ac, 'sawtooth', f, t, end, -8).connect(level(ac, 0.4)).connect(lp);
    osc(ac, 'sawtooth', f, t, end, 8).connect(level(ac, 0.4)).connect(lp);
    osc(ac, 'sawtooth', f * 2, t, end).connect(level(ac, 0.14)).connect(lp);
    lp.connect(g).connect(out);
  },
  // tin whistle: nearly a sine, with a little breath and vibrato
  whistle(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur * 0.92, { a: 0.045, d: 0.06, s: 0.85, r: 0.09, peak: vel });
    const a = osc(ac, 'sine', f, t, end);
    const b = osc(ac, 'sine', f * 2, t, end);
    vibrato(ac, [a, b], t, end, 5.2, 14, 0.12);
    a.connect(g);
    b.connect(level(ac, 0.18)).connect(g);
    hiss(ac, t, end).connect(filter(ac, 'bandpass', f * 2.5, 6)).connect(level(ac, 0.06)).connect(g);
    g.connect(out);
  },
  marimba(ac, out, t, f, dur, vel) {
    const ring = Math.min(0.9, Math.max(0.25, 0.22 + 100 / f));
    const body = struck(ac, t, vel, ring);
    osc(ac, 'sine', f, t, body.end).connect(body.g);
    const bar = struck(ac, t, vel * 0.3, 0.09);
    osc(ac, 'sine', f * 4, t, bar.end).connect(bar.g);
    body.g.connect(out);
    bar.g.connect(out);
  },
  kalimba(ac, out, t, f, dur, vel) {
    const body = struck(ac, t, vel, 0.8);
    osc(ac, 'sine', f, t, body.end).connect(body.g);
    osc(ac, 'sine', f * 2, t, body.end).connect(level(ac, 0.12)).connect(body.g);
    const tine = struck(ac, t, vel * 0.2, 0.12);
    osc(ac, 'sine', f * 5.42, t, tine.end).connect(tine.g);
    body.g.connect(out);
    tine.g.connect(out);
  },
  // breathy flute
  flute(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur * 0.95, { a: 0.09, d: 0.1, s: 0.8, r: 0.2, peak: vel });
    const a = osc(ac, 'triangle', f, t, end);
    vibrato(ac, [a], t, end, 4.6, 10, 0.25);
    a.connect(filter(ac, 'lowpass', f * 3.2, 0.7)).connect(g);
    hiss(ac, t, end).connect(filter(ac, 'bandpass', f * 2, 3)).connect(level(ac, 0.13)).connect(g);
    g.connect(out);
  },
  drone(ac, out, t, f, dur, vel) {
    const { g, end } = shaped(ac, t, dur, { a: 0.6, d: 0.3, s: 0.9, r: 0.9, peak: vel });
    osc(ac, 'sine', f, t, end).connect(g);
    osc(ac, 'sine', f * 1.5, t, end).connect(level(ac, 0.3)).connect(g);
    osc(ac, 'sawtooth', f, t, end).connect(filter(ac, 'lowpass', 240, 0.7)).connect(level(ac, 0.35)).connect(g);
    g.connect(out);
  },
  bell(ac, out, t, f, dur, vel) {
    const body = struck(ac, t, vel, 1.3);
    osc(ac, 'sine', f, t, body.end).connect(body.g);
    const hi = struck(ac, t, vel * 0.3, 0.5);
    osc(ac, 'sine', f * 2.76, t, hi.end).connect(hi.g);
    const top = struck(ac, t, vel * 0.12, 0.2);
    osc(ac, 'sine', f * 5.4, t, top.end).connect(top.g);
    body.g.connect(out);
    hi.g.connect(out);
    top.g.connect(out);
  },

  // drums
  kick(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.28);
    const o = osc(ac, 'sine', 150, t, end);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    o.connect(g).connect(out);
  },
  snare(ac, out, t, f, dur, vel) {
    const n = struck(ac, t, vel, 0.16);
    hiss(ac, t, n.end).connect(filter(ac, 'bandpass', 1900, 0.7)).connect(n.g).connect(out);
    const b = struck(ac, t, vel * 0.5, 0.09);
    const o = osc(ac, 'triangle', 185, t, b.end);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(b.g).connect(out);
  },
  hat(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.035, 0.001);
    hiss(ac, t, end).connect(filter(ac, 'highpass', 7500)).connect(g).connect(out);
  },
  shaker(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.06, 0.012);
    hiss(ac, t, end).connect(filter(ac, 'bandpass', 5200, 1.2)).connect(g).connect(out);
  },
  // hand drum, tuned by the note it is given
  tom(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.32);
    const o = osc(ac, 'sine', f * 1.6, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    o.connect(g).connect(out);
    const skin = struck(ac, t, vel * 0.2, 0.03);
    hiss(ac, t, skin.end).connect(filter(ac, 'lowpass', 900)).connect(skin.g).connect(out);
  },
  wood(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.05, 0.001);
    osc(ac, 'triangle', 1150, t, end).connect(g).connect(out);
  },
  rim(ac, out, t, f, dur, vel) {
    const { g, end } = struck(ac, t, vel, 0.03, 0.001);
    osc(ac, 'square', 420, t, end).connect(level(ac, 0.5)).connect(g);
    hiss(ac, t, end).connect(filter(ac, 'highpass', 3000)).connect(level(ac, 0.6)).connect(g);
    g.connect(out);
  },
};

// ---------- the songs ----------

const rep = (bar, n) => Array(n).fill(bar);
const hold = (note, steps = 16) => [note, ...Array(steps - 1).fill('-')].join(' ');
/** The same pattern an octave (or more) higher. */
const up = (bar, by = 1) => bar.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (Number(o) + by));

// hacker: a dark, steady pulse in A minor
const terminal = (() => {
  const bass = {
    am: 'A2 . A2 . A2 . A2 . A2 . A2 . A2 . A3 .',
    f: 'F2 . F2 . F2 . F2 . F2 . F2 . F2 . F3 .',
    g: 'G2 . G2 . G2 . G2 . G2 . G2 . G2 . G3 .',
  };
  const arp = {
    am: 'A3 E4 A4 C5 E5 C5 A4 E4 A3 E4 A4 C5 E5 C5 A4 E4',
    f: 'F3 C4 F4 A4 C5 A4 F4 C4 F3 C4 F4 A4 C5 A4 F4 C4',
    g: 'G3 D4 G4 B4 D5 B4 G4 D4 G3 D4 G4 B4 D5 B4 G4 D4',
  };
  const order = ['am', 'am', 'f', 'g', 'am', 'am', 'f', 'g'];
  const pad = { am: hold('A3+C4+E4'), f: hold('F3+A3+C4'), g: hold('G3+B3+D4') };
  return {
    stepDur: 60 / 92 / 4, spb: 16, bars: 8, echo: 3,
    tracks: [
      { voice: 'bass', gain: 0.21, bars: order.map(c => bass[c]) },
      { voice: 'pluck', gain: 0.17, echo: 0.3, bars: order.map(c => arp[c]) },
      { voice: 'pad', gain: 0.1, rev: 0.4, bars: order.map(c => pad[c]) },
      { voice: 'bell', gain: 0.19, rev: 0.6, echo: 0.3, bars: [
        '', '', '', '',
        'E5 . . . . . . . C5 . . . . . . .',
        'D5 . . . . . . . . . . . E5 . . .',
        'C5 . . . . . . . A4 . . . . . . .',
        'B4 . . . . . . . D5 . . . . . . .',
      ] },
      { voice: 'kick', gain: 0.45, bars: rep('X . . . . . . . X . . . . . x .', 8) },
      { voice: 'hat', gain: 0.19, bars: rep('. . x . . . x . . . x . . . x o', 8) },
      { voice: 'rim', gain: 0.2, bars: rep('. . . . x . . . . . . . x . . .', 8) },
    ],
  };
})();

// pirate: a jig in D minor, six steps to the bar. Tune A twice, then tune B twice.
const broadside = (() => {
  const A = [
    'D4 - F4 A4 - D5',
    'C5 - A4 G4 - E4',
    'F4 - A4 D5 - A4',
    'G4 F4 E4 D4 - -',
    'D4 - F4 A4 - D5',
    'E5 - D5 C5 - A4',
    'Bb4 - A4 G4 - F4',
    'E4 - F4 D4 - -',
  ];
  const B = [
    'F4 - A4 C5 - A4',
    'C5 - D5 C5 - A4',
    'G4 - Bb4 D5 - Bb4',
    'A4 - G4 A4 - -',
    'D5 - D5 C5 - A4',
    'Bb4 - A4 G4 - F4',
    'E4 - G4 F4 - E4',
    'D4 - A3 D4 - -',
  ];
  // bass on the two main beats, a chord stab on the upbeats
  const bass = {
    dm: 'D2 - . A2 - .', c: 'C2 - . G2 - .', gm: 'G2 - . D3 - .', f: 'F2 - . C3 - .',
    a: 'A2 - . E3 - .', bb: 'Bb2 - . F2 - .', am_dm: 'A2 - . D2 - .',
  };
  const stab = {
    dm: '. . D4+F4+A4 . . D4+F4+A4', c: '. . C4+E4+G4 . . C4+E4+G4', gm: '. . G3+Bb3+D4 . . G3+Bb3+D4',
    f: '. . A3+C4+F4 . . A3+C4+F4', a: '. . A3+E4 . . A3+E4', bb: '. . Bb3+D4+F4 . . Bb3+D4+F4',
    am_dm: '. . A3+C4+E4 . . D4+F4+A4',
  };
  const chordsA = ['dm', 'c', 'dm', 'am_dm', 'dm', 'c', 'gm', 'am_dm'];
  const chordsB = ['f', 'f', 'gm', 'a', 'dm', 'bb', 'a', 'dm'];
  const chords = [...chordsA, ...chordsA, ...chordsB, ...chordsB];
  return {
    stepDur: 60 / (108 * 3), spb: 6, bars: 32, echo: 2,
    tracks: [
      { voice: 'squeeze', gain: 0.26, rev: 0.25, bars: [...A, ...A, ...B, ...B] },
      { voice: 'whistle', gain: 0.12, rev: 0.4, bars: [...rep('', 8), ...A.map(b => up(b)), ...rep('', 8), ...B.map(b => up(b))] },
      { voice: 'bass', gain: 0.21, bars: chords.map(c => bass[c]) },
      { voice: 'squeeze', gain: 0.06, bars: chords.map(c => stab[c]) },
      { voice: 'tom', gain: 0.3, bars: rep('D2 . D2~ D2 . D2~', 32) },
      { voice: 'shaker', gain: 0.16, bars: rep('x o o x o o', 32) },
      { voice: 'kick', gain: 0.36, battle: true, bars: rep('X . . X . .', 32) },
      { voice: 'snare', gain: 0.14, battle: true, bars: rep('. . x . . x', 32) },
    ],
  };
})();

// cyber: slow synthwave in E minor. The first four bars are sparse, the lead joins halfway.
const neonRain = (() => {
  const order = ['em', 'c', 'g', 'd'];
  const bass = {
    em: 'E2 . E2 . E2 . E2 . E2 . E2 . E2 . E3 .',
    c: 'C2 . C2 . C2 . C2 . C2 . C2 . C2 . C3 .',
    g: 'G2 . G2 . G2 . G2 . G2 . G2 . G2 . G3 .',
    d: 'D2 . D2 . D2 . D2 . D2 . D2 . D2 . D3 .',
  };
  const pad = { em: hold('E3+G3+B3'), c: hold('E3+G3+C4'), g: hold('D3+G3+B3'), d: hold('D3+F#3+A3') };
  const arp = {
    em: 'E4 . B4 . E5 . B4 . G4 . B4 . E5 . B4 .',
    c: 'C4 . G4 . C5 . G4 . E4 . G4 . C5 . G4 .',
    g: 'G3 . D4 . G4 . D4 . B3 . D4 . G4 . D4 .',
    d: 'D4 . A4 . D5 . A4 . F#4 . A4 . D5 . A4 .',
  };
  const all = part => [0, 1, 2, 3].flatMap(() => order.map(c => part[c]));
  return {
    stepDur: 60 / 104 / 4, spb: 16, bars: 16, echo: 3,
    tracks: [
      { voice: 'bass', gain: 0.21, bars: all(bass) },
      { voice: 'pad', gain: 0.1, rev: 0.5, bars: all(pad) },
      { voice: 'pluck', gain: 0.19, echo: 0.45, bars: all(arp) },
      { voice: 'lead', gain: 0.22, rev: 0.45, echo: 0.3, bars: [
        ...rep('', 8),
        'E5 - - - - - - - G5 - - - F#5 - - -',
        'E5 - - - - - D5 - C5 - - - - - - -',
        'D5 - - - - - - - B4 - - - D5 - - -',
        'F#5 - - - - - E5 - D5 - - - - - - -',
        'G5 - - - - - - - F#5 - - - E5 - - -',
        'G5 - - - - - E5 - C5 - - - - - - -',
        'B5 - - - - - - - A5 - - - G5 - - -',
        'A5 - - - - - F#5 - D5 - - - F#5 - - -',
      ] },
      { voice: 'kick', gain: 0.45, bars: [...rep('X . . . . . . . X . . . . . . .', 4), ...rep('X . . . X . . . X . . . X . . .', 12)] },
      { voice: 'snare', gain: 0.2, bars: [...rep('', 4), ...rep('. . . . X . . . . . . . X . . .', 12)] },
      { voice: 'hat', gain: 0.17, bars: rep('. . x . . . x . . . x . . . x o', 16) },
      { voice: 'hat', gain: 0.1, battle: true, bars: rep('x o x o x o x o x o x o x o x o', 16) },
    ],
  };
})();

// tomb: hand drums and a marimba in D minor pentatonic, with a flute over the second half
const vineAndStone = (() => {
  const M = [
    'D4 . F4 . G4 . A4 . . . G4 . F4 . D4 .',
    'C4 . D4 . F4 . D4 . . . . . A3 . C4 .',
    'D4 . F4 . G4 . A4 . . . C5 . A4 . G4 .',
    'F4 . G4 . D4 . . . . . . . . . . .',
  ];
  const K = [
    'A4 . C5 . D5 . C5 . A4 . G4 . A4 . . .',
    'G4 . A4 . C5 . A4 . G4 . F4 . G4 . . .',
    'F4 . G4 . A4 . G4 . F4 . D4 . F4 . . .',
    'D4 . . . A3 . C4 . D4 . . . . . . .',
  ];
  const none = rep('', 4);
  const drone = rep(hold('D2'), 16);
  drone[6] = drone[14] = 'F2 - - - - - - - C2 - - - - - - -';
  return {
    stepDur: 60 / 88 / 4, spb: 16, bars: 16, echo: 3,
    tracks: [
      { voice: 'drone', gain: 0.1, bars: drone },
      { voice: 'marimba', gain: 0.32, rev: 0.3, bars: [...M, ...none, ...M, ...none] },
      { voice: 'kalimba', gain: 0.26, rev: 0.4, echo: 0.25, bars: [...none, ...K, ...none, ...K] },
      { voice: 'flute', gain: 0.16, rev: 0.6, bars: [
        ...rep('', 8),
        hold('A4'),
        'G4 - - - - - - - F4 - - - - - - -',
        'D4 - - - - - - - - - - - F4 - - -',
        hold('G4'),
        'A4 - - - - - - - C5 - - - - - - -',
        hold('D5'),
        'C5 - - - - - - - A4 - - - - - - -',
        hold('D4'),
      ] },
      { voice: 'tom', gain: 0.32, bars: rep('D2 . . D2~ . . A1 . . . D2~ . F2 . D2~ .', 16) },
      { voice: 'shaker', gain: 0.12, bars: rep('x o x o x o x o x o x o x o x o', 16) },
      { voice: 'wood', gain: 0.16, bars: rep('x . . x . . x . . . x . x . . .', 16) },
      { voice: 'kick', gain: 0.36, battle: true, bars: rep('X . . . X . . . X . . . X . . .', 16) },
    ],
  };
})();

const SONGS = { hacker: terminal, pirate: broadside, cyber: neonRain, tomb: vineAndStone };

/** Turn the pattern strings into a list of notes for every step. */
function compile(song) {
  if (song.total) return song;
  song.total = song.bars * song.spb;
  for (const track of song.tracks) {
    track.events = new Array(song.total);
    track.bars.forEach((bar, b) => {
      if (!bar) return;
      const tokens = bar.trim().split(/\s+/);
      if (tokens.length !== song.spb) throw new Error(`bar ${b + 1} of a ${track.voice} track has ${tokens.length} steps, expected ${song.spb}`);
      let open = null;
      tokens.forEach((tok, i) => {
        if (tok === '-') { if (open) open.len++; return; }
        open = null;
        if (tok === '.') return;
        const drum = /^[Xxo]$/.test(tok);
        const soft = tok.endsWith('~');
        open = {
          freqs: drum ? [0] : tok.replace('~', '').split('+').map(hz),
          len: 1,
          vel: drum ? (tok === 'X' ? 1 : tok === 'x' ? 0.7 : 0.4) : soft ? 0.5 : 1,
        };
        (track.events[b * song.spb + i] ||= []).push(open);
      });
    });
  }
  return song;
}

// ---------- playback ----------

const impulses = new WeakMap();
/** A soft two-second reverb tail, made from fading noise. */
function impulse(ac) {
  let buf = impulses.get(ac);
  if (!buf) {
    const n = Math.floor(ac.sampleRate * 2);
    buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    impulses.set(ac, buf);
  }
  return buf;
}

/** One song wired up on an audio context: track faders, reverb and echo. */
class Deck {
  constructor(ac, dest, song) {
    this.ac = ac;
    this.song = compile(song);
    this.out = ac.createGain();
    this.out.connect(dest);

    const reverb = ac.createConvolver();
    reverb.buffer = impulse(ac);
    reverb.connect(level(ac, 0.5)).connect(this.out);

    const delay = ac.createDelay(1.5);
    delay.delayTime.value = song.echo * song.stepDur;
    const feedback = level(ac, 0.34);
    delay.connect(filter(ac, 'lowpass', 2600)).connect(feedback).connect(delay);
    delay.connect(this.out);

    this.faders = song.tracks.map(track => {
      const g = level(ac, track.gain);
      g.connect(this.out);
      if (track.rev) g.connect(level(ac, track.rev)).connect(reverb);
      if (track.echo) g.connect(level(ac, track.echo)).connect(delay);
      return g;
    });
  }

  /** Schedule everything that starts on step i, at time t. */
  step(i, t, battle) {
    const { song } = this;
    song.tracks.forEach((track, k) => {
      if (track.battle !== undefined && track.battle !== battle) return;
      const notes = track.events[i];
      if (!notes) return;
      for (const note of notes) {
        for (const f of note.freqs) VOICES[track.voice](this.ac, this.faders[k], t, f, note.len * song.stepDur, note.vel);
      }
    });
  }
}

let enabled = true;
try { enabled = localStorage.getItem(KEY) !== '0'; } catch { /* storage blocked */ }

let songId = 'hacker';
let battle = false;
let unlocked = false; // browsers only allow sound after a click or key press
let master = null;
let deck = null;
let timer = 0;
let nextTime = 0;
let stepIndex = 0;

function stop() {
  clearInterval(timer);
  timer = 0;
  if (!deck) return;
  const old = deck;
  deck = null;
  const t = old.ac.currentTime;
  old.out.gain.cancelScheduledValues(t);
  old.out.gain.setValueAtTime(old.out.gain.value, t);
  old.out.gain.linearRampToValueAtTime(0, t + 0.35);
  setTimeout(() => old.out.disconnect(), 2500);
}

function pump() {
  if (!deck) return;
  const { ac, song } = deck;
  // after a stall (a throttled tab, a long frame) jump ahead rather than play a burst of late notes
  if (nextTime < ac.currentTime - 0.05) {
    const missed = Math.ceil((ac.currentTime - nextTime) / song.stepDur);
    stepIndex = (stepIndex + missed) % song.total;
    nextTime += missed * song.stepDur;
  }
  while (nextTime < ac.currentTime + 0.35) {
    deck.step(stepIndex, nextTime, battle);
    nextTime += song.stepDur;
    stepIndex = (stepIndex + 1) % song.total;
  }
}

function start() {
  stop();
  if (!enabled || !unlocked || document.hidden) return;
  const ac = audioContext();
  if (!ac) return;
  if (!master) {
    master = level(ac, LEVEL);
    const squash = ac.createDynamicsCompressor();
    squash.threshold.value = -16;
    squash.ratio.value = 3;
    master.connect(squash).connect(ac.destination);
  }
  deck = new Deck(ac, master, SONGS[songId]);
  deck.out.gain.setValueAtTime(0, ac.currentTime);
  deck.out.gain.linearRampToValueAtTime(1, ac.currentTime + 0.6);
  stepIndex = 0;
  nextTime = ac.currentTime + 0.12;
  timer = setInterval(pump, 60);
  pump();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

export const music = {
  get enabled() { return enabled; },
  get playing() { return !!deck; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
    unlocked = true; // toggling is itself a click
    start();
    return enabled;
  },
  /** Call from the first click or key press. */
  unlock() {
    if (unlocked) return;
    unlocked = true;
    start();
  },
  setTheme(id) {
    if (!SONGS[id] || id === songId) return;
    songId = id;
    if (deck) start();
  },
  /** Battle mode brings in the extra drum tracks. */
  setBattle(on) { battle = !!on; },

  /**
   * Render a song to a buffer without playing it. Used to check levels.
   * `solo` is a track number to hear on its own.
   */
  async render(id, seconds = 20, inBattle = false, solo = -1) {
    const rate = 44100;
    const ac = new OfflineAudioContext(2, Math.floor(seconds * rate), rate);
    const main = level(ac, LEVEL);
    main.connect(ac.destination);
    const d = new Deck(ac, main, SONGS[id]);
    if (solo >= 0) d.faders.forEach((g, k) => { if (k !== solo) g.gain.value = 0; });
    for (let i = 0, t = 0.05; t < seconds; i++, t += d.song.stepDur) d.step(i % d.song.total, t, inBattle);
    return ac.startRendering();
  },
  /** Track names of a song, in order. */
  tracks(id) { return SONGS[id].tracks.map(t => t.voice + (t.battle ? ' (battle)' : '')); },
};
