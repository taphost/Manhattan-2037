# MANHATTAN // NIGHT VISION
### 2037 Edition

A real-time 3D night-vision rendering of Manhattan, inspired by the aesthetic of *Escape from New York* (1981). Built entirely in vanilla JavaScript using Three.js — no build tools, no frameworks, one HTML file.

---

## Preview

Green wireframe city. CRT scanlines. Phosphor glow. A slow cinematic autopilot tour around the island. The kind of screen you'd see in a surveillance room in a dystopian 2037.

---

## Features

- **Wireframe night-vision rendering** — buildings rendered as dark solids with glowing green edges via `LineSegments2` / `LineMaterial`, producing real pixel-width lines independent of WebGL limitations
- **Additive glow** — two-layer line system (core + halo) simulating CRT phosphor bloom
- **Cinematic autopilot** — smooth 7-keyframe panoramic tour using cubic Hermite interpolation (smootherstep), varying distance, height and angle continuously
- **Chunked async loading** — model geometry is converted one mesh per frame via `requestAnimationFrame`, keeping the UI responsive and making the city materialise progressively as a visual feature
- **HUD typewriter** — terminal-style boot sequence types out system info in parallel with loading; flicker animation on the whole HUD simulates phosphor instability
- **3-level LOD on mobile** — edge geometry at crease angles 20° / 50° / 70°, switched by camera distance; desktop uses 2 levels
- **Frustum culling** — `LineSegments2` objects carry explicit bounding spheres and are culled when outside the camera frustum
- **Mobile optimisations** — narrower lines, reduced halo opacity, denser fog, `pixelRatio` locked to 1, `powerPreference: high-performance`
- **Fixed 25 fps cap** — render loop throttled via `performance.now()` delta check; smooth on low-end devices
- **CRT scanline overlay** — CSS `repeating-linear-gradient` fullscreen overlay, zero GPU cost
- **Tap to toggle** — tap/click anywhere on the scene to switch between autopilot and manual OrbitControls; pointer drag is distinguished from tap via 8px threshold

---

## File Structure

```
project/
├── index.html
├── README.md
├── fonts/
│   └── VCROSDMono.woff2
└── NYC/
    └── scene.glb       ← 3D model, geometry + textures in one file
```

---

## Requirements

### 3D Model

The application expects the **"New York City. Manhattan"** model by **truekit**, available on Sketchfab under the **CC-BY-4.0** licence:

> https://sketchfab.com/3d-models/new-york-city-manhattan-372bc495b3a941308f4a3198bc45e17b

Download the **GLB** version. Place the file as:

```
NYC/scene.glb
```

A single `.glb` bundles geometry and textures in one binary file — no separate `.bin` needed. At ~33 MB it fits under GitHub's 100 MB per-file limit without Git LFS.

### Local Server

Browsers block local file requests (`file://`) for security reasons. You must serve the project over HTTP:

```bash
# Option 1 — Node.js
npx serve .

# Option 2 — Python
python3 -m http.server 8080

# Option 3 — VS Code
# Install the "Live Server" extension, right-click the HTML file → Open with Live Server
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
The entire application is a single HTML file using ES module `importmap` to resolve Three.js from the unpkg CDN. Zero dependencies to install, zero configuration.

### Why 25 fps?
Mobile GPUs struggle with the additive blending fill rate of thick lines at 60 fps. 25 fps is imperceptible on slow cinematic camera movement and cuts GPU load roughly in half.

### Why chunked loading instead of a spinner?
Processing ~900k vertices of edge geometry synchronously would freeze the browser for several seconds. Processing one mesh per `requestAnimationFrame` keeps the thread free, shows the city building up in real time, and is more cinematic.

### LOD system
Each mesh generates multiple `EdgesGeometry` instances at different crease angle thresholds. Only one level is visible at any time based on camera distance. On mobile a third silhouette-only level (crease 70°) is added for far distances.

---

## Credits

- **3D Model** — "New York City. Manhattan" by truekit @ Sketchfab — [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- **Renderer** — [Three.js](https://threejs.org/) r183
- **Concept** — *Escape from New York* (1981), dir. John Carpenter

---

## Licence

The application code is released under the **MIT Licence**.  
The 3D model is subject to its own **CC-BY-4.0** licence — attribution to truekit is required.
