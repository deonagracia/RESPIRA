# RESPIRA: Interactive Respiratory Model & Control Laboratory

**Phase 1 (UI/UX foundation), Phase 2 (simulation engine), a Phase 2
refinement pass, and a GLB model integration pass are all complete.** Phase 1
built the full navigation, page layout, and animation-ready components.
Phase 2 added the mathematical respiratory model, the PID controller,
real-time charts, and a ventilation-driven microscopic view. The refinement
pass rebuilt the 3D lung into an anatomically-shaped procedural model,
connected the 3D visualization directly to the live simulation state,
clarified Sleep Simulation as a scripted condition rather than a dark theme,
and rewrote the automatic interpretation and other user-facing text. The GLB
integration pass (section 11) replaced that procedural lung with a licensed
anatomical 3D model as the app's primary model, kept the procedural version
only as a load-failure fallback, and rewired anatomy markers, camera
framing, and airflow visualization to the real mesh. All of this was done as
edits to the existing Phase 1/2 structure, without changing its folder
layout or navigation.

---

## 1. Tech stack

- **Vite** — dev server & bundler
- **Vanilla JavaScript** (ES modules, no framework)
- **Three.js** — GLB-based anatomical 3D lung, loaded via `GLTFLoader` (see section 11), with a procedural fallback (section 10) used only if the GLB fails to load
- **Plain HTML/CSS + Canvas 2D** — hand-built design system and charts (no charting library)

React and chart libraries were deliberately not added — the brief asked to
keep the stack simple, and neither was necessary for what this app needs.

## 2. Folder structure

```
RESPIRA/
│
├── index.html                 # App shell: header/nav, journey bar, #app mount, modal/toast roots
├── package.json
├── vite.config.js
├── README.md
│
├── src/
│   ├── main.js                 # Entry point: loads CSS, boots the router, starts the sim engine
│   │
│   ├── js/
│   │   ├── bus.js               # Tiny pub/sub event bus (sim:start, sim:tick, cpap:toggle, ...)
│   │   ├── state.js             # Central state store — user controls + live telemetry
│   │   ├── navigation.js        # Hash router: route table, theme switch, journey bar, page lifecycle
│   │   ├── ui.js                 # Shared helpers: journey bar, modal, toast, prev/next footer
│   │   ├── lung3D.js             # Reusable Three.js anatomical lung (GLB primary, procedural fallback) + clickable markers
│   │   ├── airway2D.js           # Reusable SVG airway/airflow diagram (OSA, CPAP, Simulation)
│   │   ├── compareControl.js     # "Compare Control" modal (Natural vs CPAP feedback loops)
│   │   ├── respiratoryModel.js   # Phase 2 — RC plant: airway resistance + lung compliance
│   │   ├── pidController.js      # Phase 2 — discrete PID with anti-windup
│   │   ├── simulationEngine.js   # Phase 2 — persistent physics loop (model + PID + publishing)
│   │   ├── alveolus.js           # Phase 2 — ventilation-driven particle animation helpers
│   │   ├── charts.js             # Phase 2 — dependency-free canvas line-chart utility
│   │   ├── simHistory.js         # Phase 2 — records a run's samples + derived stats for Analyze
│   │   ├── home.js               # Home page
│   │   ├── anatomy.js            # 01 Anatomy page (3D lung + numbered markers + info panel)
│   │   ├── osa.js                # 02 OSA page (Normal vs Obstructed airway comparison)
│   │   ├── cpap.js               # 03 CPAP page (flow diagram + Activate CPAP toggle)
│   │   ├── simulation.js         # 04 Simulate page (the lab — now a live view of the engine)
│   │   ├── microscopic.js        # Alveolus "Zoom to Alveoli" view (ventilation-driven animation)
│   │   └── analysis.js           # 05 Analyze page (real stats/charts once a run exists)
│   │
│   └── css/
│       └── style.css             # Full design system: tokens, themes, components, responsive rules
│
└── public/
    ├── models/                  # struktur_paru-paru_manusia.glb — primary 3D lung model (see section 11)
    ├── textures/                 # (empty) unused, textures ship embedded in the GLB
    └── icons/                    # (empty) icon assets
```

## 3. Installation

```bash
cd RESPIRA
npm install
```

## 4. Running the project

```bash
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

Other available scripts:

```bash
npm run build     # production build -> dist/
npm run preview   # serve the production build locally
```

## 5. The simulation model (Phase 2)

**This is deliberately a simple, single-compartment model** — accurate
enough to give the PID controller something real to fight against and to
teach the natural-vs-artificial control comparison the brief calls for, but
not a clinically validated respiratory model.

### Plant — `respiratoryModel.js`

An RC (resistor/compliance) electrical-circuit analogy:

```
flow      Q(t)  = (drive(t) − P(t)) / R(t)     [L/s]
pressure  dP/dt = Q(t) / C                      [cmH2O/s]
```

- **R(t)** — "Airway Resistance". Rises nonlinearly with the Airway
  Obstruction slider: `R = 5 + 45·(obstruction/100)²` cmH2O·s/L, so
  resistance stays manageable until obstruction gets severe, then climbs
  sharply — closer to a real collapsing airway than a straight line.
- **C** — lung/circuit compliance, held constant at 0.3 L/cmH2O.
- **drive(t)** — the CPAP blower's contribution (`(blowerOutput/100) × 25`
  cmH2O when CPAP is on, else 0) **plus** a spontaneous patient effort: a
  half-sine inspiratory pulse (2.2 cmH2O amplitude) repeating at the
  Respiratory Rate slider's frequency. This effort is always present —
  it's what still produces a (very limited) flow signal during a simulated
  obstructive event with CPAP off, which is the core OSA demonstration.
- **P(t)** — "Actual Pressure", the controlled variable.

### Controller — `pidController.js`

A textbook discrete PID (`Kp·e + Ki·∫e + Kd·de/dt`) with **conditional-integration
anti-windup**: the integral only accumulates further when doing so would
not push the output past its 0–100% saturation limits. Gains are read live
from the Kp/Ki/Kd inputs on every physics tick, so you can retune while a
run is in progress.

### Engine — `simulationEngine.js`

A **persistent, page-independent** loop (started once from `main.js`):

- fixed-timestep physics (50 Hz, accumulator pattern) for numerical
  stability regardless of frame rate or tab throttling
- publishes to `state.js` / `simHistory.js` / a `sim:tick` bus event at a
  throttled ~12.5 Hz so memory and redraw cost stay bounded on a long run
- only advances while `simStatus` is `running` or `sleep` — `Pause` truly
  freezes the plant and controller; only `Reset` clears them
- **keeps running when you navigate away from the Simulate page** —
  leaving to look at Anatomy or Analyze does not pause your experiment,
  the same way you wouldn't expect a real instrument to stop because you
  looked away from it

### "Sleep Simulation" — a scripted apnea/hypopnea cycle

Turning it on drives the Airway Obstruction value automatically through a
repeating ~42-second pattern (quiet breathing → airway collapsing → event
held → reopening → recovery) instead of the manual slider, so you can watch
CPAP+PID respond to a recurring obstructive event without touching
anything. The slider disables itself and shows "Auto-driven by Sleep
Simulation" while active, and restores your last manual value when you end
it.

### Microscopic view — `alveolus.js`

The O2/CO2 particle animation's speed and glow are now driven by the
engine's live airflow reading (`ventilationIntensity()`), not idle CSS —
faster/brighter particles mean more air is currently moving. This is still
an **illustrative, proportional mapping**, not a modeled diffusion/gas-exchange
process (no partial pressures are computed).

### Charts & Analysis — `charts.js` / `simHistory.js`

The three live charts on the Simulate page (Pressure Response, Airflow,
Blower Output) are a small dependency-free canvas line-chart utility,
rolling over the last 15 seconds. Every published sample is also recorded
into `simHistory.js`; the Analyze page reads that recording to fill in the
System Response stats (Target/Actual Pressure, Maximum Error, Settling
Time, Peak Blower Output, Average Airflow — all computed, not fabricated),
draw all four static result charts (including Obstruction Timeline), and
generate a short auto-interpretation sentence from the actual numbers.

## 6. What each page does now

| Route | Page | Behavior |
|---|---|---|
| `#/home` | Home | Hero, two entry buttons, the same auto-rotating anatomical 3D lung used on Anatomy, Anatomy→OSA→CPAP→Simulate→Analyze strip |
| `#/learn/anatomy` | 01 Anatomy | Interactive anatomical 3D lung (trachea, bronchi, 5 lobes, bronchial tree, diaphragm) with 8 clickable markers, camera auto-focus + highlight per marker, Rotate/Reset View/Zoom In/Zoom Out/Fullscreen/Zoom-to-Alveoli |
| `#/learn/osa` | 02 OSA | Side-by-side Normal vs Obstructed airway animation (static, educational, not the live engine) |
| `#/learn/cpap` | 03 CPAP | CPAP → Airflow → Mask → Upper Airway → Lung flow diagram; Activate CPAP toggles the illustrative airway state (static, educational) |
| `#/simulate` | 04 Simulate | **Live**: RC model + PID controller running in real time, 6 live stat tiles, 3 live charts, the 3D lung's breathing/airflow/obstruction/CPAP visuals synced to the same state, Start/Pause/Reset/Sleep/CPAP fully functional |
| `#/simulate/microscopic` | Zoom-to-Alveoli | Conceptual alveolus cross-section (air space, wall, capillary, red blood cells, O2/CO2 particles) with a scale-in transition on entry; ventilation-driven particle animation reacts to the engine's live airflow |
| `#/analyze` | 05 Analyze | Real System Response stats, 4 static result charts, and an auto-generated interpretation (Indonesian, lab-report style) once a run exists |
| Header button | Compare Control | Modal comparing the Natural respiratory feedback loop vs the CPAP control feedback loop |

The OSA and CPAP *learning* pages intentionally stay as Phase 1's static,
conceptual illustrations — they are teaching pages, not the simulator
itself, so they were left untouched per "pertahankan struktur yang sudah
ada."

## 7. Design system

Colors (from the brief):

| Token | Hex | Usage |
|---|---|---|
| Deep Navy | `#102A43` | text, header, structure |
| Teal | `#0F9D9A` | primary interaction |
| Soft Cyan | `#7DD3D0` | airflow / respiratory visualization / highlights |
| Warm White | `#F7F9F7` | Learn Mode background |
| Soft Gray | `#E8EEF0` | neutral surfaces |
| Amber | `#F4B942` | warning / disturbance |
| Red | `#D94A4A` | critical state only |

Status is never conveyed by color alone — every status chip and severity
tag carries a text label alongside its color (e.g. "CPAP: On", "Obstruction:
Severe").

- **Learn Mode** (`theme-learn`, Anatomy/OSA/CPAP) — light, warm white
  background, navy text, teal/cyan accents.
- **Simulation Mode** (`theme-lab`, Simulate + Microscopic) — dark navy
  background, teal/cyan glow, immersive.
- **Home** keeps its own dark hero treatment; **Analyze** stays a neutral
  light "reporting" treatment.

## 8. Phase 2 checklist

- [x] `respiratoryModel.js` — single-compartment RC plant with nonlinear
      obstruction→resistance mapping and spontaneous patient effort
- [x] `pidController.js` — discrete PID with anti-windup, live-tunable gains
- [x] `simulationEngine.js` — persistent fixed-timestep loop, independent
      of page navigation
- [x] Simulation page's 6 stat tiles are live (Target/Actual Pressure,
      Airflow, Airway Resistance, Blower Output, Error)
- [x] Simulation page's 3 graphs are live, rolling 15 s canvas line charts
- [x] CPAP on/off, Start/Pause/Reset, and Sleep Simulation all drive real
      physics, not just UI state
- [x] "Sleep Simulation" runs a scripted, repeating obstructive-event pattern
- [x] Simulation keeps running in the background when navigating to other pages
- [x] Microscopic view's O2/CO2 particle animation is ventilation-driven
- [x] Analyze page computes real stats (incl. Settling Time, Max Error,
      Peak Blower, Average Airflow) and draws 4 static charts from the
      recorded run
- [x] Analyze page auto-generates an interpretation sentence from the
      actual computed numbers
- [x] `npm run build` succeeds; a full Playwright smoke test (page loads,
      navigation, PID convergence, CPAP-off apnea behavior, Sleep mode,
      Reset, rapid button interaction) passes with zero console errors
- [x] No structural/layout/navigation changes to the Phase 1 UI — all
      Phase 2 work is additive, new modules wired into the existing pages

## 9. Known simplifications (by design)

- The plant is single-compartment (one R, one C) — not left/right lobes,
  not a multi-alveolar model.
- Airway resistance vs. obstruction is a tuned illustrative curve, not
  derived from a clinical dataset.
- The microscopic view's particle behavior is a proportional visualization
  of airflow, not a modeled O2/CO2 diffusion process.
- "Settling Time" uses a tolerance band of `max(0.3, target×5%)` cmH2O;
  because the model includes a persistent breathing-driven ripple, very
  tight target pressures or poorly tuned gains may legitimately show "Not
  settled" for a short run — that's accurate PID behavior, not a bug.

## 10. Phase 2 refinement pass

This pass rebuilt the 3D lung and connected it to the live simulation, and
did a pass over the app's visuals, interactions, and user-facing text,
without touching the Phase 1 navigation/layout or the Phase 2 math.

### 3D lung model — `lung3D.js`

Rebuilt from two plain spheres into a procedural anatomical model: a
tapered, cartilage-ringed trachea splitting at a carina into right and left
main bronchi, three noise-displaced organic lobes on the right and two on
the left (with a cardiac notch on the left upper lobe), a recursive
bronchial tree grown from each bronchus into its lobes, and a diaphragm.
Lighting moved from ambient+single-light to a hemisphere + two directional
lights + a rim light for real shading depth.

**Procedural, not an imported GLB/glTF, and why:** the brief allowed either
approach. Sourcing a correctly licensed anatomical mesh and shipping its
binary inside the project isn't something this build environment can
reliably fetch or verify the license of at build time, so the model is
built entirely in code instead. That keeps the app self-contained and
working offline with no licensing question, at the cost of not being as
detailed as a sculpted medical mesh. If a licensed GLB is available later,
it only needs to expose the same named parts (`trachea`, `r-bronchus`,
`l-bronchus`, `r-lung`, `l-lung`, `bronchioles`, `alveoli`, `diaphragm`) and
it can be dropped into `public/models/` and loaded in `_buildAnatomy()`
without changing any page code.

**Camera, controls, interaction:** `focusAnatomy(id)` smoothly tweens the
camera to each named part and gives it a soft teal highlight;
`resetCamera()`, `zoomIn()`/`zoomOut()`, and OrbitControls (drag to rotate,
right-drag/two-finger to pan, scroll/pinch to zoom) are wired to visible
toolbar buttons on both Anatomy and Simulate. A Fullscreen button uses the
browser Fullscreen API on the viewport; the existing `ResizeObserver` in
`lung3D.js` means the 3D canvas already resizes correctly when that
happens, so no extra resize logic was needed there.

**Visual/simulation sync:** the scene exposes `setBreathingRunning`,
`setRespiratoryRate`, `setObstruction`, `setCPAPActive`, `setPressure`, and
`setAirflowIntensity`. `simulation.js` calls all of these from the same
`state.js` subscription that already drives the stat tiles and charts, so
breathing runs only while the simulation is actually running (frozen on
Pause, reset on Reset), its pace follows the Respiratory Rate slider, the
trachea visibly narrows with Airway Obstruction, and the airway glow
responds to airflow, CPAP state, and pressure. The Analyze/Home/CPAP pages
were not given the same live wiring since they either have no running
simulation to reflect (Home) or already have their own illustrative
airway diagram driven by `airway2D.js` (OSA/CPAP).

### Sleep Simulation clarity

Sleep Simulation now shows a phase banner ("Normal Breathing" / "Airway
Narrowing" / "Obstructive Event (Apnea / Hypopnea)", with a CPAP-responding
variant) derived from the live obstruction value, plus explicit copy on the
Sleep button's own toast ("this is not a display theme") so the dimmed lab
visual reads as a simulated sleep condition, not a dark-mode toggle.

### Text pass

Removed em dashes from all user-facing strings (route titles, toasts,
page copy, the Analyze interpretation) in favor of periods, commas, or a
colon. The Analyze page's automatic interpretation was rewritten in
Indonesian in a Hasil → Penjelasan → Interpretasi (result → explanation →
interpretation) style, stating what the numbers show rather than issuing
instructions, per the brief's examples; the rest of the app's UI stayed in
the English it was already built in (Phase 1/2), since the brief's
Indonesian examples were specific to that one generated paragraph.

### Known limitations after this pass

- The lobes are still visibly low-poly up close (icosahedron-based, not a
  sculpted mesh) and their fissures/contours are a stylized approximation,
  not a medically precise shape.
- The bronchial tree's deeper branches are intentionally kept short and
  contained within each lobe's silhouette so they don't visually escape the
  tissue; it reads as "branching near the entry point" rather than a fully
  traced airway tree down to true bronchiole scale.
- Obstruction is visualized as the trachea narrowing; more distal,
  lobe-specific narrowing is not modeled (the underlying physics is also
  single-compartment, per section 9).
- The alveolus microscopic view's "deeper" transition is a CSS scale/fade
  on page entry, not a continuous 3D camera fly-through from the whole-lung
  view.
- OSA/CPAP learning pages keep their own static, illustrative airway
  diagram (`airway2D.js`) rather than being re-driven by the 3D lung or the
  live engine, matching how Phase 1/2 scoped them as teaching pages.

## 11. GLB model integration

A licensed anatomical 3D model was supplied for this pass
(`struktur_paru-paru_manusia.glb`, placed at `public/models/`), replacing
the procedural lung from section 10 as the app's primary and only 3D model.
The procedural builder was kept as a fallback (see below) but no longer
renders unless the GLB fails to load.

**Source and license.** The file is "Struktur Paru-Paru Manusia" by
Fadilah088 (https://sketchfab.com/Fadilah088), sourced from Sketchfab
(https://sketchfab.com/3d-models/struktur-paru-paru-manusia-71066e8e69f548ad8655bca36d3fa1e1),
licensed CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Attribution
is required if the model or a derivative is redistributed further.

**What the file actually contains.** Inspecting its node/mesh structure
(name, hierarchy, and a connectivity check on the triangle data) found:

- One lung mesh, named by its own author as the right lung, with PBR
  materials and textures.
- One continuous, connected trachea + bilateral bronchial tree mesh (this
  is a single mesh, not separate trachea/right-bronchus/left-bronchus
  pieces, confirmed by connected-component analysis on its triangle data).
- A detailed larynx assembly (cricothyroid ligament, epiglottis, thyroid
  membrane and cartilage, both vocal folds), loaded and kept in the scene
  for visual completeness but not wired to any marker or animation.
- No left lung mesh and no diaphragm mesh.

**Loading (`lung3D.js#_loadGLB`).** The model loads via `GLTFLoader`,
async, behind a small "Memuat model 3D..." overlay. Meshes are classified
by walking each mesh's own name plus its ancestor node names (the file's
descriptive names live on parent nodes, not the leaf mesh, a common
Blender/Sketchfab export pattern) and matching `trachea`/`bronch` before
the more general `lung` token, since the lung and airway mesh share a
parent group whose own name happens to contain "lung" too. If neither a
lung nor an airway mesh can be identified this way, loading is treated as
failed and the app falls back to the procedural model from section 10; it
never shows both, and the procedural model is never the first thing drawn
while the GLB is still loading.

Camera framing, position and scale are computed at runtime from the
loaded model's own measured bounding box and bounding sphere (recenter to
origin, scale to a consistent on-screen height, then place the camera at
a distance derived from the model's actual radius and the camera's field
of view), rather than from constants tuned for the old procedural model.
This is what keeps the model neither too close nor too far on first load
regardless of which model ended up loading.

**Anatomy markers (8 total, unchanged from section 10's marker IDs).**
Since this file only ships one lung and no diaphragm, each marker's
description in `anatomy.js` is honest about what is and is not a real
mesh in this GLB, per marker:

| Marker | Real mesh? | Notes |
|---|---|---|
| Trakea | Yes (shared airway mesh) | |
| Bronkus Utama Kanan | Yes (shared airway mesh) | Same physical mesh as trachea; anchor point differs, highlight target is the whole airway |
| Bronkus Utama Kiri | Yes (shared airway mesh) | Same as above |
| Paru-Paru Kanan | Yes (the file's own lung mesh) | |
| Paru-Paru Kiri | No | Anchor sits near the open side of the airway; info panel discloses only one lung mesh exists |
| Bronkiolus | Yes (shared airway mesh) | |
| Alveolus | Yes (uses the lung mesh) | Panel points to the microscopic "Zoom to Alveoli" view for the real detail |
| Diafragma | No | Anchor sits at the lung's lower edge; info panel discloses no diaphragm mesh exists |

Camera focus for the two markers with no real mesh (Paru-Paru Kiri,
Diafragma) returns to the default overview framing instead of dollying in
on empty space, so the real model stays visible in frame while the info
panel explains the limitation.

**Breathing, diaphragm, obstruction, airflow, CPAP.** All of the
simulation-driven behavior from section 10 (`setBreathingRunning`,
`setRespiratoryRate`, `setObstruction`, `setCPAPActive`, `setPressure`,
`setAirflowIntensity`, called from `simulation.js`'s existing state
subscription) now animates the GLB's own lung/trachea meshes directly,
with no new parameters and no new controller: the respiratory-rate-to-
cycle math, the PID controller, and the RC plant model are untouched.
`setDiaphragmPosition()` is a safe no-op on this model (no diaphragm mesh
to move, per the brief's own instruction not to build one that isn't
there). Obstruction narrowing on the real mesh uses a much smaller scale
factor than the old procedural lumen did, since this is authored geometry
and an aggressive squeeze reads as broken rather than obstructed; airflow
particles (`_buildAirflowParticles`/`_updateAirflowParticles`) travel a
curved path from the trachea into the lung along the same single
`THREE.Points` system as before, tinted and sped up/down from the same
`_airflowIntensity`, obstruction, and CPAP state as the rest of the scene.

**Auto-rotate fix.** While building this, idle auto-rotation was found to
slowly drift the whole model out of frame: the model's recentering
offset is a fixed translation computed once assuming no rotation, so
rotating that same object directly made its visual center orbit away from
where the camera was aimed. Fixed by rotating an unrotated parent "pivot"
group instead of the recentered model itself, so the pivot's own origin
(which the recentered content sits exactly on) stays the true center of
rotation at any spin angle. This affects both the GLB and the procedural
fallback, since both go through the same recentering step.

### Files changed for the GLB integration

- `public/models/struktur_paru-paru_manusia.glb` — new, the model asset.
- `src/js/lung3D.js` — GLB loading, runtime camera framing, mesh
  classification, marker anchors, airflow particle path, and the
  auto-rotate pivot fix. The section 10 procedural builder is kept, renamed
  `_buildProcedural()`, used only as the load-failure fallback.
- `src/js/anatomy.js` — marker copy rewritten to Indonesian and to
  accurately describe which markers map to a real mesh in this file.
- `src/css/style.css` — added the `.lung3d-loading` rule for the loading
  overlay shown while the GLB is being fetched and parsed.

### Known limitations after this pass

- Only one lung is modeled; "Paru-Paru Kiri" is a mirrored reference point
  rather than a real mesh, disclosed in its own marker text.
- No diaphragm mesh exists in the source file; "Diafragma" is a reference
  point at the lung's base, also disclosed in its own marker text.
- Trachea, both main bronchi, and the bronchioles marker all highlight the
  same single continuous airway mesh, since the source file does not
  separate them; only their camera anchor points differ.
- The larynx sub-parts load and render but are not wired to any marker,
  animation, or interaction, since the brief only asked for the 8 existing
  anatomy markers to be preserved.

## 12. Final revision — two-model architecture (Anatomy vs. Simulate)

The first GLB pass (section 11) used the single `struktur_paru-paru_manusia.glb`
model — which only contains **one** lung mesh — for both the Learn/Anatomy
page and the Simulate page. On the Simulate page this made the breathing
animation read as anatomically incomplete, and a `mesh.scale`-based
breathing effect on that file's raw, off-origin geometry visibly dragged
the lung away from the trachea/bronchus every cycle. This revision fixes
both problems without touching the Phase 2 math (RC model, PID/CPAP,
respiratory-rate timing, obstruction, Sleep Simulation) at all.

### Two GLBs, two pages, never merged

| Page | Model | Why |
|---|---|---|
| Learn / Anatomy | `struktur_paru-paru_manusia.glb` | External + partial internal anatomy detail, suited to marker exploration (markers 01–08 unchanged) |
| Simulate (and the Home page preview) | `respiratory_system.glb` (new) | A complete bilateral system — right lung, left lung, trachea, and a 7-piece bronchial tree — for the breathing simulation |

`LungScene` (`src/js/lung3D.js`) takes a `modelVariant: 'anatomy' | 'simulate'`
constructor option and dispatches to one of two independent loader methods,
`_loadAnatomyGLB()` or `_loadSimulateGLB()`. The two GLBs are never loaded
into the same scene or merged into one model; `simulation.js` and `home.js`
pass `modelVariant: 'simulate'`, `anatomy.js` uses the default (`'anatomy'`).

`respiratory_system.glb` — asset credit: **Vikrama Raghuraman**
(https://sketchfab.com/vikrama1998), title "Respiratory System", licensed
**CC-BY-4.0**, source:
https://sketchfab.com/3d-models/respiratory-system-a7ac43a140644662a9b896b8a8a10f57

### Analysis before any code changes

Per the brief's explicit requirement, both uploaded GLBs were reverse
engineered *before* writing any loader or animation code, using three
independent checks: (1) manually parsing the glTF JSON/binary chunks for
the raw node hierarchy, parent/child structure, and baked transform
matrices; (2) rendering each file with the real `GLTFLoader` in a headless
browser and reading true world-space bounding boxes off the live scene
graph (so every ancestor matrix is already accounted for, not
hand-computed); (3) screenshotting the whole model and every mesh in
isolation to positively identify which mesh is which anatomical part.

`respiratory_system.glb` turned out to already assemble correctly: two
lung meshes (parented under nodes named `Sphere_3` / `Sphere.001_4`, the
second mirrored via its own baked matrix) and a 7-piece bronchial tree, all
parented under one `Cylinder_5` node, sitting in one continuous, correctly
touching anatomical arrangement as authored. No diaphragm mesh exists in
either file. Because the file's own hierarchy was already correct, it is
used exactly as authored — `_loadSimulateGLB()` never repositions an
individual mesh; the only transform applied to the whole thing is the same
whole-root recenter-and-scale (`_frameToFit`) used for camera framing on
every page, which moves the root, never a child mesh.

### Root cause of the "floating parts" bug, and the fix

`THREE.Mesh.scale` always scales around the mesh's own **local origin**
(0,0,0), not around its geometry's bounding-box center. Both source GLBs'
lung meshes have raw geometry that sits far from that local origin — an
artifact of being cut from a larger authored scene without being
re-centered. Scaling a mesh like that for the breathing effect doesn't just
grow it in place; it also drags the whole mesh sideways by a large fraction
of its own size, which is exactly what made the lung appear to separate
from the trachea/bronchus during breathing in the first pass.

Fix: two new helpers, `_computeMedialPivot()` and `_recenterMeshPivot()`,
run once at load time on every lung mesh (in both variants). They bake a
new local origin into the mesh's geometry at its **medial (hilum-side)**
bounding-box edge — the point nearest the airway, biased toward the upper
part of the lung, approximating where the lung actually attaches to the
bronchus — and compensate the mesh's position so nothing visibly moves at
the moment this runs. After that, every subsequent `.scale` call during
breathing pivots around that anatomical attachment point instead of the
raw origin, so the lung volume expands and contracts in place instead of
sliding away from the airway. No mesh position is ever set from a guessed
screen coordinate; the pivot point is computed from the mesh's own
geometry and the airway's real world position.

### Obstruction no longer deforms any mesh

The previous pass narrowed the trachea by scaling it (`trachea.scale.set(narrow, 1, narrow)`).
This revision removes that entirely — `setObstruction()` now only stores
the percentage. Obstruction is communicated purely through non-geometric
visualization: the airway mesh's emissive glow intensity scales with
obstruction (and CPAP/airflow state), and the airflow particle system
(now multi-path — one path per lung, so both sides show flow on the
bilateral model) already reflects the real RC-model airflow number. No
airway geometry is ever deformed, so obstruction can never visually
separate or distort the model.

### Files changed in this revision

- `public/models/respiratory_system.glb` — new model asset (Simulate page).
- `src/js/lung3D.js` — added `modelVariant` option; split the old single
  loader into `_loadAnatomyGLB()` (unchanged classification logic, now
  pivot-safe) and the new `_loadSimulateGLB()`; added
  `_computeMedialPivot()`/`_recenterMeshPivot()`; generalized breathing,
  airflow particles (now multi-path), and airway glow to work over arrays
  (`this.allLobes`, `this.airwayMeshes`, `this._airflowPaths`) so the same
  code drives both one-lung and two-lung models; removed all
  obstruction-driven mesh scaling.
- `src/js/simulation.js`, `src/js/home.js` — pass `modelVariant: 'simulate'`
  so these two pages use the new bilateral model; `anatomy.js` is
  unchanged and keeps the original single-lung model and its 8 markers.

### Testing performed for this revision

- `npm run build` — zero errors; both GLBs present in `dist/models/`.
- Headless-browser pass over `/#/simulate`, `/#/home`, `/#/learn/anatomy`
  with zero JavaScript/Three.js console or page errors.
- Visual verification of the **static** (pre-Start) Simulate and Home
  views: both lungs, trachea, and bronchial tree read as one connected
  system, nothing floating or separated.
- Visual verification with the simulation **running**: Start, multiple
  breathing cycles observed — both lungs visibly expand and contract while
  the trachea/bronchus stay fixed and fully attached throughout; changing
  Respiratory Rate changes cycle speed with anatomy position unchanged;
  raising Obstruction to Severe changes airway glow/airflow/resistance with
  no mesh movement; enabling CPAP drives the existing PID/blower output
  with the model intact; Sleep Simulation was run through its
  Normal → Airway Narrowing → Obstructive Event stages with the model
  staying unified and lungs following the respiratory state; Reset returns
  to the initial anatomical position with the controls and live status
  cleared; rotate, scroll-zoom, camera reset, and fullscreen all move the
  whole system as one unit; Zoom to Alveoli transitions to the microscopic
  view and navigating back to Simulate reloads the full intact system.
- Zero console/page errors observed across every interaction above.
