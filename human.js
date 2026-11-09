// A reusable low-poly person, shaped from lathed profiles rather than boxes, with flat
// facets so it pixelates cleanly.
// Modelled in metres (about 1.78 m tall) and scaled down to village size.
// makeHuman(options) returns { group, update(dt, walking) }; `group` faces +z.
import * as THREE from 'three';

export const HUMAN_HEIGHT = 0.74;   // village units
const SCALE = HUMAN_HEIGHT / 1.79;

export const DEFAULTS = {
  skin: '#c08a66', hair: '#3b261a', hairStyle: 'middle', beard: 'none', beardColor: '#2e1c12',
  shirt: '#1f1f22', pants: '#17171a', shoes: '#ecebe6',
  height: 1, build: 1, sitting: false,
};

const materials = new Map();
function mat(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return materials.get(color);
}
const hairMaterials = new Map();
function hairMaterial(color) {   // two-sided, so the cut edge shows hair rather than a hole
  if (!hairMaterials.has(color))
    hairMaterials.set(color, new THREE.MeshLambertMaterial({ color, vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  return hairMaterials.get(color);
}
const shade = (hex, amt) => '#' + new THREE.Color(hex).offsetHSL(0, 0, amt).getHexString();

// A surface of revolution from [radius, y] pairs (listed bottom to top).
const lathe = (pts, segs = 8) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

function piece(parent, geo, color, [x, y, z] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Hair as one continuous piece: the head's own profile, slightly enlarged, kept only
// above a hairline. `line` gives the hairline height (head coordinates, 0–0.246) at
// angles around the head, from the front (0) to the back (π).
const HEAD_PROFILE = [[0.001, 0], [0.03, 0.004], [0.052, 0.02], [0.066, 0.045], [0.074, 0.08], [0.079, 0.12],
  [0.079, 0.16], [0.072, 0.2], [0.055, 0.228], [0.03, 0.242], [0.001, 0.246]];
const lerpTable = (table, x) => {
  for (let i = 1; i < table.length; i++)
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return table[table.length - 1][1];
};
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Builds the hair surface over the head and keeps only the triangles above the hairline,
// so the hair ends in a clean edge. `style` sets how far it stands off the head:
// `volume` on top, `flare` at the ends, and an optional darker `part` line down the middle.
function hairGeometry(line, { volume = 0, flare = 0, part = false } = {}) {
  const radiusAt = (y) => lerpTable(HEAD_PROFILE.map(([r, yy]) => [yy, r]), y);
  // Rows include every point of the head's own profile, so the hair stays outside the
  // head everywhere (evenly spaced rows alone let the head's corners poke through).
  const ys = new Set(HEAD_PROFILE.map(([, y]) => y).filter((y) => y >= 0.02));
  for (let i = 0; i <= 32; i++) ys.add(0.02 + (0.226 * i) / 32);
  const rows = [...ys].sort((a, b) => a - b).map((y) => new THREE.Vector2(radiusAt(y), y));
  rows.push(new THREE.Vector2(0, 0.247));   // close the crown to a point so there's no hole on top
  const geo = new THREE.LatheGeometry(rows, 32).toNonIndexed();
  const p = geo.attributes.position, n = p.count;
  const keep = new Uint8Array(n), shadeOf = new Float32Array(n), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    const r = Math.hypot(v.x, v.z), ang = Math.abs(Math.atan2(v.x, v.z)), y = v.y;   // ang: 0 front, π back
    keep[i] = y >= lerpTable(line, ang) ? 1 : 0;
    const side = smoothstep(0.5, 1.0, ang) * (1 - smoothstep(2.4, 3.0, ang));
    let off = 0.006 + volume * smoothstep(0.14, 0.24, y)              // fuller on top
      + flare * side * (1 - smoothstep(0.07, 0.17, y))                 // ends flick out at the sides
      + 0.008 * smoothstep(0.25, 0.5, ang) * (1 - smoothstep(0.9, 1.3, ang)) * smoothstep(0.14, 0.2, y); // curtains
    const onPart = part && ang < 0.07 && y > 0.195;
    if (part && ang < 0.14 && y > 0.19) off = Math.min(off, 0.006 + volume * 0.5);   // hair dips into the part
    shadeOf[i] = onPart ? 0.55 : 1;
    const k = r > 1e-5 ? (r * 1.03 + off) / r : 1;
    p.setXYZ(i, v.x * k, y + off * 0.5 * smoothstep(0.2, 0.246, y), v.z * k);
  }
  // keep a triangle if any of its corners is above the hairline
  const pos = [], col = [];
  for (let t = 0; t < n; t += 3) {
    if (!(keep[t] || keep[t + 1] || keep[t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
      col.push(shadeOf[t + k], shadeOf[t + k], shadeOf[t + k]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const HAIRLINES = {
  // flowy middle part: high at the part, falling over the corners of the forehead,
  // covering the ears and reaching the nape
  middle: [[0, 0.205], [0.12, 0.19], [0.35, 0.172], [0.7, 0.155], [1.1, 0.135], [1.45, 0.12], [2.0, 0.08], [Math.PI, 0.055]],
  short: [[0, 0.18], [0.8, 0.17], [1.25, 0.145], [1.6, 0.15], [2.2, 0.09], [Math.PI, 0.06]],
};

// Shared geometry (all characters reuse these).
const G = {
  torso: lathe([[0.15, 0.86], [0.148, 0.95], [0.152, 1.05], [0.168, 1.18], [0.18, 1.28], [0.184, 1.35],
    [0.16, 1.405], [0.1, 1.45], [0.056, 1.47]]),
  thigh: new THREE.CylinderGeometry(0.06, 0.06, 0.46, 6),
  shin: new THREE.CylinderGeometry(0.06, 0.06, 0.43, 6),
  head: lathe([[0.001, 0], [0.03, 0.004], [0.052, 0.02], [0.066, 0.045], [0.074, 0.08], [0.079, 0.12], [0.079, 0.16],
    [0.072, 0.2], [0.055, 0.228], [0.03, 0.242], [0.001, 0.246]], 10),
  neck: new THREE.CylinderGeometry(0.05, 0.056, 0.1, 6),
  sleeve: new THREE.CylinderGeometry(0.045, 0.049, 0.15, 6),
  upperArm: new THREE.CylinderGeometry(0.04, 0.035, 0.24, 6),
  forearm: new THREE.CylinderGeometry(0.034, 0.029, 0.24, 6),
  shoe: new THREE.CapsuleGeometry(0.044, 0.12, 2, 6),
  ball: new THREE.IcosahedronGeometry(1, 1),
  hairMiddle: hairGeometry(HAIRLINES.middle, { volume: 0.007, part: true }),
  hairShort: hairGeometry(HAIRLINES.short),
  joint: new THREE.IcosahedronGeometry(1, 1),
  stache: new THREE.CapsuleGeometry(0.0075, 0.03, 2, 6),
  thin: new THREE.CapsuleGeometry(0.006, 0.02, 2, 6),
  brow: new THREE.BoxGeometry(0.034, 0.008, 0.012),
  mouth: new THREE.BoxGeometry(0.026, 0.005, 0.008),
};

export function makeHuman(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const skinShade = shade(o.skin, -0.06), lips = shade(o.skin, -0.12);
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.set(SCALE * o.build, SCALE * o.height, SCALE * o.build);
  // `tilt` sits between the root (position, facing) and the body, for lean and squash-and-stretch
  const tilt = new THREE.Group();
  tilt.rotation.order = 'YXZ';
  root.add(tilt);
  tilt.add(inner);

  // ----- legs: hip -> knee -> foot
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.076, 0.9, 0);
    piece(hip, G.joint, o.pants, [0, 0, 0], [0.062, 0.066, 0.062]);   // keeps the hip covered as the leg swings
    piece(hip, G.thigh, o.pants, [0, -0.225, 0]);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    piece(knee, G.joint, o.pants, [0, 0, 0], [0.052, 0.052, 0.052]);   // narrower than the leg so it never pokes out
    piece(knee, G.shin, o.pants, [0, -0.205, 0]);
    piece(knee, G.shoe, o.shoes, [0, -0.415, 0.035], [1, 0.75, 1], [Math.PI / 2, 0, 0]);
    hip.add(knee);
    inner.add(hip);
    return { hip, knee };
  });

  // ----- body: pelvis, t-shirt, neck, head, arms
  const body = new THREE.Group();
  inner.add(body);
  piece(body, G.ball, o.pants, [0, 0.915, 0], [0.155, 0.115, 0.105]);
  const chest = piece(body, G.torso, o.shirt, [0, 0, 0], [1, 1, 0.6]);
  piece(body, G.neck, o.skin, [0, 1.49, 0.005]);

  const head = new THREE.Group();
  head.position.set(0, 1.53, 0.01);
  body.add(head);
  piece(head, G.head, o.skin, [0, 0, 0], [0.95, 1, 1.18]);
  for (const s of [-1, 1]) {
    piece(head, G.ball, skinShade, [s * 0.075, 0.125, -0.005], [0.01, 0.026, 0.018]);           // ears
    piece(head, G.ball, '#14110f', [s * 0.031, 0.14, 0.091], [0.012, 0.015, 0.01]);              // eyes
    piece(head, G.brow, o.hair, [s * 0.031, 0.167, 0.09], [1, 1, 1], [0, 0, s * -0.08]);          // brows
  }
  piece(head, G.ball, skinShade, [0, 0.112, 0.093], [0.012, 0.019, 0.016]);                      // nose
  piece(head, G.mouth, lips, [0, 0.069, 0.086]);

  // hair: one continuous piece over the head, cut at the hairline
  if (o.hairStyle !== 'bald') {
    const hair = new THREE.Mesh(o.hairStyle === 'middle' ? G.hairMiddle : G.hairShort, hairMaterial(o.hair));
    hair.scale.set(0.95, 1, 1.18);
    hair.castShadow = hair.receiveShadow = true;
    head.add(hair);
  }
  if (o.hairStyle === 'long') {
    piece(head, G.ball, o.hair, [0, 0.08, -0.05], [0.083, 0.15, 0.065]);
    for (const s of [-1, 1]) piece(head, G.ball, o.hair, [s * 0.065, 0.06, -0.01], [0.022, 0.12, 0.05]);
  }
  if (o.hairStyle === 'bun') piece(head, G.ball, o.hair, [0, 0.215, -0.07], [0.042, 0.04, 0.042]);

  // facial hair
  if (o.beard === 'goatee' || o.beard === 'full') {
    piece(head, G.stache, o.beardColor, [0, 0.082, 0.088], [1, 1, 0.8], [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) piece(head, G.thin, o.beardColor, [s * 0.024, 0.058, 0.08]);
    piece(head, G.ball, o.beardColor, [0, 0.03, 0.066], [0.024, 0.03, 0.018]);
  }
  if (o.beard === 'full') piece(head, G.ball, o.beardColor, [0, 0.045, 0.02], [0.074, 0.06, 0.07]);

  // arms: shoulder -> elbow -> hand
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.17, 1.375, 0);
    shoulder.rotation.z = s * 0.06;
    piece(shoulder, G.sleeve, o.shirt, [0, -0.085, 0]);   // top edge sits inside the torso
    piece(shoulder, G.upperArm, o.skin, [0, -0.19, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    piece(elbow, G.joint, o.skin, [0, 0, 0], [0.036, 0.036, 0.036]);
    piece(elbow, G.forearm, o.skin, [0, -0.12, 0]);
    piece(elbow, G.ball, skinShade, [0, -0.27, 0.005], [0.026, 0.048, 0.034]);
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow };
  });

  // ----- animation
  let t = Math.random() * 10, walk = 0;
  const lookPhase = Math.random() * 10;
  // `pace` scales step rate and stride, so slow walkers take slow, small steps.
  // `air` (0..1) blends into a jumping pose: one knee up, arms flung out
  // `stepRate` (radians of stride per second), if given, sets the cadence directly so the
  // feet keep pace with the ground instead of sliding
  // `sit` (0..1) blends into sitting on a ledge, knees bent over the edge
  function update(dt, walking, { lookAround = false, pace = 1, air = 0, stepRate = null, sit = 0 } = {}) {
    walk += ((walking ? 1 : 0) - walk) * Math.min(1, dt * 10);
    t += dt * (walking ? stepRate ?? 8.5 * pace : 1);
    const stride = walk * Math.sqrt(pace);
    const sw = Math.sin(t);
    if (o.sitting) {
      legs.forEach(({ hip, knee }) => { hip.rotation.x = -1.5; knee.rotation.x = 1.5; });
      arms.forEach(({ shoulder, elbow }) => { shoulder.rotation.x = -0.35; elbow.rotation.x = -0.6; });
    } else {
      legs.forEach(({ hip, knee }, i) => {
        const p = i ? Math.PI : 0;
        const hx = Math.sin(t + p) * 0.55 * stride, kx = Math.max(0, Math.sin(t + p - 0.4)) * 0.7 * stride;   // bend during the forward swing
        const ah = hx + ((i ? 0.45 : -1.0) - hx) * air, ak = kx + ((i ? 0.5 : 1.25) - kx) * air;
        hip.rotation.x = ah + (-1.5 - ah) * sit;
        knee.rotation.x = ak + (1.5 + (i ? 0.15 : -0.1) * Math.sin(t * 0.7) - ak) * sit;   // feet swing a little
      });
      arms.forEach(({ shoulder, elbow }, i) => {
        const sx = -Math.sin(t + (i ? Math.PI : 0)) * 0.75 * stride - 0.1 * stride, s = i ? 1 : -1;
        const as = sx + ((i ? 0.5 : -0.9) - sx) * air;
        shoulder.rotation.x = as + (-0.35 - as) * sit;
        shoulder.rotation.z = s * (0.06 + 0.95 * air * (1 - sit));
        elbow.rotation.x = -0.15 - walk * (0.75 + 0.25 * Math.sin(t + (i ? Math.PI : 0))) * (1 - air) - 0.4 * air;   // pumping arms, bent near a right angle
      });
    }
    // the whole figure rises through each stride and drops onto the next footfall (twice per
    // cycle), sinks a little lower while running, and the shoulders twist against the hips
    const bob = (Math.abs(Math.sin(t)) * 0.075 - 0.03) * stride * (1 - air) * (1 - sit);
    inner.position.y = bob * SCALE * o.height;
    body.rotation.y = Math.sin(t) * 0.16 * stride * (1 - air);
    head.rotation.x = -0.06 * stride + Math.abs(Math.sin(t)) * 0.04 * stride;
    chest.scale.y = 1 + Math.sin(t * 2.2) * 0.006 * (1 - walk);   // breathing
    head.rotation.y = -body.rotation.y * 0.8 + (lookAround ? Math.sin(t * 0.35 + lookPhase) * 0.5 * Math.max(0, Math.sin(t * 0.13 + lookPhase)) : 0);
  }
  update(0, false);
  return { group: root, tilt, update };
}
