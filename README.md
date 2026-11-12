# Quiz Reactor

A multiple-choice quiz maker with a green-on-black hacker terminal look: a calm WebGL wireframe corridor, a 3D reactor that heats up with your streak, particle bursts and synth sounds.

- Write questions by hand in the editor, with 2 to 6 answers each
- Import questions from a CSV file, by file picker, drag and drop, or paste
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

## Scoring

Each correct answer is worth 100 points, plus up to 50 for answering quickly. Consecutive correct answers multiply the score, up to ×2 at five in a row.

## Put it on GitHub Pages

Push these files to a repository, then in the repository open Settings, Pages, and choose "Deploy from a branch" with the `main` branch and the `/ (root)` folder.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and the CSV import dialog |
| `css/style.css` | All styling and animation |
| `js/app.js` | Views: home, editor, play, results |
| `js/shader.js` | WebGL background (corridor and reactor) |
| `js/csv.js` | CSV parsing, validation and export |
| `js/store.js` | Saving, loading and share links |
| `js/sfx.js` | Sound effects made with WebAudio |
| `js/fx.js` | Particle bursts |
