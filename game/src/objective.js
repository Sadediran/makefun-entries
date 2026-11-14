// The device: the charge Vanguard plants and Dusk defuses. One blinking box with a fuse
// light; main.js owns the timers, this module owns the mesh and the site checks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createObjective(scene, world) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rustDark), roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.1;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
  );
  light.position.set(0.1, 0.22, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.6 }),
  );
  antenna.position.set(-0.12, 0.3, 0);
  group.add(body, light, antenna);
  group.visible = false;
  scene.add(group);

  let blink = 0;
  let plantedAt = null;

  return {
    plant(site) {
      const marker = world.markers[site];
      group.position.set(marker.cx, 0, marker.cz);
      group.visible = true;
      plantedAt = { x: marker.cx, z: marker.cz, site };
      blink = 0;
    },
    remove() {
      group.visible = false;
      plantedAt = null;
    },
    step(dt, fuseLeft) {
      if (!plantedAt) return;
      blink += dt;
      const on = Math.sin(blink * (fuseLeft < 10 ? 14 : 6)) > 0;
      light.material.color.set(on ? PALETTE.danger : '#330a0a');
    },
    plantedAt() {
      return plantedAt;
    },
  };
}
