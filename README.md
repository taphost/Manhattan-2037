# MANHATTAN // NIGHT VISION
### 2037 Edition

A real-time 3D night-vision rendering of Manhattan, inspired by the aesthetic of *Escape from New York* (1981). Built entirely in vanilla JavaScript using Three.js — no build tools, no frameworks, with `index.html` as entry point.

---

## Preview

Green wireframe city. Curved CRT glass, tactical grid, animated noise, scanlines, phosphor glow. A slow cinematic autopilot tour around the island. The kind of screen you'd see in a surveillance room in a dystopian 2037.

---

## Features

- **Wireframe night-vision rendering** — buildings rendered as dark solids with glowing green edges via `LineSegments2` / `LineMaterial`.
- **Performance Optimized** — Line core and halo share a single GPU vertex buffer; LOD updates skip off-screen objects via frustum pre-checks.
- **Additive glow** — two-layer line system (core + halo) simulating CRT phosphor bloom
- **Cinematic autopilot** — smooth 7-keyframe panoramic tour using cubic Hermite interpolation (smootherstep), varying distance, height and angle continuously
- **Chunked async loading** — model geometry is converted one mesh per frame via `requestAnimationFrame`, keeping the UI responsive and making the city materialise progressively as a visual feature
- **HUD typewriter** — terminal-style boot sequence types out system info in parallel with loading; flicker animation on the whole HUD simulates phosphor instability
- **3-level LOD on mobile** — edge geometry at crease angles 20° / 50° / 70°, switched by camera distance; desktop uses 2 levels
- **Frustum culling** — `LineSegments2` objects carry explicit bounding spheres and are culled when outside the camera frustum
- **Mobile optimisations** — narrower lines, reduced halo opacity, denser fog, `pixelRatio` locked to 1, `powerPreference: high-performance`
- **Fixed 25 fps cap** — render loop throttled via `performance.now()` delta check; smooth on low-end devices
- **CRT overlay stack** — curved-glass mask, tactical grid, animated tri-tone noise, scanlines and RGB shift, implemented in CSS over the WebGL canvas (no shader pass)
- **Tap to toggle** — tap/click anywhere on the scene to switch between autopilot and manual OrbitControls; pointer drag is distinguished from tap via 8px threshold
- **Dual-model architecture** — original `scene.glb` for visual fidelity, `scene_zoned.glb` for zone logic and lock targeting
- **Target Acquisition & Tracking** — autonomous HUD reticle using 3D-to-2D projection; frames buildings precisely via volumetric bounding-box corners.
- **Responsive HUD** — dynamic scaling and positioning to prevent overlap on mobile/portrait screens; uses CSS `clamp` and `calc` for definitive panel separation.

---

## File Structure

```
project/
├── LICENSE
├── README.md
├── index.html
├── styles/
│   └── main.css
├── js/
│   ├── config.js
│   ├── loader.js
│   ├── lock-system.js
│   ├── lod.js
│   ├── main.js
│   ├── panorama.js
│   └── state.js
└── assets/
│   ├── fonts/
│   └── VCROSDMono.woff2
└── models/
    ├── scene.glb
    └── scene_zoned.glb
```

---

## Requirements

### 3D Model

The application expects the **"New York City. Manhattan"** model by **truekit**, available on Sketchfab under the **CC-BY-4.0** licence:

> https://sketchfab.com/3d-models/new-york-city-manhattan-372bc495b3a941308f4a3198bc45e17b

Download the **GLB** version and place it as:

```
assets/models/scene.glb
```

A single `.glb` bundles geometry and textures in one binary file — no separate `.bin` needed. The original file is ~33 MB; it has since been compressed and optimised, reducing its size significantly while remaining within GitHub's 25 MB per-file limit.

### Zoned Model

The target lock system requires a second variant of the model: `NYC/scene_zoned.glb`. This file is a **pre-processed, optimised version** of `scene.glb` in which the original geometry has been spatially partitioned into a 16×16 grid of named mesh nodes, each covering approximately one city block.

This preprocessing was performed offline using **@gltf-transform/core** and **@gltf-transform/functions** — the resulting file is fully self-contained, already zoned and optimised, and requires no further processing. Simply place it as:

```
assets/models/scene_zoned.glb
```

Without this file the app falls back to single-mesh lock selection, which may produce oversized or inconsistent highlights due to the source model's material-based mesh structure.

### Local Server

Browsers block local file requests (`file://`) for security reasons. Serve the project over HTTP:

```bash
# Option 1 — Node.js
npx serve .

# Option 2 — Python
python3 -m http.server 8080

# Option 3 — VS Code
# Install the Live Server extension and open index.html
```

Then open `http://localhost:PORT/index.html` in your browser.

---

## Controls

| Input | Action |
|---|---|
| Tap / Click | Toggle autopilot ↔ manual control |
| Drag | Orbit camera (manual mode) |
| Scroll / Pinch | Zoom (manual mode) |
| Right-click drag | Pan (manual mode) |

---

## Technical Notes

### Why no build tools?
Native ES modules with an `importmap` resolving Three.js from unpkg. Zero build configuration.

### Why 25 fps?
Mobile GPUs struggle with the additive blending fill rate of thick lines at 60 fps. 25 fps is imperceptible on slow cinematic camera movement and cuts GPU load roughly in half.

### Why chunked loading instead of a spinner?
Processing ~900k vertices of edge geometry synchronously would freeze the browser for several seconds. Processing one mesh per `requestAnimationFrame` keeps the thread free, shows the city building up in real time, and is more cinematic.

### LOD system
Each mesh generates multiple `EdgesGeometry` instances at different crease angle thresholds. Only one level is visible at any time based on camera distance. On mobile a third silhouette-only level (crease 70°) is added for far distances.

### Lock silhouette & Tracking system
Lock highlighting does not render zoned geometry directly. It clips cloned linework from the visual model using zone bounding planes. A separate HTML/CSS reticle tracks the building in screen-space, using volumetric projection to eliminate parallax drift. Jitter and stepped animations are used to maintain a "nervous" digital aesthetic.

### CRT overlay stack
The CRT look is layered in `#crt` using CSS-only overlays: rounded glass mask, vignette, tactical grid, RGB/scanline pass, and animated color noise. Main tuning knobs live in `styles/main.css` under `--crt-*` and `--screen-global-blur`.

### Responsive HUD
The HUD uses media queries specifically tuned for mobile portrait modes, reducing font sizes and forcing a central gap through percentage-based widths to ensure left/right panels never overlap.

---

## Credits

- **3D Model** — "New York City. Manhattan" by truekit @ Sketchfab — [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- **Renderer** — [Three.js](https://threejs.org/) r183
- **Concept** — *Escape from New York* (1981), dir. John Carpenter

---

## Licence

The application code is released under the **MIT Licence**.  
The 3D model is subject to its own **CC-BY-4.0** licence — attribution to truekit is required.
