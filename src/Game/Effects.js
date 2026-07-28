import * as THREE from 'three';
import { TEAM_COLORS, mulberry32, randomRange } from './Utils.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.effects = [];
    this.rng = mulberry32(73191);
    this.audio = null;
    this.masterGain = null;
  }

  enableAudio() {
    if (this.audio) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.audio = new AudioContext();
    this.masterGain = this.audio.createGain();
    this.masterGain.gain.value = .08;
    this.masterGain.connect(this.audio.destination);
  }

  tone(frequency = 260, duration = .08, type = 'sine', volume = .25, detune = 0) {
    if (!this.audio || this.audio.state !== 'running') return;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(volume, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + duration);
    osc.connect(gain); gain.connect(this.masterGain);
    osc.start(); osc.stop(this.audio.currentTime + duration);
  }

  uiConfirm() {
    this.tone(520, .07, 'triangle', .18);
    setTimeout(() => this.tone(780, .09, 'sine', .12), 45);
  }

  fire(from, to, team, heavy = false) {
    const color = TEAM_COLORS[team];
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(.5);
    const geometry = new THREE.CylinderGeometry(heavy ? .34 : .12, heavy ? .72 : .24, length, heavy ? 8 : 6, 1, true);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: heavy ? 1 : .88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const beam = new THREE.Mesh(geometry, material);
    beam.position.copy(midpoint);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
    this.scene.add(beam);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(heavy ? 1.65 : .65, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    core.position.copy(to);
    this.scene.add(core);

    this.effects.push({
      age: 0, life: heavy ? .28 : .16,
      update: (dt, age, life) => {
        const t = age / life;
        material.opacity = (1 - t) * (heavy ? 1 : .8);
        beam.scale.x = beam.scale.y = 1 + t * (heavy ? 1.8 : .6);
        core.material.opacity = 1 - t;
        core.scale.setScalar(1 + t * 2.5);
      },
      dispose: () => {
        this.scene.remove(beam, core);
        geometry.dispose(); material.dispose(); core.geometry.dispose(); core.material.dispose();
      },
    });

    if (heavy) {
      this.tone(80, .24, 'sawtooth', .26, randomRange(this.rng, -80, 80));
      this.tone(260, .11, 'square', .09, randomRange(this.rng, -120, 120));
    } else if (this.rng() > .62) {
      this.tone(randomRange(this.rng, 180, 320), .07, 'square', .06);
    }
  }

  shieldHit(position, team, radius = 3) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * .25, radius, 28),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    mesh.position.copy(position);
    mesh.lookAt(0, 0, 0);
    this.scene.add(mesh);
    this.effects.push({
      age: 0, life: .38,
      update: (dt, age, life) => {
        const t = age / life;
        mesh.scale.setScalar(.4 + t * 1.8);
        mesh.material.opacity = (1 - t) * .8;
      },
      dispose: () => { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
    });
  }

  explosion(position, size = 5, color = 0xff8b42) {
    const count = Math.min(180, Math.max(32, Math.round(size * 12)));
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(randomRange(this.rng, -1, 1), randomRange(this.rng, -1, 1), randomRange(this.rng, -1, 1)).normalize();
      v.multiplyScalar(randomRange(this.rng, size * 2, size * 8));
      velocities.push(v);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: Math.max(1.2, size * .24), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const points = new THREE.Points(geometry, material);
    points.position.copy(position);
    this.scene.add(points);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(size * .65, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd6a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    flash.position.copy(position);
    this.scene.add(flash);

    this.effects.push({
      age: 0, life: 1.15,
      update: (dt, age, life) => {
        const arr = geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
          const v = velocities[i];
          const drag = Math.exp(-1.8 * dt);
          v.multiplyScalar(drag);
          arr[i * 3] += v.x * dt;
          arr[i * 3 + 1] += v.y * dt;
          arr[i * 3 + 2] += v.z * dt;
        }
        geometry.attributes.position.needsUpdate = true;
        const t = age / life;
        material.opacity = Math.pow(1 - t, 1.5);
        flash.material.opacity = Math.max(0, 1 - t * 4);
        flash.scale.setScalar(1 + t * 4.5);
      },
      dispose: () => {
        this.scene.remove(points, flash);
        geometry.dispose(); material.dispose(); flash.geometry.dispose(); flash.material.dispose();
      },
    });
    this.tone(48, .5, 'sawtooth', .35, randomRange(this.rng, -120, 80));
    this.tone(95, .22, 'square', .16, randomRange(this.rng, -90, 90));
  }

  orderMarker(position, color = 0x62e7ff) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.75, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.position.copy(position);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.effects.push({
      age: 0, life: .9,
      update: (dt, age, life) => {
        const t = age / life;
        ring.scale.setScalar(1 + t * 5.5);
        ring.material.opacity = (1 - t) * .75;
      },
      dispose: () => { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); },
    });
  }

  update(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age += dt;
      effect.update(dt, effect.age, effect.life);
      if (effect.age >= effect.life) {
        effect.dispose();
        this.effects.splice(i, 1);
      }
    }
  }
}
