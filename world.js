// A terraced voxel estate at sunset: one square chunk with a strip of water along one side,
// rendered with ordered dithering. Everything is built in code.
//
// Layout (cells are 1 world unit; x runs toward the bottom-right of the screen, z toward
// the bottom-left): terraces rise toward the back (low z), winding gravel paths link the
// stairs and buildings, and a stone promenade runs along the water edge (high x).
import * as THREE from 'three';
import { makeHuman } from './human.js';
import { createDither } from './dither.js';

// ---------- Constants ----------
const X = 28, Z = 32;           // land size in cells (with the water strip, the chunk is square)
const WATER_W = 4;              // a narrow strip of water along the promenade, inside the chunk
const GX = X + WATER_W;         // grid width, including the water strip (and the dock over it)
const PIX = 1;                  // screen pixels per rendered pixel
const LEVELS = 32;              // colour levels per channel after dithering (more levels = subtler dots)
const SPEED = 3.6;              // player speed, units / second
const FOLLOW_ZOOM = 2.7;
const YAW = Math.PI / 4, PITCH = 0.6;
const WATER_Y = -0.55, BASE_Y = -1.4;
const BG = [0, 0, 0];
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = document.getElementById('stage');
const labelsEl = document.getElementById('labels');
const hintEl = document.getElementById('hint');
const overviewBtn = document.getElementById('overview');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false });
} catch (e) {
  document.getElementById('webgl-error').style.display = 'grid';
  throw e;
}
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

// ---------- Helpers ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(11);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const wx = (x) => x - X / 2;    // cell edge -> world x
const wz = (z) => z - Z / 2;

// Collects coloured quads and boxes into one BufferGeometry (with per-vertex colour).
class Mesher {
  constructor() { this.p = []; this.n = []; this.c = []; }
  quad(a, b, c, d, normal, color) {
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    const flip = ab.cross(ac).dot(normal) < 0;
    const tris = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const v of tris) { this.p.push(v.x, v.y, v.z); this.n.push(normal.x, normal.y, normal.z); this.c.push(color.r, color.g, color.b); }
  }
  // both windings of a quad, each with the given normal: a thin card lit the same from either side
  quadBoth(a, b, c, d, normal, color) {
    for (const v of [a, b, c, a, c, d, a, c, b, a, d, c]) { this.p.push(v.x, v.y, v.z); this.n.push(normal.x, normal.y, normal.z); this.c.push(color.r, color.g, color.b); }
  }
  box(x0, y0, z0, x1, y1, z1, color, { bottom = false } = {}) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const faces = [
      [V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), V(0, 1, 0)],
      [V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), V(x1, y0, z1), V(1, 0, 0)],
      [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), V(-1, 0, 0)],
      [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), V(0, 0, 1)],
      [V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), V(x1, y0, z0), V(0, 0, -1)],
    ];
    if (bottom) faces.push([V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), V(0, -1, 0)]);
    for (const [a, b, c, d, n] of faces) this.quad(a, b, c, d, n, color);
  }
  // a small cube centred at (x, y, z)
  cube(x, y, z, s, color) { this.box(x - s / 2, y - s / 2, z - s / 2, x + s / 2, y + s / 2, z + s / 2, color); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}
const col = (hex) => new THREE.Color(hex);
const vary = (hex, amt) => new THREE.Color(hex).offsetHSL(0, 0, (rnd() - 0.5) * amt);
const vertexMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UPN = V3(0, 1, 0);

// ---------- Layout ----------
// The ground is modelled on a fine grid (F cells per world unit), so terrace edges can
// wander and corners can round off instead of following whole cells. Positions below
// are in cell units (one cell = one world unit).
const L0 = 0, L1 = 0.5, L2 = 1.0, L3 = 2.0;   // terrace heights; the top terrace sits higher
const O = 4;                                  // layout offset along x
const PROM_X = X - 3;                         // the promenade's first column
const F = 4, FX = GX * F, FZ = Z * F;
const fgrid = (v = 0) => Array.from({ length: FZ }, () => new Float32Array(FX).fill(v));
const inF = (i, j) => i >= 0 && j >= 0 && i < FX && j < FZ;
const fineOf = (p) => [Math.floor((p.x + X / 2) * F), Math.floor((p.z + Z / 2) * F)];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Each level has an organic outline: its front edge is a smooth curve drawn through
// hand-placed points (in cells), and the top level is a rounded plateau in the back-left
// rather than a full-width band. A little extra wobble roughens every edge. Edges hold
// still where the staircases cross them, and they round off at the promenade.
const wig = (x, seed, amp) => amp * (0.5 * Math.sin(x * 0.33 + seed) + 0.32 * Math.sin(x * 0.81 + seed * 2.3) + 0.18 * Math.sin(x * 1.9 + seed * 4.1));
function calm(x, spans) {
  let k = 1;
  for (const [a, b] of spans) { const d = x < a ? a - x : x > b ? x - b : 0; k = Math.min(k, smoothstep(0.4, 1.6, d)); }
  return k;
}
// Catmull-Rom curve through [x, y] points (sorted by x)
function curve(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    const n = pts.length;
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let k = 0;
    while (pts[k + 1][0] <= x) k++;
    const p0 = pts[Math.max(0, k - 1)][1], p1 = pts[k][1], p2 = pts[k + 1][1], p3 = pts[Math.min(n - 1, k + 2)][1];
    const t = (x - pts[k][0]) / (pts[k + 1][0] - pts[k][0]), t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
}
// round a level's corner where it meets the promenade (radius in cells)
const corner = (x, R) => (x > PROM_X - R ? R - Math.sqrt(Math.max(0, R ** 2 - (x - (PROM_X - R)) ** 2)) : 0);
const MAIN = [14, 16], LEFT = [3, 5];   // x spans of the two staircases
const pin = (x, z, at, spans) => at + (z - at) * calm(x, spans);

// front edge of the third level (the plaza level lies in front of it)
const FRONT1 = curve([[0, 19.2], [2, 20.3], [4, 21], [6.5, 21.6], [9.5, 21.4], [12, 20.7], [15, 21], [18, 20.1], [21, 19.7], [24, 20.4], [28, 20.4]]);
const edge1 = (x) => pin(x, FRONT1(x) + wig(x, 1.0, 0.2), 21, [MAIN, LEFT]) - corner(x, 2.8);
// front edge of the second level, with a deep bay on the right
const FRONT2 = curve([[0, 12.4], [2, 13.4], [4, 14], [6.5, 14.3], [8.5, 13.4], [11, 13.1], [13, 13.4], [15, 14], [17, 12.6], [19, 11.2], [21, 11], [23, 12.2], [28, 12.4]]);
const edge2 = (x) => pin(x, FRONT2(x) + wig(x, 2.0, 0.2), 14, [MAIN, LEFT]) - corner(x, 1.6);
// the top level: a rounded plateau in the back-left
const TOP_FRONT = curve([[2, 3.8], [3.5, 4.6], [5, 5.4], [7, 6.1], [9, 6.5], [11, 7.0], [13, 7.3], [14.5, 7], [16, 7], [17, 6]]);
const TOP_LEFT = curve([[0, 1.6], [2, 2.0], [3.5, 2.7], [5, 3.6], [6, 5]]);     // x of its left edge, by z
const TOP_RIGHT = curve([[0, 16.8], [4, 16.6], [7, 16.3], [8, 15]]);            // x of its right edge, by z
const onPlateau = (cx, cz) => cz < pin(cx, TOP_FRONT(cx) + wig(cx, 3.0, 0.15), 7, [MAIN]) && cx > TOP_LEFT(cz) && cx < TOP_RIGHT(cz);
// The promenade's inner edge (where the terraces stop) and the shoreline both wander;
// they hold still where the promenade steps come down and where the dock meets the shore.
const promIn = (cz) => PROM_X + wig(cz, 7.0, 0.9) * calm(cz, [[17.2, 20.8]]);
// the shore wanders more toward the front, around the pier, and always leaves a walkable promenade
const shore = (cz) => Math.max(promIn(cz) + 1.4,
  X - 0.25 + wig(cz, 8.0, 0.75) + 0.5 * Math.sin(cz * 1.25 + 0.6) * smoothstep(19, 22, cz));
// x (in cells) where land gives way to water on fine row j, snapped to the fine grid
const shoreEdge = (j) => Math.ceil(shore((j + 0.5) / F) * F - 0.5) / F;
function levelAt(cx, cz) {
  if (cx >= promIn(cz)) return L0; // promenade along the water
  if (cz >= edge1(cx)) return L0;  // the plaza level and the big building
  if (cz >= edge2(cx)) return L1;
  return onPlateau(cx, cz) ? L3 : L2;
}

const Hf = fgrid(0);      // height of each fine cell
const land = fgrid(0);    // 1 = ground (not water)
const dockF = fgrid(0);   // 1 = the dock over the water
const solidF = fgrid(0);  // blocks walking
const pathF = fgrid(0);   // 1 = gravel path, 2 = paving (walkers prefer these)
const stairF = fgrid(0);  // 1 = part of a staircase
const lotF = fgrid(0);    // building lot index + 1
const wornF = fgrid(0);   // grass worn down along the edges of the gravel
for (let j = 0; j < FZ; j++)
  for (let i = 0; i < FX; i++) {
    const cx = (i + 0.5) / F, cz = (j + 0.5) / F;
    if (cx < shore(cz)) { land[j][i] = 1; Hf[j][i] = levelAt(cx, cz); }
  }

// Tidy the edges: a fine cell that sticks out on its own takes its neighbours' height.
for (let pass = 0; pass < 2; pass++)
  for (let j = 1; j < FZ - 1; j++)
    for (let i = 1; i < X * F - 1; i++) {
      const h = Hf[j][i], n = [Hf[j][i - 1], Hf[j][i + 1], Hf[j - 1][i], Hf[j + 1][i]];
      if (n.filter((v) => v === h).length >= 2) continue;
      const counts = new Map();
      for (const v of n) counts.set(v, (counts.get(v) || 0) + 1);
      Hf[j][i] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    }

// Stairs: narrow flights of shallow stone steps, one step per fine row. Each flight
// drifts a little to the side as it climbs (`drift`, in fine cells per row), step heights
// vary slightly, and the long flight has a landing partway up. They run along z with the
// high side toward -z; the steps down to the promenade run along x.
const STAIR_W = 5;   // width in fine cells (1.25 cells)
const STAIRS_Z = [
  { cx: 15, zTop: 21, rows: 4, low: L0, high: L1, drift: [0, 0, 1, 1] },
  { cx: 15, zTop: 14, rows: 4, low: L1, high: L2, drift: [1, 1, 0, 0] },
  { cx: 15, zTop: 7, rows: 8, low: L2, high: L3, drift: [0, 0, -1, -1, -1, 0, 0, 1], landing: 4 },
  { cx: 4, zTop: 21, rows: 4, low: L0, high: L1, drift: [0, -1, -1, 0] },
  { cx: 4, zTop: 14, rows: 4, low: L1, high: L2, drift: [0, 0, 1, 1] },
];
const stairRnd = mulberry32(31);
function stepHeights(rows, low, high, landing) {
  const steps = rows - (landing ? 1 : 0), rise = (high - low) / (steps + 1), out = [];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    if (r !== landing) k++;
    out.push(high - k * rise + (stairRnd() - 0.5) * rise * 0.25);
  }
  return out;
}
for (const { cx, zTop, rows, low, high, drift, landing } of STAIRS_Z) {
  const hs = stepHeights(rows, low, high, landing);
  for (let r = 0; r < rows; r++) {
    const j = zTop * F + r, i0 = Math.round(cx * F - STAIR_W / 2) + drift[r];
    for (let i = i0; i < i0 + STAIR_W; i++) { Hf[j][i] = hs[r]; stairF[j][i] = 1; }
  }
}
{
  const hs = stepHeights(F, L0, L1);
  for (let c = 0; c < F; c++)
    for (let j = 18 * F + 2; j < 18 * F + 2 + STAIR_W; j++) {
      const i = (PROM_X - 1) * F + c;
      Hf[j][i] = hs[c];
      stairF[j][i] = 1;
    }
}
// the dock reaches out over the water
const PIER = { j0: 111, j1: 116, i1: (X + 3) * F + 2 };   // fine rows 111-115 (1.25 cells wide), out to X + 3.5
PIER.i0 = Math.floor(Math.min(...Array.from({ length: PIER.j1 - PIER.j0 }, (_, k) => shoreEdge(PIER.j0 + k))) * F) - 2;
for (let j = PIER.j0; j < PIER.j1; j++) for (let i = PIER.i0; i < PIER.i1; i++) { dockF[j][i] = 1; Hf[j][i] = 0; }

const cellHeight = (x, z) => Hf[Math.min(FZ - 1, z * F + 2)][Math.min(FX - 1, x * F + 2)];

// Building lots (outlined for now). Doors face +z unless `doorX` (then +x).
// `id` is the place the sidebar sends you to; lots without an id are just lots for now.
const BUILDINGS = [
  // `id` ties a building to a site section: hovering shows its name, clicking opens it
  { lot: 'library', id: 'research', name: 'Research', x0: 5, z0: 1, w: 8, d: 2, h: 2.6, shape: 'suzzallo' },   // UW's Suzzallo Library, on the top level
  { lot: 'office', id: 'experience', name: 'Experience', x0: 19, z0: 22, w: 5, d: 3, h: 3, shape: 'office' },      // an office block by the water (to become Amazon)
  { lot: 'hall', id: 'teaching', name: 'Teaching/Leadership', x0: 6, z0: 8, w: 5, d: 3, h: 4, shape: 'hall' },            // a towered hall with stepped wings
  { lot: 'rotunda', id: 'fun', name: 'Just for fun', x0: 5, z0: 23, w: 3, d: 3, h: 3.4, shape: 'rotunda' },     // after the Palace of Fine Arts rotunda
  { lot: 'reading-room', id: 'blog', name: 'Thoughts & Ideas', doorX: true, x0: 0, z0: 14, w: 3, d: 5, h: 2.2, shape: 'portico' }, // a smaller library with a columned portico, facing +x
];
function registerLot(b, k) {
  b.level = cellHeight(b.x0 + (b.w >> 1), b.z0 + (b.d >> 1));
  b.door = b.doorX ? [b.x0 + b.w, b.z0 + (b.d - 1) / 2] : [b.x0 + (b.w - 1) / 2, b.z0 + b.d];
  for (let j = b.z0 * F; j < (b.z0 + b.d) * F; j++)
    for (let i = b.x0 * F; i < (b.x0 + b.w) * F; i++) { lotF[j][i] = k + 1; solidF[j][i] = 1; Hf[j][i] = b.level; }
  b.center = V3(wx(b.x0 + b.w / 2), b.level, wz(b.z0 + b.d / 2));
  b.labelAnchor = b.center.clone().setY(b.level + b.h);
}
// A row of six Painted Ladies on the second terrace, facing +x, each stepped forward from the
// last so the row runs on a diagonal from (18, 8) towards (22, 1).
for (let k = 0; k < 6; k++) BUILDINGS.push({ lot: `lady-${k}`, id: 'about', name: 'About', doorX: true, x0: 18 + k * 0.75, z0: 6.75 - k * 1.25, w: 1.75, d: 1.25, h: 1.9, shape: 'lady', k });
BUILDINGS.forEach(registerLot);
// Spots are places without a building: the plaza, the lawn by the water, the dock, the top terrace.
const SPOTS = [
  { id: 'fun-1', cell: [12 + O, 29] },
  { id: 'fun-2', cell: [X + 2, 28] },
  { id: 'fun-3', cell: [4 + O, 4] },
];
for (const s of SPOTS) s.door = s.cell;
const PLACES = [...BUILDINGS.filter((b) => b.id), ...SPOTS];

// Gravel paths: winding lines (cell units) linking every staircase, door and spot.
const PATHS = [
  [[15, 6.6], [13.9, 6.1], [12.6, 5.9], [11.5, 5.6]],                       // top terrace: stairs -> lecture hall
  [[11.5, 5.6], [10, 5.0], [8.6, 4.6]],                                      // ...and on to the lookout
  [[9.4, 4.85], [9.1, 3.9], [9, 3.2]],                                       // up to the library's steps
  [[21.5, 27.7], [21.5, 26.4], [21.5, 25.4]],                                // up to the office's door
  [[15, 9.3], [15.4, 10.6], [15.1, 12.2], [15, 13.6]],                       // second terrace: between the stairs
  [[15.3, 10.4], [16.6, 9.9], [18.5, 9.7]],                                  // ...to the townhouses
  [[18.5, 9.7], [20.1, 8.9], [20.5, 7.6], [24.2, 1.3]],                      // ...and along the front of the Painted Ladies
  [[15.1, 12.0], [13, 12.4], [10.4, 11.8], [8.4, 11.9], [7.5, 11.6]],        // ...to the pavilion
  [[7.5, 11.6], [5.8, 12.5], [4.6, 13.1], [4, 13.6]],                        // ...to the left stairs
  [[15, 15.3], [14.2, 16.4], [12.6, 17.2], [11.5, 17.6]],                    // third terrace: stairs -> library
  [[15, 15.3], [16.5, 16.4], [18.2, 17.2], [19.5, 17.6]],                    // ...stairs -> home
  [[19.5, 17.6], [21.4, 18.6], [23.6, 19]],                                  // ...home -> promenade steps
  [[15, 20.5], [14.7, 19.2], [13.6, 18.2], [12.6, 17.2]],                    // ...lower stairs join in
  [[11.5, 17.6], [9.2, 18.4], [6.8, 17.8], [5.0, 17.0], [4, 15.3]],          // ...across to the left stairs
  [[5.0, 17.0], [4.6, 18.8], [4, 20.5]],
  [[4, 22.3], [6.5, 22.2], [9, 22.3], [11.4, 22.4], [13.2, 22.9], [15, 22.4]],   // front: left stairs -> main stairs
  [[15, 22.4], [15.7, 23.6], [17.1, 24.6], [17.8, 26], [18.4, 27.4], [20.5, 27.6], [22.6, 28.1], [25.6, 28.5]], // main stairs -> library -> pier
  [[11.4, 26.5], [13.1, 26.1], [15, 25.3], [17.1, 24.6]],                      // the lab's door
  [[15.2, 29.6], [16.8, 29.7], [18.4, 28.6], [18.4, 27.4]],                     // along the front lawn
];
const PATH_W = 0.42;   // half-width, in cells
function nearPath(cx, cz, extra = 0) {
  let best = Infinity;
  for (const line of PATHS)
    for (let k = 1; k < line.length; k++) {
      const [ax, az] = line[k - 1], [bx, bz] = line[k], dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(cx - ax - t * dx, cz - az - t * dz));
    }
  return best < PATH_W + extra;
}
// The plaza is a soft, rounded shape (a superellipse with a wobbly rim) that flows into
// the promenade on its right.
const PLAZA = { cx: 12.2, cz: 17.2, a: 1.7, b: 1.4 };
function onPlaza(cx, cz) {
  if (levelAt(cx, cz) !== L1) return false;
  const dx = (cx - PLAZA.cx) / PLAZA.a, dz = (cz - PLAZA.cz) / PLAZA.b, ang = Math.atan2(dz, dx);
  const rim = 1 + 0.16 * Math.sin(ang * 3 + 0.7) + 0.09 * Math.sin(ang * 7 + 2.1) + 0.05 * Math.sin(ang * 13);
  return Math.pow(Math.abs(dx), 2.6) + Math.pow(Math.abs(dz), 2.6) < rim;
}
for (let j = 0; j < FZ; j++)
  for (let i = 0; i < FX; i++) {
    if (!land[j][i]) continue;
    const cx = (i + 0.5) / F, cz = (j + 0.5) / F;
    if (cx >= promIn(cz) || onPlaza(cx, cz)) pathF[j][i] = 2;
    else if (!stairF[j][i] && nearPath(cx, cz)) pathF[j][i] = 1;
    else if (nearPath(cx, cz, 0.15)) wornF[j][i] = 1;
  }

// ---------- Scene ----------
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight('#e0ad90', '#5a3a26', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffb36e', 3.2);
sun.position.set(-16, 13, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const world = new THREE.Group();
scene.add(world);

const C = {
  water: ['#1c2a38', '#1e2d3b', '#1b2836'],
  wood: ['#7d5633', '#6f4c2e', '#875d38'],
  stone: ['#91816f', '#9b8b78', '#857665', '#a2917e'],
};

// ---------- Ground textures ----------
// One painted texture covers the whole chunk from above: fine grass, winding gravel,
// the plaza's stones, the promenade and the stair treads.
function valueNoise(seed, scale, size) {
  const r = mulberry32(seed), n = Math.ceil(size / scale) + 2, g = Array.from({ length: n * n }, r);
  return (x, y) => {
    const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * n + ix], b = g[iy * n + ix + 1], c = g[(iy + 1) * n + ix], d = g[(iy + 1) * n + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
const TEX = 32;                     // texture pixels per cell
function paintGround() {
  const S = GX * TEX, img = new ImageData(S, S), o = img.data;
  const patch = valueNoise(21, 60, S), fine = valueNoise(22, 6, S), grit = valueNoise(25, 3, S), wob = valueNoise(23, 5, S), wob2 = valueNoise(24, 5, S);
  const r = mulberry32(77), c = new THREE.Color();
  const P = (h) => new THREE.Color(h);
  const G = { a: P('#5c7633'), b: P('#718b40'), dark: P('#4a632d'), light: P('#869b4c'), clover: P('#62823c') };
  const GR = { base: P('#bba68e'), dark: P('#9c8670'), light: P('#d4c0a8'), pebble: P('#877361'), edge: P('#8d8c5c') };
  const ST = [P('#c7b5a4'), P('#bcaa98'), P('#d0bfae'), P('#c2b09e')], MORTAR = P('#94806a');
  const PR = [P('#b6a594'), P('#ac9b89'), P('#bead9b')];
  const hash = (a, b) => Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;
  // Paving laid in irregular rows of mixed-size stones. Returns, per pixel, the stone it
  // belongs to (-1 on a joint), plus each stone's colour.
  function layPaving(seed, rowH, stoneW, palette, axisX = false) {
    const pr = mulberry32(seed), owner = new Int32Array(S * S).fill(-1), base = [];
    for (let a = 0; a < S;) {
      const h = rowH[0] + Math.floor(pr() * (rowH[1] - rowH[0]));
      for (let b = -Math.floor(pr() * stoneW[1]); b < S;) {
        const w = stoneW[0] + Math.floor(pr() * (stoneW[1] - stoneW[0])), id = base.length;
        base.push(palette[Math.floor(pr() * palette.length)].clone().offsetHSL((pr() - 0.5) * 0.02, (pr() - 0.5) * 0.05, (pr() - 0.5) * 0.12));
        for (let u = a + 1; u < Math.min(S, a + h); u++)
          for (let v = Math.max(0, b + 1); v < Math.min(S, b + w); v++) owner[axisX ? v * S + u : u * S + v] = id;
        b += w;
      }
      a += h;
    }
    return { owner, base };
  }
  const plazaStones = layPaving(41, [3, 7], [4, 11], ST);
  const promStones = layPaving(42, [3, 5], [7, 16], PR, true);   // long slabs running along the water
  const pgrain = valueNoise(43, 3, S), pblotch = valueNoise(44, 14, S);
  function paved({ owner, base }, x, y, n) {
    const id = owner[y * S + x];
    if (id < 0) {   // joint: the neighbouring stone, a little darker
      const nb = owner[y * S + Math.min(S - 1, x + 2)];
      return c.copy(base[nb >= 0 ? nb : 0]).offsetHSL(0, 0, -0.06 + (n - 0.5) * 0.02);
    }
    c.copy(base[id]).offsetHSL(0, 0, (pgrain(x, y) - 0.5) * 0.08 + (pblotch(x, y) - 0.5) * 0.07);
    if (owner[Math.max(0, y - 1) * S + x] !== id || owner[y * S + Math.max(0, x - 1)] !== id) c.offsetHSL(0, 0, 0.03);
    if (n < 0.07) c.offsetHSL(0, 0, -0.04); else if (n < 0.12) c.offsetHSL(0, 0, 0.03);
    return c;
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const cx = x / TEX, cz = y / TEX, i = Math.floor(cx * F), j = Math.floor(cz * F), n = r();
      // jitter the lookup a little so path edges come out ragged rather than smooth
      const jx = Math.min(FX - 1, Math.max(0, Math.floor((cx + (wob(x, y) - 0.5) * 0.14) * F)));
      const jz = Math.min(FZ - 1, Math.max(0, Math.floor((cz + (wob2(x, y) - 0.5) * 0.14) * F)));
      const kind = stairF[j][i] ? 'stair' : pathF[jz][jx] === 1 && Hf[jz][jx] === Hf[j][i] ? 'gravel' : pathF[j][i] === 2 ? (cx >= promIn(cz) ? 'prom' : 'plaza') : 'grass';
      if (kind === 'grass') {
        c.copy(G.a).lerp(G.b, Math.min(1, Math.max(0, patch(x, y) * 1.4 - 0.2)));
        c.lerp(G.dark, Math.max(0, 0.42 - fine(x, y)) * 0.7);
        if (n < 0.05) c.copy(G.dark); else if (n < 0.08) c.copy(G.light); else if (n < 0.095) c.copy(G.clover);
        if (wornF[j][i]) c.lerp(GR.edge, 0.3);   // worn grass along the gravel
      } else if (kind === 'gravel') {
        c.copy(GR.base).lerp(GR.dark, grit(x, y) * 0.5);
        if (n < 0.08) c.copy(GR.pebble); else if (n < 0.16) c.copy(GR.light); else if (n < 0.2) c.copy(GR.dark);
      } else if (kind === 'plaza') {
        paved(plazaStones, x, y, n);
      } else if (kind === 'prom') {
        paved(promStones, x, y, n);
      } else {
        // stair treads: each step is a few stones of different tones, with a worn, darker lip
        const along = i >= (PROM_X - 1) * F;   // the promenade steps run along x
        const u = along ? y : x, v = along ? x : y, step = Math.floor(v / (TEX / F));
        const stone = Math.floor((u + hash(step, 3) * 11) / 13);
        const joint = (u + Math.floor(hash(step, 3) * 11)) % 13 === 0;
        c.copy(ST[Math.floor(hash(step, stone) * ST.length)]).offsetHSL(0, 0, (hash(stone, step) - 0.5) * 0.06);
        if (v % (TEX / F) < 2) c.offsetHSL(0, 0, -0.09);
        if (joint) c.copy(MORTAR);
        if (n < 0.07) c.offsetHSL(0, 0, -0.04);
      }
      c.offsetHSL(0, 0, (n - 0.5) * 0.015).convertLinearToSRGB();
      const k = (y * S + x) * 4;
      o[k] = c.r * 255; o[k + 1] = c.g * 255; o[k + 2] = c.b * 255; o[k + 3] = 255;
    }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  canvas.getContext('2d').putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
// Dry-stone wall for every vertical face (terrace walls, risers, the chunk's sides).
// Courses of varied height, stones of irregular width with chipped corners, a lit top
// edge and shadowed lower edge, speckle and cracks, deep joints, and a little moss low
// down. The texture covers WALL_TILE world units before repeating.
const WALL_TILE = 2;
function paintBricks() {
  const PX = 128, S = PX * WALL_TILE;           // 128 texture pixels per world unit
  const img = new ImageData(S, S), o = img.data, r = mulberry32(5);
  const owner = new Int32Array(S * S).fill(-1);  // which stone each pixel belongs to (-1 = joint)
  const stones = [];
  let y = 0;
  while (y < S) {
    const h = Math.min(S - y, 10 + Math.floor(r() * 10));   // course height
    let x = -Math.floor(r() * 30);
    while (x < S) {
      const w = r() < 0.25 ? 9 + Math.floor(r() * 8) : 18 + Math.floor(r() * 30);
      // a stone sits a little inside its slot, with its own small vertical offset
      const id = stones.length, jy = Math.floor((r() - 0.5) * 2), gap = 1;
      const base = new THREE.Color(pick(C.stone)).offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.06, (r() - 0.5) * 0.16);
      if (r() < 0.08) base.offsetHSL(0, -0.03, 0.08);   // a few lighter, weathered stones
      stones.push({ x0: x + gap, y0: y + gap + jy, x1: x + w - gap, y1: y + h - gap + jy, base, chip: 1 + Math.floor(r() * 3) });
      x += w;
    }
    y += h;
  }
  // rasterise stones with rounded/chipped corners (wrapping horizontally and vertically)
  stones.forEach((st, id) => {
    const { x0, y0, x1, y1, chip } = st;
    for (let py = y0; py < y1; py++)
      for (let px = x0; px < x1; px++) {
        const dx = Math.max(x0 + chip - px, px - (x1 - 1 - chip), 0), dy = Math.max(y0 + chip - py, py - (y1 - 1 - chip), 0);
        if (dx * dx + dy * dy > chip * chip) continue;
        owner[((py % S + S) % S) * S + ((px % S + S) % S)] = id;
      }
  });
  const grain = valueNoise(51, 4, S), blotch = valueNoise(52, 18, S), moss = valueNoise(53, 22, S);
  const mossC = new THREE.Color('#536233'), c = new THREE.Color();
  const fine = valueNoise(54, 2, S);
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const id = owner[py * S + px], k = (py * S + px) * 4;
      const low = py / S;   // 0 at the top of the tile, 1 at the bottom
      if (id < 0) {
        // joints: the neighbouring stone's tone, a little darker
        const nb = owner[py * S + (px + 3) % S], st = stones[nb >= 0 ? nb : 0];
        c.copy(st.base).offsetHSL(0, 0, -0.07 + (r() - 0.5) * 0.02);
      } else {
        const st = stones[id];
        c.copy(st.base);
        c.offsetHSL((blotch(px, py) - 0.5) * 0.02, 0, (grain(px, py) - 0.5) * 0.1 + (blotch(px, py) - 0.5) * 0.08 + (fine(px, py) - 0.5) * 0.06);
        // bevel: lit along the top-left of each stone, shadowed along the bottom-right
        const up = owner[((py - 1 + S) % S) * S + px] !== id, left = owner[py * S + (px - 1 + S) % S] !== id;
        const dn = owner[((py + 1) % S) * S + px] !== id, right = owner[py * S + (px + 1) % S] !== id;
        if (up || left) c.offsetHSL(0, 0, 0.04);
        if (dn || right) c.offsetHSL(0, 0, -0.04);
        const n = r();
        if (n < 0.08) c.offsetHSL(0, 0, -0.05); else if (n < 0.14) c.offsetHSL(0, 0, 0.04);
        if (moss(px, py) > 0.66 && low > 0.45 && r() < 0.7) c.lerp(mossC, 0.45);
      }
      c.offsetHSL(0, 0, -0.06 * Math.max(0, low - 0.6));   // a darker, damper band low on the wall
      c.convertLinearToSRGB();
      o[k] = c.r * 255; o[k + 1] = c.g * 255; o[k + 2] = c.b * 255; o[k + 3] = 255;
    }
  // a few hairline cracks
  for (let n = 0; n < 40; n++) {
    let px = Math.floor(r() * S), py = Math.floor(r() * S);
    const id = owner[py * S + px];
    if (id < 0) continue;
    for (let s = 0; s < 6 + r() * 10; s++) {
      if (owner[py * S + px] !== id) break;
      const k = (py * S + px) * 4;
      o[k] *= 0.9; o[k + 1] *= 0.9; o[k + 2] *= 0.9;
      px = (px + (r() < 0.5 ? 1 : 0) + S) % S; py = (py + (r() < 0.6 ? 1 : -1) + S) % S;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  canvas.getContext('2d').putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---------- Terrain ----------
// Textured quads: tops of every fine cell, and vertical faces wherever the ground drops.
class TexMesher {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  quad(pts, normal, uvs) {
    const [a, b, c, d] = pts, ab = V3(0, 0, 0).subVectors(b, a), ac = V3(0, 0, 0).subVectors(c, a);
    const order = ab.cross(ac).dot(normal) < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const k of order) { this.p.push(pts[k].x, pts[k].y, pts[k].z); this.n.push(normal.x, normal.y, normal.z); this.uv.push(...uvs[k]); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}
const tops = new TexMesher(), sides = new TexMesher();
const fx = (i) => wx(i / F), fz = (j) => wz(j / F);
const topUV = (i, j) => [i / F / GX, 1 - j / F / Z];
// a vertical face along a fine-cell edge, from y0 up to y1; bricks are mapped in world units
function side(ax, az, bx, bz, y0, y1, normal) {
  const along = (x, z) => (normal.x !== 0 ? z : x);
  sides.quad([V3(ax, y0, az), V3(bx, y0, bz), V3(bx, y1, bz), V3(ax, y1, az)], normal,
    [[along(ax, az) / WALL_TILE, y0 / WALL_TILE], [along(bx, bz) / WALL_TILE, y0 / WALL_TILE], [along(bx, bz) / WALL_TILE, y1 / WALL_TILE], [along(ax, az) / WALL_TILE, y1 / WALL_TILE]]);
}
for (let j = 0; j < FZ; j++)
  for (let i = 0; i < FX; i++) {
    if (!land[j][i]) continue;
    const y = Hf[j][i];
    tops.quad([V3(fx(i), y, fz(j)), V3(fx(i + 1), y, fz(j)), V3(fx(i + 1), y, fz(j + 1)), V3(fx(i), y, fz(j + 1))], UPN,
      [topUV(i, j), topUV(i + 1, j), topUV(i + 1, j + 1), topUV(i, j + 1)]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      const below = inF(ni, nj) && land[nj][ni] ? Hf[nj][ni] : BASE_Y;
      if (below >= y - 1e-6) continue;
      const n = V3(di, 0, dj);
      if (di) { const ex = fx(di > 0 ? i + 1 : i); side(ex, fz(j), ex, fz(j + 1), below, y, n); }
      else { const ez = fz(dj > 0 ? j + 1 : j); side(fx(i), ez, fx(i + 1), ez, below, y, n); }
    }
  }
const groundMesh = new THREE.Mesh(tops.geometry(), new THREE.MeshLambertMaterial({ map: paintGround() }));
groundMesh.receiveShadow = true;
world.add(groundMesh);
{
  const walls = new THREE.Mesh(sides.geometry(), new THREE.MeshLambertMaterial({ map: paintBricks() }));
  walls.receiveShadow = walls.castShadow = true;
  world.add(walls);
}

// The water strip is part of the same chunk: a surface inside the chunk's outline, and
// where the chunk is cut, water all the way down.
{
  const water = new Mesher();
  for (let z = 0; z < Z; z++)
    for (let x = X - 2; x < GX; x++)
      water.quad(V3(wx(x), WATER_Y, wz(z)), V3(wx(x) + 1, WATER_Y, wz(z)), V3(wx(x) + 1, WATER_Y, wz(z) + 1), V3(wx(x), WATER_Y, wz(z) + 1), UPN, vary(pick(C.water), 0.01));
  const cut = (ax, az, bx, bz, n) => {
    const rows = 6;
    for (let k = 0; k < rows; k++) {
      const y1 = WATER_Y - ((WATER_Y - BASE_Y) * k) / rows, y0 = WATER_Y - ((WATER_Y - BASE_Y) * (k + 1)) / rows;
      water.quad(V3(ax, y0, az), V3(bx, y0, bz), V3(bx, y1, bz), V3(ax, y1, az), n, new THREE.Color('#2c4052').lerp(new THREE.Color('#16212c'), k / rows));
    }
  };
  cut(wx(GX), wz(0), wx(GX), wz(Z), V3(1, 0, 0));
  cut(wx(shoreEdge(FZ - 1)), wz(Z), wx(GX), wz(Z), V3(0, 0, 1));
  cut(wx(shoreEdge(0)), wz(0), wx(GX), wz(0), V3(0, 0, -1));
  const m = new THREE.Mesh(water.geometry(), vertexMat());
  m.receiveShadow = true;
  world.add(m);
}


// ---------- Props ----------
const props = new Mesher();         // lit, shadow-casting voxel props
const glowBits = new Mesher();      // light sources (unlit, always bright)
const fine = new Mesher();          // thin grass blades and flower stems (two-sided)
const leaves = new Mesher();        // tree and shrub foliage (sways in the wind)
// Spring colours for the foliage, one per leaf vertex alongside leaves.c: bushes come into
// flower and trees take fresh, lighter greens with some white and pink blossom. `springSpec`
// is set by whoever is about to call canopy().
const leafSpring = [], leafAutumn = [], leafWinter = [];
let leafMesh = null, snowCapMesh = null;
const AUTUMN_LEAF = [['#d9822b', '#e39a3a', '#c96a2a', '#eab04c'], ['#e8a33c', '#f0c055', '#d98a2e', '#c97a28'], ['#c95a2a', '#d9772e', '#b8492a', '#e39a3a']];
const SPRING_BLOOM = ['#d98fa6', '#ece4e2', '#b597c6', '#e4c86e', '#e39a7e', '#e7b3c3'];
let springSpec = null;
const reflections = new Mesher();   // light streaks on the water
// mark a whole cell as solid on the fine grid
const mark = (x, z) => { for (let j = z * F; j < (z + 1) * F; j++) for (let i = x * F; i < (x + 1) * F; i++) if (inF(i, j)) solidF[j][i] = 1; };
const cellCenter = (x, z) => V3(wx(x) + 0.5, cellHeight(x, z), wz(z) + 0.5);

// Trees: a thin trunk and a canopy of small leaf cubes, in a few different shapes.
const LEAF = [['#526530', '#637638', '#758842', '#8a9b4f'], ['#586932', '#6b7e41', '#7e8f4b', '#93a15d'],
  ['#4e5f35', '#5e723e', '#708549', '#829655']];
const PINE_LEAF = ['#384d32', '#415939', '#4c653f', '#5a724a'];
const BLOSSOM = [['#eae0db', '#f2e8e3', '#e4cccf', '#d8b8c3'], ['#f0e5e0', '#e9d2d8', '#dcbcc8', '#f5ede9']];
const BARK = ['#5c432e', '#4f3a29', '#654a32'];

// Leaf cubes scattered mostly near the surface of an ellipsoid, shaded lighter on top.
function canopy(cx, cy, cz, rx, ry, rz, pal, cube = 0.11) {
  const autumnPal = pick(AUTUMN_LEAF);
  const area = 4 * Math.PI * Math.pow((rx * ry + rx * rz + ry * rz) / 3, 1);
  const n = Math.min(260, Math.round((area / (cube * cube)) * 0.55));
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, u = rnd() * 2 - 1, k = 0.72 + rnd() * 0.28;
    const ux = Math.cos(a) * Math.sqrt(1 - u * u), uz = Math.sin(a) * Math.sqrt(1 - u * u);
    const px = cx + ux * rx * k, py = cy + u * ry * k, pz = cz + uz * rz * k;
    const light = (u + 1) / 2 + (rnd() - 0.5) * 0.3;
    const shade = pal[Math.max(0, Math.min(3, Math.floor(light * 4)))];
    const q = cube / 2;
    const base = vary(shade, 0.04);
    leaves.cube(Math.round(px / q) * q, Math.round(py / q) * q, Math.round(pz / q) * q, cube * (0.85 + rnd() * 0.35), base);
    let sp = base;
    if (springSpec) {
      if (springSpec.bloom && rnd() < springSpec.frac * (0.5 + light)) sp = vary(springSpec.bloom, 0.06);
      else if (springSpec.fresh) sp = base.clone().offsetHSL(0.025, 0.06, 0.05);
    }
    const au = vary(autumnPal[Math.max(0, Math.min(3, Math.floor(light * 4)))], 0.06);
    const wi = new THREE.Color('#aeb7c2').lerp(new THREE.Color('#f4f6f8'), Math.max(0, Math.min(1, light * 1.2))).offsetHSL(0, 0, (rnd() - 0.5) * 0.04);
    // keep each face's shading: scale the season colour by how the face differs from the base
    for (let k = leafSpring.length; k < leaves.c.length; k += 3) {
      const f = (leaves.c[k] + leaves.c[k + 1] + leaves.c[k + 2]) / Math.max(1e-4, base.r + base.g + base.b);
      leafSpring.push(sp.r * f, sp.g * f, sp.b * f);
      leafAutumn.push(au.r * f, au.g * f, au.b * f);
      leafWinter.push(wi.r * Math.min(f, 1.15), wi.g * Math.min(f, 1.15), wi.b * Math.min(f, 1.15));
    }
  }
}
function trunk(cx, cy, cz, h, w = 0.035) {
  const bark = pick(BARK);
  props.box(cx - w, cy, cz - w, cx + w, cy + h, cz + w, vary(bark, 0.04));
  return bark;
}
function tree(cx, cy, cz, forceBlossom = false) {
  const kind = forceBlossom ? rnd() * 0.34 : rnd(), blossom = forceBlossom || rnd() < 0.2;
  // spring trees: most come into blossom or bright new leaf, each in its own colour
  const kindS = rnd();
  springSpec = blossom ? null
    : kindS < 0.2 ? { fresh: true, bloom: '#f1ebe8', frac: 0.6 }                 // white blossom
    : kindS < 0.38 ? { fresh: true, bloom: pick(['#e9b9c6', '#e3a6b8']), frac: 0.6 }   // pink cherry
    : kindS < 0.5 ? { fresh: true, bloom: '#c76f98', frac: 0.55 }                // redbud magenta
    : kindS < 0.6 ? { fresh: true, bloom: '#a99ad0', frac: 0.5 }                 // lilac / jacaranda
    : kindS < 0.7 ? { fresh: true, bloom: '#e7cf62', frac: 0.45 }                // yellow catkins
    : kindS < 0.85 ? { fresh: true, bloom: '#a8c45a', frac: 0.7 }                // bright new chartreuse leaf
    : { fresh: true, bloom: null, frac: 0 };
  const pal = blossom ? pick(BLOSSOM) : pick(LEAF);
  if (kind < 0.34) {                       // round
    const h = 0.55 + rnd() * 0.35, r = 0.3 + rnd() * 0.14;
    trunk(cx, cy, cz, h + r * 0.6);
    canopy(cx, cy + h + r * 0.75, cz, r, r * (1 + rnd() * 0.2), r, pal);
  } else if (kind < 0.54) {                // tall and narrow
    const h = 0.3 + rnd() * 0.2, r = 0.17 + rnd() * 0.06, ry = 0.55 + rnd() * 0.3;
    trunk(cx, cy, cz, h + ry, 0.03);
    canopy(cx, cy + h + ry, cz, r, ry, r, blossom ? pal : pick(LEAF), 0.09);
  } else if (kind < 0.68) {                // young tree
    const h = 0.35 + rnd() * 0.2, r = 0.16 + rnd() * 0.07;
    trunk(cx, cy, cz, h + r * 0.5, 0.025);
    canopy(cx, cy + h + r * 0.8, cz, r, r * 1.1, r, pal, 0.08);
  } else if (kind < 0.84) {                // low and spreading, with two limbs
    const h = 0.55 + rnd() * 0.25, rx = 0.42 + rnd() * 0.12, rz = 0.36 + rnd() * 0.1, ry = 0.22 + rnd() * 0.06;
    const bark = trunk(cx, cy, cz, h + 0.1, 0.04);
    props.box(cx, cy + h - 0.05, cz - 0.02, cx + 0.22, cy + h, cz + 0.02, vary(bark, 0.04));
    props.box(cx - 0.2, cy + h, cz - 0.02, cx, cy + h + 0.05, cz + 0.02, vary(bark, 0.04));
    canopy(cx, cy + h + ry * 0.8, cz, rx, ry, rz, pal);
  } else {                                 // pine: stacked tiers that narrow toward the top
    const h = 0.25 + rnd() * 0.1, tiers = 4 + Math.floor(rnd() * 2), base = 0.32 + rnd() * 0.08;
    trunk(cx, cy, cz, h + tiers * 0.2, 0.03);
    for (let t = 0; t < tiers; t++) {
      const r = base * (1 - t / (tiers + 0.5));
      canopy(cx, cy + h + 0.12 + t * 0.2, cz, r, 0.1, r, PINE_LEAF, 0.08);
    }
    props.cube(cx, cy + h + 0.12 + tiers * 0.2, cz, 0.07, col(PINE_LEAF[3]));
  }
}

// (tree() leaves springSpec set; the next caller sets its own)
// A paper-thin blade: two crossed vertical quads (cheap, and reads as a thin stalk).
function blade(x, y, z, h, w, color, lean = 0) {
  const lx = lean * Math.cos(x * 7.1 + z * 3.3), lz = lean * Math.sin(x * 5.7 + z * 2.9);
  for (const [dx, dz] of [[w, 0], [0, w]]) {
    fine.quadBoth(V3(x - dx, y, z - dz), V3(x + dx, y, z + dz), V3(x + dx + lx, y + h, z + dz + lz), V3(x - dx + lx, y + h, z - dz + lz), UPN, color);
  }
}
// Flowers: hair-thin stems with tiny blooms, in loose clusters.
const FLOWER = ['#d88aa5', '#efe7e3', '#a985b8', '#e8ca8c', '#e6a0b4', '#f2dfe6'];
function flowers(cx, cy, cz, n = 10) {
  const bloom = pick(FLOWER), spread = 0.2 + rnd() * 0.2;
  const ox = cx + (rnd() - 0.5) * 0.3, oz = cz + (rnd() - 0.5) * 0.3;
  for (let i = 0; i < n; i++) {
    const fx = ox + (rnd() - 0.5) * spread * 2, fz = oz + (rnd() - 0.5) * spread * 2, h = 0.06 + rnd() * 0.07;
    blade(fx, cy, fz, h, 0.006, vary('#526530', 0.06), 0.01);
    const c = vary(rnd() < 0.85 ? bloom : pick(FLOWER), 0.04), b = 0.022 + rnd() * 0.012;
    props.box(fx - b / 2, cy + h, fz - b / 2, fx + b / 2, cy + h + b * 0.8, fz + b / 2, c);
  }
}
// Shrubs: a low mound of small leaf cubes, sometimes flowering.
const SHRUB = [['#495d34', '#59703d', '#6b8245', '#7e924f'], ['#515f36', '#637140', '#75844a', '#889657']];
function shrub(px, py, pz, size = 1) {
  const r = (0.16 + rnd() * 0.1) * size, pal = pick(SHRUB);
  springSpec = { bloom: pick(SPRING_BLOOM), frac: 0.4, fresh: true };
  canopy(px, py + r * 0.55, pz, r, r * 0.65, r * (0.8 + rnd() * 0.4), pal, 0.07);
  if (rnd() < 0.35) {
    const bloom = pick(FLOWER);
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2;
      props.cube(px + Math.cos(a) * r * 0.8, py + r * (0.6 + rnd() * 0.5), pz + Math.sin(a) * r * 0.8, 0.035, vary(bloom, 0.04));
    }
  }
}
function rock(px, py, pz) {
  const s = 0.05 + rnd() * 0.07;
  props.box(px - s, py, pz - s * 0.8, px + s, py + s * 0.9, pz + s * 0.8, vary(pick(['#908375', '#817466', '#9d9184']), 0.05));
  if (rnd() < 0.5) props.cube(px + s * 0.9, py + s * 0.3, pz + s * 0.4, s * 0.8, vary('#897c6e', 0.05));
}
// Low clipped hedge along a line (cell units), on whatever level it stands.
function hedge(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  for (let t = 0; t <= len; t += 0.11) {
    const x = ax + ((bx - ax) * t) / len, z = az + ((bz - az) * t) / len, i = Math.floor(x * F), j = Math.floor(z * F);
    if (!inF(i, j) || pathF[j][i] === 1 || stairF[j][i]) continue;
    const y = Hf[j][i];
    for (let h = 0; h < 3; h++) props.cube(wx(x) + (rnd() - 0.5) * 0.03, y + 0.06 + h * 0.09, wz(z) + (rnd() - 0.5) * 0.03, 0.12, vary(pick(SHRUB[1]), 0.04));
    solidF[j][i] = 1;
  }
}

// Grass: small tufts of thin blades of varying height, wherever there's grass in a cell.
function tufts(x, z) {
  const n = 5 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) {
    const cx = x + rnd(), cz = z + rnd(), i = Math.floor(cx * F), j = Math.floor(cz * F);
    if (!inF(i, j) || !land[j][i] || pathF[j][i] || stairF[j][i] || lotF[j][i]) continue;
    const shade = pick(['#4b5c2f', '#566a35', '#63773c', '#42542b']);
    for (let b = 0; b < 3; b++)
      blade(wx(cx) + (rnd() - 0.5) * 0.04, Hf[j][i], wz(cz) + (rnd() - 0.5) * 0.04, 0.04 + rnd() * 0.08, 0.008, vary(shade, 0.05), 0.02);
  }
}

// A light's reflection: dashes running down-screen (toward +x+z) on the water.
function reflect(px, pz, len) {
  const d = V3(1, 0, 1).normalize(), side = V3(1, 0, -1).normalize();
  for (let s = 0.15; s < len; s += 0.14) {
    const w = 0.035 * (1 - s / len) + 0.01, c = V3(px, WATER_Y + 0.005, pz).addScaledVector(d, s + 0.5);
    const a = c.clone().addScaledVector(side, -w), b = c.clone().addScaledVector(side, w), e = d.clone().multiplyScalar(0.07);
    reflections.quad(a, b, b.clone().add(e), a.clone().add(e), UPN, col(rnd() < 0.5 ? '#ed9b54' : '#ce823f'));
  }
}
// Bollard lights: a dark post with a glowing top (reflected in the water if close to it).
function bollard(px, py, pz) {
  props.box(px - 0.05, py, pz - 0.05, px + 0.05, py + 0.28, pz + 0.05, col('#2e2821'));
  glowBits.box(px - 0.055, py + 0.28, pz - 0.055, px + 0.055, py + 0.36, pz + 0.055, col('#ffc78a'));
  props.box(px - 0.06, py + 0.36, pz - 0.06, px + 0.06, py + 0.4, pz + 0.06, col('#2e2821'));
  if (px > wx(shore(pz + Z / 2)) - 0.6) reflect(px, pz, 0.45 + rnd() * 0.5);
}
const pointLights = [];
function addLight(px, py, pz, intensity = 2.2) {
  const l = new THREE.PointLight('#ffa85c', intensity, 4.5, 2);
  l.position.set(px, py, pz);
  l.userData.base = intensity;
  world.add(l);
  pointLights.push(l);
}

function bench(x, z, alongX = true) {
  const c = cellCenter(x, z), w = alongX ? [0.4, 0.12] : [0.12, 0.4];
  props.box(c.x - w[0], c.y + 0.18, c.z - w[1], c.x + w[0], c.y + 0.24, c.z + w[1], vary(C.wood[0], 0.03));
  for (const s of [-1, 1]) {
    const lx = alongX ? c.x + s * (w[0] - 0.06) : c.x, lz = alongX ? c.z : c.z + s * (w[1] - 0.06);
    props.box(lx - 0.04, c.y, lz - 0.08, lx + 0.04, c.y + 0.18, lz + 0.08, col('#3e2f21'));
  }
  mark(x, z);
}


// The pier: planks laid across a narrow deck, posts down into the water, a lamp at the end.
// An invisible surface over the pier's deck, so clicks on the pier count as places to walk.
const pierPick = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
function dock() {
  const x0 = fx(PIER.i0), x1 = fx(PIER.i1), z0 = fz(PIER.j0), z1 = fz(PIER.j1), y = 0.04;
  for (let x = x0; x < x1 - 0.01; x += 0.17)
    props.box(x + 0.012, y - 0.07, z0, Math.min(x1, x + 0.17) - 0.012, y, z1, vary(pick(C.wood), 0.06));
  props.box(x0, y - 0.11, z0 + 0.02, x1, y - 0.07, z0 + 0.08, col('#4c3622'));   // stringers under the planks
  props.box(x0, y - 0.11, z1 - 0.08, x1, y - 0.07, z1 - 0.02, col('#4c3622'));
  for (let x = x1 - 0.1; x > x0 + 0.6; x -= 0.85)
    for (const pz of [z0 + 0.06, z1 - 0.06]) props.box(x - 0.05, WATER_Y - 0.15, pz - 0.05, x + 0.05, y - 0.07, pz + 0.05, col('#4c3622'));
  bollard(x1 - 0.1, y, z1 - 0.1);
  pierPick.scale.set(x1 - x0, 1, z1 - z0);
  pierPick.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  world.add(pierPick);
  addLight(x1 - 0.3, 0.6, (z0 + z1) / 2, 2.2);
}

// Sailboats: a tapered hull with a pale trim line, a deck and small cabin, a tall mast with
// a narrow mainsail on a boom, and a slim jib. Bow points along +x.
const boats = [];
function sailboat(px, pz, scale = 1) {
  const m = new Mesher(), L = 1.5;
  for (let k = 0; k < 30; k++) {
    const t0 = k / 30, t1 = (k + 1) / 30, t = (t0 + t1) / 2;
    const w = 0.17 * Math.sqrt(Math.max(0.02, 1 - Math.pow(t, 2.6))) * (0.9 + 0.1 * (1 - t));
    const xa = -L / 2 + t0 * L, xb = -L / 2 + t1 * L, lift = 0.05 * Math.pow(t, 3);   // the bow rises a little
    m.box(xa, 0.02, -w * 0.75, xb, 0.08, w * 0.75, col('#3e2a1c'));                       // below the waterline
    m.box(xa, 0.08, -w, xb, 0.17 + lift, w, vary('#7b5031', 0.03));                      // topsides
    m.box(xa, 0.17 + lift, -w - 0.002, xb, 0.19 + lift, w + 0.002, col('#ddd3c4'));       // trim line
    if (w > 0.05) m.box(xa, 0.19 + lift, -w + 0.02, xb, 0.2 + lift, w - 0.02, vary('#a57a52', 0.03)); // deck
  }
  m.box(-0.42, 0.2, -0.09, -0.08, 0.31, 0.09, col('#d8cec0'));                           // cabin
  m.box(-0.4, 0.31, -0.08, -0.1, 0.33, 0.08, col('#8b6a4b'));
  const MX = 0.08, TOP = 2.3;
  m.box(MX - 0.018, 0.2, -0.018, MX + 0.018, TOP, 0.018, col('#3a2a1e'));                // mast
  m.box(MX - 0.68, 0.44, -0.012, MX, 0.47, 0.012, col('#3a2a1e'));                        // boom
  for (let y = 0.48; y < TOP - 0.06; y += 0.04) {                                           // mainsail
    const w = 0.66 * (1 - (y - 0.48) / (TOP - 0.48)), shade = 0.02 * Math.sin(y * 6);
    m.box(MX - 0.02 - w, y, -0.006, MX - 0.02, y + 0.04, 0.006, new THREE.Color('#ece5da').offsetHSL(0, 0, shade - (y - 0.48) * 0.015));
  }
  const JT = TOP - 0.35, BOW = L / 2 - 0.04;
  for (let y = 0.3; y < JT - 0.05; y += 0.04) {                                             // jib
    const xf = BOW - ((y - 0.3) / (JT - 0.3)) * (BOW - MX - 0.04);
    if (xf - (MX + 0.04) < 0.02) break;
    m.box(MX + 0.04, y, -0.005, xf, y + 0.04, 0.005, new THREE.Color('#e4dccf').offsetHSL(0, 0, -(y - 0.3) * 0.012));
  }
  const g = new THREE.Mesh(m.geometry(), vertexMat());
  g.castShadow = true;
  g.scale.setScalar(scale);
  g.position.set(px, WATER_Y, pz);
  g.rotation.y = Math.PI / 4;   // side-on to the camera
  world.add(g);
  boats.push({ g, phase: rnd() * 6 });
}


// ---------- Buildings (voxels) ----------
const VS = 1 / 16;
class VoxelModel {
  constructor() { this.v = new Map(); }
  key(x, y, z) { return ((x + 128) * 512 + (y + 128)) * 512 + (z + 128); }
  set(x, y, z, c) { this.v.set(this.key(x, y, z), { x, y, z, c }); }
  del(x, y, z) { this.v.delete(this.key(x, y, z)); }
  has(x, y, z) { return this.v.has(this.key(x, y, z)); }
  fill(x0, y0, z0, x1, y1, z1, c) {   // inclusive bounds; `c` may be a function (x, y, z) => colour
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  }
  // Mesh with ambient occlusion into `out` (a Mesher), placed at world origin `o`.
  mesh(out, o, solidFor = this, ao = true) {
    if (out === voxSolid && hoverMesher) this.mesh(hoverMesher, o, solidFor, false);   // a copy per building, for its hover outline
    const AO = [0.52, 0.68, 0.84, 1];
    const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const occ = (x, y, z) => (solidFor.has(x, y, z) ? 1 : 0);
    for (const { x, y, z, c } of this.v.values()) {
      // in winter every exposed top of a building carries a thin layer of snow
      if (out === voxSolid && !solidFor.has(x, y + 1, z) && !this.has(x, y + 1, z)) {
        const x0 = o.x + x * VS, y0 = o.y + (y + 1) * VS, z0 = o.z + z * VS, k = 0.94 + Math.random() * 0.06;
        snowCaps.box(x0 - VS * 0.04, y0, z0 - VS * 0.04, x0 + VS * 1.04, y0 + VS * 0.45, z0 + VS * 1.04, new THREE.Color(0.93 * k, 0.95 * k, 0.98 * k));
      }
      for (const [nx, ny, nz] of DIRS) {
        if (solidFor.has(x + nx, y + ny, z + nz) || this.has(x + nx, y + ny, z + nz)) continue;
        // the two tangent axes of this face
        const t1 = nx ? [0, 1, 0] : [1, 0, 0], t2 = nz ? [0, 1, 0] : ny ? [0, 0, 1] : [0, 0, 1];
        const px = x + nx, py = y + ny, pz = z + nz;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
          let f = 1;
          if (ao) {
            const s1 = occ(px + t1[0] * a, py + t1[1] * a, pz + t1[2] * a), s2 = occ(px + t2[0] * b, py + t2[1] * b, pz + t2[2] * b);
            const cr = occ(px + t1[0] * a + t2[0] * b, py + t1[1] * a + t2[1] * b, pz + t1[2] * a + t2[2] * b);
            f = AO[s1 && s2 ? 0 : 3 - (s1 + s2 + cr)];
          }
          // corner position: voxel centre + half-steps along normal and tangents
          const cx = x + 0.5 + nx * 0.5 + (t1[0] * a + t2[0] * b) * 0.5;
          const cy = y + 0.5 + ny * 0.5 + (t1[1] * a + t2[1] * b) * 0.5;
          const cz = z + 0.5 + nz * 0.5 + (t1[2] * a + t2[2] * b) * 0.5;
          return { p: V3(o.x + cx * VS, o.y + cy * VS, o.z + cz * VS), f };
        });
        const n = V3(nx, ny, nz);
        // flip the diagonal so AO interpolates evenly
        const order = corners[0].f + corners[2].f > corners[1].f + corners[3].f ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
        const ab = V3(0, 0, 0).subVectors(corners[order[1]].p, corners[order[0]].p), ac = V3(0, 0, 0).subVectors(corners[order[2]].p, corners[order[0]].p);
        const flip = ab.cross(ac).dot(n) < 0;
        const tri = flip ? [order[0], order[2], order[1], order[3], order[5], order[4]] : order;
        for (const k of tri) {
          const q = corners[k];
          out.p.push(q.p.x, q.p.y, q.p.z); out.n.push(nx, ny, nz);
          out.c.push(c.r * q.f, c.g * q.f, c.b * q.f);
        }
      }
    }
  }
}
const voxSolid = new Mesher(), voxGlow = new Mesher(), snowCaps = new Mesher();
let hoverMesher = null;
const tint = (hex, r, amt = 0.035) => new THREE.Color(hex).offsetHSL(0, 0, (r() - 0.5) * amt * 2);

// After UW's Suzzallo Library (from photos of the Red Square facade): a wide, fairly low
// Collegiate Gothic block. The ground floor is a pale stone arcade of pointed arches, with
// three entrance arches under little gables in the middle and broad steps in front. Above
// it, orange-tan brick with tall narrow pointed windows and stone tracery between thin stone
// pilasters that rise into pinnacles over an openwork stone parapet; stone corner turrets;
// and a big steep hipped roof of sage-green slate with copper cresting. Faces +z.
function suzzallo(lot) {
  const r = mulberry32(1926), m = new VoxelModel(), glow = new VoxelModel();
  const TW = lot.w * 16 - 4, TD = lot.d * 16 - 10;
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], BRICK = ['#7e5e4c', '#765746', '#866553', '#6f5242'];
  const SLATE = ['#7a838c', '#78818a', '#7c858e', '#79828b'], CREST = '#525b64', GLASS = ['#2f3437', '#363c40', '#3b4246'];
  const stone = (a = 0.02) => tint(STONE[Math.floor(r() * STONE.length)], r, a);
  const brick = (x, y) => tint(BRICK[(x * 7 + y * 3) % BRICK.length], r, 0.02).offsetHSL(0, 0, y % 2 ? -0.012 : 0);
  const GF = 15, WT = 38, PAR = 3;               // ground-floor top, wall top, parapet height
  const C = 4;                                    // corner turret width
  // faces of the main block: u along the face (from the left as seen from outside), v up,
  // d outward (0 = surface layer, -1 = recessed)
  const faces = {
    '+z': { len: TW, at: (u, v, d) => [u, v, TD - 1 + d] },
    '+x': { len: TD, at: (u, v, d) => [TW - 1 + d, v, TD - 1 - u] },
    '-x': { len: TD, at: (u, v, d) => [-d, v, u] },
    '-z': { len: TW, at: (u, v, d) => [TW - 1 - u, v, -d] },
  };
  const put = (F, u, v, d, c, mod = m) => mod.set(...F.at(u, v, d), c);
  const del = (F, u, v, d) => m.del(...F.at(u, v, d));
  // body
  m.fill(0, 0, 0, TW - 1, GF - 1, TD - 1, () => stone());
  m.fill(0, GF, 0, TW - 1, WT - 1, TD - 1, (x, y) => brick(x, y));
  for (const [name, F] of Object.entries(faces)) {
    const L = F.len, bays = Math.round((L - 2 * C) / 6), bw = (L - 2 * C) / bays;
    // stone string course at the top of the ground floor and a cornice under the parapet
    for (let u = 0; u < L; u++) { put(F, u, GF, 1, stone()); put(F, u, GF + 1, 0, stone()); put(F, u, WT - 1, 1, stone()); }
    for (let b = 0; b < bays; b++) {
      const u0 = Math.round(C + b * bw), cu = Math.round(C + (b + 0.5) * bw);
      // --- ground floor: a pointed arch, recessed, with a traceried window (or a door)
      const mid = name === '+z' && Math.abs(b - (bays - 1) / 2) <= 1;
      const a0 = cu - 2, a1 = cu + 2, top = 12;
      for (let v = 2; v <= top; v++) {
        const inset = v > top - 3 ? v - (top - 3) : 0;
        for (let u = a0 + inset; u <= a1 - inset; u++) {
          del(F, u, v, 0);
          if (mid) put(F, u, v, -1, v < 10 ? tint('#3a2b22', r, 0.02) : tint(GLASS[1], r));
          else put(F, u, v, -1, u === cu || v === 7 ? stone() : tint(GLASS[Math.floor(r() * 3)], r));
        }
      }
      for (let v = 1; v <= top + 1; v++) { put(F, a0 - 1, v, 1, stone(0.03)); put(F, a1 + 1, v, 1, stone(0.03)); }   // arch mouldings / piers
      put(F, cu, top + 1, 1, stone()); put(F, cu - 1, top, 1, stone()); put(F, cu + 1, top, 1, stone());
      if (mid) {   // little gable over each entrance
        for (let k = 0; k < 4; k++) for (let u = cu - 3 + k; u <= cu + 3 - k; u++) put(F, u, top + 1 + k, 2, stone());
        put(F, cu, top + 5, 2, stone());
      }
      // --- upper floor: a tall narrow pointed window with tracery, framed in stone
      const w0 = cu - 1, w1 = cu + 1, wt = WT - 4;
      for (let v = GF + 3; v <= wt; v++) {
        const tip = v === wt;
        for (let u = w0; u <= w1; u++) {
          if (tip && u !== cu) continue;
          del(F, u, v, 0);
          const tracery = u === cu || v === GF + 11 || (v >= wt - 3 && (v - wt) % 2 === 0);
          put(F, u, v, -1, tracery ? stone() : tint(GLASS[Math.floor(r() * 3)], r));
        }
      }
      put(F, cu - 1, wt, 0, stone()); put(F, cu + 1, wt, 0, stone()); put(F, cu, wt + 1, 0, stone());   // stone arch head
      for (let u = w0 - 1; u <= w1 + 1; u++) put(F, u, GF + 2, 1, stone());   // sill
      // a thin stone pilaster at the start of each bay, rising into a pinnacle over the parapet
      if (b > 0) {
        for (let v = GF; v < WT + PAR + 2; v++) put(F, u0, v, v < WT ? 1 : 0, stone());
      }
    }
    // openwork stone parapet along the top of the wall
    for (let u = 0; u < L; u++) { put(F, u, WT, 0, stone()); put(F, u, WT + PAR - 1, 0, stone()); if (u % 2 === 0) put(F, u, WT + 1, 0, stone()); }
  }
  // stone corner turrets with pinnacles
  for (const [x0, z0] of [[0, 0], [TW - C, 0], [0, TD - C], [TW - C, TD - C]]) {
    m.fill(x0 - 1, 0, z0 - 1, x0 + C, WT + PAR + 2, z0 + C, () => stone());
    for (let y = WT + PAR + 3, k = 0; k < 5; y++, k++) { const t = Math.floor(k / 2); m.fill(x0 + t, y, z0 + t, x0 + C - 1 - t, y, z0 + C - 1 - t, () => stone()); }
  }
  // big steep hipped roof of sage-green slate, copper cresting on the ridge
  for (let k = 0; ; k++) {
    const x0 = 1 + k, x1 = TW - 2 - k, z0 = 1 + k, z1 = TD - 2 - k;
    if (z1 < z0) break;
    m.fill(x0, WT + 1 + k, z0, x1, WT + 1 + k, z1, (x, y, z) => tint(SLATE[Math.floor(r() * SLATE.length)], r, 0.008).offsetHSL(0, 0, k % 2 ? -0.025 : 0));
    if (z1 - z0 <= 1) { for (let x = x0; x <= x1; x++) { m.set(x, WT + 2 + k, z0, new THREE.Color(CREST)); if (x % 2 === 0) m.set(x, WT + 3 + k, z0, new THREE.Color(CREST)); } break; }
  }
  // broad steps across the middle of the front, and a low terrace wall
  const fz = TD - 1, cx = Math.round(TW / 2);
  for (let k = 0; k < 3; k++) for (let x = cx - 14 + k * 2; x <= cx + 14 - k * 2; x++) for (let z = fz + 1; z <= fz + 4 - k; z++) m.set(x, k, z, stone());
  for (const side of [-1, 1]) for (let x = side < 0 ? 1 : cx + 16; x < (side < 0 ? cx - 15 : TW - 1); x++) { m.set(x, 0, fz + 3, stone()); m.set(x, 1, fz + 3, stone()); m.set(x, 2, fz + 3, x % 3 ? stone() : stone()); }
  const origin = V3(wx(lot.x0 + lot.w / 2) - (TW * VS) / 2, lot.level, wz(lot.z0 + lot.d / 2) - ((TD + 4) * VS) / 2);
  m.mesh(voxSolid, origin);
  glow.mesh(voxGlow, origin, m, false);
  for (const fx of [0.38, 0.5, 0.62]) addLight(origin.x + TW * VS * fx, lot.level + 0.9, origin.z + (TD + 5) * VS, 1.4);
}
// An office block in the library's palette: a pale stone ground floor with tall shop-front
// windows and a central entrance under a sage-green canopy; three brick floors above with
// regular stone-framed windows and stone bands between floors; stone quoins at the corners;
// a stone cornice and parapet; a flat roof with a sage plant room. Faces +z.
// A smaller library in Suzzallo's style: the same stone ground floor with pointed arches,
// brick upper floor with tall traceried windows, openwork parapet and slate hipped roof, but
// shorter, with stone quoins instead of turrets and a classical portico in front: four
// stone columns on a stepped base carrying an entablature and a pediment. Built facing +z,
// then turned to face +x so it doesn't face the same way as the other two.
function portico(lot) {
  const r = mulberry32(1891), m = new VoxelModel(), glow = new VoxelModel();
  const TW = lot.d * 16 - 4, TD = lot.w * 16 - 20;
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], BRICK = ['#7e5e4c', '#765746', '#866553', '#6f5242'];
  const SLATE = ['#626a73', '#606871', '#646c75', '#616972'], CREST = '#434a52', GLASS = ['#2f3437', '#363c40', '#3b4246'];
  const stone = (a = 0.02) => tint(STONE[Math.floor(r() * STONE.length)], r, a);
  const brick = (x, y) => tint(BRICK[(x * 7 + y * 3) % BRICK.length], r, 0.02).offsetHSL(0, 0, y % 2 ? -0.012 : 0);
  const slate = (k = 0) => tint(SLATE[Math.floor(r() * SLATE.length)], r, 0.008).offsetHSL(0, 0, k % 2 ? -0.025 : 0);
  const GF = 13, WT = 30, PAR = 3, Q = 4;   // Q: corner turret width
  const faces = {
    '+z': { len: TW, at: (u, v, d) => [u, v, TD - 1 + d] },
    '+x': { len: TD, at: (u, v, d) => [TW - 1 + d, v, TD - 1 - u] },
    '-x': { len: TD, at: (u, v, d) => [-d, v, u] },
    '-z': { len: TW, at: (u, v, d) => [TW - 1 - u, v, -d] },
  };
  const put = (F, u, v, d, c, mod = m) => mod.set(...F.at(u, v, d), c);
  const del = (F, u, v, d) => m.del(...F.at(u, v, d));
  const cx = Math.round(TW / 2), PW = 36, px0 = cx - PW / 2, px1 = cx + PW / 2 - 1;   // portico span
  m.fill(0, 0, 0, TW - 1, GF - 1, TD - 1, () => stone());
  m.fill(0, GF, 0, TW - 1, WT - 1, TD - 1, (x, y) => brick(x, y));
  for (const [name, F] of Object.entries(faces)) {
    const L = F.len, bays = Math.round((L - 2 * Q) / 7), bw = (L - 2 * Q) / bays;
    for (let u = 0; u < L; u++) { put(F, u, GF, 1, stone()); put(F, u, GF + 1, 0, stone()); put(F, u, WT - 1, 1, stone()); }
    for (let b = 0; b < bays; b++) {
      const cu = Math.round(Q + (b + 0.5) * bw);
      const door = name === '+z' && Math.abs(cu - cx) < bw / 2;
      // ground floor: a pointed arch with a traceried window, or the doors behind the portico
      const a0 = cu - 2, a1 = cu + 2, top = 11;
      for (let v = 2; v <= top; v++) {
        const inset = v > top - 3 ? v - (top - 3) : 0;
        for (let u = a0 + inset; u <= a1 - inset; u++) {
          del(F, u, v, 0);
          if (door) put(F, u, v, -1, v < 9 ? tint('#3a2b22', r, 0.02) : tint(GLASS[1], r));
          else put(F, u, v, -1, u === cu || v === 7 ? stone() : tint(GLASS[Math.floor(r() * 3)], r));
        }
      }
      for (let v = 1; v <= top + 1; v++) { put(F, a0 - 1, v, 1, stone(0.03)); put(F, a1 + 1, v, 1, stone(0.03)); }
      put(F, cu, top + 1, 1, stone()); put(F, cu - 1, top, 1, stone()); put(F, cu + 1, top, 1, stone());
      // upper floor: a tall narrow pointed window with tracery, framed in stone
      const w0 = cu - 1, w1 = cu + 1, wt = WT - 4;
      for (let v = GF + 3; v <= wt; v++) {
        const tip = v === wt;
        for (let u = w0; u <= w1; u++) {
          if (tip && u !== cu) continue;
          del(F, u, v, 0);
          const tracery = u === cu || v === GF + 10 || (v >= wt - 3 && (v - wt) % 2 === 0);
          const lit = !tracery && r() < 0.3;
          put(F, u, v, -1, tracery ? stone() : lit ? tint('#f2c27e', r, 0.02) : tint(GLASS[Math.floor(r() * 3)], r), lit ? glow : m);
          if (lit) m.del(...F.at(u, v, -1));
        }
      }
      put(F, cu - 1, wt, 0, stone()); put(F, cu + 1, wt, 0, stone()); put(F, cu, wt + 1, 0, stone());
      for (let u = w0 - 1; u <= w1 + 1; u++) put(F, u, GF + 2, 1, stone());
      // a thin stone pilaster between bays, rising into a pinnacle over the parapet
      const u0 = Math.round(Q + b * bw);
      if (b > 0 && !(name === '+z' && u0 > px0 - 2 && u0 < px1 + 2)) for (let v = GF; v < WT + PAR + 2; v++) put(F, u0, v, v < WT ? 1 : 0, stone());
    }
    for (let u = 0; u < L; u++) { put(F, u, WT, 0, stone()); put(F, u, WT + PAR - 1, 0, stone()); if (u % 2 === 0) put(F, u, WT + 1, 0, stone()); }
  }
  // stone corner turrets with stepped pinnacles
  for (const [x0, z0] of [[0, 0], [TW - Q, 0], [0, TD - Q], [TW - Q, TD - Q]]) {
    m.fill(x0 - 1, 0, z0 - 1, x0 + Q, WT + PAR + 1, z0 + Q, () => stone());
    for (let y = WT + PAR + 2, k = 0; k < 5; y++, k++) { const t = Math.floor(k / 2); m.fill(x0 + t, y, z0 + t, x0 + Q - 1 - t, y, z0 + Q - 1 - t, () => stone()); }
  }
  // slate hipped roof with cresting on the ridge, as on Suzzallo
  for (let k = 0; ; k++) {
    const x0 = 1 + k, x1 = TW - 2 - k, z0 = 1 + k, z1 = TD - 2 - k;
    if (z1 < z0) break;
    m.fill(x0, WT + 1 + k, z0, x1, WT + 1 + k, z1, () => slate(k));
    if (z1 - z0 <= 1) { for (let x = x0; x <= x1; x++) { m.set(x, WT + 2 + k, z0, new THREE.Color(CREST)); if (x % 2 === 0) m.set(x, WT + 3 + k, z0, new THREE.Color(CREST)); } break; }
  }
  // the portico: a stepped stone base, four columns, an entablature and a pediment
  const PD = 8, fz = TD + PD - 1, ET = WT - 10;   // portico depth, front row, entablature bottom
  for (let k = 0; k < 3; k++) m.fill(px0 - 3 + k, 0, TD, px1 + 3 - k, k, fz + 3 - k, () => stone());
  const colZ = fz - 2;
  for (let n = 0; n < 4; n++) {
    const c = Math.round(px0 + 3 + n * (PW - 7) / 3);
    m.fill(c - 2, 3, colZ - 2, c + 2, 3, colZ + 2, () => stone());                    // base
    m.fill(c - 1, 4, colZ - 1, c + 1, ET - 2, colZ + 1, (x, y, z) => tint(STONE[(x === c || z === colZ) ? 2 : 1], r, 0.012));   // fluted shaft
    for (let y = 4; y < ET - 1; y += 1) for (const [dx, dz] of [[0, -2], [0, 2], [-2, 0], [2, 0]]) m.set(c + dx, y, colZ + dz, tint(STONE[1], r, 0.012));   // round it out
    m.fill(c - 2, ET - 1, colZ - 2, c + 2, ET - 1, colZ + 2, () => stone());           // capital
  }
  m.fill(px0, ET, TD, px1, ET + 2, fz, () => stone());                                  // entablature
  for (let x = px0 - 1; x <= px1 + 1; x++) m.set(x, ET + 3, fz + 1, stone());           // cornice
  for (let z = TD; z <= fz + 1; z++) { m.set(px0 - 1, ET + 3, z, stone()); m.set(px1 + 1, ET + 3, z, stone()); }
  for (let k = 0; ; k++) {                                                               // pediment, slate-roofed
    const x0 = px0 - 1 + 2 * k, x1 = px1 + 1 - 2 * k;
    if (x1 < x0) break;
    for (let x = x0; x <= x1; x++) for (let z = TD - 2; z <= fz + 1; z++) {
      const edge = x <= x0 + 1 || x >= x1 - 1;
      m.set(x, ET + 4 + k, z, z >= fz ? (edge && z === fz + 1 ? stone() : z === fz + 1 ? stone() : stone(0.01)) : edge ? slate(k) : slate(k));
    }
  }
  // a round window in the pediment, stone ornaments on its apex and ends
  const tymY = ET + 7;
  for (let x = cx - 3; x <= cx + 3; x++) for (let y = tymY - 3; y <= tymY + 3; y++) {
    const d = Math.hypot(x - cx + 0.5, y - tymY);
    if (d < 1.8) { m.set(x, y, fz + 1, tint(GLASS[1], r)); }
    else if (d < 2.9) m.set(x, y, fz + 2, stone());
  }
  let apex = ET + 4; while (m.has(cx, apex + 1, fz + 1)) apex++;
  m.fill(cx - 1, apex + 1, fz, cx, apex + 2, fz + 1, () => stone()); m.set(cx, apex + 3, fz, stone());
  for (const x of [px0 - 1, px1]) m.fill(x, ET + 4, fz, x + 1, ET + 6, fz + 1, () => stone());
  // lanterns on stone posts at each end of the steps
  for (const x of [px0 - 5, px1 + 5]) { m.fill(x, 0, fz + 2, x, 4, fz + 2, () => stone()); glow.set(x, 5, fz + 2, new THREE.Color('#ffd38a')); }
  // turn a quarter so the front (+z) faces +x: (x, y, z) -> (z, y, TW - 1 - x)
  const turn = (src) => { const out = new VoxelModel(); for (const { x, y, z, c } of src.v.values()) out.set(z, y, TW - 1 - x, c); return out; };
  const mt = turn(m), gt = turn(glow);
  const origin = V3(wx(lot.x0) + 0.45, lot.level, wz(lot.z0 + lot.d / 2) - (TW * VS) / 2);
  mt.mesh(voxSolid, origin);
  gt.mesh(voxGlow, origin, mt, false);
  addLight(origin.x + (TD + 4) * VS, lot.level + 0.9, origin.z + TW * VS * 0.5, 1.4);
}
// After the rotunda of San Francisco's Palace of Fine Arts, in our palette: an open octagon
// of arches on a stepped stone base, paired stone columns at each corner, a deep stone frieze
// and cornice, a drum, and a brick-toned dome with stone ribs and a small lantern on top.
function rotunda(lot) {
  const r = mulberry32(1915), m = new VoxelModel(), glow = new VoxelModel();
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], BRICK = ['#7e5e4c', '#765746', '#866553', '#6f5242'];
  const stone = (a = 0.02) => tint(STONE[Math.floor(r() * STONE.length)], r, a);
  const N = lot.w * 16, C = N / 2;
  const TH = [...Array(8)].map((_, k) => (k * Math.PI) / 4);
  // octagon "radius" of a point, which face it is on, and how far along that face
  const oct = (dx, dz) => {
    let best = -1e9, face = 0;
    TH.forEach((t, k) => { const d = dx * Math.cos(t) + dz * Math.sin(t); if (d > best) { best = d; face = k; } });
    const t = TH[face];
    return { ro: best, t: -dx * Math.sin(t) + dz * Math.cos(t) };
  };
  const SPRING = 13, ATTIC = 25, CORN = 29, HW = 5;   // arch springing, frieze bottom, cornice, arch half-width
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const dx = x + 0.5 - C, dz = z + 0.5 - C, { ro, t } = oct(dx, dz), at = Math.abs(t);
    if (ro <= 21.5) m.set(x, 0, z, stone());                              // steps
    if (ro <= 20.5) m.set(x, 1, z, stone());
    if (ro <= 19.5) m.set(x, 2, z, stone(ro < 12 ? 0.035 : 0.02));        // floor
    if (ro >= 14.5 && ro <= 16.5) for (let y = 3; y < ATTIC; y++) {         // the octagon of tall arches
      const archTop = SPRING + Math.sqrt(Math.max(0, HW * HW - t * t)) * 1.5;
      if (at <= HW && y < archTop) continue;
      m.set(x, y, z, at > HW && y < SPRING ? tint(STONE[1], r, 0.015) : stone());
    }
    if (ro >= 13.5 && ro <= 19.5) for (let y = ATTIC; y < CORN; y++)     // frieze with sunk panels
      m.set(x, y, z, y === ATTIC + 2 && ro > 18.5 && Math.round(t) % 3 === 0 ? tint(STONE[1], r, 0.01).offsetHSL(0, 0, -0.07) : stone());
    if (ro >= 13.5 && ro <= 20.5) m.set(x, CORN, z, stone());            // cornice
    if (ro <= 19) for (let y = CORN + 1; y < CORN + 3; y++) m.set(x, y, z, stone());   // low drum
  }
  // paired columns standing in front of each corner, carrying the frieze
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4, ux = Math.cos(a), uz = Math.sin(a);
    for (const side of [-1, 1]) {
      const px = C + ux * 18.2 - uz * side * 1.9, pz = C + uz * 18.2 + ux * side * 1.9;
      for (let x = Math.floor(px - 2); x <= Math.ceil(px + 2); x++) for (let z = Math.floor(pz - 2); z <= Math.ceil(pz + 2); z++) {
        const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
        for (let y = 3; y < ATTIC; y++) {
          const cap = y >= ATTIC - 2, base = y <= 4;
          if (d <= ((cap || base) ? 1.75 : 1.15)) m.set(x, y, z, cap || base ? stone() : tint(STONE[(x + z) % 2 ? 2 : 0], r, 0.012));
        }
      }
    }
  }
  // dome: a broad, low dome over the whole octagon, in brick tones with stone ribs, and a lantern
  const DY = CORN + 3, R = 19, SQ = 0.55;   // dome base, radius, vertical squash
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) for (let y = DY; y < DY + R * SQ; y++) {
    const dx = x + 0.5 - C, dz = z + 0.5 - C, dy = (y + 0.5 - DY) / SQ, d = Math.hypot(dx, dz, dy);
    if (d > R) continue;
    const a = Math.atan2(dz, dx), rib = Math.abs(Math.sin(4 * a)) * Math.hypot(dx, dz) < 0.9;
    const band = y === DY + 1;
    m.set(x, y, z, rib || band ? stone() : tint(BRICK[(x * 7 + y * 3 + z * 5) % 4], r, 0.02).offsetHSL(0, -0.32, 0.04));
  }
  const top = Math.round(DY + R * SQ);
  m.fill(C - 3, top - 1, C - 3, C + 2, top, C + 2, () => stone());
  for (const [x, z] of [[C - 3, C - 3], [C + 2, C - 3], [C - 3, C + 2], [C + 2, C + 2]]) m.fill(x, top + 1, z, x, top + 3, z, () => stone());
  m.fill(C - 3, top + 4, C - 3, C + 2, top + 4, C + 2, () => stone());
  m.fill(C - 1, top + 5, C - 1, C, top + 6, C, () => stone());
  glow.fill(C - 1, top + 1, C - 1, C, top + 2, C, () => new THREE.Color('#ffd38a'));
  const origin = V3(wx(lot.x0), lot.level, wz(lot.z0));
  m.mesh(voxSolid, origin);
  glow.mesh(voxGlow, origin, m, false);
  addLight(origin.x + C * VS, lot.level + 0.8, origin.z + C * VS, 1.6);
}
// A third Collegiate Gothic building in the same stone, brick and slate, but stepped rather
// than a single block: a tall centre block with a gabled entrance pavilion projecting forward,
// lower wings set back on either side, and a bell tower with a clock, corner pinnacles and a
// slate spire rising from the middle. Faces +z.
function hall(lot) {
  const r = mulberry32(1861), m = new VoxelModel(), glow = new VoxelModel();
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], BRICK = ['#7e5e4c', '#765746', '#866553', '#6f5242'];
  const SLATE = ['#626a73', '#606871', '#646c75', '#616972'], CREST = '#434a52', GLASS = ['#2f3437', '#363c40', '#3b4246'];
  const stone = (a = 0.02) => tint(STONE[Math.floor(r() * STONE.length)], r, a);
  const brick = (x, y) => tint(BRICK[(x * 7 + y * 3) % BRICK.length], r, 0.02).offsetHSL(0, 0, y % 2 ? -0.012 : 0);
  const slate = (k = 0) => tint(SLATE[Math.floor(r() * SLATE.length)], r, 0.008).offsetHSL(0, 0, k % 2 ? -0.025 : 0);
  const glass = () => tint(GLASS[Math.floor(r() * 3)], r);
  const GF = 13;
  // one brick block with a stone ground floor, pointed windows on every side, stone quoins,
  // string course, cornice, openwork parapet and a slate roof ('hip', or 'gable' with its ends facing ±z)
  // the facade treatment is Suzzallo's: close-set bays, each with a pointed stone arch on
  // the ground floor and a tall traceried lancet above, thin stone pilasters between bays
  // rising into pinnacles over an openwork parapet
  function block(x0, z0, x1, z1, WT, roof = 'hip', door = null, sides = ['+z', '+x', '-x', '-z']) {
    m.fill(x0, 0, z0, x1, GF - 1, z1, () => stone());
    m.fill(x0, GF, z0, x1, WT - 1, z1, (x, y) => brick(x, y));
    const faces = [
      { name: '+z', len: x1 - x0 + 1, at: (u, v, d) => [x0 + u, v, z1 + d] },
      { name: '+x', len: z1 - z0 + 1, at: (u, v, d) => [x1 + d, v, z1 - u] },
      { name: '-x', len: z1 - z0 + 1, at: (u, v, d) => [x0 - d, v, z0 + u] },
      { name: '-z', len: x1 - x0 + 1, at: (u, v, d) => [x1 - u, v, z0 - d] },
    ];
    for (const F of faces) {
      const put = (u, v, d, c, mod = m) => mod.set(...F.at(u, v, d), c), del = (u, v, d) => m.del(...F.at(u, v, d));
      const L = F.len, Q = 2;
      for (let u = 0; u < L; u++) { put(u, GF, 1, stone()); put(u, GF + 1, 0, stone()); put(u, WT - 1, 1, stone()); }
      for (let v = GF; v < WT; v++) for (let u = 0; u < Q; u++) { put(u, v, 0, stone()); put(L - 1 - u, v, 0, stone()); }   // quoins
      for (let u = 0; u < L; u++) { put(u, WT, 0, stone()); put(u, WT + 2, 0, stone()); if (u % 2 === 0) put(u, WT + 1, 0, stone()); }   // parapet
      for (const u of [0, L - 1]) for (let v = WT; v < WT + 5; v++) put(u, v, 0, stone());   // corner pinnacles
      if (!sides.includes(F.name)) continue;
      const bays = Math.max(1, Math.round((L - 2 * Q) / 6)), bw = (L - 2 * Q) / bays;
      for (let b = 0; b < bays; b++) {
        const u0 = Math.round(Q + b * bw), cu = Math.round(Q + (b + 0.5) * bw);
        if (b > 0) for (let v = GF; v < WT + 5; v++) put(u0, v, v < WT ? 1 : 0, stone());   // pilaster and pinnacle
        if (door !== null && F.name === '+z' && Math.abs(x0 + cu - door) < 5) continue;
        // ground floor: a recessed pointed arch with a mullion and transom, between stone piers
        const a0 = cu - 2, a1 = cu + 2, top = GF - 3;
        for (let v = 2; v <= top; v++) {
          const inset = v > top - 3 ? v - (top - 3) : 0;
          for (let u = a0 + inset; u <= a1 - inset; u++) { del(u, v, 0); put(u, v, -1, u === cu || v === 7 ? stone() : glass()); }
        }
        for (let v = 1; v <= top + 1; v++) { put(a0 - 1, v, 1, stone(0.03)); put(a1 + 1, v, 1, stone(0.03)); }
        put(cu, top + 1, 1, stone()); put(cu - 1, top, 1, stone()); put(cu + 1, top, 1, stone());
        // upper floor: a tall lancet with tracery, lit or dark as a whole, in a stone frame
        const wt = WT - 4, lit = r() < 0.3, g = glass();
        for (let v = GF + 3; v <= wt; v++) for (let u = cu - 1; u <= cu + 1; u++) {
          if (v === wt && u !== cu) continue;
          del(u, v, 0);
          const tracery = u === cu || v === GF + 10 || (v >= wt - 3 && (v - wt) % 2 === 0);
          if (lit && !tracery) del(u, v, -1);
          put(u, v, -1, tracery ? stone() : lit ? tint('#f2c27e', r, 0.01) : g, lit && !tracery ? glow : m);
        }
        put(cu - 1, wt, 0, stone()); put(cu + 1, wt, 0, stone()); put(cu, wt + 1, 0, stone());
        for (let u = cu - 2; u <= cu + 2; u++) put(u, GF + 2, 1, stone());
      }
    }
    if (roof === 'hip') for (let k = 0; ; k++) {
      const a0 = x0 + 1 + k, a1 = x1 - 1 - k, b0 = z0 + 1 + k, b1 = z1 - 1 - k;
      if (b1 < b0 || a1 < a0) break;
      m.fill(a0, WT + 1 + k, b0, a1, WT + 1 + k, b1, () => slate(k));
      if (b1 - b0 <= 1 || a1 - a0 <= 1) { for (let x = a0; x <= a1; x++) for (let z = b0; z <= b1; z++) if ((x + z) % 2 === 0) m.set(x, WT + 2 + k, z, new THREE.Color(CREST)); break; }
    } else for (let k = 0; ; k++) {   // gable: ridge along z, stone gable ends with a coping
      const a0 = x0 + 1 + k, a1 = x1 - 1 - k;
      if (a1 < a0) break;
      for (let x = a0; x <= a1; x++) for (let z = z0; z <= z1 + 1; z++) {
        const end = z === z1 || z === z0, edge = x === a0 || x === a1;
        if (z === z1 + 1 && !edge) continue;   // only the coping overhangs the gable face
        m.set(x, WT + 1 + k, z, end || z === z1 + 1 ? stone() : slate(k));
      }
    }
  }
  const N = lot.w * 16, D = lot.d * 16, cx = Math.round(N / 2);
  const WW = 28, WC = 36;   // wing and centre wall heights
  block(2, 8, cx - 13, D - 12, WW);                 // left wing, set back
  block(cx + 12, 8, N - 3, D - 12, WW);             // right wing
  block(cx - 14, 3, cx + 13, D - 9, WC);            // centre block
  block(cx - 9, D - 14, cx + 8, D - 5, WC - 4, 'gable', cx, ['+z']);   // entrance pavilion, gable to the front
  // the entrance: a tall pointed arch in the pavilion front, steps up to it, lanterns either side
  const fz = D - 5;
  for (let v = 1; v <= 17; v++) {
    const half = v > 12 ? 3 - (v - 12) * 0.6 : 3;
    for (let x = cx - 3; x <= cx + 3; x++) {
      if (Math.abs(x + 0.5 - cx) > half + 0.5) continue;
      m.del(x, v, fz); m.set(x, v, fz - 1, v < 11 ? tint('#3a2b22', r, 0.02) : glass());
    }
  }
  for (let v = 1; v <= 19; v++) for (let x = cx - 5; x <= cx + 4; x++) {   // a flush stone surround around the arch
    const half = v > 12 ? 3 - (v - 12) * 0.6 : 3, d = Math.abs(x + 0.5 - cx);
    if (d > half + 0.5 && d <= half + 2 && m.has(x, v, fz)) m.set(x, v, fz, stone(0.01));
  }
  for (let k = 0; k < 3; k++) for (let x = cx - 8 + k; x <= cx + 7 - k; x++) for (let z = fz + 1; z <= fz + 4 - k; z++) m.set(x, k, z, stone());
  for (const x of [cx - 7, cx + 6]) glow.set(x, 12, fz + 1, new THREE.Color('#ffd38a'));
  // a rose window in the gable
  // a great traceried window over the door, in a stone frame
  for (let v = 20; v <= WC - 6; v++) {
    const half = v > WC - 10 ? 3 - (v - (WC - 10)) * 0.75 : 3;
    for (let x = cx - 4; x <= cx + 3; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d <= half) {
        m.del(x, v, fz); m.del(x, v, fz - 1);
        const tracery = d < 0.6 || v === 27 || (v > WC - 10 && (v % 2 === 0));
        m.set(x, v, fz - 1, tracery ? stone() : glass());
      } else if (d <= half + 1.2) m.set(x, v, fz, stone(0.01));
    }
  }
  for (let x = cx - 4; x <= cx + 3; x++) m.set(x, 19, fz + 1, stone());   // sill
  const rY = WC + 1;   // set into the stone gable face
  for (let x = cx - 3; x <= cx + 3; x++) for (let y = rY - 3; y <= rY + 3; y++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - rY);
    if (!m.has(x, y, fz)) continue;
    if (d < 2.2) { m.del(x, y, fz); m.set(x, y, fz - 1, glass()); }
    else if (d < 3.2) m.set(x, y, fz, tint('#e2dccf', r, 0.01));
  }
  // the bell tower: brick shaft above the centre roof, stone bands, a clock, louvred belfry
  // openings, corner pinnacles and a slate spire with a finial
  const tx0 = cx - 6, tx1 = cx + 5, tz0 = 13, tz1 = 24, TT = WC + 22;
  m.fill(tx0, WC, tz0, tx1, TT - 1, tz1, (x, y) => brick(x, y));
  for (const y of [WC + 6, TT - 12, TT - 1]) for (let x = tx0 - 1; x <= tx1 + 1; x++) for (let z = tz0 - 1; z <= tz1 + 1; z++) if (x < tx0 || x > tx1 || z < tz0 || z > tz1) m.set(x, y, z, stone());
  const tcx = (tx0 + tx1 + 1) / 2, tcz = (tz0 + tz1 + 1) / 2;
  for (const [ax, sgn] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
    for (let k = -1; k <= 1; k += 2) for (let y = TT - 10; y <= TT - 3; y++) for (let w = 0; w < 2; w++) {   // two louvred openings per side
      if (y === TT - 3 && w === (k < 0 ? 0 : 1)) continue;
      const along = Math.round((ax === 'z' ? tcx : tcz) + k * 2.5 - 1 + w);
      const [x, z] = ax === 'z' ? [along, sgn > 0 ? tz1 : tz0] : [sgn > 0 ? tx1 : tx0, along];
      m.set(x, y, z, (y - TT) % 2 === 0 ? tint('#2a2b2e', r, 0.01) : tint('#4a3a2c', r, 0.02));
    }
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {   // clock face
      const d = Math.hypot(a, b), y = WC + 12 + b, along = Math.round((ax === 'z' ? tcx : tcz) - 0.5 + a);
      if (d > 3.2) continue;
      const [x, z] = ax === 'z' ? [along, sgn > 0 ? tz1 + 1 : tz0 - 1] : [sgn > 0 ? tx1 + 1 : tx0 - 1, along];
      const hand = (a === 0 && b >= 0 && b <= 2) || (b === 0 && a >= 0 && a <= 2);
      m.set(x, y, z, d > 2.4 ? stone() : hand ? tint('#2a2b2e', r, 0.01) : tint('#ece6d6', r, 0.01));
    }
  }
  for (const [x, z] of [[tx0 - 1, tz0 - 1], [tx1, tz0 - 1], [tx0 - 1, tz1], [tx1, tz1]]) {
    m.fill(x, TT, z, x + 1, TT + 3, z + 1, () => stone());
    m.set(x, TT + 4, z, stone());
  }
  for (let k = 0; ; k++) {
    const a0 = tx0 + Math.floor(k / 2), a1 = tx1 - Math.floor(k / 2), b0 = tz0 + Math.floor(k / 2), b1 = tz1 - Math.floor(k / 2);
    if (a1 < a0 || b1 < b0) { m.fill(Math.round(tcx) - 1, TT + k, Math.round(tcz) - 1, Math.round(tcx) - 1, TT + k + 2, Math.round(tcz) - 1, () => new THREE.Color(CREST)); break; }
    m.fill(a0, TT + k, b0, a1, TT + k, b1, () => slate(k));
  }
  const origin = V3(wx(lot.x0), lot.level, wz(lot.z0));
  m.mesh(voxSolid, origin);
  glow.mesh(voxGlow, origin, m, false);
  addLight(origin.x + cx * VS, lot.level + 0.5, origin.z + (D + 2) * VS, 0.7);
}
// A Painted Lady: a narrow Victorian row house facing +x. A stone basement with a garage
// door, two storeys of clapboard, a bay window running up both floors, a stoop up to a
// recessed front door, a bracketed cornice, and a steep front gable with patterned shingles
// and a finial. Each house in the row takes its own colours from the world's palette.
const LADIES = [   // warm creams, sands and browns from the same palette as the other buildings
  { body: '#d8cdb6', trim: '#f0ebe0', accent: '#6f5242', roof: '#626a73' },   // cream
  { body: '#c4ad8a', trim: '#f0ebe0', accent: '#5e4636', roof: '#735644' },   // sand, brown roof
  { body: '#8a6c58', trim: '#e8e1d2', accent: '#4a3a2e', roof: '#626a73' },   // warm brown
  { body: '#a8917a', trim: '#ece6d8', accent: '#5b636b', roof: '#5f4738' },   // taupe, dark brown roof
  { body: '#bf9f6e', trim: '#f0ebe0', accent: '#6f5242', roof: '#626a73' },   // ochre tan
  { body: '#6f5446', trim: '#e2dccf', accent: '#b9a88f', roof: '#6a4f3e' },   // umber, brown roof
];
function lady(lot) {
  const k = lot.k, P = LADIES[k], r = mulberry32(1880 + k * 17), m = new VoxelModel(), glow = new VoxelModel();
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], GLASS = ['#2f3437', '#363c40', '#3b4246'];
  const stone = () => tint(STONE[Math.floor(r() * 4)], r, 0.02), trim = () => tint(P.trim, r, 0.006), accent = () => tint(P.accent, r, 0.008);
  // like the other buildings, walls and roof take a few shades of their colour, varied per voxel
  const shades = (hex) => [0, -0.025, 0.02, -0.04].map((l) => new THREE.Color(hex).offsetHSL(0, 0, l).getHexString());
  const BODY = shades(P.body), ROOF = shades(P.roof);
  const body = (y) => tint('#' + BODY[Math.floor(r() * 4)], r, 0.02).offsetHSL(0, 0, y % 2 ? -0.02 : 0);   // clapboard lines
  const roof = (n) => tint('#' + ROOF[Math.floor(r() * 4)], r, 0.012).offsetHSL(0, 0, n % 2 ? -0.025 : 0);
  const W = 20, FX = 21, B = 3, F1 = B + 8, TOP = B + 16;   // width (z), front face x, basement, floor line, wall top
  const at = (z, y, d, c, mod = m) => mod.set(FX + d, y, z, c);   // front face helper: d = 0 on the wall, + outwards
  m.fill(0, 0, 0, FX, B - 1, W - 1, () => stone());
  m.fill(0, B, 0, FX, TOP, W - 1, (x, y) => body(y));
  // sash window: two panes side by side, lit or dark as a whole, a trim frame, a sill, and a
  // small pediment-style hood above
  const sash = (d, z0, z1, y0, y1) => {
    const lit = r() < 0.45, g = tint(GLASS[Math.floor(r() * 3)], r), mid = (z0 + z1) / 2;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      m.del(FX + d, y, z); m.del(FX + d - 1, y, z);
      const bar = Math.abs(z - mid) < 0.6 || y === Math.round((y0 + y1) / 2);
      if (bar) at(z, y, d - 1, trim());
      else (lit ? glow : m).set(FX + d - 1, y, z, lit ? tint('#f2c27e', r, 0.01) : g);
    }
    for (let y = y0 - 1; y <= y1 + 1; y++) { at(z0 - 1, y, d, trim()); at(z1 + 1, y, d, trim()); }
    for (let z = z0 - 1; z <= z1 + 1; z++) { at(z, y0 - 1, d + 1, trim()); at(z, y1 + 1, d, trim()); at(z, y1 + 2, d + 1, accent()); }
    at(Math.round(mid), y1 + 3, d + 1, accent());
  };
  // corner boards and the band between floors
  for (let y = B; y <= TOP; y++) { at(0, y, 1, trim()); at(W - 1, y, 1, trim()); }
  for (let z = 0; z < W; z++) { at(z, F1, 1, trim()); at(z, B, 1, trim()); }
  // a two-storey bay window, angled at the sides, with a window on each floor of its front
  for (let y = B; y <= TOP; y++) {
    for (let z = 2; z <= 10; z++) at(z, y, 1, body(y));
    for (let z = 3; z <= 9; z++) at(z, y, 2, body(y));
    for (const z of [2, 10]) at(z, y, 1, trim());
    for (const z of [3, 9]) at(z, y, 2, trim());
  }
  sash(2, 4, 8, B + 2, B + 6);
  sash(2, 4, 8, F1 + 2, F1 + 6);
  for (let z = 2; z <= 10; z++) { at(z, F1, 3, trim()); }   // band across the bay
  // the entrance: a recessed door with a glass transom, two slim columns carrying a little
  // porch roof, and a stone stoop with railings down to the path
  for (let y = B; y <= B + 7; y++) for (let z = 13; z <= 17; z++) {
    m.del(FX, y, z);
    at(z, y, -1, y >= B + 6 ? tint(GLASS[1], r) : z === 15 ? tint(P.accent, r, 0.01).offsetHSL(0, 0, -0.06) : accent());
  }
  for (const z of [12, 18]) for (let y = B; y <= B + 7; y++) at(z, y, 2, trim());   // columns
  for (let z = 11; z <= 19; z++) { at(z, B + 8, 1, trim()); at(z, B + 8, 2, trim()); at(z, B + 8, 3, accent()); }   // porch roof
  for (let s2 = 0; s2 < 3; s2++) for (let z = 13; z <= 17; z++) for (let y = 0; y < B - s2; y++) at(z, y, 1 + s2, stone());
  for (const z of [12, 18]) for (let s2 = 0; s2 < 3; s2++) at(z, B - s2 + 1, 1 + s2, trim());   // railings
  sash(0, 14, 16, F1 + 2, F1 + 6);
  // windows down the exposed +z side wall, framed like the front ones
  for (const x0 of [4, 10, 15]) for (const y0 of [B + 2, F1 + 2]) {
    const lit = r() < 0.4, g = tint(GLASS[Math.floor(r() * 3)], r);
    for (let y = y0; y <= y0 + 4; y++) for (let x = x0; x <= x0 + 2; x++) {
      m.del(x, y, W - 1);
      (lit ? glow : m).set(x, y, W - 2, lit ? tint('#f2c27e', r, 0.01) : g);
    }
    for (let x = x0 - 1; x <= x0 + 3; x++) { m.set(x, y0 - 1, W, trim()); m.set(x, y0 + 5, W, accent()); }
    for (let y = y0; y <= y0 + 4; y++) { m.set(x0 - 1, y, W - 1, trim()); m.set(x0 + 3, y, W - 1, trim()); }
  }
  for (let x = 0; x <= FX; x++) m.set(x, F1, W, trim());
  // a cornice with a row of brackets under it
  for (let z = -1; z <= W; z++) { at(z, TOP + 1, 1, trim()); at(z, TOP + 1, 2, trim()); }
  for (let z = 0; z < W; z += 2) at(z, TOP, 2, accent());
  // the front gable: slate slopes, scalloped shingle bands in the triangle, a trimmed rake,
  // an attic window and a finial
  for (let n = 0; ; n++) {
    const z0 = n, z1 = W - 1 - n, y = TOP + 2 + n;
    if (z1 < z0) break;
    for (let z = z0; z <= z1; z++) {
      const edge = z === z0 || z === z1;
      for (let x = 0; x <= FX; x++) m.set(x, y, z, edge ? roof(n) : body(y));
      at(z, y, 1, edge ? trim() : Math.floor(n / 2) % 2 ? accent() : body(y));
    }
    at(z0 - 1 < 0 ? z0 : z0, y, 2, trim()); at(z1, y, 2, trim());
  }
  sash(1, 9, 10, TOP + 5, TOP + 7);
  at(9, TOP + 12, 1, trim()); at(10, TOP + 12, 1, trim()); at(9, TOP + 13, 1, trim());
  const origin = V3(wx(lot.x0), lot.level, wz(lot.z0));
  m.mesh(voxSolid, origin);
  glow.mesh(voxGlow, origin, m, false);
  if (k % 2 === 0) addLight(origin.x + (FX + 6) * VS, lot.level + 0.5, origin.z + 15 * VS, 0.6);
}
const chimneys = [];   // world positions of chimney tops, for the smoke
function office(lot) {
  const r = mulberry32(2026), m = new VoxelModel(), glow = new VoxelModel();
  const TW = lot.w * 16 - 6, TD = lot.d * 16 - 10;
  const STONE = ['#d9d3c5', '#cfc8b9', '#e2dccf', '#d4cdbe'], BRICK = ['#7e5e4c', '#765746', '#866553', '#6f5242'];
  const SAGE = ['#7f9484', '#768b7c', '#88998a', '#6f8475'], ROOF = ['#4a525a', '#474f57', '#4d555d', '#485058'], GLASS = ['#2f3437', '#363c40', '#3b4246'], LIT = ['#f2c27e', '#efb870', '#f6cd8e'];
  const stone = (a = 0.02) => tint(STONE[Math.floor(r() * STONE.length)], r, a);
  const brick = (x, y) => tint(BRICK[(x * 7 + y * 3) % BRICK.length], r, 0.02).offsetHSL(0, 0, y % 2 ? -0.012 : 0);
  const GF = 13, FH = 11, FLOORS = 3, TOP = GF + FH * FLOORS, Q = 3;   // ground-floor top, wall top, quoin width
  const faces = {
    '+z': { len: TW, at: (u, v, d) => [u, v, TD - 1 + d] },
    '+x': { len: TD, at: (u, v, d) => [TW - 1 + d, v, TD - 1 - u] },
    '-x': { len: TD, at: (u, v, d) => [-d, v, u] },
    '-z': { len: TW, at: (u, v, d) => [TW - 1 - u, v, -d] },
  };
  const put = (F, u, v, d, c, mod = m) => mod.set(...F.at(u, v, d), c);
  const del = (F, u, v, d) => m.del(...F.at(u, v, d));
  let sign = null;
  const roofBays = [];
  const pane = (F, u, v) => { del(F, u, v, 0); const lit = r() < 0.55; if (lit) del(F, u, v, -1); put(F, u, v, -1, lit ? tint(LIT[Math.floor(r() * 3)], r, 0.02) : tint(GLASS[Math.floor(r() * 3)], r), lit ? glow : m); };
  m.fill(0, 0, 0, TW - 1, GF - 1, TD - 1, () => stone());
  m.fill(0, GF, 0, TW - 1, TOP - 1, TD - 1, (x, y) => brick(x, y));
  for (const [name, F] of Object.entries(faces)) {
    const L = F.len, bays = Math.max(2, Math.round((L - 2 * Q) / 8)), bw = (L - 2 * Q) / bays;
    // quoins: alternating long and short stone blocks up each corner
    for (let v = GF; v < TOP; v++) for (let u = 0; u < (Math.floor((v - GF) / 2) % 2 ? Q : Q - 1); u++) { put(F, u, v, 0, stone()); put(F, L - 1 - u, v, 0, stone()); }
    // stone bands between floors, a deeper band over the ground floor
    for (let u = -1; u <= L; u++) { put(F, u, GF, 1, stone()); put(F, u, GF + 1, 1, stone()); for (let f = 1; f < FLOORS; f++) put(F, u, GF + f * FH, 1, stone()); }
    for (let b = 0; b < bays; b++) {
      const cu = Math.round(Q + (b + 0.5) * bw);
      // ground floor: tall windows between stone piers, or the entrance in the middle of the front
      const door = name === '+z' && b === Math.floor(bays / 2), nearDoor = name === '+z' && Math.abs(b - Math.floor(bays / 2)) <= 1;
      for (let v = 2; v < GF - 2; v++) for (let u = cu - 2; u <= cu + 2; u++) {
        if (door) { del(F, u, v, 0); put(F, u, v, -1, v < 9 ? tint('#3a2b22', r, 0.02) : tint(GLASS[1], r)); }
        else if (u === cu) { del(F, u, v, 0); put(F, u, v, -1, stone()); }
        else pane(F, u, v);
      }
      for (let u = cu - 3; u <= cu + 3; u++) put(F, u, GF - 2, 1, stone());   // lintel
      if (door) {
        for (let u = cu - 5; u <= cu + 5; u++) for (let d = 1; d <= 4; d++) put(F, u, GF - 1, d, tint(SAGE[Math.floor(r() * 3)], r));   // canopy
        for (let u = cu - 4; u <= cu + 4; u++) { put(F, u, 0, 1, stone()); put(F, u, 0, 2, stone()); }                                     // step
        put(F, cu - 4, GF - 3, 1, new THREE.Color('#ffd38a'), glow); put(F, cu + 4, GF - 3, 1, new THREE.Color('#ffd38a'), glow);         // lamps
        for (let u = cu - 11; u <= cu + 11; u++) for (let v = GF + 2; v <= GF + 10; v++) { put(F, u, v, 0, stone(0.015)); put(F, u, v, 1, stone(0.015)); } // sign panel, flush with its frame
        for (let u = cu - 12; u <= cu + 12; u++) put(F, u, GF + 10, 1, stone());
        for (let v = GF + 2; v <= GF + 10; v++) { put(F, cu - 12, v, 1, stone()); put(F, cu + 12, v, 1, stone()); }
        sign = { cu, v: GF + 6 };
      }
      // upper floors: a stone-framed window per bay on every floor
      for (let f = 0; f < FLOORS; f++) {
        const v0 = GF + f * FH + (f === 0 ? 4 : 3), v1 = v0 + 5;
        if (nearDoor && f === 0) continue;   // keep the wall over the entrance clear for the sign
        for (let v = v0; v <= v1; v++) for (let u = cu - 1; u <= cu + 1; u++) pane(F, u, v);
        for (let u = cu - 2; u <= cu + 2; u++) { put(F, u, v0 - 1, 1, stone()); put(F, u, v1 + 1, 0, stone()); }
      }
    }
    // cornice
    for (let u = -1; u <= L; u++) { put(F, u, TOP, 1, stone()); put(F, u, TOP + 1, 0, stone()); }
    roofBays.push([F, L, bays, bw]);
  }
  // a hipped dark slate roof rising to a ridge, with dark metal cresting along the ridge
  m.fill(1, TOP, 1, TW - 2, TOP, TD - 2, () => tint('#8d867b', r, 0.03));
  let k = 0;
  for (; 2 * (1 + k) < TD - 1; k++) m.fill(1 + k, TOP + 2 + k, 1 + k, TW - 2 - k, TOP + 2 + k, TD - 2 - k, () => tint(ROOF[Math.floor(r() * 4)], r, 0.008));
  const CY = TOP + 1 + k, rz0 = k, rz1 = TD - 1 - k;
  for (let x = k + 2; x < TW - k - 2; x++) for (let z = rz0; z <= rz1; z++) m.set(x, CY + 1, z, tint(x % 3 ? '#2f353b' : '#5a636b', r));
  // dormers over every window bay, with stone frames and little gables
  for (const [F, L, bays, bw] of roofBays) for (let b = 0; b < bays; b++) {
    const cu = Math.round(Q + (b + 0.5) * bw);
    for (let v = TOP + 2; v <= TOP + 8; v++) for (let u = cu - 2; u <= cu + 2; u++) for (let d = -6; d <= 0; d++) put(F, u, v, d, tint(ROOF[Math.floor(r() * 4)], r, 0.008));
    for (let v = TOP + 2; v <= TOP + 7; v++) { put(F, cu - 2, v, 0, stone()); put(F, cu + 2, v, 0, stone()); }
    for (let u = cu - 2; u <= cu + 2; u++) put(F, u, TOP + 2, 1, stone());
    for (let v = TOP + 3; v <= TOP + 6; v++) for (let u = cu - 1; u <= cu + 1; u++) pane(F, u, v);
    for (let d = -6; d <= 1; d++) {
      for (let u = cu - 3; u <= cu + 3; u++) put(F, u, TOP + 8, d, tint('#3a4148', r, 0.01));
      for (let u = cu - 2; u <= cu + 2; u++) put(F, u, TOP + 9, d, tint('#3a4148', r, 0.01));
      put(F, cu, TOP + 10, d, tint('#3a4148', r, 0.01));
    }
  }
  // two brick chimneys with stone caps
  for (const cx of [16, TW - 19]) {
    m.fill(cx, TOP + 2, 9, cx + 2, CY + 4, 11, (x, y) => brick(x, y));
    m.fill(cx - 1, CY + 5, 8, cx + 3, CY + 5, 12, () => stone());
  }
  const origin = V3(wx(lot.x0 + lot.w / 2) - (TW * VS) / 2, lot.level, wz(lot.z0 + lot.d / 2) - ((TD + 2) * VS) / 2);
  for (const cx of [16, TW - 19]) chimneys.push(V3(origin.x + (cx + 1.5) * VS, origin.y + (CY + 6) * VS, origin.z + 10.5 * VS));
  m.mesh(voxSolid, origin);
  glow.mesh(voxGlow, origin, m, false);
  addLight(origin.x + TW * VS * 0.5, lot.level + 0.7, origin.z + (TD + 5) * VS, 1.3);
  // the logo: a small pre-processed texture on the stone panel over the entrance
  if (sign) {
    const tex = new THREE.TextureLoader().load('img/amazon-sign.png');
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(23 * VS, 7 * VS), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05 }));
    plate.position.set(origin.x + (sign.cu + 0.5) * VS, origin.y + (sign.v + 0.5) * VS, origin.z + (TD + 1) * VS + 0.004);
    plate.receiveShadow = true;
    world.add(plate);
  }
}
// --- place everything ---
for (const b of BUILDINGS) { hoverMesher = b.hover = new Mesher(); ({ suzzallo, office, portico, rotunda, hall, lady })[b.shape](b); }
hoverMesher = null;
// One outline per section (the six Painted Ladies share one): the buildings' own geometry,
// pushed out along its normals and drawn back-faces-only in pale cream, so only a rim shows
// around the silhouette. Hidden until hovered; also used to pick what the mouse is over.
const outlines = new Map();
for (const b of BUILDINGS) {
  if (!b.id) continue;
  const m = outlines.get(b.id) || new Mesher();
  for (const k of ['p', 'n', 'c']) { const src = b.hover[k], dst = m[k]; for (let i = 0; i < src.length; i++) dst.push(src[i]); }
  outlines.set(b.id, m);
  delete b.hover;
}
// The dithering pass draws a pixel rim around whatever is in `hoverScene` (see dither.js).
const outlineMeshes = [], hoverScene = new THREE.Scene(), maskMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
for (const [id, m] of outlines) {
  const g = m.geometry();
  const pickMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  pickMesh.visible = false; pickMesh.userData.id = id;
  world.add(pickMesh); outlineMeshes.push(pickMesh);
  const mask = new THREE.Mesh(g, maskMat);
  mask.visible = false; mask.userData.id = id; mask.matrixAutoUpdate = false;
  hoverScene.add(mask);
}
// A banana stand in front of the office: a plain wooden box on the ground heaped with
// bananas, under a white awning on four posts. Each banana is a few small yellow cubes of different sizes along a curve,
// the same way the smoke and foliage are built. Click the cart and one flies to you.
const STAND = { x: 19.5, z: 26.05 };
const standHand = V3();   // where bananas leave the cart
const cartMesh = new Mesher(), BANANA_YEL = ['#f0c93c', '#e8c034', '#f4d24a', '#e2b52e'];
// one banana: cubes along a gentle arc, thicker in the middle, with a brown stem tip
function bananaCubes(out, x, y, z, yaw, s = 1, r = rnd) {
  const L = 0.12 * s, c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let k = 0; k <= 5; k++) {
    const t = k / 5, a = (t - 0.5) * L, up = (1 - (2 * t - 1) ** 2) * -0.022 * s + 0.022 * s;
    const size = (0.016 + Math.sin(t * Math.PI) * 0.014) * s * (0.9 + r() * 0.2);
    out(x + a * c, y + up, z - a * sn, size, k === 5 ? '#5a4326' : BANANA_YEL[Math.floor(r() * 4)]);
  }
}
let cart;
{
  const r = mulberry32(7), m = new VoxelModel();
  const W = 18, D = 7, B = 0, T = 6, PH = 17;   // box width, depth, bottom, top; awning height
  const WOOD = ['#8a5d3b', '#7f5536', '#94653f'], DARK = '#5e3e27';
  const wood = () => tint(WOOD[Math.floor(r() * 3)], r, 0.02), dark = () => tint(DARK, r, 0.02);
  m.fill(0, B, 0, W - 1, T - 1, D - 1, (x, y) => (y % 3 === 0 ? dark() : wood()));   // plank sides
  for (let y = T; y < T + 2; y++) for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (x === 0 || z === 0 || x === W - 1 || z === D - 1) m.set(x, y, z, y === T + 1 ? dark() : wood());   // rim rising from the sides
  for (const [x, z] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]]) m.fill(x, T + 1, z, x, PH - 1, z, wood);   // posts
  for (let z = -1; z <= D; z++) {                                                      // white awning, sloping to the front
    const yy = PH + Math.floor((D - z) / 3);
    for (let x = -1; x <= W; x++) m.set(x, yy, z, tint('#ece8e0', r, 0.012));
  }
  for (let x = -1; x <= W; x += 2) m.set(x, PH - 1, D, tint('#e4e0d7', r, 0.012));       // scalloped edge
  const cx = STAND.x, cz = STAND.z, i0 = Math.floor(cx * F), j0 = Math.floor(cz * F), y = Hf[j0][i0];
  const o = V3(wx(cx) - (W * VS) / 2, y, wz(cz) - ((D + 1) * VS) / 2);
  m.mesh(cartMesh, o);
  // a heap of bananas on the tray, higher in the middle: a mound of plain yellow cubes in
  // varied shades and sizes, with detailed bananas on top
  const cube = (x, yy, z, sz, col) => cartMesh.cube(x, yy, z, sz, tint(col, r, 0.02));
  const top = o.y + (T + 1.5) * VS;   // the pile heaps just above the rim
  const mound = (u, v) => Math.max(0, 1 - ((u - 0.5) / 0.55) ** 2 - ((v - 0.5) / 0.55) ** 2);
  // everything stays inside the rim so nothing pokes through it
  const ix0 = o.x + VS, ix1 = o.x + (W - 1) * VS, iz0 = o.z + VS, iz1 = o.z + (D - 1) * VS;
  const uv = (x, z) => [(x - ix0) / (ix1 - ix0), (z - iz0) / (iz1 - iz0)];
  for (let n = 0; n < 260; n++) {
    const sz = 0.026 + r() * 0.03, x = ix0 + sz / 2 + r() * (ix1 - ix0 - sz), z = iz0 + sz / 2 + r() * (iz1 - iz0 - sz);
    cube(x, top - 0.03 + mound(...uv(x, z)) * 0.1 * r() + sz / 2, z, sz, BANANA_YEL[Math.floor(r() * 4)]);
  }
  for (let n = 0; n < 22; n++) {
    const s = 0.85 + r() * 0.25, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
    const ex = 0.065 * s * Math.abs(Math.cos(yaw)) + 0.02, ez = 0.065 * s * Math.abs(Math.sin(yaw)) + 0.02;
    const x = ix0 + ex + r() * Math.max(0, ix1 - ix0 - 2 * ex), z = iz0 + ez + r() * Math.max(0, iz1 - iz0 - 2 * ez);
    bananaCubes(cube, x, top + mound(...uv(x, z)) * 0.1 + 0.01, z, yaw, s, r);
  }
  cart = new THREE.Mesh(cartMesh.geometry(), vertexMat());
  cart.castShadow = cart.receiveShadow = true;
  world.add(cart);
  standHand.set(wx(cx), top + 0.1, o.z + (D * VS) / 2);
  for (let j = Math.floor((cz - 0.5) * F); j <= Math.floor((cz + 0.35) * F); j++) for (let i = Math.floor((cx - 0.7) * F); i <= Math.floor((cx + 0.7) * F); i++) if (inF(i, j)) solidF[j][i] = 1;
}
// cherry blossoms around the library: spaced along its outline with some jitter in spacing
// and distance, skipping paths, stairs and ground off its level
for (const b of BUILDINGS.filter((q) => q.shape === 'suzzallo')) {
  const x0 = b.x0 - 0.75, x1 = b.x0 + b.w + 0.75, z0 = b.z0 - 0.75, z1 = b.z0 + b.d + 0.75;
  const ring = [];
  for (let x = x0; x <= x1; x += 0.95) ring.push([x, z0], [x, z1]);
  for (let z = z0 + 0.95; z < z1 - 0.4; z += 0.95) ring.push([x0, z], [x1, z]);
  for (const [px, pz] of ring) {
    const cx = px + (rnd() - 0.5) * 0.45, cz = pz + (rnd() - 0.5) * 0.45, i = Math.floor(cx * F), j = Math.floor(cz * F);
    if (!inF(i, j) || !land[j][i] || pathF[j][i] || stairF[j][i] || lotF[j][i] || solidF[j][i] || nearPath(cx, cz, 0.25) || Math.abs(Hf[j][i] - b.level) > 0.01) continue;
    tree(wx(cx), Hf[j][i], wz(cz), true);
    for (let jj = j - 1; jj <= j + 1; jj++) for (let ii = i - 1; ii <= i + 1; ii++) if (inF(ii, jj)) solidF[jj][ii] = 1;
  }
}
{
  const m = new THREE.Mesh(voxSolid.geometry(), vertexMat());
  m.castShadow = m.receiveShadow = true;
  world.add(m);
  world.add(new THREE.Mesh(voxGlow.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  snowCapMesh = new THREE.Mesh(snowCaps.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0 }));
  snowCapMesh.receiveShadow = true;
  snowCapMesh.visible = false;
  world.add(snowCapMesh);
}
dock();
sailboat(wx(X + 2.4), wz(22), 1.05);
sailboat(wx(X + 2.3), wz(9), 0.9);
bench(9 + O, 3, true);

// bollards: along the promenade's water edge, and every few steps along each path
for (let z = 1; z < Z; z += 2) { if (z >= 27 && z <= 29) continue; bollard(wx(shoreEdge(Math.floor((z + 0.5) * F))) - 0.26, 0, wz(z) + 0.5); }
// A low stone curb along the water's edge, following the shoreline; open where the pier
// meets it. It's laid as individual stones of varying length and tone, like the walls,
// with slightly darker joints between them.
{
  const W = 0.11, Hc = 0.09, onPier = (j) => j >= PIER.j0 && j < PIER.j1;
  const stoneTone = () => {
    const c = new THREE.Color(pick(C.stone)).offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.16);
    if (rnd() < 0.1) c.offsetHSL(0, -0.02, 0.08); else if (rnd() < 0.1) c.offsetHSL(0, 0, -0.08);
    return c;
  };
  let tone = stoneTone(), left = 0;
  const piece = (x0, z0, x1, z1, c) => {
    props.box(x0, 0, z0, x1, Hc, z1, c.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.03));
    props.box(x0 - 0.01, Hc, z0, x1 + 0.01, Hc + 0.02, z1, c.clone().offsetHSL(0, -0.03, 0.07 + (rnd() - 0.5) * 0.03));
  };
  for (let j = 0; j < FZ; j++) {
    if (onPier(j)) { left = 0; continue; }
    if (left <= 0) {   // start a new stone, with a joint before it
      tone = stoneTone();
      left = 2 + Math.floor(rnd() * 4);
      const e = wx(shoreEdge(j));
      props.box(e - W - 0.005, 0, fz(j) - 0.006, e + 0.005, Hc + 0.015, fz(j) + 0.006, tone.clone().offsetHSL(0, 0, -0.1));
    }
    left--;
    const e = wx(shoreEdge(j)), z0 = fz(j), z1 = fz(j + 1);
    piece(e - W, z0, e, z1, tone);
    // where the shoreline steps between rows, run the curb across the step
    if (j + 1 < FZ && !onPier(j + 1)) {
      const e2 = wx(shoreEdge(j + 1));
      if (Math.abs(e2 - e) > 1e-6) piece(Math.min(e, e2) - W, z1 - W / 2, Math.max(e, e2), z1 + W / 2, tone);
    }
  }
}
for (const line of PATHS) {
  let travelled = 1.2, side = 1;
  for (let k = 1; k < line.length; k++) {
    const [ax, az] = line[k - 1], [bx, bz] = line[k], len = Math.hypot(bx - ax, bz - az);
    for (; travelled < len; travelled += 2.6, side = -side) {
      const t = travelled / len, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const ox = px + (-(bz - az) / len) * 0.62 * side, oz = pz + ((bx - ax) / len) * 0.62 * side;
      const i = Math.floor(ox * F), j = Math.floor(oz * F);
      if (!inF(i, j) || !land[j][i] || pathF[j][i] || stairF[j][i] || solidF[j][i] || lotF[j][i]) continue;
      if (Math.abs(Hf[j][i] - Hf[Math.floor(pz * F)][Math.floor(px * F)]) > 0.01) continue;
      bollard(wx(ox), Hf[j][i], wz(oz));
    }
    travelled -= len;
  }
}
for (const [x, z, i] of [[13, 23, 2.2], [18, 27, 2.2], [11 + O, 8, 2], [X - 2, 13, 2], [X - 2, 22, 2]]) {
  const c = cellCenter(x, z);
  addLight(c.x, c.y + 0.7, c.z, i);
}

// Greenery goes on level grass only: away from paths, stairs, lots, props and terrace edges.
function clearGrass(x, z, margin = 0) {
  let h = null;
  for (let j = z * F - margin; j < (z + 1) * F + margin; j++)
    for (let i = x * F - margin; i < (x + 1) * F + margin; i++) {
      if (!inF(i, j) || !land[j][i] || pathF[j][i] || stairF[j][i] || lotF[j][i] || solidF[j][i]) return false;
      if (h === null) h = Hf[j][i]; else if (Math.abs(Hf[j][i] - h) > 1e-6) return false;
    }
  return true;
}
const plant = (x, z, px, pz) => { tree(px, cellHeight(x, z), pz); for (let j = z * F + 1; j < z * F + 3; j++) for (let i = x * F + 1; i < x * F + 3; i++) solidF[j][i] = 1; };
const TREES = [[1, 2], [3, 1], [11, 1], [17, 2], [16, 6], [1, 7], [6, 9], [12, 9], [1, 14], [4, 16], [12, 16], [9, 19], [5, 19],
  [1, 21], [0, 30], [7, 31], [12, 31], [17, 30], [3, 12], [10, 4], [18, 8], [18, 17], [13, 19]].map(([x, z]) => [x + O, z]);
for (const [x, z] of TREES) if (x < X && clearGrass(x, z, 1)) plant(x, z, wx(x) + 0.5, wz(z) + 0.5);
for (let z = 0; z < Z; z++)
  for (let x = 0; x < X; x++) {
    if (!clearGrass(x, z)) continue;
    if (clearGrass(x, z, 1) && rnd() < 0.36) { plant(x, z, wx(x) + 0.5 + (rnd() - 0.5) * 0.3, wz(z) + 0.5 + (rnd() - 0.5) * 0.3); continue; }
    if (rnd() < 0.65) flowers(wx(x) + 0.5, cellHeight(x, z), wz(z) + 0.5, 10 + Math.floor(rnd() * 12));
  }
// is a fine cell free grass (not path, stairs, lot or something solid)?
// Shrubs only keep other planting off their spot (bushF); you can walk and drive through them.
const bushF = solidF.map((row) => new Uint8Array(row.length));
const freeGrass = (i, j) => inF(i, j) && land[j][i] && !pathF[j][i] && !stairF[j][i] && !lotF[j][i] && !solidF[j][i] && !bushF[j][i];
// Front gardens for the Painted Ladies: flowering bushes heaped with blooms, smaller
// shrubs and clusters of flowers in the strip between each house and the path, a blossom
// tree here and there, and a flowering hedge at each end of the row.
function floweringBush(px, py, pz, size = 1, bloom = pick(FLOWER)) {
  const r = (0.15 + rnd() * 0.06) * size, pal = pick(SHRUB);
  springSpec = { bloom: bloom, frac: 0.45, fresh: true };
  canopy(px, py + r * 0.6, pz, r, r * 0.75, r, pal, 0.065);
  for (let k = 0; k < 26 * size; k++) {   // blooms over the top and sides
    const a = rnd() * Math.PI * 2, u = 0.1 + rnd() * 0.9;
    const c = vary(rnd() < 0.85 ? bloom : '#efe7e3', 0.05);
    props.cube(px + Math.cos(a) * r * Math.sqrt(1 - u * u) * 0.95, py + r * 0.6 + u * r * 0.75, pz + Math.sin(a) * r * Math.sqrt(1 - u * u) * 0.95, 0.03 + rnd() * 0.015, c);
  }
}
{
  const freeAt = (x, z) => { const i = Math.floor(x * F), j = Math.floor(z * F); return inF(i, j) && land[j][i] && !pathF[j][i] && !stairF[j][i] && !lotF[j][i] && !solidF[j][i] && !bushF[j][i] ? [i, j] : null; };
  const BLOOMS = ['#a985b8', '#d88aa5', '#efe7e3', '#e6a0b4', '#b9a3cf'];
  const ladies = BUILDINGS.filter((b) => b.shape === 'lady');
  // around each house: flowering bushes, shrubs and flower clusters wherever there's free
  // ground near it (beside the stoop, the side yards the stagger opens up, across the path)
  const placed = [];
  for (const b of ladies) {
    const bloom = BLOOMS[b.k % BLOOMS.length];
    let n = 0;
    for (let tries = 0; tries < 220 && n < 9; tries++) {
      const x = b.x0 - 0.2 + rnd() * 3.0, z = b.z0 - 0.25 + rnd() * 1.75, c = freeAt(x, z);
      if (!c || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.28)) continue;
      const y = Hf[c[1]][c[0]], roll = rnd();
      if (roll < 0.55) floweringBush(wx(x), y, wz(z), 0.75 + rnd() * 0.4, rnd() < 0.6 ? bloom : pick(BLOOMS));
      else if (roll < 0.75) shrub(wx(x), y, wz(z), 0.7 + rnd() * 0.3);
      else flowers(wx(x), y, wz(z), 14);
      bushF[c[1]][c[0]] = 1; placed.push([x, z]); n++;
    }
  }
  // a blossom tree in front of every other house, across the path
  for (const b of ladies.filter((q) => q.k % 2 === 1)) {
    const x = b.x0 + 2.45, z = b.z0 + 0.6, c = freeAt(x, z);
    if (c && freeAt(x + 0.2, z) && freeAt(x - 0.2, z)) { tree(wx(x), Hf[c[1]][c[0]], wz(z), true); for (let jj = c[1] - 1; jj <= c[1] + 1; jj++) for (let ii = c[0] - 1; ii <= c[0] + 1; ii++) if (inF(ii, jj)) solidF[jj][ii] = 1; }
  }
}
// ---------- The plaza: benches, string lights on posts, and a dense ring of flowering bushes ----------
// (positions in cells; the paving runs about x 10.5-14.5, z 15.8-18.2)
const PLAZA_BENCHES = [{ x: 11.4, z: 15.95, face: 0 }, { x: 12.7, z: 15.95, face: 0 }, { x: 11.2, z: 18.05, face: Math.PI }];
const PLAZA_POSTS = [[10.75, 16.3], [13.25, 15.85], [14.3, 17.35], [12.4, 18.15], [10.6, 17.75]];
const blockAt = (x, z, r) => { for (let j = Math.floor((z - r) * F); j <= Math.floor((z + r) * F); j++) for (let i = Math.floor((x - r) * F); i <= Math.floor((x + r) * F); i++) if (inF(i, j)) solidF[j][i] = 1; };
for (const b of PLAZA_BENCHES) {
  // a slatted seat on two iron legs, with a backrest on the side away from the plaza
  const cx = wx(b.x), cz = wz(b.z), y = Hf[Math.floor(b.z * F)][Math.floor(b.x * F)], back = b.face === 0 ? -1 : 1;
  for (let k = 0; k < 3; k++) props.box(cx - 0.36, y + 0.2, cz - 0.1 + k * 0.07, cx + 0.36, y + 0.235, cz - 0.05 + k * 0.07, vary(C.wood[0], 0.04));
  for (const s of [-1, 1]) {
    props.box(cx + s * 0.3 - 0.025, y, cz - 0.1, cx + s * 0.3 + 0.025, y + 0.2, cz + 0.1, col('#2c2a28'));
    props.box(cx + s * 0.3 - 0.02, y + 0.2, cz + back * 0.1 - 0.02, cx + s * 0.3 + 0.02, y + 0.46, cz + back * 0.1 + 0.02, col('#2c2a28'));
  }
  for (const h of [0.33, 0.42]) props.box(cx - 0.36, y + h, cz + back * 0.1 - 0.015, cx + 0.36, y + h + 0.05, cz + back * 0.1 + 0.015, vary(C.wood[0], 0.04));
  b.y = y;
  blockAt(b.x, b.z, 0.2);
}
for (const [x, z] of PLAZA_POSTS) {   // slim dark posts with a little cap
  const y = Hf[Math.floor(z * F)][Math.floor(x * F)];
  props.box(wx(x) - 0.025, y, wz(z) - 0.025, wx(x) + 0.025, y + 1.05, wz(z) + 0.025, col('#2c2622'));
  props.box(wx(x) - 0.04, y + 1.05, wz(z) - 0.04, wx(x) + 0.04, y + 1.08, wz(z) + 0.04, col('#3a322c'));
  blockAt(x, z, 0.05);
}
{
  const BLOOMS = ['#d88aa5', '#efe7e3', '#a985b8', '#e6a0b4', '#e8ca8c', '#c76f98'], placed = [];
  const nearPaving = (i, j) => { for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (inF(i + di, j + dj) && pathF[j + dj][i + di] === 2) return true; return false; };
  for (let tries = 0; tries < 900 && placed.length < 30; tries++) {
    const x = 9.6 + rnd() * 5.6, z = 15.0 + rnd() * 4.2, i = Math.floor(x * F), j = Math.floor(z * F);
    if (!inF(i, j) || !land[j][i] || pathF[j][i] || stairF[j][i] || lotF[j][i] || solidF[j][i] || bushF[j][i] || !nearPaving(i, j)) continue;
    if (Math.abs(Hf[j][i] - L1) > 0.01 || placed.some(([a, c]) => Math.hypot(a - x, c - z) < 0.26)) continue;
    if (rnd() < 0.75) floweringBush(wx(x), Hf[j][i], wz(z), 0.75 + rnd() * 0.4, pick(BLOOMS)); else flowers(wx(x), Hf[j][i], wz(z), 16);
    bushF[j][i] = 1; placed.push([x, z]);
  }
}

// shrubs scattered over the grass, and lining both sides of every path
for (let n = 0; n < 260; n++) {
  const cx = rnd() * PROM_X, cz = rnd() * Z, i = Math.floor(cx * F), j = Math.floor(cz * F);
  if (freeGrass(i, j)) { shrub(wx(cx), Hf[j][i], wz(cz), 0.8 + rnd() * 0.6); bushF[j][i] = 1; }
}
for (const line of PATHS)
  for (let k = 1; k < line.length; k++) {
    const [ax, az] = line[k - 1], [bx, bz] = line[k], len = Math.hypot(bx - ax, bz - az);
    for (let t = rnd() * 0.6; t < len; t += 0.55 + rnd() * 0.7)
      for (const s of [-1, 1]) {
        if (rnd() < 0.45) continue;
        const px = ax + ((bx - ax) * t) / len + (-(bz - az) / len) * 0.68 * s, pz = az + ((bz - az) * t) / len + ((bx - ax) / len) * 0.68 * s;
        const i = Math.floor(px * F), j = Math.floor(pz * F);
        if (!freeGrass(i, j)) continue;
        if (rnd() < 0.6) shrub(wx(px), Hf[j][i], wz(pz), 0.7 + rnd() * 0.4); else flowers(wx(px), Hf[j][i], wz(pz), 8);
      }
  }
// planting along the tops of terrace walls
for (let j = 1; j < FZ - 1; j++)
  for (let i = 1; i < X * F - 1; i++) {
    if (!freeGrass(i, j) || rnd() > 0.09) continue;
    const drop = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => land[j + dj][i + di] && Hf[j][i] - Hf[j + dj][i + di] > 0.3);
    if (!drop) continue;
    if (rnd() < 0.55) shrub(fx(i) + 0.125, Hf[j][i], fz(j) + 0.125, 0.75); else flowers(fx(i) + 0.125, Hf[j][i], fz(j) + 0.125, 6);
  }
// small rocks in the grass
for (let n = 0; n < 140; n++) {
  const cx = rnd() * PROM_X, cz = rnd() * Z, i = Math.floor(cx * F), j = Math.floor(cz * F);
  if (freeGrass(i, j)) rock(wx(cx), Hf[j][i], wz(cz));
}

// grass tufts anywhere there's grass, on whichever level it's on
for (let z = 0; z < Z; z++)
  for (let x = 0; x < X; x++) { tufts(x, z); tufts(x, z); }

{
  const p = new THREE.Mesh(props.geometry(), vertexMat());
  p.castShadow = p.receiveShadow = true;
  world.add(p);
  const f = new THREE.Mesh(fine.geometry(), windMat(0.05, 0.12));   // blades are lit as if facing up, like the ground
  f.receiveShadow = true;
  world.add(f);
  const l = new THREE.Mesh(leaves.geometry(), windMat(0.035, 1.2));
  leafMesh = l;
  l.castShadow = l.receiveShadow = true;
  world.add(l);
  world.add(new THREE.Mesh(glowBits.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  world.add(new THREE.Mesh(reflections.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true })));
}

// ---------- Wind ----------
// A vertex-colour material whose vertices sway with a gentle travelling breeze. `amp` is the
// sway in world units; `ref` is the height over which sway grows from nothing (so blade
// roots and tree trunks stay put).
const windUniforms = { uTime: { value: 0 } };
function windMat(amp, ref) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float lift = clamp(fract(wp.y + 0.001) / ${ref.toFixed(3)}, 0.0, 1.0);
      float gust = 0.6 + 0.4 * sin(uTime * 0.7 + wp.x * 0.15 - wp.z * 0.1);
      float w = sin(uTime * 2.2 + wp.x * 1.3 + wp.z * 0.9) * gust;
      transformed.x += w * ${amp.toFixed(3)} * lift;
      transformed.z += w * ${(amp * 0.6).toFixed(3)} * lift;`);
  };
  return m;
}

// ---------- Ambient life: birds, butterflies, fireflies, water sparkles ----------
const life = new THREE.Group();
world.add(life);
// birds: little V shapes that flap, in small flocks crossing the sky on long loops
const birds = [];
{
  const wing = new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), V3(-0.18, 0, -0.05), V3(-0.16, 0, 0.05)]);
  const mat = new THREE.MeshBasicMaterial({ color: '#2a2420', side: THREE.DoubleSide });
  for (let f = 0; f < 3; f++) {
    const centre = V3(wx(GX / 2) + (rnd() - 0.5) * 8, 6 + rnd() * 2.5, wz(Z / 2) + (rnd() - 0.5) * 8), radius = 9 + rnd() * 6;
    for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) {
      const b = new THREE.Group(), l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat);
      r.scale.x = -1;
      b.add(l, r);
      life.add(b);
      birds.push({ b, l, r, centre, radius, speed: 0.08 + rnd() * 0.03, phase: f * 2.1, off: V3((rnd() - 0.5) * 1.2, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 1.2), flap: rnd() * 6 });
    }
  }
}
// butterflies: pairs of tiny wings fluttering around the flower beds
const butterflies = [];
{
  const wing = new THREE.PlaneGeometry(0.06, 0.05).translate(0.03, 0, 0);
  for (let n = 0; n < 26; n++) {
    let cx, cz, y;
    for (let tries = 0; tries < 40; tries++) {
      cx = rnd() * PROM_X; cz = rnd() * Z;
      const i = Math.floor(cx * F), j = Math.floor(cz * F);
      if (inF(i, j) && land[j][i] && !pathF[j][i] && !stairF[j][i]) { y = Hf[j][i]; break; }
    }
    const mat = new THREE.MeshBasicMaterial({ color: pick(['#f2e6c9', '#f0b54a', '#e98aa8', '#a9c6e8']), side: THREE.DoubleSide });
    const b = new THREE.Group(), l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat);
    r.rotation.y = Math.PI;
    b.add(l, r);
    life.add(b);
    butterflies.push({ b, l, r, home: V3(wx(cx), y + 0.25, wz(cz)), phase: rnd() * 10, speed: 0.6 + rnd() * 0.5 });
  }
}
// fireflies: soft warm points drifting low over the grass
const fireflies = [];
{
  const pts = [];
  for (let n = 0; n < 140; n++) {
    let cx, cz, y = 0;
    for (let tries = 0; tries < 40; tries++) {
      cx = rnd() * PROM_X; cz = rnd() * Z;
      const i = Math.floor(cx * F), j = Math.floor(cz * F);
      if (inF(i, j) && land[j][i]) { y = Hf[j][i]; break; }
    }
    fireflies.push({ home: V3(wx(cx), y + 0.2 + rnd() * 0.5, wz(cz)), phase: rnd() * 20 });
    pts.push(V3(0, 0, 0));
  }
  var fireflyPoints = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.PointsMaterial({ color: '#ffdf8a', size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
  life.add(fireflyPoints);
}
// sparkles on the water: short bright dashes that fade in and out
const sparkles = [];
{
  const mat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, depthWrite: false });
  for (let n = 0; n < 40; n++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12 + rnd() * 0.12, 0.025).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), mat.clone());
    const z = rnd() * Z, x = X + rnd() * (GX - X);
    m.position.set(wx(x), WATER_Y + 0.006, wz(z));
    life.add(m);
    sparkles.push({ m, phase: rnd() * 10, speed: 0.6 + rnd() * 0.8 });
  }
}
// chimney smoke: little grey voxel puffs that rise, swell, drift with the breeze and fade
const smoke = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const c of chimneys) for (let n = 0; n < 16; n++) {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color('#e4dfd7').offsetHSL(0, 0, (rnd() - 0.5) * 0.08), emissive: '#4a453f', transparent: true, depthWrite: false }));
    life.add(m);
    smoke.push({ m, c, phase: n / 16 + rnd() * 0.03, spin: rnd() * 6, side: (rnd() - 0.5) * 0.08 });
  }
}
function updateLife(t, dt) {
  windUniforms.uTime.value = t;
  for (const s of birds) {
    const a = t * s.speed + s.phase;
    const p = V3(Math.cos(a) * s.radius, Math.sin(a * 2) * 0.4, Math.sin(a) * s.radius).add(s.centre).add(s.off);
    const ahead = V3(-Math.sin(a), 0, Math.cos(a));
    s.b.position.copy(p);
    s.b.rotation.set(0, Math.atan2(ahead.x, ahead.z) + Math.PI / 2, 0);
    const f = Math.sin(t * 9 + s.flap) * 0.7;
    s.l.rotation.x = f; s.r.rotation.x = f;
  }
  for (const b of butterflies) {
    const k = t * b.speed + b.phase;
    b.b.position.set(b.home.x + Math.sin(k * 1.3) * 0.5, b.home.y + Math.sin(k * 2.7) * 0.12 + 0.05, b.home.z + Math.cos(k * 0.9) * 0.5);
    b.b.rotation.y = k * 1.3;
    const f = Math.sin(t * 22 + b.phase) * 1.1;
    b.l.rotation.z = f; b.r.rotation.z = -f;
  }
  const fp = fireflyPoints.geometry.attributes.position;
  fireflies.forEach((f, i) => {
    const k = t * 0.4 + f.phase;
    fp.setXYZ(i, f.home.x + Math.sin(k) * 0.4, f.home.y + Math.sin(k * 1.7) * 0.15, f.home.z + Math.cos(k * 0.8) * 0.4);
  });
  fp.needsUpdate = true;
  fireflyPoints.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.3);
  for (const s of smoke) {
    const k = (t * 0.12 + s.phase) % 1;   // 0 at the chimney mouth, 1 when it has faded away
    s.m.position.set(s.c.x + k * 0.55 + s.side + Math.sin(k * 7 + s.spin) * 0.04, s.c.y + k * 1.1, s.c.z - k * 0.25 + s.side);
    s.m.scale.setScalar(0.1 + k * 0.26);
    s.m.rotation.set(s.spin + k, s.spin * 0.7 + k * 1.3, 0);
    s.m.material.opacity = Math.min(1, k * 10) * (1 - k) ** 1.2 * 0.9;
  }
  for (const s of sparkles) s.m.material.opacity = Math.max(0, Math.sin(t * s.speed + s.phase)) ** 3 * 0.9;
}

// ---------- Player ----------
const player = makeHuman();   // brown hair, black t-shirt and pants, white shoes
const START = [12, 16];   // spawn in the middle of the plaza
player.group.position.copy(cellCenter(...START));
world.add(player.group);
let path = [];
let destination = null;   // the place we're walking to, if any

const marker = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 20), new THREE.MeshBasicMaterial({ color: '#ededed' }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
world.add(marker);

// ---------- Walking: heights, steps and pathfinding (on the fine grid) ----------
const walkableF = (i, j) => inF(i, j) && (land[j][i] || dockF[j][i]) && !solidF[j][i];
const STEP = 0.25;   // the biggest height change you can step up or down
const canStepF = (ai, aj, bi, bj) => walkableF(bi, bj) && Math.abs(Hf[aj][ai] - Hf[bj][bi]) <= STEP;
function canMoveF(ai, aj, bi, bj) {
  const di = bi - ai, dj = bj - aj;
  if (!di || !dj) return canStepF(ai, aj, bi, bj);
  return canStepF(ai, aj, ai + di, aj) && canStepF(ai, aj, ai, aj + dj) && canStepF(ai + di, aj, bi, bj) && canStepF(ai, aj + dj, bi, bj);
}
function heightAt(p) {
  const [i, j] = fineOf(p);
  return inF(i, j) ? Hf[j][i] : 0;
}
function nearestWalkable(i, j) {
  for (let r = 0; r < Math.max(FX, FZ); r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++)
        if (Math.max(Math.abs(di), Math.abs(dj)) === r && walkableF(i + di, j + dj)) return [i + di, j + dj];
  return null;
}
// A* over fine cells; paths and paving cost less, so walkers keep to them.
function findPath(from, to) {
  const N = FX * FZ, key = (i, j) => j * FX + i;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const h = (i, j) => { const a = Math.abs(i - to[0]), b = Math.abs(j - to[1]); return (Math.max(a, b) + 0.414 * Math.min(a, b)) * 0.5; };
  const heap = [];   // binary heap of [f, key]
  const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  g[key(...from)] = 0;
  push(h(...from), key(...from));
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const ci = k % FX, cj = Math.floor(k / FX);
    if (ci === to[0] && cj === to[1]) {
      const out = [];
      for (let c = k; c !== -1; c = came[c]) out.push([c % FX, Math.floor(c / FX)]);
      return out.reverse();
    }
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if ((!di && !dj) || !canMoveF(ci, cj, ci + di, cj + dj)) continue;
        const ni = ci + di, nj = cj + dj, nk = key(ni, nj);
        const ng = g[k] + (di && dj ? 1.414 : 1) * (pathF[nj][ni] || stairF[nj][ni] ? 0.5 : 1);
        if (ng < g[nk]) { g[nk] = ng; came[nk] = k; push(ng + h(ni, nj), nk); }
      }
  }
  return null;
}

const R = 0.18;   // walker radius
// A position is fine if every corner of the footprint is on walkable ground that you can
// step to from where you are.
function canStand(p, from) {
  const [fi, fj] = fineOf(from);
  for (const [ox, oz] of [[0, 0], [-R, -R], [R, -R], [-R, R], [R, R]]) {
    const [i, j] = fineOf({ x: p.x + ox, z: p.z + oz });
    if (!walkableF(i, j) || Math.abs(Hf[j][i] - Hf[fj][fi]) > STEP) return false;
  }
  return true;
}
function lineClear(a, b) {
  const steps = Math.ceil(a.distanceTo(b) / 0.08);
  let prev = a.clone();
  for (let k = 1; k <= steps; k++) {
    const p = V3(0, 0, 0).lerpVectors(a, b, k / steps);
    if (!canStand(p, prev)) return false;
    prev = p;
  }
  return true;
}
const fineCenterXZ = ([i, j]) => V3(fx(i) + 0.5 / F, 0, fz(j) + 0.5 / F);
const cellToFine = ([x, z]) => [Math.floor(x * F + F / 2), Math.floor(z * F + F / 2)];

// A smoothed list of points from a world position to a fine cell, or null if unreachable.
function planPath(fromPos, target) {
  const start = fineOf(fromPos);
  const goal = walkableF(...target) ? target : nearestWalkable(...target);
  const cells = goal && findPath(walkableF(...start) ? start : nearestWalkable(...start), goal);
  if (!cells) return null;
  const pts = cells.map(fineCenterXZ);
  const smooth = [];
  let from = fromPos.clone().setY(0);
  for (let k = 0; k < pts.length;) {
    let m = Math.min(pts.length - 1, k + 40);   // look ahead a limited distance; keeps the bends of winding paths
    while (m > k && !lineClear(from, pts[m])) m--;
    smooth.push(pts[m]);
    from = pts[m];
    k = m + 1;
  }
  return smooth;
}

function walkTo(target, place = null) {
  const smooth = planPath(player.group.position, target);
  if (!smooth) return;
  path = smooth;
  destination = place;
  const last = smooth[smooth.length - 1];
  marker.position.set(last.x, heightAt(last) + 0.02, last.z);
  marker.visible = true;
  // walking somewhere zooms in to at least ZOOM_WALK
  zoomOf.follow = Math.max(zoomOf.follow, ZOOM_WALK);
  follow();
}

// ---------- NPCs ----------
// A few people strolling between spots on the paths, pausing to look around.
// Clothes use the palette: Dark Coffee, Stone Brown, Grey Olive, Silver, Silver 2.
const PALETTE = { coffee: '#2d241d', stone: '#625141', olive: '#807262', silver: '#b0a9a1', silver2: '#bcb5ad' };
const NPCS = [
  { start: [9 + O, 28], look: { skin: '#e3b893', hair: '#cd9b66', hairStyle: 'long', beard: 'none', height: 0.95, shirt: PALETTE.silver2, pants: PALETTE.stone, shoes: PALETTE.coffee } },
  { start: [PROM_X + 1, 9], look: { skin: '#906239', hair: '#1d1712', hairStyle: 'bald', beard: 'full', beardColor: '#1d1712', build: 1.06, shirt: PALETTE.olive, pants: PALETTE.coffee, shoes: PALETTE.silver } },
  { start: [5 + O, 11], look: { skin: '#dcaa7f', hair: '#2b2019', hairStyle: 'bun', beard: 'none', height: 0.93, shirt: PALETTE.stone, pants: PALETTE.silver, shoes: PALETTE.coffee } },
  { start: [12 + O, 17], look: { skin: '#b47f51', hair: '#3d3a37', hairStyle: 'short', beard: 'none', shirt: PALETTE.coffee, pants: PALETTE.olive, shoes: PALETTE.silver2 } },
  { start: [7 + O, 5], look: { skin: '#cc9f77', hair: '#5c3d22', hairStyle: 'middle', beard: 'none', height: 0.97, shirt: PALETTE.silver, pants: PALETTE.coffee, shoes: PALETTE.stone } },
  { start: [20, 13], look: { skin: '#e9c6a4', hair: '#8a5a3a', hairStyle: 'long', beard: 'none', height: 0.94, shirt: PALETTE.olive, pants: PALETTE.silver2, shoes: PALETTE.coffee } },
  { start: [25, 6], look: { skin: '#7a4f30', hair: '#1a1410', hairStyle: 'short', beard: 'goatee', beardColor: '#1a1410', shirt: PALETTE.silver2, pants: PALETTE.stone, shoes: PALETTE.coffee } },
  { start: [26, 20], look: { skin: '#d8a27a', hair: '#c9c0b0', hairStyle: 'short', beard: 'full', beardColor: '#c9c0b0', build: 1.05, shirt: PALETTE.stone, pants: PALETTE.coffee, shoes: PALETTE.silver } },
];
// pairs standing together and chatting: [cell, cell]
const CHATS = [[[14, 23], [15, 23]], [[25, 26], [25, 27]], [[10, 12], [11, 12]]];
const CHAT_LOOKS = [
  { skin: '#c9946c', hair: '#3b2a1d', hairStyle: 'bun', beard: 'none', height: 0.94, shirt: PALETTE.silver, pants: PALETTE.olive, shoes: PALETTE.coffee },
  { skin: '#a8714b', hair: '#241a14', hairStyle: 'short', beard: 'goatee', beardColor: '#241a14', shirt: PALETTE.coffee, pants: PALETTE.silver2, shoes: PALETTE.silver },
  { skin: '#e3c09c', hair: '#6b4a2c', hairStyle: 'middle', beard: 'none', shirt: PALETTE.olive, pants: PALETTE.coffee, shoes: PALETTE.stone },
  { skin: '#8d5a3c', hair: '#1d1612', hairStyle: 'long', beard: 'none', height: 0.95, shirt: PALETTE.silver2, pants: PALETTE.stone, shoes: PALETTE.coffee },
  { skin: '#d9a882', hair: '#cdb79a', hairStyle: 'short', beard: 'none', shirt: PALETTE.stone, pants: PALETTE.olive, shoes: PALETTE.silver2 },
  { skin: '#b47f51', hair: '#2b2019', hairStyle: 'bald', beard: 'full', beardColor: '#2b2019', shirt: PALETTE.silver, pants: PALETTE.coffee, shoes: PALETTE.coffee },
];
// NPCs stroll between paved spots.
const STROLL_CELLS = [];
for (let j = 0; j < FZ; j += 2) for (let i = 0; i < FX; i += 2) if (pathF[j][i] && walkableF(i, j)) STROLL_CELLS.push([i, j]);
const NPC_SPEED = 0.55, NPC_PACE = NPC_SPEED / SPEED * 1.6;   // a slow stroll, with steps to match
// Someone sitting on the edge of the pier near its end, legs over the water, looking out
// at the nearer sailboat.
const sitter = makeHuman({ skin: '#c9946c', hair: '#3b2a1d', hairStyle: 'short', beard: 'none', sitting: true,
  shirt: PALETTE.silver2, pants: PALETTE.stone, shoes: PALETTE.coffee });
{
  const hipY = 0.9 * (0.74 / 1.79);   // hip height in the character's own scale
  sitter.group.position.set(fx(PIER.i1) - 0.85, 0.04 + 0.03 - hipY, fz(PIER.j0) + 0.06);
  sitter.group.rotation.y = Math.PI;   // facing -z, toward the boat
  world.add(sitter.group);
  const [si, sj] = fineOf(sitter.group.position);
  for (let j = sj; j <= sj + 1; j++) for (let k = si - 1; k <= si + 1; k++) if (inF(k, j)) solidF[j][k] = 1;
}
// People sitting on the plaza benches, three cats, and string lights between the posts.
const HIP_Y_STAND = 0.9 * (0.74 / 1.79);
const benchSitters = [];
[[0, -0.17, { skin: '#d9a882', hair: '#2a1f1a', hairStyle: 'bun', beard: 'none', shirt: '#b9a88f', pants: PALETTE.coffee, shoes: PALETTE.silver }],
 [0, 0.17, { skin: '#8d5a3c', hair: '#1d1612', hairStyle: 'short', beard: 'full', beardColor: '#1d1612', shirt: PALETTE.olive, pants: PALETTE.stone, shoes: PALETTE.coffee }],
 [2, 0.05, { skin: '#e0b896', hair: '#c9a46a', hairStyle: 'long', beard: 'none', shirt: PALETTE.silver2, pants: '#4a525a', shoes: PALETTE.coffee }]].forEach(([bi, off, look]) => {
  const b = PLAZA_BENCHES[bi], h = makeHuman({ ...look, sitting: true });
  const fwd = b.face === 0 ? 1 : -1;
  h.group.position.set(wx(b.x) + off, b.y + 0.235 - HIP_Y_STAND, wz(b.z) - fwd * 0.02);
  h.group.rotation.y = b.face;
  world.add(h.group);
  benchSitters.push(h);
});
// cats: a few boxes each, with a tail that sways; one sits, one loafs, one strolls the plaza
const cats = [];
function makeCat(color, pose) {
  const g = new THREE.Group(), c = new THREE.Color(color), m = new THREE.MeshLambertMaterial({ color: c }), dark = new THREE.MeshLambertMaterial({ color: c.clone().offsetHSL(0, 0, -0.06) });
  const box = (w, h, d, x, y, z, mat = m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
  const legs = [];
  if (pose === 'sit') {
    box(0.07, 0.085, 0.07, 0, 0.045, -0.01);                       // upright body
    box(0.06, 0.03, 0.05, 0, 0.012, 0.03);                         // haunches/paws
    box(0.06, 0.055, 0.055, 0, 0.11, 0.015);                       // head
  } else {
    box(0.06, pose === 'loaf' ? 0.045 : 0.055, 0.13, 0, pose === 'loaf' ? 0.025 : 0.065, 0);   // body
    box(0.055, 0.05, 0.05, 0, pose === 'loaf' ? 0.05 : 0.095, 0.075);   // head
    if (pose === 'walk') for (const [x, z] of [[-0.02, 0.045], [0.02, 0.045], [-0.02, -0.045], [0.02, -0.045]]) legs.push(box(0.016, 0.045, 0.016, x, 0.022, z, dark));
  }
  const hy = pose === 'sit' ? 0.11 : pose === 'loaf' ? 0.05 : 0.095, hz = pose === 'sit' ? 0.015 : 0.075;
  for (const s of [-1, 1]) box(0.014, 0.022, 0.012, s * 0.017, hy + 0.035, hz, dark);   // ears
  const tail = new THREE.Group();
  tail.position.set(0, pose === 'sit' ? 0.01 : pose === 'loaf' ? 0.03 : 0.08, -0.06);
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.1), dark); t.position.z = -0.05; tail.add(t);
  if (pose !== 'sit') tail.rotation.x = pose === 'walk' ? -0.9 : 0;
  g.add(tail);
  return { g, tail, legs, pose, phase: rnd() * 6 };
}
{
  const at = (x, z) => V3(wx(x), Hf[Math.floor(z * F)][Math.floor(x * F)], wz(z));
  const sitCat = makeCat('#1c1b1d', 'sit'); sitCat.g.position.copy(at(13.2, 16.25)); sitCat.g.rotation.y = 2.4;
  const loafCat = makeCat('#8d8f93', 'loaf'); loafCat.g.position.copy(at(11.9, 18.0)); loafCat.g.rotation.y = -0.6;
  const walkCat = makeCat('#7a5236', 'walk'); walkCat.walk = true;
  for (const c of [sitCat, loafCat, walkCat]) { world.add(c.g); cats.push(c); }
}
function updateCats(t) {
  for (const c of cats) {
    c.tail.rotation.y = Math.sin(t * (c.walk ? 3 : 1.4) + c.phase) * (c.pose === 'sit' ? 0.5 : 0.35);
    if (c.pose === 'sit') c.tail.rotation.x = 0.15;
    if (!c.walk) continue;
    // a slow, wandering lap around the middle of the plaza, pausing now and then
    const k = t * 0.09 + Math.sin(t * 0.21) * 0.6, x = 12.4 + Math.cos(k) * 1.1, z = 17.05 + Math.sin(k) * 0.55;
    const nx = 12.4 + Math.cos(k + 0.01) * 1.1, nz = 17.05 + Math.sin(k + 0.01) * 0.55;
    c.g.position.set(wx(x), Hf[Math.floor(z * F)][Math.floor(x * F)], wz(z));
    c.g.rotation.y = Math.atan2(wx(nx) - wx(x), wz(nz) - wz(z));
    c.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 9 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5; });
  }
}
// string lights: a sagging wire between post tops with warm bulbs along it
const bulbs = [];
{
  const P = PLAZA_POSTS.map(([x, z]) => V3(wx(x), Hf[Math.floor(z * F)][Math.floor(x * F)] + 1.02, wz(z)));
  const spans = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [1, 3]];
  const wire = [], BULB = ['#ffd38a', '#ffe2b0', '#ffc070', '#fff0d0'];
  const bulbGeo = new THREE.BoxGeometry(0.035, 0.045, 0.035);
  for (const [a, b] of spans) {
    const A = P[a], B = P[b], len = A.distanceTo(B), sag = 0.1 + len * 0.06, n = Math.round(len / 0.14);
    for (let k = 0; k <= 20; k++) { const t = k / 20; wire.push(V3(0, 0, 0).lerpVectors(A, B, t).setY(A.y + (B.y - A.y) * t - sag * 4 * t * (1 - t))); if (k > 0 && k < 20) wire.push(wire[wire.length - 1].clone()); }
    for (let k = 1; k < n; k++) {
      const t = k / n, p = V3(0, 0, 0).lerpVectors(A, B, t); p.y = A.y + (B.y - A.y) * t - sag * 4 * t * (1 - t) - 0.03;
      const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: BULB[k % 4] }));
      m.position.copy(p); world.add(m); bulbs.push({ m, base: new THREE.Color(BULB[k % 4]), phase: rnd() * 10 });
    }
  }
  world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: '#1e1a17' })));
  addLight(wx(12.3), L1 + 0.9, wz(17.0), 1.4);
}
function updateBulbs(t) {
  for (const b of bulbs) b.m.material.color.copy(b.base).multiplyScalar(0.85 + 0.15 * Math.sin(t * 2.2 + b.phase));
}

// a banana that flies from the cart into your hands when you click the cart
const banana = new THREE.Group();
{
  const r = mulberry32(11);
  bananaCubes((x, y, z, s, c) => { const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: c })); b.position.set(x, y, z); banana.add(b); }, 0, 0, 0, 0, 1, r);
  banana.visible = false;
  world.add(banana);
}
const toss = { t: -1, dur: 0.6, from: V3() };
function tossBanana() {
  toss.t = 0; toss.from.copy(standHand); banana.visible = true;
  toss.dur = 0.45 + Math.min(1.2, toss.from.distanceTo(player.group.position) * 0.12);
}
function updateBanana(dt) {
  if (toss.t < 0) return;
  toss.t += dt;
  const p = player.group.position, k = Math.min(1, toss.t / toss.dur), yaw = player.group.rotation.y;
  const hand = V3(p.x + Math.sin(yaw) * 0.09 + Math.cos(yaw) * 0.08, p.y + 0.34, p.z + Math.cos(yaw) * 0.09 - Math.sin(yaw) * 0.08);
  banana.position.lerpVectors(toss.from, hand, k).y += Math.sin(k * Math.PI) * (0.3 + toss.dur * 0.3);
  banana.rotation.set(0, yaw + Math.PI / 2, k < 1 ? toss.t * 12 : 0.4);
  if (toss.t > toss.dur + 3.5) { toss.t = -1; banana.visible = false; }
}
const npcs = NPCS.map(({ start, look }) => {
  const h = makeHuman(look);
  h.group.position.copy(cellCenter(...start));
  h.group.rotation.y = rnd() * Math.PI * 2;
  world.add(h.group);
  return { h, path: [], wait: 2 + rnd() * 8 };
});
// chatting pairs: each faces the other, and their spot is blocked for walkers
const chatters = [];
CHATS.forEach(([a, b], k) => {
  const pa = cellCenter(...a), pb = cellCenter(...b);
  [[pa, pb], [pb, pa]].forEach(([me, other], i) => {
    const h = makeHuman(CHAT_LOOKS[(k * 2 + i) % CHAT_LOOKS.length]);
    const dir = other.clone().sub(me), p = me.clone().addScaledVector(dir, 0.3);
    h.group.position.set(p.x, cellHeight(...(i ? b : a)), p.z);
    const face = Math.atan2(dir.x, dir.z);
    h.group.rotation.y = face;
    world.add(h.group);
    chatters.push({ h, face, phase: rnd() * 6 });
    const [ci, cj] = fineOf(h.group.position);
    for (let jj = cj - 1; jj <= cj; jj++) for (let ii = ci - 1; ii <= ci; ii++) if (inF(ii, jj)) solidF[jj][ii] = 1;
  });
});

function updateNpc(n, dt) {
  const pos = n.h.group.position;
  let moving = false;
  if (n.path.length) {
    const next = n.path[0], dx = next.x - pos.x, dz = next.z - pos.z, dist = Math.hypot(dx, dz), step = NPC_SPEED * dt;
    if (dist <= step) { pos.x = next.x; pos.z = next.z; n.path.shift(); if (!n.path.length) n.wait = 6 + rnd() * 6; }
    else {
      pos.x += (dx / dist) * step; pos.z += (dz / dist) * step;
      let d = Math.atan2(dx, dz) - n.h.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      n.h.group.rotation.y += d * Math.min(1, dt * 10);
      moving = true;
    }
  } else if ((n.wait -= dt) <= 0) {
    // wander a few steps to somewhere nearby
    const [ci, cj] = fineOf(pos);
    const near = STROLL_CELLS.filter(([i, j]) => { const d = Math.hypot(i - ci, j - cj) / F; return d >= 1.5 && d <= 4.5; });
    n.path = planPath(pos, pick(near.length ? near : STROLL_CELLS)) || [];
    n.wait = 2;
  }
  pos.y = heightAt(pos);
  n.h.update(dt, moving, { lookAround: !moving, pace: NPC_PACE });
}

// ---------- Camera ----------
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
const HOME_TARGET = V3(WATER_W / 2, 0.2, 0);
const view = { zoom: 1, target: HOME_TARGET.clone() };
const want = { zoom: 1, target: HOME_TARGET.clone() };
let mode = 'overview';
let width = 1, height = 1;

function aimCamera(cam, t) {
  const d = 60;
  cam.position.set(t.x + Math.sin(YAW) * Math.cos(PITCH) * d, t.y + Math.sin(PITCH) * d, t.z + Math.cos(YAW) * Math.cos(PITCH) * d);
  cam.lookAt(t);
}
// Fit the island and the water beside it at zoom 1.
const BOUNDS = [[wx(0), wx(GX)], [BASE_Y, 4.5], [wz(0), wz(Z)]];
function fitHalfHeight() {
  const cam = new THREE.OrthographicCamera();
  aimCamera(cam, HOME_TARGET);
  cam.updateMatrixWorld();
  let mx = 0, my = 0;
  for (const x of BOUNDS[0]) for (const y of BOUNDS[1]) for (const z of BOUNDS[2]) {
    const p = V3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    mx = Math.max(mx, Math.abs(p.x)); my = Math.max(my, Math.abs(p.y));
  }
  return Math.max(my, mx / (width / height)) * 1.04;
}
let fitHalf = 16;
function placeCamera() {
  aimCamera(camera, view.target);
  const hh = fitHalf / view.zoom, hw = hh * (width / height);
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
}
// Each mode keeps its own zoom; the scroll wheel changes the current one.
const zoomOf = { overview: 1, follow: FOLLOW_ZOOM };
const ZOOM_RANGE = { overview: [0.8, 7], follow: [1.2, 7] };
const ZOOM_WALK = 3.6;   // walking somewhere zooms in at least this far
const overviewTarget = HOME_TARGET.clone();
function follow() {
  mode = 'follow';
  overviewBtn.classList.add('show');
}
function overview() {
  mode = 'overview';
  zoomOf.overview = 1;
  overviewTarget.copy(HOME_TARGET);
  overviewBtn.classList.remove('show');
}
overviewBtn.addEventListener('click', (e) => { e.stopPropagation(); overview(); });

// ---------- Dithered rendering ----------
const dither = createDither(renderer, { levels: LEVELS, pix: PIX, background: BG });

function resize() {
  width = stage.clientWidth; height = stage.clientHeight;
  dither.setSize(width, height);
  fitHalf = fitHalfHeight();
  placeCamera();
}
new ResizeObserver(resize).observe(stage);
resize();

// ---------- Labels & events ----------
// The sidebar sends `village:go` (a place id, or 'overview'); the village sends
// `village:select` when a building lot is clicked and `village:arrive` when the player
// stops at a place.
const LABELLED = [];
for (const b of BUILDINGS) {   // one label per section, above the middle of its building(s)
  if (!b.id) continue;
  let L = LABELLED.find((q) => q.id === b.id);
  if (!L) LABELLED.push(L = { id: b.id, name: b.name, n: 0, labelAnchor: V3(0, 0, 0) });
  L.labelAnchor.x = (L.labelAnchor.x * L.n + b.center.x) / (L.n + 1); L.labelAnchor.z = (L.labelAnchor.z * L.n + b.center.z) / (L.n + 1);
  L.labelAnchor.y = Math.max(L.labelAnchor.y, b.level + b.h); L.n++;
}
for (const L of LABELLED) {   // float each title just above the top of its actual building
  const g = outlineMeshes.find((m) => m.userData.id === L.id)?.geometry;
  if (g) { g.computeBoundingBox(); L.labelAnchor.y = g.boundingBox.max.y + 0.12; }
}
const select = (id) => dispatchEvent(new CustomEvent('village:select', { detail: id }));
// the dock can be hovered and clicked too: you run out and hop down to sit at the end, facing the boats
{
  const m = new Mesher(), y = 0.04;
  m.box(fx(PIER.i0), y - 0.11, fz(PIER.j0), fx(PIER.i1), y, fz(PIER.j1), col('#fff'), { bottom: true });
  const g = m.geometry(), pick = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  pick.visible = false; pick.userData.id = 'dock';
  world.add(pick); outlineMeshes.push(pick);
  const mask = new THREE.Mesh(g, maskMat);
  mask.visible = false; mask.userData.id = 'dock'; mask.matrixAutoUpdate = false;
  hoverScene.add(mask);
  LABELLED.push({ id: 'dock', name: 'The dock', labelAnchor: V3((fx(PIER.i0) + fx(PIER.i1)) / 2, 0.55, (fz(PIER.j0) + fz(PIER.j1)) / 2) });
}
for (const p of LABELLED) {
  const el = document.createElement('button');
  el.className = 'label';
  el.textContent = p.name;
  el.addEventListener('click', (e) => { e.stopPropagation(); select(p.id); });
  labelsEl.appendChild(el);
  p.labelEl = el;
}
// Hops: short jumps along an arc from where you are to a spot (onto the dock's edge to sit,
// back up from sitting, into and out of the car). While hopping or seated you don't walk.
let hop = null, seated = false, sitBlend = 0, afterStand = null;
const HIP_Y = 0.9 * (0.74 / 1.79);   // hip height of a standing figure
const SEAT = { x: fx(PIER.i1) - 0.45, z: fz(PIER.j0) + 0.06 }, SEAT_STAND = { x: fx(PIER.i1) - 0.45, z: fz(PIER.j0) + 0.42 };
function startHop(to, { dur = 0.42, height = 0.32, face = null, sit = 0, onDone = null } = {}) {
  const p = player.group.position;
  hop = { from: p.clone(), to, t: 0, dur, height, fromYaw: player.group.rotation.y, face, sitFrom: sitBlend, sitTo: sit, onDone };
  path = []; marker.visible = false; body.vel.set(0, 0, 0); body.air = false; body.vy = 0; body.squashV += 6;
}
function updateHop(dt) {
  const h = hop, p = player.group.position;
  h.t += dt;
  const k = Math.min(1, h.t / h.dur), e = k * k * (3 - 2 * k);
  p.x = h.from.x + (h.to.x - h.from.x) * e; p.z = h.from.z + (h.to.z - h.from.z) * e;
  p.y = h.from.y + (h.to.y - h.from.y) * k + Math.sin(Math.PI * k) * h.height;
  if (h.face !== null) { const d = Math.atan2(Math.sin(h.face - h.fromYaw), Math.cos(h.face - h.fromYaw)); player.group.rotation.y = h.fromYaw + d * e; }
  sitBlend = h.sitFrom + (h.sitTo - h.sitFrom) * e;
  body.airPose = Math.sin(Math.PI * k) * (1 - sitBlend);
  if (k >= 1) { hop = null; body.squashV -= 5; h.onDone?.(); }
}
// run to the dock (sprinting if asked), then hop down to sit on its edge facing the boats
function goSit(sprint) {
  if (seated) return;
  sprinting = sprint;
  walkTo(fineOf(SEAT_STAND), { id: 'dock', sit: true });
}
function sitDown() {
  startHop(V3(SEAT.x, 0.04 + 0.03 - HIP_Y, SEAT.z), { face: Math.PI, sit: 1, height: 0.22, dur: 0.45, onDone: () => { seated = true; } });
}
function standUp(then = null) {
  if (!seated || hop) return;
  seated = false; afterStand = then;
  startHop(V3(SEAT_STAND.x, heightAt(SEAT_STAND), SEAT_STAND.z), { sit: 0, height: 0.35, dur: 0.4, onDone: () => { const f = afterStand; afterStand = null; f?.(); } });
}
const standUpThen = (f) => (seated ? standUp(f) : f());

// Clicking a building sends you sprinting to it; every other way of getting there walks.
let sprintNext = false, sprinting = false;
function goTo(id) {
  const p = PLACES.find((q) => q.id === id);
  const sprint = sprintNext;
  sprintNext = false;
  if (id === 'dock') return standUpThen(() => goSit(sprint));
  if (p) standUpThen(() => { sprinting = sprint; walkTo(cellToFine(p.door), p); });
}
addEventListener('village:go', (e) => (e.detail === 'overview' ? overview() : goTo(e.detail)));

let activeId = null, arrivedId = null;
function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  for (const p of LABELLED) p.labelEl.classList.toggle('active', p.id === id);
}
const v = new THREE.Vector3();
function updateLabels() {
  for (const p of LABELLED) {
    v.copy(p.labelAnchor).project(camera);
    p.labelEl.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -100%)`;
  }
}

// ---------- Input ----------
const keys = new Set();
const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
  if (KEYS[e.code]) { keys.add(KEYS[e.code]); e.preventDefault(); }
  if (e.code === 'Space' && !e.repeat && !e.target.closest?.('button, a')) { jumpQueued = 0.15; e.preventDefault(); }
  if (e.code === 'Escape') overview();
});
addEventListener('keyup', (e) => keys.delete(KEYS[e.code]));
addEventListener('blur', () => keys.clear());

// ---------- A Mini to drive ----------
// A black Mini with a floating white roof and white bonnet stripes, parked on the promenade.
// Walk up to it and a bubble says Enter; press Enter to get in, and the bubble shows the
// arrow keys and fades. The arrow keys (or WASD) drive; Enter gets you out again.
const car = {
  group: new THREE.Group(), body: new THREE.Group(), wheels: [], steerers: [], vel: V3(0, 0, 0), yaw: -Math.PI / 4, yawRate: 0,   // parked at an angle to the promenade
  y: 0, vy: 0, air: false, tilt: 0, fs: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, bob: 0, bobV: 0, steer: 0, driving: false, held: [],
};
car.group.rotation.order = 'YXZ';
const CAR_SCALE = 1.2;   // the model is built at 1; everything below scales with it
car.group.scale.setScalar(CAR_SCALE);
{
  // a few clean boxes: a low black body with a bonnet sloping to the nose, a narrower cabin
  // set in from the sides with a raked windscreen, a thin white roof cap, twin bonnet
  // stripes, round headlights, black wheel arches and wheels pushed out to the corners
  const b = new Mesher(), BLACK = '#1d1d21', TRIM = '#121214', WHITE = '#ecebe6', GLASSC = '#77878f';
  b.box(-0.33, 0.06, -0.165, 0.2, 0.175, 0.165, col(BLACK));                    // body
  b.box(0.2, 0.06, -0.165, 0.33, 0.155, 0.165, col(BLACK));                     // bonnet, a step lower
  b.box(0.17, 0.155, -0.165, 0.26, 0.165, 0.165, col(BLACK));                   // bonnet slope
  for (const x of [-0.22, 0.22]) b.box(x - 0.085, 0.06, -0.178, x + 0.085, 0.13, 0.178, col(TRIM));   // wheel arches
  b.box(-0.315, 0.175, -0.145, 0.15, 0.225, 0.145, col(GLASSC));                // glass, lower
  b.box(-0.31, 0.225, -0.14, 0.1, 0.268, 0.14, col(GLASSC));                    // glass, upper (raked screen)
  b.box(-0.318, 0.175, -0.147, -0.26, 0.268, 0.147, col(BLACK));                // thick rear pillars
  b.box(-0.08, 0.175, -0.147, -0.055, 0.268, 0.147, col(BLACK));                // middle pillars
  b.box(-0.325, 0.268, -0.152, 0.11, 0.288, 0.152, col(WHITE));                 // thin white roof cap
  for (const z of [-0.065, 0.03]) {                                              // stripes
    b.box(0.2, 0.155, z, 0.332, 0.16, z + 0.035, col(WHITE));
    b.box(0.17, 0.165, z, 0.2, 0.17, z + 0.035, col(WHITE));
  }
  b.box(0.33, 0.075, -0.06, 0.336, 0.125, 0.06, col(TRIM));                     // grille
  b.box(0.33, 0.06, -0.165, 0.34, 0.075, 0.165, col(TRIM));                      // front bumper
  b.box(-0.34, 0.06, -0.165, -0.33, 0.075, 0.165, col(TRIM));                    // rear bumper
  for (const z of [-0.15, 0.125]) b.box(-0.336, 0.1, z, -0.33, 0.15, z + 0.025, col('#c0302a'));   // tail lights
  for (const z of [-0.168, 0.148]) b.box(0.09, 0.18, z, 0.12, 0.205, z + 0.02, col(WHITE));         // mirror caps
  const body = new THREE.Mesh(b.geometry(), vertexMat());
  body.castShadow = body.receiveShadow = true;
  car.body.add(body);
  const lampM = new THREE.MeshBasicMaterial({ color: '#fff1cf' }), rimM = new THREE.MeshLambertMaterial({ color: '#cfccc5' });
  for (const z of [-0.11, 0.11]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 14).rotateZ(Math.PI / 2), rimM), lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 14).rotateZ(Math.PI / 2), lampM);
    rim.position.set(0.333, 0.115, z); lamp.position.set(0.336, 0.115, z);
    car.body.add(rim, lamp);
  }
  car.group.add(car.body);
  const tyre = new THREE.MeshLambertMaterial({ color: '#141414' }), hubM = new THREE.MeshLambertMaterial({ color: '#bdbbb5' });
  for (const x of [-0.22, 0.22]) for (const side of [-1, 1]) {
    const pivot = new THREE.Group(), w = new THREE.Group();
    w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.055, 16).rotateX(Math.PI / 2), tyre));
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.058), hubM);   // a spoke bar, so you can see it turn
    w.add(hub, new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.06, 0.058), hubM));
    pivot.position.set(x, 0.068, side * 0.165);
    pivot.add(w);
    car.group.add(pivot);
    car.wheels.push(w);
    if (x > 0) car.steerers.push(pivot);
  }
  world.add(car.group);
}
const carDir = (yaw = car.yaw) => V3(Math.cos(yaw), 0, -Math.sin(yaw));
const carSide = (yaw = car.yaw) => V3(-Math.sin(yaw), 0, -Math.cos(yaw));
const CAR_PTS = [[0, 0], [0.33, 0.16], [0.33, -0.16], [-0.33, 0.16], [-0.33, -0.16], [0.33, 0], [-0.33, 0], [0, 0.17], [0, -0.17]].map(([a, c]) => [a * CAR_SCALE, c * CAR_SCALE]);
const carPt = (p, yaw, [a, c]) => { const f = carDir(yaw), sd = carSide(yaw); return { x: p.x + f.x * a + sd.x * c, z: p.z + f.z * a + sd.z * c }; };
// The car fits if every point of its footprint is on land outside the buildings and no point
// climbs more than a step from where that same point was. It drives straight through trees,
// bushes and props; spanning a staircase is fine, and so is driving off a ledge (it falls);
// driving up a terrace wall is not.
const drivableF = (i, j) => inF(i, j) && (land[j][i] || dockF[j][i]) && !lotF[j][i];
function carFits(p, yaw, from, fromYaw = yaw) {
  for (const k of CAR_PTS) {
    const [i, j] = fineOf(carPt(p, yaw, k)), [oi, oj] = fineOf(carPt(from, fromYaw, k));
    if (!drivableF(i, j) || !inF(oi, oj) || Hf[j][i] - Hf[oj][oi] > STEP + 0.01) return false;
  }
  return true;
}
// Ground under the car, averaged over each axle so stairs read as a smooth ramp.
function carGround(p, yaw) {
  const h = (a) => { let t = 0; for (const da of [-0.06, 0, 0.06]) for (const c of [-0.14, 0, 0.14]) t += heightAt(carPt(p, yaw, [a + da, c])); return t / 9; };
  const hf = h(0.22 * CAR_SCALE), hb = h(-0.22 * CAR_SCALE);
  return { y: (hf + hb) / 2, tilt: Math.atan2(hf - hb, 0.44 * CAR_SCALE) };
}
{
  const start = V3(wx(PROM_X + 1.6), 0, wz(15.5)), gr = carGround(start, car.yaw);
  car.group.position.set(start.x, gr.y, start.z);
  car.y = gr.y; car.tilt = gr.tilt;
  car.group.rotation.set(0, car.yaw, car.tilt);
}
// while parked, the car blocks walkers like any other object
function parkCar() {
  const p = car.group.position, f = carDir(), sd = carSide();
  for (let a = -0.35 * CAR_SCALE; a <= 0.35 * CAR_SCALE; a += 0.1) for (let c = -0.18 * CAR_SCALE; c <= 0.18 * CAR_SCALE; c += 0.09) {
    const [i, j] = fineOf({ x: p.x + f.x * a + sd.x * c, z: p.z + f.z * a + sd.z * c });
    if (inF(i, j) && !solidF[j][i]) { solidF[j][i] = 1; car.held.push([i, j]); }
  }
}
function unparkCar() { for (const [i, j] of car.held) solidF[j][i] = 0; car.held = []; }
parkCar();

// dust kicked up by the rear wheels when you drift or floor it
const dust = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (let n = 0; n < 40; n++) {
    const q = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color('#c9b394').offsetHSL(0, 0, (rnd() - 0.5) * 0.08), transparent: true, depthWrite: false, opacity: 0 }));
    q.visible = false;
    world.add(q);
    dust.push({ q, life: 0, v: V3(0, 0, 0) });
  }
}
let dustNext = 0, dustAcc = 0;
function puff(at, push) {
  const d = dust[dustNext = (dustNext + 1) % dust.length];
  d.life = 1; d.q.visible = true;
  d.q.position.set(at.x + (rnd() - 0.5) * 0.06, at.y + 0.04, at.z + (rnd() - 0.5) * 0.06);
  d.v.set(push.x * 0.4 + (rnd() - 0.5) * 0.3, 0.35 + rnd() * 0.25, push.z * 0.4 + (rnd() - 0.5) * 0.3);
  d.spin = rnd() * 6;
}
function updateDust(dt) {
  for (const d of dust) {
    if (d.life <= 0) continue;
    d.life -= dt * 1.4;
    if (d.life <= 0) { d.q.visible = false; continue; }
    d.q.position.addScaledVector(d.v, dt);
    d.v.multiplyScalar(Math.exp(-dt * 2.5));
    const k = 1 - d.life;
    d.q.scale.setScalar(0.04 + k * 0.1);
    d.q.rotation.set(d.spin + k * 2, d.spin, 0);
    d.q.material.opacity = Math.min(1, d.life * 1.6) * 0.7;
  }
}
const spring = (x, v, target, k, c, dt) => { v += (k * (target - x) - c * v) * dt; return [x + v * dt, v]; };
function driveCar(dt) {
  const gas = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0), steer = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
  const p = car.group.position, prevFs = car.fs;
  // steering turns the heading; the velocity keeps going its own way until the tyres grip
  car.steer += (steer - car.steer) * Math.min(1, dt * 10);
  const want = car.steer * 2.7 * Math.max(-1, Math.min(1, car.fs / 1.3));
  car.yawRate += (want - car.yawRate) * Math.min(1, dt * 7);
  const newYaw = car.yaw + car.yawRate * dt;
  if (carFits(p, newYaw, p, car.yaw)) car.yaw = newYaw; else car.yawRate = 0;
  const f = carDir(), sd = carSide();
  let fs = car.vel.dot(f), ls = car.vel.dot(sd);
  if (gas > 0) fs += (fs < 0 ? 8 : 5.5) * dt;
  else if (gas < 0) fs -= (fs > 0 ? 8 : 3) * dt;
  else fs *= Math.exp(-dt * 1.1);
  fs = Math.max(-1.6, Math.min(3.8, fs));
  const grip = 10 - Math.min(7.5, Math.abs(car.yawRate * fs) * 1.5);   // less grip in hard, fast turns: drift
  ls *= Math.exp(-grip * dt);
  car.vel.copy(f).multiplyScalar(fs).addScaledVector(sd, ls);
  car.fs = fs;
  // move, sliding along walls; bounce back off anything head-on
  const step = car.vel.clone().multiplyScalar(dt);
  const tryMove = (dx, dz) => { const n = V3(p.x + dx, 0, p.z + dz); if (!carFits(n, car.yaw, p)) return false; p.x = n.x; p.z = n.z; return true; };
  if (!tryMove(step.x, step.z)) {
    if (tryMove(step.x, 0)) car.vel.z *= -0.2;
    else if (tryMove(0, step.z)) car.vel.x *= -0.2;
    else { car.vel.multiplyScalar(-0.4); car.bobV += 0.6 + Math.abs(fs) * 0.3; car.rollV += (rnd() - 0.5) * 3; }
  }
  // ride height and tilt follow the averaged ground; off a ledge the car falls, nose
  // dipping, and lands with a bounce. The body sits on springs.
  const gr = carGround(p, car.yaw), dy = gr.y - car.y;
  if (car.air || dy < -0.06) {
    car.air = true;
    car.vy -= 9.8 * dt;
    car.y += car.vy * dt;
    car.tilt += (-0.25 - car.tilt) * Math.min(1, dt * 2.5);
    if (car.y <= gr.y) {
      const hit = -car.vy;
      car.y = gr.y; car.air = false;
      car.vy = hit > 1.6 ? hit * 0.28 : 0;   // a little hop on a hard landing
      if (car.vy) car.air = true;
      car.bobV -= hit * 0.35; car.pitchV -= hit * 0.6;
      for (const c of [-0.17, 0.17]) for (const a of [-0.25, 0.25]) puff(V3(0, 0, 0).copy(carPt(p, car.yaw, [a, c])).setY(gr.y), V3(c * 4, 0, a * 2));
    }
  } else {
    car.vy = 0;
    car.y += dy * Math.min(1, dt * 12);
    car.tilt += (gr.tilt - car.tilt) * Math.min(1, dt * 10);
    if (Math.abs(dy) > 0.01) car.bobV -= dy * 3;
  }
  [car.roll, car.rollV] = spring(car.roll, car.rollV, -ls * 0.08 - car.yawRate * fs * 0.03, 110, 9, dt);
  [car.pitch, car.pitchV] = spring(car.pitch, car.pitchV, ((fs - prevFs) / Math.max(dt, 1e-3)) * 0.008, 120, 10, dt);
  [car.bob, car.bobV] = spring(car.bob, car.bobV, 0, 160, 9, dt);
  p.y = car.y;
  car.group.rotation.set(0, car.yaw, car.tilt);
  car.body.rotation.set(Math.max(-0.12, Math.min(0.12, car.roll)), 0, Math.max(-0.08, Math.min(0.08, car.pitch)));
  car.body.position.y = Math.max(-0.03, Math.min(0.05, car.bob));
  for (const w of car.wheels) w.rotation.z -= (fs * dt) / (0.068 * CAR_SCALE);
  for (const s of car.steerers) s.rotation.y = car.steer * 0.45;
  // dust from the rear wheels when sliding or accelerating hard from low speed
  const kick = Math.abs(ls) > 0.45 || (gas > 0 && fs > 0.2 && fs < 1.6);
  if (kick && (dustAcc += dt) > 0.035) {
    dustAcc = 0;
    if (!car.air) for (const c of [-0.17, 0.17]) puff(V3(0, 0, 0).copy(carPt(p, car.yaw, [-0.24 * CAR_SCALE, c])).setY(p.y), f.clone().multiplyScalar(-Math.sign(fs || 1)));
  }
  player.group.position.copy(p);
}
const bubble = document.createElement('div');
bubble.className = 'bubble hide';
labelsEl.appendChild(bubble);
const ENTER_HTML = '<kbd>Enter</kbd>';
const ARROWS_HTML = '<span class="arrows"><kbd style="grid-area: 1 / 2">&uarr;</kbd><kbd style="grid-area: 2 / 1">&larr;</kbd><kbd style="grid-area: 2 / 2">&darr;</kbd><kbd style="grid-area: 2 / 3">&rarr;</kbd></span>';
let bubbleTimer = 0;
const nearCar = () => !car.driving && player.group.position.distanceTo(car.group.position) < 0.9;
function updateCarBubble() {
  const show = car.driving ? bubbleTimer > clock.elapsedTime : nearCar();
  if (!car.driving && bubble.dataset.kind !== 'enter') { bubble.innerHTML = ENTER_HTML; bubble.dataset.kind = 'enter'; }
  bubble.classList.toggle('hide', !show);
  v.copy(car.group.position).setY(car.group.position.y + 0.62).project(camera);
  bubble.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -100%)`;
}
function enterCar() {
  unparkCar();
  car.driving = true; car.vel.set(0, 0, 0); car.fs = 0; car.yawRate = 0;
  path = []; destination = null; marker.visible = false;
  player.group.visible = false;
  bubble.innerHTML = ARROWS_HTML; bubble.dataset.kind = 'arrows';
  bubbleTimer = clock.elapsedTime + 2.6;
  follow();
}
function exitCar() {
  car.driving = false; car.vel.set(0, 0, 0); car.fs = 0; car.yawRate = 0; car.vy = 0; car.air = false;
  car.y = carGround(car.group.position, car.yaw).y; car.group.position.y = car.y;
  car.body.rotation.set(0, 0, 0); car.body.position.y = 0; car.roll = car.pitch = car.bob = car.rollV = car.pitchV = car.bobV = 0;
  for (const s of car.steerers) s.rotation.y = 0;
  const p = car.group.position, sd = carSide();
  let out = p.clone().addScaledVector(sd, 0.5);
  for (const side of [1, -1]) {
    const q = p.clone().addScaledVector(sd, 0.5 * side);
    if (canStand(q, p)) { out = q; break; }
  }
  // pop up out of the roof and hop down beside the car
  player.group.position.set(p.x, p.y + 0.28, p.z);
  player.group.visible = true;
  parkCar();
  startHop(V3(out.x, heightAt(out), out.z), { face: Math.atan2(out.x - p.x, out.z - p.z), height: 0.38, dur: 0.45 });
}
addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' || e.target.closest?.('input, textarea, button, a')) return;
  if (hop) return;
  if (car.driving) exitCar();
  else if (nearCar() && !seated) {
    // hop up and drop in through the roof
    const c = car.group.position;
    startHop(V3(c.x, c.y + 0.22, c.z), { face: Math.atan2(c.x - player.group.position.x, c.z - player.group.position.z), height: 0.42, dur: 0.42, onDone: enterCar });
  }
  else return;
  e.preventDefault();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function groundPoint(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects([groundMesh, pierPick])[0]?.point;
}
function groundCell(e) {
  const p = groundPoint(e);
  return p && fineOf(p);
}
const lotAt = (f) => (f && inF(...f) && lotF[f[1]][f[0]] ? BUILDINGS[lotF[f[1]][f[0]] - 1] : null);
const onCart = (e) => { groundPoint(e); return raycaster.intersectObject(cart).length > 0; };
// Click and drag to look around the world; a plain click still walks. In follow mode the
// view drifts back to you once you start moving again.
const panOffset = V3(0, 0, 0);
let drag = null, dragged = false;
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 0) { drag = { x: e.clientX, y: e.clientY }; dragged = false; } });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  dragged = true;
  drag.x = e.clientX; drag.y = e.clientY;
  const upp = (camera.top - camera.bottom) / height;   // world units per screen pixel
  const d = RIGHT.clone().multiplyScalar(-dx * upp).addScaledVector(UP, (dy * upp) / Math.sin(PITCH));
  if (mode === 'overview') overviewTarget.add(d); else panOffset.add(d);
  view.target.add(d);
  renderer.domElement.style.cursor = 'grabbing';
});
addEventListener('pointerup', () => { if (drag && dragged) renderer.domElement.style.cursor = 'default'; drag = null; });
renderer.domElement.addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; }
  if (car.driving) return;
  if (onCart(e)) return tossBanana();
  if (hop) return;
  const hit = buildingAt(e);
  if (hit === 'dock') { if (!seated) goSit(true); select('dock'); return; }
  if (hit) { sprintNext = true; select(hit); sprintNext = false; return; }
  const cell = groundCell(e);
  if (!cell) return;
  sprinting = false;
  standUpThen(() => walkTo(cell));
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (drag && dragged) return;
  setHover(car.driving ? null : buildingAt(e));
  renderer.domElement.style.cursor = onCart(e) || hovered ? 'pointer' : 'default';
});
renderer.domElement.addEventListener('pointerleave', () => setHover(null));
// which section's building is under the mouse (the nearest one hit)
function buildingAt(e) {
  groundPoint(e);
  return raycaster.intersectObjects(outlineMeshes, false)[0]?.object.userData.id || null;
}
let hovered = null;
function setHover(id) {
  if (id === hovered) return;
  hovered = id;
  for (const m of hoverScene.children) { m.visible = m.userData.id === id; m.matrix.copy(world.matrixWorld); }
  for (const p of LABELLED) p.labelEl.classList.toggle('show', p.id === id);
}

// Scroll (or pinch on a trackpad) to zoom. In the overview, zoom toward the cursor.
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [lo, hi] = ZOOM_RANGE[mode];
  const old = zoomOf[mode];
  const next = Math.min(hi, Math.max(lo, old * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
  zoomOf[mode] = next;
  if (mode !== 'overview') return;
  const p = groundPoint(e);
  if (p) overviewTarget.sub(p).multiplyScalar(old / next).add(p);
  overviewTarget.x = Math.min(wx(GX), Math.max(wx(0), overviewTarget.x));
  overviewTarget.z = Math.min(wz(Z), Math.max(wz(0), overviewTarget.z));
  overviewTarget.y = 0.4;
  overviewBtn.classList.toggle('show', next > 1.05);
}, { passive: false });

// Screen-relative directions on the ground for the isometric camera.
const UP = V3(-Math.sin(YAW), 0, -Math.cos(YAW));
const RIGHT = V3(Math.cos(YAW), 0, -Math.sin(YAW));

// ---------- Loop ----------
const clock = new THREE.Clock();
const move = new THREE.Vector3();
// The player moves with momentum: velocity eases toward where you're steering, so starts,
// stops and turns are smooth; the body leans into speed and turns, squashes and stretches,
// and jumps with Space (off ledges too, and up onto a terrace if you time it).
const body = { vel: V3(0, 0, 0), vy: 0, air: false, airPose: 0, lean: 0, bank: 0, squash: 0, squashV: 0, prevYaw: 0, coyote: 0 };
let jumpQueued = 0;
const GRAVITY = 30, JUMP_V = 7.4;   // apex ~0.9; falling pulls harder than rising
// Footprint fits at p for a body at height y: on land, and no corner higher than you can step
// (or, in the air, higher than your feet).
function fitsAt(p, y, inAir) {
  for (const [ox, oz] of [[0, 0], [-R, -R], [R, -R], [-R, R], [R, R]]) {
    const [i, j] = fineOf({ x: p.x + ox, z: p.z + oz });
    if (!walkableF(i, j) || Hf[j][i] - y > (inAir ? 0.03 : STEP)) return false;
  }
  return true;
}
// `free`: following a planned path (already clear), or stuck inside something, so skip collisions
function movePlayer(dt, want, free = false) {
  const pos = player.group.position, b = body, steered = free && path.length > 0;
  free = free || !fitsAt(pos, pos.y, b.air);
  // ease velocity toward the wanted velocity; quicker on the ground than in the air
  // weighty: a moment to get going, a slide to a stop, and turns that carry you wide;
  // reversing hard skids, kicking up dust and leaning back
  const sp0 = Math.hypot(b.vel.x, b.vel.z), wl = want.length();
  const against = sp0 > 1 && wl > 0 && (b.vel.x * want.x + b.vel.z * want.z) / (sp0 * wl) < -0.2;
  // following a click (a planned path) steers tightly so it never overshoots a turn or the target;
  // your own keys keep the full momentum
  const k = 1 - Math.exp(-dt * (b.air ? 2 : steered ? 14 : !wl ? 2.4 : against ? 3.2 : 3.6));
  b.vel.x += (want.x - b.vel.x) * k; b.vel.z += (want.z - b.vel.z) * k;
  if (!b.air && (against || (!wl && sp0 > 1.6)) && (b.skid = (b.skid || 0) + dt) > 0.05) {
    b.skid = 0;
    puff(V3(pos.x, pos.y, pos.z), V3(b.vel.x, 0, b.vel.z).multiplyScalar(0.15));
  }
  const nx = pos.clone().setX(pos.x + b.vel.x * dt);
  if (free || fitsAt(nx, pos.y, b.air)) pos.x = nx.x; else b.vel.x *= 0.2;
  const nz = pos.clone().setZ(pos.z + b.vel.z * dt);
  if (free || fitsAt(nz, pos.y, b.air)) pos.z = nz.z; else b.vel.z *= 0.2;
  // vertical: walk off an edge and you fall; Space jumps (with a moment's grace after an edge)
  const ground = heightAt(pos);
  if (!b.air && ground < pos.y - 0.08) { b.air = true; b.vy = 0; b.coyote = 0.1; }
  b.coyote = Math.max(0, b.coyote - dt);
  jumpQueued = Math.max(0, jumpQueued - dt);
  if (jumpQueued && (!b.air || b.coyote)) {
    jumpQueued = 0; b.coyote = 0; b.air = true; b.vy = JUMP_V; b.squashV += 7;
    for (const s of [-1, 1]) puff(V3(pos.x + s * 0.06, pos.y, pos.z), V3(s * 0.4, 0, 0));
  }
  if (b.air) {
    b.vy -= GRAVITY * (b.vy < 0 ? 1.5 : 1) * dt;
    pos.y += b.vy * dt;
    if (pos.y <= ground && b.vy <= 0) {
      const hit = -b.vy;
      pos.y = ground; b.air = false; b.vy = 0;
      b.squashV -= Math.min(14, 2 + hit * 1.6);
      if (hit > 4) for (const s of [-1, 1]) for (const t of [-1, 1]) puff(V3(pos.x + s * 0.08, pos.y, pos.z + t * 0.08), V3(s * 0.5, 0, t * 0.5));
    }
  } else pos.y += (ground - pos.y) * Math.min(1, dt * 18);   // ease up and down steps
  // facing, lean and squash
  const speed = Math.hypot(b.vel.x, b.vel.z);
  // turn toward travel (or, once arrived, toward the place), smoothly and at a capped rate
  const faceYaw = speed > 0.15 ? Math.atan2(b.vel.x, b.vel.z) : b.faceTo;
  if (faceYaw !== null && faceYaw !== undefined) {
    const d = Math.atan2(Math.sin(faceYaw - player.group.rotation.y), Math.cos(faceYaw - player.group.rotation.y));
    player.group.rotation.y += Math.max(-dt * 9, Math.min(dt * 9, d * Math.min(1, dt * 10)));
  }
  if (speed > 0.15 && want.lengthSq()) b.faceTo = null;
  let turn = player.group.rotation.y - b.prevYaw; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  b.prevYaw = player.group.rotation.y;
  const accel = (want.length() - speed) / SPEED;
  b.lean += ((speed / SPEED) * 0.22 + Math.max(-0.5, accel) * 0.3 - b.lean) * Math.min(1, dt * 8);
  b.bank += (-(turn / Math.max(dt, 1e-3)) * 0.035 * (speed / SPEED) - b.bank) * Math.min(1, dt * 8);
  b.bank = Math.max(-0.3, Math.min(0.3, b.bank));
  b.squashV += (-b.squash * 180 - b.squashV * 14) * dt;
  b.squash += b.squashV * dt;
  if (b.air) b.squash += (Math.max(-0.12, Math.min(0.15, b.vy * 0.02)) - b.squash) * Math.min(1, dt * 10);
  b.airPose += ((b.air ? 1 : 0) - b.airPose) * Math.min(1, dt * (b.air ? 12 : 18));
  const sq = Math.max(-0.3, Math.min(0.25, b.squash));
  player.tilt.rotation.set(b.air ? b.lean * 0.5 : b.lean, 0, b.bank);
  player.tilt.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
  return speed;
}
let hinted = false;

function update(dt) {
  const pos = player.group.position;
  move.set(0, 0, 0);
  if (car.driving) driveCar(dt);   // the arrow keys steer the car instead
  else {
    if (keys.has('up')) move.add(UP);
    if (keys.has('down')) move.sub(UP);
    if (keys.has('right')) move.add(RIGHT);
    if (keys.has('left')) move.sub(RIGHT);
  }

  if (move.lengthSq()) {
    path = []; destination = null; marker.visible = false; sprinting = false;
    move.normalize().multiplyScalar(SPEED);
    follow();
  } else if (path.length && !car.driving) {
    // steer toward the next point of the path, slowing into the last one
    const next = path[0];
    move.set(next.x - pos.x, 0, next.z - pos.z);
    const dist = move.length();
    if (dist < (path.length > 1 ? 0.3 : 0.05)) {
      path.shift();
      if (!path.length && destination?.sit) { destination = null; marker.visible = false; sprinting = false; move.set(0, 0, 0); body.vel.set(0, 0, 0); sitDown(); }
      else if (!path.length) { marker.visible = false; sprinting = false; body.vel.set(0, 0, 0); /* already crawling by now: stop dead on the spot */ move.set(0, 0, 0); if (destination) body.faceTo = Math.PI; }
    } else { const top = SPEED * (sprinting ? 2.2 : 1); move.multiplyScalar(Math.min(top, path.length > 1 ? top : dist * 4.5) / dist); }
  }
  let speed = 0;
  if (seated && (move.lengthSq() || jumpQueued)) { jumpQueued = 0; standUp(); }
  if (hop) updateHop(dt);
  else if (seated) move.set(0, 0, 0);
  else if (!car.driving) speed = movePlayer(dt, move, path.length > 0 && !keys.size);
  const moving = speed > 0.12;
  if (moving && !hinted) { hinted = true; setTimeout(() => hintEl.classList.add('hide'), 1200); }
  // cadence follows ground speed (about one full stride per 0.9 units), so the feet don't skate
  // sprinting lengthens the stride as well as quickening it, so the feet still match the ground
  const pace = Math.max(Math.min(1, speed / SPEED + 0.2), Math.min(1.7, speed / SPEED));
  player.update(dt, moving && !body.air && !hop, { stepRate: 1.5 + speed * 6.8 / Math.sqrt(pace), pace, air: body.airPose, sit: sitBlend, lookAround: seated });
  npcs.forEach((n) => updateNpc(n, dt));
  chatters.forEach((c) => { c.h.update(dt, false, { lookAround: false }); c.h.group.rotation.y = c.face + Math.sin(clock.elapsedTime * 0.8 + c.phase) * 0.15; });
  sitter.update(dt, false, { lookAround: true });
  benchSitters.forEach((h) => h.update(dt, false, { lookAround: true }));
  updateCats(clock.elapsedTime);
  updateBulbs(clock.elapsedTime);
  updateBanana(dt);
  updateCarBubble();
  updateDust(dt);

  // which place are we standing at?
  let here = null;
  for (const p of PLACES) {
    const [dx, dz] = p.door;
    if (Math.hypot(pos.x - (wx(dx) + 0.5), pos.z - (wz(dz) + 0.5)) < (p.cell ? 0.9 : 1.3)) here = p.id;
  }
  setActive(here);
  const idle = !moving && !path.length;
  if (!here) arrivedId = null;
  else if (idle && here !== arrivedId) {
    arrivedId = here;
    dispatchEvent(new CustomEvent('village:arrive', { detail: here }));
  }

  // camera eases toward the overview or toward the player
  want.zoom = zoomOf[mode];
  if (moving || path.length || (car.driving && Math.abs(car.fs) > 0.3)) panOffset.multiplyScalar(Math.exp(-dt * 2.5));
  if (mode === 'follow') want.target.set(pos.x, pos.y + 0.4, pos.z).add(panOffset);
  else want.target.copy(overviewTarget);
  want.target.x = Math.min(wx(GX), Math.max(wx(0), want.target.x));
  want.target.z = Math.min(wz(Z), Math.max(wz(0), want.target.z));
  const k = REDUCED_MOTION ? 1 : 1 - Math.exp(-dt * 4);
  const kz = REDUCED_MOTION ? 1 : 1 - Math.exp(-dt * 1.6);   // zoom eases more slowly than the camera pans
  view.zoom += (want.zoom - view.zoom) * kz;
  view.target.lerp(want.target, k);
  placeCamera();

  // lamps flicker a little; boats bob
  const t = clock.elapsedTime;
  pointLights.forEach((l, i) => { l.intensity = l.userData.base * (1 + Math.sin(t * 3 + i * 1.7) * 0.05); });
  boats.forEach(({ g, phase }) => { g.position.y = WATER_Y + Math.sin(t * 1.2 + phase) * 0.03; g.rotation.z = Math.sin(t * 0.9 + phase) * 0.03; });
  updateLife(t, dt);
}

// Debug readout of grid coordinates (cells, as used in the code: x 0..X, z 0..Z): where you
// are and what the cursor is over. Backquote toggles it.
const coordsEl = document.getElementById('coords');
let hoverPt = null;
renderer.domElement.addEventListener('pointermove', (e) => { hoverPt = groundPoint(e) || null; });
addEventListener('keydown', (e) => { if (e.code === 'Backquote') coordsEl.hidden = !coordsEl.hidden; });
const cellStr = (p) => `x ${(p.x + X / 2).toFixed(2)}  z ${(p.z + Z / 2).toFixed(2)}  y ${heightAt(p).toFixed(2)}`;
function updateCoords() {
  if (coordsEl.hidden) return;
  const p = car.driving ? car.group.position : player.group.position;
  coordsEl.textContent = `${car.driving ? 'car   ' : 'you   '}${cellStr(p)}\ncursor ${hoverPt ? cellStr(hoverPt) : '-'}`;
}

// ---------- Seasons and light/dark ----------
const SUN_WARM = sun.color.clone(), SUN_COLD = new THREE.Color('#f3ecdf');
const SKY_WARM = hemi.color.clone(), SKY_COLD = new THREE.Color('#c9d3df'), GROUND_WARM = hemi.groundColor.clone(), GROUND_COLD = new THREE.Color('#4e5560');
const leafShown = [-1, -1, -1, -1];
const LEAF_SETS = [Float32Array.from(leafSpring), Float32Array.from(leaves.c), Float32Array.from(leafAutumn), Float32Array.from(leafWinter)];
// blend the foliage's vertex colours between its four seasonal colourings
function setLeafSeason(w) {
  if (!leafMesh || w.every((v, i) => Math.abs(v - leafShown[i]) < 0.004)) return;
  w.forEach((v, i) => { leafShown[i] = v; });
  const a = leafMesh.geometry.attributes.color.array, [s0, s1, s2, s3] = LEAF_SETS;
  for (let k = 0; k < a.length; k++) a[k] = s0[k] * w[0] + s1[k] * w[1] + s2[k] * w[2] + s3[k] * w[3];
  leafMesh.geometry.attributes.color.needsUpdate = true;
}
// The season picker recolours the world in the dithering pass (see dither.js); winter also
// brings falling snow. Weights ease between seasons so a change fades in.
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const seasonW = SEASONS.map((s) => (s === (document.documentElement.dataset.season || 'spring') ? 1 : 0));
let seasonTarget = seasonW.slice();
addEventListener('village:season', (e) => { seasonTarget = SEASONS.map((s) => (s === e.detail ? 1 : 0)); });
const THEME_BG = { dark: [0, 0, 0], light: [0.953, 0.937, 0.906] };
const applyTheme = (t) => { dither.setBackground(THEME_BG[t] || THEME_BG.dark); dither.setOutlineColor(t === 'light' ? [0.11, 0.1, 0.09] : [0.96, 0.94, 0.9]); };
applyTheme(document.documentElement.dataset.theme);
addEventListener('village:theme', (e) => applyTheme(e.detail));
const SNOW_N = 1800, snowPos = new Float32Array(SNOW_N * 3), snowSeed = new Float32Array(SNOW_N);
for (let n = 0; n < SNOW_N; n++) {
  snowPos[n * 3] = wx(rnd() * GX); snowPos[n * 3 + 1] = rnd() * 4.5; snowPos[n * 3 + 2] = wz(rnd() * Z);
  snowSeed[n] = rnd() * 10;
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
snow.visible = false;
world.add(snow);
function updateSeason(dt) {
  const k = REDUCED_MOTION ? 1 : Math.min(1, dt * 1.8);
  for (let i = 0; i < 4; i++) seasonW[i] += (seasonTarget[i] - seasonW[i]) * k;
  const sum = seasonW.reduce((a, b) => a + b, 0) || 1;
  dither.setSeason(seasonW.map((w) => w / sum));
  setLeafSeason(seasonW.map((w) => w / sum));
  // winter light is cool and pale, so the snow reads white instead of sunset-orange
  const wl = seasonW[3] / sum;
  sun.color.copy(SUN_WARM).lerp(SUN_COLD, wl);
  hemi.color.copy(SKY_WARM).lerp(SKY_COLD, wl);
  hemi.groundColor.copy(GROUND_WARM).lerp(GROUND_COLD, wl);
  if (snowCapMesh) { const wv = seasonW[3] / sum; snowCapMesh.visible = wv > 0.02; snowCapMesh.material.opacity = Math.min(1, wv * 1.3); }
  const wi = seasonW[3] / sum;
  snow.visible = wi > 0.01;
  snow.material.opacity = Math.min(1, wi * 1.2) * 0.9;
  if (!snow.visible) return;
  const t = clock.elapsedTime;
  for (let n = 0; n < SNOW_N; n++) {
    let y = snowPos[n * 3 + 1] - dt * (0.35 + (snowSeed[n] % 1) * 0.25);
    if (y < 0) y += 4.5;
    snowPos[n * 3 + 1] = y;
    snowPos[n * 3] += Math.sin(t * 0.8 + snowSeed[n]) * dt * 0.08;
    snowPos[n * 3 + 2] += Math.cos(t * 0.6 + snowSeed[n] * 1.3) * dt * 0.08;
  }
  snowGeo.attributes.position.needsUpdate = true;
}

// A ring on the ground under the player (it stays on the ground when you jump, and fades
// as you rise), and an off-screen pointer: when you're out of view, your avatar sits at the
// edge of the screen with an arrow pointing toward you.
const youRing = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.215, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f4efe6', transparent: true, opacity: 0.75, depthWrite: false }));
world.add(youRing);
const pointer2 = document.createElement('div');
pointer2.className = 'you-pointer';
pointer2.innerHTML = '<span class="you-arrow"></span><img src="img/avatar@8x.png" alt="" />';
pointer2.addEventListener('click', (e) => { e.stopPropagation(); follow(); panOffset.set(0, 0, 0); });
labelsEl.appendChild(pointer2);
const pv = new THREE.Vector3();
function updateYouMarkers() {
  const p = car.driving ? car.group.position : player.group.position, g = heightAt(p);
  youRing.visible = !car.driving && !seated && !hop;
  youRing.position.set(p.x, g + 0.025, p.z);
  const lift = Math.max(0, p.y - g);
  youRing.scale.setScalar(1 + lift * 0.6);
  youRing.material.opacity = 0.75 / (1 + lift * 3);
  pv.set(p.x, p.y + 0.35, p.z).project(camera);
  const sx = ((pv.x + 1) / 2) * width, sy = ((1 - pv.y) / 2) * height, M = 48;
  const off = sx < 0 || sx > width || sy < 0 || sy > height;
  pointer2.classList.toggle('show', off);
  if (!off) return;
  // clamp to the edge along the line from the centre toward the player
  const cx = width / 2, cy = height / 2, dx = sx - cx, dy = sy - cy;
  const t = Math.min((cx - M) / Math.max(1e-6, Math.abs(dx)), (cy - M) / Math.max(1e-6, Math.abs(dy)));
  const ex = cx + dx * t, ey = cy + dy * t, ang = Math.atan2(dy, dx);
  pointer2.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%)`;
  pointer2.firstChild.style.transform = `rotate(${ang}rad) translateX(26px)`;
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  updateSeason(dt);
  dither.render(scene, camera, hovered ? hoverScene : null);
  updateLabels();
  updateCoords();
  updateYouMarkers();
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => {
  frame();
  document.getElementById('loader')?.classList.add('done');   // the first frame is drawn: lift the loader
});
if (window.__villageGo && window.__villageGo !== 'overview') goTo(window.__villageGo);   // a section opened before the world was ready
