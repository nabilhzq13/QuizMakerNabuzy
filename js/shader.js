// Full-screen WebGL background. Each theme has its own scene:
//
//   0  hacker  a dim green wireframe corridor
//   1  pirate  a night sea under the moon
//   2  cyber   a neon skyline over a wet street
//   3  tomb    a torch-lit stone passage with carved glyphs
//
// All four are kept slow and dim so they never compete with the text. On top
// sits the slowly turning "reactor" core, which follows a DOM element (the
// reactor slot) and takes its colours from the theme. The scene reacts to the
// game: colour follows the streak, a correct answer sends one soft pulse
// through it, a wrong answer washes it red for a moment.

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uTravel, uPulse, uGlitch, uSpin, uHeat, uDim, uScene;
uniform vec2 uLook;
uniform vec3 uCore;
uniform vec3 uA, uB, uC; // core colours: main, hot, pale

const float CORE_Z = 7.0;
const float FOCAL = 1.25;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// ---------- 0: hacker corridor ----------
// A rectangular corridor, intersected analytically so the grid stays crisp.
vec3 corridor(vec3 ro, vec3 rd){
  const vec3 ION  = vec3(0.0, 1.0, 0.25);
  const vec3 VOLT = vec3(0.83, 1.0, 0.23);
  const vec3 DEEP = vec3(0.0, 0.5, 0.28);
  const vec3 PALE = vec3(0.72, 1.0, 0.78);
  vec2 W = vec2(4.4, 2.2);
  vec2 tw = (W - sign(rd.xy) * ro.xy) / (abs(rd.xy) + 1e-4);
  float t = min(tw.x, tw.y);
  vec3 p = ro + rd * t;
  float side = step(tw.x, tw.y);
  float wall = side * 31.0 + step(0.0, mix(rd.y, rd.x, side)) * 57.0;
  vec2 q = vec2(mix(p.x, p.y, side), p.z + uTravel) / 2.2;

  vec2 f = abs(fract(q) - 0.5);
  float d = 0.5 - max(f.x, f.y);
  float w = 0.005 + t * 0.0018;
  float line = 1.0 - smoothstep(0.0, w, d);
  float glow = exp(-d * 26.0) * 0.16;

  // a few panels stay faintly lit, like status lights on a server rack
  float lit = step(0.86, hash(floor(q) + wall));

  vec3 lineCol = mix(ION, DEEP, side * 0.5);
  lineCol = mix(lineCol, VOLT, uHeat * 0.6);
  vec3 col = lineCol * (line * 0.9 + glow);
  col += DEEP * lit * 0.08 * smoothstep(0.0, 0.03, d);

  // one soft wave sent down the corridor by a correct answer
  float zw = (1.0 - uPulse) * 45.0;
  float band = exp(-abs(p.z - zw) * 0.5) * uPulse;
  col += PALE * band * (line * 1.5 + 0.1);

  float fog = exp(-t * 0.075);
  vec3 haze = mix(vec3(0.0, 0.012, 0.005), vec3(0.012, 0.03, 0.0), uHeat);
  return mix(haze, col, fog);
}

// ---------- 1: pirate sea ----------
const vec3 MOON = vec3(0.1142, 0.2855, 0.9516);

vec3 seaHorizon(){ return mix(vec3(0.05, 0.12, 0.18), vec3(0.30, 0.13, 0.05), uHeat * 0.55); }

vec3 nightSky(vec3 rd, float stars){
  float h = max(rd.y, 0.0);
  vec3 col = mix(seaHorizon(), vec3(0.008, 0.016, 0.045), smoothstep(0.0, 0.5, h));
  float m = max(dot(rd, MOON), 0.0);
  col += vec3(1.0, 0.93, 0.74) * smoothstep(0.99885, 0.99915, m) * 0.95;
  col += vec3(1.0, 0.84, 0.55) * (pow(m, 260.0) * 0.3 + pow(m, 28.0) * (0.07 + uPulse * 0.1));
  if (stars > 0.5){
    vec2 sp = rd.xy / (1.0 + rd.z) * 42.0;
    vec2 id = floor(sp);
    vec2 off = vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5;
    float d = length(fract(sp) - 0.5 - off * 0.7);
    col += vec3(0.8, 0.86, 1.0) * step(0.9, hash(id)) * smoothstep(0.09, 0.0, d)
         * (0.35 + 0.65 * hash(id + 5.1)) * smoothstep(0.02, 0.22, h);
  }
  return col;
}

vec3 sea(vec3 ro, vec3 rd){
  if (rd.y >= 0.0) return nightSky(rd, 1.0);
  float t = (ro.y + 1.3) / -rd.y;
  vec3 p = ro + rd * t;
  vec2 q = vec2(p.x, p.z + uTravel);
  float tt = uTime * 0.45;

  // slope of four long swells; they flatten out with distance so the horizon never shimmers
  vec2 g = vec2(0.0);
  vec2 k;
  k = vec2(0.55, 0.32);  g += k * cos(dot(k, q) + tt) * 0.36;
  k = vec2(-0.38, 0.80); g += k * cos(dot(k, q) + tt * 1.3 + 1.7) * 0.22;
  k = vec2(1.30, 0.90);  g += k * cos(dot(k, q) - tt * 1.7 + 4.0) * 0.09;
  k = vec2(-1.90, 2.30); g += k * cos(dot(k, q) + tt * 2.2 + 2.3) * 0.04;
  g /= 1.0 + t * 0.1;

  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 r = reflect(rd, n);
  r.y = abs(r.y) + 0.02;
  r = normalize(r);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
  vec3 col = mix(vec3(0.004, 0.022, 0.04), nightSky(r, 0.0), fres);
  col += vec3(1.0, 0.86, 0.58) * pow(max(dot(r, MOON), 0.0), 120.0) * (0.55 + uPulse * 0.8);
  return mix(col, seaHorizon(), smoothstep(14.0, 90.0, t) * 0.85);
}

// ---------- 2: cyberpunk city ----------
// v is the view direction as (x, y) / z, so v.y is height above the horizon.
vec3 skyline(vec2 v){
  vec3 haze = mix(vec3(0.34, 0.03, 0.34), vec3(0.42, 0.1, 0.16), uHeat * 0.6);
  vec3 col = mix(haze, vec3(0.012, 0.006, 0.04), smoothstep(0.0, 0.5, v.y));
  col += vec3(0.02, 0.22, 0.28) * exp(-v.y * 10.0) * 0.5;
  // three rows of towers, far to near
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float x = v.x * (7.0 - fi * 2.0) + fi * 17.3;
    float id = floor(x);
    float fx = fract(x);
    float top = (0.31 - fi * 0.085) * (0.3 + 0.7 * hash(vec2(id, fi * 7.0 + 1.0)));
    float inset = step(0.55, hash(vec2(id, fi + 3.0))) * 0.2;
    float lower = step(0.05, fx) * step(fx, 0.95) * step(v.y, top * 0.7);
    float upper = step(0.05 + inset, fx) * step(fx, 0.95 - inset) * step(v.y, top);
    if (max(lower, upper) > 0.5){
      vec3 wallc = mix(vec3(0.13, 0.04, 0.18), vec3(0.018, 0.008, 0.035), fi * 0.5);
      // small upright windows: more columns than before, fewer rows
      vec2 w = vec2(fx * (11.0 - fi * 1.5), v.y * (52.0 - fi * 10.0));
      vec2 wid = floor(w);
      vec2 wf = fract(w);
      float lit = step(0.66, hash(wid + id * 13.0 + fi * 31.0));
      float mask = step(0.28, wf.x) * step(wf.x, 0.74) * step(0.22, wf.y) * step(wf.y, 0.8);
      float pick = hash(wid.yx + id + 4.0);
      vec3 wc = pick < 0.45 ? vec3(0.1, 0.9, 1.0) : (pick < 0.82 ? vec3(1.0, 0.2, 0.8) : vec3(1.0, 0.7, 0.25));
      col = wallc + wc * lit * mask * (0.28 + fi * 0.16) * (1.0 + uPulse * 1.2);
      // a tall sign on some of the nearest towers
      float sgn = step(1.5, fi) * step(0.62, hash(vec2(id, 9.0)));
      col += vec3(1.0, 0.17, 0.84) * sgn * step(abs(fx - 0.5), 0.045) * step(top * 0.18, v.y) * step(v.y, top * 0.62) * 1.3;
    }
  }
  return col;
}

vec3 city(vec3 ro, vec3 rd){
  vec2 v = rd.xy / rd.z;
  if (v.y >= 0.0) return skyline(v);
  float t = (ro.y + 1.3) / -rd.y;
  vec3 p = ro + rd * t;

  // wet street: a dim, wobbly mirror of the skyline
  float wob = (vnoise(vec2(p.x * 2.5, (p.z + uTravel) * 0.5)) - 0.5) * 0.03;
  vec2 m = vec2(v.x + wob, -v.y * 0.85);
  vec3 col = skyline(m) * 0.34 * exp(-m.y * 1.5);

  // lane grid drifting slowly towards the viewer
  vec2 q = vec2(p.x, p.z + uTravel) / 2.2;
  vec2 f = abs(fract(q) - 0.5);
  float d = 0.5 - max(f.x, f.y);
  float line = 1.0 - smoothstep(0.0, 0.006 + t * 0.002, d);
  vec3 lineCol = mix(vec3(1.0, 0.17, 0.84), vec3(0.16, 0.94, 1.0), uHeat * 0.7);
  col += lineCol * (line * 0.55 + exp(-d * 26.0) * 0.08) * exp(-t * 0.06);

  float zw = (1.0 - uPulse) * 45.0;
  col += vec3(1.0, 0.8, 0.98) * exp(-abs(p.z - zw) * 0.5) * uPulse * (line * 1.2 + 0.06);
  return col;
}

// ---------- 3: jungle tomb ----------
vec3 tomb(vec3 ro, vec3 rd){
  vec2 W = vec2(4.4, 2.6);
  vec2 tw = (W - sign(rd.xy) * ro.xy) / (abs(rd.xy) + 1e-4);
  float t = min(tw.x, tw.y);
  vec3 p = ro + rd * t;
  float side = step(tw.x, tw.y);
  float z = p.z + uTravel;
  float wall = side * 31.0 + step(0.0, mix(rd.y, rd.x, side)) * 57.0;

  // stone blocks in a running bond: 2.2 long and 1.3 high on the walls, square slabs above and below
  vec2 b = mix(vec2(z / 2.2, p.x / 2.2), vec2(z / 2.2, (p.y + 2.6) / 1.3), side);
  float row = floor(b.y);
  b.x += 0.5 * mod(row, 2.0);
  vec2 id = floor(b);
  vec2 f = fract(b);
  float edge = min(min(f.x, 1.0 - f.x) * mix(1.0, 1.7, side), min(f.y, 1.0 - f.y));
  vec3 stone = mix(vec3(0.20, 0.17, 0.12), vec3(0.36, 0.31, 0.22), hash(id + wall));
  stone *= 0.68 + 0.32 * vnoise(b * 7.0 + wall);
  stone *= 0.22 + 0.78 * smoothstep(0.0, 0.05, edge);

  // moss creeping up from the floor
  float moss = side * smoothstep(-0.4, -2.6, p.y) * vnoise(vec2(z, p.y) * 1.4 + 9.0);
  stone = mix(stone, vec3(0.08, 0.2, 0.07), moss * 0.7);

  // a torch on each wall every 8.8 units
  float cell = floor((z + 4.4) / 8.8);
  vec3 tp = vec3(abs(p.x) - 4.2, p.y - 0.5, z - cell * 8.8);
  float d2 = dot(tp, tp);
  float flick = 0.94 + 0.06 * sin(uTime * 1.9 + cell * 2.4);
  vec3 col = stone * (vec3(0.16, 0.19, 0.16) + vec3(1.0, 0.55, 0.2) * (3.4 / (1.0 + d2 * 0.4)) * flick);
  col += vec3(1.0, 0.72, 0.3) * exp(-d2 * 7.0) * 1.5 * side;

  // glyphs carved into some of the wall blocks, glowing jade; they flare when an answer is right
  float carved = side * step(0.84, hash(id * 1.7 + wall + 5.0)) * step(0.5, row) * step(row, 2.5);
  vec2 gq = f * vec2(6.0, 4.0);
  vec2 gid = floor(gq);
  vec2 gf = fract(gq);
  float on = step(0.45, hash(gid + id * 3.1)) * step(0.5, gid.x) * step(gid.x, 4.5) * step(0.5, gid.y) * step(gid.y, 2.5);
  float glyph = carved * on * step(0.18, gf.x) * step(gf.x, 0.82) * step(0.18, gf.y) * step(gf.y, 0.82);
  float zw = (1.0 - uPulse) * 45.0;
  float band = exp(-abs(p.z - zw) * 0.5) * uPulse;
  col += vec3(0.2, 0.9, 0.68) * glyph * (0.45 + uHeat * 0.6 + band * 2.0);
  col += vec3(0.8, 1.0, 0.9) * band * 0.05;

  return mix(vec3(0.004, 0.008, 0.005), col, exp(-t * 0.06));
}

// ---------- the reactor core ----------
float sdTorus(vec3 p, float R, float r){
  return length(vec2(length(p.xz) - R, p.y)) - r;
}
vec3 spinA(vec3 p){ p.xy *= rot(uSpin * 0.7); p.yz *= rot(uSpin * 0.5); return p; }
vec3 spinB(vec3 p){ p.yz *= rot(-uSpin * 0.9 + 1.0); p.xz *= rot(uSpin * 0.3); return p; }
vec3 spinC(vec3 p){ p.xz *= rot(uSpin * 1.3); p.xy *= rot(uSpin * 0.8 + 2.0); return p; }
vec3 spinD(vec3 p){ p.xz *= rot(uSpin * 0.6); p.xy *= rot(0.62); return p; }

float rings(vec3 p){
  float d = sdTorus(spinA(p), 1.5, 0.02);
  d = min(d, sdTorus(spinB(p), 1.2, 0.02));
  d = min(d, sdTorus(spinC(p), 0.9, 0.02));
  return d;
}

// Raymarched: three gyroscope rings (glow only) around an octahedron.
vec4 core(vec3 rd){
  float s = uCore.z;
  if (s < 0.02) return vec4(0.0);
  vec3 oc = -vec3(uCore.xy, CORE_Z) / s;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - 3.2);
  if (h < 0.0) return vec4(0.0);
  h = sqrt(h);
  float rim = smoothstep(0.0, 0.9, h); // fade glow out at the bounding sphere's edge
  float t = max(-b - h, 0.0);
  float tEnd = -b + h;

  vec3 hot = mix(uA, uB, uHeat);
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  float size = 0.42 + 0.02 * sin(uTime * 1.1) + uPulse * 0.1;

  for (int i = 0; i < 48; i++){
    vec3 p = oc + rd * t;
    float dr = rings(p);
    vec3 pl = spinD(p);
    vec3 po = abs(pl);
    float dc = (po.x + po.y + po.z - size) * 0.57735;
    if (dc < 0.003){
      vec3 n = sign(pl) * 0.57735;
      float fr = pow(1.0 - abs(dot(n, spinD(rd))), 2.0);
      float e = min(po.x, min(po.y, po.z));
      float edge = 1.0 - smoothstep(0.0, 0.035, e);
      acc += mix(uA * 0.04, hot, fr * 0.8 + 0.12) + uC * edge * 0.9;
      alpha = 1.0;
      break;
    }
    float stp = max(min(dr + 0.015, dc), 0.012);
    acc += hot * 0.012 * stp * rim * max(0.0, 1.0 / (0.0012 + dr * dr) - 6.0);
    float fall = 1.0 - smoothstep(0.35, 1.45, length(p));
    acc += mix(hot, uC, 0.4) * 0.016 * stp * fall / (0.02 + dc * dc);
    t += stp;
    if (t > tEnd) break;
  }
  return vec4(acc, alpha);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  vec3 rd0 = normalize(vec3(uv, FOCAL));
  vec3 rd = rd0;
  rd.xz *= rot(uLook.x * 0.06);
  rd.yz *= rot(-uLook.y * 0.04);
  vec3 ro = vec3(uLook.x * 0.3, uLook.y * 0.2, 0.0);

  vec3 col;
  if (uScene < 0.5) col = corridor(ro, rd);
  else if (uScene < 1.5) col = sea(ro, rd);
  else if (uScene < 2.5) col = city(ro, rd);
  else col = tomb(ro, rd);

  // only the scene is dimmed, so the reactor stays the bright thing on screen
  col *= 1.0 - uDim;
  vec4 c = core(rd0);
  col = col * (1.0 - c.a) + c.rgb;

  // a wrong answer washes the scene red for a moment (no shaking, no flicker)
  float g = uGlitch * uGlitch;
  col = mix(col, vec3(dot(col, vec3(0.5)) * 1.3 + 0.05, 0.0, 0.01), g * 0.7);
  col *= 1.0 - 0.3 * dot(uv, uv);
  col = 1.0 - exp(-col * 1.25);
  // faint scanlines for the two screen-lit themes
  if (uScene < 0.5 || (uScene > 1.5 && uScene < 2.5)) col *= 0.95 + 0.05 * sin(gl_FragCoord.y * 2.0);
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}
`;

// speed: how fast the scene drifts past (kept very low on purpose)
// dim: how far the scene is faded behind the content, look: mouse parallax
const MODES = {
  home:    { speed: 0.12, dim: 0.3,  look: 0.35 },
  edit:    { speed: 0.04, dim: 0.72, look: 0.0 },
  cards:   { speed: 0.05, dim: 0.62, look: 0.0 },
  play:    { speed: 0.14, dim: 0.5,  look: 0.1 },
  results: { speed: 0.12, dim: 0.55, look: 0.2 },
};

const STUB = { setMode() {}, setHeat() {}, setScene() {}, pulse() {}, glitch() {} };

export function initBackground(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { document.body.classList.add('no-gl'); return STUB; }

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs) { document.body.classList.add('no-gl'); return STUB; }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    document.body.classList.add('no-gl');
    return STUB;
  }
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uRes', 'uTime', 'uTravel', 'uPulse', 'uGlitch', 'uSpin', 'uHeat', 'uDim', 'uScene', 'uLook', 'uCore', 'uA', 'uB', 'uC']) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const s = {
    mode: MODES.home, slot: null,
    scene: { id: 0, a: [0, 1, 0.25], b: [0.83, 1, 0.23], c: [0.72, 1, 0.78] },
    speed: MODES.home.speed, heat: 0, heatT: 0, dim: MODES.home.dim,
    pulse: 0, glitch: 0, travel: 0, spin: 0, time: 0,
    core: [0, 0, 0], look: [0, 0], lookT: [0, 0],
    quality: 0.7, slow: 0,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * s.quality;
    const w = Math.max(2, Math.round(innerWidth * dpr));
    const h = Math.max(2, Math.round(innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  addEventListener('resize', resize);
  resize();

  addEventListener('pointermove', e => {
    s.lookT[0] = (e.clientX / innerWidth - 0.5) * 2;
    s.lookT[1] = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  // Where the reactor should sit, in the shader's view space.
  function coreTarget() {
    const el = s.slot;
    if (!el || !el.isConnected) return [s.core[0], s.core[1], 0];
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return [s.core[0], s.core[1], 0];
    const k = CORE_Z_JS / FOCAL_JS;
    const x = ((r.left + r.width / 2) - innerWidth / 2) / innerHeight * k;
    const y = -((r.top + r.height / 2) - innerHeight / 2) / innerHeight * k;
    const scale = (Math.min(r.width, r.height) / innerHeight / 2) / 0.3;
    return [x, y, scale];
  }

  let last = performance.now();
  let raf = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.05);
    const ease = k => 1 - Math.exp(-dt * k);
    const motion = calm.matches ? 0.2 : 1;

    // drop resolution if the GPU can't keep up
    if (rawDt > 0.03 && rawDt < 0.5) {
      if (++s.slow > 45 && s.quality > 0.36) { s.quality *= 0.8; s.slow = 0; resize(); }
    } else if (s.slow > 0) s.slow--;

    s.heat += (s.heatT - s.heat) * ease(3);
    s.speed += ((s.mode.speed + s.heat * 0.2) * motion - s.speed) * ease(2.5);
    s.dim += (s.mode.dim - s.dim) * ease(4);
    s.look[0] += (s.lookT[0] * s.mode.look * motion - s.look[0]) * ease(3);
    s.look[1] += (s.lookT[1] * s.mode.look * motion - s.look[1]) * ease(3);

    const ct = coreTarget();
    const jump = s.core[2] < 0.03; // appear in place instead of flying in from elsewhere
    for (let i = 0; i < 3; i++) {
      s.core[i] = jump && i < 2 ? ct[i] : s.core[i] + (ct[i] - s.core[i]) * ease(i < 2 ? 14 : 5);
    }

    s.pulse = Math.max(0, s.pulse - dt / 1.2);
    s.glitch = Math.max(0, s.glitch - dt / 0.7);
    s.time += dt * motion;
    s.travel = (s.travel + s.speed * dt * 2.2) % 1100;
    s.spin += dt * (0.22 + s.heat * 0.5 + s.pulse * 1.0) * motion;

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, s.time);
    gl.uniform1f(U.uTravel, s.travel);
    gl.uniform1f(U.uPulse, s.pulse);
    gl.uniform1f(U.uGlitch, calm.matches ? 0 : s.glitch);
    gl.uniform1f(U.uSpin, s.spin);
    gl.uniform1f(U.uHeat, s.heat);
    gl.uniform1f(U.uDim, s.dim);
    gl.uniform1f(U.uScene, s.scene.id);
    gl.uniform2f(U.uLook, s.look[0], s.look[1]);
    gl.uniform3f(U.uCore, s.core[0], s.core[1], s.core[2]);
    gl.uniform3fv(U.uA, s.scene.a);
    gl.uniform3fv(U.uB, s.scene.b);
    gl.uniform3fv(U.uC, s.scene.c);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  raf = requestAnimationFrame(frame);

  return {
    /** Switch scene mood and tell the reactor which element to sit in (or null to hide it). */
    setMode(name, slot = null) { s.mode = MODES[name] || MODES.home; s.slot = slot; },
    /** 0..1, how hot the streak is. */
    setHeat(v) { s.heatT = Math.max(0, Math.min(1, v)); },
    /** Which world to draw: { id, a, b, c } from themes.js. */
    setScene(scene) { s.scene = scene; },
    pulse() { s.pulse = 1; },
    glitch() { s.glitch = 1; },
  };
}

const CORE_Z_JS = 7.0;
const FOCAL_JS = 1.25;
