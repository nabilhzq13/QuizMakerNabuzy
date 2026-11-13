// A small 3D stage for the battle scenes, built on three.js.
//
// three.js is fetched from a CDN the first time a battle starts, so the rest
// of the app never depends on it. Everything is lit by the shaders in this
// file rather than by three.js lights: a toon shader for the models, plus
// shaders for the sea, sky, neon floor, lit windows and flames, and a post
// pass with glow, a lens vignette and a short colour split on heavy hits.
//
// Motion is built from three ideas taken from game-feel practice:
//   - springs (second-order dynamics) instead of fixed-length tweens, so
//     things overshoot, settle and lag behind each other naturally
//   - hit-stop: on impact the world freezes for a few frames while the
//     camera keeps shaking, which is what makes a hit read as heavy
//   - trauma-based camera shake: hits add trauma, the shake is trauma squared
//     and follows smooth noise, so it is never a random jitter

import { GLSL_LIB } from './glsl-lib.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

let T = null;
export async function loadThree() {
  if (!T) {
    T = await import(THREE_URL);
    // colours go to the screen exactly as written, so a hex value looks the way it reads
    T.ColorManagement.enabled = false;
  }
  return T;
}

const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- springs ----------

/**
 * A second-order system that follows a target value.
 *   f  natural frequency in hertz: how fast it responds
 *   z  damping: below 1 it overshoots and wobbles, 1 settles exactly, above 1 is sluggish
 *   r  initial response: above 1 it overshoots at the start, below 0 it first moves the wrong way (anticipation)
 * After t3ssel8r, "Giving Personality to Procedural Animations using Math".
 */
export class Spring {
  constructor(f = 2, z = 0.6, r = 0, x0 = 0) {
    this.tune(f, z, r);
    this.xp = x0;
    this.y = x0;
    this.yd = 0;
  }

  tune(f, z = this.z, r = this.r) {
    this.f = f; this.z = z; this.r = r;
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / ((2 * Math.PI * f) ** 2);
    this.k3 = (r * z) / (2 * Math.PI * f);
    return this;
  }

  update(dt, x) {
    if (dt <= 0) return this.y;
    const xd = (x - this.xp) / dt;
    this.xp = x;
    // clamping k2 keeps it stable for any frame time
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    this.y += dt * this.yd;
    this.yd += (dt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2;
    return this.y;
  }

  /** Add speed, e.g. the knock of a hit. */
  kick(v) { this.yd += v; }

  snap(x) { this.y = this.xp = x; this.yd = 0; }
}

/** Smooth noise in about [-1, 1] for one value of time: three sines at unrelated rates. */
export function wobble(t, seed = 0) {
  return (Math.sin(t * 1.0 + seed * 12.9) * 0.5 + Math.sin(t * 2.31 + seed * 4.1) * 0.3 + Math.sin(t * 4.67 + seed * 7.7) * 0.2);
}

// ---------- the sea ----------
// The same long swells move the sea surface (in the vertex shader) and the
// ships (in JavaScript), so a ship really rides the wave under it.

export const SEA_SPEED = 0.55; // slows the real wave speed, so the sea stays calm to look at
const DEPTH = 40;
const SWELLS = [
  { dir: [1, 0.35], len: 9.5, amp: 0.13 },
  { dir: [-0.55, 1], len: 6.1, amp: 0.07 },
];
const CHOP = [
  { dir: [0.8, -0.55], len: 3.2, amp: 0.03 },
  { dir: [0.25, 1], len: 1.8, amp: 0.016 },
  { dir: [-0.9, 0.4], len: 0.95, amp: 0.008 },
  { dir: [0.6, 0.8], len: 0.55, amp: 0.004 },
];

/** Height of the moving sea surface at a point, matching the sea's vertex shader. */
export function seaHeight(x, z, time) {
  let h = 0;
  for (const w of SWELLS) {
    const l = Math.hypot(w.dir[0], w.dir[1]);
    const k = (2 * Math.PI) / w.len;
    const e = Math.exp(-2 * k * DEPTH);
    const omega = Math.sqrt(9.81 * k * (1 - e) / (1 + e));
    h += w.amp * Math.sin(k * ((w.dir[0] * x + w.dir[1] * z) / l) - omega * time * SEA_SPEED);
  }
  return h;
}

// depth is passed as a uniform: as a constant, the Windows shader compiler folds exp(-2kd) to
// a number too small to represent and prints a warning for every wave
const waveSum = (list, footprint) => list.map(w =>
  `  s += waterWaveD(xz, t, vec2(${w.dir[0].toFixed(3)}, ${w.dir[1].toFixed(3)}), ${w.len.toFixed(3)}, ${w.amp.toFixed(4)}, uDepth, ${footprint});`).join('\n');

// ---------- shaders ----------

const FOG = `
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
vec3 fogged(vec3 col, float dist){ return mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist)); }
`;

const TOON_VERT = `
varying vec3 vN;   // normal, in view space
varying vec3 vV;   // from the surface to the camera, in view space
varying vec3 vW;   // world position
varying vec3 vNW;  // normal, in world space
#ifdef USE_COLOR
varying vec3 vC;
#endif
#ifdef BILLOW
uniform float uTime, uBillow, uGust;
#endif
void main(){
  vec3 p = position;
  #ifdef BILLOW
    // sails and flags belly out in the middle and ripple; a gust (a hit, a broadside) fills them harder
    float belly = sin(uv.x * 3.14159) * sin(uv.y * 3.14159);
    p += normal * (uBillow * (1.0 + uGust) * belly + uBillow * 0.08 * sin(uv.y * 9.0 + uv.x * 4.0 + uTime * 2.0));
  #endif
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * w;
  vW = w.xyz;
  vNW = normalize(mat3(modelMatrix) * normal);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  #ifdef USE_COLOR
    vC = color;
  #endif
  gl_Position = projectionMatrix * mv;
}
`;

const TOON_FRAG = `
uniform vec3 uColor, uRim, uLightDir, uLightColor, uAmbient, uPointPos, uPointColor;
uniform float uRimStrength, uEmissive, uFlash, uFade, uDissolve, uTime;
varying vec3 vN, vV, vW, vNW;
#ifdef USE_COLOR
varying vec3 vC;
#endif
${GLSL_LIB}
${FOG}
void main(){
  vec3 n = normalize(vN);
  vec3 nw = normalize(vNW);
  if (!gl_FrontFacing) { n = -n; nw = -nw; }

  #ifdef DISSOLVE
    // a scan line sweeps down the figure; everything above it is gone, with a bright edge where it cuts
    float scan = 0.0;
    if (uDissolve > 0.0) {
      float line = 2.25 - uDissolve * 2.6 + (hash13(vW * 22.0) - 0.5) * 0.18;
      if (vW.y > line) discard;
      scan = 1.0 - smoothstep(0.0, 0.1, line - vW.y);
    }
  #endif

  vec3 base = uColor;
  #ifdef USE_COLOR
    base *= vC;
  #endif
  #ifdef BLOCKS
    // cut stone: courses of blocks with darker joints and worn faces, laid out from the world position
    vec3 an = abs(nw);
    vec2 b = an.y > 0.6 ? vW.xz : (an.x > an.z ? vW.zy : vW.xy);
    b /= vec2(1.3, 0.62);
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b);
    float joint = smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y)));
    float wear = fbm(b * 3.1, 3) * 0.5 + 0.5;
    base *= (0.78 + 0.22 * hash12(floor(b))) * (0.42 + 0.58 * joint) * (0.8 + 0.3 * wear);
  #endif

  // two-step light from the main direction
  vec3 L = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  float nl = dot(n, L);
  float lit = smoothstep(-0.06, 0.06, nl) * 0.55 + smoothstep(0.44, 0.56, nl) * 0.45;
  vec3 col = base * (uAmbient + uLightColor * lit);

  // a lamp in the scene (a torch, a lantern), flickering; off when its colour is black
  vec3 toLamp = (viewMatrix * vec4(uPointPos, 1.0)).xyz + vV;
  float flicker = 0.88 + 0.12 * valueNoise(vec2(uTime * 7.0, 3.0));
  float lamp = smoothstep(-0.1, 0.5, dot(n, normalize(toLamp))) / (1.0 + dot(toLamp, toLamp) * 0.09);
  col += base * uPointColor * lamp * flicker;

  // coloured edge light, which is what separates a dark figure from a dark scene
  float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.6);
  col += uRim * rim * uRimStrength;
  col += base * uEmissive;
  col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);

  #ifdef DISSOLVE
    col += uRim * 3.0 * scan;
  #endif

  gl_FragColor = vec4(fogged(col, length(vV)) * uFade, 1.0);
}
`;

// flat, unlit colour for anything that gives off light: neon strips, lamps, glyphs
const GLOW_VERT = `
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GLOW_FRAG = `
uniform vec3 uColor;
uniform float uPower, uOpacity, uFade, uDissolve;
varying vec3 vW;
${GLSL_LIB}
void main(){
  if (uDissolve > 0.0 && vW.y > 2.25 - uDissolve * 2.6 + (hash13(vW * 22.0) - 0.5) * 0.18) discard;
  gl_FragColor = vec4(uColor * uPower * uFade, uOpacity);
}
`;

const SEA_VERT = `
uniform float uTime, uDepth;
varying vec3 vW;
${GLSL_LIB}
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec2 xz = w.xz;
  float t = uTime * ${SEA_SPEED.toFixed(3)};
  vec4 s = vec4(0.0);
${waveSum(SWELLS, '0.0001')}
  w.y += s.x;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SEA_FRAG = `
uniform float uTime, uDepth;
uniform vec3 uDeep, uSky, uMoonDir, uMoonColor;
varying vec3 vW;
${GLSL_LIB}
${FOG}
void main(){
  vec2 xz = vW.xz;
  float t = uTime * ${SEA_SPEED.toFixed(3)};
  float dist = distance(cameraPosition, vW);
  // the swells plus the short chop; the footprint fades out waves too small for the pixel at this distance
  float px = dist * 0.0016;
  vec4 s = vec4(0.0);
${waveSum(SWELLS, 'px')}
${waveSum(CHOP, 'px')}
  vec3 n = normalize(vec3(-s.y, 1.0, -s.z));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = mix(uDeep, uSky, clamp(fres * 1.6, 0.0, 1.0));
  // moon glitter: a tight highlight on the facets that face it
  col += uMoonColor * pow(max(dot(reflect(-V, n), uMoonDir), 0.0), 90.0) * 1.4;
  // crests: where the surface curves over sharply, a hint of foam
  float crest = smoothstep(0.35, 1.1, -s.w) * (1.0 - smoothstep(10.0, 30.0, dist));
  col += vec3(0.45, 0.55, 0.62) * crest * (0.5 + 0.5 * valueNoise(xz * 6.0 + t));
  gl_FragColor = vec4(fogged(col, dist), 1.0);
}
`;

const SKY_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const SKY_FRAG = `
uniform vec3 uTop, uBottom, uHaze;
uniform float uStars, uTime;
varying vec2 vUv;
${GLSL_LIB}
void main(){
  float y = vUv.y;
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 0.7, y));
  col += uHaze * exp(-y * 8.0);
  // slow, faint cloud bands drifting across
  col += uHaze * 0.6 * smoothstep(0.55, 0.85, fbm(vec2(vUv.x * 7.0 + uTime * 0.01, y * 3.0), 4) * 0.5 + 0.5) * smoothstep(0.05, 0.4, y);
  vec2 g = vUv * vec2(240.0, 76.0);
  vec2 id = floor(g);
  vec2 jitter = vec2(hash12(id + 31.0), hash12(id + 73.0)) - 0.5;
  vec2 f = fract(g) - 0.5 - jitter * 0.6;
  float twinkle = 0.7 + 0.3 * sin(uTime * (1.0 + hash12(id + 5.0) * 2.0) + hash12(id) * 40.0);
  col += vec3(0.85, 0.9, 1.0) * uStars * step(0.965, hash12(id)) * smoothstep(0.14, 0.0, length(f))
       * (0.4 + 0.6 * hash12(id + 17.0)) * twinkle * smoothstep(0.12, 0.45, y);
  gl_FragColor = vec4(col, 1.0);
}
`;

const GRID_FRAG = `
uniform vec3 uBase, uLine;
uniform float uCell, uTime, uPulse;
uniform vec3 uPulseAt;
varying vec3 vW;
${GLSL_LIB}
${FOG}
void main(){
  vec2 g = vW.xz / uCell;
  vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  float line = 1.0 - min(min(d.x, d.y), 1.0);
  // a ring of light runs out across the grid from each hit
  float r = distance(vW.xz, uPulseAt.xz);
  float ring = uPulse * exp(-abs(r - (1.0 - uPulse) * 9.0) * 1.6);
  vec3 col = uBase + uLine * line * (1.2 + ring * 2.5) + uLine * 0.07 * valueNoise(vW.xz * 0.5);
  gl_FragColor = vec4(fogged(col, distance(cameraPosition, vW)), 1.0);
}
`;

const TOWER_VERT = `
varying vec3 vW;
varying vec3 vNW;
varying vec2 vCell;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vNW = normalize(mat3(modelMatrix) * normal);
  vCell = floor(modelMatrix[3].xz * 4.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TOWER_FRAG = `
uniform vec3 uWall;
uniform float uTime;
varying vec3 vW;
varying vec3 vNW;
varying vec2 vCell;
${GLSL_LIB}
${FOG}
void main(){
  vec3 an = abs(normalize(vNW));
  vec3 col = uWall * (0.7 + 0.5 * an.z);
  if (an.y < 0.5) {
    // a grid of windows on the walls; which ones are lit, and in what colour, is fixed per tower
    vec2 cell = (an.x > an.z ? vW.zy : vW.xy) / vec2(0.55, 0.72);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float seed = hash12(vCell);
    float lit = step(0.7, hash12(id + vCell * 7.0));
    // now and then a window switches off and back on, slowly
    lit *= step(0.04, fract(uTime * 0.02 + hash12(id + vCell)));
    float pane = step(0.25, f.x) * step(f.x, 0.75) * step(0.22, f.y) * step(f.y, 0.8);
    float pick = hash12(id.yx + vCell * 3.0);
    vec3 wc = pick < 0.45 ? vec3(0.16, 0.94, 1.0) : (pick < 0.8 ? vec3(1.0, 0.17, 0.84) : vec3(1.0, 0.71, 0.28));
    col += wc * lit * pane * (0.45 + 0.25 * seed);
  }
  gl_FragColor = vec4(fogged(col, distance(cameraPosition, vW)), 1.0);
}
`;

const FLAME_FRAG = `
uniform float uTime;
varying vec2 vUv;
${GLSL_LIB}
void main(){
  vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
  // rising, curling noise: the flame is a teardrop whose edge is eaten away by it
  float n = fbm(vec2(p.x * 2.4, p.y * 2.6 - uTime * 2.2), 4) * 0.5 + 0.5;
  float width = (1.0 - p.y) * 0.62 * (0.65 + 0.6 * n);
  float d = abs(p.x + (n - 0.5) * 0.3 * p.y) / max(width, 0.001);
  float a = smoothstep(1.0, 0.25, d) * smoothstep(0.0, 0.1, p.y) * smoothstep(1.0, 0.5, p.y);
  vec3 col = mix(vec3(1.0, 0.33, 0.05), vec3(1.0, 0.93, 0.6), smoothstep(0.75, 0.0, d) * (1.0 - p.y));
  gl_FragColor = vec4(col * a * 1.5, a);
}
`;

const POINT_VERT = `
attribute vec3 aColor;
attribute float aSize, aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const TRAIL_VERT = `
attribute float aFade;
varying float vFade;
void main(){ vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const TRAIL_FRAG = `
uniform vec3 uColor;
uniform float uPower;
varying float vFade;
void main(){ gl_FragColor = vec4(uColor * uPower * vFade, vFade); }
`;

const PASS_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BLUR_FRAG = `
uniform sampler2D tex;
uniform vec2 dir;
uniform float threshold;
varying vec2 vUv;
vec3 pick(vec2 uv){
  vec3 c = texture2D(tex, uv).rgb;
  if (threshold <= 0.0) return c;
  return c * smoothstep(threshold, threshold + 0.25, max(c.r, max(c.g, c.b)));
}
void main(){
  vec3 c = pick(vUv) * 0.227
         + (pick(vUv + dir * 1.385) + pick(vUv - dir * 1.385)) * 0.316
         + (pick(vUv + dir * 3.231) + pick(vUv - dir * 3.231)) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}
`;

const MIX_FRAG = `
uniform sampler2D tex, glow;
uniform float strength, aberration, exposure, aspect;
varying vec2 vUv;
${GLSL_LIB}
void main(){
  vec2 c = vUv - 0.5;
  // a heavy hit splits the colour channels outwards for a moment
  vec2 shift = c * aberration;
  vec3 col = vec3(texture2D(tex, vUv + shift).r, texture2D(tex, vUv).g, texture2D(tex, vUv - shift).b);
  col += texture2D(glow, vUv).rgb * strength;
  col *= exposure * mix(1.0, vignette(c * vec2(aspect, 1.0) * 2.0, 2.2), 0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------- post pass ----------

/** Renders the scene off screen, blurs its bright parts and adds them back, with a vignette on top. */
class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.strength = 0.8;
    this.threshold = 0.7;
    this.full = new T.WebGLRenderTarget(4, 4, { samples: 4 });
    this.a = new T.WebGLRenderTarget(4, 4, { depthBuffer: false });
    this.b = new T.WebGLRenderTarget(4, 4, { depthBuffer: false });
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new T.Scene();
    this.scene.add(this.quad);
    const flat = { vertexShader: PASS_VERT, depthTest: false, depthWrite: false };
    this.blur = new T.ShaderMaterial({ ...flat, fragmentShader: BLUR_FRAG, uniforms: { tex: { value: null }, dir: { value: new T.Vector2() }, threshold: { value: 0 } } });
    this.mix = new T.ShaderMaterial({
      ...flat, fragmentShader: MIX_FRAG,
      uniforms: { tex: { value: null }, glow: { value: null }, strength: { value: 1 }, aberration: { value: 0 }, exposure: { value: 1 }, aspect: { value: 1 } },
    });
  }

  setSize(w, h) {
    this.full.setSize(w, h);
    this.w = Math.max(2, w >> 1);
    this.h = Math.max(2, h >> 1);
    this.a.setSize(this.w, this.h);
    this.b.setSize(this.w, this.h);
    this.mix.uniforms.aspect.value = w / h;
  }

  pass(from, to, dx, dy, threshold) {
    this.quad.material = this.blur;
    this.blur.uniforms.tex.value = from.texture;
    this.blur.uniforms.dir.value.set(dx / this.w, dy / this.h);
    this.blur.uniforms.threshold.value = threshold;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, aberration, exposure) {
    const r = this.renderer;
    r.setRenderTarget(this.full);
    r.render(scene, camera);
    // keep only the bright parts, then blur across and down, twice for a wider halo
    this.pass(this.full, this.a, 1, 0, this.threshold);
    this.pass(this.a, this.b, 0, 1, 0);
    this.pass(this.b, this.a, 2.2, 0, 0);
    this.pass(this.a, this.b, 0, 2.2, 0);
    const u = this.mix.uniforms;
    this.quad.material = this.mix;
    u.tex.value = this.full.texture;
    u.glow.value = this.b.texture;
    u.strength.value = this.strength;
    u.aberration.value = aberration;
    u.exposure.value = exposure;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.full.dispose();
    this.a.dispose();
    this.b.dispose();
    this.blur.dispose();
    this.mix.dispose();
    this.quad.geometry.dispose();
  }
}

// ---------- particles ----------

/** Sparks, splinters, smoke and flashes: one pool of soft round points. */
class Particles {
  constructor(count = 520) {
    this.n = count;
    this.next = 0;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.live = Array.from({ length: count }, () => ({ life: 0 }));
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new T.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new T.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new T.BufferAttribute(this.alpha, 1));
    this.material = new T.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: { uScale: { value: 300 } },
      transparent: true, depthWrite: false,
    });
    this.points = new T.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.tint = new T.Color();
  }

  /**
   * One particle. size and grow are in world units, life in seconds.
   * floor makes it bounce off the ground (y = 0) instead of falling through.
   */
  emit({ pos, vel = [0, 0, 0], color = '#ffffff', size = 0.1, life = 0.6, gravity = 0, drag = 0, grow = 0, alpha = 1, floor = false }) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([pos.x, pos.y, pos.z], i * 3);
    this.tint.set(color);
    this.col.set([this.tint.r, this.tint.g, this.tint.b], i * 3);
    this.live[i] = { life, max: life, vx: vel[0], vy: vel[1], vz: vel[2], gravity, drag, size, grow, alpha, floor };
  }

  /**
   * A spray of particles from one point. With `dir`, they fly mostly that way:
   * spread 1 is all directions, 0 is a straight line.
   */
  burst(pos, { count = 20, colors = ['#ffffff'], speed = 3, up = 1.2, size = 0.09, life = 0.8, gravity = 7, drag = 1.2, dir = null, spread = 1, floor = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.asin(Math.random() * 2 - 1);
      let vx = Math.cos(a) * Math.cos(b), vy = Math.sin(b), vz = Math.sin(a) * Math.cos(b);
      if (dir) {
        vx = dir[0] + (vx - dir[0]) * spread;
        vy = dir[1] + (vy - dir[1]) * spread;
        vz = dir[2] + (vz - dir[2]) * spread;
        const l = Math.hypot(vx, vy, vz) || 1;
        vx /= l; vy /= l; vz /= l;
      }
      const v = speed * (0.35 + Math.random() * 0.65);
      this.emit({
        pos, vel: [vx * v, vy * v + up, vz * v * 0.6],
        color: colors[Math.floor(Math.random() * colors.length)],
        size: size * (0.5 + Math.random()), life: life * (0.6 + Math.random() * 0.6), gravity, drag, floor,
      });
    }
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const p = this.live[i];
      if (p.life <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      if (dt > 0) {
        p.life -= dt;
        const slow = Math.max(0, 1 - p.drag * dt);
        p.vx *= slow; p.vy = p.vy * slow - p.gravity * dt; p.vz *= slow;
        this.pos[i * 3] += p.vx * dt;
        this.pos[i * 3 + 1] += p.vy * dt;
        this.pos[i * 3 + 2] += p.vz * dt;
        if (p.floor && this.pos[i * 3 + 1] < 0.02 && p.vy < 0) {
          this.pos[i * 3 + 1] = 0.02;
          p.vy *= -0.35;
          p.vx *= 0.6;
          p.vz *= 0.6;
        }
      }
      const k = Math.max(0, p.life / p.max);
      this.size[i] = p.size + p.grow * (1 - k);
      this.alpha[i] = p.alpha * Math.min(1, k * 2.2);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = true;
  }
}

// ---------- trails ----------

/** A ribbon of light that follows a moving object and fades from head to tail. */
class Trail {
  constructor(stage, target, color, { width = 0.12, length = 22, power = 1.4 } = {}) {
    this.stage = stage;
    this.target = target;
    this.width = width;
    this.n = length;
    this.points = [];
    this.pos = new Float32Array(this.n * 2 * 3);
    this.fade = new Float32Array(this.n * 2);
    const index = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    geo.setAttribute('aFade', new T.BufferAttribute(this.fade, 1));
    geo.setIndex(index);
    this.material = new T.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      uniforms: { uColor: { value: new T.Color(color) }, uPower: { value: power } },
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    this.mesh = new T.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    stage.scene.add(this.mesh);
    this.stop = stage.every(dt => this.update(dt));
    this.ending = false;
  }

  update(dt) {
    if (dt <= 0) return;
    const head = this.ending ? this.points[0] : this.stage.worldPos(this.target);
    if (!head) return;
    this.points.unshift(head.clone());
    if (this.points.length > this.n) this.points.pop();
    if (this.ending) {
      this.points.pop();
      if (this.points.length < 2) { this.dispose(); return; }
    }
    const pts = this.points;
    for (let i = 0; i < this.n; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      const q = pts[Math.min(i + 1, pts.length - 1)];
      // widen across the direction of travel, in the plane facing the camera
      let dx = p.x - q.x, dy = p.y - q.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const k = 1 - i / (this.n - 1);
      const w = this.width * (0.25 + 0.75 * k);
      this.pos.set([p.x - dy * w, p.y + dx * w, p.z, p.x + dy * w, p.y - dx * w, p.z], i * 6);
      const f = i < pts.length ? k * k : 0;
      this.fade[i * 2] = this.fade[i * 2 + 1] = f;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aFade.needsUpdate = true;
  }

  /** Let the tail catch up with the head and disappear. */
  end() { this.ending = true; }

  dispose() {
    this.stop();
    this.stage.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ---------- the stage ----------

export const ease = {
  linear: k => k,
  in: k => k * k,
  out: k => 1 - (1 - k) ** 3,
  inOut: k => k * k * (3 - 2 * k),
};

export class Stage {
  constructor(canvas) {
    this.T = T;
    this.canvas = canvas;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.LinearSRGBColorSpace;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(30, 3, 0.1, 300);
    this.halfWidth = 8.2; // how much of the scene, left to right, always stays in view
    this.sway = calm.matches ? 0 : 0.25;
    this.time = 0;
    this.alive = true;
    this.tasks = new Set();

    // game feel: world freeze on impact, camera trauma, a short colour split and exposure punch
    this.freeze = 0;
    this.trauma = 0;
    this.split = new Spring(3.2, 0.5, 0, 0);
    this.splitTarget = 0;
    this.exposure = new Spring(4, 0.55, 0, 1);
    this.zoom = new Spring(2.4, 0.5, 0, 0);

    // uniforms every material shares; a scene sets them once with setLook()
    this.shared = {
      uTime: { value: 0 },
      uLightDir: { value: new T.Vector3(-0.4, 0.8, 0.6).normalize() },
      uLightColor: { value: new T.Color('#ffffff') },
      uAmbient: { value: new T.Color('#333333') },
      uFogColor: { value: new T.Color('#000000') },
      uFogNear: { value: 20 },
      uFogFar: { value: 60 },
      uPointPos: { value: new T.Vector3(0, 100, 0) },
      uPointColor: { value: new T.Color('#000000') },
    };
    this.still = this.fx(); // for scenery, which never flashes or fades

    this.particles = new Particles();
    this.scene.add(this.particles.points);
    try { this.post = new Post(this.renderer); } catch (err) { console.warn('post pass unavailable', err); this.post = null; }

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();
  }

  /** Light, fog and glow for a scene. */
  setLook({ fog, fogNear, fogFar, light, lightColor, ambient, lamp, lampColor, glow = 0.8, glowFrom = 0.7 }) {
    const s = this.shared;
    s.uFogColor.value.set(fog);
    s.uFogNear.value = fogNear;
    s.uFogFar.value = fogFar;
    s.uLightDir.value.set(...light).normalize();
    s.uLightColor.value.set(lightColor);
    s.uAmbient.value.set(ambient);
    if (lamp) { s.uPointPos.value.set(...lamp); s.uPointColor.value.set(lampColor); }
    this.renderer.setClearColor(fog, 1);
    if (this.post) { this.post.strength = glow; this.post.threshold = glowFrom; }
  }

  /** How wide a slice of the scene the camera frames. Smaller brings the fighters closer. */
  setView(halfWidth) {
    this.halfWidth = halfWidth;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(Math.round(w * dpr), Math.round(h * dpr));

    // pull the camera back until the fixed width fits, then frame the ground near the bottom edge
    const half = Math.tan(this.camera.fov * Math.PI / 360);
    this.dist = this.halfWidth / (half * (w / h));
    const height = 2 * half * this.dist;
    this.lookY = height * 0.34;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.material.uniforms.uScale.value = (h * dpr) / (2 * half);
    this.sized = true;
  }

  start() {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.frame);
    const real = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (document.hidden || !this.sized) return;

    // during hit-stop the world holds still, but the camera keeps shaking
    let dt = real;
    if (this.freeze > 0) {
      this.freeze -= real;
      dt = 0;
    }
    this.time += dt;
    this.shared.uTime.value = this.time;

    this.updateCamera(real);
    for (const task of [...this.tasks]) task(dt, this.time);
    this.particles.update(dt);
    if (this.post) this.post.render(this.scene, this.camera, this.split.y, this.exposure.y);
    else this.renderer.render(this.scene, this.camera);
  }

  updateCamera(real) {
    const c = this.camera;
    // trauma decays steadily; the shake grows with its square, so small hits stay small
    this.trauma = Math.max(0, this.trauma - real * 1.5);
    const shake = this.trauma * this.trauma;
    const t = performance.now() / 1000 * 11;
    const push = this.zoom.update(real, 0);
    const dist = this.dist * (1 - push);
    c.position.set(
      Math.sin(this.time * 0.2) * this.sway + wobble(t, 1) * 0.32 * shake,
      this.lookY + 0.9 + wobble(t, 2) * 0.22 * shake,
      dist,
    );
    c.lookAt(0, this.lookY, 0);
    c.rotateZ(wobble(t, 3) * 0.035 * shake);
    this.split.update(real, this.splitTarget);
    this.splitTarget = 0;
    this.exposure.update(real, 1);
  }

  // ---- game feel ----

  /** Freeze the world for a moment on impact. Heavier hits freeze longer (about 50 to 150 ms). */
  hitStop(seconds) {
    if (calm.matches) return;
    this.freeze = Math.max(this.freeze, seconds);
  }

  /** Add camera trauma, 0 to 1. */
  shake(amount) {
    if (calm.matches) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A short punch: brighter for a frame, the colour channels split, the camera pushes in a little. */
  punch(amount = 1) {
    if (calm.matches) return;
    this.exposure.kick(5 * amount);
    this.split.kick(0.5 * amount);
    this.zoom.kick(0.5 * amount);
  }

  // ---- timing ----
  // All of these run on world time, so they pause during hit-stop.

  /** Run fn(dt, time) every frame. Returns a function that stops it. */
  every(fn) {
    this.tasks.add(fn);
    return () => this.tasks.delete(fn);
  }

  /** Call fn(k) with k going 0 to 1 over the given seconds. Resolves when it gets there. */
  tween(seconds, fn, curve = ease.inOut) {
    return new Promise(resolve => {
      let t = 0;
      const task = dt => {
        t += dt;
        const k = Math.min(1, t / seconds);
        fn(curve(k), k);
        if (k >= 1) { this.tasks.delete(task); resolve(); }
      };
      this.tasks.add(task);
    });
  }

  wait(seconds) { return this.tween(seconds, () => {}); }

  after(seconds, fn) { this.wait(seconds).then(fn); }

  // ---- materials ----

  /** A set of effect values shared by all the parts of one figure. */
  fx() {
    return { uFlash: { value: 0 }, uFade: { value: 1 }, uDissolve: { value: 0 }, uGust: { value: 0 } };
  }

  /** Lit, two-step shaded surface. */
  toon(color, { fx = this.still, rim = '#ffffff', rimStrength = 0.22, emissive = 0, vertexColors = false, blocks = false, billow = 0 } = {}) {
    const defines = { DISSOLVE: '' };
    if (blocks) defines.BLOCKS = '';
    if (billow) defines.BILLOW = '';
    return new T.ShaderMaterial({
      defines, vertexShader: TOON_VERT, fragmentShader: TOON_FRAG, vertexColors, side: T.DoubleSide,
      uniforms: {
        ...this.shared, ...fx,
        uColor: { value: new T.Color(color) },
        uRim: { value: new T.Color(rim) },
        uRimStrength: { value: rimStrength },
        uEmissive: { value: emissive },
        uBillow: { value: billow },
      },
    });
  }

  /** Unlit colour for things that give off light. power above 1 makes it glow harder. */
  light(color, { fx = this.still, power = 1.3, opacity = 1, additive = false } = {}) {
    return new T.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, side: T.DoubleSide,
      transparent: opacity < 1 || additive, depthWrite: !(opacity < 1 || additive),
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      uniforms: { ...fx, uColor: { value: new T.Color(color) }, uPower: { value: power }, uOpacity: { value: opacity } },
    });
  }

  sea({ deep, sky, moonDir, moonColor }) {
    return new T.ShaderMaterial({
      vertexShader: SEA_VERT, fragmentShader: SEA_FRAG,
      uniforms: {
        ...this.shared,
        uDepth: { value: DEPTH },
        uDeep: { value: new T.Color(deep) }, uSky: { value: new T.Color(sky) },
        uMoonDir: { value: new T.Vector3(...moonDir).normalize() }, uMoonColor: { value: new T.Color(moonColor) },
      },
    });
  }

  sky({ top, bottom, haze = '#000000', stars = 0 }) {
    return new T.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false,
      uniforms: { uTime: this.shared.uTime, uTop: { value: new T.Color(top) }, uBottom: { value: new T.Color(bottom) }, uHaze: { value: new T.Color(haze) }, uStars: { value: stars } },
    });
  }

  grid({ base, line, cell = 1.6 }) {
    const m = new T.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GRID_FRAG,
      uniforms: {
        ...this.shared, uBase: { value: new T.Color(base) }, uLine: { value: new T.Color(line) }, uCell: { value: cell },
        uPulse: { value: 0 }, uPulseAt: { value: new T.Vector3() },
      },
    });
    return m;
  }

  tower(wall) {
    return new T.ShaderMaterial({
      vertexShader: TOWER_VERT, fragmentShader: TOWER_FRAG,
      uniforms: { ...this.shared, uWall: { value: new T.Color(wall) } },
    });
  }

  flame() {
    return new T.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { uTime: this.shared.uTime },
    });
  }

  // ---- building ----

  /** Add a mesh to a parent. pos, rot (radians) and scale are optional arrays. */
  add(parent, geometry, material, pos, rot, scale) {
    const m = new T.Mesh(geometry, material);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
    parent.add(m);
    return m;
  }

  group(parent, pos, rot) {
    const g = new T.Group();
    if (pos) g.position.set(...pos);
    if (rot) g.rotation.set(...rot);
    parent.add(g);
    return g;
  }

  /** Give a smooth shape hard facets, so it reads as low-poly. */
  faceted(geometry) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.computeVertexNormals();
    return g;
  }

  worldPos(object) { return object.getWorldPosition(new T.Vector3()); }

  // ---- effects ----

  /** A bright flash that swells and is gone. */
  flash(pos, color, size = 0.8) {
    this.particles.emit({ pos, color, size: size * 0.5, grow: size, life: 0.16 });
  }

  /** Puffs of smoke that rise and thin out. */
  smoke(pos, count = 4, color = '#b9bec4') {
    for (let i = 0; i < count; i++) {
      this.particles.emit({
        pos, color, size: 0.3, grow: 0.9, life: 0.9 + Math.random() * 0.5, alpha: 0.5,
        vel: [(Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4], drag: 1.2,
      });
    }
  }

  burst(pos, options) { this.particles.burst(pos, options); }

  trail(target, color, options) { return new Trail(this, target, color, options); }

  /** A thin streak of light between two points, like a musket shot. */
  tracer(a, b, color) {
    const length = a.distanceTo(b);
    const material = this.light(color, { power: 1.6, opacity: 0.99, additive: true });
    const beam = this.add(this.scene, new T.CylinderGeometry(0.014, 0.014, length, 5), material);
    beam.position.copy(a).lerp(b, 0.5);
    beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.tween(0.16, k => { material.uniforms.uOpacity.value = 1 - k; }, ease.linear).then(() => {
      this.scene.remove(beam);
      beam.geometry.dispose();
      material.dispose();
    });
  }

  /** An expanding ring of light, facing the camera. */
  shock(pos, color, size = 1) {
    const material = this.light(color, { power: 1.6, opacity: 0.99, additive: true });
    const ring = this.add(this.scene, new T.TorusGeometry(0.3 * size, 0.03, 6, 32), material);
    ring.position.copy(pos);
    this.tween(0.42, k => { ring.scale.setScalar(1 + k * 3.4); material.uniforms.uOpacity.value = (1 - k) ** 2; }, ease.out).then(() => {
      this.scene.remove(ring);
      ring.geometry.dispose();
      material.dispose();
    });
  }

  /** Raise a value to `peak` and let it fall back to zero, e.g. a hit flash. */
  pulse(uniform, peak, seconds) {
    return this.tween(seconds, k => { uniform.value = peak * (1 - k); }, ease.out);
  }

  /**
   * Throw an object from one point to another under gravity.
   * height is how far the path rises above the straight line, side bends it towards the camera.
   * spin is radians per second around each axis; aim points the object's +x along the path;
   * stretch squashes and stretches it along its speed, which is what makes a fast object read as fast.
   */
  arc(object, from, to, { height = 1, side = 0, seconds = 0.5, spin = null, aim = false, stretch = 0 } = {}) {
    const at = k => new T.Vector3(
      from.x + (to.x - from.x) * k,
      from.y + (to.y - from.y) * k + height * 4 * k * (1 - k),
      from.z + (to.z - from.z) * k + side * 4 * k * (1 - k),
    );
    const forward = new T.Vector3(1, 0, 0);
    const span = from.distanceTo(to);
    return this.tween(seconds, k => {
      object.position.copy(at(k));
      const v = at(Math.min(1, k + 0.02)).sub(at(Math.max(0, k - 0.02)));
      if (aim) object.quaternion.setFromUnitVectors(forward, v.clone().normalize());
      else if (spin) object.rotation.set(spin[0] * k * seconds, spin[1] * k * seconds, spin[2] * k * seconds);
      if (stretch) {
        // faster on the way up and down than at the top of the arc
        const speed = v.length() / (0.04 * span || 1);
        object.scale.set(1 + stretch * speed, 1 / Math.sqrt(1 + stretch * speed), 1);
        if (!aim) object.quaternion.setFromUnitVectors(forward, v.normalize());
      }
    }, ease.linear);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.tasks.clear();
    this.scene.traverse(o => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.post?.dispose();
    this.renderer.dispose();
    // browsers allow only a handful of live WebGL contexts, so give this one back
    this.renderer.forceContextLoss();
  }
}
