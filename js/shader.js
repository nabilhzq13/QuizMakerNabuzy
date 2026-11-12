// Full-screen WebGL background: a neon data tunnel with a spinning "reactor"
// core. The core follows a DOM element (the reactor slot) and the whole scene
// reacts to the game: speed and colour follow the streak, correct answers send
// a wave down the tunnel, wrong answers glitch the picture.

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uTravel, uPulse, uGlitch, uSpin, uHeat, uDim;
uniform vec2 uLook;
uniform vec3 uCore;

const vec3 ION   = vec3(0.18, 0.95, 1.0);
const vec3 PULSE = vec3(1.0, 0.18, 0.53);
const vec3 VOLT  = vec3(0.96, 1.0, 0.23);
const vec3 DEEP  = vec3(0.36, 0.26, 1.0);
const float CORE_Z = 7.0;
const float FOCAL = 1.25;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Rectangular corridor, intersected analytically so the grid stays crisp.
vec3 tunnel(vec3 ro, vec3 rd){
  vec2 W = vec2(4.4, 2.2);
  vec2 tw = (W - sign(rd.xy) * ro.xy) / (abs(rd.xy) + 1e-4);
  float t = min(tw.x, tw.y);
  vec3 p = ro + rd * t;
  float side = step(tw.x, tw.y);
  float wall = side * 31.0 + step(0.0, mix(rd.y, rd.x, side)) * 57.0;
  vec2 q = vec2(mix(p.x, p.y, side), p.z + uTravel) / 1.1;

  vec2 f = abs(fract(q) - 0.5);
  float d = 0.5 - max(f.x, f.y);
  float w = 0.01 + t * 0.0035;
  float line = 1.0 - smoothstep(0.0, w, d);
  float glow = exp(-d * 14.0) * 0.22;

  // panels that blink on and off
  float h = hash(floor(q) + wall);
  float blink = step(0.88, h) * (0.5 + 0.5 * sin(uTime * (1.0 + h * 5.0) + h * 40.0));

  // data packets running along the long lines
  float lane = floor(q.x + 0.5);
  float hp = hash(vec2(lane, wall + 3.0));
  float pk = fract(q.y * 0.07 + uTime * (0.15 + hp * 0.35) + hp * 9.0);
  float packet = smoothstep(0.93, 1.0, pk)
               * (1.0 - smoothstep(0.0, 0.04 + w, abs(q.x - lane)))
               * step(0.5, hp);

  vec3 lineCol = mix(ION, DEEP, side * 0.6);
  lineCol = mix(lineCol, PULSE, uHeat * 0.75);
  vec3 col = lineCol * (line * 1.1 + glow);
  col += mix(DEEP, PULSE, h) * blink * 0.22 * smoothstep(0.0, 0.06, d);
  col += VOLT * packet * 1.6;

  // wave sent down the tunnel by a correct answer
  float zw = (1.0 - uPulse) * 45.0;
  float band = exp(-abs(p.z - zw) * 0.5) * uPulse;
  col += vec3(0.4, 1.0, 0.55) * band * (line * 3.0 + 0.3);

  float fog = exp(-t * 0.06);
  vec3 haze = mix(vec3(0.05, 0.02, 0.15), vec3(0.17, 0.02, 0.1), uHeat);
  return mix(haze, col, fog);
}

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

// Raymarched reactor: three gyroscope rings (glow only) around an octahedron.
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

  vec3 hot = mix(ION, PULSE, uHeat);
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  float size = 0.42 + 0.03 * sin(uTime * 2.4) + uPulse * 0.14;

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
      acc += mix(vec3(0.03, 0.01, 0.1), hot, fr * 0.8 + 0.12) + VOLT * edge * 0.9;
      alpha = 1.0;
      break;
    }
    float stp = max(min(dr + 0.015, dc), 0.012);
    acc += hot * 0.02 * stp * rim * max(0.0, 1.0 / (0.0012 + dr * dr) - 6.0);
    float fall = 1.0 - smoothstep(0.35, 1.45, length(p));
    acc += mix(hot, VOLT, 0.5) * 0.016 * stp * fall / (0.02 + dc * dc);
    t += stp;
    if (t > tEnd) break;
  }
  return vec4(acc, alpha);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  if (uGlitch > 0.001){
    float band = floor(gl_FragCoord.y / (uRes.y * 0.05));
    float n = hash(vec2(band, floor(uTime * 24.0)));
    uv.x += (n - 0.5) * 0.3 * uGlitch * step(0.55, n);
  }

  vec3 rd0 = normalize(vec3(uv, FOCAL));
  vec3 rd = rd0;
  rd.xy *= rot(sin(uTime * 0.11) * 0.05);
  rd.xz *= rot(uLook.x * 0.12);
  rd.yz *= rot(-uLook.y * 0.08);
  vec3 ro = vec3(uLook.x * 0.5, uLook.y * 0.3 + sin(uTime * 0.4) * 0.05, 0.0);

  vec3 col = tunnel(ro, rd);
  vec4 c = core(rd0);
  col = col * (1.0 - c.a) + c.rgb;

  col = mix(col, col * vec3(1.7, 0.35, 0.45) + vec3(0.12, 0.0, 0.02), uGlitch * 0.75);
  col *= 1.0 - uDim * 0.62;
  col *= 1.0 - 0.3 * dot(uv, uv);
  col = 1.0 - exp(-col * 1.25);
  col *= 0.95 + 0.05 * sin(gl_FragCoord.y * 2.0);
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.025;
  gl_FragColor = vec4(col, 1.0);
}
`;

const MODES = {
  home:    { speed: 1.1,  dim: 0.0,  look: 1.0 },
  edit:    { speed: 0.35, dim: 0.68, look: 0.3 },
  play:    { speed: 2.0,  dim: 0.12, look: 0.25 },
  results: { speed: 1.4,  dim: 0.2,  look: 0.5 },
};

const STUB = { setMode() {}, setHeat() {}, pulse() {}, glitch() {} };

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
  for (const n of ['uRes', 'uTime', 'uTravel', 'uPulse', 'uGlitch', 'uSpin', 'uHeat', 'uDim', 'uLook', 'uCore']) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const s = {
    mode: MODES.home, slot: null,
    speed: 1, heat: 0, heatT: 0, dim: 0,
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
    s.speed += ((s.mode.speed + s.heat * 3.5) * motion - s.speed) * ease(2.5);
    s.dim += (s.mode.dim - s.dim) * ease(4);
    s.look[0] += (s.lookT[0] * s.mode.look * motion - s.look[0]) * ease(3);
    s.look[1] += (s.lookT[1] * s.mode.look * motion - s.look[1]) * ease(3);

    const ct = coreTarget();
    const jump = s.core[2] < 0.03; // appear in place instead of flying in from elsewhere
    for (let i = 0; i < 3; i++) {
      s.core[i] = jump && i < 2 ? ct[i] : s.core[i] + (ct[i] - s.core[i]) * ease(i < 2 ? 14 : 5);
    }

    s.pulse = Math.max(0, s.pulse - dt / 0.9);
    s.glitch = Math.max(0, s.glitch - dt / 0.45);
    s.time += dt;
    s.travel = (s.travel + s.speed * dt * 2.2) % 1100;
    s.spin += dt * (0.55 + s.heat * 2.4 + s.pulse * 3) * motion;

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, s.time);
    gl.uniform1f(U.uTravel, s.travel);
    gl.uniform1f(U.uPulse, s.pulse);
    gl.uniform1f(U.uGlitch, calm.matches ? 0 : s.glitch);
    gl.uniform1f(U.uSpin, s.spin);
    gl.uniform1f(U.uHeat, s.heat);
    gl.uniform1f(U.uDim, s.dim);
    gl.uniform2f(U.uLook, s.look[0], s.look[1]);
    gl.uniform3f(U.uCore, s.core[0], s.core[1], s.core[2]);
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
    pulse() { s.pulse = 1; },
    glitch() { s.glitch = 1; },
  };
}

const CORE_Z_JS = 7.0;
const FOCAL_JS = 1.25;
