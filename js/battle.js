// The battle arena: two health bars over a small drawn scene, one scene per
// theme. Everything is inline SVG built here, so there are no image files.
//
// All the figures are drawn facing right with their feet (or waterline) at
// 0,0. The opponent is the same kind of drawing, mirrored.
//
//   pirate  two ships trade cannon fire, and the crew join in with muskets
//   cyber   two runners throw light discs
//   tomb    an explorer throws a stone-tipped spear, the gorilla throws rocks

import { sfx } from './sfx.js';
import { fx } from './fx.js';

const NS = 'http://www.w3.org/2000/svg';
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const other = side => (side === 'you' ? 'foe' : 'you');
const rand = (a, b) => a + Math.random() * (b - a);
const n1 = v => Math.round(v * 10) / 10;

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

/** Repeatable random numbers, so a generated skyline looks the same every time. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A figure in its place. `idle` is the class of its resting animation. */
const actor = (side, p, idle, art) => `
  <g class="actor ${side}" transform="translate(${p.x},${p.y}) scale(${side === 'foe' ? -p.s : p.s},${p.s})">
    <g class="react"><g class="${idle}">${art}</g></g>
  </g>`;

// ---------- pirate ----------

const wave = (y, len, amp) => {
  let d = `M${-2 * len},${y}`;
  for (let x = -2 * len; x < 800 + len; x += len) d += `q${len / 4},${-amp} ${len / 2},0t${len / 2},0`;
  return `${d}V240H${-2 * len}Z`;
};

const ship = c => `
  <path d="M-52,-30V-92M0,-22V-132M50,-24V-108" stroke="${c.mast}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
  <path d="M88,-34L128,-51" stroke="${c.mast}" stroke-width="3" stroke-linecap="round"/>
  <path d="M54,-104L124,-50L78,-36Z" fill="${c.sail2}"/>
  <path d="M-56,-90L-88,-70L-84,-36L-56,-36Z" fill="${c.sail2}"/>
  <path d="M-24,-126H24Q37,-100 26,-76H-26Q-13,-100 -24,-126Z" fill="${c.sail}"/>
  <path d="M-29,-71H29Q44,-48 31,-27H-31Q-16,-48 -29,-71Z" fill="${c.sail}"/>
  <path d="M32,-102H68Q79,-82 70,-63H30Q41,-82 32,-102Z" fill="${c.sail}"/>
  <path d="M29,-58H73Q86,-42 75,-28H27Q40,-42 29,-58Z" fill="${c.sail}"/>
  <path d="M-24,-101Q0,-96 25,-101M-29,-49Q0,-44 31,-49M32,-83Q50,-79 69,-83M29,-43Q52,-39 75,-43" fill="none" stroke="${c.sail2}" stroke-width="1.5"/>
  <path d="M0,-132V-147L21,-141L0,-136Z" fill="${c.flag}"/>
  <g fill="${c.crew}" stroke="${c.crew}" stroke-width="1.6" stroke-linecap="round">
    <circle cx="-30" cy="-33" r="3.2"/><rect x="-32.5" y="-30" width="5" height="10"/><path d="M-28,-27L-17,-30"/>
    <circle cx="-8" cy="-33" r="3.2"/><rect x="-10.5" y="-30" width="5" height="10"/><path d="M-6,-27L5,-30"/>
    <circle cx="16" cy="-33" r="3.2"/><rect x="13.5" y="-30" width="5" height="10"/><path d="M18,-27L29,-30"/>
  </g>
  <path d="M-84,-20L-82,-32H-50L-46,-22H46L50,-30H78L98,-39Q86,-8 62,9H-58Q-78,4 -84,-20Z" fill="${c.hull}"/>
  <path d="M-83,-14Q0,-6 84,-18" fill="none" stroke="${c.trim}" stroke-width="2.5"/>
  <path d="M-82,-32H-50M50,-30H78L98,-39" fill="none" stroke="${c.trim}" stroke-width="2" stroke-linecap="round"/>
  <g fill="${c.port}" stroke="${c.trim}" stroke-width="1">
    <rect x="-44" y="-5" width="9" height="7"/><rect x="-18" y="-5" width="9" height="7"/><rect x="8" y="-5" width="9" height="7"/><rect x="34" y="-5" width="9" height="7"/>
  </g>
  <circle cx="-80" cy="-40" r="3" fill="${c.lamp}"/>`;

const MY_SHIP = { hull: '#5a3418', trim: 'var(--ion)', sail: '#efe3c4', sail2: '#c9bb95', flag: 'var(--ion)', crew: '#1b1410', port: '#1a0f08', mast: '#2c1c10', lamp: '#ffd98a' };
const THEIR_SHIP = { hull: '#3a3a4b', trim: 'var(--pulse)', sail: '#8a2230', sail2: '#5e1620', flag: '#0a0a0d', crew: '#0c0c10', port: '#0a0a0d', mast: '#17171d', lamp: '#ff8d7a' };

const pirate = {
  place: { you: { x: 170, y: 192, s: 0.92 }, foe: { x: 630, y: 192, s: 0.92 } },
  art() {
    const r = seeded(11);
    let stars = '';
    for (let i = 0; i < 26; i++) stars += `<circle cx="${n1(r() * 800)}" cy="${n1(r() * 120)}" r="${n1(0.5 + r() * 0.9)}" fill="#dfe8ff" opacity="${n1(0.3 + r() * 0.6)}"/>`;
    return `
      <defs>
        <linearGradient id="pir-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040915"/><stop offset=".7" stop-color="#0c2136"/><stop offset="1" stop-color="#173a52"/></linearGradient>
        <radialGradient id="pir-halo"><stop offset="0" stop-color="#f6dc92" stop-opacity=".45"/><stop offset="1" stop-color="#f6dc92" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="800" height="240" fill="url(#pir-sky)"/>
      ${stars}
      <circle cx="400" cy="76" r="74" fill="url(#pir-halo)"/>
      <circle cx="400" cy="76" r="23" fill="#f7e7b2"/>
      <circle cx="392" cy="70" r="5" fill="#e2cd8f"/><circle cx="408" cy="84" r="3.4" fill="#e2cd8f"/><circle cx="405" cy="66" r="2" fill="#e2cd8f"/>
      <path class="sea" style="--len:120px" d="${wave(180, 120, 4)}" fill="#12324a"/>
      ${actor('you', this.place.you, 'bob', ship(MY_SHIP))}
      ${actor('foe', this.place.foe, 'bob', ship(THEIR_SHIP))}
      <g class="shots"></g>
      <path class="sea mid" style="--len:90px" d="${wave(197, 90, 5)}" fill="#0c2539"/>
      <path class="sea front" style="--len:70px" d="${wave(213, 70, 6)}" fill="#081a2a"/>`;
  },
  attack(api, by) {
    const to = other(by);
    const muzzle = api.point(by, 46, -1);
    const hit = api.point(to, rand(-26, 14), rand(-10, -2));
    sfx.cannon();
    api.flash(muzzle, 13, '#ffe9a8');
    api.puff(muzzle, { r: 9, grow: 2.6, color: '#cfd3d6', dur: 800 });
    // the crew follow the cannon with their muskets
    [-30, -8, 16].forEach((lx, i) => api.later(120 + i * 95, () => {
      const a = api.point(by, lx + 13, -31);
      api.tracer(a, api.point(to, rand(-40, 40), rand(-36, -22)), '#ffe9a8');
      api.puff(a, { r: 3, grow: 2.2, color: '#d9dde0', dur: 420 });
      sfx.musket();
    }));
    const ball = svgEl('circle', { r: 4.6, fill: '#0b0b0d', stroke: '#6b6f76', 'stroke-width': 1 });
    return api.fly(ball, { from: muzzle, to: hit, arc: 46, dur: 520 }).then(() => {
      sfx.crash();
      api.flash(hit, 17, '#ffb347');
      api.puff(hit, { r: 8, grow: 2.4, color: '#8d8f94', dur: 600 });
      api.burst(hit, ['#c28a4a', '#7a4a22', '#f4b63f', '#efe3c4']);
      api.hit(to);
    });
  },
};

// ---------- cyberpunk city ----------

const runner = c => `
  <ellipse cx="0" cy="2" rx="36" ry="5" fill="${c.glow}" opacity=".2"/>
  <g stroke="${c.suit}" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M-4,-50L-16,-26L-26,-1" stroke-width="11"/>
    <path d="M2,-50L16,-28L15,-1" stroke-width="11"/>
    <path d="M1,-84L-12,-70L-9,-56" stroke-width="8"/>
    <path d="M-2,-52L4,-86" stroke-width="19"/>
  </g>
  <circle cx="8" cy="-101" r="10.5" fill="${c.suit}"/>
  <g stroke="${c.glow}" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-width="2.4" style="filter: drop-shadow(0 0 3px ${c.glow})">
    <path d="M-6,-46L-16,-26L-24,-4"/><path d="M4,-46L16,-28L15,-4"/>
    <path d="M-1,-56L5,-84"/><path d="M-7,-70L9,-75"/>
    <path d="M4,-104Q13,-108 18,-100" stroke-width="2.8"/>
  </g>
  <g class="arm">
    <path d="M4,-84L20,-94L30,-108" stroke="${c.suit}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M6,-85L20,-94L29,-106" stroke="${c.glow}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <g class="held"><circle cx="34" cy="-113" r="10" fill="none" stroke="${c.glow}" stroke-width="3.2"/><circle cx="34" cy="-113" r="4" fill="${c.glow}" opacity=".6"/></g>
  </g>`;

const MY_RUNNER = { suit: '#2d3a78', glow: '#29f0ff' };
const THEIR_RUNNER = { suit: '#6a2f24', glow: '#ff7a1a' };

const cyber = {
  place: { you: { x: 150, y: 198, s: 0.95 }, foe: { x: 650, y: 198, s: 0.95 } },
  art() {
    const r = seeded(7);
    const tints = ['#29f0ff', '#ff2bd6', '#ffb648'];
    let far = '';
    let near = '';
    let windows = '';
    for (let x = -10; x < 810;) {
      const w = 26 + r() * 34;
      const h = 60 + r() * 96;
      far += `M${n1(x)},198v${n1(-h)}h${n1(w)}v${n1(h)}z`;
      x += w + 2 + r() * 6;
    }
    for (let x = -20; x < 820;) {
      const w = 40 + r() * 50;
      const h = 30 + r() * 70;
      near += `M${n1(x)},198v${n1(-h)}h${n1(w)}v${n1(h)}z`;
      for (let wy = 198 - h + 7; wy < 190; wy += 9) {
        for (let wx = x + 6; wx < x + w - 8; wx += 8) {
          if (r() > 0.62) windows += `<rect x="${n1(wx)}" y="${n1(wy)}" width="4" height="5" fill="${tints[Math.floor(r() * 3)]}" opacity="${n1(0.4 + r() * 0.45)}"/>`;
        }
      }
      x += w + 4 + r() * 10;
    }
    let grid = '';
    for (let k = -7; k <= 7; k++) grid += `M${400 + k * 34},198L${400 + k * 150},240`;
    return `
      <defs>
        <linearGradient id="cyb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06030d"/><stop offset=".55" stop-color="#1a0a33"/><stop offset=".82" stop-color="#5a1570"/><stop offset=".83" stop-color="#08040f"/><stop offset="1" stop-color="#08040f"/></linearGradient>
      </defs>
      <rect width="800" height="240" fill="url(#cyb-sky)"/>
      <path d="${far}" fill="#24103f"/>
      <path d="${near}" fill="#0e061c"/>
      ${windows}
      <rect x="0" y="198" width="800" height="42" fill="#08040f"/>
      <path d="${grid}M0,206H800M0,218H800M0,233H800" stroke="#ff2bd6" stroke-width="1" opacity=".35" fill="none"/>
      <path d="M0,198H800" stroke="#ff2bd6" stroke-width="2"/>
      ${actor('you', this.place.you, 'breathe', runner(MY_RUNNER))}
      ${actor('foe', this.place.foe, 'breathe', runner(THEIR_RUNNER))}
      <g class="shots"></g>`;
  },
  attack(api, by) {
    const to = other(by);
    const glow = (by === 'you' ? MY_RUNNER : THEIR_RUNNER).glow;
    const hit = api.point(to, 2, -68);
    api.swing(by, { pivot: [4, -84], frames: [[0, 0], [0.3, -44], [0.62, 64], [1, 0]], dur: 430 });
    api.hold(by, 700);
    return api.wait(140).then(() => {
      sfx.disc();
      const disc = svgEl('g');
      disc.append(
        svgEl('circle', { r: 10, fill: 'none', stroke: glow, 'stroke-width': 3.2 }),
        svgEl('circle', { r: 4, fill: glow }),
      );
      return api.fly(disc, { from: api.point(by, 36, -112), to: hit, arc: 18, dur: 360, trail: glow });
    }).then(() => {
      sfx.zap();
      api.ring(hit, glow);
      api.burst(hit, [glow, '#ffffff', '#ff2bd6']);
      api.hit(to);
    });
  },
};

// ---------- jungle tomb ----------

const explorer = `
  <ellipse cx="0" cy="3" rx="26" ry="4" fill="#000" opacity=".4"/>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M-4,-44L-13,-22L-17,-1" stroke="#4a3b23" stroke-width="9"/>
    <path d="M2,-44L11,-23L16,-1" stroke="#5c4a2c" stroke-width="9"/>
    <path d="M0,-72L-12,-60L-9,-47" stroke="#b07c49" stroke-width="7"/>
    <path d="M-1,-44L2,-74" stroke="#8a7448" stroke-width="16"/>
  </g>
  <path d="M-9,-50H10" stroke="var(--ion)" stroke-width="3" stroke-linecap="round"/>
  <circle cx="4" cy="-87" r="9" fill="#c08a55"/>
  <path d="M-5,-91Q4,-98 14,-90L13,-86Q4,-92 -5,-87Z" fill="var(--pulse)"/>
  <path d="M-5,-90L-15,-86L-6,-85Z" fill="var(--pulse)"/>
  <g class="arm">
    <path d="M2,-73L15,-85L21,-99" stroke="#c08a55" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <g class="held">
      <path d="M-18,-92L52,-108" stroke="#8a6436" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M50,-112L67,-111L54,-103Z" fill="#c9c8bc"/>
      <path d="M47,-109L49,-105" stroke="var(--ion)" stroke-width="2"/>
    </g>
  </g>`;

const gorilla = `
  <ellipse cx="0" cy="3" rx="62" ry="6" fill="#000" opacity=".45"/>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M-30,-34L-38,-2" stroke="#272c26" stroke-width="27"/>
    <path d="M-6,-30L-2,-2" stroke="#2d332c" stroke-width="25"/>
    <path d="M-2,-84L-6,-40L2,-4" stroke="#242923" stroke-width="20"/>
  </g>
  <ellipse cx="-6" cy="-62" rx="46" ry="40" fill="#363d35"/>
  <ellipse cx="-22" cy="-75" rx="26" ry="18" fill="#7a8377" opacity=".5"/>
  <ellipse cx="12" cy="-58" rx="20" ry="22" fill="#444c42"/>
  <ellipse cx="30" cy="-104" rx="21" ry="20" fill="#363d35"/>
  <path d="M16,-120Q30,-136 44,-120Z" fill="#363d35"/>
  <ellipse cx="37" cy="-99" rx="13" ry="13" fill="#50594e"/>
  <path d="M27,-106Q38,-112 49,-106" stroke="#141712" stroke-width="4" fill="none" stroke-linecap="round"/>
  <circle cx="33" cy="-102" r="2.2" fill="var(--volt)"/><circle cx="43" cy="-102" r="2.2" fill="var(--volt)"/>
  <ellipse cx="39" cy="-94" rx="3.2" ry="2" fill="#141712"/>
  <path d="M31,-88Q38,-85 45,-88" stroke="#141712" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <g class="arm">
    <path d="M22,-82L50,-44L46,-4" stroke="#3e463c" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="46" cy="-3" r="12" fill="#3e463c"/>
  </g>`;

const torch = (x, y) => `
  <circle cx="${x}" cy="${y - 8}" r="46" fill="url(#tmb-torch)"/>
  <rect x="${x - 2}" y="${y}" width="4" height="24" fill="#3a2a16"/>
  <g transform="translate(${x},${y})"><g class="flame">
    <path d="M0,-18Q9,-8 5,2Q0,7 -5,2Q-9,-8 0,-18Z" fill="#ffb648"/>
    <path d="M0,-9Q4,-4 2,1Q0,3 -2,1Q-4,-4 0,-9Z" fill="#fff1c0"/>
  </g></g>`;

const leaf = (x, y, rot, s = 1) => `<path transform="translate(${x},${y}) rotate(${rot}) scale(${s})" d="M0,0Q14,-8 30,0Q14,8 0,0Z" fill="#143520"/>`;

const tomb = {
  place: { you: { x: 150, y: 203, s: 1 }, foe: { x: 596, y: 203, s: 1 } },
  art() {
    let glyphs = '';
    for (let i = 0; i < 8; i++) glyphs += `<rect x="${658 + i * 12}" y="${i % 3 === 1 ? 59 : 56}" width="7" height="${i % 2 ? 6 : 10}" fill="var(--ion)" opacity=".75"/>`;
    return `
      <defs>
        <linearGradient id="tmb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040a06"/><stop offset=".6" stop-color="#0b1c10"/><stop offset="1" stop-color="#16331c"/></linearGradient>
        <radialGradient id="tmb-torch"><stop offset="0" stop-color="#ffb648" stop-opacity=".6"/><stop offset="1" stop-color="#ffb648" stop-opacity="0"/></radialGradient>
        <radialGradient id="tmb-moon"><stop offset="0" stop-color="#d6f5cf" stop-opacity=".22"/><stop offset="1" stop-color="#d6f5cf" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="800" height="240" fill="url(#tmb-sky)"/>
      <circle cx="150" cy="30" r="190" fill="url(#tmb-moon)"/>
      <path d="M0,168Q30,118 78,142Q104,108 150,138Q188,104 236,140Q276,116 318,146Q356,120 400,150Q440,128 480,156V240H0Z" fill="#081a0e"/>
      <path d="M452,203V160h38v-42h38v-42h38V44h234V203Z" fill="#1b1c16"/>
      <path d="M452,160h38M490,118h38M528,76h38M566,44h234" stroke="#3d3f31" stroke-width="3" fill="none"/>
      <path d="M490,160H800M528,118H800M566,76H800M620,44v32M700,44v32M590,76v42M740,76v42M560,118v42M640,118v20M770,118v42M520,160v43M600,160v43" stroke="#12130f" stroke-width="1.5" fill="none"/>
      <path d="M660,203V112l42,-20l42,20V203Z" fill="#030503" stroke="#3d3f31" stroke-width="3" stroke-linejoin="round"/>
      ${glyphs}
      ${torch(640, 150)}${torch(764, 150)}
      <path d="M0,203Q200,196 400,203T800,203V240H0Z" fill="#0a150c"/>
      <g fill="none" stroke="#0f2a17" stroke-width="4" stroke-linecap="round">
        <path d="M70,0Q56,44 74,78Q88,108 70,140"/><path d="M250,0Q262,30 248,62Q238,84 252,104"/><path d="M372,0Q360,26 376,52"/><path d="M520,0Q532,22 520,40"/>
      </g>
      ${leaf(74, 60, 20)}${leaf(70, 104, 150)}${leaf(72, 138, 40)}${leaf(250, 44, 160)}${leaf(250, 84, 15)}${leaf(376, 34, 30)}${leaf(520, 30, 160)}
      ${actor('you', this.place.you, 'breathe', explorer)}
      ${actor('foe', this.place.foe, 'breathe', gorilla)}
      <g class="shots"></g>
      <path d="M-10,240Q4,180 60,168Q40,206 44,240ZM20,240Q60,196 118,200Q84,214 76,240ZM810,240Q796,186 742,176Q764,210 758,240ZM780,240Q742,204 690,210Q722,220 730,240Z" fill="#030a05"/>`;
  },
  attack(api, by) {
    const to = other(by);
    if (by === 'you') {
      const hit = api.point(to, 14, -66);
      api.swing(by, { pivot: [2, -73], frames: [[0, 0], [0.35, -46], [0.65, 54], [1, 0]], dur: 440 });
      api.hold(by, 800);
      return api.wait(150).then(() => {
        sfx.whoosh();
        const spear = svgEl('g');
        spear.append(
          svgEl('path', { d: 'M-34,0H30', stroke: '#8a6436', 'stroke-width': 2.8, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M28,-5L46,0L28,5Z', fill: '#c9c8bc' }),
        );
        return api.fly(spear, { from: api.point(by, 18, -100), to: hit, arc: 30, dur: 430, aim: true });
      }).then(() => {
        sfx.thud();
        api.later(90, () => sfx.roar());
        api.burst(hit, ['#7a8377', '#c9c8bc', '#37e2b0', '#143520'], 16);
        api.hit(to);
      });
    }
    // the gorilla rears up and hurls a rock
    const hit = api.point(to, 2, -58);
    api.swing(by, { pivot: [22, -82], frames: [[0, 0], [0.45, -128], [0.75, -40], [1, 0]], dur: 560 });
    return api.wait(250).then(() => {
      sfx.whoosh(true);
      const rock = svgEl('path', { d: 'M-9,-3L-4,-9L5,-8L10,-1L7,7L-3,9L-9,4Z', fill: '#8d8c80', stroke: '#5f5e55', 'stroke-width': 1.2 });
      return api.fly(rock, { from: api.point(by, 58, -112), to: hit, arc: 44, dur: 520, spin: 520 });
    }).then(() => {
      sfx.thud();
      api.burst(hit, ['#8d8c80', '#5c4a2c', '#c9c8bc'], 16);
      api.hit(to);
    });
  },
};

const SCENES = { pirate, cyber, tomb };

// ---------- the arena ----------

const bar = (side, name) => `
  <div class="hp ${side}">
    <div class="hp-top"><span class="hp-name">${name}</span><span class="hp-num"></span></div>
    <div class="hp-bar"><i></i></div>
  </div>`;

/**
 * Build an arena for a theme.
 * Returns { el, attack(by), setHp({ you, foe }), finish(winner), destroy() },
 * where `by` and `winner` are 'you' or 'foe'. attack() resolves when the shot lands.
 */
export function createArena(themeId, { labels, maxHp, need }) {
  const scene = SCENES[themeId];
  const el = document.createElement('div');
  el.className = 'arena cut';
  el.dataset.scene = themeId;
  el.innerHTML = `
    <div class="hp-row">
      ${bar('you', labels.you)}
      <p class="hp-goal">Land ${need} ${need === 1 ? 'hit' : 'hits'} to win</p>
      ${bar('foe', labels.foe)}
    </div>
    <svg class="stage" viewBox="0 0 800 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${scene.art()}</svg>`;

  const stage = el.querySelector('.stage');
  const shots = el.querySelector('.shots');
  const part = (side, sel) => el.querySelector(`.actor.${side} ${sel}`);
  const timers = new Set();
  let alive = true;

  const later = (ms, fn) => {
    const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
    timers.add(id);
  };

  /** Fade and scale a short-lived mark, then remove it. */
  function vanish(node, frames, dur) {
    shots.append(node);
    node.style.transformBox = 'fill-box';
    node.style.transformOrigin = 'center';
    if (!node.animate) return later(dur, () => node.remove());
    node.animate(frames, { duration: dur, easing: 'ease-out', fill: 'forwards' }).onfinish = () => node.remove();
  }

  const api = {
    later,
    wait: ms => new Promise(resolve => later(ms, resolve)),
    /** A point on a figure, given in that figure's own coordinates. */
    point(side, lx, ly) {
      const p = scene.place[side];
      return { x: p.x + (side === 'foe' ? -1 : 1) * p.s * lx, y: p.y + p.s * ly };
    },
    /** Move a projectile along an arc. `aim` turns it to face where it is going. */
    fly(node, { from, to, arc = 0, dur = 450, spin = 0, aim = false, trail = '' }) {
      shots.append(node);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      return new Promise(resolve => {
        const t0 = performance.now();
        const frame = now => {
          if (!alive) return;
          const k = Math.min(1, (now - t0) / dur);
          const x = from.x + dx * k;
          const y = from.y + dy * k - arc * 4 * k * (1 - k);
          const rot = aim ? Math.atan2(dy - arc * 4 * (1 - 2 * k), dx) * 180 / Math.PI : spin * k;
          node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`);
          if (trail) vanish(svgEl('circle', { cx: n1(x), cy: n1(y), r: 5, fill: trail }), [{ opacity: 0.5 }, { opacity: 0, transform: 'scale(.3)' }], 220);
          if (k < 1) requestAnimationFrame(frame);
          else { node.remove(); resolve(); }
        };
        requestAnimationFrame(frame);
      });
    },
    flash({ x, y }, r, color) {
      vanish(svgEl('circle', { cx: n1(x), cy: n1(y), r, fill: color }), [{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }], 190);
    },
    puff({ x, y }, { r, grow, color, dur }) {
      vanish(svgEl('circle', { cx: n1(x), cy: n1(y - r), r, fill: color }), [{ opacity: 0.7, transform: 'scale(.6)' }, { opacity: 0, transform: `translateY(-10px) scale(${grow})` }], dur);
    },
    ring({ x, y }, color) {
      vanish(svgEl('circle', { cx: n1(x), cy: n1(y), r: 10, fill: 'none', stroke: color, 'stroke-width': 3 }), [{ opacity: 1, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(3.4)' }], 380);
    },
    tracer(a, b, color) {
      vanish(svgEl('path', { d: `M${n1(a.x)},${n1(a.y)}L${n1(b.x)},${n1(b.y)}`, stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round' }), [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], 170);
    },
    /** Particles at a point in the scene, drawn on the page-wide effects canvas. */
    burst({ x, y }, colors, count = 22) {
      const m = stage.getScreenCTM();
      if (!m) return;
      fx.burst(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, { count, power: 230, colors });
    },
    /** The figure flinches. */
    hit(side) {
      const node = part(side, '.react');
      node.classList.remove('hit');
      node.getBoundingClientRect(); // restart the animation
      node.classList.add('hit');
    },
    /** Rotate a figure's arm through [time 0..1, degrees] frames, around its shoulder. */
    swing(side, { pivot, frames, dur }) {
      const arm = part(side, '.arm');
      if (!arm) return;
      const t0 = performance.now();
      const frame = now => {
        if (!alive) return;
        const k = Math.min(1, (now - t0) / dur);
        let i = 1;
        while (i < frames.length - 1 && frames[i][0] < k) i++;
        const [ta, a] = frames[i - 1];
        const [tb, b] = frames[i];
        const u = Math.min(1, Math.max(0, (k - ta) / (tb - ta || 1)));
        const angle = a + (b - a) * u * u * (3 - 2 * u);
        arm.setAttribute('transform', `rotate(${angle.toFixed(1)} ${pivot[0]} ${pivot[1]})`);
        if (k < 1) requestAnimationFrame(frame);
        else arm.removeAttribute('transform');
      };
      requestAnimationFrame(frame);
    },
    /** Hide what the figure is holding while it is in the air. */
    hold(side, ms) {
      const held = part(side, '.held');
      if (!held) return;
      held.style.opacity = 0;
      later(ms, () => { held.style.opacity = ''; });
    },
  };

  function setHp(hp) {
    for (const side of ['you', 'foe']) {
      const box = el.querySelector(`.hp.${side}`);
      const value = Math.max(0, hp[side]);
      const num = box.querySelector('.hp-num');
      const text = `${value} / ${maxHp}`;
      if (num.textContent && num.textContent !== text) {
        box.classList.remove('hurt');
        box.getBoundingClientRect();
        box.classList.add('hurt');
      }
      num.textContent = text;
      box.querySelector('i').style.transform = `scaleX(${value / maxHp})`;
      box.classList.toggle('low', value / maxHp <= 0.5);
    }
  }
  setHp({ you: maxHp, foe: maxHp });

  return {
    el,
    setHp,
    attack(by) {
      if (!alive) return Promise.resolve();
      if (calm.matches) {
        // reduced motion: no projectile, just the result
        (by === 'you' ? sfx.crash : sfx.thud)();
        return Promise.resolve();
      }
      return scene.attack(api, by);
    },
    /** The loser leaves the scene and the winner celebrates. */
    finish(winner) {
      const loser = other(winner);
      later(450, () => {
        el.querySelector(`.actor.${loser}`).classList.add('sunk');
        el.querySelector(`.actor.${winner}`).classList.add('won');
        if (!calm.matches) api.burst(api.point(winner, 0, -70), undefined, 30);
      });
    },
    destroy() {
      alive = false;
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
