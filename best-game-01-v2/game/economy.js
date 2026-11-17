// GLASSKEEP v2 — economy.js: Embers, crafts and scoring. Pure logic.
//
// Embers are the tower-run currency: earned by kills and cleared assaults,
// spent between assaults on crafts, and converted to score at tower end.
// No DOM, no randomness: Node unit tests import this file directly.

import { CRAFTS, SCORE_PER_UNSPENT_EMBER, SCORE_PER_INTACT_HEART, MAX_HEARTS_CAP } from './content.js';

/** Embers for clearing an assault: 5, plus 2 with the Amber Charm. */
export function assaultClearEmbers(relics) {
  return 5 + (relics.includes('amber-charm') ? 2 : 0);
}

/** Embers granted at the start of an assault: 3 with the Ember Heart. */
export function assaultStartEmbers(relics) {
  return relics.includes('ember-heart') ? 3 : 0;
}

/** Can the run afford this craft, and has it not been bought already this gap? */
export function canBuyCraft(state, craftId) {
  const craft = CRAFTS.find((c) => c.id === craftId);
  if (!craft) return false;
  if (state.craftsBought.includes(craftId)) return false;
  return state.embers >= craft.cost;
}

/** Buy a craft: deduct its cost and apply its effect. Returns true when the
 *  purchase went through. Mend and Reinforce also mend a heart at once (up
 *  to the max); Spare Mirror arms placement mode — the player then taps an
 *  empty cell to place the new mirror. */
export function buyCraft(state, craftId) {
  const craft = CRAFTS.find((c) => c.id === craftId);
  if (!craft || !canBuyCraft(state, craftId)) return false;
  state.embers -= craft.cost;
  state.craftsBought.push(craftId);
  state.embersSpent += craft.cost;
  if (craftId === 'mend') {
    state.hearts = Math.min(state.maxHearts, state.hearts + 1);
  } else if (craftId === 'reinforce') {
    state.maxHearts = Math.min(MAX_HEARTS_CAP, state.maxHearts + 1);
    state.hearts = Math.min(state.maxHearts, state.hearts + 1);
  } else if (craftId === 'spare-mirror') {
    state.placingMirror = true;
  }
  return true;
}

/** Place the spare mirror on an empty cell (not a buttress, not a mirror,
 *  not the emitter). Returns true when placed. */
export function placeSpareMirror(state, c, r) {
  if (!state.placingMirror) return false;
  const key = `${c},${r}`;
  if (state.board.mirrors[key] || state.board.buttresses.has(key)) return false;
  if (r === 6 && c === state.board.emitterCol) return false;
  state.board.mirrors[key] = '/';
  state.placingMirror = false;
  return true;
}

/** Tower-end score: unspent Embers convert at +10 each, and each heart
 *  still standing adds +50. Returns the bonus (the caller adds it). */
export function towerEndBonus(state) {
  return state.embers * SCORE_PER_UNSPENT_EMBER + state.hearts * SCORE_PER_INTACT_HEART;
}

/** The grade score: score + 100 per heart standing − 10 per turn used. */
export function gradeScore(state) {
  return state.score + state.hearts * 100 - state.turn * 10;
}
