// The battle: a first-person 3D scene that fills the whole screen behind the
// quiz, and two health bars at the top of the page.
//
//   pirate  from your deck, an enemy ship across the water
//   cyber   on the grid, a rival runner throwing light discs
//   tomb    in the clearing, the gorilla in front of the tomb door
//
// The scenes are in pov3d.js, the models in models3d.js and the renderer and
// shaders in stage3d.js. three.js is only fetched when a battle starts; if it
// cannot be loaded the battle still runs, with the health bars alone.

import { sfx } from './sfx.js';
import { loadThree, Stage } from './stage3d.js';
import { WORLDS } from './pov3d.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)');

const bar = (side, name) => `
  <div class="hp ${side}">
    <div class="hp-top"><span class="hp-name">${name}</span><span class="hp-num"></span></div>
    <div class="hp-bar"><i></i></div>
  </div>`;

/**
 * Start a battle scene for a theme.
 * Returns { el, setWindow(element), attack(by), setHp({ you, foe }), finish(winner), destroy() },
 * where `by` and `winner` are 'you' or 'foe'. attack() resolves when the shot lands.
 *
 * `el` holds the health bars; put it at the top of the page. The scene itself
 * is a fixed canvas behind the page. setWindow() names the empty part of the
 * page the enemy should be seen through. onScene(true) is called once the
 * scene is drawing and onScene(false) when it stops.
 */
export function createArena(themeId, { labels, maxHp, need, onScene = () => {} }) {
  const el = document.createElement('div');
  el.className = 'arena';
  el.dataset.scene = themeId;
  el.innerHTML = `
    ${bar('you', labels.you)}
    <p class="hp-goal">Land ${need} ${need === 1 ? 'hit' : 'hits'} to win</p>
    ${bar('foe', labels.foe)}`;

  const scene = document.createElement('div');
  scene.className = 'scene3d';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = '<canvas></canvas>';
  document.getElementById('bg').after(scene);

  let alive = true;
  let stage = null;
  let world = null;
  let frame = null;
  let failed = false;

  const explain = () => {
    if (!failed || !frame || frame.querySelector('.stage-note')) return;
    const note = document.createElement('p');
    note.className = 'stage-note';
    note.textContent = 'The 3D scene could not be loaded, so this battle shows the health bars only.';
    frame.prepend(note);
  };

  const ready = loadThree().then(() => {
    if (!alive) return;
    stage = new Stage(scene.firstElementChild);
    world = WORLDS[themeId](stage);
    if (frame) stage.frameOn(frame);
    stage.start();
    // for checking the animation from the browser console: document.querySelector('.arena').stage3d
    Object.defineProperty(el, 'stage3d', { value: stage, configurable: true });
    scene.classList.add('live');
    onScene(true);
    // web fonts arriving can move the page, and with it the place the enemy should appear
    document.fonts?.ready.then(() => { if (alive) stage?.resize(); });
  }).catch(err => {
    console.error(err);
    stage?.destroy();
    stage = null;
    world = null;
    failed = true;
    scene.remove();
    onScene(false);
    explain();
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
    /** The part of the page the enemy is framed in: the gap between the health bars and the question. */
    setWindow(element) {
      frame = element;
      stage?.frameOn(element);
      explain();
    },
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
    /** The loser leaves the scene, or you go down. */
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
      scene.remove();
      onScene(false);
    },
  };
}
