// The models for the battle scenes, and how they move. Nothing is loaded from
// a file: every ship and figure is put together here from simple shapes and
// shaded by the stage's shaders. The scenes themselves are in pov3d.js.
//
// How the motion works:
//   - Figures have skeletons whose joints follow target poses through springs.
//     The trunk is stiff and the hands and head are loose, so limbs lag and
//     overshoot (overlapping action) instead of moving in lockstep.
//   - Every throw has the same beats: a slow wind-up the eye can read
//     (anticipation), a snap forward several times faster, release near peak
//     speed, then the arm carries on past the target and settles (follow-through).
//   - Ships float: four points of the hull sample the same waves the sea shader
//     draws, and heave, pitch and roll follow them with weight.
//
// Everything is built facing +x with its feet (or waterline) at y = 0.

import { Spring, wobble, seaHeight } from './stage3d.js';

const rad = d => d * Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const other = side => (side === 'you' ? 'foe' : 'you');

/** Repeatable random numbers, so a generated skyline or jungle looks the same every time. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Direction from one point to another, as a plain array for particle bursts. */
const away = (from, to) => {
  const d = to.clone().sub(from).normalize();
  return [d.x, d.y, d.z];
};

/**
 * The shared beats of a hit: freeze, shake, punch, flash. `weight` is 1 for a
 * normal hit and higher for the last blow of the battle.
 */
function impactFeel(S, fx, weight = 1) {
  S.hitStop(0.055 + 0.035 * weight);
  S.shake(0.28 + 0.16 * weight);
  S.punch(0.55 + 0.25 * weight);
  fx.uFlash.value = 1;
  S.pulse(fx.uFlash, 1, 0.24);
}

// ---------- jointed figures ----------

/**
 * A figure about 1.8 units tall. Limbs hang from pivots, so turning a joint
 * around z swings it forwards (positive) or backwards (negative).
 * `m` gives the materials: body, arms, legs, head, hands, feet.
 */
function figure(S, m) {
  const T = S.T;
  const root = new T.Group();
  const lean = S.group(root); // hits, falls and weight shifts move this, around the feet
  const hips = S.group(lean, [0, 0.88, 0]);
  S.add(hips, new T.SphereGeometry(0.17, 12, 8), m.legs, null, null, [0.9, 0.7, 1.15]);
  const torso = S.group(hips);
  S.add(torso, new T.CapsuleGeometry(0.17, 0.3, 4, 10), m.body, [0, 0.31, 0], null, [0.85, 1, 1.25]);
  S.add(torso, new T.CylinderGeometry(0.06, 0.07, 0.1, 8), m.head, [0.01, 0.6, 0]);
  const head = S.group(torso, [0.02, 0.66, 0]);
  S.add(head, new T.SphereGeometry(0.17, 14, 10), m.head, [0, 0.11, 0]);

  const arm = side => {
    const shoulder = S.group(torso, [0, 0.52, side * 0.27]);
    S.add(shoulder, new T.SphereGeometry(0.085, 8, 6), m.body);
    S.add(shoulder, new T.CapsuleGeometry(0.062, 0.2, 3, 8), m.arms, [0, -0.16, 0]);
    const elbow = S.group(shoulder, [0, -0.32, 0]);
    S.add(elbow, new T.CapsuleGeometry(0.053, 0.19, 3, 8), m.arms, [0, -0.15, 0]);
    const hand = S.group(elbow, [0, -0.32, 0]);
    S.add(hand, new T.SphereGeometry(0.065, 8, 6), m.hands);
    return { shoulder, elbow, hand };
  };
  const leg = side => {
    const hip = S.group(hips, [0, -0.03, side * 0.11]);
    S.add(hip, new T.CapsuleGeometry(0.085, 0.27, 3, 8), m.legs, [0, -0.21, 0]);
    const knee = S.group(hip, [0, -0.43, 0]);
    S.add(knee, new T.CapsuleGeometry(0.068, 0.27, 3, 8), m.legs, [0, -0.2, 0]);
    S.add(knee, new T.BoxGeometry(0.25, 0.08, 0.11), m.feet, [0.06, -0.42, 0]);
    return { hip, knee };
  };
  const aim = S.group(torso, [0.1, 0.35, 0]); // where incoming shots land
  return { root, lean, hips, torso, head, aim, nearArm: arm(1), farArm: arm(-1), nearLeg: leg(1), farLeg: leg(-1) };
}

// Poses: angles in degrees, [upper, lower] per limb; weight shifts the body forward (+) or back (-).
const READY = { torso: -8, head: 4, weight: 0, nearArm: [-80, -85], farArm: [45, 70], nearLeg: [24, -30], farLeg: [-24, -15] };
const BRACE = { torso: 6, head: -10, weight: -0.07, nearArm: [-30, -110], farArm: [70, 95], nearLeg: [30, -48], farLeg: [-22, -26] };
const WIND = { torso: 12, head: -6, weight: -0.1, nearArm: [-128, -62], farArm: [72, 50], nearLeg: [16, -36], farLeg: [-30, -10] };
const THROW = { torso: -30, head: 8, weight: 0.13, nearArm: [92, -4], farArm: [-38, 42], nearLeg: [36, -40], farLeg: [-34, -6] };
const CHEER = { torso: 4, head: -12, weight: 0, nearArm: [172, -8], farArm: [168, -8], nearLeg: [6, -6], farLeg: [-6, -4] };

// How each joint responds: [frequency in Hz, damping]. The trunk leads, the ends trail and wobble.
const JOINT_FEEL = {
  torso: [2.6, 0.62], head: [1.9, 0.36],
  nearArm0: [3.3, 0.5], nearArm1: [2.5, 0.4], farArm0: [2.3, 0.45], farArm1: [1.9, 0.38],
  nearLeg0: [3, 0.75], nearLeg1: [3, 0.75], farLeg0: [3, 0.75], farLeg1: [3, 0.75],
};

const flatPose = p => ({
  torso: p.torso, head: p.head ?? 0,
  nearArm0: p.nearArm[0], nearArm1: p.nearArm[1], farArm0: p.farArm[0], farArm1: p.farArm[1],
  nearLeg0: p.nearLeg[0], nearLeg1: p.nearLeg[1], farLeg0: p.farLeg[0], farLeg1: p.farLeg[1],
});

/** Drives a figure's joints with springs towards whatever pose it is given. */
class Rig {
  constructor(S, f, start = READY) {
    this.f = f;
    this.bones = {
      torso: f.torso, head: f.head,
      nearArm0: f.nearArm.shoulder, nearArm1: f.nearArm.elbow, farArm0: f.farArm.shoulder, farArm1: f.farArm.elbow,
      nearLeg0: f.nearLeg.hip, nearLeg1: f.nearLeg.knee, farLeg0: f.farLeg.hip, farLeg1: f.farLeg.knee,
    };
    this.target = flatPose(start);
    this.springs = {};
    for (const j in this.bones) this.springs[j] = new Spring(JOINT_FEEL[j][0], JOINT_FEEL[j][1], 0, this.target[j]);
    this.weight = new Spring(2.2, 0.7, 0, 0);
    this.weightTarget = start.weight ?? 0;
    // body reactions, kicked by hits: lean back (degrees), shove back (units), squash (scale)
    this.lean = new Spring(2.1, 0.32);
    this.leanTarget = 0;
    this.shove = new Spring(2.4, 0.5);
    this.squash = new Spring(5.5, 0.28, 0, 1);
    this.hop = new Spring(3.2, 0.45);
    this.idle = 1;
    this.seed = rand(0, 50);
    S.every((dt, t) => this.update(dt, t));
  }

  /** Move to a pose. speed above 1 snaps, below 1 eases in slowly. */
  pose(p, speed = 1) {
    this.target = flatPose(p);
    this.weightTarget = p.weight ?? 0;
    for (const j in this.springs) this.springs[j].tune(JOINT_FEEL[j][0] * speed);
    return this;
  }

  /** Knocked back by a hit, from the front. */
  hit(strength = 1) {
    this.lean.kick(230 * strength);
    this.shove.kick(-1.7 * strength);
    this.squash.kick(-2.6 * strength);
    this.springs.head.kick(-260 * strength);
    this.springs.farArm0.kick(-300 * strength);
    this.springs.nearArm0.kick(-160 * strength);
  }

  update(dt, t) {
    if (dt <= 0) return;
    const s = this.seed;
    const idle = this.idle;
    // small, slow, never-repeating sway on top of the pose, so standing still still looks alive
    const extra = {
      torso: wobble(t * 0.55, s) * 2 * idle, head: wobble(t * 0.4, s + 1) * 5 * idle,
      nearArm0: wobble(t * 0.5, s + 2) * 3 * idle, farArm0: wobble(t * 0.45, s + 3) * 4 * idle,
    };
    for (const j in this.springs) this.bones[j].rotation.z = rad(this.springs[j].update(dt, this.target[j] + (extra[j] || 0)));
    const f = this.f;
    f.lean.rotation.z = rad(this.lean.update(dt, this.leanTarget));
    f.lean.position.x = this.shove.update(dt, 0) + this.weight.update(dt, this.weightTarget);
    const sq = this.squash.update(dt, 1);
    f.lean.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    f.hips.position.y = 0.88 + this.hop.update(dt, 0) + Math.sin(t * 1.7 + s) * 0.008 * idle;
    f.torso.scale.y = 1 + Math.sin(t * 1.5 + s) * 0.012 * idle; // breathing
  }
}

/**
 * Wind up, snap forward, let go, follow through. `release` is called at the
 * moment the hand lets go, and its promise (the flight) is returned.
 */
async function throwBeat(S, rig, release, { windUp = 0.34 } = {}) {
  rig.pose(WIND, 0.75);
  await S.wait(windUp);
  rig.pose(THROW, 2.4);
  rig.shove.kick(0.9);
  await S.wait(0.085);
  const flight = release();
  S.after(0.32, () => rig.pose(READY, 0.85));
  return flight;
}

// ---------- pirate seas ----------

const MY_SHIP = { hull: '#7a4720', keel: '#3a2110', trim: '#f4b63f', deck: '#a9824d', sail: '#e9dcbb', flag: '#f4b63f', mast: '#3a2616', crew: '#241a12', lamp: '#ffd98a', rim: '#ffd58a' };
const THEIR_SHIP = { hull: '#34343f', keel: '#1b1b22', trim: '#ef4a4a', deck: '#55505a', sail: '#a32a3a', flag: '#141418', mast: '#1d1d24', crew: '#101014', lamp: '#ff8d7a', rim: '#ff7a7a' };
const HULL_LENGTH = 4.4;
const HULL_BEAM = 1.2;

/** The beam of the hull at a point along its length (0 = stern, 1 = bow), 0 to 1. */
const beamAt = t => (t < 0.55 ? 0.8 + 0.2 * Math.sin((t / 0.55) * Math.PI / 2) : Math.max(0, Math.cos(((t - 0.55) / 0.45) * Math.PI / 2)) ** 0.8);

/** A hull lofted from cross-sections: blunt stern, raised decks at both ends, pointed bow. */
function hullGeometry(T, c) {
  const BEAM = HULL_BEAM / 2, N = 16;
  const P = [];
  const C = [];
  const paint = { hull: new T.Color(c.hull), trim: new T.Color(c.trim), deck: new T.Color(c.deck), keel: new T.Color(c.keel) };
  const tri = (a, b, d, col) => { for (const v of [a, b, d]) { P.push(...v); C.push(col.r, col.g, col.b); } };
  const quad = (a, b, d, e, col) => { tri(a, b, d, col); tri(a, d, e, col); };

  const stations = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let deck = 0.5 + 0.2 * (2 * t - 1) ** 2;
    if (t <= 0.2) deck += 0.28;
    if (t >= 0.86) deck += 0.12;
    const keel = t > 0.78 ? -0.3 + 0.38 * ((t - 0.78) / 0.22) ** 2 : -0.3;
    stations.push({ x: (t - 0.5) * HULL_LENGTH, b: BEAM * beamAt(t), deck, keel });
  }
  for (let i = 0; i < N; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    for (const s of [1, -1]) {
      const top = p => [p.x, p.deck, s * p.b];
      const band = p => [p.x, p.deck - 0.1, s * p.b];
      const chine = p => [p.x, 0, s * p.b * 0.9];
      const keel = p => [p.x, p.keel, 0];
      quad(top(a), top(b), band(b), band(a), paint.trim);
      quad(band(a), band(b), chine(b), chine(a), paint.hull);
      quad(chine(a), chine(b), keel(b), keel(a), paint.keel);
    }
    quad([a.x, a.deck - 0.04, a.b], [b.x, b.deck - 0.04, b.b], [b.x, b.deck - 0.04, -b.b], [a.x, a.deck - 0.04, -a.b], paint.deck);
  }
  const s0 = stations[0];
  quad([s0.x, s0.deck, s0.b], [s0.x, s0.deck, -s0.b], [s0.x, 0, -s0.b * 0.9], [s0.x, 0, s0.b * 0.9], paint.hull);
  tri([s0.x, 0, s0.b * 0.9], [s0.x, 0, -s0.b * 0.9], [s0.x, s0.keel, 0], paint.keel);

  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

function buildShip(S, c) {
  const T = S.T;
  const fx = S.fx();
  const root = new T.Group();
  const heading = S.group(root, null, [0, -0.38, 0]); // bow turned a little towards the camera; never moves
  const float = S.group(heading);                     // heave, pitch and roll from the waves
  const lean = S.group(float);                        // recoil, hits and sinking
  const ship = lean;

  const wood = S.toon('#ffffff', { fx, vertexColors: true, rim: c.rim, rimStrength: 0.16 });
  const spar = S.toon(c.mast, { fx, rim: c.rim, rimStrength: 0.2 });
  const cloth = S.toon(c.sail, { fx, rim: '#ffffff', rimStrength: 0.08, billow: 0.17 });
  const flat = S.toon(c.sail, { fx, rim: '#ffffff', rimStrength: 0.08 });
  const dark = S.toon(c.crew, { fx, rim: c.rim, rimStrength: 0.35 });

  S.add(ship, hullGeometry(T, c), wood);

  const mast = (x, base, height) => S.add(ship, new T.CylinderGeometry(0.03, 0.05, height, 6), spar, [x, base + height / 2, 0]);
  mast(-1.25, 0.86, 1.8);
  mast(0, 0.5, 2.6);
  mast(1.15, 0.52, 2.1);
  S.add(ship, new T.CylinderGeometry(0.022, 0.034, 1.15, 5), spar, [2.62, 1.0, 0], [0, 0, rad(-72)]);

  // square sails, braced round so the wind (and the camera) catches them
  const squareSail = (x, y, w, h) => {
    const g = S.group(ship, [x, y, 0], [0, 0.6, 0]);
    S.add(g, new T.PlaneGeometry(w, h, 10, 8), cloth, [0, 0, 0.05]);
    S.add(g, new T.CylinderGeometry(0.02, 0.02, w + 0.14, 5), spar, [0, h / 2, 0], [0, 0, Math.PI / 2]);
  };
  squareSail(0, 1.28, 1.3, 0.86);
  squareSail(0, 2.14, 1.05, 0.72);
  squareSail(0, 2.8, 0.74, 0.46);
  squareSail(1.15, 1.26, 1.1, 0.8);
  squareSail(1.15, 2.05, 0.86, 0.64);

  const jib = new T.BufferGeometry();
  jib.setAttribute('position', new T.Float32BufferAttribute([1.22, 2.56, 0, 3.12, 1.2, 0, 1.6, 1.0, 0], 3));
  jib.computeVertexNormals();
  S.add(ship, jib, flat);
  S.add(ship, new T.PlaneGeometry(0.98, 1.1, 6, 6), S.toon(c.sail, { fx, rimStrength: 0.08, billow: 0.07 }), [-1.78, 1.86, 0]);
  S.add(ship, new T.CylinderGeometry(0.018, 0.018, 1.05, 5), spar, [-1.78, 2.42, 0], [0, 0, rad(78)]);
  S.add(ship, new T.PlaneGeometry(0.44, 0.25, 8, 3), S.toon(c.flag, { fx, rimStrength: 0.1, billow: 0.05 }), [0.25, 3.2, 0]);

  const port = S.toon('#0c0a0a', { fx });
  const ports = []; // the guns along the side that faces +z, for firing a broadside
  for (const t of [0.32, 0.44, 0.56, 0.68]) {
    const z = (HULL_BEAM / 2) * beamAt(t) * 0.975 + 0.012;
    for (const s of [1, -1]) S.add(ship, new T.BoxGeometry(0.14, 0.12, 0.03), port, [(t - 0.5) * HULL_LENGTH, 0.27, s * z]);
    ports.push(S.group(ship, [(t - 0.5) * HULL_LENGTH, 0.27, z + 0.08]));
  }
  const gun = S.add(ship, new T.CylinderGeometry(0.05, 0.068, 0.52, 8), port, [1.5, 0.7, 0.12], [0, 0, rad(-76)]);
  const muzzle = S.group(gun, [0, 0.28, 0]);

  // three of the crew along the rail; each one ducks when the ship is hit
  const crew = [-0.6, 0.15, 0.78].map(x => {
    const man = S.group(ship, [x, 0.48, 0.12]);
    S.add(man, new T.CapsuleGeometry(0.06, 0.15, 3, 6), dark, [0, 0.14, 0]);
    S.add(man, new T.SphereGeometry(0.058, 8, 6), dark, [0, 0.34, 0]);
    S.add(man, new T.CylinderGeometry(0.012, 0.012, 0.34, 4), dark, [0.14, 0.24, 0.02], [0, 0, rad(-80)]);
    man.userData.duck = new Spring(3, 0.4, 0, 0);
    return man;
  });

  S.add(ship, new T.SphereGeometry(0.07, 10, 8), S.light(c.lamp, { fx, power: 1.5 }), [-2.12, 1.28, 0]);
  const aim = S.group(ship, [0.3, 0.32, 0.36]);

  // ---- floating ----
  // four points on the hull sample the swell; the ship follows them through springs, so it has weight
  const probes = [[HULL_LENGTH * 0.42, 0], [-HULL_LENGTH * 0.42, 0], [0, HULL_BEAM * 0.45], [0, -HULL_BEAM * 0.45]]
    .map(([x, z]) => S.group(heading, [x, 0, z]));
  const heave = new Spring(0.9, 0.5, 0, 0);
  const pitch = new Spring(0.75, 0.45, 0, 0);
  const roll = new Spring(0.65, 0.3, 0, 0);
  const state = { sink: 0, list: 0 };
  S.every((dt, t) => {
    if (dt <= 0) return;
    const h = probes.map(p => { const w = S.worldPos(p); return seaHeight(w.x, w.z, t); });
    const level = (h[0] + h[1] + h[2] + h[3]) / 4;
    float.position.y = heave.update(dt, level - 0.04 - state.sink * 3.4);
    float.rotation.z = pitch.update(dt, Math.atan2(h[0] - h[1], HULL_LENGTH * 0.84) + state.sink * 0.5);
    float.rotation.x = roll.update(dt, -Math.atan2(h[2] - h[3], HULL_BEAM * 0.9) + state.list);
    for (const man of crew) man.position.y = 0.48 + man.userData.duck.update(dt, 0);
  });

  return { root, fx, muzzle, ports, crew, aim, heave, pitch, roll, state };
}

// ---------- cyberpunk city ----------

const MY_RUNNER = { suit: '#232a66', dark: '#141838', glow: '#29f0ff' };
const THEIR_RUNNER = { suit: '#4a1d26', dark: '#2a1016', glow: '#ff7a1a' };

function discModel(S, color, fx) {
  const T = S.T;
  const g = new T.Group();
  S.add(g, new T.TorusGeometry(0.2, 0.034, 8, 28), S.light(color, { fx, power: 1.6 }));
  S.add(g, new T.CircleGeometry(0.17, 24), S.light(color, { fx, power: 1, opacity: 0.3, additive: true }));
  return g;
}

function buildRunner(S, c) {
  const T = S.T;
  const fx = S.fx();
  const suit = S.toon(c.suit, { fx, rim: c.glow, rimStrength: 0.6 });
  const dark = S.toon(c.dark, { fx, rim: c.glow, rimStrength: 0.45 });
  const neon = S.light(c.glow, { fx, power: 1.5 });
  const f = figure(S, { body: suit, arms: suit, legs: dark, head: dark, hands: dark, feet: dark });
  f.root.rotation.y = -0.45; // turned a little towards the camera

  const band = (parent, radius, y, squash) => S.add(parent, new T.TorusGeometry(radius, 0.013, 6, 20), neon, [0, y, 0], [Math.PI / 2, 0, 0], squash);
  band(f.torso, 0.176, 0.1, [0.85, 1.25, 1]);
  band(f.torso, 0.186, 0.42, [0.85, 1.25, 1]);
  for (const arm of [f.nearArm, f.farArm]) { band(arm.shoulder, 0.07, -0.2); band(arm.elbow, 0.061, -0.2); }
  for (const leg of [f.nearLeg, f.farLeg]) { band(leg.hip, 0.093, -0.24); band(leg.knee, 0.076, -0.24); }
  S.add(f.head, new T.BoxGeometry(0.06, 0.05, 0.27), neon, [0.14, 0.13, 0]);
  S.add(f.torso, new T.BoxGeometry(0.02, 0.26, 0.03), neon, [0.15, 0.3, 0]);

  const disc = discModel(S, c.glow, fx);
  disc.position.set(0.06, -0.06, 0);
  f.nearArm.hand.add(disc);
  const rig = new Rig(S, f);

  S.every((dt, t) => { if (dt > 0) disc.rotation.z = t * 1.2; });
  return { ...f, fx, disc, rig, glow: c.glow };
}

// ---------- jungle tomb ----------

function spearModel(S, fx) {
  const T = S.T;
  const g = new T.Group();
  S.add(g, new T.CylinderGeometry(0.02, 0.02, 1.6, 6), S.toon('#8a6436', { fx, rim: '#ffd9a0' }), [0.1, 0, 0], [0, 0, -Math.PI / 2]);
  S.add(g, S.faceted(new T.ConeGeometry(0.06, 0.24, 5)), S.toon('#c9c8bc', { fx, rim: '#ffffff', rimStrength: 0.4 }), [1.0, 0, 0], [0, 0, -Math.PI / 2]);
  S.add(g, new T.TorusGeometry(0.03, 0.012, 5, 10), S.light('#37e2b0', { fx, power: 1.3 }), [0.86, 0, 0], [0, Math.PI / 2, 0]);
  return g;
}

// The gorilla's poses: how far it rears up, its head, and [shoulder, elbow] for each arm.
const APE_READY = { rear: 0, head: 0, near: [12, -6], far: [22, -10] };
const APE_GRAB = { rear: -16, head: 10, near: [58, -10], far: [22, -14] };
const APE_WIND = { rear: 30, head: 14, near: [-150, -45], far: [35, -5] };
const APE_THROW = { rear: -10, head: -8, near: [80, -12], far: [-10, -20] };
const APE_BEAT = { rear: 26, head: 14, near: [40, 105], far: [40, 105] };
const APE_COWER = { rear: -6, head: 28, near: [70, 60], far: [60, 70] };

function buildGorilla(S) {
  const T = S.T;
  const fx = S.fx();
  const lit = strength => ({ fx, rim: '#ffb648', rimStrength: strength });
  const fur = S.toon('#3d463e', lit(0.5));
  const dark = S.toon('#272d28', lit(0.4));
  const pale = S.toon('#5d685f', lit(0.3));

  const root = new T.Group();
  const lean = S.group(root);
  const hips = S.group(lean, [-0.5, 0.78, 0]);
  S.add(hips, new T.SphereGeometry(0.5, 14, 10), fur, null, null, [1, 0.95, 1.05]);
  for (const s of [1, -1]) {
    const leg = S.group(hips, [0.05, -0.15, s * 0.36]);
    S.add(leg, new T.CapsuleGeometry(0.2, 0.22, 3, 8), dark, [0.12, -0.2, 0], [0, 0, rad(35)]);
    S.add(leg, new T.CapsuleGeometry(0.15, 0.2, 3, 8), dark, [0.12, -0.46, 0], [0, 0, rad(-20)]);
    S.add(leg, new T.BoxGeometry(0.42, 0.12, 0.24), dark, [0.2, -0.57, 0]);
  }

  const upper = S.group(hips, [0.1, 0.1, 0]);
  S.add(upper, new T.SphereGeometry(0.62, 16, 12), fur, [0.42, 0.35, 0], [0, 0, rad(-20)], [1.15, 0.95, 1]);
  S.add(upper, new T.SphereGeometry(0.5, 14, 10), S.toon('#919b92', { fx, rim: '#ffd9a0', rimStrength: 0.35 }), [0.2, 0.62, 0], null, [1.05, 0.45, 0.85]);
  S.add(upper, new T.SphereGeometry(0.46, 14, 10), S.toon('#4e584f', lit(0.35)), [0.78, 0.22, 0], null, [0.8, 0.9, 0.95]);

  const head = S.group(upper, [1.02, 0.78, 0]);
  S.add(head, new T.SphereGeometry(0.3, 14, 12), fur, null, null, [1, 1.05, 0.95]);
  S.add(head, new T.ConeGeometry(0.2, 0.34, 10), fur, [-0.1, 0.3, 0], [0, 0, rad(18)]);
  S.add(head, new T.BoxGeometry(0.16, 0.09, 0.46), dark, [0.2, 0.09, 0]);
  S.add(head, new T.SphereGeometry(0.18, 12, 10), pale, [0.22, -0.1, 0], null, [1, 0.85, 1.1]);
  const eye = S.light('#ffb648', { fx, power: 1.7 });
  S.add(head, new T.SphereGeometry(0.036, 8, 6), eye, [0.268, 0.03, 0.11]);
  S.add(head, new T.SphereGeometry(0.036, 8, 6), eye, [0.268, 0.03, -0.11]);

  const arm = s => {
    const shoulder = S.group(upper, [0.62, 0.62, s * 0.56]);
    S.add(shoulder, new T.SphereGeometry(0.24, 10, 8), fur);
    S.add(shoulder, new T.CapsuleGeometry(0.18, 0.4, 3, 8), fur, [0, -0.36, 0]);
    const elbow = S.group(shoulder, [0, -0.72, 0]);
    S.add(elbow, new T.CapsuleGeometry(0.165, 0.34, 3, 8), dark, [0, -0.3, 0]);
    const fist = S.group(elbow, [0, -0.64, 0]);
    S.add(fist, new T.SphereGeometry(0.2, 10, 8), dark, null, null, [1.1, 0.85, 1]);
    return { shoulder, elbow, fist };
  };
  const near = arm(1);
  const far = arm(-1);
  const aim = S.group(upper, [0.7, 0.3, 0.3]);

  // a heavy body: slower, more damped springs than the explorer's
  const joints = { rear: upper, head, near0: near.shoulder, near1: near.elbow, far0: far.shoulder, far1: far.elbow };
  const feel = { rear: [1.6, 0.6], head: [1.5, 0.4], near0: [2.2, 0.5], near1: [1.8, 0.42], far0: [1.7, 0.45], far1: [1.5, 0.4] };
  const springs = {};
  for (const j in joints) springs[j] = new Spring(feel[j][0], feel[j][1], 0, 0);
  const ape = {
    root, lean, upper, head, near, far, aim, fx, springs,
    target: null, recoil: new Spring(1.8, 0.35), shove: new Spring(2, 0.5), idle: 1,
    pose(p, speed = 1) {
      this.target = { rear: p.rear, head: p.head, near0: p.near[0], near1: p.near[1], far0: p.far[0], far1: p.far[1] };
      for (const j in springs) springs[j].tune(feel[j][0] * speed);
    },
  };
  ape.pose(APE_READY);
  for (const j in springs) springs[j].snap(ape.target[j]);
  const seed = rand(0, 50);
  S.every((dt, t) => {
    if (dt <= 0) return;
    const idle = ape.idle;
    const extra = { rear: wobble(t * 0.35, seed) * 3 * idle, head: wobble(t * 0.5, seed + 1) * 8 * idle };
    for (const j in springs) joints[j].rotation.z = rad(springs[j].update(dt, ape.target[j] + (extra[j] || 0)));
    lean.rotation.z = rad(ape.recoil.update(dt, 0));
    lean.position.x = ape.shove.update(dt, 0);
    upper.scale.y = 1 + Math.sin(t * 1.1 + seed) * 0.018 * idle; // slow, heavy breathing
  });
  return ape;
}

export {
  rad, rand, other, seeded, away, impactFeel,
  figure, Rig, READY, BRACE, WIND, THROW, CHEER, throwBeat,
  buildShip, MY_SHIP, THEIR_SHIP, HULL_LENGTH,
  discModel, buildRunner, MY_RUNNER, THEIR_RUNNER,
  spearModel, buildGorilla, APE_READY, APE_GRAB, APE_WIND, APE_THROW, APE_BEAT, APE_COWER,
};
