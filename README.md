# Quiz Reactor

A multiple-choice quiz maker with a green-on-black hacker terminal look: a calm WebGL wireframe corridor, a 3D reactor that heats up with your streak, particle bursts and synth sounds.

- Write questions by hand in the editor, with 2 to 6 answers each
- Import questions from a CSV file, by file picker, drag and drop, or paste
- Import a PDF question paper, including scanned pages, which are read with OCR
- Play against a per-question timer with streak multipliers
- Copy a share link that carries the whole quiz in the URL
- Export any quiz back to CSV

There is no build step and no server. Quizzes are saved in the browser's localStorage.

## Run it locally

The app uses JavaScript modules, so it has to be served over HTTP rather than opened as a file.

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## CSV format

One question per row:

```csv
question,option_a,option_b,option_c,option_d,answer,explanation
What is 2 + 2?,3,4,5,6,B,Basic arithmetic
Largest planet?,Mars,Jupiter,Venus,Earth,Jupiter,
```

- `answer` can be a letter (`A` to `F`), a number (`1` to `6`) or the exact text of the correct option.
- `explanation` is optional and is shown after the player answers.
- The header row is optional when you use the column order above. With a header row the columns can be in any order, and you can have 2 to 6 option columns.
- Commas, semicolons and tabs all work as separators. Wrap a cell in double quotes if it contains the separator.
- Rows with problems are skipped and listed in the import dialog with the reason.

## PDF question papers

Import a PDF that already contains the questions, laid out with numbered questions and lettered options:

```text
1. What is 2 + 2?
A. 3
B. 4
C. 5
Answer: B
```

- Questions can be numbered `1.`, `1)`, `(1)`, `Q1` or `Question 1`. Options can be `A.`, `A)` or `(a)`, one per line or several on a line.
- The correct answer is taken from an `Answer: B` line under the question, a starred option such as `*B. 4`, or an answer key at the end (`Answer key`, then `1. B  2. C`).
- Questions with no answer in the PDF are still imported. The editor lists them as not finished until you mark the correct answer.
- Scanned pages are read with OCR (English), which is slower and can misread letters. The text read from the PDF is shown in the import dialog so you can correct it before importing.
- Only the first 60 pages are read. Pages laid out in two columns may come out in the wrong order.
- The PDF is read in the browser and is not uploaded. The PDF reader ([pdf.js](https://mozilla.github.io/pdf.js/)) and OCR engine ([Tesseract.js](https://tesseract.projectnaptha.com/)) are loaded from the jsDelivr CDN the first time a PDF is imported, so that step needs an internet connection.

The same layout also works as plain text pasted into the import dialog.

## Scoring

Each correct answer is worth 100 points, plus up to 50 for answering quickly. Consecutive correct answers multiply the score, up to ×2 at five in a row.

## Put it on GitHub Pages

Push these files to a repository, then in the repository open Settings, Pages, and choose "Deploy from a branch" with the `main` branch and the `/ (root)` folder.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and the import dialog |
| `css/style.css` | All styling and animation |
| `js/app.js` | Views: home, editor, play, results |
| `js/shader.js` | WebGL background (corridor and reactor) |
| `js/csv.js` | CSV parsing, validation and export |
| `js/pdf.js` | Reading text out of a PDF, with OCR for scanned pages |
| `js/paper.js` | Turning question-paper text into questions |
| `js/store.js` | Saving, loading and share links |
| `js/sfx.js` | Sound effects made with WebAudio |
| `js/fx.js` | Particle bursts |
