/**
 * lung3D.js
 * -----------------------------------------------------------------------
 * Loads and drives RESPIRA's 3D respiratory model. Two different GLB files
 * are used for two different jobs and are never combined into one scene
 * (`options.modelVariant`, set per page):
 *
 *   'anatomy'  -> public/models/struktur_paru-paru_manusia.glb
 *                 "Struktur Paru-Paru Manusia" by Fadilah088, via Sketchfab,
 *                 CC-BY-4.0. One lung mesh, a full trachea/bronchial tree,
 *                 and a larynx assembly; no second lung, no diaphragm.
 *                 Used by the Learn/Anatomy page for marker exploration.
 *
 *   'simulate' -> public/models/respiratory_system.glb
 *                 "Respiratory System" by Vikrama Raghuraman, via Sketchfab,
 *                 CC-BY-4.0. Both lungs plus a full trachea/bronchial tree,
 *                 already assembled in correct anatomical position by the
 *                 file's own node hierarchy; no diaphragm mesh. Used by the
 *                 Simulate page (and the Home preview) so the live
 *                 simulation always shows a whole, unbroken system.
 *
 * A small procedural fallback (the shape used before GLB integration) only
 * appears if the relevant GLB genuinely fails to load, and is never shown
 * once that GLB has loaded successfully. See README section 12 for the
 * full attribution of both files, what each does and does not contain, and
 * how the Anatomy model's parts map onto the 8 anatomy markers.
 *
 * Breathing never repositions the trachea/bronchi, and never translates a
 * lung either: each lung mesh is re-centered once at load time onto its own
 * medial (hilum-side) pivot (see _computeMedialPivot/_recenterMeshPivot),
 * so scaling it for a breath expands it in place instead of dragging it
 * away from where it meets the airway. Obstruction never deforms or moves
 * any mesh at all; it is visualized only through airway glow and airflow
 * intensity (see setObstruction).
 *
 * The scene exposes a stable API used by the pages/engine:
 *   Camera / view:   resetCamera, zoomIn, zoomOut, setAutoRotate, focusAnatomy, clearFocus
 *   Breathing:       setBreathingPhase, setRespiratoryRate, setLungExpansion,
 *                    setDiaphragmPosition, setBreathingRunning, resetBreathing
 *   Physiology link: setAirflowIntensity, setObstruction, setCPAPActive, setPressure
 *   Markers:         setMarkers, setActiveMarker, clearActiveMarker (Anatomy page only)
 *   Lifecycle:       mount, resize, dispose
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Two different GLB files for two different jobs, per the brief: Learn/Anatomy
// uses the model with external + partial internal detail suited to marker
// exploration; Simulate uses the fuller bilateral respiratory system so the
// live simulation always shows both lungs, trachea and bronchi as one whole
// system. They are never merged into a single scene.
const ANATOMY_MODEL_URL = `${import.meta.env.BASE_URL}models/struktur_paru-paru_manusia.glb`;
const SIMULATE_MODEL_URL = `${import.meta.env.BASE_URL}models/respiratory_system.glb`;

// Tissue tones used only by the procedural fallback (the GLB keeps its own
// authored materials/textures). Brand teal/cyan/amber are reserved for
// airway lumen, airflow, obstruction and highlight/selection cues on both
// paths, per the design system.
const COLOR_LUNG_RIGHT = 0xc98a8f;
const COLOR_LUNG_LEFT = 0xc07f88;
const COLOR_AIRWAY_WALL = 0xdfb9ae;
const COLOR_CARTILAGE = 0xefe0d6;
const COLOR_DIAPHRAGM = 0xb56b6f;

const COLOR_TEAL = 0x0f9d9a;
const COLOR_CYAN = 0x7dd3d0;
const COLOR_AMBER = 0xf4b942;

/** Tiny deterministic PRNG (mulberry32), used for the fallback tree and for airflow-particle jitter. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An organically-deformed blob used for the procedural fallback's lobes: an
 * icosahedron with smooth per-vertex radial noise, an apex taper and a
 * medial flattening so it reads as a lung, not a ball.
 */
function makeLobeGeometry({ radius = [0.4, 0.45, 0.35], medialSign = 1, notch = 0, seed = 1, detail = 4 }) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const pos = geometry.attributes.position;
  const rng = makeRng(seed);

  const bumps = Array.from({ length: 5 }, () => ({
    dir: new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize(),
    strength: 0.028 + rng() * 0.045,
    sharpness: 2.5 + rng() * 3
  }));

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();

    let bump = 0;
    bumps.forEach((b) => {
      const d = Math.max(0, n.dot(b.dir));
      bump += Math.pow(d, b.sharpness) * b.strength;
    });

    const apexTaper = 1 - Math.max(0, n.y) * 0.28;
    const medialFlatten = 1 - Math.max(0, n.x * medialSign) * 0.32;

    let notchDent = 1;
    if (notch > 0) {
      const notchDir = new THREE.Vector3(medialSign, -0.5, 0.3).normalize();
      const d = Math.max(0, n.dot(notchDir));
      notchDent = 1 - Math.pow(d, 3) * notch;
    }

    const radialScale = (1 + bump) * apexTaper * medialFlatten * notchDent;
    v.multiplyScalar(radialScale);
    v.set(v.x * radius[0], v.y * radius[1], v.z * radius[2]);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geometry.computeVertexNormals();
  return geometry;
}

export class LungScene {
  /**
   * @param {HTMLElement} container - element the canvas will fill (must be position:relative)
   * @param {object} [options]
   * @param {boolean} [options.interactive=false] - enable OrbitControls (drag to rotate/pan, scroll/pinch to zoom)
   * @param {boolean} [options.autoRotate=true] - idle auto-rotation
   * @param {boolean} [options.breathing=true] - idle decorative breathing when not in live mode
   * @param {boolean} [options.dark=true] - dark lab-style background vs transparent
   * @param {boolean} [options.compact=false] - tighter camera framing for small containers
   * @param {'anatomy'|'simulate'} [options.modelVariant='anatomy'] - which GLB to load:
   *   'anatomy' loads the marker-annotated exploration model (struktur_paru-paru_manusia.glb),
   *   'simulate' loads the full bilateral respiratory system (respiratory_system.glb).
   *   The two are never combined into one scene.
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      interactive: false,
      autoRotate: true,
      breathing: true,
      dark: true,
      compact: false,
      modelVariant: 'anatomy',
      ...options
    };

    this.markers = [];
    this.markerEls = new Map();
    this.onMarkerClick = null;
    this._raf = null;
    this._resizeObserver = null;
    this._clock = new THREE.Clock();
    this._disposed = false;
    this._usingGLB = false;

    // Breathing state
    this._liveMode = false;
    this._livePhase = 0.15; // 0 = fully exhaled, 1 = fully inhaled
    this._idleRespRate = 12;
    this._lastAppliedExpansion = 0;
    this._breathingActive = true; // false = animation frozen at its current phase (e.g. simulation paused)
    this._breathClock = 0; // seconds; only advances while _breathingActive, so pace tracks respiratory rate exactly
    this._lastEasedPhase = 0;
    this._breathDirection = 1; // +1 = inspiration (airflow in), -1 = expiration (airflow out)

    // Physiology-linked visual state
    this._airflowIntensity = 0; // 0..1
    this._obstructionPct = 0; // 0..100
    this._cpapActive = false;
    this._pressureValue = null;

    // Camera animation
    this._camAnim = null;
    this._highlightedName = null;
    this._focusedId = null;
  }

  mount() {
    const { container, options } = this;
    container.classList.add('lung3d-container');

    this.markerLayer = document.createElement('div');
    this.markerLayer.className = 'lung3d-marker-layer';
    container.appendChild(this.markerLayer);

    this._loadingEl = document.createElement('div');
    this._loadingEl.className = 'lung3d-loading';
    this._loadingEl.textContent = 'Memuat model 3D...';
    container.appendChild(this._loadingEl);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    this.scene = new THREE.Scene();
    if (options.dark) {
      this.scene.fog = new THREE.FogExp2(0x08131f, 0.05);
    }

    // Auto-rotate spins this pivot, not the model root itself. The model
    // root's own position is a fixed recentering offset computed once (in
    // _frameToFit) assuming no rotation; rotating the root directly would
    // then orbit the model's visual center away from that fixed offset
    // every frame, drifting the whole thing out of camera view over time.
    // Rotating an unrotated ancestor pivot instead keeps the recentered
    // content correctly pinned at the origin no matter the spin angle.
    this._rotationPivot = new THREE.Group();
    this._rotationPivot.name = 'lungRotationPivot';
    this.scene.add(this._rotationPivot);

    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 200);
    this.defaultCameraPos = new THREE.Vector3(1, 0.6, 6);
    this.defaultTarget = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(this.defaultCameraPos);
    this.camera.lookAt(this.defaultTarget);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this._setupLights();

    if (options.interactive) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(this.defaultTarget);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.09;
      this.controls.enablePan = true;
      this.controls.panSpeed = 0.6;
      this.controls.screenSpacePanning = true;
      this.controls.update();
    }

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);

    this._loadGLB()
      .then(() => {
        this._usingGLB = true;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[RESPIRA] Could not load the GLB lung model, using the procedural fallback instead.', err);
        this._usingGLB = false;
        this._buildProcedural();
        this._frameToFit();
      })
      .finally(() => {
        this._loadingEl?.remove();
        this._loadingEl = null;
        this._buildAirflowParticles();
      });

    this._animate();
    return this;
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0x9fd8e0, 0x1a0f10, this.options.dark ? 0.6 : 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff3ea, this.options.dark ? 1.5 : 1.2);
    key.position.set(3.2, 4, 4.5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xbfe9ea, 0.5);
    fill.position.set(-3.5, 1, 2.5);
    this.scene.add(fill);

    const rim = new THREE.PointLight(COLOR_CYAN, this.options.dark ? 1.2 : 0.35, 14);
    rim.position.set(-2, -1.5, 3.5);
    this.scene.add(rim);
  }

  // -----------------------------------------------------------------------
  // GLB model
  // -----------------------------------------------------------------------

  /** Every ancestor node name above `obj`, used to read the descriptive names glTF puts on parent nodes. */
  _ancestorNames(obj) {
    const names = [];
    let p = obj.parent;
    while (p) {
      if (p.name) names.push(p.name);
      p = p.parent;
    }
    return names;
  }

  /** Loads whichever GLB this scene was configured for (`options.modelVariant`). */
  async _loadGLB() {
    if (this.options.modelVariant === 'simulate') return this._loadSimulateGLB();
    return this._loadAnatomyGLB();
  }

  /**
   * Computes a local-space pivot point for a mesh so that later scaling it
   * (breathing expansion) grows the mesh in place instead of dragging it
   * away from a neighboring structure. THREE.Mesh.scale always applies
   * around the mesh's own local origin (0,0,0); if the source GLB's raw
   * geometry sits far from that origin (common when a mesh was cut from a
   * larger scene without being re-centered), even a small scale change
   * displaces the whole mesh by a large fraction of its own size, which is
   * exactly what made the lung appear to separate from the trachea/bronchi
   * during breathing in the previous integration.
   *
   * The chosen pivot is the mesh's own bounding-box edge nearest a given
   * reference point (typically the airway's world center), biased toward
   * the upper part of the box, approximating where the lung attaches to
   * the bronchus (the hilum) — the one part of a real lung that stays
   * essentially still while the rest of the lung expands and contracts.
   */
  _computeMedialPivot(mesh, referenceWorldPoint) {
    const bbox = mesh.geometry.boundingBox;
    const midY = (bbox.min.y + bbox.max.y) / 2;
    const midZ = (bbox.min.z + bbox.max.z) / 2;
    const worldMin = new THREE.Vector3(bbox.min.x, midY, midZ).applyMatrix4(mesh.matrixWorld);
    const worldMax = new THREE.Vector3(bbox.max.x, midY, midZ).applyMatrix4(mesh.matrixWorld);
    const useMinEdge = worldMin.distanceTo(referenceWorldPoint) < worldMax.distanceTo(referenceWorldPoint);
    return new THREE.Vector3(
      useMinEdge ? bbox.min.x : bbox.max.x,
      THREE.MathUtils.lerp(bbox.max.y, bbox.min.y, 0.35),
      midZ
    );
  }

  /**
   * Re-centers a mesh's geometry onto `pivotLocal` and compensates its
   * position so nothing visibly moves at the moment this runs. After this,
   * `mesh.scale` pivots around `pivotLocal` instead of the raw origin.
   */
  _recenterMeshPivot(mesh, pivotLocal) {
    mesh.geometry.translate(-pivotLocal.x, -pivotLocal.y, -pivotLocal.z);
    const worldOffset = pivotLocal.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion);
    mesh.position.add(worldOffset);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.updateMatrixWorld(true);
  }

  async _loadAnatomyGLB() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(ANATOMY_MODEL_URL);
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    let lungMesh = null;
    let airwayMesh = null;
    const larynxMeshes = [];

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const nameChain = [obj.name, ...this._ancestorNames(obj)].join(' ').toLowerCase();
      // Check the more specific "trachea"/"bronch" tokens first: the lung
      // and airway meshes in this file share a common parent group named
      // "Lungs_4", so a chain-wide "lung" match alone would also catch the
      // airway mesh through that shared ancestor and misclassify it.
      if (nameChain.includes('trachea') || nameChain.includes('bronch')) airwayMesh = obj;
      else if (nameChain.includes('lung')) lungMesh = obj;
      else larynxMeshes.push(obj);
    });

    if (!lungMesh || !airwayMesh) {
      throw new Error('Expected lung and trachea/bronchi meshes were not found by name in the GLB.');
    }

    // Give the two meshes we actively re-material/animate their own material
    // instances, so highlighting or tinting one never affects anything else
    // that happens to share the source material.
    lungMesh.material = lungMesh.material.clone();
    airwayMesh.material = airwayMesh.material.clone();
    lungMesh.castShadow = false;
    airwayMesh.castShadow = false;

    lungMesh.geometry.computeBoundingBox();
    airwayMesh.geometry.computeBoundingBox();
    const airwayBoxPre = airwayMesh.geometry.boundingBox.clone().applyMatrix4(airwayMesh.matrixWorld);
    const airwayCenterPre = airwayBoxPre.getCenter(new THREE.Vector3());

    // Re-center the lung's breathing pivot onto its medial (hilum-side)
    // edge, nearest the airway, before reading off its world box below, so
    // every anchor/box computed from here on already reflects the
    // pivot-safe geometry (see _computeMedialPivot/_recenterMeshPivot).
    const lungPivot = this._computeMedialPivot(lungMesh, airwayCenterPre);
    this._recenterMeshPivot(lungMesh, lungPivot);

    const lungBox = lungMesh.geometry.boundingBox.clone().applyMatrix4(lungMesh.matrixWorld);
    const airwayBox = airwayMesh.geometry.boundingBox.clone().applyMatrix4(airwayMesh.matrixWorld);

    const lungCenter = lungBox.getCenter(new THREE.Vector3());
    const airwayCenter = airwayBox.getCenter(new THREE.Vector3());

    // The source file only ships one lung mesh (named "..._Right..." by its
    // own author) attached to one side of the bronchial tree. We trust that
    // authored name rather than guess, and derive which X side of the
    // airway mesh is "the lung side" vs. the open (lung-less) side from it,
    // so the two bronchus markers land on the correct real branches.
    const lungIsOnMinXSide = lungCenter.x < airwayCenter.x;
    const lungSideX = lungCenter.x;
    const openSideX = lungIsOnMinXSide ? airwayBox.max.x : airwayBox.min.x;
    const airwayZ = airwayCenter.z;
    const lerpY = (t) => THREE.MathUtils.lerp(airwayBox.max.y, airwayBox.min.y, t);

this.anatomyAnchors = {
      trachea: new THREE.Vector3(airwayCenter.x, lerpY(0.12), airwayZ),
      
      // 3. BRONKUS KANAN DINAIKKAN:
      // Ubah lerpY(0.48) menjadi lerpY(0.38). Semakin kecil angkanya, posisinya semakin naik ke atas.
      'r-bronchus': new THREE.Vector3(lungSideX, lerpY(0.38), airwayZ),
      
      'l-bronchus': new THREE.Vector3(openSideX, lerpY(0.48), airwayZ),
      'r-lung': lungCenter.clone(),
      'l-lung': new THREE.Vector3(
        openSideX + Math.sign(openSideX - airwayCenter.x || 1) * Math.abs(lungBox.max.x - lungBox.min.x) * 0.35,
        lungCenter.y,
        lungCenter.z
      ),
      
      // 2. BRONKIOLUS DIPINDAH KE KIRI:
      // Ganti lungSideX menjadi openSideX
      bronchioles: new THREE.Vector3(openSideX, lerpY(0.82), airwayZ),
      
      // 1. ALVEOLUS DIPINDAH KE KIRI:
      // Ganti lungCenter.x menjadi openSideX agar sejajar dengan bronkiolus kiri
      alveoli: new THREE.Vector3(openSideX, lungBox.min.y + (lungBox.max.y - lungBox.min.y) * 0.18, lungCenter.z),
      
      diaphragm: new THREE.Vector3(lungCenter.x, lungBox.min.y - (lungBox.max.y - lungBox.min.y) * 0.12, lungCenter.z)
    };

    this.namedParts = {
      trachea: airwayMesh,
      'r-bronchus': airwayMesh,
      'l-bronchus': airwayMesh,
      'r-lung': lungMesh,
      // 'l-lung': intentionally no mesh to highlight, see anatomy.js copy.
      bronchioles: airwayMesh,
      alveoli: lungMesh
      // 'diaphragm': intentionally no mesh, see anatomy.js copy.
    };

    lungMesh.userData.baseScale = lungMesh.scale.clone();
    this.allLobes = [lungMesh];
    this.lungMesh = lungMesh;
    this.trachea = airwayMesh;
    this.airwayMeshes = [airwayMesh];
    this.tracheaLumen = null; // GLB path glows the airway mesh itself instead of a separate lumen
    this.diaphragm = null; // no diaphragm mesh in this GLB; setDiaphragmPosition() is a safe no-op
    this.larynxMeshes = larynxMeshes;

    // A path the airflow particle stream follows: upper trachea -> carina
    // area -> down the lung-side bronchus -> into the lung interior.
    this._airflowPaths = [
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(airwayCenter.x, lerpY(0.05), airwayZ),
          new THREE.Vector3(THREE.MathUtils.lerp(airwayCenter.x, lungSideX, 0.5), lerpY(0.4), airwayZ),
          new THREE.Vector3(lungSideX, lerpY(0.78), airwayZ),
          lungCenter.clone().lerp(new THREE.Vector3(lungCenter.x, lungBox.min.y, lungCenter.z), 0.45)
        ],
        false,
        'catmullrom',
        0.5
      )
    ];

    this.lungGroup = root;
    this._rotationPivot.add(root);
    this._frameToFit(root, lungBox.clone().union(airwayBox));
  }

  /**
   * Loads the full bilateral respiratory system used by the Simulate page
   * (`respiratory_system.glb`). This file's own node hierarchy already
   * assembles both lungs and the full trachea/bronchial tree in correct
   * anatomical position (confirmed by rendering it and inspecting the real
   * bounding boxes before writing this method, per the brief) — the whole
   * `root` is used exactly as authored, with only a whole-root recenter and
   * scale (in `_frameToFit`, identical to the anatomy variant) for camera
   * framing. No individual mesh is ever repositioned by guesswork.
   *
   * Its meshes have generic names ("Object_N"); the two lungs and the
   * seven-piece airway tree are told apart by their immediate parent node
   * names instead ("Sphere"/"Sphere.001" for the lungs, "Cylinder" for the
   * whole trachea+bronchi assembly), which is how the source file's own
   * authoring tool (Blender, via Sketchfab) labeled them.
   */
  async _loadSimulateGLB() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(SIMULATE_MODEL_URL);
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const lungMeshes = [];
    const airwayMeshes = [];

    root.traverse((obj) => {
      if (!obj.isMesh) return;

      console.log("Nama Mesh:", obj.name, "| Nama Parent:", obj.parent?.name);

      const parentName = (obj.parent?.name || '').toLowerCase();
      if (parentName.includes('sphere')) lungMeshes.push(obj);
      else if (parentName.includes('cylinder')) airwayMeshes.push(obj);
    });

    if (lungMeshes.length < 2 || airwayMeshes.length === 0) {
      throw new Error('Expected two lung meshes and an airway assembly were not found by structure in the respiratory_system GLB.');
    }

    lungMeshes.forEach((m) => {
      m.material = m.material.clone();
      m.castShadow = false;
    });
    airwayMeshes.forEach((m) => {
      m.material = m.material.clone();
      m.castShadow = false;
      m.geometry.computeBoundingBox();
    });

    // The airway assembly's combined world box is the reference every lung's
    // breathing pivot is measured against (see _computeMedialPivot): the
    // point on each lung nearest this box is treated as its fixed hilum.
    const airwayBox = new THREE.Box3();
    airwayMeshes.forEach((m) => airwayBox.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)));
    const airwayCenter = airwayBox.getCenter(new THREE.Vector3());

    lungMeshes.forEach((mesh) => {
      mesh.geometry.computeBoundingBox();
      const pivot = this._computeMedialPivot(mesh, airwayCenter);
      this._recenterMeshPivot(mesh, pivot);
      mesh.userData.baseScale = mesh.scale.clone();
    });

    // Sort left-to-right by world X purely so downstream code (e.g. the
    // airflow paths below) can reason about "one lung, the other lung"
    // consistently; no anatomical R/L label is shown anywhere on this page.
    lungMeshes.sort((a, b) => new THREE.Vector3().setFromMatrixPosition(a.matrixWorld).x
      - new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).x);

    this.allLobes = lungMeshes;
    this.lungMesh = null;
    this.trachea = airwayMeshes[0];
    this.airwayMeshes = airwayMeshes;
    this.tracheaLumen = null;
    this.diaphragm = null; // no diaphragm mesh in this GLB either
    this.larynxMeshes = [];
    // Simulate doesn't use the anatomy-marker system (no 8-marker UI here).
    this.anatomyAnchors = null;
    this.namedParts = null;

    // One airflow particle path per lung: from the top of the airway
    // assembly, through an approximate carina point, into that lung's own
    // upper-medial region. Geometry itself is never deformed for this.
    this._airflowPaths = lungMeshes.map((mesh) => {
      const lungBox = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      const lungCenter = lungBox.getCenter(new THREE.Vector3());
      const top = new THREE.Vector3(airwayCenter.x, airwayBox.max.y, airwayCenter.z);
      const carina = new THREE.Vector3(
        airwayCenter.x,
        THREE.MathUtils.lerp(airwayBox.max.y, airwayBox.min.y, 0.35),
        airwayCenter.z
      );
      const intoLung = lungCenter.clone().lerp(new THREE.Vector3(lungCenter.x, lungBox.max.y, lungCenter.z), 0.3);
      return new THREE.CatmullRomCurve3([top, carina, intoLung], false, 'catmullrom', 0.5);
    });

    this.lungGroup = root;
    this._rotationPivot.add(root);
    this._frameToFit(root, new THREE.Box3().setFromObject(root));
  }

  /**
   * Recenters the loaded model at the origin, scales it to a consistent
   * on-screen size, and positions the camera so the whole thing fits the
   * viewport with a comfortable margin, whatever the source file's own
   * units and offsets were (this GLB's own coordinate origin is far from
   * its geometry, inherited from the larger anatomy pack it was cut from).
   */
  _frameToFit(root = this.lungGroup, box = new THREE.Box3().setFromObject(this.lungGroup)) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const targetHeight = 2.6;
    const scale = size.y > 0 ? targetHeight / size.y : 1;

    root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.4, sphere.radius * scale);
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const margin = this.options.compact ? 1.35 : 1.55;
    const fitDistance = (radius / Math.sin(fovRad / 2)) * margin;

    const dir = new THREE.Vector3(0.55, 0.22, 1).normalize();
    this.defaultCameraPos = dir.multiplyScalar(fitDistance);
    this.defaultTarget = new THREE.Vector3(0, radius * 0.05, 0);
    this._modelRadius = radius;

    this.camera.near = Math.max(0.01, radius * 0.02);
    this.camera.far = radius * 60;
    this.camera.position.copy(this.defaultCameraPos);
    this.camera.lookAt(this.defaultTarget);
    this.camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.copy(this.defaultTarget);
      this.controls.minDistance = radius * 0.55;
      this.controls.maxDistance = radius * 5;
      this.controls.update();
    }
  }

  // -----------------------------------------------------------------------
  // Procedural fallback (only used if the GLB fails to load)
  // -----------------------------------------------------------------------

  _buildProcedural() {
    const group = new THREE.Group();
    group.name = 'lungAnatomyFallback';

    const lungMat = (color) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.58,
        metalness: 0,
        clearcoat: 0.18,
        clearcoatRoughness: 0.5,
        transmission: 0.04,
        thickness: 0.6,
        sheen: 1,
        sheenColor: new THREE.Color(color).offsetHSL(0, -0.1, 0.15),
        sheenRoughness: 0.8
      });

    const airwayMat = new THREE.MeshStandardMaterial({ color: COLOR_AIRWAY_WALL, roughness: 0.55, metalness: 0.04 });
    const cartilageMat = new THREE.MeshStandardMaterial({ color: COLOR_CARTILAGE, roughness: 0.5 });
    const lumenMat = new THREE.MeshBasicMaterial({ color: COLOR_CYAN, transparent: true, opacity: 0.45 });

    const tracheaTop = new THREE.Vector3(0, 1.55, 0);
    const tracheaBottom = new THREE.Vector3(0, 0.72, 0);
    const trachea = this._makeTube(tracheaTop, tracheaBottom, 0.115, 0.1, airwayMat);
    trachea.name = 'trachea';
    group.add(trachea);

    const lumen = this._makeTube(tracheaTop, tracheaBottom.clone().lerp(tracheaTop, 0.02), 0.06, 0.05, lumenMat);
    lumen.name = 'tracheaLumen';
    this.tracheaLumen = lumen;
    group.add(lumen);
    this.trachea = trachea;
    this.airwayMeshes = [trachea];

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.011, 6, 18), cartilageMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.lerpVectors(tracheaTop, tracheaBottom, 0.15 + i * 0.22);
      group.add(ring);
    }

    const carina = tracheaBottom.clone();
    const rBronchusEnd = new THREE.Vector3(0.48, 0.4, 0.08);
    const lBronchusEnd = new THREE.Vector3(-0.52, 0.3, 0.08);

    const rBronchus = this._makeTube(carina, rBronchusEnd, 0.095, 0.078, airwayMat);
    rBronchus.name = 'rightBronchus';
    group.add(rBronchus);

    const lBronchus = this._makeTube(carina, lBronchusEnd, 0.085, 0.068, airwayMat);
    lBronchus.name = 'leftBronchus';
    group.add(lBronchus);

    const rightLung = new THREE.Group();
    rightLung.name = 'rightLung';
    const rMat = lungMat(COLOR_LUNG_RIGHT);

    const rul = new THREE.Mesh(makeLobeGeometry({ radius: [0.42, 0.44, 0.37], medialSign: -1, seed: 11 }), rMat);
    rul.position.set(0.58, 0.5, -0.02);
    const rml = new THREE.Mesh(makeLobeGeometry({ radius: [0.32, 0.28, 0.31], medialSign: -1, seed: 12 }), rMat);
    rml.position.set(0.72, 0.04, 0.17);
    const rll = new THREE.Mesh(makeLobeGeometry({ radius: [0.5, 0.56, 0.41], medialSign: -1, seed: 13 }), rMat);
    rll.position.set(0.64, -0.48, 0.03);

    rightLung.add(rul, rml, rll);
    group.add(rightLung);

    const leftLung = new THREE.Group();
    leftLung.name = 'leftLung';
    const lMat = lungMat(COLOR_LUNG_LEFT);

    const lul = new THREE.Mesh(makeLobeGeometry({ radius: [0.44, 0.54, 0.37], medialSign: 1, notch: 0.55, seed: 21 }), lMat);
    lul.position.set(-0.58, 0.34, -0.02);
    const lll = new THREE.Mesh(makeLobeGeometry({ radius: [0.48, 0.56, 0.41], medialSign: 1, seed: 22 }), lMat);
    lll.position.set(-0.64, -0.5, 0.03);

    leftLung.add(lul, lll);
    group.add(leftLung);

    this.allLobes = [rul, rml, rll, lul, lll];
    this.allLobes.forEach((m) => {
      m.userData.baseScale = m.scale.clone();
    });

    const bronchioles = new THREE.Group();
    bronchioles.name = 'bronchioles';
    const branchMat = new THREE.MeshStandardMaterial({ color: COLOR_AIRWAY_WALL, roughness: 0.6 });
    const alveoli = new THREE.Group();
    alveoli.name = 'alveoli';
    const alveoliMat = new THREE.MeshStandardMaterial({ color: COLOR_CYAN, emissive: COLOR_TEAL, emissiveIntensity: 0.5, roughness: 0.4 });

    const rRng = makeRng(101);
    const RECURSION_SUM = 2.6;
    [
      { pos: rul.position, radius: 0.42 },
      { pos: rml.position, radius: 0.31 },
      { pos: rll.position, radius: 0.5 }
    ].forEach(({ pos: target, radius }) => {
      const dir = target.clone().sub(rBronchusEnd).normalize();
      const reach = target.clone().sub(rBronchusEnd).length() - radius * 0.85;
      const initialLength = Math.max(0.05, reach) / RECURSION_SUM;
      this._growBranches(bronchioles, alveoli, rBronchusEnd, dir, initialLength, 0.045, 0, 3, branchMat, alveoliMat, rRng);
    });

    const lRng = makeRng(202);
    [
      { pos: lul.position, radius: 0.44 },
      { pos: lll.position, radius: 0.48 }
    ].forEach(({ pos: target, radius }) => {
      const dir = target.clone().sub(lBronchusEnd).normalize();
      const reach = target.clone().sub(lBronchusEnd).length() - radius * 0.85;
      const initialLength = Math.max(0.05, reach) / RECURSION_SUM;
      this._growBranches(bronchioles, alveoli, lBronchusEnd, dir, initialLength, 0.042, 0, 3, branchMat, alveoliMat, lRng);
    });

    group.add(bronchioles, alveoli);

    const diaphragm = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 3.2),
      new THREE.MeshStandardMaterial({ color: COLOR_DIAPHRAGM, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.65 })
    );
    diaphragm.position.set(0, -1.12, 0);
    diaphragm.rotation.x = Math.PI;
    diaphragm.name = 'diaphragm';
    this.diaphragm = diaphragm;
    this.diaphragmBaseY = diaphragm.position.y;
    group.add(diaphragm);

    const centroid = (points) => {
      const c = new THREE.Vector3();
      points.forEach((p) => c.add(p));
      return points.length ? c.divideScalar(points.length) : c;
    };
    const alveoliCentroid = centroid(alveoli.children.map((c) => c.position));
    const bronchiolesCentroid = centroid(bronchioles.children.map((c) => c.position));

    this.anatomyAnchors = {
      trachea: tracheaTop.clone().lerp(tracheaBottom, 0.5),
      'r-bronchus': carina.clone().lerp(rBronchusEnd, 0.6),
      'l-bronchus': carina.clone().lerp(lBronchusEnd, 0.6),
      'r-lung': centroid([rul.position, rml.position, rll.position]),
      'l-lung': centroid([lul.position, lll.position]),
      bronchioles: bronchiolesCentroid.lengthSq() > 0 ? bronchiolesCentroid : rml.position.clone().lerp(rll.position, 0.5),
      alveoli: alveoliCentroid.lengthSq() > 0 ? alveoliCentroid : lll.position.clone(),
      diaphragm: diaphragm.position.clone().setY(diaphragm.position.y + 0.05)
    };

    this.namedParts = {
      trachea,
      'r-bronchus': rBronchus,
      'l-bronchus': lBronchus,
      'r-lung': rightLung,
      'l-lung': leftLung,
      bronchioles,
      alveoli,
      diaphragm
    };

    this._airflowPaths = [
      new THREE.CatmullRomCurve3(
        [tracheaTop.clone(), carina.clone(), rBronchusEnd.clone(), rll.position.clone()],
        false,
        'catmullrom',
        0.5
      )
    ];

    group.scale.setScalar(1.02);
    this.lungGroup = group;
    this._rotationPivot.add(group);
  }

  _makeTube(from, to, radiusStart, radiusEnd, material) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, 10, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  _growBranches(branchGroup, alveoliGroup, origin, direction, length, radius, depth, maxDepth, branchMat, alveoliMat, rng) {
    if (depth > maxDepth || radius < 0.01) return;

    const jitter = new THREE.Vector3((rng() - 0.5) * 0.25, (rng() - 0.5) * 0.18, (rng() - 0.5) * 0.25);
    const dir = direction.clone().add(jitter.multiplyScalar(depth === 0 ? 0.12 : 0.3)).normalize();
    const end = origin.clone().add(dir.clone().multiplyScalar(length));

    const branch = this._makeTube(origin, end, radius, radius * 0.82, branchMat);
    branchGroup.add(branch);

    if (depth === maxDepth) {
      const cluster = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 + rng() * 0.015, 0), alveoliMat);
      cluster.position.copy(end);
      alveoliGroup.add(cluster);
      return;
    }

    const children = depth < 2 ? 2 : rng() > 0.4 ? 2 : 1;
    for (let i = 0; i < children; i++) {
      const spread = 0.22 + rng() * 0.18;
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const childDir = dir.clone().applyAxisAngle(axis, (i === 0 ? 1 : -1) * spread).normalize();
      this._growBranches(branchGroup, alveoliGroup, end, childDir, length * (0.68 + rng() * 0.08), radius * 0.66, depth + 1, maxDepth, branchMat, alveoliMat, rng);
    }
  }

  // -----------------------------------------------------------------------
  // Markers
  // -----------------------------------------------------------------------

  /**
   * Register clickable anatomy markers, projected live from 3D space onto
   * the 2D marker overlay layer. `marker.position` is only a fallback: once
   * the model has loaded, its on-screen position is read from
   * `this.anatomyAnchors[marker.id]` instead, so it always points at the
   * structure actually loaded (GLB or the procedural fallback).
   * @param {Array<{id:string, label:string, position?:[number,number,number]}>} markers
   * @param {(marker: object) => void} onClick
   */
  setMarkers(markers, onClick) {
    this.markers = markers;
    this.onMarkerClick = onClick;
    this.markerLayer.innerHTML = '';
    this.markerEls.clear();

    markers.forEach((marker) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'anatomy-marker';
      el.dataset.markerId = marker.id;
      el.innerHTML = `<span class="marker-dot"></span><span class="marker-tag">${marker.label}</span>`;
      el.addEventListener('click', () => {
        this.setActiveMarker(marker.id);
        this.focusAnatomy(marker.id);
        this.onMarkerClick?.(marker);
      });
      el.addEventListener('pointerenter', () => el.classList.add('hover'));
      el.addEventListener('pointerleave', () => el.classList.remove('hover'));
      this.markerLayer.appendChild(el);
      this.markerEls.set(marker.id, el);
    });
  }

  setActiveMarker(id) {
    this.markerEls.forEach((el, key) => el.classList.toggle('active', key === id));
  }

  clearActiveMarker() {
    this.markerEls.forEach((el) => el.classList.remove('active'));
    this.clearFocus();
  }

  _updateMarkerPositions() {
    if (!this.markers.length || !this.lungGroup) return;
    const rect = this.container.getBoundingClientRect();

    this.markers.forEach((marker) => {
      const el = this.markerEls.get(marker.id);
      if (!el) return;

      const anchor = this.anatomyAnchors?.[marker.id] ?? (marker.position ? new THREE.Vector3(...marker.position) : null);
      if (!anchor) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }

      const vec = anchor.clone();
      vec.applyMatrix4(this.lungGroup.matrixWorld);
      vec.project(this.camera);

      const x = (vec.x * 0.5 + 0.5) * rect.width;
      const y = (-vec.y * 0.5 + 0.5) * rect.height;
      const behindCamera = vec.z > 1;

      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = behindCamera ? '0' : '1';
      el.style.pointerEvents = behindCamera ? 'none' : 'auto';
    });
  }

  // -----------------------------------------------------------------------
  // Camera
  // -----------------------------------------------------------------------

  setAutoRotate(value) {
    this.options.autoRotate = value;
  }

  /** Smoothly animate the camera toward a named anatomy part and highlight it, if a mesh exists for it. */
  focusAnatomy(id) {
    const anchor = this.anatomyAnchors?.[id];
    if (!anchor || !this.lungGroup) return;

    this._focusedId = id;
    this._setHighlight(id);

    const hasMesh = !!this.namedParts?.[id];
    if (!hasMesh) {
      // No real mesh exists for this marker (l-lung, diaphragm) and its
      // anchor sits in space the model doesn't occupy. Rather than dolly
      // the camera in on nothing, keep the default overview framing so the
      // real anatomy stays fully visible while the info panel explains why
      // this part isn't modeled separately.
      this._startCameraAnim(this.defaultCameraPos, this.defaultTarget, 700);
      return;
    }

    const worldAnchor = anchor.clone().applyMatrix4(this.lungGroup.matrixWorld);
    const viewDir = new THREE.Vector3(0.55, 0.28, 1).normalize();
    const radius = this._modelRadius || 1.4;
    const relativeDistance = id === 'r-lung' ? 1.9 : 1.1;
    const distance = radius * relativeDistance;
    const toPos = worldAnchor.clone().add(viewDir.multiplyScalar(distance));

    this._startCameraAnim(toPos, worldAnchor, 700);
  }

  clearFocus() {
    this._focusedId = null;
    this._setHighlight(null);
  }

  /** Reset the camera to its default framing (also clears any focus/highlight). */
  resetCamera() {
    this.clearFocus();
    this._startCameraAnim(this.defaultCameraPos, this.defaultTarget, 550);
  }

  zoomIn() {
    this._dolly(0.8);
  }

  zoomOut() {
    this._dolly(1.25);
  }

  _dolly(factor) {
    const target = this.controls?.target ?? this.defaultTarget;
    const offset = this.camera.position.clone().sub(target);
    const newLength = THREE.MathUtils.clamp(offset.length() * factor, this.controls?.minDistance ?? 0.5, this.controls?.maxDistance ?? 30);
    offset.setLength(newLength);
    this.camera.position.copy(target.clone().add(offset));
  }

  _startCameraAnim(toPos, toTarget, durationMs) {
    this._camAnim = {
      fromPos: this.camera.position.clone(),
      toPos: toPos.clone(),
      fromTarget: (this.controls?.target ?? this.defaultTarget).clone(),
      toTarget: toTarget.clone(),
      start: performance.now(),
      duration: durationMs
    };
  }

  _stepCameraAnim() {
    if (!this._camAnim) return;
    const { fromPos, toPos, fromTarget, toTarget, start, duration } = this._camAnim;
    const t = Math.min(1, (performance.now() - start) / duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    this.camera.position.lerpVectors(fromPos, toPos, eased);
    const target = fromTarget.clone().lerp(toTarget, eased);
    if (this.controls) this.controls.target.copy(target);
    else this.camera.lookAt(target);

    if (t >= 1) this._camAnim = null;
  }

  _setHighlight(id) {
    if (this._highlightedName === id) return;

    if (this._highlightedName) {
      const prev = this.namedParts?.[this._highlightedName];
      prev?.traverse?.((obj) => {
        if (obj.material && obj.userData._baseEmissive !== undefined) {
          obj.material.emissive?.setHex(obj.userData._baseEmissive);
          obj.material.emissiveIntensity = obj.userData._baseEmissiveIntensity ?? 0;
        }
      });
    }

    this._highlightedName = id;
    if (!id) return;

    const part = this.namedParts?.[id];
    const traverseFn = part?.isObject3D ? part.traverse.bind(part) : part ? (fn) => fn(part) : null;
    traverseFn?.((obj) => {
      if (obj.material && obj.material.emissive) {
        if (obj.userData._baseEmissive === undefined) {
          obj.userData._baseEmissive = obj.material.emissive.getHex();
          obj.userData._baseEmissiveIntensity = obj.material.emissiveIntensity ?? 0;
        }
        obj.material.emissive.setHex(COLOR_TEAL);
        obj.material.emissiveIntensity = 0.28;
      }
    });
  }

  // -----------------------------------------------------------------------
  // Breathing / physiology-linked visuals
  // -----------------------------------------------------------------------

  setBreathingPhase(phase) {
    this._liveMode = true;
    this._livePhase = THREE.MathUtils.clamp(phase, 0, 1);
  }

  setRespiratoryRate(bpm) {
    this._idleRespRate = Math.max(4, bpm);
  }

  releaseLiveBreathing() {
    this._liveMode = false;
  }

  setBreathingRunning(active) {
    this._breathingActive = !!active;
  }

  resetBreathing() {
    this._breathClock = 0;
    this._livePhase = 0.15;
    this._lastEasedPhase = 0;
    this.setLungExpansion(0);
    this.setDiaphragmPosition(0);
  }

 setLungExpansion(value) {
    this._lastAppliedExpansion = THREE.MathUtils.clamp(value, 0, 1);
    
    // UBAH 0.09 (9%) MENJADI 0.5 (50%) agar gerakannya sangat ekstrim/terlihat
    const scale = 1 + this._lastAppliedExpansion * 0.15; 
    
    this.allLobes?.forEach((lobe) => {
      const base = lobe.userData.baseScale;
      // UBAH JUGA 0.12 MENJADI 0.6 (60%)
      lobe.scale.set(base.x * scale, base.y * (1 + this._lastAppliedExpansion * 0.2), base.z * scale);
    });
  }

  /** Directly override diaphragm depth (0 = relaxed/up, 1 = contracted/down). No-op when no diaphragm mesh exists. */
  setDiaphragmPosition(value) {
    if (!this.diaphragm) return;
    const v = THREE.MathUtils.clamp(value, 0, 1);
    this.diaphragm.position.y = this.diaphragmBaseY - v * 0.16;
  }

 /** 
   * Menerima nilai airflow mentah dari engine (L/min).
   * Positif = udara masuk (inspirasi), Negatif = udara keluar (ekspirasi).
   */
  setAirflow(flowRate) {
    if (flowRate == null || Number.isNaN(flowRate)) {
      this._airflowIntensity = 0;
      return;
    }
    // Normalisasi kecepatan (asumsi maksimal aliran sekitar 35-40 L/min)
    this._airflowIntensity = THREE.MathUtils.clamp(Math.abs(flowRate) / 35, 0, 1);
    // Tentukan arah partikel berdasarkan nilai positif/negatif
    this._breathDirection = flowRate >= 0 ? 1 : -1;
  }

  /**
   * 0..100 airway obstruction. This never deforms or moves the trachea/
   * bronchi geometry (an authored anatomical mesh looks broken, not
   * "narrowed", when squeezed that way, and a slightly wrong pivot can drag
   * it out of place entirely). Obstruction is visualized only through the
   * airway's emissive glow (see _updateAirflowGlow, which reads
   * _obstructionPct directly) and through airflow intensity/speed, which is
   * already driven by the real RC model upstream of this class.
   */
  setObstruction(pct) {
    this._obstructionPct = THREE.MathUtils.clamp(pct, 0, 100);
  }

  setCPAPActive(active) {
    this._cpapActive = !!active;
  }

  setPressure(value) {
    this._pressureValue = value;
  }

  // -----------------------------------------------------------------------
  // Airflow particles
  // -----------------------------------------------------------------------

  _buildAirflowParticles() {
    const paths = this._airflowPaths;
    if (!paths?.length || this._disposed) return;
    const COUNT = 26;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));

    const material = new THREE.PointsMaterial({
      color: COLOR_CYAN,
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'airflowParticles';
    points.frustumCulled = false;
    this.lungGroup.add(points);

    const rng = makeRng(777);
    this._particleT = new Float32Array(COUNT);
    // Particles are split round-robin across every path (one path per lung
    // on the Simulate model, a single path on the Anatomy model), so a
    // bilateral model shows airflow entering/leaving both lungs at once.
    this._particlePathIdx = new Uint8Array(COUNT);
    this._particleJitter = [];
    for (let i = 0; i < COUNT; i++) {
      this._particleT[i] = i / COUNT;
      this._particlePathIdx[i] = i % paths.length;
      this._particleJitter.push(new THREE.Vector3((rng() - 0.5) * 0.045, (rng() - 0.5) * 0.045, (rng() - 0.5) * 0.045));
    }
    this._airflowParticlesObj = points;
    this._updateAirflowParticles(0);
  }

 _updateAirflowParticles(dt) {
    const points = this._airflowParticlesObj;
    const paths = this._airflowPaths;
    if (!points || !paths?.length) return;

    // Kecepatan partikel murni dikendalikan oleh intensitas dari engine
    const speed = this._airflowIntensity * 0.8; 
    const positions = points.geometry.attributes.position;
    const tmp = new THREE.Vector3();

    for (let i = 0; i < this._particleT.length; i++) {
      let t = this._particleT[i] + this._breathDirection * speed * dt;
      t = ((t % 1) + 1) % 1; // Looping jalur
      this._particleT[i] = t;
      const path = paths[this._particlePathIdx[i]] || paths[0];
      path.getPointAt(t, tmp);
      tmp.add(this._particleJitter[i]);
      positions.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    positions.needsUpdate = true;

    // VISUALISASI STATE: CPAP (Teal) > Obstruksi Berat (Amber) > Normal (Cyan)
    const color = this._cpapActive ? 0x0f9d9a : (this._obstructionPct >= 70 ? 0xf4b942 : 0x7dd3d0);
    points.material.color.setHex(color);
    
    // Opasitas turun jika airflow sangat kecil (apnea/obstruksi total)
    points.material.opacity = this._airflowIntensity > 0.05 ? THREE.MathUtils.clamp(0.2 + this._airflowIntensity * 0.7, 0, 0.9) : 0;
    points.material.size = 0.022 + this._airflowIntensity * 0.025;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  resize() {
    if (!this.renderer || this._disposed) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _animate() {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(() => this._animate());

    const dt = Math.min(0.1, this._clock.getDelta());

   // TAMBAHKAN BARIS INI UNTUK MEMAKSA PARU-PARU BERNAPAS TERUS
    this._breathingActive = true; 

    if (this.options.autoRotate && !this._camAnim && this.lungGroup) {
      this._rotationPivot.rotation.y += dt * 0.16;
    }

    if (this.options.breathing) {
      let phase;
      
      // JIKA SIMULASI BERJALAN (LIVE MODE)
      if (this._liveMode) {
          phase = this._livePhase; // Gunakan nilai langsung dari engine
          
          // Easing untuk memperhalus gerakan yang didapat dari engine
          const eased = phase < 0.5 ? Math.pow(phase * 2, 0.85) / 2 : 1 - Math.pow((1 - phase) * 2, 1.15) / 2;
          this._breathDirection = eased >= this._lastEasedPhase ? 1 : -1;
          this._lastEasedPhase = eased;
          
          this.setLungExpansion(eased);
          this.setDiaphragmPosition(eased);
      } 
      // JIKA SIMULASI IDLE / PAUSE (Animasi Bawaan)
      else {
          if (this._breathingActive) this._breathClock += dt;
          const freq = this._idleRespRate / 60;
          phase = 0.5 + 0.5 * Math.sin(this._breathClock * freq * Math.PI * 2 - Math.PI / 2);
          
          const eased = phase < 0.5 ? Math.pow(phase * 2, 0.85) / 2 : 1 - Math.pow((1 - phase) * 2, 1.15) / 2;
          this._breathDirection = eased >= this._lastEasedPhase ? 1 : -1;
          this._lastEasedPhase = eased;
          
          this.setLungExpansion(eased);
          this.setDiaphragmPosition(eased);
      }
    }

    this._updateAirflowGlow();
    this._updateAirflowParticles(this._breathingActive ? dt : 0);
    this._stepCameraAnim();
    this.controls?.update();
    this._updateMarkerPositions();
    this.renderer.render(this.scene, this.camera);
  }

  _updateAirflowGlow() {
    const color = this._cpapActive ? COLOR_TEAL : this._obstructionPct > 60 ? COLOR_AMBER : COLOR_CYAN;

    if (this.tracheaLumen) {
      // Procedural fallback: a dedicated translucent lumen cylinder.
      const glow = 0.22 + this._airflowIntensity * 0.55 + (this._cpapActive ? 0.18 : 0);
      this.tracheaLumen.material.opacity = Math.min(0.95, glow);
      this.tracheaLumen.material.color.setHex(color);
      return;
    }

    // GLB path (both the Anatomy model's single airway mesh and the
    // Simulate model's seven-piece airway assembly): tint every airway
    // mesh's own emissive, unless it is currently the highlighted/selected
    // marker (that highlight takes visual priority over the ambient
    // airflow glow; only the Anatomy page ever sets a highlight). This is
    // also where obstruction reads as an "airway indicator" glow, without
    // ever touching the mesh's geometry (see setObstruction).
    const airwayIsHighlighted = ['trachea', 'r-bronchus', 'l-bronchus', 'bronchioles'].includes(this._highlightedName);
    if (this.airwayMeshes?.length && !airwayIsHighlighted) {
      const glow = this._airflowIntensity * 0.4 + (this._cpapActive ? 0.15 : 0) + (this._obstructionPct / 100) * 0.25;
      this.airwayMeshes.forEach((mesh) => {
        if (!mesh.material?.emissive) return;
        mesh.material.emissive.setHex(color);
        mesh.material.emissiveIntensity = Math.min(0.6, glow);
      });
    }
  }

  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();

    this.scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });

    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this._loadingEl?.remove();
    this.markerLayer?.remove();
  }
}

export default LungScene;
