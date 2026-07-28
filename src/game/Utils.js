import * as THREE from 'three';

export const TEAM = {
  PLAYER: 'player',
  ENEMY: 'enemy',
};

export const TEAM_COLORS = {
  player: new THREE.Color(0x55dfff),
  enemy: new THREE.Color(0xff536f),
};

export const SHIP_STATS = {
  fighter: { label: 'Interceptor', hull: 62, shield: 24, speed: 34, turn: 3.6, range: 64, damage: 7, cooldown: 0.55, scale: 1.0, threat: 1 },
  corvette: { label: 'Gun Corvette', hull: 180, shield: 90, speed: 22, turn: 2.4, range: 85, damage: 14, cooldown: 0.8, scale: 1.7, threat: 3 },
  frigate: { label: 'Ion Frigate', hull: 520, shield: 260, speed: 13, turn: 1.25, range: 130, damage: 34, cooldown: 1.8, scale: 3.0, threat: 7 },
  destroyer: { label: 'Line Destroyer', hull: 1450, shield: 620, speed: 8, turn: 0.62, range: 165, damage: 72, cooldown: 2.5, scale: 5.4, threat: 16 },
  carrier: { label: 'Fleet Carrier', hull: 3600, shield: 1500, speed: 4.4, turn: 0.28, range: 190, damage: 92, cooldown: 3.25, scale: 8.4, threat: 30 },
};

export function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomRange = (rng, min, max) => min + (max - min) * rng();
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

export function makeCanvasTexture(size = 512, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createHullTexture(base = '#4d5965', accent = '#97dfee', seed = 1) {
  const rng = mulberry32(seed);
  return makeCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const gradient = ctx.createLinearGradient(0, 0, s, s);
    gradient.addColorStop(0, 'rgba(255,255,255,.16)');
    gradient.addColorStop(.45, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, s, s);

    ctx.lineWidth = 1;
    for (let i = 0; i < 130; i++) {
      const x = Math.floor(rng() * 16) * 32;
      const y = Math.floor(rng() * 16) * 32;
      const w = (1 + Math.floor(rng() * 4)) * 32;
      const h = (1 + Math.floor(rng() * 3)) * 32;
      ctx.strokeStyle = `rgba(2,8,15,${0.14 + rng() * 0.18})`;
      ctx.strokeRect(x + .5, y + .5, w, h);
      if (rng() > .65) {
        ctx.fillStyle = `rgba(255,255,255,${0.015 + rng() * .035})`;
        ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      }
    }

    ctx.strokeStyle = accent;
    ctx.globalAlpha = .35;
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const y = 50 + rng() * (s - 100);
      ctx.beginPath();
      ctx.moveTo(rng() * 80, y);
      ctx.lineTo(s - rng() * 80, y + randomRange(rng, -16, 16));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 9000; i++) {
      const v = Math.floor(rng() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v},${rng() * .08})`;
      ctx.fillRect(rng() * s, rng() * s, 1, 1);
    }
  });
}

export function formatNumber(value) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

export function shipDisplayName(team, type, index) {
  const playerPrefixes = ['VCS Aegis', 'VCS Meridian', 'VCS Resolute', 'VCS Halcyon', 'VCS Dauntless', 'VCS Horizon'];
  const enemyPrefixes = ['KRX Revenant', 'KRX Vanta', 'KRX Malice', 'KRX Severance', 'KRX Oblivion', 'KRX Wraith'];
  const suffix = type === 'fighter' ? `-${String(index).padStart(2, '0')}` : ` // ${index + 1}`;
  return `${(team === TEAM.PLAYER ? playerPrefixes : enemyPrefixes)[index % 6]}${suffix}`;
}
