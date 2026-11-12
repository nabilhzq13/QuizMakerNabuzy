// One shared AudioContext for sound effects and music. Browsers only let audio
// start after the user has clicked or pressed a key, so the context is created
// lazily and resumed on demand.

let ac = null;

export function audioContext() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); } catch { return null; }
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

let noiseOf = new WeakMap();
/** One second of white noise, cached per context. */
export function noiseBuffer(ctx) {
  let buf = noiseOf.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseOf.set(ctx, buf);
  }
  return buf;
}
