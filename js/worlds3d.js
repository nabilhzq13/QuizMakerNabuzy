// The three battle scenes as 3D models. Nothing is loaded from a file: every
// ship, figure and building is put together here from simple shapes and
// shaded by the stage's shaders.
//
// How the motion works:
//   - Figures have skeletons whose joints follow target poses through springs.
//     The trunk is stiff and the hands and head are loose, so limbs lag and
//     overshoot (overlapping action) instead of moving in lockstep.
//   - Every throw has the same beats: a slow wind-up the eye can read
//     (anticipation), a snap forward several times faster, release near peak
//     speed, then the arm carries on past the target and settles (follow-through).
//   - The defender sees it coming and braces during the wind-up.
//   - An impact freezes the world for a few frames (hit-stop), shakes the camera
//     by trauma, flashes the target, knocks it back with a spring and throws
//     debris away from the hit, not in a random ball.
//   - Ships float: four points of the hull sample the same waves the sea shader
//     draws, and heave, pitch and roll follow them with weight.
//
// Everything that fights is built facing +x with its feet (or waterline) at
// y = 0. "You" stand on the left; the opponent is placed on the right and
// mirrored. Each scene returns { attack(by, options), finish(winner) }.

import { sfx } from './sfx.js';
import { ease, Spring, wobble, seaHeight } from './stage3d.js';

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

/** Put the two fighters in place: you on the left, the mirrored opponent on the right. */
function place(S, you, foe, x, z = 0) {
  you.root.position.set(-x, 0, z);
  foe.root.position.set(x, 0, z);
  foe.root.scale.x = -1;
  foe.root.rotation.y *= -1; // a mirrored figure has to turn the other way to face the camera the same amount
  S.scene.add(you.root, foe.root);
  return { you, foe };
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

/** The defender sees the wind-up and braces, then comes back to ready after the hit. */
function brace(S, rig, seconds) {
  S.after(0.08, () => rig.pose(BRACE, 1.1));
  S.after(seconds, () => rig.pose(READY, 0.9));
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
  for (const t of [0.32, 0.44, 0.56, 0.68]) {
    const z = (HULL_BEAM / 2) * beamAt(t) * 0.975 + 0.012;
    for (const s of [1, -1]) S.add(ship, new T.BoxGeometry(0.14, 0.12, 0.03), port, [(t - 0.5) * HULL_LENGTH, 0.27, s * z]);
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

  return { root, fx, muzzle, crew, aim, heave, pitch, roll, state };
}

function pirate(S) {
  const T = S.T;
  const HORIZON = '#16344d';
  S.setLook({ fog: HORIZON, fogNear: 16, fogFar: 64, light: [-0.45, 0.8, 0.55], lightColor: '#b9bccb', ambient: '#262e48', glow: 0.7, glowFrom: 0.84 });

  S.add(S.scene, new T.PlaneGeometry(240, 80), S.sky({ top: '#040915', bottom: HORIZON, haze: '#06121c', stars: 1 }), [0, 26, -62]);
  S.add(S.scene, new T.CircleGeometry(2.3, 40), S.light('#fff1c4', { power: 1.2 }), [2, 7.5, -58]);
  const water = new T.PlaneGeometry(170, 84, 170, 84);
  water.rotateX(-Math.PI / 2);
  S.add(S.scene, water, S.sea({ deep: '#061a2a', sky: '#21506e', moonDir: [0.035, 0.13, -1], moonColor: '#ffe6a8' }), [0, 0, -30]);

  const ships = place(S, buildShip(S, MY_SHIP), buildShip(S, THEIR_SHIP), 4.5);

  /** Spray thrown up where something hits the water. */
  const splash = (pos, size = 1) => S.burst(pos, { count: Math.round(16 * size), colors: ['#cfe3f0', '#8fb4cc', '#ffffff'], speed: 2.2 * size, up: 2.6 * size, size: 0.08, life: 0.9, gravity: 8, dir: [0, 1, 0], spread: 0.45 });

  return {
    async attack(by, { weight = 1 } = {}) {
      const a = ships[by];
      const b = ships[other(by)];
      // gun crew sets, the ship leans into the shot (anticipation), then the broadside
      a.pitch.kick(-0.18);
      await S.wait(0.26);

      const from = S.worldPos(a.muzzle);
      const to = S.worldPos(b.aim).add(new T.Vector3(rand(-0.5, 0.5), rand(-0.05, 0.25), 0));

      sfx.cannon();
      S.flash(from, '#ffe9a8', 1.3);
      S.smoke(from, 7);
      S.burst(from, { count: 10, colors: ['#ffd98a', '#ff9a3c'], speed: 4, up: 0.3, size: 0.06, life: 0.35, gravity: 2, dir: away(from, to), spread: 0.35 });
      S.shake(0.12);
      // recoil: the bow kicks up and the ship rocks back
      a.pitch.kick(0.55);
      a.roll.kick(rand(-0.25, 0.25));
      a.fx.uGust.value = 1;
      S.pulse(a.fx.uGust, 1, 0.9);

      // the crew follow the cannon with their muskets, a little ragged
      a.crew.forEach((man, i) => S.after(0.1 + i * 0.08 + rand(0, 0.06), () => {
        const p = S.worldPos(man).add(new T.Vector3(0, 0.3, 0));
        S.tracer(p, S.worldPos(b.aim).add(new T.Vector3(rand(-0.8, 0.8), rand(0.3, 0.9), 0)), '#ffe9a8');
        S.flash(p, '#ffe9a8', 0.3);
        sfx.musket();
      }));

      const ball = S.add(S.scene, new T.SphereGeometry(0.095, 12, 8), S.toon('#17171c', { rim: '#9fb0c4', rimStrength: 0.5 }));
      const smokeTrail = S.every(dt => { if (dt > 0 && Math.random() < 0.6) S.particles.emit({ pos: ball.position, color: '#9aa3ad', size: 0.08, grow: 0.25, life: 0.5, alpha: 0.35 }); });
      await S.arc(ball, from, to, { height: 1.15, seconds: 0.55, stretch: 0.25 });
      smokeTrail();
      S.scene.remove(ball);

      sfx.crash();
      impactFeel(S, b.fx, weight);
      S.flash(to, '#ffb347', 1.4);
      // splinters fly out of the far side of the hull, away from the shot
      S.burst(to, { count: 30, colors: ['#c28a4a', '#7a4a22', '#f4b63f', '#efe3c4'], speed: 4, up: 1.6, size: 0.1, life: 1, gravity: 8, dir: away(from, to), spread: 0.55 });
      S.smoke(to, 5, '#8d8f94');
      // the ship heels away from the hit and the crew duck
      b.roll.kick(rand(0.7, 1.1) * (Math.random() < 0.5 ? -1 : 1));
      b.heave.kick(-0.35);
      b.pitch.kick(-0.25);
      b.fx.uGust.value = 0.7;
      S.pulse(b.fx.uGust, 0.7, 0.8);
      b.crew.forEach(man => man.userData.duck.kick(-1.4));
      S.after(0.35, () => splash(S.worldPos(b.aim).add(new T.Vector3(0, -0.3, 0.5)), 0.6));
    },

    finish(winner) {
      const lost = ships[other(winner)];
      const won = ships[winner];
      // taking on water: it settles lower and lower, stern first, listing to one side
      S.tween(3.6, k => {
        lost.state.sink = k * k;
        lost.state.list = 0.35 * k;
      }, ease.linear);
      S.every(dt => {
        if (dt > 0 && lost.state.sink > 0.05 && lost.state.sink < 0.95 && Math.random() < 0.35) {
          const p = S.worldPos(lost.aim);
          S.particles.emit({ pos: { x: p.x + rand(-1.4, 1.4), y: 0.02, z: p.z + rand(-0.3, 0.6) }, color: '#d7e7f2', size: 0.06, grow: 0.12, life: 0.8, vel: [0, 0.35, 0], alpha: 0.7 });
        }
      });
      S.after(0.4, () => S.smoke(S.worldPos(lost.aim).add(new T.Vector3(0, 0.4, 0)), 8, '#9fb3c4'));
      S.after(1.2, () => splash(S.worldPos(lost.aim).add(new T.Vector3(-1.2, -0.3, 0)), 1.2));
      S.burst(S.worldPos(won.aim).add(new T.Vector3(0, 2, 0)), { count: 30, colors: ['#f4b63f', '#ffe7a3', '#ffffff'], speed: 3, size: 0.09, life: 1.2, gravity: 3 });
    },
  };
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

function cyber(S) {
  const T = S.T;
  S.setView(5.8);
  S.setLook({ fog: '#1c0a36', fogNear: 9, fogFar: 50, light: [0.25, 0.9, 0.5], lightColor: '#a79bf5', ambient: '#30265a', glow: 1.1, glowFrom: 0.6 });

  S.add(S.scene, new T.PlaneGeometry(240, 80), S.sky({ top: '#06030d', bottom: '#2c0e48', haze: '#3a0c40', stars: 0.35 }), [0, 26, -62]);
  const floor = new T.PlaneGeometry(220, 100);
  floor.rotateX(-Math.PI / 2);
  const grid = S.grid({ base: '#07030e', line: '#ff2bd6', cell: 1.6 });
  S.add(S.scene, floor, grid, [0, 0, -36]);

  const r = seeded(7);
  const wall = S.tower('#170b2c');
  const signs = ['#ff2bd6', '#29f0ff', '#ffb648'];
  for (let i = 0; i < 38; i++) {
    const w = 2 + r() * 3;
    const d = 2 + r() * 2.5;
    const z = -15 - r() * 32;
    const h = 4 + r() * 6 + (-z - 15) * 0.3;
    const x = -42 + r() * 84;
    S.add(S.scene, new T.BoxGeometry(w, h, d), wall, [x, h / 2, z]);
    if (i % 5 === 0) S.add(S.scene, new T.BoxGeometry(0.14, h * 0.42, 0.14), S.light(signs[i % 3], { power: 1.5 }), [x + w / 2 - 0.35, h * 0.55, z + d / 2 + 0.1]);
  }

  const runners = place(S, buildRunner(S, MY_RUNNER), buildRunner(S, THEIR_RUNNER), 3.3);
  for (const who of [runners.you, runners.foe]) {
    const pad = S.group(who.root);
    S.add(pad, new T.CylinderGeometry(1, 1, 0.06, 40), S.toon('#120a22', { rim: who.glow, rimStrength: 0.3 }), [0, 0.03, 0]);
    S.add(pad, new T.TorusGeometry(1, 0.028, 6, 48), S.light(who.glow, { power: 1.4 }), [0, 0.07, 0], [Math.PI / 2, 0, 0]);
  }

  /** A light ring runs out across the floor from a point. */
  const ripple = pos => {
    grid.uniforms.uPulseAt.value.copy(pos);
    S.tween(1.1, k => { grid.uniforms.uPulse.value = 1 - k; }, ease.linear);
  };

  return {
    async attack(by, { weight = 1 } = {}) {
      const a = runners[by];
      const b = runners[other(by)];
      brace(S, b.rig, 1.0);

      const flight = await throwBeat(S, a.rig, () => {
        sfx.disc();
        a.disc.visible = false;
        const disc = discModel(S, a.glow, S.still);
        disc.position.copy(S.worldPos(a.disc));
        S.scene.add(disc);
        const trail = S.trail(disc, a.glow, { width: 0.1, length: 18 });
        return { disc, trail, done: S.arc(disc, disc.position.clone(), S.worldPos(b.aim), { height: 0.45, side: 0.9, seconds: 0.34, spin: [0, 0, 26] }) };
      });
      await flight.done;
      const hit = flight.disc.position.clone();

      sfx.zap();
      impactFeel(S, b.fx, weight);
      b.rig.hit(1.1);
      S.shock(hit, a.glow);
      S.flash(hit, '#ffffff', 0.9);
      S.burst(hit, { count: 26, colors: [a.glow, '#ffffff', '#ff2bd6'], speed: 4.5, up: 0.6, size: 0.08, life: 0.6, gravity: 2, dir: away(S.worldPos(a.aim), hit), spread: 0.6 });
      ripple(S.worldPos(b.root));

      // the disc rebounds off the target and flies back into the thrower's hand
      const back = S.arc(flight.disc, hit, S.worldPos(a.disc), { height: 0.7, side: -0.6, seconds: 0.5, spin: [0, 0, -22] });
      back.then(() => {
        flight.trail.end();
        S.scene.remove(flight.disc);
        a.disc.visible = true;
        a.rig.springs.nearArm0.kick(-120); // the catch pulls the arm back a little
        S.flash(S.worldPos(a.disc), a.glow, 0.4);
      });
    },

    finish(winner) {
      const lost = runners[other(winner)];
      const won = runners[winner];
      lost.rig.idle = 0;
      lost.rig.hit(1.6);
      // a scan line sweeps down and the figure derezzes into cubes
      S.after(0.35, () => {
        let k = 0;
        const stop = S.every(dt => {
          if (dt <= 0) return;
          k = Math.min(1, k + dt / 1.5);
          lost.fx.uDissolve.value = k;
          const p = S.worldPos(lost.root);
          const y = 2.25 - k * 2.6;
          for (let i = 0; i < 2; i++) S.particles.emit({ pos: { x: p.x + rand(-0.3, 0.3), y, z: p.z + rand(-0.2, 0.2) }, color: i ? '#ffffff' : lost.glow, size: 0.05, life: 0.9, vel: [rand(-0.3, 0.3), rand(0.4, 1.2), 0] });
          if (k >= 1) { stop(); lost.root.visible = false; }
        });
      });
      ripple(S.worldPos(lost.root));
      won.rig.pose(CHEER, 0.9);
      S.after(0.2, () => won.rig.hop.kick(1.1));
    },
  };
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

function buildExplorer(S) {
  const T = S.T;
  const fx = S.fx();
  const rim = { rim: '#bfe8d0', rimStrength: 0.28 };
  const shirt = S.toon('#a08a56', { fx, ...rim });
  const skin = S.toon('#c98f5c', { fx, ...rim });
  const f = figure(S, { body: shirt, arms: skin, legs: S.toon('#5b4a2e', { fx, ...rim }), head: skin, hands: skin, feet: S.toon('#2e2416', { fx, ...rim }) });
  f.root.rotation.y = -0.45;

  S.add(f.head, new T.SphereGeometry(0.176, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), S.toon('#2a1c12', { fx, ...rim }), [-0.012, 0.122, 0]);
  const cloth = S.toon('#f0563a', { fx, ...rim });
  S.add(f.head, new T.TorusGeometry(0.17, 0.026, 6, 20), cloth, [0, 0.15, 0], [Math.PI / 2, 0, 0]);
  // the headband tail hangs from a spring, so it flicks after every move
  const tail = S.group(f.head, [-0.17, 0.15, 0.05]);
  S.add(tail, new T.BoxGeometry(0.2, 0.05, 0.02), cloth, [-0.09, 0, 0]);
  const tailSpring = new Spring(2.2, 0.25, 0, -28);
  S.add(f.hips, new T.TorusGeometry(0.16, 0.03, 6, 20), S.toon('#37e2b0', { fx, emissive: 0.35 }), [0, 0.09, 0], [Math.PI / 2, 0, 0], [0.9, 1.15, 1]);

  // the spear rests over the shoulder, ready to throw
  const spear = spearModel(S, fx);
  spear.position.set(-0.2, 0.88, 0.3);
  spear.rotation.z = rad(14);
  f.torso.add(spear);
  const rig = new Rig(S, f);

  let lastHead = 0;
  S.every(dt => {
    if (dt <= 0) return;
    // the tail swings opposite to how fast the head turns
    const turn = (f.head.rotation.z + f.torso.rotation.z - lastHead) / dt;
    lastHead = f.head.rotation.z + f.torso.rotation.z;
    tail.rotation.z = rad(tailSpring.update(dt, -28 - turn * 9));
  });
  return { ...f, fx, spear, rig };
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

function tomb(S) {
  const T = S.T;
  S.setView(6.2);
  S.setLook({
    fog: '#0b1d12', fogNear: 11, fogFar: 44, light: [-0.5, 0.8, 0.5], lightColor: '#a9cdb6', ambient: '#22332a',
    lamp: [2.5, 1.9, -0.4], lampColor: '#ffb648', glow: 0.85, glowFrom: 0.68,
  });

  S.add(S.scene, new T.PlaneGeometry(240, 80), S.sky({ top: '#030805', bottom: '#0b1d12', haze: '#0c2414', stars: 0.5 }), [0, 26, -52]);
  const ground = new T.PlaneGeometry(160, 70);
  ground.rotateX(-Math.PI / 2);
  S.add(S.scene, ground, S.toon('#1c2c1c', { rim: '#000000', rimStrength: 0 }), [0, 0, -24]);

  // the tomb: three stepped tiers of cut stone, with a dark doorway
  const stone = S.toon('#7a775c', { blocks: true, rim: '#ffb648', rimStrength: 0.1 });
  const trimStone = S.toon('#8f8c6e', { rim: '#ffb648', rimStrength: 0.15 });
  const site = S.group(S.scene, [-1.2, 0, 0]);
  S.add(site, new T.BoxGeometry(10, 2.4, 5), stone, [6.6, 1.2, -4.4]);
  S.add(site, new T.BoxGeometry(7.6, 1.3, 4), stone, [7.2, 3.05, -4.8]);
  S.add(site, new T.BoxGeometry(5.2, 1.2, 3), stone, [7.6, 4.3, -5.2]);
  S.add(site, new T.BoxGeometry(8.6, 0.1, 5.6), stone, [5.4, 0.05, 0.3]);
  S.add(site, new T.BoxGeometry(1.6, 1.9, 0.3), S.light('#020403', { power: 1 }), [5, 0.95, -1.82]);
  S.add(site, new T.BoxGeometry(0.3, 2, 0.4), trimStone, [4.05, 1, -1.75]);
  S.add(site, new T.BoxGeometry(0.3, 2, 0.4), trimStone, [5.95, 1, -1.75]);
  S.add(site, new T.BoxGeometry(2.4, 0.36, 0.46), trimStone, [5, 2.16, -1.75]);
  S.add(site, new T.BoxGeometry(2.8, 0.14, 0.6), trimStone, [5, 0.17, -1.4]);
  const jade = S.light('#37e2b0', { power: 1.35 });
  const glyphPower = jade.uniforms.uPower; // the glyphs over the door flare when the gorilla is hit
  for (let i = 0; i < 6; i++) S.add(site, new T.BoxGeometry(0.12, i % 2 ? 0.1 : 0.18, 0.04), jade, [4.25 + i * 0.3, 2.16, -1.5]);

  // a torch on each side of the door
  const iron = S.toon('#3a2a16', { rim: '#ffb648', rimStrength: 0.3 });
  const fire = S.flame();
  for (const x of [3.55, 6.45]) {
    S.add(site, new T.CylinderGeometry(0.04, 0.055, 1.5, 6), iron, [x, 0.75, -1.3]);
    S.add(site, new T.ConeGeometry(0.13, 0.2, 8), iron, [x, 1.5, -1.3], [Math.PI, 0, 0]);
    S.add(site, new T.PlaneGeometry(0.55, 0.9), fire, [x, 2.02, -1.28]);
    S.add(site, new T.CircleGeometry(0.75, 24), S.light('#ffb648', { power: 1, opacity: 0.16, additive: true }), [x, 1.9, -1.34]);
  }

  // the jungle: trunks and canopy behind, ferns on the ground, vines hanging in front
  const r = seeded(21);
  const bark = S.toon('#231f15', { rim: '#7fd0a0', rimStrength: 0.12 });
  const canopy = S.toon('#17452a', { rim: '#9be25a', rimStrength: 0.12 });
  for (const [x, z] of [[-10, -5], [-7, -8], [-3.6, -9.5], [-0.6, -7.2], [1.8, -11], [-12.5, -9.5], [-5.2, -12]]) {
    const h = 6 + r() * 2.5;
    S.add(S.scene, new T.CylinderGeometry(0.2, 0.34, h, 7), bark, [x, h / 2, z]);
    for (let i = 0; i < 3; i++) {
      S.add(S.scene, S.faceted(new T.IcosahedronGeometry(1.5 + r() * 0.9, 0)), canopy, [x + (r() - 0.5) * 2.4, h - 0.6 + r() * 1.6, z + (r() - 0.5) * 1.6]);
    }
  }
  const frond = S.toon('#236b35', { rim: '#9be25a', rimStrength: 0.2 });
  const ferns = [];
  for (const [x, z] of [[-7.6, -2.4], [-2.4, -3.1], [0.9, -2.5], [-5.3, -4.6], [-10.2, -3], [2.4, -5.2], [-0.4, -1.6]]) {
    const fern = S.group(S.scene, [x, 0, z]);
    ferns.push(fern);
    for (let i = 0; i < 7; i++) {
      const length = 1.1 + r() * 0.5;
      const blade = new T.ConeGeometry(0.13, length, 4);
      blade.translate(0, length / 2, 0);
      const turn = S.group(fern, null, [0, (i / 7) * Math.PI * 2, 0]);
      S.add(turn, blade, frond, null, [rad(38 + r() * 30), 0, 0], [1, 1, 0.3]);
    }
  }
  const vine = S.toon('#1d5129', { rim: '#9be25a', rimStrength: 0.15 });
  const vines = [];
  for (const [x, z, drop] of [[-6.4, -0.8, 3.1], [-3, 0.6, 2.4], [1.3, -1.4, 3.4], [-8.2, 0.9, 2.2]]) {
    const hang = S.group(S.scene, [x, 6.4, z]);
    vines.push(hang);
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0, 0), new T.Vector3(0.25, -1.4, 0), new T.Vector3(-0.2, -drop * 0.75, 0), new T.Vector3(0.1, -drop, 0),
    ]);
    S.add(hang, new T.TubeGeometry(curve, 14, 0.035, 5), vine);
    for (let i = 0; i < 4; i++) {
      const p = curve.getPoint(0.4 + i * 0.18);
      S.add(hang, new T.SphereGeometry(0.13, 6, 5), frond, [p.x + (i % 2 ? 0.12 : -0.12), p.y, p.z], [0, 0, rad(i % 2 ? -35 : 35)], [1.5, 0.3, 0.8]);
    }
  }
  // a light breeze: the vines sway and the ferns nod, each on its own slow rhythm
  S.every((dt, t) => {
    vines.forEach((v, i) => { v.rotation.z = wobble(t * 0.4, i * 3.1) * 0.05; });
    ferns.forEach((f, i) => { f.rotation.z = wobble(t * 0.5, i * 1.7 + 9) * 0.04; });
  });
  const shade = S.light('#040d07', { power: 1 });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const leafShape = new T.ConeGeometry(0.34, 1.9, 4);
      leafShape.translate(0, 0.95, 0);
      S.add(S.scene, leafShape, shade, [s * (4.35 - i * 0.25), -0.1, 1.6], [0, 0, s * rad(-12 - i * 26)], [1, 1, 0.2]);
    }
  }

  const you = buildExplorer(S);
  const ape = buildGorilla(S);
  place(S, you, ape, 3.5);
  ape.root.position.set(3.1, 0, -0.1);
  ape.root.rotation.y = 0.35;

  /** Something heavy lands: it drops to the ground, bounces once and lies there, then fades. */
  const drop = (object, fx, from, to, spin) => {
    S.scene.add(object);
    S.arc(object, from, to, { height: 0.35, seconds: 0.38, spin }).then(() => {
      S.burst(to, { count: 8, colors: ['#5b4a2e', '#2e2416'], speed: 1.2, up: 1, size: 0.06, life: 0.5, gravity: 9, floor: true });
      return S.arc(object, to, to.clone().add(new T.Vector3(rand(-0.3, 0.3), 0, 0.1)), { height: 0.12, seconds: 0.22 });
    }).then(() => S.wait(1.6)).then(() => S.tween(0.5, k => { fx.uFade.value = 1 - k; })).then(() => S.scene.remove(object));
  };

  return {
    async attack(by, { weight = 1 } = {}) {
      if (by === 'you') {
        // the gorilla sees the spear coming and shields its face
        S.after(0.12, () => ape.pose({ ...APE_READY, head: -12, rear: -8 }, 1.2));
        const flight = await throwBeat(S, you.rig, () => {
          sfx.whoosh();
          you.spear.visible = false;
          const spear = spearModel(S, S.still);
          const from = S.worldPos(you.spear);
          spear.position.copy(from);
          S.scene.add(spear);
          return { spear, done: S.arc(spear, from, S.worldPos(ape.aim), { height: 0.9, seconds: 0.42, aim: true }) };
        });
        await flight.done;
        const hit = flight.spear.position.clone();
        S.scene.remove(flight.spear);

        sfx.thud();
        S.after(0.08, () => sfx.roar());
        impactFeel(S, ape.fx, weight);
        S.flash(hit, '#fff1c0', 0.7);
        S.burst(hit, { count: 18, colors: ['#919b92', '#c9c8bc', '#37e2b0', '#3d463e'], speed: 3, size: 0.09, life: 0.7, dir: away(S.worldPos(you.aim), hit), spread: 0.6, floor: true });
        ape.recoil.kick(160 * weight);
        ape.shove.kick(-0.9);
        ape.springs.head.kick(320);
        ape.pose({ ...APE_READY, rear: 16, head: 26 }, 1.4);
        S.after(0.5, () => ape.pose(APE_READY, 0.8));
        glyphPower.value = 3;
        S.tween(0.8, k => { glyphPower.value = 3 - 1.65 * k; });
        // the spear glances off and falls to the stone
        const fallen = S.fx();
        drop(spearModel(S, fallen), fallen, hit, new T.Vector3(hit.x - 0.4, 0.04, hit.z + 0.5), [0.6, 0.2, 9]);
        // a fresh spear comes off the explorer's back
        S.after(0.75, () => { you.spear.visible = true; });
        return;
      }

      // the gorilla reaches down for a rock, rears up and hurls it
      brace(S, you.rig, 1.35);
      ape.pose(APE_GRAB, 1.1);
      await S.wait(0.3);
      const rockFx = S.fx();
      const rock = S.add(ape.near.fist, S.faceted(new T.IcosahedronGeometry(0.22, 0)), S.toon('#8d8c80', { fx: rockFx, rim: '#ffd9a0', rimStrength: 0.35 }), [0.05, -0.12, 0]);
      S.burst(S.worldPos(ape.near.fist), { count: 6, colors: ['#5b4a2e'], speed: 0.8, up: 0.6, size: 0.05, life: 0.5, gravity: 9, floor: true });
      ape.pose(APE_WIND, 0.8);
      await S.wait(0.42);
      ape.pose(APE_THROW, 2.2);
      ape.shove.kick(0.7);
      await S.wait(0.12);
      S.after(0.4, () => ape.pose(APE_READY, 0.8));

      sfx.whoosh(true);
      const from = S.worldPos(rock);
      S.scene.attach(rock);
      const to = S.worldPos(you.aim);
      await S.arc(rock, from, to, { height: 1.1, seconds: 0.5, spin: [3, 0, 9] });

      sfx.thud();
      impactFeel(S, you.fx, weight);
      you.rig.hit(1.2);
      S.flash(to, '#fff1c0', 0.6);
      S.burst(to, { count: 18, colors: ['#8d8c80', '#5b4a2e', '#c9c8bc'], speed: 3, size: 0.09, life: 0.7, dir: away(from, to), spread: 0.6, floor: true });
      // the rock drops at the explorer's feet
      S.scene.remove(rock);
      drop(rock, rockFx, to, new T.Vector3(to.x + 0.5, 0.18, to.z + 0.4), [2, 0, 6]);
    },

    finish(winner) {
      if (winner === 'you') {
        // the gorilla flinches, then backs away into the tomb
        ape.idle = 0;
        ape.pose(APE_COWER, 0.9);
        const start = ape.root.position.clone();
        S.after(0.4, () => S.tween(1.9, k => {
          ape.root.position.set(start.x + 0.9 * k, 0, start.z - 1.9 * k);
          ape.fx.uFade.value = 1 - ease.in(k);
        }).then(() => { ape.root.visible = false; }));
        you.rig.pose(CHEER, 0.9);
        S.after(0.25, () => you.rig.hop.kick(1.2));
        return;
      }
      // the explorer is knocked flat, and the gorilla beats its chest
      you.rig.idle = 0;
      you.rig.hit(1.4);
      you.rig.leanTarget = 84;
      you.rig.lean.tune(1.3, 0.55);
      S.after(0.55, () => S.burst(S.worldPos(you.root).add(new T.Vector3(-0.6, 0.05, 0)), { count: 12, colors: ['#5b4a2e', '#8a8f80'], speed: 1.4, up: 1, size: 0.07, life: 0.7, gravity: 9, floor: true }));
      ape.pose(APE_BEAT, 1);
      S.after(0.35, () => {
        sfx.roar();
        let t = 0;
        const stop = S.every(dt => {
          t += dt;
          const s = Math.sin(t * Math.PI * 8);
          ape.target.near1 = 105 + s * 22;
          ape.target.far1 = 105 - s * 22;
          if (t > 1.6) { stop(); ape.pose(APE_READY, 0.8); }
        });
      });
    },
  };
}

export const WORLDS = { pirate, cyber, tomb };
