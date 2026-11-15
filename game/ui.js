// GLASSKEEP v2 — ui.js: the HUD and every overlay.
//
// All DOM work lives here: the HUD, the region map, the craft and draft
// cards, the pause / victory / defeat screens, the hint line and the boss
// bar. main.js owns the state; this module only shows it. Element ids match
// index.html.

import { CRAFTS, RELICS } from './content.js';

/** Shorthand: an element by id. */
export const el = (id) => document.getElementById(id);

/** Hide every overlay. */
export function hideOverlays() {
  for (const o of document.querySelectorAll('.overlay')) o.classList.add('hidden');
}

/** Show one overlay (hiding the rest). */
export function showOverlay(id) {
  hideOverlays();
  el(id).classList.remove('hidden');
}

/** The hint line under the board. */
export function setHint(text) {
  el('hint').textContent = text;
}

/** Hearts as a string of hearts (filled + empty to the max). */
function heartsText(hearts, maxHearts) {
  return '♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(Math.max(0, maxHearts - hearts));
}

/** Refresh the HUD from the run state. */
export function updateHUD(state, tower, save) {
  el('hudTower').textContent = tower.name;
  el('hudAssault').textContent = `Assault ${state.assaultIndex + 1} / 3`;
  el('hudTurn').textContent = `Turn ${state.turn}`;
  el('hudHearts').textContent = heartsText(state.hearts, state.maxHearts);
  el('hudScore').textContent = `Score ${state.score}`;
  el('hudEmbers').textContent = `◆ ${state.embers}`;
  el('hudBest').textContent = `Best ${save.towers[tower.id]?.best ?? 0}`;
  const relics = el('hudRelics');
  relics.innerHTML = '';
  for (const id of state.relics) {
    const span = document.createElement('span');
    span.className = 'relic-chip';
    span.textContent = relicIcon(id);
    span.title = relicName(id);
    relics.appendChild(span);
  }
  if (state.relics.length === 0) relics.textContent = 'No relics yet';
}

/** A relic's glyph and name, from the content data. */
function relicIcon(id) {
  return RELICS.find((r) => r.id === id)?.icon ?? '?';
}
function relicName(id) {
  return RELICS.find((r) => r.id === id)?.name ?? id;
}

/** Show the boss bar for a living boss; hide it otherwise. */
export function showBossBar(moth) {
  const bar = el('bossBar');
  if (!moth) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  el('bossName').textContent = moth.name;
  el('bossHpFill').style.width = `${Math.max(0, (moth.hp / moth.maxHp) * 100)}%`;
  el('bossHpText').textContent = `${moth.hp} / ${moth.maxHp}`;
}

/** Build the region map: one card per tower, plus the campaign total. */
export function renderMap(rows, defended, onPick, onReset) {
  const wrap = el('mapCards');
  wrap.innerHTML = '';
  for (const row of rows) {
    const card = document.createElement('button');
    card.className = `tower-card${row.defended ? ' defended' : ''}`;
    card.style.setProperty('--tc', row.tower.palette.accent);
    card.style.setProperty('--tg', row.tower.palette.glass);
    card.innerHTML = `
      <span class="tower-card-name">${row.tower.name}</span>
      <span class="tower-card-diff">${row.tower.difficulty}</span>
      <span class="tower-card-intro">${row.tower.intro}</span>
      <span class="tower-card-best">${row.bestGrade ? `Best grade ${row.bestGrade} · ${row.best}` : 'Not yet played'}</span>
      <span class="tower-card-state">${row.defended ? '✓ DEFENDED — play again' : '▶ DEFEND'}</span>`;
    card.addEventListener('click', () => onPick(row.tower.id));
    wrap.appendChild(card);
  }
  el('campaignTotal').textContent = `Towers defended: ${defended} / 4`;
  const reset = el('resetSaveBtn');
  reset.onclick = onReset;
}

/** Build the craft screen: the three crafts with costs and the balance. */
export function renderCraft(state, onBuy, onDone) {
  const wrap = el('craftCards');
  wrap.innerHTML = '';
  el('craftBalance').textContent = `Embers: ◆ ${state.embers}`;
  for (const craft of CRAFTS) {
    const bought = state.craftsBought.includes(craft.id);
    const afford = state.embers >= craft.cost;
    const card = document.createElement('button');
    card.className = `craft-card${bought ? ' bought' : ''}${!afford && !bought ? ' poor' : ''}`;
    card.disabled = bought || !afford;
    card.innerHTML = `
      <span class="craft-name">${craft.name}</span>
      <span class="craft-cost">◆ ${craft.cost}</span>
      <span class="craft-desc">${craft.desc}</span>
      <span class="craft-state">${bought ? 'BOUGHT' : afford ? 'BUY' : 'NOT ENOUGH EMBERS'}</span>`;
    card.addEventListener('click', () => onBuy(craft.id));
    wrap.appendChild(card);
  }
  el('craftDoneBtn').onclick = onDone;
}

/** Build the draft screen: three relic cards, pick one. */
export function renderDraft(offers, onPick) {
  const wrap = el('draftCards');
  wrap.innerHTML = '';
  for (const relic of offers) {
    const card = document.createElement('button');
    card.className = 'relic-card';
    card.innerHTML = `
      <span class="relic-icon">${relic.icon}</span>
      <span class="relic-name">${relic.name}</span>
      <span class="relic-effect">${relic.effect}</span>`;
    card.addEventListener('click', () => onPick(relic.id));
    wrap.appendChild(card);
  }
}

/** Fill the per-tower victory screen. */
export function renderTowerWin(data, onNext, onMap) {
  el('towerWinGrade').textContent = data.grade;
  el('towerWinTitle').textContent = `${data.tower.name} defended!`;
  el('towerWinStats').innerHTML = `
    <span>Score <b>${data.score}</b></span>
    <span>Moths shattered <b>${data.kills}</b></span>
    <span>Turns <b>${data.turn}</b></span>
    <span>Hearts standing <b>${data.hearts}</b></span>
    <span>Embers earned <b>${data.embersEarned}</b> · spent <b>${data.embersSpent}</b></span>
    <span>Relics <b>${data.relicNames.join(', ') || 'none'}</b></span>`;
  el('towerWinNextBtn').onclick = onNext;
  el('towerWinMapBtn').onclick = onMap;
}

/** Fill the campaign victory screen. */
export function renderCampaignWin(data, onMap, onAgain) {
  el('campaignWinGrade').textContent = data.grade;
  el('campaignWinTotal').textContent = `Total score ${data.total}`;
  el('campaignWinTable').innerHTML = data.rows.map((r) => `
    <span>${r.name}</span><span>Grade <b>${r.grade}</b></span><span><b>${r.score}</b></span>`).join('');
  el('campaignWinRelics').textContent = data.relicNames.length > 0
    ? `Relics drafted across the campaign: ${data.relicNames.join(', ')}`
    : 'No relics drafted — a purist run.';
  el('campaignWinMapBtn').onclick = onMap;
  el('campaignWinAgainBtn').onclick = onAgain;
}

/** Fill the defeat screen. */
export function renderDefeat(data, onRetry, onMap) {
  el('defeatTitle').textContent = `The ${data.tower.name} has fallen`;
  el('defeatStats').innerHTML = `
    <span>Reached <b>assault ${data.assaultIndex + 1} of 3</b></span>
    <span>Score <b>${data.score}</b></span>
    <span>Moths shattered <b>${data.kills}</b></span>
    <span>Turns <b>${data.turn}</b></span>`;
  el('defeatTip').textContent = data.tip;
  el('defeatRetryBtn').onclick = onRetry;
  el('defeatMapBtn').onclick = onMap;
}

/** Fill the per-tower intro card. */
export function renderIntro(tower, foeList, onBegin, onBack) {
  el('introTowerName').textContent = tower.name;
  el('introTowerDiff').textContent = tower.difficulty;
  el('introTowerText').textContent = tower.intro;
  el('introTowerEnemies').textContent = `Foes: ${foeList}`;
  el('introBeginBtn').onclick = onBegin;
  el('introBackBtn').onclick = onBack;
}
