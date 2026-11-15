// GLASSKEEP v2 — rules.js: the board, the beam and combat. Pure logic.
//
// ONE shared trace function (traceBeam) serves both the aiming preview and
// the actual shot, so the preview can never lie. No DOM, no randomness, no
// imports from the DOM modules: Node unit tests import this file directly.
//
// Coordinates: columns 0-6 left to right, rows 0-6 top to bottom. Moths
// spawn near row 0 and advance one row per shot toward row 6 (the bottom
// line). The emitter sits at (emitterCol, 6) and fires straight up.

import { COLS, ROWS, ENEMIES, SCORE_PER_REFLECTION, SCORE_PER_CHAIN_KILL } from './content.js';

/** Loop guards: a beam stops after this many steps or reflections, so a
 *  mirror loop can never hang the game. */
export const MAX_TRACE_STEPS = 512;
export const MAX_REFLECTIONS = 64;
/** A Powder burst cascade stops after this many burst events. */
export const MAX_BURST_EVENTS = 64;

/** Key a board cell by "col,row". */
export const cellKey = (c, r) => `${c},${r}`;

/** Is (c,r) on the board? */
export const onBoard = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

/** The four orthogonal neighbours of (c,r), on the board. */
export function neighbours(c, r) {
  return [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]].filter(([x, y]) => onBoard(x, y));
}

/** Reflect a beam direction off a mirror: '/' maps (dx,dy) to (-dy,-dx),
 *  '\\' maps it to (dy,dx). */
export function reflect(dx, dy, mirror) {
  const [a, b] = mirror === '/' ? [-dy, -dx] : [dy, dx];
  // Normalise -0 to 0 (negating a zero component yields -0).
  return [a === 0 ? 0 : a, b === 0 ? 0 : b];
}

// ---------------------------------------------------------------- board setup

/** Build a tower's starting board: its mirrors (a plain object keyed by
 *  "col,row"), its buttresses (a Set of keys) and its emitter column. */
export function createBoard(tower) {
  const mirrors = {};
  for (const m of tower.mirrors) mirrors[cellKey(m.c, m.r)] = m.o;
  const buttresses = new Set(tower.buttresses.map((b) => cellKey(b.c, b.r)));
  return { mirrors, buttresses, emitterCol: tower.emitterCol };
}

/** Place an assault's moths. The boss (if any) takes (bossCol, 0); the
 *  moths fill the tower's spawn lanes in order, row 0 then row 1, skipping
 *  taken cells. Deterministic: the same assault always spawns the same way. */
export function placeAssault(tower, assaultIndex) {
  const assault = tower.assaults[assaultIndex];
  const moths = [];
  const taken = new Set();
  let n = 0;
  const add = (type, c, r, name) => {
    const def = ENEMIES[type];
    moths.push({ id: `m${assaultIndex}-${n++}`, type, name: name ?? def.name, c, r, hp: def.hp, maxHp: def.hp });
    taken.add(cellKey(c, r));
  };
  if (assault.boss) add(assault.boss, assault.bossCol, 0, assault.bossName ?? ENEMIES[assault.boss].name);
  const lanes = tower.lanes;
  let placed = 0;
  for (let row = 0; row < ROWS && placed < assault.moths.length; row++) {
    for (const lane of lanes) {
      if (placed >= assault.moths.length) break;
      if (taken.has(cellKey(lane, row))) continue;
      add(assault.moths[placed], lane, row);
      placed++;
    }
  }
  return moths;
}

// ---------------------------------------------------------------- the trace

/** Trace the beam from the emitter through the board. Shared by the preview
 *  and the shot. Returns the path (cells in order, with the direction the
 *  beam travelled into each), the reflection count, and the moths the beam
 *  crosses, in path order (each moth once, even if the beam crosses its cell
 *  twice — damage is once per enemy per shot).
 *
 *  A moth standing on a mirror cell is hit AND the beam still reflects there:
 *  the beam crosses the cell, so it strikes what is in it. */
export function traceBeam(board, moths) {
  const byCell = new Map(moths.map((m) => [cellKey(m.c, m.r), m]));
  const path = [];
  const hits = [];
  const hitIds = new Set();
  let reflections = 0;
  let c = board.emitterCol;
  let r = ROWS - 1;
  let dx = 0;
  let dy = -1;
  let steps = 0;
  while (steps < MAX_TRACE_STEPS && reflections <= MAX_REFLECTIONS) {
    c += dx;
    r += dy;
    steps++;
    if (!onBoard(c, r)) break;
    path.push({ c, r, dx, dy });
    const key = cellKey(c, r);
    const moth = byCell.get(key);
    if (moth && !hitIds.has(moth.id)) {
      hitIds.add(moth.id);
      hits.push({ moth, reflectionsSoFar: reflections });
    }
    if (board.buttresses.has(key)) break;
    const mirror = board.mirrors[key];
    if (mirror) {
      reflections++;
      [dx, dy] = reflect(dx, dy, mirror);
    }
  }
  return { path, hits, reflections };
}

// ---------------------------------------------------------------- combat

/** Is a moth shielded right now? A moth is shielded when a LIVING Warden
 *  moth stands orthogonally beside it — unless Warden's Bane is owned, which
 *  strips every Warden's shield. Evaluated live during a shot, so killing
 *  the Warden first unshields the rest later in the same beam. */
export function isShielded(moth, moths, relics) {
  if (relics.includes('wardens-bane')) return false;
  for (const [x, y] of neighbours(moth.c, moth.r)) {
    const other = moths.find((m) => m.c === x && m.r === y && m.hp > 0 && m.type === 'warden');
    if (other) return true;
  }
  return false;
}

/** Fire one shot and resolve everything: beam damage (with relic modifiers),
 *  Powder bursts (chained, loop-guarded), scoring, Ember earnings, the moth
 *  advance and breaches. Mutates the run state; returns a report of what
 *  happened, which the UI uses for feedback (chain banners, floating scores).
 *
 *  Damage order per hit: base 1; +1 if this is the first hit that deals
 *  damage this shot and Gilded Lens is owned; +1 if this is the first hit
 *  after the beam's first reflection and Dawn Prism is owned. A shielded
 *  moth takes no beam damage at all. Burst damage ignores shields. */
export function applyShot(state) {
  const relics = state.relics;
  const trace = traceBeam(state.board, state.moths);
  const report = {
    path: trace.path, reflections: trace.reflections,
    kills: [], damageDealt: 0, shieldedHits: 0, chainKills: 0,
    score: 0, embers: 0, breached: [], burstEvents: 0,
    reflectionBonus: 0, // banked only when the beam hurt something (below)
  };
  const living = () => state.moths.filter((m) => m.hp > 0);
  let firstDamagingDone = false;
  let prismDone = false;
  let killsSoFar = 0;
  const burstQueue = [];

  const killMoth = (moth) => {
    if (moth.hp > 0) return;
    killsSoFar++;
    report.kills.push(moth);
    const def = ENEMIES[moth.type];
    report.score += def.score;
    report.embers += def.embers;
    if (killsSoFar > 1) {
      report.chainKills++;
      report.score += SCORE_PER_CHAIN_KILL + (relics.includes('silver-thread') ? 5 : 0);
    }
    if (def.burst > 0) burstQueue.push(moth);
  };

  // Beam hits, in path order. Damage is once per enemy per shot: traceBeam
  // already lists each moth once.
  for (const hit of trace.hits) {
    const moth = hit.moth;
    if (moth.hp <= 0) continue;
    if (isShielded(moth, living(), relics)) {
      report.shieldedHits++;
      continue;
    }
    let damage = 1;
    if (!firstDamagingDone && relics.includes('gilded-lens')) damage += 1;
    if (!prismDone && hit.reflectionsSoFar >= 1 && relics.includes('dawn-prism')) {
      damage += 1;
      prismDone = true;
    }
    firstDamagingDone = true;
    moth.hp -= damage;
    report.damageDealt += damage;
    killMoth(moth);
  }

  // Powder bursts, chained: a burst can kill another Powder moth, which
  // bursts in turn. Each moth bursts at most once (it is dead), and the
  // event cap is a second guard. Burst damage ignores Warden shields.
  const burstPower = relics.includes('powder-keg') ? 2 : 1;
  let burstGuard = 0;
  while (burstQueue.length > 0 && burstGuard < MAX_BURST_EVENTS) {
    const source = burstQueue.shift();
    burstGuard++;
    report.burstEvents++;
    for (const [x, y] of neighbours(source.c, source.r)) {
      const target = living().find((m) => m.c === x && m.r === y);
      if (!target) continue;
      target.hp -= burstPower;
      report.damageDealt += burstPower;
      killMoth(target);
    }
  }

  // Reflections bank only when the beam actually hurt something this shot:
  // a harmless pass — or one that only touches shielded moths — banks
  // nothing, so parking a moth behind a buttress and firing at it forever
  // farms no score. (Burst damage only follows a beam kill, so damageDealt
  // above zero always means the beam itself landed a hit.)
  if (report.damageDealt > 0) {
    report.reflectionBonus = trace.reflections * SCORE_PER_REFLECTION;
    report.score += report.reflectionBonus;
  }

  // Remove the dead, then advance the survivors one tile toward the bottom
  // line. Bottom-first, so a moth never blocks the one behind it: a moth
  // moves down when the cell below is empty of moths and not a buttress;
  // a moth reaching row 6 breaches (loses hearts, is removed).
  state.moths = living();
  const occupied = new Set(state.moths.map((m) => cellKey(m.c, m.r)));
  const ordered = [...state.moths].sort((a, b) => b.r - a.r);
  for (const moth of ordered) {
    const below = cellKey(moth.c, moth.r + 1);
    if (moth.r + 1 >= ROWS) {
      // Already on the bottom line: breach at once (cannot normally happen).
      report.breached.push(moth);
      continue;
    }
    if (moth.r + 1 === ROWS - 1) {
      // Stepping onto the bottom line is a breach, not a move.
      report.breached.push(moth);
      occupied.delete(cellKey(moth.c, moth.r));
      continue;
    }
    if (!occupied.has(below) && !state.board.buttresses.has(below)) {
      occupied.delete(cellKey(moth.c, moth.r));
      moth.r += 1;
      occupied.add(below);
    }
  }
  for (const moth of report.breached) {
    state.moths = state.moths.filter((m) => m.id !== moth.id);
    state.hearts -= ENEMIES[moth.type].breach;
  }

  state.score += report.score;
  state.embers += report.embers;
  state.shotsFired++;
  state.kills += report.kills.length;
  return report;
}

/** The assault is cleared when no moth remains. */
export function assaultCleared(state) {
  return state.moths.length === 0;
}

/** Deep-clone a run state for the solver's lookahead (plain data only). */
export function cloneState(state) {
  return {
    ...state,
    board: {
      mirrors: { ...state.board.mirrors },
      buttresses: new Set(state.board.buttresses),
      emitterCol: state.board.emitterCol,
    },
    moths: state.moths.map((m) => ({ ...m })),
    relics: [...state.relics],
  };
}

/** Every legal mirror edit from a board: flip each mirror, and move each
 *  mirror to each empty cell (not a buttress, not occupied by a mirror).
 *  Used by the autoplay solver. */
export function legalEdits(board) {
  const edits = [];
  const keys = Object.keys(board.mirrors);
  for (const key of keys) {
    const [c, r] = key.split(',').map(Number);
    edits.push({ kind: 'flip', c, r });
  }
  const empty = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const key = cellKey(c, r);
      if (board.mirrors[key] || board.buttresses.has(key)) continue;
      if (r === ROWS - 1 && c === board.emitterCol) continue;
      empty.push({ c, r });
    }
  }
  for (const key of keys) {
    const [c, r] = key.split(',').map(Number);
    for (const cell of empty) {
      edits.push({ kind: 'move', fromC: c, fromR: r, toC: cell.c, toR: cell.r });
    }
  }
  return edits;
}

/** Apply one edit to a board (mutates the board passed in). */
export function applyEdit(board, edit) {
  if (edit.kind === 'flip') {
    const key = cellKey(edit.c, edit.r);
    board.mirrors[key] = board.mirrors[key] === '/' ? '\\' : '/';
    return;
  }
  const from = cellKey(edit.fromC, edit.fromR);
  const to = cellKey(edit.toC, edit.toR);
  board.mirrors[to] = board.mirrors[from];
  delete board.mirrors[from];
}
