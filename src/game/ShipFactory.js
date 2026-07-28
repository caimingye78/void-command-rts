import * as THREE from 'three';
import { SHIP_STATS, TEAM_COLORS, createHullTexture } from './Utils.js';

const textureCache = new Map();

const geometries = {
  box: new THREE.BoxGeometry(1, 1, 1, 2, 2, 4),
  sphere: new THREE.SphereGeometry(1, 18, 12),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cone: new THREE.ConeGeometry(1, 1, 14, 1),
  torus: new THREE.TorusGeometry(1, .035, 8, 64),
  flame: new THREE.PlaneGeometry(1, 1),
};

function hullMaterial(team, seed, dark = false) {
  const teamColor = TEAM_COLORS[team];
  const base = dark ? '#222b35' : team === 'player' ? '#52616d' : '#5a3f47';
  const textureKey = `${team}-${dark ? 'dark' : 'hull'}-${seed % 8}`;
  if (!textureCache.has(textureKey)) textureCache.set(textureKey, createHullTexture(base, `#${teamColor.getHexString()}`, seed % 8 + (dark ? 100 : 0)));
  const map = textureCache.get(textureKey);
  return new THREE.MeshStandardMaterial({
    map,
    color: dark ? 0x65717a : 0xa9b5bd,
    metalness: .82,
    roughness: dark ? .42 : .31,
    emissive: teamColor,
    emissiveIntensity: dark ? .025 : .045,
  });
}

function emissiveMaterial(team, intensity = 3) {
  return new THREE.MeshBasicMaterial({
    color: TEAM_COLORS[team],
    transparent: true,
    opacity: .95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function addPart(parent, geometry, material, scale, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addEngine(parent, team, x, y, z, size = 1) {
  const engine = addPart(parent, geometries.sphere, emissiveMaterial(team), [size * .5, size * .5, size * .75], [x, y, z]);
  engine.userData.bloom = true;

  const coneMaterial = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: TEAM_COLORS[team].clone() },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float time;
      varying vec2 vUv;
      void main(){
        float center=1.0-abs(vUv.x-.5)*2.0;
        float fade=(1.0-vUv.y)*smoothstep(0.0,.35,center);
        float flicker=.82+.18*sin(time*26.0+vUv.y*23.0);
        gl_FragColor=vec4(color,fade*fade*.72*flicker);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const flame = new THREE.Mesh(geometries.flame, coneMaterial);
  flame.scale.set(size * 1.35, size * 5.2, 1);
  flame.position.set(x, y, z - size * 2.65);
  flame.rotation.x = -Math.PI / 2;
  parent.add(flame);
  flame.userData.engineFlame = true;
  return flame;
}

function addTurret(parent, material, x, y, z, scale = 1) {
  const base = addPart(parent, geometries.cylinder, material, [.55 * scale, .35 * scale, .55 * scale], [x, y, z]);
  base.rotation.z = Math.PI / 2;
  addPart(parent, geometries.box, material, [.22 * scale, .16 * scale, 1.05 * scale], [x, y + .25 * scale, z + .55 * scale]);
}

function addWindows(parent, team, positions, size = .18) {
  const mat = emissiveMaterial(team);
  for (const [x, y, z] of positions) {
    const window = addPart(parent, geometries.box, mat, [size, size * .3, size * 1.4], [x, y, z]);
    window.userData.bloom = true;
  }
}

function buildFighter(group, hull, dark, team) {
  addPart(group, geometries.box, hull, [.45, .18, 1.8], [0, 0, 0]);
  addPart(group, geometries.box, dark, [1.7, .08, .72], [0, -.02, -.05], [0, 0, .08]);
  addPart(group, geometries.cone, hull, [.33, 1.2, .33], [0, 0, 1.55], [Math.PI / 2, 0, 0]);
  addPart(group, geometries.box, dark, [.18, .3, .58], [0, .26, -.35]);
  addEngine(group, team, -.28, 0, -1.55, .23);
  addEngine(group, team, .28, 0, -1.55, .23);
}

function buildCorvette(group, hull, dark, team) {
  addPart(group, geometries.box, hull, [.8, .44, 2.25], [0, 0, 0]);
  addPart(group, geometries.box, dark, [1.55, .16, 1.0], [0, -.16, -.2], [0, 0, .06]);
  addPart(group, geometries.box, hull, [.48, .33, .85], [0, .42, -.15]);
  addPart(group, geometries.cone, hull, [.55, 1.2, .55], [0, 0, 2.0], [Math.PI / 2, 0, 0]);
  addTurret(group, dark, 0, .62, .45, .55);
  addWindows(group, team, [[-.42,.25,.65],[.42,.25,.65]], .18);
  addEngine(group, team, -.45, 0, -2.05, .38);
  addEngine(group, team, .45, 0, -2.05, .38);
}

function buildFrigate(group, hull, dark, team) {
  addPart(group, geometries.box, hull, [1.15, .72, 3.4], [0, 0, 0]);
  addPart(group, geometries.box, dark, [1.75, .25, 2.1], [0, -.45, -.3]);
  addPart(group, geometries.box, hull, [.75, .75, 1.2], [0, .65, -.35]);
  addPart(group, geometries.box, dark, [.34, .45, 2.7], [-1.05, -.08, -.18]);
  addPart(group, geometries.box, dark, [.34, .45, 2.7], [1.05, -.08, -.18]);
  addPart(group, geometries.cone, hull, [.88, 1.6, .88], [0, 0, 3.1], [Math.PI / 2, 0, 0]);
  addTurret(group, dark, -.55, .95, .8, .7);
  addTurret(group, dark, .55, .95, .8, .7);
  addWindows(group, team, [[-.58,.7,.5],[0,.7,.65],[.58,.7,.5]], .22);
  addEngine(group, team, -.72, -.05, -3.2, .55);
  addEngine(group, team, .72, -.05, -3.2, .55);
  addEngine(group, team, 0, .45, -3.25, .42);
}

function buildDestroyer(group, hull, dark, team) {
  addPart(group, geometries.box, hull, [1.85, 1.05, 5.7], [0, 0, 0]);
  addPart(group, geometries.box, dark, [2.65, .32, 3.6], [0, -.68, -.4]);
  addPart(group, geometries.box, hull, [1.1, 1.25, 2.0], [0, 1.0, -.75]);
  addPart(group, geometries.box, dark, [.55, .68, 4.7], [-1.8, -.08, -.35]);
  addPart(group, geometries.box, dark, [.55, .68, 4.7], [1.8, -.08, -.35]);
  addPart(group, geometries.box, hull, [2.75, .18, 1.6], [0, .1, -2.6]);
  addPart(group, geometries.cone, hull, [1.45, 2.35, 1.45], [0, 0, 5.15], [Math.PI / 2, 0, 0]);
  for (const x of [-1.15, 0, 1.15]) addTurret(group, dark, x, 1.45, 1.1, .9);
  addTurret(group, dark, 0, 1.65, -1.9, 1.05);
  addWindows(group, team, [[-1.0,1.12,.15],[-.48,1.25,.3],[0,1.3,.35],[.48,1.25,.3],[1.0,1.12,.15]], .28);
  for (const x of [-1.25, -.42, .42, 1.25]) addEngine(group, team, x, -.1, -5.45, .72);
}

function buildCarrier(group, hull, dark, team) {
  addPart(group, geometries.box, hull, [2.6, 1.35, 8.2], [0, 0, 0]);
  addPart(group, geometries.box, dark, [4.3, .4, 5.8], [0, -.9, -.7]);
  addPart(group, geometries.box, hull, [1.45, 1.55, 3.0], [0, 1.28, -1.2]);
  addPart(group, geometries.box, dark, [.78, .9, 7.0], [-2.65, -.05, -.25]);
  addPart(group, geometries.box, dark, [.78, .9, 7.0], [2.65, -.05, -.25]);
  addPart(group, geometries.box, hull, [4.5, .2, 2.35], [0, .05, -4.3]);
  addPart(group, geometries.cone, hull, [2.15, 3.0, 2.15], [0, 0, 7.45], [Math.PI / 2, 0, 0]);
  const bayMat = new THREE.MeshBasicMaterial({ color: 0x08131c, emissive: TEAM_COLORS[team], emissiveIntensity: .3 });
  addPart(group, geometries.box, bayMat, [2.0, .12, 3.8], [0, -.98, .45]);
  for (const x of [-1.65, 0, 1.65]) addTurret(group, dark, x, 1.8, 1.6, 1.15);
  addTurret(group, dark, -1.0, 2.15, -2.1, 1.25);
  addTurret(group, dark, 1.0, 2.15, -2.1, 1.25);
  const windows = [];
  for (let i = -3; i <= 3; i++) windows.push([i * .38, 1.65, -.3 + Math.abs(i) * .1]);
  addWindows(group, team, windows, .32);
  for (const x of [-2.05, -1.22, -.4, .4, 1.22, 2.05]) addEngine(group, team, x, -.2, -7.85, .88);
}

function createShield(team, radius) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 20),
    new THREE.ShaderMaterial({
      uniforms: {
        color: { value: TEAM_COLORS[team].clone() },
        opacity: { value: 0 },
        pulse: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main(){
          vNormal=normalize(normalMatrix*normal);
          vec4 world=modelMatrix*vec4(position,1.0);
          vWorld=world.xyz;
          gl_Position=projectionMatrix*viewMatrix*world;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        uniform float pulse;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main(){
          vec3 V=normalize(cameraPosition-vWorld);
          float fres=pow(1.0-max(dot(V,vNormal),0.0),2.8);
          float band=.82+.18*sin(vWorld.y*2.1+vWorld.x*1.4+pulse*8.0);
          gl_FragColor=vec4(color,(fres*.7+.08)*opacity*band);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
}

export function createShipVisual(type, team, seed = 1) {
  const stats = SHIP_STATS[type];
  const root = new THREE.Group();
  root.name = `${team}-${type}`;
  const model = new THREE.Group();
  root.add(model);

  const hull = hullMaterial(team, seed, false);
  const dark = hullMaterial(team, seed + 113, true);
  const builders = { fighter: buildFighter, corvette: buildCorvette, frigate: buildFrigate, destroyer: buildDestroyer, carrier: buildCarrier };
  builders[type](model, hull, dark, team);

  model.scale.setScalar(stats.scale);

  const radius = stats.scale * ({ fighter: 2.2, corvette: 2.8, frigate: 4.2, destroyer: 6.5, carrier: 9.5 }[type]);
  const selection = new THREE.Mesh(geometries.torus, new THREE.MeshBasicMaterial({
    color: TEAM_COLORS[team], transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  selection.scale.setScalar(radius * 1.28);
  selection.rotation.x = Math.PI / 2;
  selection.visible = false;
  root.add(selection);

  const shield = createShield(team, radius * 1.15);
  root.add(shield);

  root.userData.selection = selection;
  root.userData.shield = shield;
  root.userData.radius = radius;
  root.userData.engineFlames = [];
  root.traverse((child) => {
    if (child.isMesh) {
      child.userData.shipRoot = root;
      if (child.userData.engineFlame) root.userData.engineFlames.push(child);
    }
  });

  return root;
}
