// GLASSKEEP — lifecycle controller: input, screens, persistence, sound wiring.
// Owns the DOM; the rules in rules.js own the game; render.js owns the canvas.
// A small debug handle (window.GLASSKEEP) exposes the game's own functions so
// automated playtests can drive the real game through its real logic.

import {
  createGame,
  startRun,
  traceBeam,
  flipMirror,
  moveMirror,
  undoEdit,
  fire,
  chooseUpgrade,
  nextSpawns,
  waveCleared,
  scoreBreakdown,
  inBoard,
} from './rules.js';
import { BOARD_SIZE, TOTAL_WAVES, MAX_HEARTS } from './content.js';
import {
  render,
  createView,
  burstAt,
  addPopup,
  addRing,
  CELL,
  OX,
  OY,
  CANVAS_W,
  CANVAS_H,
} from './render.js';
import * as sfx from './audio.js';

const BEST_KEY = 'glasskeep.best.v1';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

function readSeed() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('seed');
  const n = raw === null ? null : Number.parseInt(raw, 10);
  if (n !== null && Number.isFinite(n) && n >= 0) return n;
  // No seed given: derive one from the clock so every run still has a seed.
  return Math.floor(Date.now() / 1000) % 100000;
}

let state = createGame(readSeed());
let view = createView();

function loadBest() {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const best = JSON.parse(raw);
    if (typeof best.score !== 'number') return null;
    return best;
  } catch {
    return null;
  }
}

function saveBest() {
  const prev = loadBest();
  const next = {
    score: state.score,
    wave: state.wave,
    chain: state.bestChain,
    schedule: state.scheduleName,
    date: new Date().toISOString().slice(0, 10),
  };
  if (!prev || next.score > prev.score) {
    try {
      window.localStorage.setItem(BEST_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, file://): the game still plays.
    }
    return { best: next, isNew: true };
  }
  return { best: prev, isNew: false };
}

function bestLine(best) {
  if (!best) return 'No runs yet — set the first best.';
  return `Best ${best.score} · Wave ${best.wave} · Chain ${best.chain} · ${best.schedule}`;
}

// ---------------------------------------------------------------------------
// HUD and screens
// ---------------------------------------------------------------------------

function heartsText() {
  return '♥'.repeat(state.hearts) + '♡'.repeat(Math.max(0, MAX_HEARTS - state.hearts));
}

function updateHud() {
  $('hud-wave').textContent = `Wave ${state.wave}/${TOTAL_WAVES}`;
  $('hud-turn').textContent = `Turn ${state.turn + 1}`;
  $('hud-hearts').textContent = heartsText();
  $('hud-hearts').classList.toggle('low', state.hearts === 1);
  $('hud-score').textContent = `Score ${state.score}`;
  $('hud-edits').textContent = state.editsLeft > 0 ? '✦ Edit ready' : '✦ Edit used';
  $('hud-edits').classList.toggle('spent', state.editsLeft === 0);
  const best = loadBest();
  $('hud-best').textContent = best ? `Best ${best.score}` : 'Best —';
  $('btn-fire').disabled = state.phase !== 'playing' || state.paused;
  $('btn-undo').disabled =
    state.phase !== 'playing' || state.paused || state.firedThisTurn || state.editsLeft >= 1;
  $('hint').classList.toggle('hidden', state.phase !== 'playing' || state.kills > 0 || state.turn > 0);
}

function showOverlay(id) {
  for (const panel of document.querySelectorAll('.overlay')) panel.classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

function showStart() {
  state.phase = 'title';
  $('start-seed').textContent = `Tower ${state.scheduleName} · Seed ${state.seed}`;
  $('start-best').textContent = bestLine(loadBest());
  showOverlay('overlay-start');
  updateHud();
}

function showVictory() {
  const bd = scoreBreakdown(state);
  const saved = saveBest();
  $('victory-score').textContent = `Score ${bd.total}`;
  $('victory-breakdown').innerHTML =
    `Moths shattered ${bd.kills} · Best chain ${bd.bestChain} in one shot<br>` +
    `Hearts standing ${bd.heartsLeft} · Intact-core bonus +${bd.intactBonus}<br>` +
    `Moths breached ${bd.breached} · Tower ${state.scheduleName} · Seed ${state.seed}`;
  $('victory-best').textContent =
    (saved.isNew ? '★ NEW BEST — ' : '') + bestLine(saved.best);
  showOverlay('overlay-victory');
  updateHud();
}

function showDefeat() {
  const saved = saveBest();
  $('defeat-score').textContent = `Score ${state.score}`;
  $('defeat-detail').textContent =
    `Three moths breached the red line — the core is shattered. ` +
    `Wave ${state.wave} of ${TOTAL_WAVES} · ${state.kills} moths shattered · ` +
    `Tower ${state.scheduleName} · Seed ${state.seed}`;
  $('defeat-best').textContent =
    (saved.isNew && state.score > 0 ? '★ NEW BEST — ' : '') + bestLine(saved.best);
  showOverlay('overlay-defeat');
  updateHud();
}

function showUpgrade() {
  const box = $('upgrade-choices');
  box.innerHTML = '';
  for (const up of state.upgradeOffer) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.innerHTML = `<span class="choice-name">${up.name}</span><span class="choice-blurb">${up.blurb}</span>`;
    btn.addEventListener('click', () => {
      sfx.playClick();
      chooseUpgrade(state, up.key);
      showOverlay(null);
      updateHud();
    });
    box.appendChild(btn);
  }
  $('upgrade-hearts').textContent = `Core ${heartsText()} · Mirrors ${state.mirrors.length}`;
  showOverlay('overlay-upgrade');
  updateHud();
}

function showPause() {
  showOverlay('overlay-pause');
  updateHud();
}

function hidePause() {
  state.paused = false;
  showOverlay(null);
  updateHud();
}

// ---------------------------------------------------------------------------
// Firing — the one place rules.fire is called
// ---------------------------------------------------------------------------

function doFire() {
  if (state.phase !== 'playing' || state.paused) return;
  const result = fire(state);
  if (!result) return;
  const { events, outcome } = result;
  view.flashUntil = performance.now() + 700;
  sfx.playFire();
  // Impact feedback at every kill and every wound.
  for (const kill of events.killed) {
    const color = kill.type === 'explosive' ? '#ff6b4d' : '#ffd97a';
    burstAt(view, kill.x, kill.y, color, kill.type === 'explosive' ? 22 : 12);
    addRing(view, kill.x, kill.y, color);
    addPopup(view, kill.x, kill.y, `+${kill.type === 'armoured' ? 25 : kill.type === 'explosive' ? 15 : 10}`, color);
  }
  for (const dmg of events.damaged) {
    addRing(view, dmg.x, dmg.y, '#9fb4d6');
  }
  if (events.killed.length > 0) sfx.playKill();
  else if (events.damaged.length > 0) sfx.playHit();
  if (events.chain > 1) {
    addPopup(view, 3, 1, `CHAIN ×${events.chain}!`, '#fff3c4');
  }
  if (events.shotScore > 0) {
    addPopup(view, 3, 0, `+${events.shotScore}`, '#ffd97a');
  }
  if (events.breached.length > 0) {
    sfx.playBreach();
    addPopup(view, 3, 6, 'BREACH!', '#ff6b6b');
  }
  updateHud();
  if (outcome === 'victory') {
    sfx.playWin();
    showVictory();
  } else if (outcome === 'defeat') {
    sfx.playLose();
    showDefeat();
  } else if (outcome === 'upgrade') {
    showUpgrade();
  }
}

// ---------------------------------------------------------------------------
// Canvas input — drag to relocate, click to flip
// ---------------------------------------------------------------------------

function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    px: ((ev.clientX - rect.left) / rect.width) * CANVAS_W,
    py: ((ev.clientY - rect.top) / rect.height) * CANVAS_H,
  };
}

function cellAt(px, py) {
  const x = Math.floor((px - OX) / CELL);
  const y = Math.floor((py - OY) / CELL);
  return inBoard(x, y) ? { x, y } : null;
}

function mirrorAtCell(cell) {
  if (!cell) return null;
  return state.mirrors.find((m) => m.x === cell.x && m.y === cell.y) || null;
}

let drag = null; // { mirror, startX, startY, moved }

canvas.addEventListener('pointerdown', (ev) => {
  if (state.phase !== 'playing' || state.paused) return;
  const { px, py } = canvasPoint(ev);
  const mirror = mirrorAtCell(cellAt(px, py));
  if (!mirror) return;
  if (state.editsLeft === 0) {
    $('hint').textContent = 'Edit already used this turn — FIRE to continue, or undo (U).';
    $('hint').classList.remove('hidden');
    return;
  }
  drag = { mirror, startX: px, startY: py, moved: false };
  view.dragMirror = { id: mirror.id, angle: mirror.angle };
  view.dragPos = { px, py };
  canvas.setPointerCapture(ev.pointerId);
});

canvas.addEventListener('pointermove', (ev) => {
  const { px, py } = canvasPoint(ev);
  if (drag) {
    if (Math.hypot(px - drag.startX, py - drag.startY) > 10) drag.moved = true;
    view.dragPos = { px, py };
    return;
  }
  const mirror = state.phase === 'playing' ? mirrorAtCell(cellAt(px, py)) : null;
  canvas.style.cursor = mirror ? 'grab' : 'default';
});

canvas.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const { px, py } = canvasPoint(ev);
  const mirror = drag.mirror;
  const wasDrag = drag.moved;
  drag = null;
  view.dragMirror = null;
  view.dragPos = null;
  if (!wasDrag) {
    // A click flips the mirror's angle.
    const res = flipMirror(state, mirror.id);
    if (res.ok) sfx.playFlip();
    updateHud();
    return;
  }
  const cell = cellAt(px, py);
  if (!cell) {
    updateHud();
    return; // dropped outside the board: the mirror stays put
  }
  const res = moveMirror(state, mirror.id, cell.x, cell.y);
  if (res.ok) sfx.playFlip();
  updateHud();
});

canvas.addEventListener('pointercancel', () => {
  drag = null;
  view.dragMirror = null;
  view.dragPos = null;
});

// ---------------------------------------------------------------------------
// Buttons and keys
// ---------------------------------------------------------------------------

$('btn-fire').addEventListener('click', () => doFire());
$('btn-undo').addEventListener('click', () => {
  const res = undoEdit(state);
  if (res.ok) sfx.playClick();
  updateHud();
});
$('btn-sound').addEventListener('click', () => {
  const muted = sfx.setMuted(!sfx.isMuted());
  $('btn-sound').textContent = muted ? '🔇 Muted' : '🔊 Sound';
  $('btn-sound').setAttribute('aria-pressed', String(!muted));
  if (!muted) sfx.playClick();
});
$('btn-start').addEventListener('click', () => {
  sfx.playClick();
  startRun(state);
  showOverlay(null);
  updateHud();
});
$('btn-retry').addEventListener('click', () => {
  sfx.playClick();
  state = createGame(state.seed);
  startRun(state);
  showOverlay(null);
  updateHud();
});
$('btn-title').addEventListener('click', () => {
  sfx.playClick();
  state = createGame(state.seed);
  showStart();
});
$('btn-newrun').addEventListener('click', () => {
  sfx.playClick();
  const seed = Math.floor(Date.now() / 1000) % 100000;
  state = createGame(seed);
  startRun(state);
  showOverlay(null);
  updateHud();
});
$('btn-resume').addEventListener('click', () => {
  sfx.playClick();
  hidePause();
});
$('btn-restart').addEventListener('click', () => {
  sfx.playClick();
  state = createGame(state.seed);
  startRun(state);
  showOverlay(null);
  updateHud();
});

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (state.phase === 'title') {
      $('btn-start').click();
    } else if (state.phase === 'playing' && !state.paused) {
      doFire();
    }
    return;
  }
  if (ev.code === 'KeyR') {
    if (state.phase === 'victory' || state.phase === 'defeat') {
      $('btn-retry').click();
    } else if (state.phase === 'playing') {
      $('btn-restart').click();
    }
    return;
  }
  if (ev.code === 'KeyU' || (ev.code === 'KeyZ' && (ev.ctrlKey || ev.metaKey))) {
    ev.preventDefault();
    const res = undoEdit(state);
    if (res.ok) sfx.playClick();
    updateHud();
    return;
  }
  if (ev.code === 'KeyP' || ev.code === 'Escape') {
    if (state.phase === 'playing') {
      state.paused = !state.paused;
      if (state.paused) showPause();
      else hidePause();
    }
    return;
  }
  if (ev.code === 'KeyM') {
    $('btn-sound').click();
  }
});

// ---------------------------------------------------------------------------
// Render loop — preview and firing share traceBeam (one function, one truth)
// ---------------------------------------------------------------------------

function frame() {
  const preview =
    state.phase === 'playing' || state.phase === 'title'
      ? { path: traceBeam(state), nextSpawns: state.phase === 'playing' ? nextSpawns(state) : [] }
      : { path: null, nextSpawns: [] };
  render(ctx, state, view, preview);
  requestAnimationFrame(frame);
}

showStart();
requestAnimationFrame(frame);

// Debug handle for automated playtests: the game's own functions, nothing else.
window.GLASSKEEP = {
  version: 'glasskeep-1.0',
  get state() {
    return state;
  },
  traceBeam,
  fire,
  flipMirror,
  moveMirror,
  undoEdit,
  chooseUpgrade,
  startRun,
  createGame,
  nextSpawns,
  waveCleared,
  scoreBreakdown,
};
