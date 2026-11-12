import { initBackground } from './shader.js';
import { parseCSV, rowsToQuestions, toCSV, SAMPLE_CSV } from './csv.js';
import { parsePaper } from './paper.js';
import { readPdf } from './pdf.js';
import * as store from './store.js';
import { sfx } from './sfx.js';
import { fx } from './fx.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const LETTERS = 'ABCDEF';
const calm = matchMedia('(prefers-reduced-motion: reduce)');

const app = $('#app');
const bg = initBackground($('#bg'));
let quizzes = store.load();

const find = id => quizzes.find(q => q.id === id);
const persist = () => {
  if (!store.save(quizzes)) toast('Could not save. Your browser storage is full or blocked.');
};

// ---------- small helpers ----------

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* no clipboard at all */ }
    ta.remove();
    return ok;
  }
}

const fileSlug = title => (title || 'quiz').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';

// ---------- routing ----------

const handlers = {};
let leaveView = null;

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function setView(name) {
  document.body.dataset.view = name;
  window.scrollTo(0, 0);
}

function route() {
  leaveView?.();
  leaveView = null;
  for (const k in handlers) delete handlers[k];
  fx.clear();
  bg.setHeat(0);

  const [, view, arg] = location.hash.split('/');
  if (view === 'edit') viewEdit(arg);
  else if (view === 'play') viewPlay(arg);
  else if (view === 'shared') viewShared(arg);
  else viewHome();
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  handlers[el.dataset.act]?.(el, e);
});

addEventListener('hashchange', route);

// keep the quiz list in step when it changes in another tab
addEventListener('storage', e => {
  if (e.key !== store.KEY) return;
  quizzes = store.load();
  if (document.body.dataset.view === 'home') viewHome();
});

// ---------- home ----------

let freshId = null;

function cardHTML(q) {
  const n = q.questions.length;
  return `
    <li class="card cut tilt${q.id === freshId ? ' fresh' : ''}" data-id="${q.id}">
      <h3>${esc(q.title || 'Untitled quiz')}</h3>
      <p class="meta">${plural(n, 'question')}, ${q.timePerQ ? `${q.timePerQ} seconds each` : 'no timer'}</p>
      <p class="best">${q.best ? `Best score ${fmt(q.best.score)} with ${q.best.pct}% correct` : 'Not played yet'}</p>
      <div class="row">
        <button class="btn" data-act="play">Play</button>
        <button class="btn ghost" data-act="edit">Edit</button>
      </div>
      <div class="row minor">
        <button class="link" data-act="share">Copy share link</button>
        <button class="link" data-act="export">Export CSV</button>
        <button class="link danger" data-act="delete">Delete</button>
      </div>
    </li>`;
}

function viewHome() {
  setView('home');
  const list = [...quizzes].sort((a, b) => b.updated - a.updated);
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <h1 class="glitch boot" data-text="Quiz&#10;Reactor"><span>Quiz</span><span>Reactor</span></h1>
        <p class="lede">Write multiple-choice questions by hand, or import them from a CSV file or a PDF question paper. Then play against the clock and keep your streak going to heat up the reactor.</p>
        <div class="row">
          <button class="btn big" data-act="new">New quiz</button>
          <button class="btn ghost big" data-act="import">Import CSV or PDF</button>
        </div>
      </div>
      <div class="reactor-slot" aria-hidden="true"></div>
    </section>
    <section class="deck">
      <h2>Your quizzes</h2>
      ${list.length
        ? `<ul class="cards">${list.map(cardHTML).join('')}</ul>`
        : '<p class="empty">No quizzes yet. Start a new quiz or import a CSV or PDF file.</p>'}
    </section>`;
  freshId = null;
  bg.setMode('home', $('.reactor-slot'));

  const idOf = el => el.closest('.card').dataset.id;

  handlers.new = () => {
    sfx.click();
    const quiz = store.normalizeQuiz({ title: '', questions: [store.blankQuestion()] });
    quizzes.push(quiz);
    persist();
    go('#/edit/' + quiz.id);
  };
  handlers.import = () => { sfx.click(); openImport({ mode: 'new' }); };
  handlers.play = el => { sfx.click(); go('#/play/' + idOf(el)); };
  handlers.edit = el => { sfx.click(); go('#/edit/' + idOf(el)); };
  handlers.export = el => {
    const quiz = find(idOf(el));
    download(fileSlug(quiz.title) + '.csv', toCSV(quiz));
    toast('Exported CSV');
  };
  handlers.share = async el => {
    const quiz = find(idOf(el));
    if (!quiz.questions.some(q => !store.questionIssue(q))) return toast('Finish at least one question before sharing.');
    const link = location.origin + location.pathname + '#/shared/' + await store.encodeQuiz(quiz);
    if (link.length > 30000) return toast('This quiz is too big for a link. Export the CSV and send that file.');
    toast(await copyText(link) ? 'Share link copied' : 'Could not copy the link in this browser.');
  };
  handlers.delete = el => {
    if (!el.classList.contains('armed')) {
      el.classList.add('armed');
      el.textContent = 'Select again to delete';
      setTimeout(() => {
        if (el.isConnected) { el.classList.remove('armed'); el.textContent = 'Delete'; }
      }, 3000);
      return;
    }
    quizzes = quizzes.filter(q => q.id !== idOf(el));
    persist();
    toast('Deleted');
    viewHome();
  };
}

// ---------- editor ----------

function viewEdit(id) {
  const quiz = find(id);
  if (!quiz) return go('#/');
  setView('edit');
  bg.setMode('edit');

  app.innerHTML = `
    <div class="editor">
      <a class="back" href="#/">All quizzes</a>
      <div class="editor-head cut">
        <label class="field"><span>Quiz title</span>
          <input type="text" id="q-title" maxlength="120" placeholder="Untitled quiz" value="${esc(quiz.title)}">
        </label>
        <label class="field"><span>Time per question</span>
          <select id="q-time">${store.TIMES.map(t => `<option value="${t}"${t === quiz.timePerQ ? ' selected' : ''}>${t ? t + ' seconds' : 'No timer'}</option>`).join('')}</select>
        </label>
        <div class="checks">
          <label class="check"><input type="checkbox" id="q-shq"${quiz.shuffleQ ? ' checked' : ''}><span>Shuffle the question order</span></label>
          <label class="check"><input type="checkbox" id="q-sha"${quiz.shuffleA ? ' checked' : ''}><span>Shuffle the answers</span></label>
        </div>
      </div>
      <ol class="qlist"></ol>
      <div class="editor-foot cut">
        <button class="btn ghost" data-act="add-q">Add question</button>
        <button class="btn ghost" data-act="add-file">Add from file</button>
        <button class="link" data-act="next-issue" hidden></button>
        <span class="saved" role="status"></span>
        <button class="btn" data-act="play-this">Play quiz</button>
      </div>
    </div>`;

  const listEl = $('.qlist');
  const savedEl = $('.saved');

  const cardHTML = (q, i) => `
    <li class="qcard cut" data-i="${i}">
      <div class="qcard-head">
        <h3>Question ${i + 1}</h3>
        <div class="tools">
          <button class="icon" data-act="q-up" aria-label="Move question ${i + 1} up" title="Move up"${i === 0 ? ' disabled' : ''}>&uarr;</button>
          <button class="icon" data-act="q-down" aria-label="Move question ${i + 1} down" title="Move down"${i === quiz.questions.length - 1 ? ' disabled' : ''}>&darr;</button>
          <button class="icon" data-act="q-dup" aria-label="Duplicate question ${i + 1}" title="Duplicate">+</button>
          <button class="icon" data-act="q-del" aria-label="Delete question ${i + 1}" title="Delete">&times;</button>
        </div>
      </div>
      <textarea data-f="q" rows="2" maxlength="500" placeholder="Type the question" aria-label="Question ${i + 1} text">${esc(q.q)}</textarea>
      <p class="hint">Select a letter to mark the correct answer.</p>
      <div class="opts">
        ${q.options.map((o, j) => `
          <div class="opt" data-j="${j}">
            <label class="pick" title="Mark ${LETTERS[j]} as correct">
              <input type="radio" name="ans-${i}" data-f="answer" value="${j}"${q.answer === j ? ' checked' : ''} aria-label="Answer ${LETTERS[j]} is correct">
              <span>${LETTERS[j]}</span>
            </label>
            <input type="text" data-f="opt" maxlength="200" placeholder="Answer ${LETTERS[j]}" aria-label="Answer ${LETTERS[j]}" value="${esc(o)}">
            <button class="icon" data-act="opt-del" aria-label="Remove answer ${LETTERS[j]}" title="Remove answer"${q.options.length <= 2 ? ' disabled' : ''}>&times;</button>
          </div>`).join('')}
      </div>
      ${q.options.length < 6 ? '<button class="link" data-act="opt-add">Add another answer</button>' : ''}
      <input type="text" data-f="explain" maxlength="500" placeholder="Explanation shown after answering (optional)" aria-label="Explanation" value="${esc(q.explain)}">
      <p class="issue">${esc(store.questionIssue(q))}</p>
    </li>`;

  // how many questions still can't be played, with a shortcut to the first one
  const issuesBtn = $('[data-act="next-issue"]');
  const paintIssues = () => {
    const n = quiz.questions.filter(store.questionIssue).length;
    issuesBtn.hidden = n === 0;
    issuesBtn.textContent = n === 1 ? '1 question is not finished' : `${n} questions are not finished`;
  };

  const render = () => { listEl.innerHTML = quiz.questions.map(cardHTML).join(''); paintIssues(); };
  render();

  let saveTimer = 0;
  const touch = () => {
    quiz.updated = Date.now();
    savedEl.textContent = 'Saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persist(); savedEl.textContent = 'Saved'; }, 350);
  };
  const flush = () => { clearTimeout(saveTimer); persist(); };

  const indexOf = el => Number(el.closest('.qcard').dataset.i);
  const focusCard = (i, sel = 'textarea') => {
    const el = listEl.children[i]?.querySelector(sel);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
  };

  const onInput = e => {
    const t = e.target;
    if (t.id === 'q-title') quiz.title = t.value;
    else if (t.id === 'q-time') quiz.timePerQ = Number(t.value);
    else if (t.id === 'q-shq') quiz.shuffleQ = t.checked;
    else if (t.id === 'q-sha') quiz.shuffleA = t.checked;
    else if (t.dataset.f) {
      const card = t.closest('.qcard');
      const q = quiz.questions[Number(card.dataset.i)];
      if (t.dataset.f === 'q') q.q = t.value;
      else if (t.dataset.f === 'explain') q.explain = t.value;
      else if (t.dataset.f === 'opt') q.options[Number(t.closest('.opt').dataset.j)] = t.value;
      else if (t.dataset.f === 'answer') q.answer = Number(t.value);
      $('.issue', card).textContent = store.questionIssue(q);
      paintIssues();
    } else return;
    touch();
  };
  app.addEventListener('input', onInput);
  app.addEventListener('change', onInput);

  handlers['add-q'] = () => {
    sfx.click();
    quiz.questions.push(store.blankQuestion());
    render(); touch();
    focusCard(quiz.questions.length - 1);
  };
  handlers['add-file'] = () => { sfx.click(); flush(); openImport({ mode: 'append', quiz }); };
  handlers['next-issue'] = () => {
    const i = quiz.questions.findIndex(store.questionIssue);
    if (i < 0) return;
    const q = quiz.questions[i];
    // land on the field that needs filling in: the text, an answer, or the answer letters
    const sel = !q.q.trim() ? 'textarea'
      : q.options.filter(o => o.trim()).length < 2 ? '.opt input[type="text"]'
      : '.pick input';
    focusCard(i, sel);
  };
  handlers['play-this'] = () => { sfx.click(); flush(); go('#/play/' + quiz.id); };
  handlers['q-up'] = el => move(indexOf(el), -1);
  handlers['q-down'] = el => move(indexOf(el), 1);
  handlers['q-dup'] = el => {
    const i = indexOf(el);
    quiz.questions.splice(i + 1, 0, structuredClone(quiz.questions[i]));
    render(); touch();
    focusCard(i + 1);
  };
  handlers['q-del'] = el => {
    const i = indexOf(el);
    quiz.questions.splice(i, 1);
    if (!quiz.questions.length) quiz.questions.push(store.blankQuestion());
    render(); touch();
  };
  handlers['opt-add'] = el => {
    const i = indexOf(el);
    quiz.questions[i].options.push('');
    render(); touch();
    focusCard(i, '.opt:last-child input[type="text"]');
  };
  handlers['opt-del'] = el => {
    const i = indexOf(el);
    const j = Number(el.closest('.opt').dataset.j);
    const q = quiz.questions[i];
    q.options.splice(j, 1);
    if (q.answer === j) q.answer = -1; // the correct answer was removed, so it has to be picked again
    else if (q.answer > j) q.answer--;
    render(); touch();
  };

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= quiz.questions.length) return;
    [quiz.questions[i], quiz.questions[j]] = [quiz.questions[j], quiz.questions[i]];
    render(); touch();
    listEl.children[j]?.querySelector(dir < 0 ? '[data-act="q-up"]:not(:disabled), [data-act="q-down"]' : '[data-act="q-down"]:not(:disabled), [data-act="q-up"]')?.focus();
  }

  leaveView = () => {
    app.removeEventListener('input', onInput);
    app.removeEventListener('change', onInput);
    flush();
  };
}

// ---------- play ----------

const RANKS = [
  [100, 'Root access'],
  [80, 'System operator'],
  [60, 'Packet runner'],
  [40, 'Script kiddie'],
  [0, 'Signal lost'],
];
const PRAISE = ['Correct', 'Access granted', 'Clean hit', 'Nailed it'];

function viewPlay(id) {
  const quiz = find(id);
  if (!quiz) return go('#/');

  const ready = quiz.questions.filter(q => !store.questionIssue(q));
  if (!ready.length) {
    toast('This quiz has no finished questions yet. Complete one to play.');
    return go('#/edit/' + id);
  }
  const skipped = quiz.questions.length - ready.length;
  if (skipped) toast(`Skipped ${plural(skipped, 'unfinished question')}.`);

  let qs = ready.map(q => {
    const opts = q.options.map((t, i) => ({ t: t.trim(), correct: i === q.answer })).filter(o => o.t);
    return { q: q.q.trim(), explain: q.explain.trim(), opts: quiz.shuffleA ? shuffle(opts) : opts };
  });
  if (quiz.shuffleQ) qs = shuffle(qs);

  const limit = quiz.timePerQ;
  const S = { i: 0, score: 0, shown: 0, streak: 0, bestStreak: 0, correct: 0, log: [], locked: true, raf: 0, qStart: 0, lastTick: 6, t0: 0, done: false };
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  setView('play');
  app.innerHTML = `
    <div class="play waiting">
      <div class="hud">
        <a class="link" href="#/">Quit</a>
        <div class="progress" style="--gap:${qs.length > 30 ? 1 : 4}px" role="img" aria-label="Progress">${qs.map(() => '<i></i>').join('')}</div>
        <div class="score" aria-label="Score"><span class="score-n">0</span></div>
      </div>
      <div class="reactor-slot"><div class="streak" role="status"></div></div>
      <div class="timer"${limit ? '' : ' hidden'}><i></i></div>
      <div class="qwrap">
        <p class="qcount"></p>
        <h2 class="qtext"></h2>
      </div>
      <div class="answers"></div>
      <div class="after"></div>
    </div>`;

  const els = {
    play: $('.play'), segs: [...$('.progress').children], score: $('.score'), scoreN: $('.score-n'),
    streak: $('.streak'), timer: $('.timer'), bar: $('.timer i'), qwrap: $('.qwrap'),
    count: $('.qcount'), text: $('.qtext'), answers: $('.answers'), after: $('.after'),
  };
  bg.setMode('play', $('.reactor-slot'));

  function begin() {
    els.play.classList.remove('waiting');
    S.t0 = performance.now();
    show();
  }

  if (calm.matches) begin();
  else {
    const cd = document.createElement('div');
    cd.className = 'countdown';
    cd.setAttribute('aria-hidden', 'true');
    els.play.append(cd);
    ['3', '2', '1'].forEach((n, k) => later(() => { cd.innerHTML = `<span>${n}</span>`; sfx.beep(); }, k * 600));
    later(() => { cd.remove(); sfx.go(); begin(); }, 1800);
  }

  function show() {
    const q = qs[S.i];
    S.locked = false;
    els.count.textContent = `Question ${S.i + 1} of ${qs.length}`;
    els.text.textContent = q.q;
    els.answers.innerHTML = q.opts.map((o, j) => `
      <button class="answer cut tilt" style="--i:${j}" data-act="answer" data-j="${j}">
        <kbd>${LETTERS[j]}</kbd><span>${esc(o.t)}</span>
      </button>`).join('');
    els.after.innerHTML = '';
    els.segs[S.i].className = 'now';
    els.qwrap.classList.remove('in');
    void els.qwrap.offsetWidth;
    els.qwrap.classList.add('in');
    if (limit) {
      S.qStart = performance.now();
      S.lastTick = 6;
      els.timer.classList.remove('low');
      tick();
    }
  }

  function tick() {
    const left = limit - (performance.now() - S.qStart) / 1000;
    els.bar.style.transform = `scaleX(${Math.max(0, left / limit)})`;
    els.timer.classList.toggle('low', left <= 5);
    const sec = Math.ceil(left);
    if (sec <= 5 && sec > 0 && sec < S.lastTick) { S.lastTick = sec; sfx.tick(); }
    if (left <= 0) return answer(-1);
    S.raf = requestAnimationFrame(tick);
  }

  function answer(j) {
    if (S.locked) return;
    S.locked = true;
    cancelAnimationFrame(S.raf);

    const q = qs[S.i];
    const ci = q.opts.findIndex(o => o.correct);
    const right = j === ci;
    const frac = limit ? Math.max(0, 1 - (performance.now() - S.qStart) / 1000 / limit) : 0;
    const buttons = [...els.answers.children];
    buttons.forEach((b, k) => {
      b.disabled = true;
      b.classList.remove('tilt');
      b.classList.add(k === ci ? 'correct' : k === j ? 'wrong' : 'dim');
    });

    if (right) {
      S.streak++;
      S.correct++;
      S.bestStreak = Math.max(S.bestStreak, S.streak);
      const mult = 1 + 0.25 * Math.min(S.streak - 1, 4);
      const gain = Math.round((100 + 50 * frac) * mult);
      S.score += gain;
      const r = buttons[j].getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top + r.height / 2);
      bg.pulse();
      sfx.correct(S.streak);
      const pop = document.createElement('span');
      pop.className = 'gain';
      pop.textContent = '+' + gain;
      els.score.append(pop);
      later(() => pop.remove(), 1000);
      rollScore();
    } else {
      S.streak = 0;
      bg.glitch();
      sfx.wrong();
      els.play.classList.remove('shake');
      void els.play.offsetWidth;
      els.play.classList.add('shake');
    }

    bg.setHeat(S.streak / 5);
    els.segs[S.i].className = right ? 'ok' : 'bad';
    if (S.streak >= 2) {
      const mult = 1 + 0.25 * Math.min(S.streak - 1, 4);
      els.streak.textContent = `${S.streak} in a row, score ×${mult}`;
      els.streak.classList.remove('bump');
      void els.streak.offsetWidth;
      els.streak.classList.add('bump');
    } else els.streak.textContent = '';

    S.log.push({ q: q.q, explain: q.explain, right, picked: j >= 0 ? q.opts[j].t : null, answer: q.opts[ci].t });

    const last = S.i === qs.length - 1;
    const verdict = right ? PRAISE[S.i % PRAISE.length] : j < 0 ? 'Time is up' : 'Not quite';
    els.after.innerHTML = `
      <div class="verdict ${right ? 'ok' : 'bad'}">
        <strong>${verdict}</strong>${right ? '' : `<span>The answer is ${LETTERS[ci]}: ${esc(q.opts[ci].t)}</span>`}
        ${q.explain ? `<p>${esc(q.explain)}</p>` : ''}
      </div>
      <button class="btn" data-act="next">${last ? 'See results' : 'Next question'}</button>`;
    const nextBtn = $('button', els.after);
    nextBtn.focus({ preventScroll: true });
    nextBtn.scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' });
  }

  let rollRaf = 0;
  function rollScore() {
    cancelAnimationFrame(rollRaf);
    const from = S.shown, to = S.score, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 450);
      S.shown = from + (to - from) * k;
      els.scoreN.textContent = fmt(S.shown);
      if (k < 1) rollRaf = requestAnimationFrame(step);
    };
    rollRaf = requestAnimationFrame(step);
  }

  function next() {
    if (!S.locked || S.done) return;
    sfx.click();
    if (S.i === qs.length - 1) return finish();
    S.i++;
    show();
  }

  handlers.answer = el => answer(Number(el.dataset.j));
  handlers.next = next;
  handlers.again = () => { sfx.click(); route(); };

  const onKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || S.done || els.play.classList.contains('waiting')) return;
    if (S.locked) {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.dataset.act !== 'next') { e.preventDefault(); next(); }
      return;
    }
    const k = e.key.toUpperCase();
    const j = /^[1-6]$/.test(k) ? Number(k) - 1 : k.length === 1 ? LETTERS.indexOf(k) : -1;
    if (j >= 0 && j < qs[S.i].opts.length) { e.preventDefault(); answer(j); }
  };
  addEventListener('keydown', onKey);

  function finish() {
    S.done = true;
    const secs = Math.round((performance.now() - S.t0) / 1000);
    const pct = Math.round(S.correct / qs.length * 100);
    const rank = RANKS.find(r => pct >= r[0])[1];
    const isBest = !quiz.best || S.score > quiz.best.score;
    if (isBest) { quiz.best = { score: S.score, pct }; persist(); }

    setView('results');
    app.innerHTML = `
      <div class="results">
        <div class="reactor-slot" aria-hidden="true"></div>
        <p class="rank">${rank}</p>
        <div class="bigscore" aria-label="Score ${fmt(S.score)}">0</div>
        ${isBest && S.score > 0 ? '<p class="newbest">New best score</p>' : ''}
        <dl class="stats">
          <div><dt>Correct</dt><dd>${S.correct} of ${qs.length}</dd></div>
          <div><dt>Best streak</dt><dd>${S.bestStreak}</dd></div>
          <div><dt>Time</dt><dd>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</dd></div>
        </dl>
        <div class="row center">
          <button class="btn big" data-act="again">Play again</button>
          <a class="btn ghost" href="#/edit/${quiz.id}">Edit quiz</a>
          <a class="btn ghost" href="#/">All quizzes</a>
        </div>
        <h3>Review your answers</h3>
        <ol class="review">
          ${S.log.map(l => `
            <li class="cut ${l.right ? 'ok' : 'bad'}">
              <p class="rq">${esc(l.q)}</p>
              ${l.right
                ? `<p class="yours ok">You answered: ${esc(l.picked)}</p>`
                : `<p class="yours bad">${l.picked === null ? 'You ran out of time' : 'You answered: ' + esc(l.picked)}</p>
                   <p class="right">Correct answer: ${esc(l.answer)}</p>`}
              ${l.explain ? `<p class="ex">${esc(l.explain)}</p>` : ''}
            </li>`).join('')}
        </ol>
      </div>`;

    bg.setMode('results', $('.reactor-slot'));
    bg.setHeat(pct / 100);
    sfx.finish(pct >= 60);
    if (pct === 100) fx.rain();
    if (pct >= 60) bg.pulse();

    const big = $('.bigscore');
    const t0 = performance.now();
    const dur = calm.matches ? 0 : 1100;
    const step = now => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      big.textContent = fmt(S.score * (1 - (1 - k) ** 3));
      if (k < 1) rollRaf = requestAnimationFrame(step);
    };
    rollRaf = requestAnimationFrame(step);
    $('[data-act="again"]').focus({ preventScroll: true });
  }

  leaveView = () => {
    cancelAnimationFrame(S.raf);
    cancelAnimationFrame(rollRaf);
    timers.forEach(clearTimeout);
    removeEventListener('keydown', onKey);
  };
}

// ---------- shared link ----------

async function viewShared(code) {
  setView('home');
  app.innerHTML = '<p class="empty">Opening the shared quiz.</p>';
  bg.setMode('home');
  try {
    const quiz = await store.decodeQuiz(code || '');
    if (!quiz || !quiz.questions.length) throw new Error('empty');
    const sig = q => JSON.stringify([q.title, q.questions]);
    let mine = quizzes.find(q => sig(q) === sig(quiz));
    if (!mine) {
      mine = quiz;
      quizzes.push(mine);
      persist();
      toast('Shared quiz saved to your quizzes');
    }
    history.replaceState(null, '', '#/play/' + mine.id);
    route();
  } catch {
    toast('That share link is broken or incomplete.');
    history.replaceState(null, '', '#/');
    route();
  }
}

// ---------- import dialog (CSV file, PDF question paper or pasted text) ----------

const imp = {
  dlg: $('#imp'), drop: $('#imp-drop'), file: $('#imp-file'), text: $('#imp-text'), textLabel: $('#imp-text-label'),
  report: $('#imp-report'), name: $('#imp-name'), nameField: $('#imp-title-field'),
  ok: $('#imp-ok'), title: $('#imp-title'),
  ctx: null, found: [], unanswered: 0,
  pdf: null, // { pages, total, ocrPages } while the text box holds text read from a PDF
  job: 0,    // goes up whenever a new file is read or the dialog closes, so stale reads are dropped
};

const PASTE_LABEL = 'Or paste CSV text, or the questions as plain text';
const PDF_ERRORS = {
  library: 'Could not load the PDF reader. Check your internet connection and try again.',
  ocr: 'This PDF is a scan, and the OCR engine could not be loaded. Check your internet connection and try again.',
  locked: 'This PDF is password protected. Save a copy without the password and import that.',
  broken: 'This file could not be read as a PDF.',
};

const isPdf = file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const titleFrom = name => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 120);
const listPages = p => p.length === 1 ? `Page ${p[0]} was a scan` : `Pages ${p.slice(0, -1).join(', ')} and ${p[p.length - 1]} were scans`;

function setReport(kind, html) {
  imp.report.className = 'report' + (kind ? ' ' + kind : '');
  imp.report.innerHTML = html;
}

function paintOk() {
  const adding = imp.ctx?.mode === 'append';
  const n = imp.found.length;
  imp.ok.disabled = n === 0;
  imp.ok.textContent = n
    ? (adding ? `Add ${plural(n, 'question')}` : `Create quiz with ${plural(n, 'question')}`)
    : (adding ? 'Add questions' : 'Create quiz');
}

function openImport(ctx, file) {
  imp.job++;
  imp.ctx = ctx;
  imp.found = [];
  imp.unanswered = 0;
  imp.pdf = null;
  imp.text.value = '';
  imp.file.value = '';
  imp.name.value = '';
  imp.textLabel.textContent = PASTE_LABEL;
  setReport('', '');
  const adding = ctx.mode === 'append';
  imp.title.textContent = adding ? 'Add questions from a file' : 'Import questions';
  imp.nameField.hidden = adding;
  paintOk();
  if (!imp.dlg.open) imp.dlg.showModal();
  if (file) readImportFile(file);
}

async function readImportFile(file) {
  if (!file) return;
  const job = ++imp.job;
  imp.pdf = null;
  imp.textLabel.textContent = PASTE_LABEL;
  if (isPdf(file)) return readPdfFile(file, job);

  if (file.size > 2 * 1024 * 1024) return setReport('fail', 'That file is larger than 2 MB. Split it into smaller files.');
  const text = await file.text();
  if (job !== imp.job) return;
  imp.text.value = text;
  if (!imp.name.value) imp.name.value = titleFrom(file.name);
  analyze();
}

async function readPdfFile(file, job) {
  if (file.size > 40 * 1024 * 1024) return setReport('fail', 'That PDF is larger than 40 MB. Split it into smaller files.');
  imp.found = [];
  imp.text.value = '';
  paintOk();
  setReport('busy', 'Opening the PDF');
  try {
    const res = await readPdf(file, {
      isCancelled: () => job !== imp.job,
      onProgress: p => {
        if (job !== imp.job) return;
        setReport('busy', p.ocr
          ? `Page ${p.page} of ${p.pages} is a scan. Reading it with OCR, which can take a minute.`
          : `Reading page ${p.page} of ${p.pages}`);
      },
    });
    if (!res || job !== imp.job) return;
    imp.pdf = { pages: res.pages, total: res.total, ocrPages: res.ocrPages };
    imp.text.value = res.text;
    imp.textLabel.textContent = 'Text read from the PDF. Fix any mistakes here and it is checked again.';
    if (!imp.name.value) imp.name.value = titleFrom(file.name);
    analyze();
  } catch (err) {
    if (job !== imp.job) return;
    console.error(err);
    setReport('fail', PDF_ERRORS[err?.code] || PDF_ERRORS.broken);
  }
}

function analyze() {
  const src = imp.text.value;
  if (!src.trim()) {
    const wasPdf = imp.pdf;
    imp.found = [];
    imp.unanswered = 0;
    imp.pdf = null;
    imp.textLabel.textContent = PASTE_LABEL;
    setReport(wasPdf ? 'fail' : '', wasPdf ? '<strong>No text found in this PDF.</strong> The pages may be blank or too faint to read.' : '');
    paintOk();
    return;
  }

  // pasted text can be CSV or a question paper: use whichever reading finds more questions
  const asCsv = rowsToQuestions(parseCSV(src));
  const asPaper = parsePaper(src);
  const paper = imp.pdf ? true : asPaper.questions.length > asCsv.questions.length;
  const more = (list, of) => list.length > 5 ? `<li>and ${list.length - 5} more ${of}</li>` : '';

  if (!paper) {
    const { questions, errors } = asCsv;
    const n = questions.length;
    imp.found = questions;
    imp.unanswered = 0;
    setReport(n === 0 ? 'fail' : errors.length ? 'warn' : '',
      (n ? `<strong>${plural(n, 'question')} ready to import.</strong>`
         : '<strong>No questions found.</strong> For CSV, check the column order. For plain text, number the questions and label the options A, B, C.') +
      (errors.length ? ` ${plural(errors.length, 'row')} skipped:<ul>${errors.slice(0, 5).map(e => `<li>Row ${e.row}: ${esc(e.msg)}</li>`).join('')}${more(errors, 'rows')}</ul>` : ''));
  } else {
    const { questions, notes, unanswered } = asPaper;
    const n = questions.length;
    imp.found = questions;
    imp.unanswered = unanswered;
    const ocr = imp.pdf?.ocrPages || [];
    let html = n
      ? `<strong>${plural(n, 'question')} found.</strong>`
      : '<strong>No questions found.</strong> The text needs numbered questions with options labelled A, B, C.' + (imp.pdf ? ' You can fix the text above and it is checked again.' : '');
    if (n && unanswered) {
      html += (unanswered === n ? ' No answers were found in the text.' : ` ${unanswered} of them ${unanswered === 1 ? 'has' : 'have'} no answer in the text.`) +
        ' You mark the correct answers in the editor after importing.';
    }
    if (notes.length) html += ` ${plural(notes.length, 'question')} skipped:<ul>${notes.slice(0, 5).map(e => `<li>Question ${e.n}: ${esc(e.msg)}</li>`).join('')}${more(notes, 'questions')}</ul>`;
    if (ocr.length) html += `<p>${listPages(ocr)} read with OCR, which can misread letters. Check the text above.</p>`;
    if (imp.pdf && imp.pdf.total > imp.pdf.pages) html += `<p>Only the first ${imp.pdf.pages} of ${imp.pdf.total} pages were read.</p>`;
    setReport(n === 0 ? 'fail' : notes.length || unanswered || ocr.length ? 'warn' : '', html);
  }
  paintOk();
}

imp.file.addEventListener('change', () => readImportFile(imp.file.files[0]));
imp.text.addEventListener('input', analyze);
$('#imp-cancel').addEventListener('click', () => imp.dlg.close());
$('#imp-template').addEventListener('click', () => download('quiz-template.csv', SAMPLE_CSV));
imp.dlg.addEventListener('click', e => { if (e.target === imp.dlg) imp.dlg.close(); });
imp.dlg.addEventListener('close', () => { imp.job++; });

imp.ok.addEventListener('click', () => {
  const n = imp.found.length;
  if (!n) return;
  const todo = imp.unanswered;
  const markNote = todo ? ` Mark the correct answer for ${todo === n ? 'each one' : todo + ' of them'}.` : '';
  sfx.correct(2);
  if (imp.ctx.mode === 'append') {
    const quiz = imp.ctx.quiz;
    // replace a lone untouched blank question instead of leaving it on top
    if (quiz.questions.length === 1 && !quiz.questions[0].q.trim() && quiz.questions[0].options.every(o => !o.trim())) quiz.questions = [];
    quiz.questions.push(...imp.found.slice(0, 500 - quiz.questions.length));
    quiz.updated = Date.now();
    persist();
    imp.dlg.close();
    toast(`Added ${plural(n, 'question')}.${markNote}`);
    route();
  } else {
    const quiz = store.normalizeQuiz({ title: imp.name.value.trim() || 'Imported quiz', questions: imp.found });
    quizzes.push(quiz);
    persist();
    freshId = quiz.id;
    imp.dlg.close();
    toast(`Created a quiz with ${plural(n, 'question')}.${markNote}`);
    // answers still to mark: open the editor, otherwise back to the list
    go(todo ? '#/edit/' + quiz.id : '#/');
  }
});

// drag a CSV or PDF file anywhere onto the page
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  dragDepth++;
  if (imp.dlg.open) imp.drop.classList.add('over');
  else if (document.body.dataset.view !== 'play') document.body.classList.add('dragging');
});
addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { document.body.classList.remove('dragging'); imp.drop.classList.remove('over'); }
});
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  imp.drop.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (imp.dlg.open) return readImportFile(file);
  const view = document.body.dataset.view;
  if (view === 'play') return;
  const editing = view === 'edit' && find(location.hash.split('/')[2]);
  openImport(editing ? { mode: 'append', quiz: editing } : { mode: 'new' }, file);
});

// ---------- sound toggle, card tilt ----------

const soundBtn = $('#sound');
const paintSound = () => {
  soundBtn.textContent = sfx.muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(!sfx.muted));
};
soundBtn.addEventListener('click', () => { sfx.toggle(); paintSound(); });
paintSound();

let tilted = null;
addEventListener('pointermove', e => {
  const el = e.pointerType === 'mouse' && !calm.matches ? e.target.closest?.('.tilt') : null;
  if (tilted && tilted !== el) {
    tilted.style.removeProperty('--rx');
    tilted.style.removeProperty('--ry');
  }
  tilted = el;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', (-y * 9).toFixed(2) + 'deg');
  el.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg');
}, { passive: true });

route();
