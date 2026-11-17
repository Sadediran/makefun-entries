// The DOM HUD: crosshair, health, ammo, timer, score, money, kill feed, buy menu, plant
// progress, banners and the overlays. It never touches the simulation; main.js pushes
// numbers in and reads callbacks out. All updates are cached so the DOM is only touched
// when a value actually changes.
import { catalogue } from './economy.js';

const COPY = {
  start: {
    title: 'SANDLINE',
    copy: 'Meridian Yard — Vanguard attacks, Dusk defends. Plant the charge at A or B, or clear the yard. Click to play.',
    action: 'Click to play',
  },
  paused: { title: 'SANDLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  end: { title: 'Round over', copy: '', action: 'Next round' },
  match: { title: 'Match over', copy: '', action: 'Play again' },
};

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeLine = $('grenades');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorTag = $('armor-tag');
  const timerEl = $('timer');
  const scoreV = $('score-v');
  const scoreD = $('score-d');
  const roundEl = $('round-label');
  const moneyEl = $('money');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const toastEl = $('toast');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const buyTimer = $('buy-timer');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const defuseAlert = $('defuse-alert');
  const scoreboard = $('scoreboard');
  const scoreboardBody = $('scoreboard-body');
  const damageEl = $('damage');
  const scopeEl = $('scope');
  const siteTag = $('site-tag');

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let toastTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  // Build the buy menu once from the catalogue.
  for (const item of catalogue()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.innerHTML = `<span class="buy-name"></span><span class="buy-blurb"></span><span class="buy-price"></span>`;
    button.querySelector('.buy-name').textContent = item.name;
    button.querySelector('.buy-blurb').textContent = item.blurb;
    button.querySelector('.buy-price').textContent = `$${item.price}`;
    button.addEventListener('click', () => callbacks.onBuy(item));
    buyItems.appendChild(button);
  }

  return {
    setHealth(health, armor) {
      setText(healthNum, 'health', String(Math.max(0, Math.ceil(health))));
      const pct = Math.max(0, Math.min(100, health));
      if (last.healthPct !== pct) {
        last.healthPct = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.style.background = pct > 50 ? 'var(--accent)' : pct > 25 ? 'var(--siteB)' : 'var(--danger)';
      }
      armorTag.hidden = armor <= 0;
      if (armor > 0) setText(armorTag, 'armor', `VEST ${Math.ceil(armor)}`);
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name, grenades, selected) {
      setText(weaponName, 'weapon', name);
      const frag = grenades.frag || 0;
      const smoke = grenades.smoke || 0;
      setText(grenadeLine, 'grenades', `Q ${selected === 'frag' ? '▸' : ''}Frag ×${frag}   ${selected === 'smoke' ? '▸' : ''}Smoke ×${smoke}  [G cycle]`);
    },
    setTimer(seconds, planted, fuse) {
      const text = planted ? `CHARGE ${Math.ceil(fuse)}s` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      setText(timerEl, 'timer', text);
      timerEl.classList.toggle('urgent', planted ? fuse <= 10 : seconds <= 10);
    },
    setScore(v, d, round) {
      setText(scoreV, 'scoreV', String(v));
      setText(scoreD, 'scoreD', String(d));
      setText(roundEl, 'round', `ROUND ${round}`);
    },
    setMoney(value) {
      setText(moneyEl, 'money', `$${value}`);
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    setSiteTag(text) {
      setText(siteTag, 'site', text);
      siteTag.hidden = !text;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'kf good' : 'kf bad';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    banner(win, titleText, subText) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.toggle('win', win);
      banner.classList.toggle('lose', !win);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      // A staged screenshot frame must still show the banner after slow software
      // rendering warms up, so it holds a minute there and 4.2 s in real play.
      const holdMs = new URLSearchParams(window.location.search).get('shot') ? 60000 : 4200;
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    toast(text) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
    },
    damageFlash() {
      damageEl.classList.remove('flash');
      void damageEl.offsetWidth;
      damageEl.classList.add('flash');
    },
    showBuy(secondsLeft) {
      buyMenu.hidden = false;
      setText(buyTimer, 'buyTimer', `Buy window closes in ${Math.ceil(secondsLeft)}s — keys 1–7 buy, B to close`);
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    setPlant(label, progress) {
      plantWrap.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() {
      plantWrap.hidden = true;
    },
    setDefuseAlert(show) {
      defuseAlert.hidden = !show;
    },
    setScope(show) {
      scopeEl.hidden = !show;
      crosshair.style.visibility = show ? 'hidden' : 'visible';
    },
    showScoreboard(rows, titleText) {
      scoreboardBody.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'sb-row sb-head';
      head.innerHTML = '<span>Player</span><span>K</span><span>D</span><span>Team</span>';
      scoreboardBody.appendChild(head);
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'sb-row';
        div.innerHTML = `<span></span><span></span><span></span><span></span>`;
        const cells = div.querySelectorAll('span');
        cells[0].textContent = row.name;
        cells[1].textContent = String(row.kills);
        cells[2].textContent = String(row.deaths);
        cells[3].textContent = row.team;
        scoreboardBody.appendChild(div);
      }
      $('scoreboard-title').textContent = titleText;
      scoreboard.hidden = false;
    },
    hideScoreboard() {
      scoreboard.hidden = true;
    },
    showOverlay(mode, score, extra) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'end') copy.textContent = `${extra || ''} Vanguard ${score.vanguard} — ${score.dusk} Dusk.`;
      else if (mode === 'match') copy.textContent = `${extra || ''} Final score — Vanguard ${score.vanguard} : ${score.dusk} Dusk.`;
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
