// GLASSKEEP v2 — boss.js: Guardians and the Grand Moth. Pure logic.
//
// Each tower's third assault carries a named boss: a Guardian for Ember,
// Verdigris and Gilt, THE GRAND MOTH for Sable. A boss is a moth with more
// health, a health bar, a name shown in the HUD, and (for the Grand Moth)
// a two-heart breach. No summoning, no phases: one simple, testable rule.

import { ENEMIES } from './content.js';

/** Is this moth a boss (a Guardian or the Grand Moth)? */
export function isBoss(moth) {
  return moth.type === 'guardian' || moth.type === 'grand';
}

/** The living boss on the board, if any. */
export function livingBoss(moths) {
  return moths.find((m) => isBoss(m) && m.hp > 0) ?? null;
}

/** A boss's health as a fraction (for the health bar). */
export function bossHealthFraction(moth) {
  if (!isBoss(moth)) return 1;
  return Math.max(0, moth.hp / moth.maxHp);
}

/** Hearts lost when a boss breaches: 1 for a Guardian, 2 for the Grand Moth. */
export function bossBreachHearts(moth) {
  return ENEMIES[moth.type].breach;
}

/** The boss banner text for an assault (shown when the assault starts). */
export function bossBanner(tower, assaultIndex) {
  const assault = tower.assaults[assaultIndex];
  if (!assault.boss) return null;
  if (assault.boss === 'grand') return 'THE GRAND MOTH AWAKENS';
  return `${(assault.bossName ?? 'The Warden').toUpperCase()} AWAKENS`;
}
