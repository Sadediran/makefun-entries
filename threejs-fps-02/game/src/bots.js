// The bots: nine opponents and teammates who walk waypoint routes, hold positions, react
// to sight and sound, and play the objective. Vanguard (teal) attacks with the player;
// Dusk (rust) defends the sites, rotates on a plant, and sends one bot to defuse.
// A bot is a small state machine: advance -> hold -> engage -> investigate -> plant/defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE = 1.55;
const WALK_SPEED = 3.4;
const SIGHT_RANGE = 38;
const SIGHT_HALF_ANGLE = 1.15; // ~66 degrees
const HEAR_GUNSHOT = 26;
const HEAR_QUIET = 10;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;

const NAMES_VANGUARD = ['Kite', 'Bram', 'Sable', 'Wren'];
const NAMES_DUSK = ['Ash', 'Flint', 'Onyx', 'Rook', 'Slate'];

function bfsPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift();
    for (const next of waypoints[current].links) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      if (next === to) {
        const path = [to];
        let node = to;
        while (prev.get(node) !== -1) {
          node = prev.get(node);
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, hooks) {
  // hooks: {onDamagePlayer(amount, fromPos), onBotShot(from, to), onNoise(x, z, radius),
  //         onBotKilled(bot, byPlayer), onPlantStarted(), onPlantDone(site), onDefuseDone()}
  const bots = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const probe = new THREE.Box3();

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const padGeo = new THREE.BoxGeometry(0.56, 0.1, 0.34);

  function makeBot(id, team, name, spawn, weapon) {
    const teamColour = team === 'vanguard' ? PALETTE.accent : PALETTE.rust;
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'vanguard' ? '#2c4a44' : '#4a2c22'), roughness: 0.75 });
    const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColour), roughness: 0.5, metalness: 0.2 });
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8a06a'), roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.05;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.58;
    head.userData.part = 'head';
    const pad = new THREE.Mesh(padGeo, trimMat);
    pad.position.y = 1.42;
    const legL = new THREE.Mesh(legGeo, bodyMat);
    legL.position.set(-0.13, 0.35, 0);
    const legR = new THREE.Mesh(legGeo, bodyMat);
    legR.position.set(0.13, 0.35, 0);
    const gun = new THREE.Mesh(gunGeo, trimMat);
    gun.position.set(0.18, 1.05, -0.3);
    group.add(torso, head, pad, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);
    const bot = {
      id, team, name, group, torso, head, gun, weapon,
      position: group.position, // alias: group.position IS the position
      yaw: team === 'vanguard' ? 0 : Math.PI, // vanguard faces north, dusk faces south
      health: 100, alive: true, fall: 0,
      mode: 'advance', // advance | hold | engage | investigate | plant | defuse | dead
      path: [], pathIndex: 0, pathTarget: -1, holdNode: -1, holdUntil: 0,
      target: null, // enemy bot or 'player'
      lastSeen: null, // {x, z} last known enemy position
      lastSeenAt: -99,
      burstLeft: 0, burstPause: 0, shootTimer: 0,
      strafeDir: 1, strafeTimer: 0,
      channel: 0, // plant/defuse progress 0..1
      channelSite: null,
      investigateUntil: 0,
      speed: WALK_SPEED,
      kills: 0,
      deaths: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    return bot;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    world.waypoints.forEach((w, i) => {
      const d = (w.x - x) ** 2 + (w.z - z) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function setPath(bot, toNode) {
    const from = nearestNode(bot.position.x, bot.position.z);
    bot.path = bfsPath(world.waypoints, from, toNode);
    bot.pathIndex = 0;
    bot.pathTarget = toNode;
  }

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.05, z + BOT_RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    const targetYaw = Math.atan2(-dx, -dz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 8);
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    return dist < 0.4;
  }

  function hasLineOfSight(ax, ay, az, bx, by, bz) {
    if (hooks.smokeBlocks && hooks.smokeBlocks(ax, ay, az, bx, by, bz)) return false;
    tmpA.set(bx - ax, by - ay, bz - az);
    const dist = tmpA.length();
    if (dist < 0.01) return true;
    tmpA.multiplyScalar(1 / dist);
    raycaster.set(tmpB.set(ax, ay, az), tmpA);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  function canSee(bot, ex, ey, ez) {
    const dx = ex - bot.position.x;
    const dz = ez - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT_RANGE) return false;
    if (dist > 2) {
      const facing = Math.atan2(-Math.sin(bot.yaw), -Math.cos(bot.yaw));
      const toTarget = Math.atan2(dx, dz);
      let diff = toTarget - facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > SIGHT_HALF_ANGLE) return false;
    }
    return hasLineOfSight(bot.position.x, EYE, bot.position.z, ex, ey, ez);
  }

  function pickTarget(bot, player) {
    // Returns {kind: 'player'|'bot', ref, x, y, z, dist} or null.
    let best = null;
    if (player.alive && bot.team === 'dusk') {
      const px = player.position.x;
      const py = player.position.y + player.eye * 0.85;
      const pz = player.position.z;
      if (canSee(bot, px, py, pz)) {
        best = { kind: 'player', ref: player, x: px, y: py, z: pz, dist: Math.hypot(px - bot.position.x, pz - bot.position.z) };
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const ox = other.position.x;
      const oy = other.position.y + 1.2;
      const oz = other.position.z;
      if (!canSee(bot, ox, oy, oz)) continue;
      const dist = Math.hypot(ox - bot.position.x, oz - bot.position.z);
      if (!best || dist < best.dist) best = { kind: 'bot', ref: other, x: ox, y: oy, z: oz, dist };
    }
    return best;
  }

  function shootAt(bot, target, dt) {
    bot.shootTimer -= dt;
    if (bot.shootTimer > 0) return;
    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.burstPause = 0.45 + Math.random() * 0.5;
    }
    bot.burstLeft -= 1;
    bot.shootTimer = bot.weapon === 'smg' ? 0.09 : 0.13;
    // Aim with error that grows with range and target speed; a still target at close
    // range is dangerous, a sprinting one at 30 m is not.
    const spread = 0.02 + target.dist * 0.0011;
    tmpA.set(target.x - bot.position.x, target.y - EYE, target.z - bot.position.z).normalize();
    tmpA.x += (Math.random() * 2 - 1) * spread;
    tmpA.y += (Math.random() * 2 - 1) * spread;
    tmpA.z += (Math.random() * 2 - 1) * spread;
    tmpA.normalize();
    const from = tmpB.set(bot.position.x, EYE, bot.position.z);
    const to = tmpC.copy(from).addScaledVector(tmpA, 60);
    hooks.onBotShot(from, to, bot.team);
    raycaster.set(from, tmpA);
    raycaster.far = 60;
    const wall = raycaster.intersectObjects(world.shootables, false)[0];
    const wallDist = wall ? wall.distance : Infinity;
    // Did the ray pass within a body radius of the target?
    const tx = target.x - from.x;
    const ty = target.y - from.y;
    const tz = target.z - from.z;
    const along = tx * tmpA.x + ty * tmpA.y + tz * tmpA.z;
    if (along > 0 && along < wallDist) {
      const cx = from.x + tmpA.x * along - target.x;
      const cy = from.y + tmpA.y * along - target.y;
      const cz = from.z + tmpA.z * along - target.z;
      if (cx * cx + cy * cy + cz * cz < 0.45) {
        const base = bot.weapon === 'smg' ? 16 : 24;
        const damage = Math.round(base * (target.dist > 25 ? 0.75 : 1));
        if (target.kind === 'player') hooks.onDamagePlayer(damage, bot.position);
        else damageBot(target.ref, damage, bot);
      }
    }
  }

  function damageBot(bot, amount, attacker) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.mode = 'dead';
      bot.fall = 0;
      bot.channel = 0;
      bot.deaths += 1;
      if (attacker && attacker !== 'player' && attacker.kills !== undefined) attacker.kills += 1;
      hooks.onBotKilled(bot, attacker === 'player');
    } else if (bot.mode !== 'engage') {
      // Shot at: a channel (plant or defuse) is interrupted and restarts.
      bot.channel = 0;
      bot.mode = 'investigate';
      bot.investigateUntil = hooks.now() + 4;
      if (attacker && attacker !== 'player' && attacker.position) {
        bot.lastSeen = { x: attacker.position.x, z: attacker.position.z };
      }
    }
  }

  function hearNoise(bot, x, z, radius) {
    if (!bot.alive) return;
    const d = Math.hypot(x - bot.position.x, z - bot.position.z);
    if (d > radius) return;
    if (bot.mode === 'engage' || bot.mode === 'plant' || bot.mode === 'defuse') return;
    bot.mode = 'investigate';
    bot.lastSeen = { x, z };
    bot.investigateUntil = hooks.now() + 5;
    setPath(bot, nearestNode(x, z));
  }

  function spawnRound(round, carrier) {
    // Clear old bots.
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    const vSpawns = [[0, 19], [-3, 20], [3, 20], [-6, 18]];
    const dSpawns = [[0, -19], [-3, -20], [3, -20], [-8, -18], [8, -18]];
    const vWeapons = ['rifle', 'smg', 'rifle', 'smg'];
    const dWeapons = ['rifle', 'smg', 'rifle', 'smg', 'rifle'];
    for (let i = 0; i < 4; i += 1) {
      bots.push(makeBot(`v${i}`, 'vanguard', NAMES_VANGUARD[i], vSpawns[i], vWeapons[i]));
    }
    for (let i = 0; i < 5; i += 1) {
      bots.push(makeBot(`d${i}`, 'dusk', NAMES_DUSK[i], dSpawns[i], dWeapons[i]));
    }
    // Dusk holds: two on A, two on B, one roaming mid.
    const dusk = bots.filter((b) => b.team === 'dusk');
    dusk[0].holdNode = 8; dusk[1].holdNode = 9; dusk[2].holdNode = 12; dusk[3].holdNode = 13; dusk[4].holdNode = 4;
    for (const bot of dusk) setPath(bot, bot.holdNode);
    // Vanguard pushes: two toward A, two toward B.
    const vang = bots.filter((b) => b.team === 'vanguard');
    vang[0].holdNode = 8; vang[1].holdNode = 9; vang[2].holdNode = 12; vang[3].holdNode = 13;
    vang[0].path = [1, 2, 6, 7, 8];
    vang[1].path = [1, 4, 14, 9, 8];
    vang[2].path = [1, 3, 10, 11, 12];
    vang[3].path = [1, 4, 15, 13, 12];
    for (const bot of vang) bot.pathIndex = 0;
    return bots;
  }

  function step(dt, time, player, state) {
    // The defuse job is assigned once, up front, so a bot busy fighting still gets
    // replaced when it dies — the round always has someone playing the objective.
    if (state.planted && state.phase === 'live') {
      const defuserAlive = bots.some((b) => b.id === state.defuser && b.alive);
      if (!state.defuser || !defuserAlive) {
        const alive = bots.filter((b) => b.team === 'dusk' && b.alive);
        if (alive.length) {
          const marker = world.markers[state.plantSite];
          alive.sort((a, b) => Math.hypot(a.position.x - marker.cx, a.position.z - marker.cz) - Math.hypot(b.position.x - marker.cx, b.position.z - marker.cz));
          state.defuser = alive[0].id;
        } else {
          state.defuser = null;
        }
      }
    }
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.45);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      // Look for something to shoot at first — combat interrupts everything but a channel.
      const target = pickTarget(bot, player);
      if (target) {
        bot.lastSeen = { x: target.x, z: target.z };
        bot.lastSeenAt = time;
        if (bot.mode !== 'engage') bot.mode = 'engage';
        bot.target = target;
      } else if (bot.mode === 'engage' && time - bot.lastSeenAt > 1.2) {
        bot.mode = 'investigate';
        bot.investigateUntil = time + 3;
        if (bot.lastSeen) setPath(bot, nearestNode(bot.lastSeen.x, bot.lastSeen.z));
      }

      // The designated defuser plays the objective, not the firefight: it walks to
      // the site and channels the defuse even while enemies are visible.
      if (state.planted && bot.team === 'dusk' && state.defuser === bot.id) {
        if (world.inSite(bot.position.x, bot.position.z, state.plantSite)) {
          bot.mode = 'defuse';
        } else {
          bot.mode = 'advance';
          const siteNode = state.plantSite === 'A' ? 8 : 12;
          if (bot.pathTarget !== siteNode || bot.pathIndex >= bot.path.length) setPath(bot, siteNode);
        }
      }

      if (bot.mode === 'engage' && bot.target) {
        const t = bot.target;
        const dx = t.x - bot.position.x;
        const dz = t.z - bot.position.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let dy = targetYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += dy * Math.min(1, dt * 10);
        // Strafe to stay a hard target, but hold ground at long range.
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir *= -1;
          bot.strafeTimer = 0.7 + Math.random() * 0.8;
        }
        if (t.dist > 8) {
          const sx = Math.cos(bot.yaw) * bot.strafeDir;
          const sz = -Math.sin(bot.yaw) * bot.strafeDir;
          const nx = bot.position.x + sx * WALK_SPEED * 0.5 * dt;
          const nz = bot.position.z + sz * WALK_SPEED * 0.5 * dt;
          if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
          if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
        }
        shootAt(bot, t, dt);
        continue;
      }

      // Objective channels.
      if (bot.mode === 'plant') {
        bot.channel += dt / PLANT_TIME;
        if (bot.channel >= 1) {
          bot.channel = 0;
          bot.mode = 'hold';
          hooks.onPlantDone(bot.channelSite);
        }
        continue;
      }
      if (bot.mode === 'defuse') {
        bot.channel += dt / DEFUSE_TIME;
        if (bot.channel >= 1) {
          bot.channel = 0;
          bot.mode = 'hold';
          hooks.onDefuseDone();
        }
        continue;
      }

      // Carrier duty: the Vanguard bot carrying the device pushes a site and plants.
      if (state.carrier === bot.id && state.phase === 'live' && !state.planted) {
        const site = bot.channelSite || (Math.random() < 0.5 ? 'A' : 'B');
        bot.channelSite = site;
        const siteNode = site === 'A' ? 8 : 12;
        if (world.inSite(bot.position.x, bot.position.z, site)) {
          if (bot.mode !== 'plant') {
            bot.mode = 'plant';
            bot.channel = 0;
            hooks.onPlantStarted(bot, site);
          }
          continue;
        }
        if (bot.mode !== 'advance' || bot.holdNode !== siteNode) {
          bot.holdNode = siteNode;
          setPath(bot, siteNode);
          bot.mode = 'advance';
        }
      }

      // Planted: the rest of Dusk converges on the site to fight for it.
      if (state.planted && bot.team === 'dusk' && state.phase === 'live' && state.defuser !== bot.id) {
        const siteNode = state.plantSite === 'A' ? 8 : 12;
        if (bot.mode !== 'advance' && bot.mode !== 'engage' && bot.pathTarget !== siteNode) {
          setPath(bot, siteNode);
          bot.mode = 'advance';
        }
      }

      // Walk the path, then hold and scan.
      if (bot.mode === 'advance') {
        if (bot.pathIndex < bot.path.length) {
          const node = world.waypoints[bot.path[bot.pathIndex]];
          if (moveToward(bot, node.x, node.z, dt, WALK_SPEED)) bot.pathIndex += 1;
        } else {
          bot.mode = 'hold';
          bot.holdUntil = time + 2.5 + Math.random() * 2;
        }
      } else if (bot.mode === 'hold') {
        bot.yaw += Math.sin(time * 0.5 + bot.id.charCodeAt(1)) * dt * 0.6;
        if (time > bot.holdUntil && bot.team === 'dusk' && bot.holdNode === 4) {
          // The mid roamer patrols between mid and the sites.
          bot.holdNode = Math.random() < 0.5 ? 9 : 13;
          setPath(bot, bot.holdNode);
          bot.mode = 'advance';
        }
      } else if (bot.mode === 'investigate') {
        if (time > bot.investigateUntil) {
          bot.mode = 'advance';
          setPath(bot, bot.holdNode >= 0 ? bot.holdNode : nearestNode(bot.position.x, bot.position.z));
        } else if (bot.pathIndex < bot.path.length) {
          const node = world.waypoints[bot.path[bot.pathIndex]];
          if (moveToward(bot, node.x, node.z, dt, WALK_SPEED * 1.25)) bot.pathIndex += 1;
        } else {
          bot.yaw += dt * 1.4; // scan around the noise
        }
      }

      bot.group.rotation.y = bot.yaw;
    }
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (bot.alive) meshes.push(bot.torso, bot.head);
    }
    return meshes;
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function resetChannels() {
    for (const bot of bots) {
      if (bot.mode === 'plant' || bot.mode === 'defuse') bot.mode = 'hold';
      bot.channel = 0;
    }
  }

  return {
    bots,
    spawnRound,
    step,
    damageBot,
    hearNoise,
    hitMeshes,
    aliveCount,
    resetChannels,
    nearestNode,
    setPath,
  };
}
