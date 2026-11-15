// GLASSKEEP v2 — towers.js: the campaign and the region map.
//
// The campaign is the four towers: each can be played in any order, each
// remembers its best score and grade, and the campaign is won when all four
// are defended. Pure state over the save file: no DOM, no randomness.

import { TOWERS, campaignGradeFor } from './content.js';
import { defendedCount } from './save.js';

/** A fresh campaign over a save (the save carries the persistent bests). */
export function newCampaign(save) {
  return {
    save,
    results: {}, // towerId -> { score, grade } for this session's wins
    defended: new Set(Object.entries(save.towers).filter(([, t]) => t.defended).map(([id]) => id)),
    allRelics: new Set(), // relic ids drafted this session, for the campaign recap
  };
}

/** Record a tower defended in this session. */
export function defendTower(campaign, towerId, score, grade) {
  campaign.defended.add(towerId);
  campaign.results[towerId] = { score, grade };
}

/** How many towers are defended (this session plus the save). */
export function towersDefended(campaign) {
  return campaign.defended.size;
}

/** Is the campaign complete — all four towers defended? */
export function campaignComplete(campaign) {
  return campaign.defended.size >= TOWERS.length;
}

/** The campaign total score: this session's tower scores, plus saved bests
 *  for towers defended in earlier sessions. */
export function campaignTotal(campaign) {
  let total = 0;
  for (const tower of TOWERS) {
    const session = campaign.results[tower.id];
    const saved = campaign.save.towers[tower.id];
    if (session) total += session.score;
    else if (saved?.defended) total += saved.best;
  }
  return total;
}

/** The campaign grade from the four tower grades (session first, else saved). */
export function campaignGrade(campaign) {
  const grades = TOWERS.map((t) => {
    const session = campaign.results[t.id];
    if (session) return session.grade;
    const saved = campaign.save.towers[t.id];
    return saved?.bestGrade ?? 'C';
  });
  return campaignGradeFor(grades);
}

/** The map's rows: one per tower, with its state for the card. */
export function mapRows(campaign) {
  return TOWERS.map((tower) => {
    const saved = campaign.save.towers[tower.id] ?? { best: 0, bestGrade: null, defended: false };
    const session = campaign.results[tower.id];
    return {
      tower,
      defended: campaign.defended.has(tower.id),
      best: session ? Math.max(session.score, saved.best) : saved.best,
      bestGrade: session?.grade ?? saved.bestGrade,
    };
  });
}

/** Towers defended across all time (the save's count). */
export function savedDefendedCount(save) {
  return defendedCount(save);
}
