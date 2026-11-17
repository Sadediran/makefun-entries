// The armoury: four hitscan weapons plus two grenades, all bought with round money in
// economy.js. Each weapon owns its numbers — damage, headshot multiplier, fire gap, magazine,
// spread and recoil — and its view model; main.js owns the ray and the damage roll.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', price: 0, auto: false,
    damage: 26, headMult: 3, fireGap: 0.16, reloadTime: 1.4, mag: 12, reserve: 48,
    spreadStill: 0.002, spreadMove: 0.02, recoil: 0.007, range: 60, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longline', short: 'VK-47', price: 2700, auto: true,
    damage: 33, headMult: 3, fireGap: 0.1, reloadTime: 2.0, mag: 30, reserve: 90,
    spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.011, range: 90, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', short: 'Hornet', price: 1500, auto: true,
    damage: 22, headMult: 2.5, fireGap: 0.068, reloadTime: 1.7, mag: 32, reserve: 96,
    spreadStill: 0.004, spreadMove: 0.034, recoil: 0.007, range: 55, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'Needle DMR', short: 'Needle', price: 4750, auto: false,
    damage: 88, headMult: 2.5, fireGap: 1.15, reloadTime: 2.8, mag: 5, reserve: 15,
    spreadStill: 0.0006, spreadMove: 0.06, recoil: 0.05, range: 120, zoom: 2.6,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag charge', price: 300, radius: 7, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke canister', price: 300, radius: 4.5, duration: 14 },
};

const VIEW = {
  pistol: { barrel: 0.16, body: '#3a3f4d', accent: '#f2ead9', grip: true },
  rifle: { barrel: 0.42, body: '#f2ead9', accent: '#b4552d', grip: true },
  smg: { barrel: 0.26, body: '#3f6d8e', accent: '#37c8a3', grip: true },
  sniper: { barrel: 0.62, body: '#232838', accent: '#e8a33d', grip: true },
};

export function createWeapon(camera) {
  const models = {};
  for (const [id, spec] of Object.entries(VIEW)) {
    const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.body), roughness: 0.5, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.accent), roughness: 0.45, metalness: 0.3 });
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, spec.barrel), gripMat);
    barrel.position.set(0, 0.025, -0.17 - spec.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), gripMat);
    stock.position.set(0, -0.02, 0.26);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06), accentMat);
    sight.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, stock, sight);
    if (id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), accentMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, -0.02);
      model.add(scope);
    }
    if (id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), gripMat);
      mag.position.set(0, -0.12, 0.02);
      mag.rotation.x = 0.15;
      model.add(mag);
    }
    model.position.set(0.26, -0.24, -0.5);
    model.scale.setScalar(0.85);
    model.visible = false;
    camera.add(model);
    models[id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.21, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb066'), 0, 6);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  const state = {
    id: 'pistol', mag: 12, reserve: 48, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, grenades: { frag: 0, smoke: 0 }, grenadeSelected: 'frag',
  };

  function equip(id) {
    const spec = WEAPONS[id];
    state.id = id;
    state.mag = spec.mag;
    state.reserve = spec.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    for (const [key, model] of Object.entries(models)) model.visible = key === id;
  }

  function spec() {
    return WEAPONS[state.id];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.id];
    const s = spec();
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (s.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = s.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  equip('pistol');

  return {
    state,
    step,
    equip,
    spec,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = spec().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const s = spec();
      if (state.reloadLeft > 0 || state.mag === s.mag || state.reserve === 0) return;
      state.reloadLeft = s.reloadTime;
    },
    // Spread grows with movement speed and shrinks while aiming: stopping to aim pays.
    spread(speed, aiming, crouching) {
      const s = spec();
      let value = s.spreadStill + Math.min(1, speed / 5.2) * s.spreadMove;
      if (aiming) value *= 0.45;
      if (crouching) value *= 0.8;
      return value;
    },
    refillAmmo() {
      const s = spec();
      state.mag = s.mag;
      state.reserve = s.reserve;
    },
  };
}
