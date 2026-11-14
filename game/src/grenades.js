// Grenades: a frag charge that arcs and bursts, and a smoke canister that blooms into a
// cloud bots cannot see through. Thrown by the player (Q); the cloud list is what bots.js
// asks before it trusts a line of sight. No per-frame allocations in the hot path.
import * as THREE from 'three';
import { GRENADES } from './weapons.js';

const GRAVITY = 12;

export function createGrenades(scene) {
  const items = []; // {kind, mesh, velocity, fuse, state, cloud}
  const smokes = []; // {x, y, z, radius, until} — live clouds, read by bots.js
  const tmp = new THREE.Vector3();
  let now = 0;

  const fragMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4d, roughness: 0.5, metalness: 0.5 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9, metalness: 0 });
  const fragGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const cloudGeo = new THREE.SphereGeometry(1, 16, 12);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xcfd4d8, transparent: true, opacity: 0.55, depthWrite: false,
  });

  function throwGrenade(kind, origin, direction, callbacks) {
    const mesh = new THREE.Mesh(fragGeo, kind === 'frag' ? fragMat : smokeMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    const velocity = direction.clone().multiplyScalar(13);
    velocity.y += 4.5;
    items.push({
      kind, mesh, velocity, fuse: kind === 'frag' ? 1.4 : 0.9,
      state: 'flying', cloud: null, callbacks,
    });
  }

  function explode(item) {
    const spec = GRENADES[item.kind];
    const p = item.mesh.position;
    if (item.kind === 'frag') {
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      ring.position.copy(p);
      scene.add(ring);
      item.ring = ring;
      item.ringLife = 0.35;
      item.callbacks.onFrag(p, spec.radius, spec.damage);
      item.callbacks.onSound('explosion', p);
    } else {
      const cloud = new THREE.Mesh(cloudGeo, cloudMat.clone());
      cloud.position.copy(p);
      cloud.scale.setScalar(0.4);
      scene.add(cloud);
      item.cloud = cloud;
      item.until = now + spec.duration;
      smokes.push({ x: p.x, y: p.y, z: p.z, radius: spec.radius, until: now + spec.duration });
      item.callbacks.onSound('smoke', p);
    }
  }

  function step(dt, time) {
    now = time;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.state === 'flying') {
        item.velocity.y -= GRAVITY * dt;
        item.mesh.position.addScaledVector(item.velocity, dt);
        if (item.mesh.position.y <= 0.09) {
          item.mesh.position.y = 0.09;
          item.velocity.set(item.velocity.x * 0.4, Math.abs(item.velocity.y) * 0.3, item.velocity.z * 0.4);
          if (item.velocity.lengthSq() < 1) item.velocity.set(0, 0, 0);
        }
        item.fuse -= dt;
        if (item.fuse <= 0) {
          item.state = 'done';
          explode(item);
        }
      } else if (item.ring) {
        item.ringLife -= dt;
        item.ring.scale.setScalar(1 + (0.35 - item.ringLife) * 2);
        item.ring.material.opacity = Math.max(0, item.ringLife / 0.35) * 0.35;
        if (item.ringLife <= 0) {
          scene.remove(item.ring);
          item.ring.material.dispose();
          item.ring = null;
          scene.remove(item.mesh);
          items.splice(i, 1);
        }
      } else if (item.cloud) {
        const target = GRENADES.smoke.radius;
        const s = item.cloud.scale.x + (target - item.cloud.scale.x) * Math.min(1, dt * 2);
        item.cloud.scale.setScalar(s);
        if (now > item.until) {
          scene.remove(item.cloud);
          item.cloud.material.dispose();
          scene.remove(item.mesh);
          items.splice(i, 1);
        }
      } else {
        scene.remove(item.mesh);
        items.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      if (smokes[i].until <= now) smokes.splice(i, 1);
    }
  }

  // Does the segment a->b pass through any live smoke cloud? Bots call this per sight check.
  function blockedBySmoke(ax, ay, az, bx, by, bz) {
    for (const c of smokes) {
      tmp.set(bx - ax, by - ay, bz - az);
      const lenSq = tmp.lengthSq();
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * tmp.x + (c.y - ay) * tmp.y + (c.z - az) * tmp.z) / lenSq));
      const dx = ax + tmp.x * t - c.x;
      const dy = ay + tmp.y * t - c.y;
      const dz = az + tmp.z * t - c.z;
      if (dx * dx + dy * dy + dz * dz < c.radius * c.radius) return true;
    }
    return false;
  }

  function reset() {
    for (const item of items) {
      if (item.ring) scene.remove(item.ring);
      if (item.cloud) scene.remove(item.cloud);
      scene.remove(item.mesh);
    }
    items.length = 0;
    smokes.length = 0;
  }

  return { throwGrenade, step, blockedBySmoke, reset, smokes };
}
