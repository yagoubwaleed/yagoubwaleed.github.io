// Renders a scene into an off-screen target at `pix` screen pixels per rendered pixel,
// then draws it to the screen with ordered (Bayer 4×4) dithering. Pixels nothing was
// drawn to are left as the plain background.
import * as THREE from 'three';

export function createDither(renderer, { levels = 8, pix = 1, background = [0, 0, 0] } = {}) {
  renderer.setClearColor(0x000000, 0);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType,
  });
  // an optional mask (what's hovered) rendered alone, so its silhouette can be outlined
  const maskTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  let width = 1, height = 1;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture }, uRes: { value: new THREE.Vector2(1, 1) },
      uLevels: { value: levels }, uBg: { value: new THREE.Vector3(...background) },
      uSeason: { value: new THREE.Vector4(0, 1, 0, 0) },   // weights: spring, summer, autumn, winter
      tMask: { value: maskTarget.texture }, uMask: { value: 0 }, uFx: { value: 0 }, uOutline: { value: new THREE.Vector3(0.96, 0.94, 0.9) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tScene; uniform vec2 uRes; uniform float uLevels; uniform vec3 uBg; uniform vec4 uSeason; uniform sampler2D tMask; uniform float uMask; uniform vec3 uOutline; uniform float uFx; varying vec2 vUv;
      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
      }
      vec3 hsv2rgb(vec3 c) {
        vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
        return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
      }
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      // The magic wand's looks (uFx 1-10; 0 is normal). Each takes the colour before quantizing;
      // "done" means it has already been reduced to its own palette.
      float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      vec3 fx(vec3 c, vec2 px, out bool done) {
        done = false;
        float l = lum(c), b = bayer4(px);
        if (uFx < 0.5) return c;
        if (uFx < 1.5) {   // Game Boy: four greens
          float k = clamp(floor(l * 3.999 + b - 0.5), 0.0, 3.0); done = true;
          return k < 0.5 ? vec3(0.06, 0.22, 0.06) : k < 1.5 ? vec3(0.19, 0.38, 0.19) : k < 2.5 ? vec3(0.55, 0.67, 0.06) : vec3(0.61, 0.74, 0.06);
        }
        if (uFx < 2.5) return vec3(pow(l, 1.25) * 1.1);                                  // noir
        if (uFx < 3.5) return vec3(l * 1.08, l * 0.9, l * 0.68) + vec3(0.04, 0.02, 0.0); // sepia
        if (uFx < 4.5) return hsv2rgb(vec3(0.7 - clamp(l * 1.2, 0.0, 1.0) * 0.72, 0.9, 0.35 + l * 0.65));   // thermal
        if (uFx < 5.5) return vec3(1.0) - c;                                              // inverted
        if (uFx < 6.5) return mix(vec3(0.16, 0.02, 0.3), vec3(1.0, 0.35, 0.65), l) + vec3(0.0, 0.0, 0.25) * (1.0 - l);   // synthwave
        if (uFx < 7.5) { vec3 h = rgb2hsv(c); return hsv2rgb(vec3(h.x, h.y * 0.45, 0.55 + h.z * 0.45)); }   // pastel
        if (uFx < 8.5) { done = true; return vec3(step(0.5, l * 1.15 + (b - 0.5) * 0.9)); }               // one-bit
        if (uFx < 9.5) return c * (mod(px.y, 3.0) < 1.0 ? 0.55 : 1.05);                  // scanlines
        vec3 h = rgb2hsv(c); return hsv2rgb(vec3(fract(h.x + 0.55), min(1.0, h.y * 1.4), h.z));   // vapor: hue swap
      }
      // Seasons recolour the greens (grass, leaves, shrubs): spring makes them lusher,
      // autumn turns them orange, yellow and russet, winter covers them in snow and cools
      // everything else a little.
      vec3 season(vec3 c) {
        if (uSeason.y > 0.999) return c;
        vec3 h = rgb2hsv(c);
        float green = smoothstep(0.11, 0.15, h.x) * (1.0 - smoothstep(0.42, 0.48, h.x)) * smoothstep(0.08, 0.2, h.y);
        vec3 spring = hsv2rgb(vec3(mix(h.x, 0.25, 0.15), min(1.0, h.y * 1.08), min(1.0, h.z * 1.03)));   // just a touch fresher; the bushes and trees flower (world.js)
        float t = clamp((h.x - 0.13) / 0.3, 0.0, 1.0);
        vec3 autumn = hsv2rgb(vec3(0.065 + 0.05 * fract(t * 2.3 + h.z * 3.1), max(min(1.0, h.y * 1.4), 0.68), min(1.0, h.z * 1.12 + 0.03)));   // oranges and golds
        vec3 cool = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.75) * vec3(0.97, 0.99, 1.04);
        // grass under snow: a solid white whose shading comes from the light, not the green
        float gw = smoothstep(0.08, 0.16, h.x) * (1.0 - smoothstep(0.45, 0.52, h.x)) * smoothstep(0.04, 0.12, h.y);
        vec3 snow = mix(vec3(0.66, 0.71, 0.79), vec3(0.95, 0.96, 0.98), clamp(h.z * 1.9 - 0.2, 0.0, 1.0));
        vec3 winter = mix(cool, snow, gw);
        return c * uSeason.y + mix(c, spring, green) * uSeason.x + mix(c, autumn, green) * uSeason.z + winter * uSeason.w;
      }
      void main() {
        vec2 px = floor(vUv * uRes);
        // hover outline: a 2-pixel rim just outside the mask's silhouette
        if (uMask > 0.5 && texture2D(tMask, (px + 0.5) / uRes).r < 0.5) {
          float edge = 0.0;
          for (int dx = -2; dx <= 2; dx++) for (int dy = -2; dy <= 2; dy++) {
            if (abs(float(dx)) + abs(float(dy)) > 2.5) continue;
            edge = max(edge, texture2D(tMask, (px + vec2(float(dx), float(dy)) + 0.5) / uRes).r);
          }
          if (edge > 0.5) { gl_FragColor = vec4(uOutline, 1.0); return; }
        }
        vec4 s = texture2D(tScene, (px + 0.5) / uRes);
        if (s.a < 0.5) { gl_FragColor = vec4(uBg, 1.0); return; }
        bool done;
        vec3 c = fx(season(pow(max(s.rgb, 0.0), vec3(1.0 / 2.2))), px, done);
        if (!done) c = floor(c * uLevels + bayer4(px)) / uLevels;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  function resizeTarget() {
    const w = Math.ceil(width / pix), h = Math.ceil(height / pix);
    target.setSize(w, h);
    maskTarget.setSize(w, h);
    material.uniforms.uRes.value.set(w, h);
  }
  return {
    setSize(w, h) {
      width = w; height = h;
      renderer.setSize(w, h, false);
      resizeTarget();
    },
    // Change the pixel size (the character viewer uses this to magnify).
    setPixelSize(p) {
      if (p === pix) return;
      pix = p;
      resizeTarget();
    },
    setSeason(w) { material.uniforms.uSeason.value.set(...w); },
    setBackground(rgb) { material.uniforms.uBg.value.set(...rgb); },
    setFx(n) { material.uniforms.uFx.value = n; },
    setOutlineColor(rgb) { material.uniforms.uOutline.value.set(...rgb); },
    render(world, view, mask = null) {
      material.uniforms.uMask.value = mask ? 1 : 0;
      if (mask) {
        renderer.setRenderTarget(maskTarget);
        renderer.setClearColor(0x000000, 1); renderer.clear();
        renderer.render(mask, view);
        renderer.setClearColor(0x000000, 0);
      }
      renderer.setRenderTarget(target);
      renderer.render(world, view);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
  };
}
