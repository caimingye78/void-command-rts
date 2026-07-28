import * as THREE from 'three';
import { makeCanvasTexture, mulberry32, randomRange } from './Utils.js';

export class World {
  constructor(scene, renderer, seed = 91773) {
    this.scene = scene;
    this.renderer = renderer;
    this.animatables = [];
    this.rng = mulberry32((seed ^ 0x91f73) >>> 0);
  }

  create() {
    this.scene.background = new THREE.Color(0x01040a);
    this.scene.fog = new THREE.FogExp2(0x020711, 0.00042);

    this.createLights();
    this.createNebula();
    this.createStars();
    this.createDust();
    this.createPlanet();
    this.createAsteroids();
    this.createTacticalGrid();
  }

  createLights() {
    const key = new THREE.DirectionalLight(0xc9edff, 4.2);
    key.position.set(-260, 220, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 1100;
    key.shadow.camera.left = -400;
    key.shadow.camera.right = 400;
    key.shadow.camera.top = 400;
    key.shadow.camera.bottom = -400;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x526dff, 2.5);
    rim.position.set(350, -120, -420);
    this.scene.add(rim);

    const redFill = new THREE.PointLight(0xff3f72, 1500, 650, 1.7);
    redFill.position.set(180, 45, -180);
    this.scene.add(redFill);

    this.scene.add(new THREE.HemisphereLight(0x183f65, 0x03050a, 1.5));
  }

  createNebula() {
    const geometry = new THREE.SphereGeometry(1450, 64, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        tintA: { value: new THREE.Color(0x071c3d) },
        tintB: { value: new THREE.Color(0x3c1239) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 tintA;
        uniform vec3 tintB;
        varying vec3 vPos;
        float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float noise(vec3 p){
          vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        float fbm(vec3 p){ float v=0.0; float a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+11.7; a*=.5; } return v; }
        void main(){
          vec3 p=normalize(vPos)*3.4;
          float n=fbm(p+vec3(time*.006,0.0,time*.003));
          float n2=fbm(p*1.75-vec3(time*.004));
          float clouds=smoothstep(.39,.82,n*.75+n2*.38);
          float band=pow(max(0.0,1.0-abs(normalize(vPos).y)*1.4),2.0);
          vec3 color=mix(tintA,tintB,n2)*clouds*(.22+.78*band);
          float stars=step(.995,hash(floor(p*520.0)))*2.6;
          gl_FragColor=vec4(color+stars,1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const nebula = new THREE.Mesh(geometry, material);
    nebula.rotation.z = .22;
    this.scene.add(nebula);
    this.animatables.push((dt, t) => { material.uniforms.time.value = t; nebula.rotation.y += dt * .00045; });
  }

  createStars() {
    const count = 11000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = randomRange(this.rng, 480, 1300);
      const theta = this.rng() * Math.PI * 2;
      const phi = Math.acos(randomRange(this.rng, -1, 1));
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = randomRange(this.rng, .7, 3.2) * (this.rng() > .985 ? 2.3 : 1);
      c.setHSL(randomRange(this.rng, .52, .68), randomRange(this.rng, .1, .55), randomRange(this.rng, .65, 1));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: `
        attribute float aSize; attribute vec3 color; varying vec3 vColor; uniform float time; uniform float pixelRatio;
        void main(){
          vColor=color;
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          float twinkle=.8+.2*sin(time*(1.0+fract(position.x)*2.0)+position.z);
          gl_PointSize=aSize*pixelRatio*twinkle*(420.0/-mv.z);
          gl_Position=projectionMatrix*mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main(){
          vec2 p=gl_PointCoord-.5; float d=length(p);
          float a=smoothstep(.5,.0,d); float core=smoothstep(.12,0.0,d);
          gl_FragColor=vec4(vColor*(a+core*1.7),a);
        }
      `,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const stars = new THREE.Points(geometry, material);
    this.scene.add(stars);
    this.animatables.push((dt, t) => { material.uniforms.time.value = t; stars.rotation.y += dt * .00012; });
  }

  createDust() {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = randomRange(this.rng, -650, 650);
      positions[i * 3 + 1] = randomRange(this.rng, -140, 140);
      positions[i * 3 + 2] = randomRange(this.rng, -650, 650);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x5c82a3, size: .55, transparent: true, opacity: .26, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const dust = new THREE.Points(geometry, material);
    this.scene.add(dust);
    this.animatables.push((dt) => { dust.rotation.y += dt * .0009; });
  }

  createPlanet() {
    const texture = makeCanvasTexture(1024, (ctx, s) => {
      const rng = mulberry32(22441);
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#142f43'); g.addColorStop(.5, '#315a66'); g.addColorStop(1, '#101b2c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const x = rng() * s, y = rng() * s;
        const r = randomRange(rng, 4, 80);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        const warm = rng() > .7;
        gr.addColorStop(0, warm ? 'rgba(122,120,91,.23)' : 'rgba(118,179,175,.18)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = .18;
      ctx.strokeStyle = '#d8edf3';
      for (let i = 0; i < 70; i++) {
        ctx.lineWidth = randomRange(rng, 1, 7);
        ctx.beginPath();
        const y = rng() * s;
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 30) ctx.lineTo(x, y + Math.sin(x * .02 + rng() * 4) * randomRange(rng, 4, 20));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(118, 96, 64),
      new THREE.MeshStandardMaterial({ map: texture, roughness: .88, metalness: .05 }),
    );
    planet.position.set(-420, -170, -480);
    this.scene.add(planet);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(124, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0x68d7ff) } },
        vertexShader: `varying vec3 vN; varying vec3 vW; void main(){vN=normalize(normalMatrix*normal);vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vW; void main(){float f=pow(1.0-max(dot(normalize(cameraPosition-vW),vN),0.0),3.2);gl_FragColor=vec4(color,f*.48);}`,
        transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false, toneMapped: false,
      }),
    );
    atmosphere.position.copy(planet.position);
    this.scene.add(atmosphere);

    const ringTexture = makeCanvasTexture(512, (ctx, s) => {
      const grad = ctx.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, 'rgba(170,220,235,0)'); grad.addColorStop(.18, 'rgba(170,220,235,.38)'); grad.addColorStop(.48, 'rgba(140,180,200,.08)'); grad.addColorStop(.65, 'rgba(170,220,235,.28)'); grad.addColorStop(1, 'rgba(170,220,235,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(155, 235, 128), new THREE.MeshBasicMaterial({ map: ringTexture, transparent: true, opacity: .38, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(planet.position); ring.rotation.x = 1.18; ring.rotation.z = -.35;
    this.scene.add(ring);
    this.animatables.push((dt) => { planet.rotation.y += dt * .012; ring.rotation.z += dt * .001; });
  }

  createAsteroids() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x3f464b, roughness: .92, metalness: .12, flatShading: true });
    const count = 520;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = randomRange(this.rng, 260, 650);
      p.set(Math.cos(angle) * radius, randomRange(this.rng, -110, 110), Math.sin(angle) * radius);
      q.setFromEuler(new THREE.Euler(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI));
      const scale = Math.pow(this.rng(), 2.8) * 9 + .7;
      s.set(scale * randomRange(this.rng, .7, 1.4), scale * randomRange(this.rng, .6, 1.2), scale * randomRange(this.rng, .75, 1.5));
      matrix.compose(p, q, s); mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.animatables.push((dt) => { mesh.rotation.y += dt * .00045; });
  }

  createTacticalGrid() {
    const grid = new THREE.GridHelper(850, 34, 0x2d779c, 0x12344a);
    grid.material.transparent = true;
    grid.material.opacity = .1;
    grid.material.depthWrite = false;
    grid.position.y = -18;
    this.scene.add(grid);

    const ringMaterial = new THREE.LineBasicMaterial({ color: 0x3abbe8, transparent: true, opacity: .12, depthWrite: false });
    for (const radius of [100, 200, 300, 400]) {
      const points = [];
      for (let i = 0; i <= 128; i++) {
        const a = i / 128 * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * radius, -17.7, Math.sin(a) * radius));
      }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMaterial));
    }
  }

  update(dt, elapsed) {
    for (const fn of this.animatables) fn(dt, elapsed);
  }
}
