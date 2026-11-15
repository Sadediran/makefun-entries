// GLASSKEEP — content data: enemy definitions, mirror layout, wave schedules, upgrades.
// All numbers are data only; the rules in rules.js interpret them. No randomness here:
// a run's schedule is chosen by seed (seed % 3) and every spawn is fixed in the tables.

export const BOARD_SIZE = 7;
export const EMITTER_COL = 3;
export const MAX_HEARTS = 3;
export const TOTAL_WAVES = 6;
export const EDITS_PER_TURN = 1;

// Enemy types. hp = hits to destroy. score = points on destruction.
export const ENEMY_TYPES = {
  moth: {
    key: 'moth',
    name: 'Clockwork Moth',
    hp: 1,
    score: 10,
    blurb: 'One hit shatters it.',
  },
  armoured: {
    key: 'armoured',
    name: 'Armoured Moth',
    hp: 2,
    score: 25,
    blurb: 'Plated brass. Two hits to break.',
  },
  explosive: {
    key: 'explosive',
    name: 'Powder Moth',
    hp: 1,
    score: 15,
    blurb: 'Bursts on death, wounding moths beside it.',
  },
};

// The beam starts above column 3 and runs south. This opening layout bends it
// into a zig-zag (down col 3, east, down col 5, west along row 4, down col 1)
// so the very first preview already shows a bent golden beam.
export const MIRROR_START = [
  { id: 'm1', x: 3, y: 2, angle: '\\' },
  { id: 'm2', x: 5, y: 2, angle: '\\' },
  { id: 'm3', x: 5, y: 4, angle: '/' },
  { id: 'm4', x: 1, y: 4, angle: '/' },
];

// Where a spare mirror is placed by the upgrade, first free cell in this order.
export const SPARE_MIRROR_CELLS = [
  [3, 3], [2, 2], [4, 4], [2, 4], [4, 2],
  [1, 1], [5, 5], [1, 5], [5, 1], [3, 5],
  [0, 3], [6, 3], [3, 0], [3, 6], [0, 0],
];

// One spawn entry: { t, c, k } = turn within the wave, column, enemy key.
// Moths spawn on row 0 at the start of their turn and advance one tile after
// every shot. A moth takes 7 turns to cross the board, so each wave gives the
// keeper time to re-route the beam — but the later waves stack the pressure.
export const SCHEDULES = [
  {
    name: 'Ember',
    waves: [
      // Wave 1 — 3 moths, gentle opening.
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 5, k: 'moth' }, { t: 1, c: 3, k: 'moth' }],
      // Wave 2 — 4 moths, first armoured moth.
      [{ t: 0, c: 0, k: 'moth' }, { t: 0, c: 6, k: 'moth' }, { t: 1, c: 2, k: 'armoured' }, { t: 1, c: 4, k: 'moth' }],
      // Wave 3 — 5 moths, first powder moth.
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 3, k: 'explosive' }, { t: 0, c: 5, k: 'moth' }, { t: 1, c: 0, k: 'moth' }, { t: 1, c: 6, k: 'armoured' }],
      // Wave 4 — 6 moths, two fronts.
      [{ t: 0, c: 2, k: 'moth' }, { t: 0, c: 4, k: 'moth' }, { t: 1, c: 1, k: 'armoured' }, { t: 1, c: 5, k: 'explosive' }, { t: 2, c: 3, k: 'moth' }, { t: 2, c: 6, k: 'moth' }],
      // Wave 5 — 7 moths, armour and powder together.
      [{ t: 0, c: 0, k: 'moth' }, { t: 0, c: 3, k: 'armoured' }, { t: 0, c: 6, k: 'moth' }, { t: 1, c: 2, k: 'explosive' }, { t: 1, c: 4, k: 'moth' }, { t: 2, c: 1, k: 'moth' }, { t: 2, c: 5, k: 'armoured' }],
      // Wave 6 — 8 moths, the full tower assault.
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 3, k: 'moth' }, { t: 0, c: 5, k: 'moth' }, { t: 1, c: 0, k: 'armoured' }, { t: 1, c: 6, k: 'explosive' }, { t: 2, c: 2, k: 'moth' }, { t: 2, c: 4, k: 'armoured' }, { t: 3, c: 3, k: 'explosive' }],
    ],
  },
  {
    name: 'Verdigris',
    waves: [
      [{ t: 0, c: 2, k: 'moth' }, { t: 0, c: 4, k: 'moth' }, { t: 1, c: 6, k: 'moth' }],
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 5, k: 'armoured' }, { t: 1, c: 3, k: 'moth' }, { t: 1, c: 0, k: 'moth' }],
      [{ t: 0, c: 4, k: 'explosive' }, { t: 0, c: 2, k: 'moth' }, { t: 1, c: 6, k: 'moth' }, { t: 1, c: 0, k: 'armoured' }, { t: 2, c: 3, k: 'moth' }],
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 5, k: 'moth' }, { t: 1, c: 3, k: 'armoured' }, { t: 1, c: 2, k: 'explosive' }, { t: 2, c: 0, k: 'moth' }, { t: 2, c: 6, k: 'moth' }],
      [{ t: 0, c: 2, k: 'armoured' }, { t: 0, c: 4, k: 'moth' }, { t: 1, c: 1, k: 'moth' }, { t: 1, c: 5, k: 'explosive' }, { t: 2, c: 3, k: 'moth' }, { t: 2, c: 0, k: 'moth' }, { t: 2, c: 6, k: 'armoured' }],
      [{ t: 0, c: 0, k: 'moth' }, { t: 0, c: 3, k: 'moth' }, { t: 0, c: 6, k: 'moth' }, { t: 1, c: 2, k: 'explosive' }, { t: 1, c: 4, k: 'moth' }, { t: 2, c: 1, k: 'armoured' }, { t: 2, c: 5, k: 'moth' }, { t: 3, c: 3, k: 'armoured' }],
    ],
  },
  {
    name: 'Gilt',
    waves: [
      [{ t: 0, c: 0, k: 'moth' }, { t: 0, c: 3, k: 'moth' }, { t: 1, c: 6, k: 'moth' }],
      [{ t: 0, c: 2, k: 'moth' }, { t: 0, c: 4, k: 'moth' }, { t: 1, c: 1, k: 'explosive' }, { t: 1, c: 5, k: 'moth' }],
      [{ t: 0, c: 3, k: 'moth' }, { t: 0, c: 5, k: 'armoured' }, { t: 1, c: 1, k: 'moth' }, { t: 1, c: 6, k: 'moth' }, { t: 2, c: 2, k: 'explosive' }],
      [{ t: 0, c: 0, k: 'armoured' }, { t: 0, c: 6, k: 'moth' }, { t: 1, c: 2, k: 'moth' }, { t: 1, c: 4, k: 'moth' }, { t: 2, c: 3, k: 'explosive' }, { t: 2, c: 5, k: 'moth' }],
      [{ t: 0, c: 1, k: 'moth' }, { t: 0, c: 3, k: 'armoured' }, { t: 0, c: 5, k: 'moth' }, { t: 1, c: 0, k: 'explosive' }, { t: 1, c: 6, k: 'moth' }, { t: 2, c: 2, k: 'moth' }, { t: 2, c: 4, k: 'armoured' }],
      [{ t: 0, c: 2, k: 'moth' }, { t: 0, c: 4, k: 'moth' }, { t: 1, c: 0, k: 'moth' }, { t: 1, c: 3, k: 'explosive' }, { t: 1, c: 6, k: 'moth' }, { t: 2, c: 1, k: 'armoured' }, { t: 2, c: 5, k: 'moth' }, { t: 3, c: 3, k: 'moth' }],
    ],
  },
];

// Offered after waves 2 and 4. Choose one.
export const UPGRADES = [
  {
    key: 'mirror',
    name: 'Spare Mirror',
    blurb: 'A fifth mirror joins the tower. Bend the beam further.',
  },
  {
    key: 'powder',
    name: 'Wide Powder',
    blurb: 'Powder moths burst in all eight directions, not just four.',
  },
  {
    key: 'mend',
    name: 'Mend the Core',
    blurb: 'Restore one heart of the tower core, up to three.',
  },
];

// Scoring constants.
export const SCORE = {
  bankPerReflection: 5, // extra per kill, per reflection the beam made before reaching it
  chainPerExtraKill: 20, // extra per kill beyond the first in a single shot
  intactHeartBonus: 50, // per heart still standing at victory
};
