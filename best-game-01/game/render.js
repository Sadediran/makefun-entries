// GLASSKEEP — procedural stained-glass rendering (Canvas 2D, no assets).
// One coherent gothic-fantasy identity: jewel-toned leaded glass, brass
// clockwork moths, a golden beam with bloom, and a red line that cannot be
// missed. All animation here is purely visual (bob, flutter, flashes) and
// never feeds back into the deterministic rules.

import { BOARD_SIZE, EMITTER_COL } from './content.js';
import { mulberry32 } from './rules.js';

export const CELL = 96;
export const OX = 14; // board left margin inside the canvas
export const OY = 64; // board top margin (room for the emitter)
export const BOARD_PX = BOARD_SIZE * CELL;
export const CANVAS_W = BOARD_PX + OX * 2;
export const CANVAS_H = OY + BOARD_PX + 40;

const JEWELS = [
  '#3b2a7a', '#7a1f3d', '#1f4d6e', '#6e541f',
  '#2a6e3f', '#7a2a1f', '#4d1f6e', '#1f6e5a',
];
const JEWEL_LIGHT = [
  '#5a3fa8', '#a8325a', '#2f6e96', '#96742a',
  '#3f9660', '#a83f2a', '#6e2f96', '#2f9683',
];

function cellCenter(x, y) {
  return [OX + (x + 0.5) * CELL, OY + (y + 0.5) * CELL];
}

function toPx(px, py) {
  return [OX + px * CELL, OY + py * CELL];
}

// Seeded per-cell glass design: palette pair + ornament variant. Cached per seed
// so the window looks identical every run of the same seed.
const paneCache = new Map();
function panesFor(seed) {
  if (paneCache.has(seed)) return paneCache.get(seed);
  const rnd = mulberry32(seed * 7919 + 13);
  const panes = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      panes.push({
        base: JEWELS[Math.floor(rnd() * JEWELS.length)],
        light: JEWEL_LIGHT[Math.floor(rnd() * JEWEL_LIGHT.length)],
        variant: Math.floor(rnd() * 3), // 0 plain, 1 diagonal lead, 2 diamond
        glow: 0.5 + rnd() * 0.5,
      });
    }
  }
  paneCache.set(seed, panes);
  return panes;
}

export function createView() {
  return {
    time: 0,
    hoverCell: null,
    dragMirror: null, // { id, x, y } screen cell while dragging
    dragPos: null, // { px, py } pointer position while dragging
    particles: [],
    popups: [],
    flashUntil: 0, // beam flash expiry (performance.now ms)
    rings: [], // { x, y, born, color }
  };
}

export function burstAt(view, cellX, cellY, color, count) {
  const [cx, cy] = cellCenter(cellX, cellY);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 140;
    view.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
      life: 0, max: 0.5 + Math.random() * 0.4,
      size: 2 + Math.random() * 3, color,
    });
  }
}

export function addPopup(view, cellX, cellY, text, color) {
  const [cx, cy] = cellCenter(cellX, cellY);
  view.popups.push({ x: cx, y: cy - 20, text, life: 0, max: 1.1, color: color || '#ffd97a' });
}

export function addRing(view, cellX, cellY, color) {
  const [cx, cy] = cellCenter(cellX, cellY);
  view.rings.push({ x: cx, y: cy, born: view.time, color: color || '#ffd97a' });
}

// ---------------------------------------------------------------------------
// Pieces of the scene
// ---------------------------------------------------------------------------

function drawGlass(ctx, state) {
  const panes = panesFor(state.seed);
  // Deep indigo backing so the lead reads as shadow.
  const bg = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, 80, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.75,
  );
  bg.addColorStop(0, '#241a4d');
  bg.addColorStop(1, '#0d0a1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const pane = panes[y * BOARD_SIZE + x];
      const px = OX + x * CELL;
      const py = OY + y * CELL;
      const g = ctx.createRadialGradient(
        px + CELL * 0.5, py + CELL * 0.35, 6,
        px + CELL * 0.5, py + CELL * 0.5, CELL * 0.75,
      );
      g.addColorStop(0, pane.light);
      g.addColorStop(1, pane.base);
      ctx.globalAlpha = 0.55 + 0.45 * pane.glow;
      ctx.fillStyle = g;
      ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      ctx.globalAlpha = 1;
      // Leaded ornament inside the pane.
      ctx.strokeStyle = 'rgba(10, 8, 24, 0.55)';
      ctx.lineWidth = 2;
      if (pane.variant === 1) {
        ctx.beginPath();
        ctx.moveTo(px + 4, py + CELL - 4);
        ctx.lineTo(px + CELL - 4, py + 4);
        ctx.stroke();
      } else if (pane.variant === 2) {
        ctx.beginPath();
        ctx.moveTo(px + CELL / 2, py + 10);
        ctx.lineTo(px + CELL - 10, py + CELL / 2);
        ctx.lineTo(px + CELL / 2, py + CELL - 10);
        ctx.lineTo(px + 10, py + CELL / 2);
        ctx.closePath();
        ctx.stroke();
      }
      // A moth on the red-line row gets a warning tint under it.
      if (y === BOARD_SIZE - 1) {
        ctx.fillStyle = 'rgba(200, 30, 30, 0.10)';
        ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      }
    }
  }

  // Lead came grid.
  ctx.strokeStyle = '#0d0a1a';
  ctx.lineWidth = 4;
  for (let i = 0; i <= BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(OX + i * CELL, OY);
    ctx.lineTo(OX + i * CELL, OY + BOARD_PX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(OX, OY + i * CELL);
    ctx.lineTo(OX + BOARD_PX, OY + i * CELL);
    ctx.stroke();
  }

  // Gilded frame with corner flourishes.
  ctx.strokeStyle = '#c9973f';
  ctx.lineWidth = 5;
  ctx.strokeRect(OX - 6, OY - 6, BOARD_PX + 12, BOARD_PX + 12);
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 2;
  ctx.strokeRect(OX - 11, OY - 11, BOARD_PX + 22, BOARD_PX + 22);
  ctx.fillStyle = '#f5c542';
  for (const [cx, cy] of [
    [OX - 11, OY - 11], [OX + BOARD_PX + 11, OY - 11],
    [OX - 11, OY + BOARD_PX + 11], [OX + BOARD_PX + 11, OY + BOARD_PX + 11],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEmitter(ctx, state, view) {
  const [ex] = cellCenter(EMITTER_COL, 0);
  const ey = OY - 26;
  // Brass fixture.
  ctx.fillStyle = '#8a6a1f';
  ctx.beginPath();
  ctx.moveTo(ex - 26, 8);
  ctx.lineTo(ex + 26, 8);
  ctx.lineTo(ex + 16, ey - 6);
  ctx.lineTo(ex - 16, ey - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c9973f';
  ctx.beginPath();
  ctx.moveTo(ex - 16, ey - 6);
  ctx.lineTo(ex + 16, ey - 6);
  ctx.lineTo(ex + 10, ey + 8);
  ctx.lineTo(ex - 10, ey + 8);
  ctx.closePath();
  ctx.fill();
  // Glowing lens, pulsing gently.
  const pulse = 0.75 + 0.25 * Math.sin(view.time * 2.4);
  const glow = ctx.createRadialGradient(ex, ey + 2, 2, ex, ey + 2, 26 * pulse);
  glow.addColorStop(0, 'rgba(255, 230, 150, 0.95)');
  glow.addColorStop(0.4, 'rgba(245, 197, 66, 0.55)');
  glow.addColorStop(1, 'rgba(245, 197, 66, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(ex, ey + 2, 26 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(ex, ey + 2, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawRedLine(ctx, state) {
  const y = OY + BOARD_PX + 4;
  const pulse = 0.6 + 0.4 * Math.sin(state && state.phase === 'playing' ? performance.now() / 300 : 0);
  ctx.save();
  ctx.shadowColor = '#ff2a2a';
  ctx.shadowBlur = 16 * pulse;
  ctx.strokeStyle = '#ff2a2a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(OX - 4, y);
  ctx.lineTo(OX + BOARD_PX + 4, y);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ff6b6b';
  ctx.font = '700 15px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '6px';
  ctx.fillText('— RED LINE —', CANVAS_W / 2, y + 26);
  ctx.letterSpacing = '0px';
}

function drawMirrorPx(ctx, px, py, angle, highlighted, ghost) {
  const len = CELL * 0.62;
  const rot = angle === '/' ? -Math.PI / 4 : Math.PI / 4;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rot);
  if (highlighted) {
    ctx.shadowColor = '#ffd97a';
    ctx.shadowBlur = 22;
  }
  ctx.globalAlpha = ghost ? 0.45 : 1;
  // Bright reflective face: silver gradient with a hot white core.
  const grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
  grad.addColorStop(0, '#e8ecf4');
  grad.addColorStop(0.5, '#ffffff');
  grad.addColorStop(1, '#b9c4d6');
  ctx.fillStyle = grad;
  ctx.fillRect(-len / 2, -9, len, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-len / 2, -2.5, len, 5);
  // Gold end caps.
  ctx.fillStyle = '#c9973f';
  ctx.beginPath();
  ctx.arc(-len / 2, 0, 5, 0, Math.PI * 2);
  ctx.arc(len / 2, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMirror(ctx, mirror, highlighted, ghost) {
  const [cx, cy] = cellCenter(mirror.x, mirror.y);
  drawMirrorPx(ctx, cx, cy, mirror.angle, highlighted, ghost);
}

function drawMoth(ctx, enemy, view, ghost) {
  const [cx, cy] = cellCenter(enemy.x, enemy.y);
  const t = view.time;
  const bob = ghost ? 0 : Math.sin(t * 2 + enemy.id.charCodeAt(1)) * 2.5;
  const flutter = ghost ? 0 : Math.sin(t * 9 + enemy.id.charCodeAt(1)) * 0.22;
  const isArmoured = enemy.type === 'armoured';
  const isExplosive = enemy.type === 'explosive';
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.globalAlpha = ghost ? 0.28 : 1;
  // Wings: articulated brass-framed amber panes.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.rotate(side * (0.5 + flutter * 0.4));
    const wingGrad = ctx.createLinearGradient(0, -26, 0, 26);
    wingGrad.addColorStop(0, ghost ? '#ffffff' : '#e8a33d');
    wingGrad.addColorStop(1, ghost ? '#ffffff' : '#8a5a1a');
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.ellipse(side * 17, 0, 17, 24, side * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ghost ? '#ffffff' : '#5e3d10';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Wing veins.
    ctx.beginPath();
    ctx.moveTo(side * 6, 0);
    ctx.lineTo(side * 30, -14);
    ctx.moveTo(side * 6, 0);
    ctx.lineTo(side * 30, 14);
    ctx.stroke();
    ctx.restore();
  }
  // Gear teeth around the brass body.
  ctx.fillStyle = ghost ? '#ffffff' : '#8a6a1f';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 0.15;
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(13, -3, 7, 6);
    ctx.restore();
  }
  // Brass body.
  const body = ctx.createRadialGradient(-4, -5, 2, 0, 0, 15);
  body.addColorStop(0, ghost ? '#ffffff' : '#f0d089');
  body.addColorStop(1, ghost ? '#ffffff' : '#8a6a1f');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ghost ? '#ffffff' : '#5e3d10';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Armoured plating: steel arc, rivets, and hp pips.
  if (isArmoured) {
    ctx.strokeStyle = ghost ? '#ffffff' : '#c7d2dd';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 15, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.fillStyle = ghost ? '#ffffff' : '#6e7d8c';
    for (const [rx, ry] of [[-10, -8], [0, -13], [10, -8]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < enemy.maxHp; i++) {
      ctx.fillStyle = i < enemy.hp ? '#ffd97a' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(-8 + i * 16, 24, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Powder core: a pulsing red heart with a sparking fuse.
  if (isExplosive) {
    const pulse = 0.7 + 0.3 * Math.sin(t * 6);
    ctx.save();
    ctx.shadowColor = '#ff4d3d';
    ctx.shadowBlur = 12 * pulse;
    ctx.fillStyle = '#ff4d3d';
    ctx.beginPath();
    ctx.arc(0, 0, 6 * pulse + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ghost ? '#ffffff' : '#3a2a10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, -10);
    ctx.quadraticCurveTo(16, -20, 12, -26);
    ctx.stroke();
    ctx.fillStyle = '#ffd97a';
    ctx.beginPath();
    ctx.arc(12, -26, 2.5 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Clockwork eyes.
  ctx.fillStyle = ghost ? '#ffffff' : '#2a1e08';
  ctx.beginPath();
  ctx.arc(-5, -4, 2.2, 0, Math.PI * 2);
  ctx.arc(5, -4, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // Antennae.
  ctx.strokeStyle = ghost ? '#ffffff' : '#5e3d10';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-4, -12);
  ctx.quadraticCurveTo(-10, -22, -14, -24);
  ctx.moveTo(4, -12);
  ctx.quadraticCurveTo(10, -22, 14, -24);
  ctx.stroke();
  ctx.restore();
}

function drawBeam(ctx, points, width, color, alpha, glow) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const [sx, sy] = toPx(points[0][0], points[0][1]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < points.length; i++) {
    const [px, py] = toPx(points[i][0], points[i][1]);
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Full frame
// ---------------------------------------------------------------------------

export function render(ctx, state, view, preview) {
  view.time = performance.now() / 1000;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawGlass(ctx, state);
  drawEmitter(ctx, state, view);
  drawRedLine(ctx, state);

  // Next-step ghosts: where each moth will be after this turn's advance.
  if (state.phase === 'playing') {
    for (const enemy of state.enemies) {
      if (enemy.y + 1 < BOARD_SIZE) {
        drawMoth(ctx, { ...enemy, y: enemy.y + 1 }, view, true);
      } else {
        // A moth on the red line will breach if it lives: red warning chevron.
        const [cx, cy] = cellCenter(enemy.x, BOARD_SIZE - 1);
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(view.time * 5);
        ctx.fillStyle = '#ff2a2a';
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy + 34);
        ctx.lineTo(cx + 14, cy + 34);
        ctx.lineTo(cx, cy + 46);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    // Incoming arrows for next turn's spawns.
    const { nextSpawns } = preview;
    if (nextSpawns) {
      for (const s of nextSpawns) {
        const [cx] = cellCenter(s.c, 0);
        const ay = OY - 34 + Math.sin(view.time * 4) * 3;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffd97a';
        ctx.beginPath();
        ctx.moveTo(cx, ay + 12);
        ctx.lineTo(cx - 8, ay - 2);
        ctx.lineTo(cx - 3, ay - 2);
        ctx.lineTo(cx - 3, ay - 12);
        ctx.lineTo(cx + 3, ay - 12);
        ctx.lineTo(cx + 3, ay - 2);
        ctx.lineTo(cx + 8, ay - 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Mirrors (the dragged one is drawn at the pointer instead).
  const draggedId = view.dragMirror ? view.dragMirror.id : null;
  for (const mirror of state.mirrors) {
    if (mirror.id === draggedId) continue;
    drawMirror(ctx, mirror, state.highlightMirror === mirror.id, false);
  }
  if (view.dragMirror && view.dragPos) {
    // The dragged mirror follows the pointer, glowing gold.
    drawMirrorPx(ctx, view.dragPos.px, view.dragPos.py, view.dragMirror.angle, true, false);
  }

  // Moths.
  for (const enemy of state.enemies) drawMoth(ctx, enemy, view, false);

  // Beam preview: always visible while playing, so the player can aim.
  if (state.phase === 'playing' && preview && preview.path) {
    drawBeam(ctx, preview.path.points, 5, '#f5c542', 0.5, 10);
  }

  // Fired beam flash: bright layered gold, fading over ~0.7 s.
  const now = performance.now();
  if (state.lastShot && now < view.flashUntil) {
    const age = (view.flashUntil - now) / 700;
    const a = Math.max(0, Math.min(1, age));
    drawBeam(ctx, state.lastShot.path, 18, '#f5c542', 0.35 * a, 30);
    drawBeam(ctx, state.lastShot.path, 9, '#ffd97a', 0.9 * a, 22);
    drawBeam(ctx, state.lastShot.path, 3, '#fffbe8', 0.95 * a, 10);
  }

  // Impact rings.
  view.rings = view.rings.filter((r) => view.time - r.born < 0.6);
  for (const ring of view.rings) {
    const age = (view.time - ring.born) / 0.6;
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, 10 + age * 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Particles.
  const dt = 1 / 60;
  view.particles = view.particles.filter((p) => p.life < p.max);
  for (const p of view.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Floating score popups.
  view.popups = view.popups.filter((p) => p.life < p.max);
  for (const p of view.popups) {
    p.life += dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = '700 22px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y - p.life * 36);
    ctx.restore();
  }
}
