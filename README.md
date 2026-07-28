# VOID COMMAND

A cinematic, procedural, universe-scale space RTS prototype built with Three.js. It focuses on a polished random-skirmish experience rather than missions or campaign content.

## Run immediately

The project is browser-native and uses a Three.js import map. No package installation is required, but the browser needs internet access once to load Three.js.

```bash
cd void-command-rts
python3 -m http.server 8080
```

Open `http://localhost:8080` in a WebGL2-capable desktop browser.

## Optional Vite workflow

```bash
npm install
npm run dev
```

## Controls

- **Left mouse:** Select or drag a selection box
- **Right mouse:** Move selected units or attack a hostile under the cursor
- **Middle mouse:** Orbit the tactical camera
- **Mouse wheel:** Zoom
- **W/A/S/D:** Pan
- **Q/E:** Lower/raise camera
- **F:** Focus selected fleet
- **Space:** Pause/resume
- **1/2/3:** 0.5× / 1× / 2× simulation speed
- **R:** Reset camera
- **Esc:** Cancel an active command

## Included systems

- Five ship classes: interceptor, gun corvette, ion frigate, line destroyer, and fleet carrier
- Approximately 54–80 ships per randomized skirmish with autonomous target acquisition and fleet combat
- Hulls, regenerating shields, class-specific ranges, damage, speed, turning, and firing cadence
- Procedural ship construction and procedural hull panel textures
- Shader-driven engine plumes, shields, nebula, star twinkle, atmosphere, beam weapons, bloom, and explosions
- Instanced asteroid field and performance-aware effect lifetimes
- Box selection, formation movement, focus fire, guard/stop commands, cinematic camera, speed controls
- Fleet manifest, live tactical log, health/shield readouts, resource rewards, sensor minimap, victory/defeat state
- Procedural Web Audio weapon and interface cues after the first user interaction

## Scope note

This is a high-fidelity playable prototype, not a complete commercial AAA production. A shipped game at that level also requires authored hero assets, animation and VFX teams, extensive sound design, multiplayer/backend work, campaign content, accessibility, platform certification, and months or years of profiling and QA.
