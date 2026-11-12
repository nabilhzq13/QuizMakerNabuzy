// The four worlds. Colours and fonts for each live in css/style.css under
// [data-theme="..."]; this file holds everything else that changes with the
// theme: names, wording, the background scene and what a battle looks like.

const KEY = 'quizreactor.theme';

export const THEMES = {
  hacker: {
    name: 'Hacker terminal',
    blurb: 'Classic quiz and flashcards, no battles',
    ranks: [[100, 'Root access'], [80, 'System operator'], [60, 'Packet runner'], [40, 'Script kiddie'], [0, 'Signal lost']],
    praise: ['Correct', 'Access granted', 'Clean hit', 'Nailed it'],
    scene: { id: 0, a: [0.0, 1.0, 0.25], b: [0.83, 1.0, 0.23], c: [0.72, 1.0, 0.78] },
    battle: null,
  },
  pirate: {
    name: 'Pirate seas',
    blurb: 'Trade cannon fire with an enemy ship',
    ranks: [[100, 'Pirate legend'], [80, 'Captain'], [60, 'First mate'], [40, 'Deckhand'], [0, 'Castaway']],
    praise: ['Direct hit', 'Broadside', 'Dead on', 'Well aimed'],
    scene: { id: 1, a: [1.0, 0.72, 0.22], b: [1.0, 0.92, 0.6], c: [1.0, 0.95, 0.8] },
    battle: {
      you: 'Your ship',
      foe: 'Enemy ship',
      hit: 'Your cannon and crew hit the enemy ship.',
      hurt: 'The enemy ship fired back.',
      win: 'Enemy ship sunk',
      lose: 'Your ship went down',
    },
  },
  cyber: {
    name: 'Cyberpunk city',
    blurb: 'Duel a rival runner with light discs',
    ranks: [[100, 'City legend'], [80, 'Night runner'], [60, 'Neon rider'], [40, 'Rookie'], [0, 'Offline']],
    praise: ['Clean throw', 'On target', 'Sharp', 'Locked in'],
    scene: { id: 2, a: [1.0, 0.17, 0.84], b: [0.16, 0.94, 1.0], c: [1.0, 0.8, 0.98] },
    battle: {
      you: 'You',
      foe: 'Rival runner',
      hit: 'Your disc hit the rival.',
      hurt: 'The rival hit you with a disc.',
      win: 'Rival knocked off the grid',
      lose: 'You were knocked off the grid',
    },
  },
  tomb: {
    name: 'Jungle tomb',
    blurb: 'Hold off the gorilla guarding the tomb',
    ranks: [[100, 'Tomb master'], [80, 'Relic hunter'], [60, 'Pathfinder'], [40, 'Torch bearer'], [0, 'Lost in the vines']],
    praise: ['Bullseye', 'Sharp throw', 'Right on target', 'Clean strike'],
    scene: { id: 3, a: [0.2, 0.9, 0.68], b: [1.0, 0.71, 0.28], c: [0.8, 1.0, 0.9] },
    battle: {
      you: 'You',
      foe: 'Gorilla',
      hit: 'Your spear hit the gorilla.',
      hurt: 'The gorilla hit you with a rock.',
      win: 'The gorilla backed off',
      lose: 'The gorilla drove you out',
    },
  },
};

const root = document.documentElement;
const listeners = new Set();

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let current = THEMES[root.dataset.theme] ? root.dataset.theme : THEMES[stored()] ? stored() : 'hacker';
root.dataset.theme = current;

export const theme = {
  get id() { return current; },
  get data() { return THEMES[current]; },
  set(id) {
    if (!THEMES[id] || id === current) return;
    current = id;
    root.dataset.theme = id;
    try { localStorage.setItem(KEY, id); } catch { /* storage blocked: the theme just won't be remembered */ }
    listeners.forEach(fn => fn(id));
  },
  /** Run fn(id) every time the theme changes. */
  onChange(fn) { listeners.add(fn); },
  /** A CSS colour token of the current theme, e.g. color('--ion'). */
  color(token) { return getComputedStyle(root).getPropertyValue(token).trim(); },
};
