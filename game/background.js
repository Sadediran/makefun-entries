// GLASSKEEP v2 — background.js: the margin illustration.
//
// v1's flaw was flat dark margins. Here the canvas around the board is a
// stained-glass window scene: a night sky, distant tower silhouettes, an
// arched window frame and drifting glass dust — recoloured per tower from
// its palette. Fully static (positions seeded from the tower id), so the
// same tower always paints the same scene: no animation randomness.

import { mulberry32 } from './draft.js';

/** Paint the whole canvas background for a tower. `board` is the board's
 *  pixel rect {x, y, size} (the board itself is painted by render.js). */
export function drawBackground(ctx, w, h, palette, towerSeed, board) {
  // Night sky: a vertical gradient in the tower's colours.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, palette.bg1);
  sky.addColorStop(0.55, palette.bg0);
  sky.addColorStop(1, '#0a0810');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const rand = mulberry32(towerSeed * 991 + 7);

  // Stars: small warm points, denser near the top.
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.75;
    const r = 0.6 + rand() * 1.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 236, 180, ${0.25 + rand() * 0.5})`;
    ctx.fill();
  }

  // Distant towers: dark silhouettes with lit windows, left and right of
  // the board so they never sit behind it.
  const silhouette = (x, baseW, baseH, windows) => {
    ctx.fillStyle = 'rgba(8, 6, 14, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x, h - baseH);
    ctx.lineTo(x + baseW * 0.18, h - baseH - baseW * 0.22);
    ctx.lineTo(x + baseW * 0.5, h - baseH - baseW * 0.42);
    ctx.lineTo(x + baseW * 0.82, h - baseH - baseW * 0.22);
    ctx.lineTo(x + baseW, h - baseH);
    ctx.lineTo(x + baseW, h);
    ctx.closePath();
    ctx.fill();
    for (const [wx, wy] of windows) {
      ctx.fillStyle = 'rgba(255, 214, 106, 0.8)';
      ctx.fillRect(x + wx * baseW, h - wy * baseH, 5, 7);
    }
  };
  silhouette(6, 64, h * 0.42, [[0.3, 0.55], [0.55, 0.75], [0.35, 0.9]]);
  silhouette(w - 70, 64, h * 0.5, [[0.4, 0.5], [0.6, 0.7], [0.3, 0.85]]);
  silhouette(board.x - 92, 52, h * 0.3, [[0.4, 0.6]]);
  silhouette(board.x + board.size + 40, 52, h * 0.34, [[0.45, 0.65]]);

  // The great arched window: a tall arch framing the board, in the tower's
  // glass colour, with tracery lines and a rose of light at the top.
  const archX = board.x + board.size / 2;
  const archTop = 14;
  const archW = board.size + 56;
  ctx.strokeStyle = palette.glass;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(archX - archW / 2, h - 8);
  ctx.lineTo(archX - archW / 2, archTop + archW / 2);
  ctx.arc(archX, archTop + archW / 2, archW / 2, Math.PI, 0);
  ctx.lineTo(archX + archW / 2, h - 8);
  ctx.stroke();
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(archX - archW / 2 + 12, h - 8);
  ctx.lineTo(archX - archW / 2 + 12, archTop + archW / 2);
  ctx.arc(archX, archTop + archW / 2, archW / 2 - 12, Math.PI, 0);
  ctx.lineTo(archX + archW / 2 - 12, h - 8);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Rose window: a ring of light above the board.
  const roseY = archTop + 34;
  const roseR = 26;
  const glow = ctx.createRadialGradient(archX, roseY, 2, archX, roseY, roseR * 2.2);
  glow.addColorStop(0, 'rgba(255, 220, 130, 0.5)');
  glow.addColorStop(1, 'rgba(255, 220, 130, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(archX, roseY, roseR * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(archX, roseY, roseR, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(archX, roseY);
    ctx.lineTo(archX + Math.cos(a) * roseR, roseY + Math.sin(a) * roseR);
    ctx.strokeStyle = palette.glass;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Glass dust: soft drifting motes (static positions, seeded).
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 1 + rand() * 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 220, 140, ${0.08 + rand() * 0.14})`;
    ctx.fill();
  }

  // Vignette: darken the very edges so the board sits forward.
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}
