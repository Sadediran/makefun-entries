// GLASSKEEP v2 — particles.js: sparks, bursts and floating score text.
//
// Visual feedback only: particles never affect game state. Their motion is
// seeded per burst (mulberry32 from a caller-supplied seed), so even the
// effects are reproducible — there is no Math.random anywhere in the game.

import { mulberry32 } from './draft.js';

/** A particle system: sparks (short-lived, gravity-free) and floating texts. */
export class Particles {
  constructor() {
    this.sparks = [];
    this.texts = [];
  }

  /** A burst of sparks at (x, y), seeded so it replays identically. */
  burst(x, y, colour, seed, count = 14) {
    const rand = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const speed = 30 + rand() * 90;
      this.sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: 0.5 + rand() * 0.4,
        age: 0,
        size: 1.5 + rand() * 2.5,
        colour,
      });
    }
  }

  /** A golden ring flash at (x, y): the beam's impact. */
  ring(x, y, seed) {
    const rand = mulberry32(seed);
    this.sparks.push({
      x, y, vx: 0, vy: 0, life: 0.35, age: 0,
      size: 6 + rand() * 4, colour: '#ffe9a8', ring: true,
    });
  }

  /** Floating score text rising from (x, y). */
  floatText(x, y, text, colour = '#ffe9a8') {
    this.texts.push({ x, y, text, colour, life: 1.1, age: 0 });
  }

  /** Advance all particles by dt seconds. */
  update(dt) {
    for (const s of this.sparks) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 26 * dt;
    }
    this.texts = this.texts.filter((t) => t.age < t.life);
  }

  /** Draw every live particle. */
  draw(ctx) {
    for (const s of this.sparks) {
      const a = 1 - s.age / s.life;
      if (s.ring) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size + (s.age / s.life) * 26, 0, Math.PI * 2);
        ctx.strokeStyle = s.colour;
        ctx.globalAlpha = a;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * a + 0.5, 0, Math.PI * 2);
      ctx.fillStyle = s.colour;
      ctx.globalAlpha = a;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.font = '700 15px Georgia, serif';
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.age / t.life;
      ctx.fillStyle = t.colour;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  /** Anything still animating? */
  get active() {
    return this.sparks.length > 0 || this.texts.length > 0;
  }
}
