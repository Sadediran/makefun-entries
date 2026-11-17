// Meridian Yard — an original 64 x 48 m freight yard at dusk. Two bomb sites (A west,
// B east), a mid lane, west and east lanes, Vanguard spawning south, Dusk north. Every box
// is a collider for players and bots and a surface a bullet stops on. Plain geometry only:
// no models, no textures from disk; the ground pattern is painted on a canvas in code.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Site rectangles: a plant counts when the planter stands inside one.
export const SITE_A = { x0: -30, x1: -17, z0: -20, z1: -7 };
export const SITE_B = { x0: 17, x1: 30, z0: -20, z1: -7 };
export const VANGUARD_SPAWNS = [[0, 19], [-3, 20], [3, 20], [-6, 18], [6, 18]];
export const DUSK_SPAWNS = [[0, -19], [-3, -20], [3, -20], [-8, -18], [8, -18]];

// Waypoint graph the bots walk. [x, z, ...linked node indices]
const WAYPOINTS = [
  [0, 19, 1, 2, 3], // 0 vanguard spawn
  [0, 12, 0, 2, 3, 4], // 1 mid south
  [-12, 12, 0, 1, 6, 14], // 2 west connector
  [12, 12, 0, 1, 10, 15], // 3 east connector
  [0, 0, 1, 14, 15, 5], // 4 mid
  [0, -8, 4, 9, 13, 16], // 5 mid north
  [-22, 12, 2, 7], // 6 west lane south
  [-22, 0, 6, 8, 14], // 7 west lane mid
  [-24, -13, 7, 9, 17], // 8 site A
  [-14, -12, 5, 8, 14], // 9 A approach
  [22, 12, 3, 11], // 10 east lane south
  [22, 0, 10, 12, 15], // 11 east lane mid
  [24, -13, 11, 13, 18], // 12 site B
  [14, -12, 5, 12, 15], // 13 B approach
  [-12, -2, 2, 4, 7, 9], // 14 west-mid connector
  [12, -2, 3, 4, 11, 13], // 15 east-mid connector
  [0, -18, 5, 17, 18], // 16 dusk spawn
  [-22, -18, 8, 16], // 17 A north
  [22, -18, 12, 16], // 18 B north
  [-6, 6, 1, 2, 4], // 19 south-west pocket
  [6, 6, 1, 3, 4], // 20 south-east pocket
];

function groundTexture(random) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i += 1) {
    const shade = random();
    ctx.fillStyle = shade < 0.5 ? PALETTE.sandDark : '#d9b47f';
    ctx.globalAlpha = 0.12 + random() * 0.22;
    const s = 1 + random() * 3;
    ctx.fillRect(random() * 256, random() * 256, s, s);
  }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = PALETTE.sandDark;
  for (let i = 0; i < 14; i += 1) {
    ctx.beginPath();
    ctx.ellipse(random() * 256, random() * 256, 12 + random() * 30, 8 + random() * 18, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function letterTexture(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,22,28,0.85)';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene, seed = 1) {
  let a = seed;
  const random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: name === 'hairline' || name === 'containerBlue' ? 0.35 : 0.04,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground: sand yard with a concrete apron at each site.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshStandardMaterial({ map: groundTexture(random), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const apronA = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), materials.surface);
  apronA.rotation.x = -Math.PI / 2;
  apronA.position.set(-23.5, 0.01, -13.5);
  apronA.receiveShadow = true;
  group.add(apronA);
  const apronB = apronA.clone();
  apronB.position.set(23.5, 0.01, -13.5);
  group.add(apronB);

  // Perimeter: 5 m walls, open sky above so the dusk sun reaches every corner.
  box(64.8, 5, 0.6, 0, 2.5, -24.3, 'surface');
  box(64.8, 5, 0.6, 0, 2.5, 24.3, 'surface');
  box(0.6, 5, 48.8, -32.3, 2.5, 0, 'surface');
  box(0.6, 5, 48.8, 32.3, 2.5, 0, 'surface');

  // Mid: a twin-pillar gate with a beam — the yard's landmark, splitting the lane.
  box(1.4, 4.2, 1.4, -2.2, 2.1, -1, 'rustDark');
  box(1.4, 4.2, 1.4, 2.2, 2.1, -1, 'rustDark');
  box(6.2, 0.8, 1.4, 0, 4.4, -1, 'rust');
  box(3.4, 1.1, 1.2, -5.5, 0.55, 6, 'hairline'); // crouch cover, south mid
  box(3.4, 1.1, 1.2, 5.5, 0.55, 6, 'hairline');
  box(1.2, 1.1, 3.6, -8, 0.55, -8, 'hairline'); // west-mid wall
  box(1.2, 1.1, 3.6, 8, 0.55, -8, 'hairline'); // east-mid wall

  // Site A (west): a blue container row and crate stack, open sightline from the gate.
  box(6.4, 2.6, 2.6, -27, 1.3, -18, 'containerBlue');
  box(6.4, 2.6, 2.6, -27, 1.3, -9.5, 'containerGreen');
  box(2.4, 2.4, 2.4, -19.5, 1.2, -17.5, 'rust');
  box(1.2, 1.2, 1.2, -19.5, 0.6, -14.5, 'sandDark');
  box(1.2, 1.2, 1.2, -19.5, 0.6, -13.2, 'sandDark');
  box(1.2, 2.4, 1.2, -21.5, 1.2, -11, 'hairline');

  // Site B (east): mirrored in layout, different colours so the sites read at a glance.
  box(6.4, 2.6, 2.6, 27, 1.3, -18, 'rust');
  box(6.4, 2.6, 2.6, 27, 1.3, -9.5, 'containerBlue');
  box(2.4, 2.4, 2.4, 19.5, 1.2, -17.5, 'containerGreen');
  box(1.2, 1.2, 1.2, 19.5, 0.6, -14.5, 'sandDark');
  box(1.2, 1.2, 1.2, 19.5, 0.6, -13.2, 'sandDark');
  box(1.2, 2.4, 1.2, 21.5, 1.2, -11, 'hairline');

  // West and east lanes: crates to crouch behind, a tall stack to break sightlines.
  box(1.6, 1.1, 1.6, -22, 0.55, 6, 'sandDark');
  box(1.6, 1.1, 1.6, -22, 0.55, -2, 'sandDark');
  box(2.4, 2.4, 2.4, -24, 1.2, 2, 'containerGreen');
  box(1.6, 1.1, 1.6, 22, 0.55, 6, 'sandDark');
  box(1.6, 1.1, 1.6, 22, 0.55, -2, 'sandDark');
  box(2.4, 2.4, 2.4, 24, 1.2, 2, 'containerBlue');

  // Connectors: low walls that force a choice — swing wide or cut through mid.
  box(6, 1.3, 0.8, -14, 0.65, 4, 'surface');
  box(6, 1.3, 0.8, 14, 0.65, 4, 'surface');
  box(5, 1.3, 0.8, -16, 0.65, -13, 'surface');
  box(5, 1.3, 0.8, 16, 0.65, -13, 'surface');

  // Spawn cover, both ends.
  box(2.4, 1.1, 1.2, -6, 0.55, 20, 'hairline');
  box(2.4, 1.1, 1.2, 6, 0.55, 20, 'hairline');
  box(2.4, 1.1, 1.2, -6, 0.55, -20, 'hairline');
  box(2.4, 1.1, 1.2, 6, 0.55, -20, 'hairline');

  // Site markers: a glowing ring on the ground, a beacon pole and a floating letter disc.
  function siteMarker(site, letter, colour) {
    const cx = (site.x0 + site.x1) / 2;
    const cz = (site.z0 + site.z1) / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.6, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.03, cz);
    group.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 }),
    );
    pole.position.set(cx, 1.7, cz);
    pole.castShadow = true;
    group.add(pole);
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(letter, colour), transparent: true, depthWrite: false }));
    disc.scale.set(2.2, 2.2, 1);
    disc.position.set(cx, 4.1, cz);
    group.add(disc);
    const glow = new THREE.PointLight(new THREE.Color(colour), 6, 12);
    glow.position.set(cx, 2.2, cz);
    scene.add(glow);
    return { ring, cx, cz };
  }
  const markerA = siteMarker(SITE_A, 'A', PALETTE.siteA);
  const markerB = siteMarker(SITE_B, 'B', PALETTE.siteB);

  // Dusk light: a low warm sun from the west, a cool sky fill, and a soft hemisphere.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8d97b8'), new THREE.Color(PALETTE.sandDark), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.4);
  sun.position.set(-24, 16, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5d6f9e'), 0.5);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  return {
    colliders,
    shootables,
    group,
    markers: { A: markerA, B: markerB },
    waypoints: WAYPOINTS.map(([x, z, ...links]) => ({ x, z, links })),
    inSite(x, z, site) {
      const s = site === 'A' ? SITE_A : SITE_B;
      return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
    },
  };
}
