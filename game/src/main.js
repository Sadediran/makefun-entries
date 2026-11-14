// SANDLINE — Meridian Yard. Boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. Rounds: a 15 s buy phase, a 100 s live round, a 35 s fuse
// once the charge is planted, first team to 5 round wins takes the match.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, PHASE } from './state.js';
import { createWorld, VANGUARD_SPAWNS } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createObjective } from './objective.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { REWARDS, ARMOR_PRICE, catalogue, buy as buyItem } from './economy.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const PLANT_SECONDS = 3.5;
const ROUNDS_TO_WIN = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const world = createWorld(scene, seed);
const player = createPlayer(world.colliders, VANGUARD_SPAWNS[0]);
const weapon = createWeapon(camera);
const audio = createAudio();
const objective = createObjective(scene, world);
const grenades = createGrenades(scene);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

const body = player.state;
const owned = new Set(['pistol']);
let started = false;
let frozen = false;
let overTimer = 0;
let buyOpen = true;
let spectateBot = null;

// Tracers: a fixed pool of fading lines, no allocation while playing.
const tracers = [];
for (let i = 0; i < 24; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  line.visible = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;
function addTracer(a, b) {
  const slot = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = slot.line.geometry.attributes.position.array;
  pos[0] = a.x; pos[1] = a.y; pos[2] = a.z;
  pos[3] = b.x; pos[4] = b.y; pos[5] = b.z;
  slot.line.geometry.attributes.position.needsUpdate = true;
  slot.line.visible = true;
  slot.life = 0.09;
}

function broadcastNoise(x, z, radius) {
  for (const bot of bots.bots) bots.hearNoise(bot, x, z, radius);
}

function damagePlayer(amount, fromPos) {
  if (!body.alive || state.phase !== PHASE.LIVE) return;
  const absorbed = Math.min(body.armor, amount * 0.5);
  body.armor -= absorbed;
  body.health -= (amount - absorbed);
  state.planting = 0;
  hud.damageFlash();
  hud.setHealth(body.health, body.armor);
  audio.hurt();
  if (body.health > 0) return;
  body.health = 0;
  body.alive = false;
  body.velocity.set(0, 0, 0);
  state.deaths += 1;
  hud.killfeed('You were taken down', false);
  hud.toast('You are down — your team fights on.');
  if (state.carrier === 'player') {
    const alive = bots.bots.filter((b) => b.team === 'vanguard' && b.alive);
    if (alive.length) {
      alive.sort((a, b) => Math.hypot(a.position.x - body.position.x, a.position.z - body.position.z) - Math.hypot(b.position.x - body.position.x, b.position.z - body.position.z));
      state.carrier = alive[0].id;
      hud.toast(`${alive[0].name} picked up the charge.`);
    } else {
      state.carrier = null;
    }
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function doPlant(site, byPlayer) {
  if (state.planted) return;
  state.planted = true;
  state.plantSite = site;
  state.fuseTime = FUSE_SECONDS;
  state.planting = 0;
  objective.plant(site);
  audio.plant();
  if (byPlayer) {
    state.money += REWARDS.plant;
    state.plants += 1;
    hud.killfeed(`You planted the charge at site ${site}  +$${REWARDS.plant}`, true);
  } else {
    hud.killfeed(`Charge planted at site ${site} — stop the defuse!`, true);
  }
  hud.toast(`Charge planted at site ${site}. Hold the site!`);
}

const bots = createBots(scene, world, {
  now: () => state.time,
  smokeBlocks: (ax, ay, az, bx, by, bz) => grenades.blockedBySmoke(ax, ay, az, bx, by, bz),
  onDamagePlayer: (amount, fromPos) => damagePlayer(amount, fromPos),
  onBotShot: (from, to, team) => {
    tmpVec.copy(from);
    tmpVec2.copy(to);
    addTracer(tmpVec, tmpVec2);
    if (team === 'dusk') audio.distantShot();
  },
  onBotKilled: (bot, byPlayer) => {
    if (byPlayer) {
      state.money += REWARDS.kill;
      state.kills += 1;
      hud.killfeed(`You ▸ ${bot.name}  +$${REWARDS.kill}`, true);
    } else if (bot.team === 'dusk') {
      hud.killfeed(`Ally ▸ ${bot.name}`, true);
    } else {
      hud.killfeed(`${bot.name} is down`, false);
    }
    if (state.carrier === bot.id) {
      const alive = bots.bots.filter((b) => b.team === 'vanguard' && b.alive);
      if (body.alive) {
        state.carrier = 'player';
        hud.toast('You carry the charge now.');
      } else if (alive.length) {
        state.carrier = alive[0].id;
      } else {
        state.carrier = null;
      }
    }
    if (state.defuser === bot.id) state.defuser = null;
    hud.setMoney(state.money);
  },
  onPlantStarted: (bot, site) => {
    hud.killfeed(`${bot.name} is planting at site ${site}`, true);
    hud.toast(`${bot.name} is planting the charge at ${site}.`);
  },
  onPlantDone: (site) => doPlant(site, false),
  onDefuseDone: () => endRound('dusk', 'Charge defused'),
});

const hud = createHud({
  onBuy: (item) => handleBuy(item),
});
const input = createInput(renderer.domElement, onLockChange, {
  onBuyToggle: () => {
    if (state.phase !== PHASE.BUY) return;
    buyOpen = !buyOpen;
    if (buyOpen) hud.showBuy(state.roundTime);
    else hud.hideBuy();
  },
  onThrowGrenade: () => throwGrenade(),
  onCycleGrenade: () => {
    weapon.state.grenadeSelected = weapon.state.grenadeSelected === 'frag' ? 'smoke' : 'frag';
    hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
  },
  onReload: () => {
    if (state.phase === PHASE.LIVE && body.alive) {
      weapon.reload();
      audio.reload();
    }
  },
  onWeaponSlot: (slot) => {
    // In the buy phase the number keys buy from the catalogue (1 rifle, 2 SMG,
    // 3 sniper, 4 pistol, 5 frag, 6 smoke, 7 vest); in a live round they switch.
    if (state.phase === PHASE.BUY) {
      const item = catalogue()[slot];
      if (item) handleBuy(item);
      return;
    }
    const id = ['pistol', 'rifle', 'smg', 'sniper'][slot];
    if (id && owned.has(id) && weapon.state.id !== id) {
      weapon.equip(id);
      hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
      audio.beep();
    }
  },
  onAim: (aiming) => {
    body.aiming = aiming;
    const zoom = aiming && weapon.state.id === 'sniper';
    camera.fov = zoom ? 28 : 74;
    camera.updateProjectionMatrix();
    hud.setScope(zoom);
  },
  onScoreboard: (show) => {
    if (show) hud.showScoreboard(scoreboardRows(), `Round ${state.round} — Vanguard ${state.score.vanguard} : ${state.score.dusk} Dusk`);
    else hud.hideScoreboard();
  },
});

// Clicking the game while a round is live (and the player is up) locks the pointer,
// so a player who bought without locking can deploy without finding the panel.
renderer.domElement.addEventListener('mousedown', () => {
  if (!shot && started && !input.state.locked && state.phase === PHASE.LIVE && body.alive) input.requestLock();
});

// Read-only handle for live play-testing from the console (state, input and the fixed
// step itself, so the simulation can be driven without rendering).
window.__sandline = { state, body, bots, weapon, input, step };

function scoreboardRows() {
  const rows = [{ name: 'You', kills: state.kills, deaths: state.deaths, team: 'Vanguard' }];
  for (const bot of bots.bots) rows.push({ name: bot.name, kills: bot.kills, deaths: bot.deaths, team: bot.team === 'vanguard' ? 'Vanguard' : 'Dusk' });
  rows.sort((a, b) => b.kills - a.kills);
  return rows;
}

function throwGrenade() {
  if (state.phase !== PHASE.LIVE || !body.alive || state.freeze) return;
  const kind = weapon.state.grenadeSelected;
  if ((weapon.state.grenades[kind] || 0) <= 0) {
    hud.toast(`No ${kind === 'frag' ? 'frag charges' : 'smoke canisters'} left — buy more next round.`);
    return;
  }
  weapon.state.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  tmpVec.copy(camera.position);
  grenades.throwGrenade(kind, tmpVec, direction, {
    onFrag: (pos, radius, damage) => {
      audio.explosion();
      broadcastNoise(pos.x, pos.z, 30);
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.position.x - pos.x, bot.position.z - pos.z);
        if (d < radius) bots.damageBot(bot, Math.round(damage * (1 - d / radius) + 20), 'player');
      }
      const pd = Math.hypot(body.position.x - pos.x, body.position.z - pos.z);
      if (pd < radius * 0.7 && body.alive) damagePlayer(Math.round(damage * 0.4), pos);
    },
    onSound: () => {},
  });
  hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.empty();
    return false;
  }
  const spec = weapon.spec();
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = world.shootables.concat(bots.hitMeshes());
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : tmpVec.copy(camera.position).addScaledVector(direction, spec.range);
  addTracer(camera.position, end);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const head = hit.object.userData.part === 'head';
    const damage = Math.round(spec.damage * (head ? spec.headMult : 1));
    const wasAlive = bot.alive;
    bots.damageBot(bot, damage, 'player');
    if (wasAlive) {
      hud.hitMarker(!bot.alive, shot ? 4000 : 90);
      if (bot.alive) audio.hit();
      else audio.kill();
    }
  }
  weapon.pullTrigger();
  player.recoil(spec.recoil * (body.aiming ? 0.6 : 1), (random() * 2 - 1) * spec.recoil * 0.4);
  audio.shot(spec.id);
  broadcastNoise(body.position.x, body.position.z, player.groundSpeed() < 2 ? 10 : 26);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function syncCamera() {
  if (!body.alive && spectateBot && spectateBot.alive) {
    camera.position.set(spectateBot.position.x, spectateBot.position.y + 1.55, spectateBot.position.z);
    camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    hud.hideOverlay();
    if (state.phase === PHASE.OVER) overTimer = 0; // skip the wait, go straight on
  } else if (!body.alive) {
    // Down and spectating: no overlay, the round plays on.
  } else if (state.phase === PHASE.LIVE) {
    hud.showOverlay('paused', state.score);
  }
}

function handleBuy(item) {
  const message = buyItem(state, weapon, item);
  if (message) hud.toast(message);
  if (message && message.startsWith('Bought')) {
    if (item.kind === 'weapon') owned.add(item.id);
    if (item.kind === 'armor') body.armor = Math.min(100, body.armor + 50);
    audio.beep();
  }
  hud.setMoney(state.money);
  hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setHealth(body.health, body.armor);
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!started) {
    started = true;
    startRound(1);
  }
  if (state.phase === PHASE.MATCH) {
    resetMatch();
    startRound(1);
  }
  // During the buy phase the cursor stays free so the menu can be clicked; the
  // pointer locks when the round goes live (Deploy / click the game).
  if (state.phase === PHASE.BUY) hud.hideOverlay();
  else input.requestLock();
});

function resetMatch() {
  state.score.vanguard = 0;
  state.score.dusk = 0;
  state.round = 1;
  state.money = 800;
  state.kills = 0;
  state.deaths = 0;
  state.plants = 0;
  state.matchWinner = null;
  owned.clear();
  owned.add('pistol');
  weapon.equip('pistol');
  weapon.state.grenades = { frag: 0, smoke: 0 };
}

function startRound(round) {
  state.round = round;
  state.phase = PHASE.BUY;
  state.roundTime = BUY_SECONDS;
  state.fuseTime = 0;
  state.planted = false;
  state.plantSite = null;
  state.planting = 0;
  state.defusing = 0;
  state.defuser = null;
  state.carrier = 'player';
  state.roundWinner = null;
  state.roundReason = '';
  state.freeze = true;
  overTimer = 0;
  buyOpen = true;
  spectateBot = null;
  player.respawn(VANGUARD_SPAWNS[0]);
  weapon.refillAmmo();
  grenades.reset();
  objective.remove();
  bots.spawnRound(round);
  hud.setScore(state.score.vanguard, state.score.dusk, round);
  hud.setMoney(state.money);
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
  hud.hidePlant();
  hud.setDefuseAlert(false);
  hud.hideScoreboard();
  hud.showBuy(BUY_SECONDS);
  hud.toast(`Round ${round} — buy what you need, then push a site.`);
}

function endRound(winner, reason) {
  if (state.phase === PHASE.OVER || state.phase === PHASE.MATCH) return;
  state.phase = PHASE.OVER;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  state.money += winner === 'vanguard' ? REWARDS.win : REWARDS.loss;
  state.freeze = true;
  overTimer = 5;
  bots.resetChannels();
  hud.hidePlant();
  hud.setDefuseAlert(false);
  hud.hideBuy();
  hud.setScore(state.score.vanguard, state.score.dusk, state.round);
  hud.setMoney(state.money);
  const won = winner === 'vanguard';
  hud.banner(won, won ? 'ROUND WON' : 'ROUND LOST', `${reason} — Vanguard ${state.score.vanguard} : ${state.score.dusk} Dusk`);
  if (won) audio.roundWin();
  else audio.roundLoss();
}

function step(dt) {
  state.time += dt;
  const frozen = state.freeze || state.phase === PHASE.BUY || state.phase === PHASE.OVER || state.phase === PHASE.MATCH;
  if (body.alive) player.step(dt, input.state.keys, frozen);
  weapon.step(dt);
  grenades.step(dt, state.time);

  if (state.phase === PHASE.BUY) {
    state.roundTime -= dt;
    hud.showBuy(Math.max(0, state.roundTime));
    if (state.roundTime <= 0) {
      state.phase = PHASE.LIVE;
      state.roundTime = ROUND_SECONDS;
      state.freeze = false;
      hud.hideBuy();
      hud.toast('Round live — plant the charge at A or B.');
      // If the player never locked the pointer during the buy phase, offer the
      // deploy panel now instead of leaving them unlocked in a live round.
      if (!shot && !input.state.locked && body.alive) hud.showOverlay('paused', state.score);
    }
  } else if (state.phase === PHASE.LIVE) {
    // Plant channel: hold E inside a site while carrying the charge.
    const inA = world.inSite(body.position.x, body.position.z, 'A');
    const inB = world.inSite(body.position.x, body.position.z, 'B');
    const site = inA ? 'A' : inB ? 'B' : null;
    if (body.alive && state.carrier === 'player' && !state.planted && input.state.keys.has('KeyE') && site) {
      if (player.groundSpeed() < 1.5) {
        state.planting += dt / PLANT_SECONDS;
        hud.setPlant('Planting charge…', Math.min(1, state.planting));
        if (state.planting >= 1) doPlant(site, true);
      } else {
        hud.setPlant('Stand still to plant', Math.min(1, state.planting));
      }
    } else if (state.planting > 0) {
      state.planting = Math.max(0, state.planting - dt / 1.5);
      if (state.planting === 0) hud.hidePlant();
    }
    hud.setSiteTag(site && state.carrier === 'player' && !state.planted ? `SITE ${site} — hold E to plant` : '');

    if (state.planted) {
      state.fuseTime -= dt;
      objective.step(dt, state.fuseTime);
      const defuser = bots.bots.find((b) => b.id === state.defuser && b.alive);
      hud.setDefuseAlert(!!defuser);
      if (state.fuseTime <= 0) {
        audio.explosion();
        endRound('vanguard', 'Charge detonated');
      }
    } else {
      state.roundTime -= dt;
      if (state.roundTime <= 0) endRound('dusk', 'Time expired — site held');
    }

    bots.step(dt, state.time, body, state);

    // Round-end checks.
    if (state.phase === PHASE.LIVE) {
      const vanguardAlive = bots.aliveCount('vanguard') + (body.alive ? 1 : 0);
      const duskAlive = bots.aliveCount('dusk');
      if (duskAlive === 0) {
        endRound('vanguard', state.planted ? 'Defenders eliminated' : 'Squad eliminated');
      } else if (vanguardAlive === 0 && !state.planted) {
        endRound('dusk', 'Squad eliminated');
      }
    }
  } else if (state.phase === PHASE.OVER) {
    overTimer -= dt;
    if (overTimer <= 0) {
      if (state.score.vanguard >= ROUNDS_TO_WIN || state.score.dusk >= ROUNDS_TO_WIN) {
        state.phase = PHASE.MATCH;
        state.matchWinner = state.score.vanguard > state.score.dusk ? 'vanguard' : 'dusk';
        const won = state.matchWinner === 'vanguard';
        hud.showOverlay('match', state.score, won ? 'Vanguard takes Meridian Yard.' : 'Dusk holds Meridian Yard.');
        hud.showScoreboard(scoreboardRows(), `Match — Vanguard ${state.score.vanguard} : ${state.score.dusk} Dusk`);
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        startRound(state.round + 1);
      }
    }
  }

  // Tracers fade.
  for (const tracer of tracers) {
    if (tracer.life <= 0) continue;
    tracer.life -= dt;
    tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.9;
    if (tracer.life <= 0) tracer.line.visible = false;
  }

  // HUD, every step (the HUD itself caches unchanged values).
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setTimer(state.phase === PHASE.LIVE ? state.roundTime : state.phase === PHASE.BUY ? state.roundTime : 0, state.planted, state.fuseTime);
  hud.setSpread(6 + weapon.spread(player.groundSpeed(), body.aiming, body.crouching) * 2600);
  if (!body.alive && !spectateBot) {
    const alive = bots.bots.filter((b) => b.team === 'vanguard' && b.alive);
    if (alive.length) spectateBot = alive[0];
  }
}

function frame() {
  requestAnimationFrame(frame);
  window.__frames = (window.__frames || 0) + 1;
  // performance.now() — not the rAF timestamp — so a stale or backwards frame time
  // (headless BeginFrames, tab switches) can never drive the sim backwards.
  const now = performance.now();
  const dt = Math.min(Math.max(0, (now - lastTime) / 1000), 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    // Automatic weapons fire while held; semi-automatic ones need a fresh click.
    const wantFire = weapon.spec().auto ? input.state.firing : input.takePressed();
    if (wantFire && weapon.ready() && state.phase === PHASE.LIVE && body.alive && !state.freeze) {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed(), body.aiming, body.crouching));
    }
    if (input.state.keys.has('KeyR') && weapon.state.reloadLeft === 0 && weapon.state.mag < weapon.spec().mag) weapon.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideScoreboard();
  started = true;
  if (name === 'start') {
    startRound(1);
    body.position.set(0, 0, 19);
    body.yaw = 0;
    body.pitch = 0.02;
    state.roundTime = 12;
    settle(20);
    hud.showBuy(12);
  } else if (name === 'play') {
    startRound(1);
    state.phase = PHASE.LIVE;
    state.roundTime = 87;
    state.freeze = false;
    hud.hideBuy();
    body.position.set(0, 0, 12);
    body.yaw = 0;
    body.pitch = 0;
    // Stage a firefight: two Dusk bots ahead in mid, one ally on the flank.
    const dusk = bots.bots.filter((b) => b.team === 'dusk');
    dusk[0].position.set(-1.5, 0, 3);
    dusk[0].yaw = Math.PI;
    dusk[0].mode = 'hold';
    dusk[1].position.set(3, 0, 1);
    dusk[1].yaw = Math.PI;
    dusk[1].mode = 'hold';
    const ally = bots.bots.find((b) => b.team === 'vanguard');
    ally.position.set(-4, 0, 8);
    ally.yaw = 0;
    ally.mode = 'hold';
    settle(10);
    weapon.equip('rifle');
    owned.add('rifle');
    hud.setWeapon(weapon.spec().name, weapon.state.grenades, weapon.state.grenadeSelected);
    aimAt(new THREE.Vector3(-1.5, 1.2, 3));
    shoot(0);
    settle(6);
  } else {
    startRound(1);
    state.score.vanguard = 2;
    state.score.dusk = 1;
    state.kills = 2;
    endRound('vanguard', 'Charge detonated');
    hud.setScore(3, 1, 1);
    // Scoreboard + banner carry this shot; the round-over panel would cover them.
    hud.showScoreboard(scoreboardRows(), 'Round 1 — Vanguard wins');
    settle(10);
  }
  hud.setScore(state.score.vanguard, state.score.dusk, state.round);
  hud.setMoney(state.money);
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setTimer(state.phase === PHASE.LIVE ? state.roundTime : state.phase === PHASE.BUY ? state.roundTime : 0, state.planted, state.fuseTime);
  // Re-show the round banner for the end shot: its 4.2 s real-time hold can lapse while
  // SwiftShader warms up, and the shot must show it.
  if (name === 'end') hud.banner(true, 'ROUND WON', 'Charge detonated — Vanguard 3 : 1 Dusk');
  paintTwiceThenReady();
}

let accumulator = 0;
let lastTime = performance.now();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start', state.score);
  requestAnimationFrame(frame);
}
