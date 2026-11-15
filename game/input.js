// GLASSKEEP v2 — input.js: pointer and keyboard input.
//
// One module for every way the player touches the game: tap/click a mirror
// to flip it, drag a mirror to move it, tap an empty cell to place a spare
// mirror, and the keyboard (arrows/WASD move the cursor, Space flips, F
// fires, U undoes, P pauses, M mutes). Pointer events unify mouse and
// touch, so the game plays the same on Saheed's phone as on desktop.
//
// The module reports gestures to main.js through callbacks; it owns no
// game state. A tap is a press and release within 10px and 400ms; anything
// further is a drag from the press cell to the release cell.

import { cellAt } from './render.js';

/** Bind input on the canvas and the document. `h` is the handler set:
 *  onTapCell(c,r), onDrag(fromC,fromR,toC,toR), onHover(c,r|null),
 *  onFire(), onUndo(), onPause(), onMute(), onCursorMove(dc,dr),
 *  onCursorFlip(). Returns an unbind function (unused by the game, kept
 *  for completeness). */
export function bindInput(canvas, h) {
  let press = null; // {c, r, x, y, at}
  let hover = null;

  const toCanvas = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = toCanvas(e);
    const cell = cellAt(p.x, p.y);
    if (!cell) return;
    press = { ...cell, x: p.x, y: p.y, at: Date.now() };
    canvas.setPointerCapture?.(e.pointerId);
  };

  const onUp = (e) => {
    if (!press) return;
    const p = toCanvas(e);
    const cell = cellAt(p.x, p.y);
    const moved = Math.hypot(p.x - press.x, p.y - press.y);
    const held = Date.now() - press.at;
    if (cell && (moved > 10 || held > 400) && (cell.c !== press.c || cell.r !== press.r)) {
      h.onDrag(press.c, press.r, cell.c, cell.r);
    } else if (cell) {
      h.onTapCell(cell.c, cell.r);
    }
    press = null;
  };

  const onMove = (e) => {
    const p = toCanvas(e);
    const cell = cellAt(p.x, p.y);
    const key = cell ? `${cell.c},${cell.r}` : null;
    if (key !== hover) {
      hover = key;
      h.onHover(cell);
    }
  };

  const onLeave = () => {
    if (hover !== null) {
      hover = null;
      h.onHover(null);
    }
  };

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { h.onCursorMove(0, -1); e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { h.onCursorMove(0, 1); e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'a') { h.onCursorMove(-1, 0); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { h.onCursorMove(1, 0); e.preventDefault(); }
    else if (k === ' ' || k === 'enter') { h.onCursorFlip(); e.preventDefault(); }
    else if (k === 'f') h.onFire();
    else if (k === 'u') h.onUndo();
    else if (k === 'p' || k === 'escape') h.onPause();
    else if (k === 'm') h.onMute();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  document.addEventListener('keydown', onKey);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('keydown', onKey);
  };
}
