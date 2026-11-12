// Turns the plain text of a question paper into quiz questions.
//
// It understands the usual layouts:
//   1. What is 2 + 2?          Q1) ...        Question 1: ...      (1) ...
//   A. 3                       (a) 3          a) 3                 A. 3  B. 4  C. 5
//   Answer: B                  *B. 4          B. 4 (correct)
// plus an answer key at the end ("Answer key" then "1. B  2. C ...").
// A question with no answer found comes back with answer -1, to be marked by
// hand in the editor.

const LETTERS = 'ABCDEF';
const idx = ch => LETTERS.indexOf(ch.toUpperCase());

const RE_Q_WORD = /^(?:q(?:uestion|n)?|soalan)\s*[.#]?\s*(\d{1,3})\s*[.):\-–]?\s*(.*)$/i;
const RE_Q_NUM = /^(?:\((\d{1,3})\)|(\d{1,3})\s*[.)])(?:\s+(.*))?$/;
const RE_OPT = /^([*✓✔►→•]\s*)?(?:\(([A-Fa-f])\)\s*|\[([A-Fa-f])\]\s*|([A-Fa-f])\s?[.)](?:\s+|$))(.*)$/;
const RE_ANS = /^(?:correct\s+)?(?:answer|ans|jawapan|key)\b\s*(?:is\b)?\s*([:.\-–=]*)\s*(.*)$/i;
const RE_ANS_TAIL = /\s+(?:correct\s+)?(?:answer|ans|jawapan)\s*[:.\-–=]\s*\(?([A-Fa-f])\)?\.?\s*$/i;
const RE_EXP = /^(?:explanation|explain|reason|rationale|solution|penjelasan|huraian)\s*[:.\-–]\s*(.*)$/i;
const RE_RIGHT_TAIL = /\s*(?:\*+|✓|✔|\(correct(?: answer)?\)|\[correct\]|<-+\s*correct)\s*$/i;
const RE_MARKS_TAIL = /\s*[[(]\s*\d+\s*(?:marks?|markah|m)\s*[\])]\s*$/i;
const RE_NOISE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|-\s*\d+\s*-|\d{1,4})$/i;
const RE_SECTION = /^(?:section|part|bahagian)\s+[A-Z0-9]+\b/i;
const RE_KEY_HEAD = /^(?:answers?(?:\s+(?:key|sheet|scheme))?|key|skema\s+jawapan|jawapan|marking\s+scheme)\s*:?$/i;
const RE_PAIR = /\(?(\d{1,3})\s*[.):=\-–]*\s*\(?([A-Fa-f])\)?(?![A-Za-z0-9])/g;
const RE_KEY_LINE = /^(?:\(?\d{1,3}\s*[.):=\-–]*\s*\(?[A-Fa-f]\)?[.,;|]?\s*)+$/;
const RE_KEY_NOTE = /^\(?\d{1,3}\s*[.):=\-–]*\s*\(?[A-Fa-f]\)?\s*[-–:.]\s+\S/;

const pairs = line => [...line.matchAll(RE_PAIR)].map(m => [Number(m[1]), idx(m[2])]);
const looksLikeQuestion = line => RE_Q_WORD.test(line) || RE_Q_NUM.test(line);

/** Pull the answer key (if there is one) out of the text. */
function takeKey(raw) {
  const lines = [];
  const headed = [];
  const loose = [];
  let inKey = false;

  for (const line of raw) {
    if (line && RE_KEY_HEAD.test(line)) { inKey = true; continue; }
    if (inKey) {
      if (!line) continue;
      if (RE_KEY_LINE.test(line)) { headed.push(...pairs(line)); continue; }
      if (RE_KEY_NOTE.test(line)) { headed.push(pairs(line)[0]); continue; }
      if (!looksLikeQuestion(line)) continue;
      inKey = false; // the "answers" heading was not a key after all
    }
    if (line && RE_KEY_LINE.test(line)) { loose.push(...pairs(line)); continue; }
    lines.push(line);
  }
  // a key with no heading only counts if there is clearly more than a stray line
  return { lines, key: [...headed, ...(loose.length >= 3 ? loose : [])] };
}

/** Position of the marker for option `i` inside a line, e.g. " B. " or " (b) ". */
function findMarker(text, i, from, lower) {
  const L = lower ? LETTERS[i].toLowerCase() : LETTERS[i];
  const re = new RegExp(`\\s(?:\\(${L}\\)\\s*|\\[${L}\\]\\s*|${L}[.)]\\s+)`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? { at: m.index, end: m.index + m[0].length, paren: /[([]/.test(m[0]) } : null;
}

function build(lines, numbered) {
  const found = [];
  let cur = null;
  let mode = 'idle'; // text | opts | explain | idle | pend
  let blank = false;
  let complete = 0;
  let paras = [[]]; // unnumbered papers: text waiting for its options

  const start = (num, text) => {
    if (cur && cur.options.filter(Boolean).length >= 2) complete++;
    cur = { num, text: [], options: [], answer: -1, explain: [], lower: false };
    found.push(cur);
    mode = 'text';
    if (text) addText(text);
  };

  // add option `i`, then peel off any further options sitting on the same line
  const addOption = (i, text, lower, marked) => {
    while (cur.options.length < i) cur.options.push('');
    cur.options.push(text);
    cur.lower = lower;
    if (marked) cur.answer = i;
    mode = 'opts';
    for (let next = cur.options.length; next < 6; next++) {
      const last = cur.options[next - 1];
      const m = findMarker(last, next, 0, lower);
      if (!m) break;
      cur.options[next - 1] = last.slice(0, m.at).trim();
      cur.options.push(last.slice(m.end).trim());
    }
  };

  // question text, which may carry its options on the same line: "…? A. x B. y C. z"
  function addText(line) {
    for (const lower of [false, true]) {
      const a = findMarker(' ' + line, 0, 0, lower);
      if (!a || (lower && !a.paren)) continue;
      const padded = ' ' + line;
      if (!findMarker(padded, 1, a.end, lower)) continue;
      const before = padded.slice(0, a.at).trim();
      if (before) cur.text.push(before);
      addOption(0, padded.slice(a.end).trim(), lower, false);
      return;
    }
    cur.text.push(line);
  }

  const acceptNumber = n => {
    if (!cur || cur.num === null) return true;
    const prev = cur.num;
    const done = cur.options.filter(Boolean).length >= 2;
    if (n === prev + 1) return true;
    if (n === 1) return done || (complete === 0 && prev !== 1); // numbering restarts, or a numbered list of instructions came first
    return done && n > prev && n <= prev + 5; // a question the OCR missed
  };

  for (const line of lines) {
    if (!line) { blank = true; continue; }
    if (RE_NOISE.test(line)) { blank = true; continue; }
    const afterBlank = blank;
    blank = false;

    if (RE_SECTION.test(line) && line.length < 60) { mode = 'idle'; paras = [[]]; continue; }

    if (numbered) {
      const w = RE_Q_WORD.exec(line);
      if (w) { start(Number(w[1]), w[2].trim()); continue; }
      const n = RE_Q_NUM.exec(line);
      if (n && acceptNumber(Number(n[1] ?? n[2]))) { start(Number(n[1] ?? n[2]), (n[3] || '').trim()); continue; }
    }

    const o = RE_OPT.exec(line);
    if (o) {
      const letter = o[2] || o[3] || o[4];
      const i = idx(letter);
      const lower = letter !== letter.toUpperCase();
      const text = o[5].trim();
      if (!numbered && i === 0 && (!cur || cur.options.length)) {
        // an "A" option with question text waiting above it starts the next question
        const para = paras[paras.length - 1].length ? paras[paras.length - 1] : paras[paras.length - 2] || [];
        if (para.length || !cur) {
          start(null, '');
          cur.text = para;
          paras = [[]];
          addOption(0, text, lower, !!o[1]);
          continue;
        }
      }
      if (cur && mode !== 'explain') {
        const expected = cur.options.length;
        if (i === expected || (expected > 0 && i === expected + 1)) { addOption(i, text, lower, !!o[1]); continue; }
      }
    }

    if (cur && cur.options.length) {
      const a = RE_ANS.exec(line);
      if (a && (a[1] || /^\(?[A-Fa-f]\)?$/.test(a[2].trim()))) {
        const v = a[2].trim();
        const byLetter = /^\(?([A-Fa-f])\)?(?:[.):,\s]|$)/.exec(v);
        if (byLetter) {
          if (idx(byLetter[1]) < cur.options.length) cur.answer = idx(byLetter[1]);
        } else if (v) {
          const want = v.replace(/[.\s]+$/, '').toLowerCase();
          const hit = cur.options.findIndex(t => t && t.replace(/[.\s]+$/, '').toLowerCase() === want);
          if (hit >= 0) cur.answer = hit;
        }
        mode = 'idle';
        continue;
      }
      const x = RE_EXP.exec(line);
      if (x) { mode = 'explain'; if (x[1]) cur.explain.push(x[1]); continue; }
    }

    // plain text: decide what it belongs to
    if (!cur) { if (!numbered) pushPara(line, afterBlank); continue; }
    if (mode === 'text') { addText(line); continue; }
    if (mode === 'explain') {
      if (afterBlank) { mode = 'idle'; if (!numbered) pushPara(line, true); } else cur.explain.push(line);
      continue;
    }
    if (mode === 'opts') {
      const done = cur.options.filter(Boolean).length >= 2;
      const newBlock = done && (afterBlank || (!numbered && /[?:]$/.test(line)));
      if (!newBlock) { cur.options[cur.options.length - 1] += ' ' + line; continue; }
      mode = 'idle';
    }
    if (!numbered) pushPara(line, afterBlank);
  }

  function pushPara(line, fresh) {
    if (fresh && paras[paras.length - 1].length) paras.push([]);
    paras[paras.length - 1].push(line);
  }

  return found;
}

const tidy = s => s.replace(/\s+/g, ' ').trim();

/**
 * Parse question-paper text.
 * Returns { questions, notes: [{ n, msg }], unanswered }.
 */
export function parsePaper(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]/g, ' ').replace(/\s+/g, ' ').trim());
  const { lines, key } = takeKey(raw);

  const ready = list => list.filter(q => q.text.join('').trim() && q.options.filter(o => o.trim()).length >= 2);
  let found = build(lines, true);
  if (!ready(found).length) {
    const alt = build(lines, false);
    if (ready(alt).length) found = alt;
  }

  const notes = [];
  const good = [];
  for (const q of found) {
    // answers written on the option itself: "B. 4 *", "B. 4 (correct)", "D. 6 Answer: B"
    q.options = q.options.map((o, i) => {
      let t = o;
      const tail = RE_ANS_TAIL.exec(t);
      if (tail) { t = t.slice(0, tail.index); if (idx(tail[1]) < q.options.length) q.answer = idx(tail[1]); }
      if (RE_RIGHT_TAIL.test(t) && t.replace(RE_RIGHT_TAIL, '').trim()) { t = t.replace(RE_RIGHT_TAIL, ''); q.answer = i; }
      return tidy(t);
    });
    q.q = tidy(q.text.join(' ')).replace(RE_MARKS_TAIL, '');
    const filled = q.options.filter(Boolean).length;
    if (q.q && filled >= 2) good.push(q);
    else if (q.q && q.num !== null) notes.push({ n: q.num, msg: filled ? 'only one answer option was found' : 'no answer options were found' });
  }

  if (key.length) {
    const nums = good.map(q => q.num);
    const unique = !nums.includes(null) && new Set(nums).size === nums.length;
    const byNum = new Map();
    for (const [n, a] of key) if (!byNum.has(n)) byNum.set(n, a);
    good.forEach((q, i) => {
      if (q.answer >= 0) return;
      const a = unique ? byNum.get(q.num) : key.length === good.length ? key[i][1] : undefined;
      if (a !== undefined && q.options[a]) q.answer = a;
    });
  }

  const questions = good.slice(0, 500).map(q => {
    // drop empty slots (an option the scan missed), keeping the answer on the same text
    const options = [];
    let answer = -1;
    q.options.forEach((o, i) => {
      if (!o) return;
      if (i === q.answer) answer = options.length;
      options.push(o.slice(0, 200));
    });
    return { q: q.q.slice(0, 500), options: options.slice(0, 6), answer: answer < 6 ? answer : -1, explain: tidy(q.explain.join(' ')).slice(0, 500) };
  });

  return { questions, notes, unanswered: questions.filter(q => q.answer < 0).length };
}
