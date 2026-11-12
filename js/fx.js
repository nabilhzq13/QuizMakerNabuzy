// Particle shards drawn on a 2D canvas above the page: bursts for correct
// answers and a rain for a perfect run.

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const COLORS = ['#00ff41', '#d4ff3a', '#8dffb0', '#eafff0'];

let parts = [];
let raf = 0;
let last = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vy += p.g * dt;
    p.vx *= 1 - p.drag * dt;
    p.vy *= 1 - p.drag * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.life -= dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.min(1, p.life * 2.5);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  raf = parts.length ? requestAnimationFrame(frame) : 0;
  if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
}

function run() {
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const fx = {
  burst(x, y, { count = 34, power = 520, colors = COLORS } = {}) {
    if (calm.matches) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = power * (0.3 + Math.random() * 0.7);
      parts.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120,
        g: 900, drag: 2.2,
        w: 3 + Math.random() * 9, h: 2 + Math.random() * 4,
        rot: a, vr: (Math.random() - 0.5) * 14,
        life: 0.5 + Math.random() * 0.6,
        color: pick(colors),
      });
    }
    run();
  },
  rain() {
    if (calm.matches) return;
    for (let i = 0; i < 160; i++) {
      parts.push({
        x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.8,
        vx: (Math.random() - 0.5) * 80, vy: 180 + Math.random() * 260,
        g: 120, drag: 0.1,
        w: 4 + Math.random() * 10, h: 3 + Math.random() * 5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
        life: 3.5 + Math.random() * 1.5,
        color: pick(COLORS),
      });
    }
    run();
  },
  clear() { parts = []; },
};
