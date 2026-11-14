// The three battle scenes, seen through your own eyes.
//
// The camera stands where you stand and faces the enemy. The scene fills the
// whole screen behind the quiz; the stage aims and zooms the camera so the
// enemy sits in the gap between the health bars and the question (see
// Stage.setPov and Stage.frameOn). What you hold is parented to the camera:
// a cannon and the ship's rail, an arm with a light disc, an arm with a spear.
//
//   pirate  from your deck: an enemy ship broadside across the water
//   cyber   on the grid: a rival runner facing you, the city all around
//   tomb    in the clearing: the gorilla in front of the tomb door
//
// When you attack, the shot leaves your hands and flies away from you. When
// the enemy attacks, it comes straight at the camera, and the hit shakes your
// view and reddens its edges. Each scene returns { attack(by, options), finish(winner) }.

import { sfx } from './sfx.js';
import { ease, Spring } from './stage3d.js';
import {
  rad, rand, seeded, away, impactFeel, Rig, READY, BRACE, CHEER, throwBeat,
  buildShip, THEIR_SHIP, discModel, buildRunner, MY_RUNNER, THEIR_RUNNER,
  spearModel, buildGorilla, APE_READY, APE_GRAB, APE_WIND, APE_THROW, APE_BEAT, APE_COWER,
} from './models3d.js';

// ---------- what you hold ----------

// Poses for a held thing: how far it moves [right, up, towards you] and turns [x, y, z] from rest.
const REST = [0, 0, 0, 0, 0, 0];
const PULL = [0.1, -0.06, 0.22, 0.35, 0.25, 0.2];      // drawn back, ready to throw
const FLING = [-0.1, 0.07, -0.4, -0.4, -0.28, -0.1]; // arm thrown out in front
const GUARD = [-0.1, 0.07, 0.03, 0.06, 0.26, 0.24];      // raised across the body
const RAISED = [0.02, 0.22, -0.05, -0.15, 0, 0.1];      // held up in triumph
const DROPPED = [0.1, -1.1, 0.2, 0.8, 0, 0];           // fallen out of view

/** A first-person arm or weapon: it moves between poses on springs, so it has weight. */
class Hand {
  constructor(S, group) {
    this.group = group;
    this.base = group.position.clone();
    this.springs = REST.map((_, i) => new Spring(i < 3 ? 3 : 2.6, 0.5));
    this.target = [...REST];
    S.every(dt => {
      if (dt <= 0) return;
      const v = this.springs.map((s, i) => s.update(dt, this.target[i]));
      group.position.set(this.base.x + v[0], this.base.y + v[1], this.base.z + v[2]);
      group.rotation.set(v[3], v[4], v[5]);
    });
  }

  /** Move to a pose. speed above 1 snaps, below 1 eases. */
  pose(p, speed = 1) {
    this.target = [...p];
    this.springs.forEach((s, i) => s.tune((i < 3 ? 3 : 2.6) * speed));
  }

  /** Knock one part of the pose (0-2 position, 3-5 rotation), e.g. recoil. */
  kick(i, v) { this.springs[i].kick(v); }

  /** Where it rests, in camera space, and how big it is. Call from S.onResize. */
  anchor(v, scale = 1) {
    this.base.copy(v);
    this.group.scale.setScalar(scale);
  }
}

/** A forearm coming in from the bottom right of the view, with the hand at the group's origin. */
function armModel(S, { arm, hand }) {
  const T = S.T;
  const g = new T.Group();
  const elbow = new T.Vector3(0.3, -0.34, 0.5);
  const fore = S.add(g, new T.CapsuleGeometry(0.05, 0.95, 4, 10), arm);
  fore.position.copy(elbow).multiplyScalar(0.72);
  fore.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), elbow.clone().normalize());
  S.add(g, new T.SphereGeometry(0.068, 12, 8), hand, null, null, [1.1, 0.9, 1]);
  return { g, elbow, turn: fore.quaternion.clone() };
}

/** Stretch a thin unit-height mesh between two points. */
function span(T, mesh, a, b) {
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.scale.set(1, a.distanceTo(b), 1);
}

/** The shared beats of taking a hit yourself: freeze, a hard shake, red edges. */
function youAreHit(S, weight = 1) {
  S.hitStop(0.07 + 0.04 * weight);
  S.shake(0.5 + 0.15 * weight);
  S.punch(0.8);
  S.hurt(0.85 + 0.2 * weight);
}

/** A lighter version of impactFeel for a hit that lands far away from you. */
function farHit(S, fx, weight = 1) {
  S.hitStop(0.05 + 0.035 * weight);
  S.shake(0.2 + 0.1 * weight);
  S.punch(0.4 + 0.2 * weight);
  fx.uFlash.value = 1;
  S.pulse(fx.uFlash, 1, 0.24);
}

/** You go down: the view drops and tips back. */
function collapse(S, hand, { drop = -1, fall = 0.5, tilt = 0 } = {}) {
  S.head.dropTo = drop;
  S.head.fallTo = fall;
  S.head.tiltTo = tilt;
  hand.pose(DROPPED, 0.5);
  S.hurt(1);
  S.after(0.5, () => S.hurt(0.6));
}

// ---------- pirate seas ----------

function pirate(S) {
  const T = S.T;
  const HORIZON = '#16344d';
  S.setLook({ fog: HORIZON, fogNear: 16, fogFar: 64, light: [-0.45, 0.8, 0.55], lightColor: '#b9bccb', ambient: '#262e48', glow: 0.7, glowFrom: 0.84 });
  S.setPov({ eye: [0, 1.9, 0], target: [0.2, 1.5, -11], size: [5.6, 4.3] });

  S.add(S.scene, new T.PlaneGeometry(260, 90), S.sky({ top: '#040915', bottom: HORIZON, haze: '#06121c', stars: 1 }), [0, 30, -64]);
  S.add(S.scene, new T.CircleGeometry(2.3, 40), S.light('#fff1c4', { power: 1.2 }), [-17, 7.4, -58]);
  const water = new T.PlaneGeometry(170, 90, 170, 90);
  water.rotateX(-Math.PI / 2);
  S.add(S.scene, water, S.sea({ deep: '#061a2a', sky: '#21506e', moonDir: [-0.28, 0.1, -1], moonColor: '#ffe6a8' }), [0, 0, -32]);

  // the enemy lies broadside across your bow, her guns facing you
  const enemy = buildShip(S, THEIR_SHIP);
  enemy.root.position.set(0.2, 0, -11);
  S.scene.add(enemy.root);

  // your own ship, as you see it: the rail in front of you, the shrouds to your left, your gun to the right
  const wood = S.toon('#7a4720', { rim: '#ffd58a', rimStrength: 0.2 });
  const darkWood = S.toon('#4a2a14', { rim: '#ffd58a', rimStrength: 0.12 });
  const iron = S.toon('#1a1a20', { rim: '#9fb0c4', rimStrength: 0.45 });
  const rope = S.toon('#3a2616', { rim: '#ffd58a', rimStrength: 0.25 });

  const rail = S.group(S.hands);
  S.add(rail, new T.BoxGeometry(1, 0.07, 0.12), wood);
  S.add(rail, new T.BoxGeometry(1, 0.02, 0.125), S.toon('#f4b63f', { emissive: 0.15 }), [0, 0.045, 0]);
  S.add(rail, new T.BoxGeometry(1, 0.9, 0.05), darkWood, [0, -0.48, 0]);
  const railBump = new Spring(4, 0.3);
  const ropes = [0, 1, 2].map(() => S.add(S.hands, new T.CylinderGeometry(0.012, 0.012, 1, 5), rope));

  const gunGroup = S.group(S.hands);
  const aimDir = new T.Vector3(-0.11, 0.1, -1).normalize();
  const barrel = S.add(gunGroup, new T.CylinderGeometry(0.085, 0.13, 1.5, 14), iron);
  barrel.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), aimDir);
  barrel.position.copy(aimDir).multiplyScalar(0.35);
  for (const y of [0.7, 0.15, -0.45]) S.add(barrel, new T.TorusGeometry(0.1 + (0.7 - y) * 0.02, 0.016, 6, 18), iron, [0, y, 0], [Math.PI / 2, 0, 0]);
  S.add(gunGroup, new T.BoxGeometry(0.36, 0.2, 0.75), wood, [0.02, -0.22, 0.1]);
  const muzzle = S.group(barrel, [0, 0.78, 0]);
  const gun = new Hand(S, gunGroup);

  S.onResize(() => {
    const low = S.pov.bottom;
    rail.position.copy(S.screenPoint(0, low + 0.03, 1.6));
    rail.scale.x = 2.6 * S.pov.tan * S.camera.aspect * 1.6;
    ropes.forEach((r, k) => span(T, r, S.screenPoint(-1.04 + k * 0.13, low - 0.25, 1.9), S.screenPoint(-0.66 + k * 0.07, 1.2, 3)));
    gun.anchor(S.screenPoint(S.camera.aspect > 1 ? 0.6 : 0.66, low + 0.05, 1.25), S.pov.tan);
  });

  // the deck moves under you, gently
  S.ride = { y: 0, roll: 0 };
  S.every((dt, t) => {
    if (!S.sway) return;
    S.ride.y = Math.sin(t * 0.5) * 0.035;
    S.ride.roll = Math.sin(t * 0.37) * 0.011;
    rail.position.y = S.screenPoint(0, S.pov.bottom + 0.03, 1.6).y + railBump.update(dt, 0);
  });

  /** Spray thrown up where something hits the water. */
  const splash = (pos, size = 1) => S.burst(pos, { count: Math.round(16 * size), colors: ['#cfe3f0', '#8fb4cc', '#ffffff'], speed: 2.2 * size, up: 2.6 * size, size: 0.08, life: 0.9, gravity: 8, dir: [0, 1, 0], spread: 0.45 });

  return {
    async attack(by, { weight = 1 } = {}) {
      if (by === 'you') {
        // the gun crew sets, then your cannon fires and kicks back at you
        gun.pose([0, -0.015, 0.04, 0.03, 0, 0]);
        await S.wait(0.24);
        gun.pose(REST);
        const from = S.worldPos(muzzle);
        const to = S.worldPos(enemy.aim).add(new T.Vector3(rand(-0.5, 0.5), rand(-0.05, 0.25), 0));

        sfx.cannon();
        S.flash(from, '#ffe9a8', 0.7);
        S.smoke(from, 6);
        S.burst(from, { count: 10, colors: ['#ffd98a', '#ff9a3c'], speed: 4, up: 0.3, size: 0.04, life: 0.35, gravity: 2, dir: away(from, to), spread: 0.35 });
        S.shake(0.34);
        gun.kick(2, 2.6);
        gun.kick(3, 1.6);

        // your crew fire their muskets from either side of you
        [-1, 1, -1].forEach((side, i) => S.after(0.1 + i * 0.08 + rand(0, 0.06), () => {
          const p = S.facePoint(side * rand(0.75, 0.95), S.pov.bottom + 0.08, 1.4);
          S.tracer(p, S.worldPos(enemy.aim).add(new T.Vector3(rand(-0.8, 0.8), rand(0.3, 0.9), 0)), '#ffe9a8');
          S.flash(p, '#ffe9a8', 0.14);
          sfx.musket();
        }));

        const ball = S.add(S.scene, new T.SphereGeometry(0.095, 12, 8), S.toon('#17171c', { rim: '#9fb0c4', rimStrength: 0.5 }));
        const smokeTrail = S.every(dt => { if (dt > 0 && Math.random() < 0.6) S.particles.emit({ pos: ball.position, color: '#9aa3ad', size: 0.08, grow: 0.25, life: 0.5, alpha: 0.35 }); });
        await S.arc(ball, from, to, { height: 1, seconds: 0.62 });
        smokeTrail();
        S.scene.remove(ball);

        sfx.crash();
        farHit(S, enemy.fx, weight);
        S.flash(to, '#ffb347', 1.4);
        S.burst(to, { count: 30, colors: ['#c28a4a', '#7a4a22', '#f4b63f', '#efe3c4'], speed: 4, up: 1.6, size: 0.1, life: 1, gravity: 8, dir: [rand(-0.3, 0.3), 0.5, -0.6], spread: 0.6 });
        S.smoke(to, 5, '#8d8f94');
        enemy.roll.kick(-rand(0.7, 1.1));
        enemy.heave.kick(-0.35);
        enemy.fx.uGust.value = 0.7;
        S.pulse(enemy.fx.uGust, 0.7, 0.8);
        enemy.crew.forEach(man => man.userData.duck.kick(-1.4));
        S.after(0.35, () => splash(S.worldPos(enemy.aim).add(new T.Vector3(0, -0.3, 0.7)), 0.6));
        return;
      }

      // her broadside: two guns flash, one ball falls short, the other comes straight at you
      enemy.roll.kick(0.3);
      await S.wait(0.3);
      const shots = [enemy.ports[1], enemy.ports[2]].map(p => S.worldPos(p));
      sfx.cannon();
      shots.forEach(p => { S.flash(p, '#ffe9a8', 1.1); S.smoke(p, 4); });
      enemy.roll.kick(-0.6);
      enemy.fx.uGust.value = 1;
      S.pulse(enemy.fx.uGust, 1, 0.9);

      const iron2 = S.toon('#17171c', { rim: '#9fb0c4', rimStrength: 0.5 });
      const miss = S.add(S.scene, new T.SphereGeometry(0.095, 12, 8), iron2);
      const short = new T.Vector3(rand(-2.5, 2.5), 0, rand(-4.5, -3));
      S.arc(miss, shots[0], short, { height: 1.2, seconds: 0.6 }).then(() => { S.scene.remove(miss); splash(short, 1.1); });

      const ball = S.add(S.scene, new T.SphereGeometry(0.095, 12, 8), iron2);
      const at = S.facePoint(rand(-0.35, 0.35), S.pov.bottom + 0.05, 1.5);
      await S.arc(ball, shots[1], at, { height: 0.9, seconds: 0.72 });
      S.scene.remove(ball);

      sfx.crash();
      youAreHit(S, weight);
      S.flash(at, '#ffb347', 0.5);
      // your rail bursts into splinters that fly past your face
      S.burst(at, { count: 26, colors: ['#c28a4a', '#7a4a22', '#f4b63f'], speed: 2.4, up: 1.2, size: 0.035, life: 0.9, gravity: 6, dir: [rand(-0.4, 0.4), 0.6, 0.6], spread: 0.7 });
      S.smoke(at, 3, '#8d8f94');
      railBump.kick(-0.9);
      gun.kick(1, -0.9);
      gun.kick(5, rand(-1, 1));
    },

    finish(winner) {
      if (winner === 'you') {
        // she takes on water: settling lower and lower, stern first, listing over
        S.tween(3.6, k => { enemy.state.sink = k * k; enemy.state.list = 0.35 * k; }, ease.linear);
        S.every(dt => {
          if (dt > 0 && enemy.state.sink > 0.05 && enemy.state.sink < 0.95 && Math.random() < 0.35) {
            const p = S.worldPos(enemy.aim);
            S.particles.emit({ pos: { x: p.x + rand(-1.4, 1.4), y: 0.02, z: p.z + rand(-0.3, 0.6) }, color: '#d7e7f2', size: 0.06, grow: 0.12, life: 0.8, vel: [0, 0.35, 0], alpha: 0.7 });
          }
        });
        S.after(0.4, () => S.smoke(S.worldPos(enemy.aim).add(new T.Vector3(0, 0.4, 0)), 8, '#9fb3c4'));
        S.after(1.2, () => splash(S.worldPos(enemy.aim).add(new T.Vector3(-1.2, -0.3, 0)), 1.2));
        S.burst(S.facePoint(0, S.pov.frameY + 0.3, 5), { count: 30, colors: ['#f4b63f', '#ffe7a3', '#ffffff'], speed: 3, size: 0.09, life: 1.4, gravity: 3 });
        return;
      }
      // your ship goes down under you: the deck drops away and the sea comes up
      collapse(S, gun, { drop: -1.45, fall: 0.12, tilt: 0.24 });
      S.after(1.1, () => splash(S.facePoint(rand(-0.5, 0.5), S.pov.bottom, 2), 1.3));
      S.after(1.9, () => splash(S.facePoint(rand(-0.5, 0.5), S.pov.bottom + 0.2, 1.6), 1.3));
    },
  };
}

// ---------- cyberpunk city ----------

function cyber(S) {
  const T = S.T;
  S.setLook({ fog: '#1c0a36', fogNear: 9, fogFar: 54, light: [0.25, 0.9, 0.5], lightColor: '#a79bf5', ambient: '#30265a', glow: 1.1, glowFrom: 0.6 });
  S.setPov({ eye: [0, 1.62, 0], target: [0, 1.1, -6.5], size: [2.1, 2.3] });

  S.add(S.scene, new T.PlaneGeometry(280, 100), S.sky({ top: '#06030d', bottom: '#2c0e48', haze: '#3a0c40', stars: 0.35 }), [0, 34, -72]);
  const floor = new T.PlaneGeometry(240, 150);
  floor.rotateX(-Math.PI / 2);
  const grid = S.grid({ base: '#07030e', line: '#ff2bd6', cell: 1.6 });
  S.add(S.scene, floor, grid, [0, 0, -52]);

  // the city: a skyline ahead and towers down both sides of the street you stand in
  const r = seeded(7);
  const wall = S.tower('#170b2c');
  const signs = ['#ff2bd6', '#29f0ff', '#ffb648'];
  const tower = (x, z, w, d, h, sign) => {
    S.add(S.scene, new T.BoxGeometry(w, h, d), wall, [x, h / 2, z]);
    if (sign) S.add(S.scene, new T.BoxGeometry(0.14, h * 0.42, 0.14), S.light(sign, { power: 1.5 }), [x - Math.sign(x || 1) * (w / 2 - 0.3), h * 0.55, z + d / 2 + 0.1]);
  };
  for (let i = 0; i < 40; i++) {
    const z = -20 - r() * 42;
    tower(-46 + r() * 92, z, 2 + r() * 3, 2 + r() * 2.5, 5 + r() * 7 + (-z - 20) * 0.3, i % 5 === 0 ? signs[i % 3] : null);
  }
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    tower(side * (7.5 + r() * 8), -1 - r() * 17, 2.5 + r() * 2.5, 2.5 + r() * 2, 5 + r() * 7, i % 3 === 0 ? signs[i % 3] : null);
  }

  const rival = buildRunner(S, THEIR_RUNNER);
  rival.root.position.set(0, 0, -6.5);
  rival.root.rotation.y = -Math.PI / 2 + 0.35; // facing you, turned a little so the throwing arm shows
  S.scene.add(rival.root);
  const pad = S.group(S.scene, [0, 0, -6.5]);
  S.add(pad, new T.CylinderGeometry(1, 1, 0.06, 40), S.toon('#120a22', { rim: rival.glow, rimStrength: 0.3 }), [0, 0.03, 0]);
  S.add(pad, new T.TorusGeometry(1, 0.028, 6, 48), S.light(rival.glow, { power: 1.4 }), [0, 0.07, 0], [Math.PI / 2, 0, 0]);

  // your own arm, in the same suit, holding your disc
  const glow = MY_RUNNER.glow;
  const suit = S.toon(MY_RUNNER.suit, { rim: glow, rimStrength: 0.6 });
  const arm = armModel(S, { arm: suit, hand: S.toon(MY_RUNNER.dark, { rim: glow, rimStrength: 0.5 }) });
  const neon = S.light(glow, { power: 1.5 });
  for (const k of [0.3, 0.62]) {
    const band = S.add(arm.g, new T.TorusGeometry(0.054, 0.011, 6, 18), neon);
    band.position.copy(arm.elbow).multiplyScalar(k);
    band.quaternion.copy(arm.turn).multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)));
  }
  const HELD = 0.5; // the disc in your hand is drawn smaller than one in flight, so it does not fill the view
  const held = discModel(S, glow, S.still);
  held.position.set(-0.05, 0.1, -0.03);
  held.rotation.set(0.25, 0.55, 0);
  held.scale.setScalar(HELD);
  arm.g.add(held);
  S.hands.add(arm.g);
  const hand = new Hand(S, arm.g);
  S.onResize(() => hand.anchor(S.screenPoint(S.camera.aspect > 1 ? 0.6 : 0.7, S.pov.bottom + 0.02, 0.8), S.pov.tan / (S.camera.aspect > 1 ? 0.64 : 0.82)));
  S.every((dt, t) => { if (dt > 0) held.rotation.z = t * 1.2; });

  /** A light ring runs out across the floor from a point. */
  const ripple = pos => {
    grid.uniforms.uPulseAt.value.copy(pos);
    S.tween(1.1, k => { grid.uniforms.uPulse.value = 1 - k; }, ease.linear);
  };

  return {
    async attack(by, { weight = 1 } = {}) {
      if (by === 'you') {
        // the rival sees it coming and braces
        S.after(0.08, () => rival.rig.pose(BRACE, 1.1));
        S.after(1, () => rival.rig.pose(READY, 0.9));
        hand.pose(PULL, 0.8);
        await S.wait(0.32);
        hand.pose(FLING, 2.4);
        await S.wait(0.085);
        S.after(0.3, () => hand.pose(REST, 0.9));

        sfx.disc();
        held.visible = false;
        const disc = discModel(S, glow, S.still);
        const from = S.worldPos(held);
        disc.position.copy(from);
        const grow = arm.g.scale.x * HELD;
        disc.scale.setScalar(grow);
        S.tween(0.2, k => disc.scale.setScalar(grow + (1 - grow) * k));
        S.scene.add(disc);
        const trail = S.trail(disc, glow, { width: 0.1, length: 18 });
        await S.arc(disc, from, S.worldPos(rival.aim), { height: 0.4, seconds: 0.36, spin: [0, 0, 26] });
        const hit = disc.position.clone();

        sfx.zap();
        farHit(S, rival.fx, weight);
        rival.rig.hit(1.1);
        S.shock(hit, glow);
        S.flash(hit, '#ffffff', 0.9);
        S.burst(hit, { count: 26, colors: [glow, '#ffffff', '#ff2bd6'], speed: 4.5, up: 0.6, size: 0.08, life: 0.6, gravity: 2, dir: [rand(-0.3, 0.3), 0.3, -0.8], spread: 0.65 });
        ripple(S.worldPos(rival.root));

        // the disc rebounds and flies back into your hand
        S.after(0.26, () => S.tween(0.2, k => disc.scale.setScalar(1 + (grow - 1) * k)));
        S.arc(disc, hit, S.worldPos(held), { height: 0.6, seconds: 0.46, spin: [0, 0, -22] }).then(() => {
          trail.end();
          S.scene.remove(disc);
          held.visible = true;
          hand.kick(2, 1.2); // the catch pushes your hand back
          S.flash(S.worldPos(held), glow, 0.15);
        });
        return;
      }

      // the rival winds up; you get your arm up
      S.after(0.1, () => hand.pose(GUARD, 1.2));
      const flight = await throwBeat(S, rival.rig, () => {
        sfx.disc();
        rival.disc.visible = false;
        const disc = discModel(S, rival.glow, S.still);
        const from = S.worldPos(rival.disc);
        disc.position.copy(from);
        S.scene.add(disc);
        const trail = S.trail(disc, rival.glow, { width: 0.1, length: 18 });
        const at = S.facePoint(rand(-0.15, 0.2), S.pov.frameY - 0.2, 1.1);
        return { disc, trail, from, at, done: S.arc(disc, from, at, { height: 0.5, seconds: 0.42, spin: [0, 0, 26] }) };
      });
      await flight.done;

      sfx.zap();
      youAreHit(S, weight);
      S.shock(flight.at, rival.glow, 0.32);
      S.burst(flight.at, { count: 22, colors: [rival.glow, '#ffffff', '#ff2bd6'], speed: 2.2, up: 0.4, size: 0.03, life: 0.6, gravity: 2 });
      hand.kick(1, -1.6);
      hand.kick(4, 3);
      ripple(S.facePoint(0, -1, 0.5));
      S.after(0.45, () => hand.pose(REST, 0.9));

      // it rebounds off you and returns to the rival's hand
      S.arc(flight.disc, flight.at, S.worldPos(rival.disc), { height: 0.7, seconds: 0.5, spin: [0, 0, -22] }).then(() => {
        flight.trail.end();
        S.scene.remove(flight.disc);
        rival.disc.visible = true;
        rival.rig.springs.nearArm0.kick(-120);
      });
    },

    finish(winner) {
      if (winner === 'you') {
        rival.rig.idle = 0;
        rival.rig.hit(1.6);
        // a scan line sweeps down and the rival breaks up into rising cubes
        S.after(0.35, () => {
          let k = 0;
          const stop = S.every(dt => {
            if (dt <= 0) return;
            k = Math.min(1, k + dt / 1.5);
            rival.fx.uDissolve.value = k;
            const p = S.worldPos(rival.root);
            const y = 2.25 - k * 2.6;
            for (let i = 0; i < 2; i++) S.particles.emit({ pos: { x: p.x + rand(-0.3, 0.3), y, z: p.z + rand(-0.2, 0.2) }, color: i ? '#ffffff' : rival.glow, size: 0.05, life: 0.9, vel: [rand(-0.3, 0.3), rand(0.4, 1.2), 0] });
            if (k >= 1) { stop(); rival.root.visible = false; }
          });
        });
        ripple(S.worldPos(rival.root));
        hand.pose(RAISED, 0.9);
        return;
      }
      // you are knocked off your feet; the rival raises both arms
      collapse(S, hand, { drop: -1, fall: 0.5 });
      rival.rig.pose(CHEER, 0.9);
      S.after(0.2, () => rival.rig.hop.kick(1.1));
    },
  };
}

// ---------- jungle tomb ----------

function tomb(S) {
  const T = S.T;
  S.setLook({
    fog: '#0b1d12', fogNear: 11, fogFar: 44, light: [-0.5, 0.8, 0.5], lightColor: '#a9cdb6', ambient: '#22332a',
    lamp: [0, 2.1, -6.9], lampColor: '#ffb648', glow: 0.85, glowFrom: 0.68,
  });
  S.setPov({ eye: [0, 1.6, 0], target: [0, 1.05, -6.2], size: [2.6, 2.25] });

  S.add(S.scene, new T.PlaneGeometry(260, 90), S.sky({ top: '#030805', bottom: '#0b1d12', haze: '#0c2414', stars: 0.5 }), [0, 30, -56]);
  const ground = new T.PlaneGeometry(160, 90);
  ground.rotateX(-Math.PI / 2);
  S.add(S.scene, ground, S.toon('#1c2c1c', { rim: '#000000', rimStrength: 0 }), [0, 0, -30]);

  // the tomb straight ahead: three stepped tiers of cut stone and a dark doorway
  const stone = S.toon('#7a775c', { blocks: true, rim: '#ffb648', rimStrength: 0.1 });
  const trimStone = S.toon('#8f8c6e', { rim: '#ffb648', rimStrength: 0.15 });
  S.add(S.scene, new T.BoxGeometry(11, 2.4, 5), stone, [0, 1.2, -10.5]);
  S.add(S.scene, new T.BoxGeometry(8, 1.3, 4), stone, [0, 3.05, -11]);
  S.add(S.scene, new T.BoxGeometry(5.2, 1.2, 3), stone, [0, 4.3, -11.5]);
  S.add(S.scene, new T.BoxGeometry(9, 0.1, 7), stone, [0, 0.05, -5]);
  S.add(S.scene, new T.BoxGeometry(1.7, 2, 0.3), S.light('#020403', { power: 1 }), [0, 1, -7.92]);
  S.add(S.scene, new T.BoxGeometry(0.32, 2.1, 0.4), trimStone, [-1, 1.05, -7.85]);
  S.add(S.scene, new T.BoxGeometry(0.32, 2.1, 0.4), trimStone, [1, 1.05, -7.85]);
  S.add(S.scene, new T.BoxGeometry(2.6, 0.38, 0.46), trimStone, [0, 2.28, -7.85]);
  S.add(S.scene, new T.BoxGeometry(3, 0.14, 0.7), trimStone, [0, 0.17, -7.5]);
  const jade = S.light('#37e2b0', { power: 1.35 });
  const glyphPower = jade.uniforms.uPower; // the glyphs over the door flare when the gorilla is hit
  for (let i = 0; i < 6; i++) S.add(S.scene, new T.BoxGeometry(0.12, i % 2 ? 0.1 : 0.18, 0.04), jade, [-0.75 + i * 0.3, 2.28, -7.6]);

  const iron = S.toon('#3a2a16', { rim: '#ffb648', rimStrength: 0.3 });
  const fire = S.flame();
  for (const x of [-1.75, 1.75]) {
    S.add(S.scene, new T.CylinderGeometry(0.04, 0.055, 1.5, 6), iron, [x, 0.75, -7.3]);
    S.add(S.scene, new T.ConeGeometry(0.13, 0.2, 8), iron, [x, 1.5, -7.3], [Math.PI, 0, 0]);
    S.add(S.scene, new T.PlaneGeometry(0.55, 0.9), fire, [x, 2.02, -7.28]);
    S.add(S.scene, new T.CircleGeometry(0.75, 24), S.light('#ffb648', { power: 1, opacity: 0.16, additive: true }), [x, 1.9, -7.34]);
  }

  // the jungle closes in on both sides: trunks and canopy, ferns at your feet, vines overhead
  const r = seeded(21);
  const bark = S.toon('#231f15', { rim: '#7fd0a0', rimStrength: 0.12 });
  const canopy = S.toon('#17452a', { rim: '#9be25a', rimStrength: 0.12 });
  for (const [x, z] of [[-5, -4], [-7.5, -8], [-9.5, -2.5], [5.2, -3.5], [7.8, -7.5], [10, -2], [-6.5, -13], [6.8, -13.5], [-3.7, -1.3], [3.9, -1]]) {
    const h = 6 + r() * 2.5;
    S.add(S.scene, new T.CylinderGeometry(0.2, 0.34, h, 7), bark, [x, h / 2, z]);
    for (let i = 0; i < 3; i++) {
      S.add(S.scene, S.faceted(new T.IcosahedronGeometry(1.5 + r() * 0.9, 0)), canopy, [x + (r() - 0.5) * 2.4, h - 0.6 + r() * 1.6, z + (r() - 0.5) * 1.6]);
    }
  }
  const frond = S.toon('#236b35', { rim: '#9be25a', rimStrength: 0.2 });
  const ferns = [];
  for (const [x, z] of [[-2.7, -2.4], [2.9, -2.8], [-4.3, -5], [4.5, -5.4], [-3.1, -0.9], [3.3, -1.1], [-6, -6.5], [6.2, -6]]) {
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
  for (const [x, z, drop] of [[-1.9, -1.7, 1.9], [2.2, -2.1, 2.2], [-3, -3.3, 2.6], [3.3, -3.6, 2.4]]) {
    const hang = S.group(S.scene, [x, 4.6, z]);
    vines.push(hang);
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0, 0), new T.Vector3(0.2, -drop * 0.4, 0), new T.Vector3(-0.15, -drop * 0.75, 0), new T.Vector3(0.08, -drop, 0),
    ]);
    S.add(hang, new T.TubeGeometry(curve, 14, 0.03, 5), vine);
    for (let i = 0; i < 4; i++) {
      const p = curve.getPoint(0.4 + i * 0.18);
      S.add(hang, new T.SphereGeometry(0.11, 6, 5), frond, [p.x + (i % 2 ? 0.1 : -0.1), p.y, p.z], [0, 0, rad(i % 2 ? -35 : 35)], [1.5, 0.3, 0.8]);
    }
  }
  // a light breeze: the vines sway and the ferns nod, each on its own slow rhythm
  S.every((dt, t) => {
    vines.forEach((v, i) => { v.rotation.z = Math.sin(t * 0.4 + i * 3.1) * 0.05; });
    ferns.forEach((f, i) => { f.rotation.z = Math.sin(t * 0.5 + i * 1.7) * 0.04; });
  });

  const ape = buildGorilla(S);
  ape.root.position.set(0, 0, -6.2);
  ape.root.rotation.y = -Math.PI / 2 + 0.3; // facing you, a little side-on
  S.scene.add(ape.root);

  // your arm and the spear in your hand
  const lit = { rim: '#bfe8d0', rimStrength: 0.28 };
  const skin = S.toon('#c98f5c', lit);
  const arm = armModel(S, { arm: skin, hand: skin });
  const cuff = S.add(arm.g, new T.CylinderGeometry(0.062, 0.066, 0.3, 10), S.toon('#a08a56', lit));
  cuff.position.copy(arm.elbow).multiplyScalar(0.8);
  cuff.quaternion.copy(arm.turn);
  const heldFx = S.fx();
  const held = spearModel(S, heldFx);
  const point = new T.Vector3(0.18, 0.3, -1).normalize(); // held upright beside the gorilla, not across it
  held.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), point);
  held.position.copy(point).multiplyScalar(0.12);
  arm.g.add(held);
  S.hands.add(arm.g);
  const hand = new Hand(S, arm.g);
  S.onResize(() => hand.anchor(S.screenPoint(S.camera.aspect > 1 ? 0.6 : 0.7, S.pov.bottom + 0.02, 0.8), S.pov.tan / (S.camera.aspect > 1 ? 0.64 : 0.82)));

  return {
    async attack(by, { weight = 1 } = {}) {
      if (by === 'you') {
        // the gorilla sees the spear come back and ducks its head
        S.after(0.12, () => ape.pose({ ...APE_READY, head: -12, rear: -8 }, 1.2));
        hand.pose(PULL, 0.8);
        await S.wait(0.34);
        hand.pose(FLING, 2.4);
        await S.wait(0.085);
        S.after(0.3, () => hand.pose(REST, 0.9));

        sfx.whoosh();
        held.visible = false;
        const spear = spearModel(S, S.still);
        const from = S.worldPos(held);
        spear.position.copy(from);
        S.scene.add(spear);
        await S.arc(spear, from, S.worldPos(ape.aim), { height: 0.45, seconds: 0.4, aim: true });
        const hit = spear.position.clone();
        S.scene.remove(spear);

        sfx.thud();
        S.after(0.08, () => sfx.roar());
        farHit(S, ape.fx, weight);
        S.flash(hit, '#fff1c0', 0.7);
        S.burst(hit, { count: 18, colors: ['#919b92', '#c9c8bc', '#37e2b0', '#3d463e'], speed: 3, size: 0.09, life: 0.7, dir: [rand(-0.3, 0.3), 0.4, -0.7], spread: 0.65, floor: true });
        ape.recoil.kick(160 * weight);
        ape.shove.kick(-0.9);
        ape.springs.head.kick(320);
        ape.pose({ ...APE_READY, rear: 16, head: 26 }, 1.4);
        S.after(0.5, () => ape.pose(APE_READY, 0.8));
        glyphPower.value = 3;
        S.tween(0.8, k => { glyphPower.value = 3 - 1.65 * k; });

        // the spear glances off and drops to the stone
        const fallenFx = S.fx();
        const fallen = spearModel(S, fallenFx);
        S.scene.add(fallen);
        S.arc(fallen, hit, new T.Vector3(hit.x + rand(-0.7, 0.7), 0.04, hit.z + 0.7), { height: 0.35, seconds: 0.4, spin: [0.6, 0.2, 9] })
          .then(() => S.wait(1.6)).then(() => S.tween(0.5, k => { fallenFx.uFade.value = 1 - k; })).then(() => S.scene.remove(fallen));
        // you draw another from your back
        S.after(0.75, () => { held.visible = true; hand.kick(1, 1.4); });
        return;
      }

      // the gorilla reaches down for a rock, rears up and hurls it at your head
      S.after(0.35, () => hand.pose(GUARD, 1.1));
      ape.pose(APE_GRAB, 1.1);
      await S.wait(0.3);
      const rock = S.add(ape.near.fist, S.faceted(new T.IcosahedronGeometry(0.22, 0)), S.toon('#8d8c80', { rim: '#ffd9a0', rimStrength: 0.35 }), [0.05, -0.12, 0]);
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
      const at = S.facePoint(rand(-0.15, 0.2), S.pov.frameY - 0.2, 1.05);
      await S.arc(rock, from, at, { height: 0.9, seconds: 0.5, spin: [3, 0, 9] });
      S.scene.remove(rock);

      sfx.thud();
      youAreHit(S, weight);
      S.flash(at, '#fff1c0', 0.25);
      S.burst(at, { count: 18, colors: ['#8d8c80', '#5b4a2e', '#c9c8bc'], speed: 1.8, up: 0.5, size: 0.03, life: 0.7, gravity: 5 });
      hand.kick(1, -1.6);
      hand.kick(5, 2.5);
      S.after(0.45, () => hand.pose(REST, 0.9));
    },

    finish(winner) {
      if (winner === 'you') {
        // the gorilla flinches, then backs away into the tomb
        ape.idle = 0;
        ape.pose(APE_COWER, 0.9);
        const start = ape.root.position.clone();
        S.after(0.4, () => S.tween(1.9, k => {
          ape.root.position.set(start.x, 0, start.z - 1.9 * k);
          ape.fx.uFade.value = 1 - ease.in(k);
        }).then(() => { ape.root.visible = false; }));
        hand.pose(RAISED, 0.9);
        return;
      }
      // you are knocked flat on your back, and the gorilla beats its chest over you
      collapse(S, hand, { drop: -1.05, fall: 0.5 });
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
