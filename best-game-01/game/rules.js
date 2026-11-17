// GLASSKEEP — authoritative deterministic rules.
// Pure logic: no DOM, no Math.random, no Date. Given the same seed and the same
// inputs, every function returns the same result. This file is the single source
// of truth for turns, ray tracing, damage, scoring and outcomes; the renderer and
// the preview both read from it, so what the player sees is what firing does.

import {
  BOARD_SIZE,
  EMITTER_COL,
  MAX_HEARTS,
  TOTAL_WAVES,
  EDITS_PER_TURN,
  ENEMY_TYPES,
  MIRROR_START,
  SPARE_MIRROR_CELLS,
  SCHEDULES,
  UPGRADES,
  SCORE,
} from './content.js';

// Directions: 0 = north, 1 = east, 2 = south, 3 = west.
export const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

// Reflection tables. '/' mirror and '\' mirror, indexed by incoming direction.
const REFLECT_SLASH = [1, 0, 3, 2]; // N->E, E->N, S->W, W->S
const REFLECT_BACKSLASH = [3, 2, 1, 0]; // N->W, E->S, S->E, W->N

export function reflect(angle, dir) {
  return angle === '/' ? REFLECT_SLASH[dir] : REFLECT_BACKSLASH[dir];
}

export function inBoard(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

// Small deterministic PRNG (mulberry32) for anything seeded: schedule choice is
// seed % 3; this is used for cosmetic variation that must still be reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createGame(seed) {
  const safeSeed = Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : 0;
  const scheduleIndex = safeSeed % SCHEDULES.length;
  const state = {
    seed: safeSeed,
    scheduleIndex,
    scheduleName: SCHEDULES[scheduleIndex].name,
    phase: 'title', // title | playing | upgrade | victory | defeat
    paused: false,
    wave: 1,
    turn: 0,
    hearts: MAX_HEARTS,
    score: 0,
    mirrors: MIRROR_START.map((m) => ({ ...m })),
    enemies: [],
    spawnQueue: [],
    editsLeft: EDITS_PER_TURN,
    firedThisTurn: false,
    turnStartMirrors: null,
    upgrades: { widePowder: false, mirrorsBought: 0 },
    bestChain: 0,
    kills: 0,
    breached: 0,
    lastShot: null, // { path, hits, kills, reflections, score, breached, time }
    upgradeOffer: null,
    victoryBonus: 0,
    nextEnemyId: 1,
    nextMirrorId: MIRROR_START.length + 1,
    startedAtTurn: 0,
  };
  return state;
}

export function startRun(state) {
  state.phase = 'playing';
  state.paused = false;
  state.wave = 1;
  state.turn = 0;
  state.hearts = MAX_HEARTS;
  state.score = 0;
  state.mirrors = MIRROR_START.map((m) => ({ ...m }));
  state.enemies = [];
  state.upgrades = { widePowder: false, mirrorsBought: 0 };
  state.bestChain = 0;
  state.kills = 0;
  state.breached = 0;
  state.lastShot = null;
  state.upgradeOffer = null;
  state.victoryBonus = 0;
  state.nextEnemyId = 1;
  state.nextMirrorId = MIRROR_START.length + 1;
  beginWave(state);
  return state;
}

function spawnForTurn(state, waveSpawns, turn) {
  for (const s of waveSpawns) {
    if (s.t !== turn) continue;
    const type = ENEMY_TYPES[s.k];
    state.enemies.push({
      id: 'e' + state.nextEnemyId++,
      type: s.k,
      name: type.name,
      x: s.c,
      y: 0,
      hp: type.hp,
      maxHp: type.hp,
    });
  }
}

export function beginWave(state) {
  const schedule = SCHEDULES[state.scheduleIndex];
  const waveSpawns = schedule.waves[state.wave - 1];
  state.turn = 0;
  state.spawnQueue = waveSpawns.filter((s) => s.t > 0).map((s) => ({ ...s }));
  state.editsLeft = EDITS_PER_TURN;
  state.firedThisTurn = false;
  state.enemies = [];
  spawnForTurn(state, waveSpawns, 0);
  state.turnStartMirrors = snapshotMirrors(state.mirrors);
  return state;
}

// ---------------------------------------------------------------------------
// Beam tracing — ONE shared function for preview and firing.
// ---------------------------------------------------------------------------

// Trace the beam from the emitter (above EMITTER_COL, heading south) or from a
// custom start {x, y, dx, dy} where (x, y) is the cell the beam currently sits
// in. Returns the path as a list of points (cell centres, with the entry and
// exit points on the board edge in cell coordinates), the enemies hit in order
// (each with the reflection count before it), and the total reflection count.
// Loop guard: a repeated (x, y, dir) ray state stops the trace.
export function traceBeam(state, start) {
  const mirrorsByCell = new Map();
  for (const m of state.mirrors) mirrorsByCell.set(m.x + ',' + m.y, m);
  const enemiesByCell = new Map();
  for (const e of state.enemies) enemiesByCell.set(e.x + ',' + e.y, e);

  const sx = start ? start.x : EMITTER_COL;
  const sy = start ? start.y : -1;
  const sdir = start ? start.dir : 2; // south
  let cx = sx;
  let cy = sy;
  let dir = sdir;

  // Points in cell coordinates; the emitter sits half a cell above row 0.
  const points = [[EMITTER_COL + 0.5, -0.5]];
  const hits = [];
  const seen = new Set();
  let reflections = 0;
  let guard = 0;

  while (guard++ < 500) {
    const nx = cx + DIRS[dir].dx;
    const ny = cy + DIRS[dir].dy;
    if (!inBoard(nx, ny)) {
      // Beam leaves the board: end the path at the board edge.
      points.push([nx + 0.5, ny + 0.5]);
      break;
    }
    const rayState = nx + ',' + ny + ',' + dir;
    if (seen.has(rayState)) break; // loop guard: same cell, same direction
    seen.add(rayState);
    cx = nx;
    cy = ny;
    points.push([cx + 0.5, cy + 0.5]);

    const enemy = enemiesByCell.get(cx + ',' + cy);
    if (enemy && !hits.some((h) => h.id === enemy.id)) {
      hits.push({ id: enemy.id, x: cx, y: cy, reflectionsBefore: reflections });
    }
    const mirror = mirrorsByCell.get(cx + ',' + cy);
    if (mirror) {
      dir = reflect(mirror.angle, dir);
      reflections++;
    }
  }
  return { points, hits, reflections };
}

// ---------------------------------------------------------------------------
// Mirror edits (at most one per turn) and undo
// ---------------------------------------------------------------------------

export function snapshotMirrors(mirrors) {
  return mirrors.map((m) => ({ ...m }));
}

export function canEdit(state) {
  return state.phase === 'playing' && !state.paused && state.editsLeft > 0 && !state.firedThisTurn;
}

export function flipMirror(state, mirrorId) {
  if (!canEdit(state)) return { ok: false, reason: 'no edits left this turn' };
  const mirror = state.mirrors.find((m) => m.id === mirrorId);
  if (!mirror) return { ok: false, reason: 'no such mirror' };
  mirror.angle = mirror.angle === '/' ? '\\' : '/';
  state.editsLeft--;
  state.highlightMirror = mirror.id;
  return { ok: true };
}

export function moveMirror(state, mirrorId, x, y) {
  if (!canEdit(state)) return { ok: false, reason: 'no edits left this turn' };
  if (!inBoard(x, y)) return { ok: false, reason: 'outside the board' };
  const mirror = state.mirrors.find((m) => m.id === mirrorId);
  if (!mirror) return { ok: false, reason: 'no such mirror' };
  if (mirror.x === x && mirror.y === y) return { ok: false, reason: 'already there' };
  if (state.mirrors.some((m) => m.id !== mirrorId && m.x === x && m.y === y)) {
    return { ok: false, reason: 'another mirror is there' };
  }
  mirror.x = x;
  mirror.y = y;
  state.editsLeft--;
  state.highlightMirror = mirror.id;
  return { ok: true };
}

export function undoEdit(state) {
  if (state.phase !== 'playing' || state.paused) return { ok: false, reason: 'not playing' };
  if (state.firedThisTurn) return { ok: false, reason: 'already fired this turn' };
  if (!state.turnStartMirrors) return { ok: false, reason: 'nothing to undo' };
  state.mirrors = snapshotMirrors(state.turnStartMirrors);
  state.editsLeft = EDITS_PER_TURN;
  state.highlightMirror = null;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Firing — the whole turn resolves here, deterministically.
// ---------------------------------------------------------------------------

function neighboursOf(x, y, wide) {
  const cells = [];
  const deltas = wide
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  for (const [dx, dy] of deltas) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBoard(nx, ny)) cells.push([nx, ny]);
  }
  return cells;
}

// Apply one point of damage to an enemy; returns 'dead' when it is destroyed.
function damageEnemy(state, enemy, bySplash, events) {
  enemy.hp -= 1;
  if (enemy.hp > 0) {
    events.damaged.push({ id: enemy.id, type: enemy.type, x: enemy.x, y: enemy.y, hp: enemy.hp, splash: bySplash });
    return 'alive';
  }
  events.killed.push({ id: enemy.id, type: enemy.type, x: enemy.x, y: enemy.y, splash: bySplash });
  return 'dead';
}

export function fire(state) {
  if (state.phase !== 'playing' || state.paused) return null;
  const events = { killed: [], damaged: [], breached: [], shotScore: 0, chain: 0 };
  const trace = traceBeam(state);

  // 1. Beam damage: once per enemy per shot, in path order.
  const deadIds = new Set();
  const splashQueue = [];
  let shotScore = 0;
  for (const hit of trace.hits) {
    const enemy = state.enemies.find((e) => e.id === hit.id);
    if (!enemy || deadIds.has(enemy.id)) continue;
    const outcome = damageEnemy(state, enemy, false, events);
    if (outcome === 'dead') {
      deadIds.add(enemy.id);
      shotScore += ENEMY_TYPES[enemy.type].score + SCORE.bankPerReflection * hit.reflectionsBefore;
      if (enemy.type === 'explosive') splashQueue.push(enemy);
    }
  }

  // 2. Powder bursts: each destroyed powder moth wounds its neighbours once.
  // Chain reactions are allowed (a powder moth destroyed by a burst bursts too),
  // but every enemy is splashed at most once per shot.
  const splashed = new Set();
  while (splashQueue.length > 0) {
    const source = splashQueue.shift();
    for (const [nx, ny] of neighboursOf(source.x, source.y, state.upgrades.widePowder)) {
      const target = state.enemies.find((e) => e.x === nx && e.y === ny && !deadIds.has(e.id));
      if (!target || splashed.has(target.id)) continue;
      splashed.add(target.id);
      const outcome = damageEnemy(state, target, true, events);
      if (outcome === 'dead') {
        deadIds.add(target.id);
        shotScore += ENEMY_TYPES[target.type].score;
        if (target.type === 'explosive') splashQueue.push(target);
      }
    }
  }

  // 3. Chain bonus: more than one kill in a single shot pays extra.
  const killsThisShot = events.killed.length;
  if (killsThisShot > 1) shotScore += SCORE.chainPerExtraKill * (killsThisShot - 1);
  if (killsThisShot > state.bestChain) state.bestChain = killsThisShot;
  state.kills += killsThisShot;
  state.score += shotScore;
  events.shotScore = shotScore;
  events.chain = killsThisShot;
  events.reflections = trace.reflections;

  // Remove the dead.
  state.enemies = state.enemies.filter((e) => !deadIds.has(e.id));
  state.firedThisTurn = true;
  state.lastShot = {
    path: trace.points,
    hits: trace.hits.map((h) => ({ x: h.x, y: h.y })),
    kills: killsThisShot,
    reflections: trace.reflections,
    score: shotScore,
  };

  // 4. Surviving moths advance one tile. A moth leaving the bottom crosses the
  // red line: one heart lost, the moth is gone.
  const breachedNow = [];
  for (const enemy of state.enemies) {
    enemy.y += 1;
    if (enemy.y >= BOARD_SIZE) breachedNow.push(enemy);
  }
  if (breachedNow.length > 0) {
    state.enemies = state.enemies.filter((e) => e.y < BOARD_SIZE);
    state.hearts -= breachedNow.length;
    state.breached += breachedNow.length;
    events.breached = breachedNow.map((e) => ({ id: e.id, type: e.type }));
  }

  // 5. Outcomes.
  if (state.hearts <= 0) {
    state.hearts = 0;
    state.phase = 'defeat';
    return { events, outcome: 'defeat' };
  }
  if (waveCleared(state)) {
    if (state.wave >= TOTAL_WAVES) {
      state.victoryBonus = SCORE.intactHeartBonus * state.hearts;
      state.score += state.victoryBonus;
      state.phase = 'victory';
      return { events, outcome: 'victory' };
    }
    if (state.wave === 2 || state.wave === 4) {
      state.phase = 'upgrade';
      state.upgradeOffer = UPGRADES.map((u) => ({ ...u }));
      return { events, outcome: 'upgrade' };
    }
    state.wave += 1;
    beginWave(state);
    return { events, outcome: 'wave' };
  }

  // 6. Next turn: spawn this turn's moths, refresh the edit budget.
  state.turn += 1;
  const schedule = SCHEDULES[state.scheduleIndex];
  spawnForTurn(state, schedule.waves[state.wave - 1], state.turn);
  state.spawnQueue = state.spawnQueue.filter((s) => s.t !== state.turn);
  state.editsLeft = EDITS_PER_TURN;
  state.firedThisTurn = false;
  state.turnStartMirrors = snapshotMirrors(state.mirrors);
  return { events, outcome: 'continue' };
}

export function waveCleared(state) {
  const schedule = SCHEDULES[state.scheduleIndex];
  const waveSpawns = schedule.waves[state.wave - 1];
  const remaining = waveSpawns.some((s) => s.t > state.turn);
  return !remaining && state.enemies.length === 0;
}

// Moths due to spawn next turn (for the telegraph arrows).
export function nextSpawns(state) {
  if (state.phase !== 'playing') return [];
  const schedule = SCHEDULES[state.scheduleIndex];
  return schedule.waves[state.wave - 1].filter((s) => s.t === state.turn + 1);
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export function chooseUpgrade(state, key) {
  if (state.phase !== 'upgrade') return { ok: false, reason: 'no upgrade offered' };
  if (key === 'mirror') {
    for (const [x, y] of SPARE_MIRROR_CELLS) {
      if (!state.mirrors.some((m) => m.x === x && m.y === y)) {
        state.mirrors.push({ id: 'm' + state.nextMirrorId++, x, y, angle: '/' });
        state.upgrades.mirrorsBought += 1;
        break;
      }
    }
  } else if (key === 'powder') {
    state.upgrades.widePowder = true;
  } else if (key === 'mend') {
    state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
  } else {
    return { ok: false, reason: 'unknown upgrade' };
  }
  state.upgradeOffer = null;
  state.phase = 'playing';
  state.wave += 1;
  beginWave(state);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Score breakdown for the victory screen
// ---------------------------------------------------------------------------

export function scoreBreakdown(state) {
  return {
    kills: state.kills,
    bestChain: state.bestChain,
    breached: state.breached,
    heartsLeft: state.hearts,
    intactBonus: state.victoryBonus,
    total: state.score,
  };
}
