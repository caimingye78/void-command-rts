import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './World.js';
import { Effects } from './Effects.js';
import { createShipVisual } from './ShipFactory.js';
import { TEAM, TEAM_COLORS, SHIP_STATS, clamp01, damp, formatNumber, mulberry32, randomRange, shipDisplayName } from './Utils.js';

const tmpV1 = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

class Ship {
  constructor(game, type, team, index, position) {
    this.game = game;
    this.id = `${team}-${type}-${index}-${Math.floor(game.rng() * 1e7)}`;
    this.type = type;
    this.team = team;
    this.stats = SHIP_STATS[type];
    this.name = shipDisplayName(team, type, index);
    this.root = createShipVisual(type, team, index * 41 + (team === TEAM.ENEMY ? 700 : 10));
    this.root.position.copy(position);
    this.root.userData.ship = this;
    this.root.traverse((child) => { if (child.isMesh) child.userData.ship = this; });
    game.scene.add(this.root);

    this.maxHull = this.stats.hull;
    this.maxShield = this.stats.shield;
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.velocity = new THREE.Vector3();
    this.destination = null;
    this.target = null;
    this.selected = false;
    this.alive = true;
    this.fireTimer = randomRange(game.rng, 0, this.stats.cooldown);
    this.retargetTimer = randomRange(game.rng, .1, .9);
    this.shieldFlash = 0;
    this.damageFlash = 0;
    this.formationOffset = new THREE.Vector3();
    this.order = 'hold';
    this.driftPhase = game.rng() * Math.PI * 2;
    this.killValue = Math.round(this.stats.threat * 42);
  }

  setSelected(value) {
    this.selected = value;
    this.root.userData.selection.visible = value;
  }

  setDestination(position, formationOffset = null) {
    this.destination = position.clone();
    this.target = null;
    this.order = 'move';
    if (formationOffset) this.formationOffset.copy(formationOffset);
  }

  setTarget(target) {
    if (!target || !target.alive || target.team === this.team) return;
    this.target = target;
    this.destination = null;
    this.order = 'attack';
  }

  stop() {
    this.destination = null;
    this.target = null;
    this.order = 'hold';
  }

  acquireTarget() {
    let best = null;
    let bestScore = Infinity;
    const candidates = this.team === TEAM.PLAYER ? this.game.enemyShips : this.game.playerShips;
    for (const other of candidates) {
      if (!other.alive) continue;
      const distSq = this.root.position.distanceToSquared(other.root.position);
      const bias = other.stats.threat * -60;
      const score = distSq + bias;
      if (score < bestScore) { best = other; bestScore = score; }
    }
    if (best) this.target = best;
  }

  takeDamage(amount, hitPoint) {
    if (!this.alive) return;
    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
      this.shieldFlash = 1;
      this.game.effects.shieldHit(hitPoint, this.team, Math.max(1.3, this.root.userData.radius * .34));
    }
    if (remaining > 0) {
      this.hull -= remaining;
      this.damageFlash = 1;
    }
    if (this.hull <= 0) this.destroy();
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.setSelected(false);
    this.game.effects.explosion(this.root.position, Math.min(22, this.root.userData.radius * .8 + 2), this.team === TEAM.ENEMY ? 0xff6956 : 0x75dfff);
    if (this.team === TEAM.ENEMY) {
      this.game.resources += this.killValue;
      this.game.addLog(`HOSTILE ${this.stats.label.toUpperCase()} DESTROYED // +${this.killValue} RU`, 'good');
    } else {
      this.game.addLog(`${this.name.toUpperCase()} LOST WITH ALL HANDS`, 'danger');
    }
    this.game.scene.remove(this.root);
    this.game.removeFromSelection(this);
    for (const ship of this.game.ships) if (ship.target === this) ship.target = null;
  }

  update(dt, elapsed) {
    if (!this.alive) return;
    this.fireTimer -= dt;
    this.retargetTimer -= dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.8);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 4.5);

    const shieldMat = this.root.userData.shield.material;
    shieldMat.uniforms.opacity.value = this.shieldFlash * .85;
    shieldMat.uniforms.pulse.value = elapsed;
    const selection = this.root.userData.selection;
    if (selection.visible) {
      const pulse = 1 + Math.sin(elapsed * 4.2 + this.root.position.x) * .035;
      selection.scale.setScalar(this.root.userData.radius * 1.28 * pulse);
      selection.material.opacity = .7 + Math.sin(elapsed * 5) * .17;
    }
    for (const flame of this.root.userData.engineFlames) {
      flame.material.uniforms.time.value = elapsed + this.driftPhase;
      flame.material.uniforms.color.value.copy(TEAM_COLORS[this.team]);
    }

    if (this.target && !this.target.alive) this.target = null;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = randomRange(this.game.rng, .55, 1.25);
      if (!this.target && (this.team === TEAM.ENEMY || this.order === 'attack' || this.order === 'hold')) this.acquireTarget();
    }

    const desiredVelocity = tmpV1.set(0, 0, 0);
    let facingTarget = null;

    if (this.target) {
      const targetPos = this.target.root.position;
      const distance = this.root.position.distanceTo(targetPos);
      const preferred = this.stats.range * (this.type === 'fighter' ? .55 : .78);
      if (distance > preferred) {
        desiredVelocity.copy(targetPos).sub(this.root.position).normalize().multiplyScalar(this.stats.speed);
      } else if (this.type === 'fighter' || this.type === 'corvette') {
        const tangent = tmpV2.copy(targetPos).sub(this.root.position).normalize().cross(Y_AXIS).normalize();
        tangent.multiplyScalar(this.stats.speed * .45 * (Math.sin(this.driftPhase) > 0 ? 1 : -1));
        desiredVelocity.copy(tangent);
      }
      facingTarget = targetPos;
      if (distance <= this.stats.range && this.fireTimer <= 0) this.fireAtTarget(distance);
    } else if (this.destination) {
      const goal = tmpV2.copy(this.destination).add(this.formationOffset);
      const distance = this.root.position.distanceTo(goal);
      if (distance > Math.max(2, this.root.userData.radius * .22)) {
        desiredVelocity.copy(goal).sub(this.root.position).normalize().multiplyScalar(this.stats.speed);
        facingTarget = goal;
      } else {
        this.destination = null;
        this.order = 'hold';
      }
    }

    // Local separation keeps formations legible without expensive physics.
    let neighbors = 0;
    const separation = tmpV3.set(0, 0, 0);
    const safeRadius = this.root.userData.radius * 1.1;
    for (const other of this.game.ships) {
      if (other === this || !other.alive || other.team !== this.team) continue;
      const distSq = this.root.position.distanceToSquared(other.root.position);
      if (distSq > 0.001 && distSq < safeRadius * safeRadius) {
        const dist = Math.sqrt(distSq);
        separation.add(tmpV2.copy(this.root.position).sub(other.root.position).multiplyScalar((safeRadius - dist) / safeRadius / dist));
        if (++neighbors > 7) break;
      }
    }
    if (neighbors) desiredVelocity.add(separation.multiplyScalar(this.stats.speed * .8));

    const accel = this.type === 'fighter' ? 4.2 : this.type === 'corvette' ? 2.8 : 1.55;
    this.velocity.lerp(desiredVelocity, 1 - Math.exp(-accel * dt));
    this.root.position.addScaledVector(this.velocity, dt);

    if (!facingTarget && this.velocity.lengthSq() > .8) facingTarget = tmpV2.copy(this.root.position).add(this.velocity);
    if (facingTarget) {
      const look = new THREE.Matrix4().lookAt(facingTarget, this.root.position, Y_AXIS);
      tmpQ.setFromRotationMatrix(look);
      this.root.quaternion.slerp(tmpQ, 1 - Math.exp(-this.stats.turn * dt));
    }

    // Subtle life and scale cues.
    this.root.position.y += Math.sin(elapsed * .35 + this.driftPhase) * dt * (this.type === 'fighter' ? .32 : .08);
    if (this.shield < this.maxShield && !this.target && this.order === 'hold') {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * .018 * dt);
    }
  }

  fireAtTarget(distance) {
    this.fireTimer = this.stats.cooldown * randomRange(this.game.rng, .82, 1.18);
    if (!this.target || !this.target.alive) return;
    const start = this.root.position.clone();
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    start.addScaledVector(front, this.root.userData.radius * .6);
    start.y += randomRange(this.game.rng, -.3, .5) * this.stats.scale;
    const hit = this.target.root.position.clone().add(new THREE.Vector3(
      randomRange(this.game.rng, -1, 1), randomRange(this.game.rng, -1, 1), randomRange(this.game.rng, -1, 1),
    ).multiplyScalar(this.target.root.userData.radius * .22));

    const heavy = this.type === 'frigate' || this.type === 'destroyer' || this.type === 'carrier';
    this.game.effects.fire(start, hit, this.team, heavy);
    const falloff = THREE.MathUtils.clamp(1.18 - distance / (this.stats.range * 2.7), .72, 1.05);
    const variance = randomRange(this.game.rng, .78, 1.2);
    this.target.takeDamage(this.stats.damage * falloff * variance, hit);
  }
}

export class Game {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 4000);
    this.camera.position.set(210, 175, 285);
    this.clock = new THREE.Clock();
    this.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.rng = mulberry32(this.seed);
    this.ships = [];
    this.playerShips = [];
    this.enemyShips = [];
    this.selected = [];
    this.shipPickables = [];
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragStart = null;
    this.dragCurrent = null;
    this.dragging = false;
    this.currentCommand = null;
    this.resources = Math.round(randomRange(this.rng, 3200, 5200));
    this.paused = false;
    this.speed = 1;
    this.cinematic = false;
    this.cinematicTime = 0;
    this.uiTimer = 0;
    this.minimapTimer = 0;
    this.battleFinished = false;
    this.formationMode = 0;
  }

  async init() {
    this.setupRenderer();
    this.setupPostprocessing();
    this.setupControls();
    this.sectorCode = `${String.fromCharCode(65 + Math.floor(this.rng() * 26))}-${Math.floor(randomRange(this.rng, 100, 999))}`;
    document.getElementById('sector-label').textContent = `PROCEDURAL SKIRMISH // SECTOR ${this.sectorCode}`;
    this.world = new World(this.scene, this.renderer, this.seed);
    this.world.create();
    this.effects = new Effects(this.scene);
    this.spawnFleets();
    this.bindEvents();
    this.buildFleetManifest();
    this.addLog('TACTICAL NETWORK SYNCHRONIZED', 'good');
    this.addLog('HOSTILE DRIVE SIGNATURES CONFIRMED', 'danger');
    this.addLog('ALL SQUADRONS REPORT COMBAT READY');
    this.renderer.setAnimationLoop(() => this.animate());
    this.resize();
    this.updateHUD(true);
    setTimeout(() => document.getElementById('loading').classList.add('hidden'), 650);
    window.voidCommand = this;
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  setupPostprocessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .72, .62, .76);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .065;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 780;
    this.controls.zoomSpeed = 1.25;
    this.controls.rotateSpeed = .58;
    this.controls.panSpeed = .8;
    this.controls.mouseButtons.LEFT = null;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = null;
  }

  spawnFleets() {
    const composition = [
      ['carrier', 1],
      ['destroyer', Math.floor(randomRange(this.rng, 1, 4))],
      ['frigate', Math.floor(randomRange(this.rng, 3, 7))],
      ['corvette', Math.floor(randomRange(this.rng, 6, 11))],
      ['fighter', Math.floor(randomRange(this.rng, 16, 25))],
    ];
    this.spawnFleet(TEAM.PLAYER, new THREE.Vector3(-165, 0, 70), composition);
    this.spawnFleet(TEAM.ENEMY, new THREE.Vector3(165, 5, -70), composition);
    for (const ship of this.enemyShips) ship.acquireTarget();
  }

  spawnFleet(team, center, composition) {
    let index = 0;
    const direction = team === TEAM.PLAYER ? 1 : -1;
    const depthByType = { carrier: -180, destroyer: -55, frigate: 15, corvette: 60, fighter: 105 };
    const spacingByType = { carrier: 1, destroyer: 105, frigate: 58, corvette: 35, fighter: 21 };
    const columnsByType = { carrier: 1, destroyer: 2, frigate: 4, corvette: 4, fighter: 6 };

    for (const [type, count] of composition) {
      const spacing = spacingByType[type];
      const columns = columnsByType[type];
      for (let i = 0; i < count; i++) {
        const col = i % columns;
        const localRow = Math.floor(i / columns);
        const rowWidth = Math.min(count - localRow * columns, columns);
        const pos = center.clone().add(new THREE.Vector3(
          direction * (depthByType[type] - localRow * (type === 'fighter' ? 10 : 7)),
          randomRange(this.rng, -13, 13) + (localRow % 2) * 4,
          (col - (rowWidth - 1) * .5) * spacing + (localRow - 1) * spacing * .36,
        ));
        const ship = new Ship(this, type, team, index++, pos);
        const facing = team === TEAM.PLAYER ? new THREE.Vector3(100, 0, 0) : new THREE.Vector3(-100, 0, 0);
        ship.root.lookAt(facing);
        this.ships.push(ship);
        (team === TEAM.PLAYER ? this.playerShips : this.enemyShips).push(ship);
        ship.root.traverse((child) => { if (child.isMesh) this.shipPickables.push(child); });
      }
    }
  }

  bindEvents() {
    const canvas = this.renderer.domElement;
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    canvas.addEventListener('wheel', () => this.hideTooltip(), { passive: true });

    document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
    document.getElementById('new-battle-btn').addEventListener('click', () => location.reload());
    document.getElementById('cinematic-btn').addEventListener('click', () => this.toggleCinematic());
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => this.commandButton(button.dataset.command));
    });
  }

  onKeyDown(event) {
    if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].includes(event.code)) this.keys.add(event.code);
    if (event.code === 'Space') { event.preventDefault(); this.togglePause(); }
    if (event.code === 'Digit1') this.setSpeed(.5);
    if (event.code === 'Digit2') this.setSpeed(1);
    if (event.code === 'Digit3') this.setSpeed(2);
    if (event.code === 'KeyF') this.focusSelection();
    if (event.code === 'Escape') { this.currentCommand = null; this.toast('COMMAND CANCELLED'); }
    if (event.code === 'KeyR') this.resetCamera();
    if (event.code === 'KeyM' && this.selected.length) { this.currentCommand = 'move'; this.toast('MOVE COMMAND // SELECT DESTINATION'); }
  }

  onPointerDown(event) {
    this.effects.enableAudio();
    if (this.effects.audio?.state === 'suspended') this.effects.audio.resume();
    if (event.button !== 0 || this.cinematic) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.dragStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.dragCurrent = { ...this.dragStart };
    this.dragging = false;
  }

  onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (this.dragStart) {
      this.dragCurrent = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (Math.hypot(this.dragCurrent.x - this.dragStart.x, this.dragCurrent.y - this.dragStart.y) > 6) {
        this.dragging = true;
        this.updateSelectionBox();
      }
      return;
    }
    if (event.target === this.renderer.domElement && !this.cinematic) this.updateTooltip(event);
    else this.hideTooltip();
  }

  onPointerUp(event) {
    if (event.button !== 0 || !this.dragStart) return;
    if (this.dragging) {
      this.boxSelect(event.shiftKey);
    } else if (this.currentCommand) {
      this.executeCommandAtPointer(event);
    } else {
      const ship = this.pickShip(event);
      if (ship?.team === TEAM.PLAYER) this.selectShips([ship], event.shiftKey);
      else if (!event.shiftKey) this.clearSelection();
    }
    this.dragStart = null;
    this.dragCurrent = null;
    this.dragging = false;
    document.getElementById('selection-box').style.display = 'none';
  }

  onContextMenu(event) {
    event.preventDefault();
    if (!this.selected.length || this.cinematic) return;
    const picked = this.pickShip(event);
    if (picked && picked.team === TEAM.ENEMY) {
      this.issueAttack(picked);
      this.showOrderReticle(event.clientX, event.clientY);
      return;
    }
    const point = this.pickTacticalPlane(event);
    if (point) {
      this.issueMove(point);
      this.showOrderReticle(event.clientX, event.clientY);
      this.effects.orderMarker(point);
    }
  }

  executeCommandAtPointer(event) {
    if (this.currentCommand === 'attack') {
      const picked = this.pickShip(event);
      if (picked?.team === TEAM.ENEMY) this.issueAttack(picked);
      else this.toast('INVALID TARGET');
    } else if (this.currentCommand === 'move') {
      const point = this.pickTacticalPlane(event);
      if (point) { this.issueMove(point); this.effects.orderMarker(point); }
    }
    this.currentCommand = null;
  }

  pickShip(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.shipPickables, false);
    for (const hit of hits) {
      const ship = hit.object.userData.ship;
      if (ship?.alive) return ship;
    }
    return null;
  }

  pickTacticalPlane(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const planeY = this.selected.length ? this.selected.reduce((sum, s) => sum + s.root.position.y, 0) / this.selected.length : 0;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  updateSelectionBox() {
    const box = document.getElementById('selection-box');
    const x = Math.min(this.dragStart.x, this.dragCurrent.x);
    const y = Math.min(this.dragStart.y, this.dragCurrent.y);
    const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
    const h = Math.abs(this.dragCurrent.y - this.dragStart.y);
    Object.assign(box.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  boxSelect(additive = false) {
    const minX = Math.min(this.dragStart.x, this.dragCurrent.x);
    const maxX = Math.max(this.dragStart.x, this.dragCurrent.x);
    const minY = Math.min(this.dragStart.y, this.dragCurrent.y);
    const maxY = Math.max(this.dragStart.y, this.dragCurrent.y);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const chosen = [];
    for (const ship of this.playerShips) {
      if (!ship.alive) continue;
      const p = ship.root.position.clone().project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x * .5 + .5) * rect.width;
      const y = (-p.y * .5 + .5) * rect.height;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) chosen.push(ship);
    }
    this.selectShips(chosen, additive);
  }

  selectShips(ships, additive = false) {
    if (!additive) this.clearSelection(false);
    for (const ship of ships) {
      if (!ship.alive || ship.team !== TEAM.PLAYER || this.selected.includes(ship)) continue;
      ship.setSelected(true);
      this.selected.push(ship);
    }
    this.effects.uiConfirm();
    this.updateSelectionHUD();
  }

  clearSelection(update = true) {
    for (const ship of this.selected) ship.setSelected(false);
    this.selected.length = 0;
    if (update) this.updateSelectionHUD();
  }

  removeFromSelection(ship) {
    const index = this.selected.indexOf(ship);
    if (index >= 0) this.selected.splice(index, 1);
    this.updateSelectionHUD();
  }

  issueMove(point) {
    if (!this.selected.length) return;
    const count = this.selected.length;
    const width = Math.ceil(Math.sqrt(count));
    const spacing = this.formationMode ? 18 : 12;
    this.selected.forEach((ship, i) => {
      const row = Math.floor(i / width);
      const col = i % width;
      const offset = new THREE.Vector3((col - (width - 1) / 2) * spacing, this.formationMode ? (i % 3 - 1) * 4 : 0, (row - Math.floor(count / width) / 2) * spacing);
      ship.setDestination(point, offset);
    });
    this.addLog(`MOVE ORDER ACKNOWLEDGED // ${count} UNIT${count > 1 ? 'S' : ''}`);
    this.toast('MOVE ORDER CONFIRMED');
    this.effects.uiConfirm();
  }

  issueAttack(target) {
    if (!target?.alive) return;
    for (const ship of this.selected) ship.setTarget(target);
    this.addLog(`FOCUS FIRE // ${target.name.toUpperCase()}`, 'danger');
    this.toast(`ENGAGING ${target.stats.label.toUpperCase()}`);
    this.effects.uiConfirm();
  }

  commandButton(command) {
    if (!this.selected.length) return;
    if (command === 'move' || command === 'attack') {
      this.currentCommand = command;
      this.toast(`${command.toUpperCase()} COMMAND // SELECT ${command === 'move' ? 'DESTINATION' : 'HOSTILE'}`);
    } else if (command === 'stop' || command === 'guard') {
      for (const ship of this.selected) ship.stop();
      this.toast(command === 'guard' ? 'GUARD POSITION' : 'ALL ENGINES STOP');
    } else if (command === 'formation') {
      this.formationMode = (this.formationMode + 1) % 2;
      this.toast(this.formationMode ? 'DELTA FORMATION ENABLED' : 'STANDARD FORMATION ENABLED');
    } else if (command === 'focus') {
      this.focusSelection();
    }
    this.effects.uiConfirm();
  }

  focusSelection() {
    if (!this.selected.length) return;
    const center = this.selected.reduce((sum, s) => sum.add(s.root.position), new THREE.Vector3()).multiplyScalar(1 / this.selected.length);
    const radius = Math.max(28, Math.sqrt(this.selected.length) * 18);
    this.controls.target.copy(center);
    const direction = this.camera.position.clone().sub(center).normalize();
    this.camera.position.copy(center).addScaledVector(direction, radius * 2.4);
    this.controls.update();
  }

  resetCamera() {
    this.camera.position.set(210, 175, 285);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  updateTooltip(event) {
    const ship = this.pickShip(event);
    const tooltip = document.getElementById('tooltip');
    if (!ship) { this.hideTooltip(); return; }
    tooltip.className = `tooltip ${ship.team === TEAM.ENEMY ? 'enemy' : ''}`;
    tooltip.innerHTML = `<strong>${ship.name}</strong><small>${ship.stats.label.toUpperCase()}</small><br>HULL ${Math.ceil(clamp01(ship.hull / ship.maxHull) * 100)}% // SHIELD ${Math.ceil(clamp01(ship.shield / ship.maxShield) * 100)}%`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(innerWidth - 180, event.clientX + 15)}px`;
    tooltip.style.top = `${Math.min(innerHeight - 90, event.clientY + 15)}px`;
  }

  hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

  showOrderReticle(x, y) {
    const reticle = document.getElementById('order-reticle');
    reticle.style.left = `${x}px`; reticle.style.top = `${y}px`;
    reticle.classList.remove('active');
    void reticle.offsetWidth;
    reticle.classList.add('active');
  }

  togglePause() {
    this.paused = !this.paused;
    const button = document.getElementById('pause-btn');
    button.classList.toggle('active', this.paused);
    button.textContent = this.paused ? 'RESUME' : 'PAUSE';
    this.toast(this.paused ? 'SIMULATION PAUSED' : 'SIMULATION RESUMED');
    this.updateHUD(true);
  }

  setSpeed(speed) {
    this.speed = speed;
    this.paused = false;
    document.getElementById('pause-btn').classList.remove('active');
    document.getElementById('pause-btn').textContent = 'PAUSE';
    this.toast(`SIMULATION RATE ${speed}×`);
    this.updateHUD(true);
  }

  toggleCinematic() {
    this.cinematic = !this.cinematic;
    this.controls.enabled = !this.cinematic;
    document.getElementById('app').classList.toggle('cinematic', this.cinematic);
    document.getElementById('cinematic-btn').classList.toggle('active', this.cinematic);
    document.getElementById('cinematic-btn').textContent = this.cinematic ? 'TACTICAL' : 'CINEMATIC';
    this.toast(this.cinematic ? 'CINEMATIC CAMERA ONLINE' : 'TACTICAL CAMERA RESTORED');
  }

  updateCamera(dt) {
    if (this.cinematic) {
      this.cinematicTime += dt * .12;
      const living = this.ships.filter((s) => s.alive);
      if (!living.length) return;
      const center = living.reduce((sum, s) => sum.add(s.root.position), new THREE.Vector3()).multiplyScalar(1 / living.length);
      const radius = 235 + Math.sin(this.cinematicTime * .7) * 45;
      this.camera.position.set(center.x + Math.cos(this.cinematicTime) * radius, center.y + 80 + Math.sin(this.cinematicTime * .47) * 65, center.z + Math.sin(this.cinematicTime) * radius);
      this.camera.lookAt(center);
      return;
    }
    const speed = 105 * dt * Math.max(.35, this.camera.position.distanceTo(this.controls.target) / 180);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, Y_AXIS).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (this.keys.has('KeyQ')) move.y -= 1;
    if (this.keys.has('KeyE')) move.y += 1;
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
    this.controls.update();
  }

  checkBattleState() {
    if (this.battleFinished) return;
    const allies = this.playerShips.some((s) => s.alive);
    const enemies = this.enemyShips.some((s) => s.alive);
    if (!enemies) {
      this.battleFinished = true;
      document.getElementById('objective').innerHTML = '<small>SECTOR SECURED</small><strong>Hostile fleet eliminated</strong><p>All surviving vessels are to regroup around the carrier.</p>';
      this.toast(`VICTORY // SECTOR ${this.sectorCode} SECURED`);
      this.addLog('ALL HOSTILE SIGNALS TERMINATED', 'good');
    } else if (!allies) {
      this.battleFinished = true;
      document.getElementById('objective').innerHTML = '<small>FLEET LOST</small><strong>Command network offline</strong><p>No allied transponders remain in the battlespace.</p>';
      this.toast('DEFEAT // FLEET SIGNAL LOST');
    }
  }

  animate() {
    const realDt = Math.min(this.clock.getDelta(), .05);
    const elapsed = this.clock.elapsedTime;
    const dt = this.paused ? 0 : realDt * this.speed;
    this.updateCamera(realDt);
    this.world.update(realDt, elapsed);
    if (dt > 0) {
      for (const ship of this.ships) ship.update(dt, elapsed);
      this.effects.update(dt);
      this.checkBattleState();
    }
    this.uiTimer -= realDt;
    this.minimapTimer -= realDt;
    if (this.uiTimer <= 0) { this.uiTimer = .12; this.updateHUD(); }
    if (this.minimapTimer <= 0) { this.minimapTimer = .08; this.drawMinimap(); }
    this.composer.render();
  }

  updateHUD(force = false) {
    const allyCount = this.playerShips.filter((s) => s.alive).length;
    const enemyCount = this.enemyShips.filter((s) => s.alive).length;
    document.getElementById('fleet-value').textContent = String(allyCount).padStart(2, '0');
    document.getElementById('hostile-value').textContent = String(enemyCount).padStart(2, '0');
    document.getElementById('resource-value').textContent = formatNumber(this.resources);
    document.getElementById('sim-value').textContent = this.paused ? 'II' : `${this.speed}×`;
    this.updateSelectionHUD();
    this.updateFleetManifestCounts();
  }

  buildFleetManifest() {
    const list = document.getElementById('fleet-list');
    list.innerHTML = Object.entries(SHIP_STATS).reverse().map(([type, stats]) => `
      <div class="fleet-row" data-type="${type}"><div><i class="fleet-icon"></i><small>${stats.label.toUpperCase()}</small></div><b>00</b></div>
    `).join('');
    this.updateFleetManifestCounts();
  }

  updateFleetManifestCounts() {
    document.querySelectorAll('.fleet-row').forEach((row) => {
      const count = this.playerShips.filter((s) => s.alive && s.type === row.dataset.type).length;
      row.querySelector('b').textContent = String(count).padStart(2, '0');
      row.style.opacity = count ? '1' : '.35';
    });
  }

  updateSelectionHUD() {
    const panel = document.getElementById('selection-panel');
    if (!this.selected.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const primary = this.selected[0];
    const avgHull = this.selected.reduce((sum, s) => sum + clamp01(s.hull / s.maxHull), 0) / this.selected.length;
    const avgShield = this.selected.reduce((sum, s) => sum + clamp01(s.shield / s.maxShield), 0) / this.selected.length;
    const sameType = this.selected.every((s) => s.type === primary.type);
    document.getElementById('selection-count').textContent = String(this.selected.length).padStart(2, '0');
    document.getElementById('selection-class').textContent = sameType ? `${primary.stats.label.toUpperCase()} ${this.selected.length > 1 ? 'GROUP' : ''}` : 'MULTI-ROLE TASK FORCE';
    document.getElementById('selection-name').textContent = this.selected.length === 1 ? primary.name : `Task Group ${String(this.selected.length).padStart(2, '0')}`;
    document.getElementById('hull-value').textContent = `${Math.ceil(avgHull * 100)}%`;
    document.getElementById('shield-value').textContent = `${Math.ceil(avgShield * 100)}%`;
    document.getElementById('hull-bar').style.width = `${avgHull * 100}%`;
    document.getElementById('shield-bar').style.width = `${avgShield * 100}%`;
  }

  drawMinimap() {
    const canvas = document.getElementById('minimap');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * .65);
    grad.addColorStop(0, 'rgba(24,64,92,.26)'); grad.addColorStop(1, 'rgba(1,6,13,.78)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(92,191,231,.10)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, i * 24, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    const scale = .19;
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const x = w / 2 + ship.root.position.x * scale;
      const y = h / 2 + ship.root.position.z * scale;
      if (x < 2 || x > w - 2 || y < 2 || y > h - 2) continue;
      ctx.fillStyle = ship.team === TEAM.PLAYER ? '#65ddff' : '#ff536f';
      const size = ship.type === 'carrier' ? 3.5 : ship.type === 'destroyer' ? 2.8 : 1.5;
      ctx.shadowBlur = ship.selected ? 10 : 4;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,199,104,.5)'; ctx.strokeRect(w / 2 - 3, h / 2 - 3, 6, 6);
  }

  addLog(message, type = '') {
    const log = document.getElementById('event-log');
    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.innerHTML = `<b>${time}</b> // ${message}`;
    log.prepend(item);
    while (log.children.length > 9) log.lastElementChild.remove();
  }

  toast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }
}
