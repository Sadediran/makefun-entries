// GLASSKEEP v2 — save.js: best records in localStorage.
//
// Persists per-tower best score, best grade and defended state, plus the
// campaign best. localStorage holds only best records, never run randomness:
// a run's outcome never depends on what is saved. Guarded throughout, so
// the game also runs where storage is unavailable (file://, private mode)
// and under Node (unit tests import the pure modules, not this one).

const KEY = 'glasskeep-v2-save-v1';

/** The empty save: no tower defended, no bests. */
export function emptySave() {
  return { towers: {}, campaignBest: 0, campaignGrade: null };
}

/** Read the save (an empty one when nothing is stored or storage fails). */
export function loadSave() {
  try {
    if (typeof localStorage === 'undefined') return emptySave();
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptySave();
    return { ...emptySave(), ...parsed, towers: { ...parsed.towers } };
  } catch {
    return emptySave();
  }
}

/** Write the save (a no-op when storage fails). */
export function storeSave(save) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Record a tower result: keep the better score and grade, mark defended. */
export function recordTower(save, towerId, score, grade, defended) {
  const prev = save.towers[towerId] ?? { best: 0, bestGrade: null, defended: false };
  const order = { S: 4, A: 3, B: 2, C: 1 };
  const betterGrade = !prev.bestGrade || (order[grade] ?? 0) > (order[prev.bestGrade] ?? 0) ? grade : prev.bestGrade;
  save.towers[towerId] = {
    best: Math.max(prev.best, score),
    bestGrade: betterGrade,
    defended: prev.defended || defended,
  };
  return save;
}

/** Record a campaign result: keep the better total and grade. */
export function recordCampaign(save, totalScore, grade) {
  const order = { S: 4, A: 3, B: 2, C: 1 };
  save.campaignBest = Math.max(save.campaignBest, totalScore);
  if (!save.campaignGrade || (order[grade] ?? 0) > (order[save.campaignGrade] ?? 0)) {
    save.campaignGrade = grade;
  }
  return save;
}

/** How many towers the save marks defended. */
export function defendedCount(save) {
  return Object.values(save.towers).filter((t) => t.defended).length;
}

/** Wipe all records. */
export function clearSave() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
  return emptySave();
}
