// GLASSKEEP v2 — moths.js: drawing the clockwork moths.
//
// Each enemy type has a distinct silhouette, wing pattern and colour, drawn
// procedurally on the canvas — no image files. Moths are BIG (a wingspan
// close to the cell size) so they read at screenshot size; v1's moths read
// as bees. Damage shows as cracks; a shielded moth gets a faint ring.

import { ENEMIES } from './content.js';

/** Draw one moth centred at (x, y) with wingspan `size`. `hp`/`maxHp`
 *  show damage; `shielded` draws the Warden's ring; bosses are larger. */
export function drawMoth(ctx, moth, x, y, size, opts = {}) {
  const def = ENEMIES[moth.type];
  const boss = moth.type === 'guardian' || moth.type === 'grand';
  const s = boss ? size * 1.25 : size;
  const wing = def.wing;
  const body = def.colour;
  const damaged = moth.hp < moth.maxHp;
  const flap = opts.flap ?? 0; // -1..1, wing angle offset (animation only)

  ctx.save();
  ctx.translate(x, y);

  // Shield ring (a moth protected by a living Warden).
  if (opts.shielded) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(127,184,164,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Wings: two mirrored shapes, styled per type.
  const wingSpan = s * 0.52;
  const wingLen = s * 0.42;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(flap * 0.12 * side);
    ctx.beginPath();
    if (moth.type === 'iron') {
      // Angular armoured wing: a faceted plate.
      ctx.moveTo(0, -s * 0.08);
      ctx.lineTo(wingSpan, -wingLen);
      ctx.lineTo(wingSpan * 1.05, -wingLen * 0.25);
      ctx.lineTo(wingSpan * 0.7, wingLen * 0.55);
      ctx.lineTo(0, wingLen * 0.3);
    } else if (moth.type === 'powder') {
      // Round puffy wing with a scalloped edge.
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(wingSpan * 0.4, -wingLen * 1.1, wingSpan * 1.1, -wingLen * 0.7, wingSpan, 0);
      ctx.bezierCurveTo(wingSpan * 1.05, wingLen * 0.7, wingSpan * 0.4, wingLen * 0.9, 0, wingLen * 0.3);
    } else if (moth.type === 'warden') {
      // Broad shield-shaped wing.
      ctx.moveTo(0, -wingLen * 0.4);
      ctx.bezierCurveTo(wingSpan * 0.7, -wingLen * 0.9, wingSpan * 1.15, -wingLen * 0.2, wingSpan * 0.9, wingLen * 0.5);
      ctx.bezierCurveTo(wingSpan * 0.5, wingLen * 0.85, wingSpan * 0.1, wingLen * 0.6, 0, wingLen * 0.25);
    } else if (boss) {
      // Grand wings: long, swept, with a tail point.
      ctx.moveTo(0, -s * 0.1);
      ctx.bezierCurveTo(wingSpan * 0.5, -wingLen * 1.25, wingSpan * 1.25, -wingLen * 0.8, wingSpan * 1.15, -wingLen * 0.1);
      ctx.bezierCurveTo(wingSpan * 1.25, wingLen * 0.4, wingSpan * 0.6, wingLen * 0.75, 0, wingLen * 0.35);
    } else {
      // Silk: soft rounded wing.
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(wingSpan * 0.35, -wingLen, wingSpan * 1.05, -wingLen * 0.75, wingSpan, -wingLen * 0.1);
      ctx.bezierCurveTo(wingSpan * 0.95, wingLen * 0.6, wingSpan * 0.35, wingLen * 0.8, 0, wingLen * 0.25);
    }
    ctx.closePath();
    ctx.fillStyle = wing;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = body;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Wing markings: a brass eye-spot per wing.
    ctx.beginPath();
    ctx.arc(wingSpan * 0.55, -wingLen * 0.15, s * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wingSpan * 0.55, -wingLen * 0.15, s * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1208';
    ctx.fill();
    ctx.restore();
  }

  // Body: a brass clockwork thorax with segment rings.
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.13, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.11, i * s * 0.14);
    ctx.lineTo(s * 0.11, i * s * 0.14);
    ctx.strokeStyle = 'rgba(26,18,8,0.6)';
    ctx.stroke();
  }
  // Head + glowing eyes.
  ctx.beginPath();
  ctx.arc(0, -s * 0.34, s * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * s * 0.045, -s * 0.36, s * 0.028, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe9a8';
    ctx.fill();
  }
  // Antennae: feathery for bosses, plain otherwise.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.05, -s * 0.42);
    ctx.quadraticCurveTo(side * s * 0.2, -s * 0.55, side * s * 0.28, -s * 0.5);
    ctx.strokeStyle = body;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Damage: crack lines across the wings.
  if (damaged) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.2);
    ctx.lineTo(-s * 0.1, 0);
    ctx.lineTo(-s * 0.25, s * 0.2);
    ctx.moveTo(s * 0.3, -s * 0.15);
    ctx.lineTo(s * 0.12, s * 0.05);
    ctx.strokeStyle = 'rgba(20,10,5,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Iron plating: rivets on the body.
  if (moth.type === 'iron') {
    for (const [rx, ry] of [[-0.05, -0.1], [0.05, 0.05], [-0.04, 0.18]]) {
      ctx.beginPath();
      ctx.arc(rx * s, ry * s, s * 0.03, 0, Math.PI * 2);
      ctx.fillStyle = '#e8f0f8';
      ctx.fill();
    }
  }
  ctx.restore();

  // Health pips for multi-hit moths (drawn under the moth).
  if (moth.maxHp > 1) {
    const w = s * 0.5;
    const y0 = y + s * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2 - 2, y0 - 2, w + 4, 7);
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(x - w / 2, y0, w * (moth.hp / moth.maxHp), 3);
  }
}
