// GLASSKEEP v2 — render.js: painting the game on the canvas.
//
// The canvas is 700 x 720. The board (7x7, 62px cells) sits centred with a
// stained-glass margin scene around it (background.js). Draw order: margin
// art, board frame and cells, buttresses, mirrors, emitter, moths, beam
// (faint preview always on; bright fired beam briefly), particles, banners.
// The preview is the same trace the shot uses (rules.traceBeam), so what
// the player sees is exactly what FIRE will do.

import { COLS, ROWS } from './content.js';
import { cellKey } from './rules.js';
import { drawBackground } from './background.js';
import { drawMoth } from './moths.js';
import { isShielded } from './rules.js';

export const CANVAS_W = 700;
export const CANVAS_H = 720;

/** The board's pixel geometry: origin, cell size, total size. Exported for
 *  the read-only inspector (and the QA harness's real-UI clicks). */
export const BOARD = { x: 133, y: 140, cell: 62, size: 434 };

/** Centre of cell (c, r) in canvas pixels. */
export function cellCentre(c, r) {
  return { x: BOARD.x + c * BOARD.cell + BOARD.cell / 2, y: BOARD.y + r * BOARD.cell + BOARD.cell / 2 };
}

/** Which cell (if any) a canvas point falls in. */
export function cellAt(px, py) {
  const c = Math.floor((px - BOARD.x) / BOARD.cell);
  const r = Math.floor((py - BOARD.y) / BOARD.cell);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { c, r };
}

/** Draw a mirror: a faceted glass pane with a brass frame, angled per its
 *  orientation. '/' runs bottom-left to top-right; '\\' the other way. */
function drawMirror(ctx, x, y, orientation, cell, palette) {
  const len = cell * 0.78;
  const wid = cell * 0.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(orientation === '/' ? -Math.PI / 4 : Math.PI / 4);
  // Brass frame.
  ctx.fillStyle = '#8a6a2a';
  ctx.fillRect(-len / 2 - 2, -wid / 2 - 2, len + 4, wid + 4);
  // Glass face: a light gradient.
  const g = ctx.createLinearGradient(0, -wid / 2, 0, wid / 2);
  g.addColorStop(0, '#eaf6ff');
  g.addColorStop(0.5, '#bcd8ea');
  g.addColorStop(1, '#7fa8c8');
  ctx.fillStyle = g;
  ctx.fillRect(-len / 2, -wid / 2, len, wid);
  // A bright diagonal streak (the glass catching the light).
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(-len / 2 + 3, -wid / 2 + 2, len * 0.45, 2);
  ctx.restore();
}

/** Draw a buttress: a dark carved stone block that stops the beam. */
function drawButtress(ctx, x, y, cell) {
  const s = cell * 0.8;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#241d2e';
  ctx.strokeStyle = '#4a3f5e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, 6);
  ctx.fill();
  ctx.stroke();
  // Carved diamond inlay.
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.28);
  ctx.lineTo(s * 0.28, 0);
  ctx.lineTo(0, s * 0.28);
  ctx.lineTo(-s * 0.28, 0);
  ctx.closePath();
  ctx.strokeStyle = '#6a5a84';
  ctx.stroke();
  ctx.restore();
}

/** Draw the emitter: a brass lantern at the bottom of its column. */
function drawEmitter(ctx, x, y, cell, palette, time) {
  const glow = 0.75 + Math.sin(time / 350) * 0.25;
  const g = ctx.createRadialGradient(x, y, 2, x, y, cell * 0.9);
  g.addColorStop(0, `rgba(255, 214, 106, ${0.5 * glow})`);
  g.addColorStop(1, 'rgba(255, 214, 106, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a6a2a';
  ctx.beginPath();
  ctx.roundRect(x - 13, y - 16, 26, 32, 5);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.roundRect(x - 9, y - 12, 18, 24, 4);
  ctx.fill();
  ctx.fillStyle = '#8a6a2a';
  ctx.fillRect(x - 4, y - 22, 8, 7);
  ctx.fillRect(x - 14, y + 16, 28, 4);
}

/** Draw a beam path: a polyline through cell centres, from the emitter to
 *  the path's end. `bright` is the fired beam (glow + wide); otherwise the
 *  faint always-on preview (dashed). */
function drawBeam(ctx, path, emitter, bright, palette) {
  if (path.length === 0) return;
  const points = [emitter, ...path.map((p) => cellCentre(p.c, p.r))];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (bright) {
    ctx.shadowColor = palette.beam;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = palette.beam;
    ctx.lineWidth = 5;
  } else {
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255, 220, 130, 0.55)';
    ctx.lineWidth = 2.5;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

/** Draw the whole scene. `view` carries the run state, the tower, the
 *  preview trace, the fired-beam animation, the particles, the selection
 *  and the clock (for visual-only animation). */
export function drawScene(ctx, view) {
  const { state, tower, time } = view;
  const palette = tower.palette;
  drawBackground(ctx, CANVAS_W, CANVAS_H, palette, tower.seed, BOARD);

  // Board frame: a brass-bound stained-glass panel.
  ctx.save();
  ctx.fillStyle = 'rgba(12, 8, 18, 0.88)';
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(BOARD.x - 10, BOARD.y - 10, BOARD.size + 20, BOARD.size + 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Cells: alternating glass panes, faint lead lines.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD.x + c * BOARD.cell;
      const y = BOARD.y + r * BOARD.cell;
      ctx.fillStyle = (c + r) % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.015)';
      ctx.fillRect(x, y, BOARD.cell, BOARD.cell);
      ctx.strokeStyle = 'rgba(200,170,110,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, BOARD.cell - 1, BOARD.cell - 1);
    }
  }
  // The bottom line: a red-gold threshold the moths must not cross.
  ctx.fillStyle = 'rgba(200, 74, 58, 0.35)';
  ctx.fillRect(BOARD.x, BOARD.y + (ROWS - 1) * BOARD.cell, BOARD.size, 3);
  ctx.fillStyle = 'rgba(255, 120, 90, 0.7)';
  ctx.font = '600 10px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText('THE LINE', BOARD.x + BOARD.size - 4, BOARD.y + BOARD.size - 6);

  // Buttresses, then mirrors, then the emitter.
  for (const key of state.board.buttresses) {
    const [c, r] = key.split(',').map(Number);
    const p = cellCentre(c, r);
    drawButtress(ctx, p.x, p.y, BOARD.cell);
  }
  for (const [key, orientation] of Object.entries(state.board.mirrors)) {
    const [c, r] = key.split(',').map(Number);
    const p = cellCentre(c, r);
    drawMirror(ctx, p.x, p.y, orientation, BOARD.cell, palette);
  }
  const emitter = cellCentre(state.board.emitterCol, ROWS - 1);
  drawEmitter(ctx, emitter.x, emitter.y + 8, BOARD.cell, palette, time);

  // The aiming preview (always on while playing) and the fired beam.
  if (view.screen === 'play' && view.preview) {
    drawBeam(ctx, view.preview.path, { x: emitter.x, y: emitter.y - 8 }, false, palette);
  }
  if (view.beamAnim) {
    const age = (time - view.beamAnim.at) / 1000;
    if (age < 0.7) {
      ctx.globalAlpha = 1 - age / 0.7;
      drawBeam(ctx, view.beamAnim.path, { x: emitter.x, y: emitter.y - 8 }, true, palette);
      ctx.globalAlpha = 1;
    }
  }

  // Moths, with a slow wing flap (visual only).
  const flap = Math.sin(time / 280) * 0.5;
  for (const moth of state.moths) {
    const p = cellCentre(moth.c, moth.r);
    const shielded = isShielded(moth, state.moths, state.relics);
    drawMoth(ctx, moth, p.x, p.y, BOARD.cell * 0.86, { flap, shielded });
  }

  // Selection highlight (keyboard cursor) and the spare-mirror target hint.
  if (view.selected) {
    const p = cellCentre(view.selected.c, view.selected.r);
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(p.x - BOARD.cell / 2 + 3, p.y - BOARD.cell / 2 + 3, BOARD.cell - 6, BOARD.cell - 6, 6);
    ctx.stroke();
  }
  if (state.placingMirror && view.hoverCell) {
    const p = cellCentre(view.hoverCell.c, view.hoverCell.r);
    ctx.fillStyle = 'rgba(255, 233, 168, 0.25)';
    ctx.beginPath();
    ctx.roundRect(p.x - BOARD.cell / 2 + 4, p.y - BOARD.cell / 2 + 4, BOARD.cell - 8, BOARD.cell - 8, 6);
    ctx.fill();
  }

  // Particles and floating texts.
  view.particles.draw(ctx);

  // Banner: a transient shout (boss awakening, chain, breach), above the
  // board. A dark backing plate keeps it legible over the rose window and
  // the board art; it holds full opacity, then fades in the last stretch
  // of its 1400 ms life, so the words are always readable while shown.
  if (view.banner && time - view.banner.at < 1400) {
    const age = time - view.banner.at;
    const alpha = age < 800 ? 1 : 1 - (age - 800) / 600;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 30px Georgia, serif';
    ctx.textAlign = 'center';
    const bx = CANVAS_W / 2;
    const by = BOARD.y - 46;
    const bw = ctx.measureText(view.banner.text).width;
    ctx.fillStyle = 'rgba(10, 6, 16, 0.82)';
    ctx.beginPath();
    ctx.roundRect(bx - bw / 2 - 18, by - 34, bw + 36, 46, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 233, 168, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.shadowColor = '#c89020';
    ctx.shadowBlur = 14;
    ctx.fillText(view.banner.text, bx, by);
    ctx.restore();
  }
}
