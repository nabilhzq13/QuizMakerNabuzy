// The battle arena: two health bars over a 3D scene, one scene per theme.
//
//   pirate  two ships trade cannon fire, and the crew join in with muskets
//   cyber   two runners throw light discs
//   tomb    an explorer throws a stone-tipped spear, the gorilla throws rocks
//
// The models and their moves are in worlds3d.js and the renderer and shaders
// in stage3d.js. three.js is only fetched when a battle starts; if it cannot
// be loaded the battle still runs, with the health bars alone.

import { sfx } from './sfx.js';
import { loadThree, Stage } from './stage3d.js';
import { WORLDS } from './worlds3d.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)');

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
  const el = document.createElement('div');
  el.className = 'arena cut';
  el.dataset.scene = themeId;
  el.innerHTML = `
    <div class="hp-row">
      ${bar('you', labels.you)}
      <p class="hp-goal">Land ${need} ${need === 1 ? 'hit' : 'hits'} to win</p>
      ${bar('foe', labels.foe)}
    </div>
    <div class="stage">
      <canvas aria-hidden="true"></canvas>
      <p class="stage-note" hidden></p>
    </div>`;

  const canvas = el.querySelector('canvas');
  const note = el.querySelector('.stage-note');
  let alive = true;
  let stage = null;
  let world = null;

  const ready = loadThree().then(() => {
    if (!alive) return;
    stage = new Stage(canvas);
    world = WORLDS[themeId](stage);
    stage.start();
    // for checking the animation from the browser console: document.querySelector('.arena').stage3d
    Object.defineProperty(el, 'stage3d', { value: stage, configurable: true });
    el.classList.add('live');
  }).catch(err => {
    console.error(err);
    stage?.destroy();
    stage = null;
    world = null;
    note.textContent = 'The 3D scene could not be loaded, so this battle shows the health bars only.';
    note.hidden = false;
  });

  function setHp(hp) {
    for (const side of ['you', 'foe']) {
      const box = el.querySelector(`.hp.${side}`);
      const value = Math.max(0, hp[side]);
      const num = box.querySelector('.hp-num');
      const text = `${value} / ${maxHp}`;
      if (num.textContent && num.textContent !== text) {
        box.classList.remove('hurt');
        box.getBoundingClientRect(); // restart the flash
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
    /** weight is 1 for a normal hit and higher for a heavier one, such as the last blow. */
    attack(by, { weight = 1 } = {}) {
      if (!alive) return Promise.resolve();
      if (!world || calm.matches) {
        // no scene yet, or reduced motion: no flight, just the result
        (by === 'you' ? sfx.crash : sfx.thud)();
        return Promise.resolve();
      }
      return Promise.resolve().then(() => world.attack(by, { weight })).catch(err => console.error(err));
    },
    /** The loser leaves the scene and the winner celebrates. */
    finish(winner) {
      ready.then(() => {
        if (alive && world && !calm.matches) stage.after(0.45, () => world.finish(winner));
      });
    },
    destroy() {
      alive = false;
      stage?.destroy();
      stage = null;
      world = null;
    },
  };
}
