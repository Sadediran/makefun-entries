// GLASSKEEP v2 — content.js: every fixed datum of the game.
//
// Towers, layouts, assault schedules, enemies, relics, crafts and grade
// thresholds. Pure data: no DOM, no randomness, no imports. Every run reads
// from here, so a tower's layout and schedule are the same for every player
// and every replay. (Determinism: schedules are fixed lists, never rolled.)

// ---------------------------------------------------------------- board

/** The board is 7 columns by 7 rows. Row 0 is the top (spawn); row 6 is the
 *  bottom line, where the emitter sits and where a breaching moth costs a heart. */
export const COLS = 7;
export const ROWS = 7;

/** A mirror's two angles. '/' turns a beam (dx,dy) into (-dy,-dx);
 *  '\\' turns it into (dy,dx). */
export const MIRROR_SLASH = '/';
export const MIRROR_BACKSLASH = '\\';

// ---------------------------------------------------------------- enemies

/** Enemy types. hp: beam hits to kill. score: points on kill. embers: Embers
 *  earned on kill. breach: hearts lost when it reaches the bottom line.
 *  burst: Powder moths wound orthogonally adjacent moths for this on death.
 *  shield: Warden moths protect orthogonally adjacent moths from beam damage. */
export const ENEMIES = {
  silk: { id: 'silk', name: 'Silk Moth', hp: 1, score: 10, embers: 1, breach: 1, burst: 0, shield: false,
          colour: '#e8c97a', wing: '#f5e3b0', desc: 'A plain clockwork moth.' },
  iron: { id: 'iron', name: 'Iron Moth', hp: 2, score: 25, embers: 2, breach: 1, burst: 0, shield: false,
          colour: '#9fb4c8', wing: '#c8d8e8', desc: 'Armoured: needs two beam hits.' },
  powder: { id: 'powder', name: 'Powder Moth', hp: 1, score: 15, embers: 2, breach: 1, burst: 1, shield: false,
          colour: '#d98a4a', wing: '#f0b27a', desc: 'Bursts on death, wounding moths beside it.' },
  warden: { id: 'warden', name: 'Warden Moth', hp: 3, score: 30, embers: 2, breach: 1, burst: 0, shield: true,
          colour: '#7fb8a4', wing: '#a8d8c8', desc: 'Shields the moths beside it from the beam.' },
  guardian: { id: 'guardian', name: 'Tower Guardian', hp: 4, score: 50, embers: 5, breach: 1, burst: 0, shield: false,
          colour: '#c8a24a', wing: '#e8c86a', desc: 'A named guardian of the tower.' },
  grand: { id: 'grand', name: 'THE GRAND MOTH', hp: 6, score: 100, embers: 10, breach: 2, burst: 0, shield: false,
          colour: '#b08ae0', wing: '#d0b0f0', desc: 'The final boss. Costs two hearts if it breaks through.' },
};

/** Scoring: +5 per reflection banked on a shot; +20 per extra kill in one
 *  shot's chain (Silver Thread adds +5 to each chain kill). */
export const SCORE_PER_REFLECTION = 5;
export const SCORE_PER_CHAIN_KILL = 20;
export const SCORE_PER_UNSPENT_EMBER = 10;
export const SCORE_PER_INTACT_HEART = 50;

// ---------------------------------------------------------------- relics

/** The nine relics. Each is a passive modifier on existing rules — no relic
 *  adds a new core system. icon: a single glyph drawn on its draft card. */
export const RELICS = [
  { id: 'gilded-lens', name: 'Gilded Lens', icon: '◈', effect: 'The beam deals +1 damage to the first moth it hits each shot.' },
  { id: 'amber-charm', name: 'Amber Charm', icon: '✦', effect: '+2 Embers whenever an assault is cleared.' },
  { id: 'iron-sash', name: 'Iron Sash', icon: '▣', effect: '+1 max heart, and mend 1 heart at once.' },
  { id: 'powder-keg', name: 'Powder Keg', icon: '✹', effect: 'Powder bursts wound for 2 instead of 1.' },
  { id: 'swift-glass', name: 'Swift Glass', icon: '≫', effect: '+1 mirror edit per turn (2 edits instead of 1).' },
  { id: 'ember-heart', name: 'Ember Heart', icon: '♥', effect: 'Start each assault with +3 Embers.' },
  { id: 'silver-thread', name: 'Silver Thread', icon: '~', effect: '+5 extra score per chain kill.' },
  { id: 'wardens-bane', name: "Warden's Bane", icon: '⚔', effect: 'Warden moths lose their shield.' },
  { id: 'dawn-prism', name: 'Dawn Prism', icon: '△', effect: 'The first moth hit after the beam\u2019s first reflection takes +1 damage.' },
];

// ---------------------------------------------------------------- crafts

/** The three Ember crafts, bought between assaults (each once per gap). */
export const CRAFTS = [
  { id: 'mend', name: 'Mend the Core', cost: 8, desc: '+1 heart, up to your max.' },
  { id: 'spare-mirror', name: 'Spare Mirror', cost: 10, desc: '+1 mirror: place it on any empty cell.' },
  { id: 'reinforce', name: 'Reinforce the Tower', cost: 6, desc: '+1 max heart (max 5), and mend 1 heart at once.' },
];

/** Hearts: a tower run starts at 3; the max is 3 unless raised (cap 5). */
export const START_HEARTS = 3;
export const START_MAX_HEARTS = 3;
export const MAX_HEARTS_CAP = 5;

// ---------------------------------------------------------------- towers

/** An assault: a fixed list of moth types, in spawn order, plus an optional
 *  boss. The boss spawns at bossCol on row 0; the moths fill the tower's
 *  spawn lanes in order (row 0, overflowing to row 1), skipping taken cells.
 *  The counts are totals: assault 3's total includes its boss. */
export const TOWERS = [
  {
    id: 'ember', name: 'Ember Tower', difficulty: 'Gentle', seed: 1,
    intro: 'Red glass and slow wings. Learn the beam here.',
    palette: { bg0: '#1a0f14', bg1: '#2e1410', glass: '#c84a3a', beam: '#ffd76a', accent: '#e8a04a', panel: '#241016', text: '#f5e0c8' },
    emitterCol: 3,
    mirrors: [ { c: 2, r: 4, o: '/' }, { c: 4, r: 4, o: '\\' }, { c: 3, r: 2, o: '/' }, { c: 1, r: 3, o: '\\' } ],
    buttresses: [],
    lanes: [1, 3, 5],
    assaults: [
      { moths: ['silk', 'silk', 'silk'], boss: null, bossCol: 3 },
      { moths: ['silk', 'silk', 'iron', 'powder'], boss: null, bossCol: 3 },
      { moths: ['silk', 'silk', 'iron', 'powder'], boss: 'guardian', bossCol: 3, bossName: 'The Ember Warden' },
    ],
    grades: { S: 700, A: 500, B: 300 },
  },
  {
    id: 'verdigris', name: 'Verdigris Tower', difficulty: 'Normal', seed: 2,
    intro: 'Green glass, hard corners. Wardens shield their kin.',
    palette: { bg0: '#0e1a16', bg1: '#12291f', glass: '#3a9a7a', beam: '#ffe08a', accent: '#6ac8a0', panel: '#0f1f18', text: '#dcf0e2' },
    emitterCol: 2,
    mirrors: [ { c: 1, r: 4, o: '\\' }, { c: 3, r: 3, o: '/' }, { c: 5, r: 4, o: '/' }, { c: 4, r: 1, o: '\\' } ],
    buttresses: [ { c: 3, r: 5 }, { c: 5, r: 2 } ],
    lanes: [0, 2, 4, 6],
    assaults: [
      { moths: ['silk', 'silk', 'silk', 'powder'], boss: null, bossCol: 2 },
      { moths: ['silk', 'silk', 'iron', 'iron', 'powder'], boss: null, bossCol: 2 },
      { moths: ['silk', 'silk', 'iron', 'powder', 'warden'], boss: 'guardian', bossCol: 2, bossName: 'The Verdigris Warden' },
    ],
    grades: { S: 950, A: 700, B: 450 },
  },
  {
    id: 'gilt', name: 'Gilt Tower', difficulty: 'Hard', seed: 3,
    intro: 'White gold and iron wings. Every shot must count.',
    palette: { bg0: '#1a160c', bg1: '#2a2110', glass: '#c8a24a', beam: '#fff0a8', accent: '#e8cc6a', panel: '#1e180e', text: '#f8ecd0' },
    emitterCol: 4,
    mirrors: [ { c: 5, r: 4, o: '/' }, { c: 3, r: 3, o: '\\' }, { c: 2, r: 5, o: '/' }, { c: 4, r: 1, o: '/' }, { c: 6, r: 3, o: '\\' } ],
    buttresses: [ { c: 2, r: 2 }, { c: 5, r: 1 }, { c: 1, r: 4 } ],
    lanes: [0, 1, 3, 5],
    assaults: [
      { moths: ['silk', 'silk', 'iron', 'powder', 'warden'], boss: null, bossCol: 4 },
      { moths: ['silk', 'iron', 'iron', 'powder', 'warden', 'silk'], boss: null, bossCol: 4 },
      { moths: ['iron', 'iron', 'powder', 'warden', 'silk', 'silk'], boss: 'guardian', bossCol: 4, bossName: 'The Gilt Warden' },
    ],
    grades: { S: 1200, A: 900, B: 600 },
  },
  {
    id: 'sable', name: 'Sable Tower', difficulty: 'Brutal', seed: 4,
    intro: 'Violet dark. The Grand Moth waits at the top.',
    palette: { bg0: '#120e1e', bg1: '#1d1430', glass: '#7a5ac8', beam: '#ffdd7a', accent: '#a88ae0', panel: '#160f26', text: '#e8dff8' },
    emitterCol: 3,
    mirrors: [ { c: 2, r: 4, o: '\\' }, { c: 4, r: 4, o: '/' }, { c: 3, r: 3, o: '/' }, { c: 1, r: 2, o: '\\' }, { c: 5, r: 2, o: '/' } ],
    buttresses: [ { c: 3, r: 5 }, { c: 0, r: 3 }, { c: 6, r: 3 }, { c: 4, r: 1 } ],
    lanes: [0, 1, 2, 3, 4, 5, 6],
    assaults: [
      { moths: ['silk', 'iron', 'powder', 'warden', 'silk', 'iron'], boss: null, bossCol: 3 },
      { moths: ['iron', 'iron', 'powder', 'warden', 'silk', 'powder', 'iron'], boss: null, bossCol: 3 },
      { moths: ['iron', 'warden', 'powder', 'iron', 'silk', 'warden', 'powder'], boss: 'grand', bossCol: 3, bossName: 'THE GRAND MOTH' },
    ],
    grades: { S: 1500, A: 1100, B: 750 },
  },
];

/** A tower's grade from its grade score: score + 100 per heart standing
 *  at the end − 10 per turn used. Thresholds are per tower, in data above. */
export function gradeFor(tower, gradeScore) {
  if (gradeScore >= tower.grades.S) return 'S';
  if (gradeScore >= tower.grades.A) return 'A';
  if (gradeScore >= tower.grades.B) return 'B';
  return 'C';
}

/** Campaign grade from the four tower grades (S=4, A=3, B=2, C=1). */
export function campaignGradeFor(grades) {
  const points = { S: 4, A: 3, B: 2, C: 1 };
  const avg = grades.reduce((n, g) => n + (points[g] ?? 1), 0) / grades.length;
  if (avg >= 3.5) return 'S';
  if (avg >= 2.5) return 'A';
  if (avg >= 1.5) return 'B';
  return 'C';
}

/** Look a tower up by id. */
export function towerById(id) {
  return TOWERS.find((t) => t.id === id) ?? null;
}

/** Look a relic up by id. */
export function relicById(id) {
  return RELICS.find((r) => r.id === id) ?? null;
}

/** Look a craft up by id. */
export function craftById(id) {
  return CRAFTS.find((c) => c.id === id) ?? null;
}
