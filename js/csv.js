// CSV reading and writing for quiz questions.
//
// Expected layout, one question per row:
//   question, option_a, option_b, option_c, option_d, answer, explanation
// With a header row the columns can be in any order and there can be 2 to 6
// option columns. The answer can be a letter (A-F), a number (1-6) or the
// exact text of the correct option.

const LETTERS = 'ABCDEF';

function detectDelimiter(text) {
  let inQ = false;
  const count = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of text) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === '\n' || ch === '\r')) break;
    else if (!inQ && ch in count) count[ch]++;
  }
  const [best, hits] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return hits > 0 ? best : ',';
}

/** Parse CSV text into rows: [{ n: rowNumber, cells: string[] }]. Blank rows are dropped. */
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', inQ = false, quoted = false;

  const endCell = () => { row.push(quoted ? cell : cell.trim()); cell = ''; quoted = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { inQ = true; quoted = true; cell = ''; }
    else if (ch === delim) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();

  return rows
    .map((cells, i) => ({ n: i + 1, cells: cells.map(c => c.trim()) }))
    .filter(r => r.cells.some(c => c !== ''));
}

function findAnswer(raw, options) {
  const a = raw.trim();
  if (!a) return -1;
  const byText = options.findIndex(o => o && o.toLowerCase() === a.toLowerCase());
  if (byText >= 0) return byText;
  if (/^[a-f]$/i.test(a)) return LETTERS.indexOf(a.toUpperCase());
  if (/^[1-6]$/.test(a)) return Number(a) - 1;
  return -1;
}

/**
 * Turn parsed rows into questions.
 * Returns { questions, errors: [{ row, msg }], hasHeader }.
 */
export function rowsToQuestions(rows) {
  const out = { questions: [], errors: [], hasHeader: false };
  if (!rows.length) return out;

  // default layout: question, 4 options, answer, explanation
  let col = { q: 0, opts: [1, 2, 3, 4], ans: 5, exp: 6 };
  let body = rows;

  const head = rows[0].cells.map(c => c.toLowerCase().replace(/[\s_-]+/g, ''));
  const qi = head.findIndex(c => /^(questions?|q|prompt)$/.test(c));
  const ai = head.findIndex(c => /^(answers?|correct(answer|option)?|key)$/.test(c));
  if (qi >= 0 && ai >= 0) {
    out.hasHeader = true;
    body = rows.slice(1);
    const ei = head.findIndex(c => /^(explanations?|explain|reason|notes?)$/.test(c));
    let opts = head.map((c, i) => (/^(option|choice|opt)/.test(c) || /^[a-f]$/.test(c) ? i : -1)).filter(i => i >= 0);
    if (!opts.length) opts = head.map((_, i) => i).filter(i => i !== qi && i !== ai && i !== ei);
    col = { q: qi, opts: opts.slice(0, 6), ans: ai, exp: ei };
  }

  for (const { n, cells } of body) {
    const q = cells[col.q] || '';
    const rawOpts = col.opts.map(i => cells[i] || '');
    const rawAns = cells[col.ans] || '';
    const explain = col.exp >= 0 ? cells[col.exp] || '' : '';
    const fail = msg => out.errors.push({ row: n, msg });

    if (!q) { fail('the question is empty'); continue; }
    if (rawOpts.filter(Boolean).length < 2) { fail('it needs at least two answer options'); continue; }
    if (!rawAns) { fail('the answer column is empty'); continue; }
    const ai2 = findAnswer(rawAns, rawOpts);
    if (ai2 < 0 || !rawOpts[ai2]) { fail(`the answer "${rawAns}" doesn't match any option`); continue; }

    // drop empty options, keeping the answer pointed at the same text
    const options = [];
    let answer = 0;
    rawOpts.forEach((o, i) => {
      if (!o) return;
      if (i === ai2) answer = options.length;
      options.push(o.slice(0, 200));
    });
    out.questions.push({ q: q.slice(0, 500), options, answer, explain: explain.slice(0, 500) });
  }
  return out;
}

const cell = v => (/[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Write a quiz's questions back out in the same layout the importer reads. */
export function toCSV(quiz) {
  const width = Math.max(4, ...quiz.questions.map(q => q.options.length));
  const header = ['question', ...Array.from({ length: width }, (_, i) => `option_${LETTERS[i].toLowerCase()}`), 'answer', 'explanation'];
  const lines = [header.join(',')];
  for (const q of quiz.questions) {
    const opts = Array.from({ length: width }, (_, i) => q.options[i] || '');
    lines.push([q.q, ...opts, LETTERS[q.answer] || '', q.explain || ''].map(cell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export const SAMPLE_CSV = `question,option_a,option_b,option_c,option_d,answer,explanation
What does HTTPS add on top of HTTP?,Faster downloads,Encryption with TLS,Bigger file uploads,Free hosting,B,HTTPS wraps HTTP in TLS so others on the network can't read or change the traffic.
Which port does HTTPS use by default?,21,80,443,8080,C,Port 80 is plain HTTP. Port 443 is HTTPS.
What is the binary number 1010 in decimal?,5,8,10,12,C,"8 + 0 + 2 + 0 = 10."
What does a phishing message try to do?,Speed up your computer,Trick you into giving away logins or personal details,Block advertisements,Update your apps,B,"Phishing pretends to be someone you trust, like a bank or a coworker."
What does 2FA stand for?,Two-factor authentication,Two-file archive,Twice-failed access,Two-firewall architecture,A,It asks for a second proof such as a code from your phone as well as your password.
Which of these passwords is the strongest?,P@ssw0rd,qwerty123,Summer2026!,copper-violin-93-harbor-moss,D,Length beats clever substitutions. A long random passphrase is far harder to guess.
What does a firewall do?,Cools down the processor,Filters network traffic using a set of rules,Stores passwords,Compresses files,B,It decides which connections are allowed in and out.
Which language runs natively in web browsers?,Python,JavaScript,Java,C#,B,
What does CPU stand for?,Central processing unit,Computer power utility,Core program uploader,Central peripheral unit,A,
What does a VPN do?,Makes any website load instantly,Removes viruses from files,Encrypts traffic between your device and a VPN server,Gives you a new email address,C,Sites then see the VPN server's address instead of yours.
`;
