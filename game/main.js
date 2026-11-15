// GLASSKEEP v2 — main.js: bootstrap, screen flow and the turn loop.
//
// Owns the run state and the screen machine: start → map → intro → play →
// craft → draft → play … → tower win → map … → campaign win (or defeat).
// One turn is: up to N mirror edits (N=1, or 2 with Swift Glass), then FIRE.
// The beam, the advance and the scoring all live in rules.js; this module
// only sequences them and feeds the UI.
//
// A read-only inspector is exposed as window.GLASSKEEP (state snapshots and
// the pure trace function, no actions): the QA harness reads it to play
// through the real UI, and it cannot change any rule.

import { TOWERS, START_HEARTS, START_MAX_HEARTS, towerById, gradeFor, relicById } from './content.js';
import { createBoard, placeAssault, traceBeam, applyShot, assaultCleared, applyEdit, cellKey } from './rules.js';
import { assaultClearEmbers, assaultStartEmbers, buyCraft, placeSpareMirror, towerEndBonus, gradeScore } from './economy.js';
import { draftOffer, applyRelic, editsPerTurn } from './draft.js';
import { livingBoss, bossBanner } from './boss.js';
import { CANVAS_W, CANVAS_H, BOARD, drawScene, cellCentre } from './render.js';
import { drawBackground } from './background.js';
import { newCampaign, defendTower, campaignComplete, campaignTotal, campaignGrade, mapRows, towersDefended } from './towers.js';
import { loadSave, storeSave, recordTower, recordCampaign, clearSave } from './save.js';
import { Particles } from './particles.js';
import * as audio from './audio.js';
import * as ui from './ui.js';
import { bindInput } from './input.js';

const VERSION = 'glasskeep-v2.1.0';

// ---------------------------------------------------------------- state

let screen = 'start'; // start | map | intro | play | craft | draft | pause | towerWin | campaignWin | defeat
let save = loadSave();
let campaign = newCampaign(save);
let state = null; // the tower run, or null outside a run
let tower = TOWERS[0];
let particles = new Particles();
let beamAnim = null; // { path, at } while the fired beam is visible
let banner = null; // { text, at } while a chain banner shows
let selected = null; // keyboard cursor {c, r}
let hoverCell = null;
let undoSnapshot = null; // { mirrors, editsUsed } — one edit back
let draftOffers = [];
let runSeed = 0; // seeds the particle bursts (visual determinism)

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

// ---------------------------------------------------------------- run setup

/** A fresh run of a tower: hearts, score, Embers and relics all reset. */
function newRun(t) {
  return {
    tower: t,
    board: createBoard(t),
    moths: [],
    assaultIndex: 0,
    turn: 1,
    hearts: START_HEARTS,
    maxHearts: START_MAX_HEARTS,
    score: 0,
    embers: 0,
    embersSpent: 0,
    embersEarned: 0,
    relics: [],
    craftsBought: [],
    placingMirror: false,
    editsUsed: 0,
    kills: 0,
    shotsFired: 0,
  };
}

/** Begin an assault: spawn its moths, grant Ember Heart embers, announce a boss. */
function startAssault(index) {
  state.assaultIndex = index;
  state.moths = placeAssault(tower, index);
  state.editsUsed = 0;
  undoSnapshot = null;
  const startEmbers = assaultStartEmbers(state.relics);
  if (startEmbers > 0) {
    state.embers += startEmbers;
    state.embersEarned += startEmbers;
  }
  const bannerText = bossBanner(tower, index);
  if (bannerText) {
    banner = { text: bannerText, at: performance.now() };
    audio.playBreach();
  }
  refresh();
  if (state.placingMirror) {
    ui.setHint('Place your new mirror — tap an empty cell.');
  } else if (index === 0 && state.turn === 1) {
    ui.setHint('Tap a mirror to flip it, drag it to move it — then press FIRE.');
  } else {
    ui.setHint(`Assault ${index + 1} of 3 — the moths advance after every shot.`);
  }
}

/** Refresh the HUD and boss bar from the run state. */
function refresh() {
  if (!state) return;
  ui.updateHUD(state, tower, save);
  ui.showBossBar(livingBoss(state.moths));
}

// ---------------------------------------------------------------- screens

function showStart() {
  screen = 'start';
  state = null;
  ui.showOverlay('startOverlay');
  const best = save.campaignBest > 0 ? `Best campaign: ${save.campaignBest}${save.campaignGrade ? ` (grade ${save.campaignGrade})` : ''}` : 'No campaign yet — defend all four towers.';
  ui.el('startBest').textContent = best;
}

function showMap() {
  screen = 'map';
  state = null;
  ui.renderMap(mapRows(campaign), towersDefended(campaign), startTower, resetProgress);
  ui.showOverlay('mapOverlay');
  ui.setHint('Pick a tower to defend.');
}

function resetProgress() {
  save = clearSave();
  campaign = newCampaign(save);
  showMap();
}

/** After a tower win: go to the next undefended tower's intro. */
function nextTower() {
  const idx = TOWERS.findIndex((t) => t.id === tower.id);
  for (let i = 1; i <= TOWERS.length; i++) {
    const candidate = TOWERS[(idx + i) % TOWERS.length];
    if (!campaign.defended.has(candidate.id)) {
      startTower(candidate.id);
      return;
    }
  }
  showMap(); // all defended — the campaign win normally fires first
}

function startTower(towerId) {
  tower = towerById(towerId);
  screen = 'intro';
  const foes = [...new Set(tower.assaults.flatMap((a) => [...a.moths, a.boss].filter(Boolean)))]
    .map((t) => (t === 'guardian' ? tower.assaults[2].bossName : t === 'grand' ? 'The Grand Moth' : t[0].toUpperCase() + t.slice(1) + ' Moth'))
    .join(' · ');
  ui.renderIntro(tower, foes, beginRun, showMap);
  ui.showOverlay('introOverlay');
  audio.playClick();
}

function beginRun() {
  state = newRun(tower);
  screen = 'play';
  ui.hideOverlays();
  particles = new Particles();
  beamAnim = null;
  banner = null;
  selected = null; // the cursor appears only after a tap or an arrow key
  startAssault(0);
  audio.playClick();
}

// ---------------------------------------------------------------- turns

/** Try one mirror edit. Returns true when the edit was made. */
function tryEdit(edit) {
  if (screen !== 'play' || !state) return false;
  if (state.placingMirror) {
    ui.setHint('Place your new mirror first — tap an empty cell.');
    return false;
  }
  if (state.editsUsed >= editsPerTurn(state.relics)) {
    ui.setHint('No edits left this turn — press FIRE.');
    return false;
  }
  undoSnapshot = { mirrors: { ...state.board.mirrors }, editsUsed: state.editsUsed };
  applyEdit(state.board, edit);
  state.editsUsed++;
  audio.playFlip();
  refresh();
  return true;
}

/** Undo the last edit (one level, this turn only). */
function undoEdit() {
  if (screen !== 'play' || !undoSnapshot) return;
  state.board.mirrors = undoSnapshot.mirrors;
  state.editsUsed = undoSnapshot.editsUsed;
  undoSnapshot = null;
  audio.playClick();
  refresh();
}

/** FIRE: resolve the shot, show the feedback, then advance the game. */
function fire() {
  if (screen !== 'play' || !state) return;
  if (state.placingMirror) {
    ui.setHint('Place your new mirror first — tap an empty cell.');
    return;
  }
  const report = applyShot(state);
  runSeed += 1;
  beamAnim = { path: report.path, at: performance.now() };
  undoSnapshot = null;

  // Feedback: sparks and floating scores at each kill, sounds, banner.
  if (report.kills.length > 0) {
    audio.playKill();
    for (const moth of report.kills) {
      const p = cellCentre(moth.c, moth.r);
      particles.burst(p.x, p.y, '#ffd76a', runSeed * 31 + moth.c * 7 + moth.r, 12);
      particles.floatText(p.x, p.y - 18, `+${mothScore(moth)}`);
    }
  } else if (report.damageDealt > 0) {
    audio.playHit();
  } else {
    audio.playFire();
  }
  if (report.reflections > 0) {
    const p = cellCentre(state.board.emitterCol, 5);
    particles.floatText(p.x, p.y, `+${report.reflections * 5} reflections`);
  }
  if (report.chainKills >= 2) {
    banner = { text: `CHAIN ×${report.chainKills + 1}!`, at: performance.now() };
  }
  if (report.breached.length > 0) {
    audio.playBreach();
    banner = { text: report.breached.length > 1 ? 'THE LINE IS BREACHED!' : 'A MOTH BROKE THROUGH!', at: performance.now() };
  }
  state.embersEarned += report.embers;
  refresh();

  if (state.hearts <= 0) {
    defeat();
    return;
  }
  if (assaultCleared(state)) {
    assaultWon();
    return;
  }
  state.turn++;
  state.editsUsed = 0;
  refresh();
  ui.setHint(state.turn === 2 ? 'The moths advance after every shot — keep the line.' : `Turn ${state.turn} — flip, move, FIRE.`);
}

/** Points for one kill (the moth's own score; chain and reflection bonuses
 *  are added separately by the rules). */
function mothScore(moth) {
  const def = { silk: 10, iron: 25, powder: 15, warden: 30, guardian: 50, grand: 100 };
  return def[moth.type] ?? 10;
}

// ---------------------------------------------------------------- between assaults

/** An assault was cleared: pay the clear bonus, then craft, draft, next. */
function assaultWon() {
  const bonus = assaultClearEmbers(state.relics);
  state.embers += bonus;
  state.embersEarned += bonus;
  audio.playWin();
  if (state.assaultIndex >= 2) {
    towerWon();
    return;
  }
  state.craftsBought = [];
  screen = 'craft';
  ui.renderCraft(state, buyCraftChoice, craftDone);
  ui.showOverlay('craftOverlay');
  ui.setHint('Spend Embers on crafts — or press Done to keep them (they convert to score).');
}

/** Buy one craft and re-render the craft screen. */
function buyCraftChoice(craftId) {
  if (buyCraft(state, craftId)) {
    audio.playCraft();
    ui.renderCraft(state, buyCraftChoice, craftDone);
    refresh();
    if (state.placingMirror) ui.setHint('Spare Mirror bought — place it on the board after the draft.');
  }
}

/** Done crafting: on to the relic draft. */
function craftDone() {
  screen = 'draft';
  draftOffers = draftOffer(tower, state.assaultIndex, state.relics);
  ui.renderDraft(draftOffers, draftPick);
  ui.showOverlay('draftOverlay');
  ui.setHint('Choose a relic — it stays with you for the rest of this tower.');
  audio.playClick();
}

/** Pick a relic, then start the next assault. */
function draftPick(relicId) {
  if (applyRelic(state, relicId)) {
    campaign.allRelics = campaign.allRelics ?? new Set();
    campaign.allRelics.add(relicId);
    audio.playDraft();
  }
  screen = 'play';
  ui.hideOverlays();
  startAssault(state.assaultIndex + 1);
}

// ---------------------------------------------------------------- endings

/** The tower is defended: bank the end bonus, grade the run, save it. */
function towerWon() {
  const bonus = towerEndBonus(state);
  state.score += bonus;
  const grade = gradeFor(tower, gradeScore(state));
  recordTower(save, tower.id, state.score, grade, true);
  storeSave(save);
  defendTower(campaign, tower.id, state.score, grade);
  audio.playWin();
  if (campaignComplete(campaign)) {
    campaignWon();
    return;
  }
  screen = 'towerWin';
  ui.renderTowerWin({
    tower, grade, score: state.score, kills: state.kills, turn: state.turn,
    hearts: state.hearts, embersEarned: state.embersEarned, embersSpent: state.embersSpent,
    relicNames: state.relics.map((id) => relicById(id)?.name ?? id),
  }, nextTower, showMap);
  ui.showOverlay('towerWinOverlay');
  ui.setHint('Tower defended — on to the next.');
}

/** All four towers defended: the campaign victory screen. */
function campaignWon() {
  const total = campaignTotal(campaign);
  const grade = campaignGrade(campaign);
  recordCampaign(save, total, grade);
  storeSave(save);
  screen = 'campaignWin';
  ui.renderCampaignWin({
    grade, total,
    rows: TOWERS.map((t) => ({
      name: t.name,
      grade: campaign.results[t.id]?.grade ?? save.towers[t.id]?.bestGrade ?? 'C',
      score: campaign.results[t.id]?.score ?? save.towers[t.id]?.best ?? 0,
    })),
    relicNames: [...(campaign.allRelics ?? [])].map((id) => relicById(id)?.name ?? id),
  }, showMap, playAgain);
  ui.showOverlay('campaignWinOverlay');
  ui.setHint('All four towers defended.');
}

/** After a campaign win: play again from the first tower. */
function playAgain() {
  startTower(TOWERS[0].id);
}

/** The tower fell: save the best score, show the defeat screen. */
function defeat() {
  const grade = gradeFor(tower, gradeScore(state));
  recordTower(save, tower.id, state.score, grade, false);
  storeSave(save);
  audio.playLose();
  const tips = [
    'Chain kills bank bonus score — line the beam through several moths at once.',
    'Kill a Warden first: its shield falls with it, and the moths beside it can be hit.',
    'Powder moths burst — shoot one beside a cluster and let the blast do the work.',
    'The Grand Moth costs two hearts. Never let it reach the line.',
    'Spend Embers between assaults: a spare mirror or a mended heart turns a run.',
  ];
  const tip = tips[(tower.seed + state.assaultIndex) % tips.length];
  screen = 'defeat';
  ui.renderDefeat({
    tower, assaultIndex: state.assaultIndex, score: state.score, kills: state.kills, turn: state.turn, tip,
  }, beginRun, showMap);
  ui.showOverlay('defeatOverlay');
  ui.setHint('The tower has fallen — try again, or pick another tower.');
}

// ---------------------------------------------------------------- pause

function togglePause() {
  if (screen === 'play') {
    screen = 'pause';
    ui.showOverlay('pauseOverlay');
    audio.playClick();
  } else if (screen === 'pause') {
    screen = 'play';
    ui.hideOverlays();
    audio.playClick();
  }
}

// ---------------------------------------------------------------- input wiring

bindInput(canvas, {
  onTapCell(c, r) {
    if (screen !== 'play' || !state) return;
    selected = { c, r };
    const key = cellKey(c, r);
    if (state.placingMirror) {
      if (placeSpareMirror(state, c, r)) {
        audio.playCraft();
        ui.setHint('Mirror placed — flip, move, FIRE.');
        refresh();
      } else {
        ui.setHint('That cell is taken — pick an empty one.');
      }
      return;
    }
    if (state.board.mirrors[key]) tryEdit({ kind: 'flip', c, r });
    else ui.setHint('Tap a mirror to flip it — or drag a mirror to move it.');
  },
  onDrag(fromC, fromR, toC, toR) {
    if (screen !== 'play' || !state) return;
    const key = cellKey(fromC, fromR);
    if (!state.board.mirrors[key]) return;
    const toKey = cellKey(toC, toR);
    if (state.board.mirrors[toKey] || state.board.buttresses.has(toKey)) {
      ui.setHint('A mirror cannot move there.');
      return;
    }
    tryEdit({ kind: 'move', fromC, fromR, toC, toR });
  },
  onHover(cell) {
    hoverCell = cell;
  },
  onFire: fire,
  onUndo: undoEdit,
  onPause: togglePause,
  onMute() {
    const m = audio.toggleMute();
    ui.el('soundBtn').textContent = m ? '🔇 Sound' : '🔊 Sound';
  },
  onCursorMove(dc, dr) {
    if (screen !== 'play') return;
    if (!selected) selected = { c: tower.emitterCol, r: 3 };
    selected = {
      c: Math.min(6, Math.max(0, selected.c + dc)),
      r: Math.min(6, Math.max(0, selected.r + dr)),
    };
  },
  onCursorFlip() {
    if (screen !== 'play' || !selected) return;
    const key = cellKey(selected.c, selected.r);
    if (state.board.mirrors[key]) tryEdit({ kind: 'flip', c: selected.c, r: selected.r });
  },
});

// Buttons.
ui.el('startBtn').addEventListener('click', () => { audio.playClick(); showMap(); });
ui.el('soundBtn').addEventListener('click', () => {
  const m = audio.toggleMute();
  ui.el('soundBtn').textContent = m ? '🔇 Sound' : '🔊 Sound';
});
ui.el('fireBtn').addEventListener('click', fire);
ui.el('undoBtn').addEventListener('click', undoEdit);
ui.el('pauseBtn').addEventListener('click', togglePause);
ui.el('resumeBtn').addEventListener('click', togglePause);
ui.el('restartBtn').addEventListener('click', () => { audio.playClick(); beginRun(); });
ui.el('quitBtn').addEventListener('click', () => { audio.playClick(); showMap(); });

// ---------------------------------------------------------------- animation loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  particles.update(dt);
  if (state && (screen === 'play' || screen === 'pause' || screen === 'craft' || screen === 'draft')) {
    const preview = screen === 'play' ? traceBeam(state.board, state.moths) : null;
    drawScene(ctx, { state, tower, time: now, preview, beamAnim, banner, particles, selected, hoverCell, screen });
  } else {
    // No run active: paint the margin scene behind the overlay.
    drawBackground(ctx, CANVAS_W, CANVAS_H, TOWERS[0].palette, 1, BOARD);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- inspector (read-only)

window.GLASSKEEP = {
  version: VERSION,
  traceBeam() { return state ? traceBeam(state.board, state.moths) : null; },
  boardGeometry: BOARD,
  cellCentre,
  getState() {
    if (!state) return { screen, towerId: null };
    return {
      screen,
      towerId: tower.id,
      assaultIndex: state.assaultIndex,
      turn: state.turn,
      hearts: state.hearts,
      maxHearts: state.maxHearts,
      score: state.score,
      embers: state.embers,
      relics: [...state.relics],
      placingMirror: state.placingMirror,
      editsUsed: state.editsUsed,
      editsPerTurn: editsPerTurn(state.relics),
      mirrors: { ...state.board.mirrors },
      buttresses: [...state.board.buttresses],
      emitterCol: state.board.emitterCol,
      moths: state.moths.map((m) => ({ id: m.id, type: m.type, name: m.name, c: m.c, r: m.r, hp: m.hp, maxHp: m.maxHp })),
    };
  },
};

// ---------------------------------------------------------------- boot

showStart();
requestAnimationFrame(frame);
