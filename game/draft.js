// GLASSKEEP v2 — draft.js: the relic draft. Pure logic.
//
// After assaults 1 and 2 the player picks 1 of 3 relics from the pool of 9.
// The offer is deterministic per seed: the same tower and assault always
// offer the same three relics, and relics already owned are never offered.
// No DOM, no Math.random: a tiny mulberry32 seeded generator.

import { RELICS } from './content.js';

/** mulberry32: a small deterministic PRNG. Seed it, then call it for the
 *  next number in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The draft seed for a tower and assault: the tower's own seed, shifted by
 *  the assault number, so assault 1 and assault 2 offer different relics. */
export function draftSeed(tower, assaultIndex) {
  return tower.seed * 1000 + assaultIndex * 77 + 13;
}

/** Offer 3 relics: a seeded shuffle of the pool, owned relics removed, the
 *  first 3 taken. Deterministic for (tower, assault, owned set). */
export function draftOffer(tower, assaultIndex, ownedIds) {
  const rand = mulberry32(draftSeed(tower, assaultIndex));
  const pool = RELICS.filter((r) => !ownedIds.includes(r.id));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 3);
}

/** Apply a drafted relic to the run state. Iron Sash raises the max heart
 *  and mends one at once; the rest are flags the rules read each shot. */
export function applyRelic(state, relicId) {
  if (state.relics.includes(relicId)) return false;
  state.relics.push(relicId);
  if (relicId === 'iron-sash') {
    state.maxHearts = Math.min(5, state.maxHearts + 1);
    state.hearts = Math.min(state.maxHearts, state.hearts + 1);
  }
  return true;
}

/** How many mirror edits the player gets per turn: 1, or 2 with Swift Glass. */
export function editsPerTurn(relics) {
  return relics.includes('swift-glass') ? 2 : 1;
}
