// Quizzes live in the browser's localStorage. No server, no account.

import { parseCSV, rowsToQuestions, SAMPLE_CSV } from './csv.js';

export const KEY = 'quizreactor.v1';
export const TIMES = [0, 10, 15, 20, 30, 45, 60];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

export function blankQuestion() {
  return { q: '', options: ['', '', '', ''], answer: 0, explain: '' };
}

/** Coerce anything (stored data, a shared link) into a safe, well-formed quiz. */
export function normalizeQuiz(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 500).map(q => {
    const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 6).map(o => str(o, 200));
    while (options.length < 2) options.push('');
    const answer = Number.isInteger(q?.answer) && q.answer >= 0 && q.answer < options.length ? q.answer : 0;
    return { q: str(q?.q, 500), options, answer, explain: str(q?.explain, 500) };
  });
  const best = raw.best && Number.isFinite(raw.best.score) && Number.isFinite(raw.best.pct)
    ? { score: Math.round(raw.best.score), pct: Math.round(raw.best.pct) }
    : null;
  return {
    id: typeof raw.id === 'string' && /^[a-z0-9]{6,24}$/.test(raw.id) ? raw.id : uid(),
    title: str(raw.title, 120),
    timePerQ: TIMES.includes(raw.timePerQ) ? raw.timePerQ : 20,
    shuffleQ: !!raw.shuffleQ,
    shuffleA: !!raw.shuffleA,
    questions,
    best,
    updated: Number.isFinite(raw.updated) ? raw.updated : Date.now(),
  };
}

/** Why a question can't be played yet, or '' if it is ready. */
export function questionIssue(q) {
  if (!q.q.trim()) return 'Add the question text.';
  if (q.options.filter(o => o.trim()).length < 2) return 'Add at least two answers.';
  if (!(q.options[q.answer] || '').trim()) return 'The answer marked as correct is empty.';
  return '';
}

function sampleQuiz() {
  const { questions } = rowsToQuestions(parseCSV(SAMPLE_CSV));
  return normalizeQuiz({ title: 'Cyber basics', timePerQ: 20, shuffleA: true, questions });
}

export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(data?.quizzes)) return data.quizzes.map(normalizeQuiz).filter(Boolean);
  } catch { /* fall through to a fresh start */ }
  const first = [sampleQuiz()];
  save(first);
  return first;
}

export function save(quizzes) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ quizzes }));
    return true;
  } catch {
    return false;
  }
}

// ---- share links: the whole quiz is packed into the URL, so no backend is needed ----

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodeQuiz(quiz) {
  const json = JSON.stringify({
    t: quiz.title,
    s: [quiz.timePerQ, +quiz.shuffleQ, +quiz.shuffleA],
    q: quiz.questions.map(q => [q.q, q.options, q.answer, q.explain]),
  });
  const bytes = new TextEncoder().encode(json);
  if ('CompressionStream' in window) return 'z.' + b64u(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j.' + b64u(bytes);
}

export async function decodeQuiz(code) {
  let bytes = unb64u(code.slice(2));
  if (code.startsWith('z.')) bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (!code.startsWith('j.')) throw new Error('unknown format');
  const d = JSON.parse(new TextDecoder().decode(bytes));
  return normalizeQuiz({
    title: d.t,
    timePerQ: d.s?.[0],
    shuffleQ: d.s?.[1],
    shuffleA: d.s?.[2],
    questions: (Array.isArray(d.q) ? d.q : []).map(r => ({ q: r?.[0], options: r?.[1], answer: r?.[2], explain: r?.[3] })),
  });
}
