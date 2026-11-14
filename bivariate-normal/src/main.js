import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Constants & state
 * ------------------------------------------------------------------ */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const DOMAIN = 6.5;              // data range: [-6.5, 6.5] on both axes
const WORLD = 4.5;               // world-space half-width of the surface
const SCALE = WORLD / DOMAIN;    // data -> world
const HEIGHT = 2.35;             // peak height in world units (auto-normalised)
const SEGMENTS = 128;
const CONTOUR_STEPS = 220;
const CONTOUR_LEVELS = [0.12, 0.28, 0.46, 0.64, 0.82];

const DEFAULTS = Object.freeze({
  mu1: 0,
  mu2: 0,
  sigma1: 1,
  sigma2: 1,
  rho: 0,
});

const PRESETS = {
  standard: { mu1: 0, mu2: 0, sigma1: 1, sigma2: 1, rho: 0 },
  positive: { mu1: 0, mu2: 0, sigma1: 1, sigma2: 1, rho: 0.8 },
  negative: { mu1: 0, mu2: 0, sigma1: 1, sigma2: 1, rho: -0.8 },
  narrow:   { mu1: 0, mu2: 0, sigma1: 0.6, sigma2: 1.4, rho: 0.3 },
};

const PALETTE_STOPS = [
  [0.00, '#0a0519'],
  [0.16, '#260954'],
  [0.34, '#5e137e'],
  [0.52, '#9b2377'],
  [0.68, '#d2435d'],
  [0.84, '#f37b41'],
  [0.94, '#f9b53d'],
  [1.00, '#fff0a0'],
];

const HOME_POSITION = new THREE.Vector3(10.8, -13.3, 10.2);
const HOME_TARGET = new THREE.Vector3(0, 0, 1.0);
const params = { ...DEFAULTS };
const state = {
  autoRotate: true,
  contours: true,
  dragging: false,
  dirty: true,
  paramTween: null,
  resetAnim: null,
};

/* ------------------------------------------------------------------ *
 *  DOM / UI references
 * ------------------------------------------------------------------ */
const viewport = $('#viewport');
const fatalBox = $('#fatal');
const paramKeys = ['mu1', 'mu2', 'sigma1', 'sigma2', 'rho'];
const inputs = {};
const outputs = {};
const rangeRows = [];
paramKeys.forEach((key) => {
  inputs[key] = document.getElementById(key);
  outputs[key] = document.getElementById(`${key}-value`);
});
$$('.param-row').forEach((row) => {
  rangeRows.push({
    row,
    input: row.querySelector('input[type="range"]'),
    fill: row.querySelector('.range-fill'),
    bipolar: row.dataset.bipolar === 'true',
  });
});
const peakValueEl = $('#peakValue');
const covValueEl = $('#covValue');
const rhoDotEl = $('#rhoDot');
const rhoTitleEl = $('#rhoTitle');
const rhoReadoutEl = $('#rhoReadout');
const autoIndicator = $('#autoIndicator');
const autoLabel = $('#autoLabel');
const autoToggle = $('#autoRotate');
const contourToggle = $('#showContours');
const resetViewButton = $('#resetView');
const resetAllButton = $('#resetAll');
const presetButtons = $$('.preset-btn');

/* ------------------------------------------------------------------ *
 *  Maths
 * ------------------------------------------------------------------ */
function peakDensity(p = params) {
  return 1 / (2 * Math.PI * p.sigma1 * p.sigma2 * Math.sqrt(1 - p.rho * p.rho));
}

function densityAt(x, y, p = params) {
  const dx = (x - p.mu1) / p.sigma1;
  const dy = (y - p.mu2) / p.sigma2;
  const oneMinusRho2 = 1 - p.rho * p.rho;
  const q = (dx * dx - 2 * p.rho * dx * dy + dy * dy) / oneMinusRho2;
  return Math.exp(-0.5 * q) *
    (1 / (2 * Math.PI * p.sigma1 * p.sigma2 * Math.sqrt(oneMinusRho2)));
}

function worldX(dataX) { return dataX * SCALE; }
function worldY(dataY) { return dataY * SCALE; }

function formatSigned(value, digits, plus = false) {
  const sign = value < 0 ? '−' : plus && value > 0 ? '+' : '';
  return sign + Math.abs(value).toFixed(digits);
}

function formatDensity(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (value >= 0.1) return value.toFixed(3);
  if (value >= 0.01) return value.toFixed(4);
  return value.toFixed(5);
}

/* ------------------------------------------------------------------ *
 *  Colour palette
 * ------------------------------------------------------------------ */
const palette = PALETTE_STOPS.map(([offset, hex]) => ({
  offset,
  color: new THREE.Color(hex),
}));

function samplePalette(t) {
  const value = clamp(t, 0, 1);
  for (let i = 0; i < palette.length - 1; i += 1) {
    const a = palette[i];
    const b = palette[i + 1];
    if (value >= a.offset && value <= b.offset) {
      const f = (value - a.offset) / (b.offset - a.offset || 1);
      return a.color.clone().lerp(b.color, f);
    }
  }
  return palette[palette.length - 1].color.clone();
}

const PALETTE_LUT_SIZE = 256;
const paletteLut = Array.from({ length: PALETTE_LUT_SIZE }, (_, i) =>
  samplePalette(i / (PALETTE_LUT_SIZE - 1))
);

/* ------------------------------------------------------------------ *
 *  Three.js scene
 * ------------------------------------------------------------------ */
let scene;
let camera;
let renderer;
let controls;
let surface;
let surfacePositions;
let surfaceColors;
let dataX;
let dataY;
let vertexCount;
let contourGroup;
let contourSegments = [];
let zTickSprites = [];
let markerGroup;
let markerLine;
let markerDot;
let markerRing;
let markerGlow;

function makeLine(points, { color = 0x8ba0c4, opacity = 0.5, dashed = false } = {}) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        dashSize: 0.09,
        gapSize: 0.09,
        depthWrite: false,
      })
    : new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 247, 211, 1)');
  gradient.addColorStop(0.16, 'rgba(255, 224, 140, .9)');
  gradient.addColorStop(0.42, 'rgba(249, 181, 61, .28)');
  gradient.addColorStop(1, 'rgba(249, 181, 61, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeTextSprite(
  text,
  {
    color = '#8898b3',
    font = '500 44px "Segoe UI", "Microsoft YaHei", sans-serif',
    scale = [0.72, 0.27],
  } = {}
) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale[0], scale[1], 1);
  sprite.renderOrder = 30;
  sprite.userData.text = null;

  function setText(nextText) {
    if (sprite.userData.text === nextText) return;
    sprite.userData.text = nextText;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nextText, canvas.width / 2, canvas.height / 2 + 1);
    texture.needsUpdate = true;
  }

  setText(text);
  sprite.userData.setText = setText;
  return sprite;
}

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050810, 0.012);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.up.set(0, 0, 1);
  camera.position.copy(HOME_POSITION);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '二维正态分布三维概率密度曲面');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.style.cursor = 'grab';
  viewport.prepend(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.72;
  controls.enablePan = true;
  controls.panSpeed = 0.65;
  controls.screenSpacePanning = true;
  controls.minDistance = 7;
  controls.maxDistance = 27;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.055;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.82;
  controls.update();

  controls.addEventListener('start', () => {
    state.dragging = true;
    renderer.domElement.style.cursor = 'grabbing';
    updateAutoIndicator();
  });
  controls.addEventListener('end', () => {
    state.dragging = false;
    renderer.domElement.style.cursor = 'grab';
    updateAutoIndicator();
  });

  /* Lights ---------------------------------------------------------- */
  scene.add(new THREE.HemisphereLight(0xa8c7ff, 0x0a0618, 0.78));

  // The surface uses baked vertex shading, so no scene light is required.
  // The hemisphere light is kept as a soft reference for future materials.

  /* Floor / grid ---------------------------------------------------- */
  const floorGroup = new THREE.Group();
  floorGroup.renderOrder = -3;
  scene.add(floorGroup);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshBasicMaterial({
      color: 0x060b16,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );
  plate.position.z = -0.055;
  floorGroup.add(plate);

  const minorPoints = [];
  const majorPoints = [];
  for (let value = -6; value <= 6; value += 1) {
    const w = value * SCALE;
    const points = [
      [w, -WORLD, -0.028],
      [w, WORLD, -0.028],
      [-WORLD, w, -0.028],
      [WORLD, w, -0.028],
    ];
    if (Math.abs(value) % 2 === 0) majorPoints.push(...points);
    else minorPoints.push(...points);
  }
  const toSegments = (points) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points.flat(), 3)
    );
    return geometry;
  };
  const minorGrid = new THREE.LineSegments(
    toSegments(minorPoints),
    new THREE.LineBasicMaterial({
      color: 0x7b94bb,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
    })
  );
  floorGroup.add(minorGrid);

  const majorGrid = new THREE.LineSegments(
    toSegments(majorPoints),
    new THREE.LineBasicMaterial({
      color: 0x93a9ca,
      transparent: true,
      opacity: 0.105,
      depthWrite: false,
    })
  );
  floorGroup.add(majorGrid);

  const border = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-WORLD, -WORLD, -0.012),
      new THREE.Vector3(WORLD, -WORLD, -0.012),
      new THREE.Vector3(WORLD, WORLD, -0.012),
      new THREE.Vector3(-WORLD, WORLD, -0.012),
      new THREE.Vector3(-WORLD, -WORLD, -0.012),
    ]),
    new THREE.LineBasicMaterial({
      color: 0x6ee7d3,
      transparent: true,
      opacity: 0.19,
      depthWrite: false,
    })
  );
  floorGroup.add(border);

  /* Surface --------------------------------------------------------- */
  const geometry = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, SEGMENTS, SEGMENTS);
  vertexCount = geometry.attributes.position.count;
  surfacePositions = geometry.attributes.position;
  surfaceColors = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  geometry.setAttribute('color', surfaceColors);
  dataX = new Float32Array(vertexCount);
  dataY = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    dataX[i] = surfacePositions.getX(i) / SCALE;
    dataY[i] = surfacePositions.getY(i) / SCALE;
  }

  const surfaceMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  surface = new THREE.Mesh(geometry, surfaceMaterial);
  surface.renderOrder = 2;
  scene.add(surface);

  const surfaceRim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-WORLD, -WORLD, 0.012),
      new THREE.Vector3(WORLD, -WORLD, 0.012),
      new THREE.Vector3(WORLD, WORLD, 0.012),
      new THREE.Vector3(-WORLD, WORLD, 0.012),
    ]),
    new THREE.LineBasicMaterial({
      color: 0x6ee7d3,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
  );
  surfaceRim.renderOrder = 3;
  scene.add(surfaceRim);

  /* Axes ------------------------------------------------------------ */
  const AX = WORLD + 0.4;
  const axisColor = 0x91a6c8;
  const axisGroup = new THREE.Group();
  scene.add(axisGroup);

  axisGroup.add(makeLine([[-AX, -AX, 0.005], [AX, -AX, 0.005]], { color: axisColor, opacity: 0.72 }));
  axisGroup.add(makeLine([[-AX, -AX, 0.005], [-AX, AX, 0.005]], { color: axisColor, opacity: 0.72 }));
  axisGroup.add(makeLine([[-AX, -AX, 0.005], [-AX, -AX, HEIGHT + 0.32]], { color: axisColor, opacity: 0.72 }));

  const arrowGeometry = new THREE.ConeGeometry(0.045, 0.17, 16);
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8bcdb,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const up = new THREE.Vector3(0, 1, 0);
  function addArrow(position, direction) {
    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    arrow.position.copy(position);
    arrow.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    axisGroup.add(arrow);
  }
  addArrow(new THREE.Vector3(AX + 0.08, -AX, 0.005), new THREE.Vector3(1, 0, 0));
  addArrow(new THREE.Vector3(-AX, AX + 0.08, 0.005), new THREE.Vector3(0, 1, 0));
  addArrow(new THREE.Vector3(-AX, -AX, HEIGHT + 0.4), new THREE.Vector3(0, 0, 1));

  /* Axis ticks & labels --------------------------------------------- */
  const tickMaterial = new THREE.LineBasicMaterial({
    color: 0x7f95b6,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const xTicks = [-6, -4, -2, 0, 2, 4, 6];
  const yTicks = [-6, -4, -2, 0, 2, 4, 6];
  const tickLabelScale = [0.96, 0.36];

  xTicks.forEach((value) => {
    const x = value * SCALE;
    const tick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, -AX, 0.005),
        new THREE.Vector3(x, -AX - 0.11, 0.005),
      ]),
      tickMaterial
    );
    axisGroup.add(tick);
    const label = makeTextSprite(String(value).replace('-', '−'), {
      color: '#aebed6',
      font: '500 46px "Segoe UI", "Microsoft YaHei", sans-serif',
      scale: tickLabelScale,
    });
    label.position.set(x, -AX - 0.34, 0.17);
    axisGroup.add(label);
  });

  yTicks.forEach((value) => {
    const y = value * SCALE;
    const tick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-AX, y, 0.005),
        new THREE.Vector3(-AX - 0.11, y, 0.005),
      ]),
      tickMaterial
    );
    axisGroup.add(tick);
    const label = makeTextSprite(String(value).replace('-', '−'), {
      color: '#aebed6',
      font: '500 46px "Segoe UI", "Microsoft YaHei", sans-serif',
      scale: tickLabelScale,
    });
    label.position.set(-AX - 0.36, y, 0.17);
    axisGroup.add(label);
  });

  const zFractions = [0, 0.25, 0.5, 0.75, 1];
  zFractions.forEach((fraction) => {
    const z = fraction * HEIGHT + 0.005;
    const tick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-AX, -AX, z),
        new THREE.Vector3(-AX - 0.12, -AX, z),
      ]),
      tickMaterial
    );
    axisGroup.add(tick);
    const label = makeTextSprite('0', {
      color: '#aebed6',
      font: '500 44px "Segoe UI", "Microsoft YaHei", sans-serif',
      scale: [1.0, 0.375],
    });
    label.position.set(-AX - 0.7, -AX, z + 0.03);
    axisGroup.add(label);
    zTickSprites.push(label);
  });

  const xTitle = makeTextSprite('x', {
    color: '#e0e9f8',
    font: 'italic 62px "Cambria Math", Georgia, serif',
    scale: [0.6, 0.34],
  });
  xTitle.position.set(AX + 0.36, -AX, 0.18);
  axisGroup.add(xTitle);

  const yTitle = makeTextSprite('y', {
    color: '#e0e9f8',
    font: 'italic 62px "Cambria Math", Georgia, serif',
    scale: [0.6, 0.34],
  });
  yTitle.position.set(-AX, AX + 0.36, 0.18);
  axisGroup.add(yTitle);

  const zTitle = makeTextSprite('f(x,y)', {
    color: '#e0e9f8',
    font: 'italic 46px "Cambria Math", Georgia, serif',
    scale: [1.0, 0.375],
  });
  zTitle.position.set(-AX - 0.25, -AX, HEIGHT + 0.68);
  axisGroup.add(zTitle);

  /* Contour lines on the surface ----------------------------------- */
  contourGroup = new THREE.Group();
  contourGroup.renderOrder = 4;
  scene.add(contourGroup);

  contourSegments = CONTOUR_LEVELS.map((level, index) => {
    const positions = new Float32Array(CONTOUR_STEPS * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setDrawRange(0, 0);
    const low = index < 2;
    const material = new THREE.LineBasicMaterial({
      color: low ? 0xe9f8ff : 0x190b2a,
      transparent: true,
      opacity: low ? 0.4 : 0.64,
      depthWrite: false,
    });
    const line = new THREE.LineSegments(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 4;
    contourGroup.add(line);
    return { level, positions, attribute: positionAttribute, geometry };
  });

  /* Peak marker ----------------------------------------------------- */
  markerGroup = new THREE.Group();
  scene.add(markerGroup);

  markerLine = makeLine(
    [[0, 0, 0], [0, 0, HEIGHT]],
    { color: 0xd7e8ff, opacity: 0.24, dashed: true }
  );
  markerLine.renderOrder = 3;
  markerGroup.add(markerLine);

  markerDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.048, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff6d6, toneMapped: false })
  );
  markerDot.renderOrder = 6;
  markerGroup.add(markerDot);

  markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.105, 40),
    new THREE.MeshBasicMaterial({
      color: 0xf9c270,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
  );
  markerRing.renderOrder = 5;
  markerGroup.add(markerRing);

  markerGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.46,
      toneMapped: false,
    })
  );
  markerGlow.scale.set(0.54, 0.54, 1);
  markerGlow.renderOrder = 5;
  markerGroup.add(markerGlow);

  updateMarker();
  updateZLabels(peakDensity());
  updateSurface(peakDensity());
  updateContours();
}

/* ------------------------------------------------------------------ *
 *  Scene updates
 * ------------------------------------------------------------------ */
function updateSurface(peak) {
  const positions = surfacePositions;
  const colors = surfaceColors;
  for (let i = 0; i < vertexCount; i += 1) {
    const t = densityAt(dataX[i], dataY[i]) / peak;
    positions.setZ(i, t * HEIGHT);
  }
  positions.needsUpdate = true;
  surface.geometry.computeVertexNormals();

  const normals = surface.geometry.attributes.normal;
  for (let i = 0; i < vertexCount; i += 1) {
    const t = clamp(positions.getZ(i) / HEIGHT, 0, 1);
    const colorIndex = clamp((t * (PALETTE_LUT_SIZE - 1)) | 0, 0, PALETTE_LUT_SIZE - 1);
    const color = paletteLut[colorIndex];
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);

    // Baked studio lighting: a cool key from the front-right and a subtle
    // high-elevation sheen keep the surface readable without washing out tails.
    const ndl = clamp(nx * 0.38 - ny * 0.34 + nz * 0.86, 0, 1);
    const diffuse = 0.4 + 0.78 * ndl;
    const sheen = Math.pow(ndl, 20) * 0.24 * t * t;
    colors.setXYZ(
      i,
      clamp(color.r * diffuse + sheen, 0, 1),
      clamp(color.g * diffuse + sheen * 0.94, 0, 1),
      clamp(color.b * diffuse + sheen * 0.78, 0, 1)
    );
  }
  colors.needsUpdate = true;
}

function updateContours() {
  const root = Math.sqrt(1 - params.rho * params.rho);
  contourSegments.forEach(({ level, positions, attribute, geometry }) => {
    const radius = Math.sqrt(-2 * Math.log(level));
    let count = 0;
    let previousIn = false;
    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i <= CONTOUR_STEPS; i += 1) {
      const theta = (i / CONTOUR_STEPS) * Math.PI * 2;
      const z1 = radius * Math.cos(theta);
      const z2 = radius * Math.sin(theta);
      const x = params.mu1 + params.sigma1 * z1;
      const y = params.mu2 + params.sigma2 * (params.rho * z1 + root * z2);
      const inside = Math.abs(x) <= DOMAIN - 0.04 && Math.abs(y) <= DOMAIN - 0.04;
      if (i > 0 && inside && previousIn) {
        positions[count] = worldX(previousX);
        positions[count + 1] = worldY(previousY);
        positions[count + 2] = level * HEIGHT + 0.014;
        positions[count + 3] = worldX(x);
        positions[count + 4] = worldY(y);
        positions[count + 5] = level * HEIGHT + 0.014;
        count += 6;
      }
      previousIn = inside;
      previousX = x;
      previousY = y;
    }
    geometry.setDrawRange(0, count / 3);
    attribute.needsUpdate = true;
  });
}

function updateMarker() {
  const x = worldX(params.mu1);
  const y = worldY(params.mu2);
  markerDot.position.set(x, y, HEIGHT);
  markerGlow.position.set(x, y, HEIGHT);
  markerRing.position.set(x, y, 0.012);
  const linePositions = markerLine.geometry.attributes.position;
  linePositions.setXYZ(0, x, y, 0.01);
  linePositions.setXYZ(1, x, y, HEIGHT);
  linePositions.needsUpdate = true;
  markerLine.computeLineDistances();
}

function updateZLabels(peak) {
  zFractionsForLabels().forEach((fraction, index) => {
    const sprite = zTickSprites[index];
    if (!sprite) return;
    sprite.userData.setText(
      fraction === 0 ? '0' : formatDensity(fraction * peak)
    );
  });
}

function zFractionsForLabels() {
  return [0, 0.25, 0.5, 0.75, 1];
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function paintRange(row) {
  const { input, fill, bipolar } = row;
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percent = ((value - min) / (max - min)) * 100;
  if (bipolar) {
    const center = ((0 - min) / (max - min)) * 100;
    fill.style.left = `${Math.min(percent, center)}%`;
    fill.style.width = `${Math.abs(percent - center)}%`;
  } else {
    fill.style.left = '0%';
    fill.style.width = `${percent}%`;
  }
}

function syncInputs() {
  paramKeys.forEach((key) => {
    inputs[key].value = String(params[key]);
  });
}

function updateUI() {
  outputs.mu1.textContent = formatSigned(params.mu1, 1);
  outputs.mu2.textContent = formatSigned(params.mu2, 1);
  outputs.sigma1.textContent = params.sigma1.toFixed(2);
  outputs.sigma2.textContent = params.sigma2.toFixed(2);
  outputs.rho.textContent = formatSigned(params.rho, 2, true);
  paramKeys.forEach((key) => {
    inputs[key].setAttribute(
      'aria-valuetext',
      key === 'rho'
        ? `ρ 等于 ${formatSigned(params.rho, 2, true)}`
        : `${key === 'mu1' ? 'μ 1' : key === 'mu2' ? 'μ 2' : key === 'sigma1' ? 'σ 1' : 'σ 2'} 等于 ${outputs[key].textContent}`
    );
  });
  rangeRows.forEach(paintRange);

  const peak = peakDensity();
  peakValueEl.textContent = peak.toFixed(4);
  covValueEl.textContent = formatSigned(params.rho * params.sigma1 * params.sigma2, 3, true);
  rhoReadoutEl.textContent = `ρ = ${formatSigned(params.rho, 2, true)}`;

  const abs = Math.abs(params.rho);
  let title = '无线性相关';
  let color = '#6ee7d3';
  if (abs >= 0.1) {
    if (params.rho > 0) {
      title = abs >= 0.55 ? '强正相关' : '正相关';
      color = '#f9c270';
    } else {
      title = abs >= 0.55 ? '强负相关' : '负相关';
      color = '#b197ff';
    }
  }
  rhoTitleEl.textContent = title;
  rhoDotEl.style.backgroundColor = color;
  rhoDotEl.style.color = color;
  rhoDotEl.style.boxShadow = `0 0 8px ${color}`;

  const activePreset = Object.entries(PRESETS).find(([, preset]) =>
    paramKeys.every((key) => Math.abs(params[key] - preset[key]) < 0.001)
  );
  presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === activePreset?.[0]);
  });
}

function updateAutoIndicator() {
  autoIndicator.classList.remove('is-paused', 'is-off');
  if (!state.autoRotate) {
    autoIndicator.classList.add('is-off');
    autoLabel.textContent = '自动旋转已关闭';
  } else if (state.dragging) {
    autoIndicator.classList.add('is-paused');
    autoLabel.textContent = '视角交互中';
  } else {
    autoLabel.textContent = '自动旋转中';
  }
}

function setParamsInstant(next) {
  paramKeys.forEach((key) => {
    if (next[key] !== undefined) params[key] = Number(next[key]);
  });
  state.paramTween = null;
  syncInputs();
  updateUI();
  state.dirty = true;
}

function animateToParams(next, duration = 560) {
  if (!next) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    setParamsInstant(next);
    return;
  }
  const from = { ...params };
  const to = { ...params };
  paramKeys.forEach((key) => {
    if (next[key] !== undefined) to[key] = Number(next[key]);
  });
  state.paramTween = {
    from,
    to,
    start: performance.now(),
    duration,
  };
}

function tickParamTween(now) {
  if (!state.paramTween) return;
  const { from, to, start, duration } = state.paramTween;
  const raw = clamp((now - start) / duration, 0, 1);
  const eased = raw < 0.5 ? 2 * raw * raw : 1 - ((-2 * raw + 2) ** 2) / 2;
  paramKeys.forEach((key) => {
    params[key] = from[key] + (to[key] - from[key]) * eased;
  });
  if (raw >= 1) {
    paramKeys.forEach((key) => { params[key] = to[key]; });
    state.paramTween = null;
  }
  syncInputs();
  updateUI();
  state.dirty = true;
}

function resetView() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    camera.position.copy(HOME_POSITION);
    controls.target.copy(HOME_TARGET);
    controls.update();
    return;
  }
  state.resetAnim = {
    start: performance.now(),
    duration: 620,
    fromPosition: camera.position.clone(),
    toPosition: HOME_POSITION.clone(),
    fromTarget: controls.target.clone(),
    toTarget: HOME_TARGET.clone(),
  };
  controls.enabled = false;
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function initUI() {
  syncInputs();
  updateUI();

  rangeRows.forEach(({ input }) => {
    input.addEventListener('input', () => {
      state.paramTween = null;
      params[input.dataset.param] = Number(input.value);
      updateUI();
      state.dirty = true;
    });
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      animateToParams(PRESETS[button.dataset.preset]);
    });
  });

  resetAllButton.addEventListener('click', () => {
    animateToParams(DEFAULTS);
  });

  resetViewButton.addEventListener('click', resetView);
  renderer.domElement.addEventListener('dblclick', resetView);

  autoToggle.addEventListener('change', () => {
    state.autoRotate = autoToggle.checked;
    controls.autoRotate = state.autoRotate;
    updateAutoIndicator();
  });

  contourToggle.addEventListener('change', () => {
    state.contours = contourToggle.checked;
    contourGroup.visible = state.contours;
  });

  const resize = () => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(viewport);
  }
  resize();

  updateAutoIndicator();
}

/* ------------------------------------------------------------------ *
 *  Render loop
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();

function loop(now) {
  requestAnimationFrame(loop);
  const delta = Math.min(clock.getDelta(), 0.05);

  tickParamTween(now);
  if (state.dirty) {
    const peak = peakDensity();
    updateSurface(peak);
    updateContours();
    updateMarker();
    updateZLabels(peak);
    state.dirty = false;
  }

  if (state.resetAnim) {
    const animation = state.resetAnim;
    const raw = clamp((now - animation.start) / animation.duration, 0, 1);
    const eased = 1 - (1 - raw) ** 3;
    camera.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
    controls.target.lerpVectors(animation.fromTarget, animation.toTarget, eased);
    camera.lookAt(controls.target);
    if (raw >= 1) {
      state.resetAnim = null;
      controls.enabled = true;
      controls.update();
    }
  } else {
    controls.update(delta);
  }

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */
function showFatal(message) {
  viewport.classList.add('is-error');
  if (message) {
    fatalBox.innerHTML = message;
  }
}

function applyQueryOptions() {
  const search = new URLSearchParams(window.location.search);
  if (search.get('rotate') === '0') {
    state.autoRotate = false;
    autoToggle.checked = false;
    controls.autoRotate = false;
    updateAutoIndicator();
  }
  const preset = search.get('preset');
  if (preset && PRESETS[preset]) {
    setParamsInstant(PRESETS[preset]);
  }

  const overrides = {};
  paramKeys.forEach((key) => {
    const raw = search.get(key);
    if (raw === null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const input = inputs[key];
    overrides[key] = clamp(value, Number(input.min), Number(input.max));
  });
  if (Object.keys(overrides).length) {
    setParamsInstant({ ...params, ...overrides });
  }
}

function boot() {
  try {
    initScene();
    initUI();
    applyQueryOptions();
    updateSurface(peakDensity());
    updateContours();
    updateMarker();
    updateZLabels(peakDensity());
    state.dirty = false;
    requestAnimationFrame(loop);

    window.__bvn = {
      get params() { return { ...params }; },
      get peakDensity() { return peakDensity(); },
      setParams(next) { setParamsInstant(next); },
      setPreset(name) { if (PRESETS[name]) animateToParams(PRESETS[name]); },
      resetView,
      get camera() {
        return {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        };
      },
      get autoRotate() { return state.autoRotate; },
      get orbitAutoRotate() { return controls.autoRotate; },
    };
  } catch (error) {
    console.error(error);
    showFatal(
      `WebGL 初始化失败：${String(error?.message || error)}<br>请尝试使用最新版 Chrome、Edge 或 Firefox。`
    );
  }
}

boot();
