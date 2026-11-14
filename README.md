# Quiz Reactor

A multiple-choice quiz maker with four themes, each with its own look, WebGL background, music and battle.

- Write questions by hand in the editor, with 2 to 6 answers each
- Import questions from a CSV file, by file picker, drag and drop, or paste
- Import a PDF question paper, including scanned pages, which are read with OCR
- Play a quiz three ways: a timed quiz with streak multipliers, a battle with health bars, or flashcards
- Pick a theme: Hacker terminal, Pirate seas, Cyberpunk city or Jungle tomb
- Copy a share link that carries the whole quiz in the URL
- Export any quiz back to CSV

There is no build step and no server. Quizzes are saved in the browser's localStorage.

## Run it locally

The app uses JavaScript modules, so it has to be served over HTTP rather than opened as a file.

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Themes

Pick a theme from the tiles on the home page or the menu in the top bar. The choice is remembered in the browser.

| Theme | Background | Music | Battle |
| --- | --- | --- | --- |
| Hacker terminal | Green wireframe corridor | Dark, steady pulse | None, quiz and flashcards only |
| Pirate seas | Night sea under the moon | A jig | From your deck you fire a cannon at an enemy ship while the crew join in with muskets, and she fires back |
| Cyberpunk city | Neon skyline over a wet street | Slow synthwave | You and a rival runner throw light discs at each other on the grid |
| Jungle tomb | Torch-lit stone passage | Hand drums, marimba and flute | You throw stone-tipped spears at the gorilla guarding the tomb door, and it throws rocks |

The music is generated in the browser with WebAudio, so there are no audio files. It starts after the first click or key press, because browsers block sound before that. "Music on" and "Sound on" in the top bar turn the music and the sound effects off separately.

The battles are real-time 3D and seen through your own eyes. The scene fills the whole screen behind the quiz, the enemy faces you in the gap between the health bars at the top and the question, and you see your own cannon, disc or spear in front of you. When the enemy hits you the view shakes and its edges flash red. The ships, runners, gorilla and scenery are built in code from simple shapes, so there are no model files either, and they are drawn with custom shaders: two-step toon lighting with a coloured rim, an animated sea, a neon grid, lit windows, torch flames and a glow pass. They use [three.js](https://threejs.org/), which is loaded from the jsDelivr CDN the first time a battle starts. If it cannot be loaded, the battle still runs with the health bars alone.

The motion follows common game-feel practice:

- Joints follow their target poses through springs (second-order dynamics), so the trunk leads and the hands and head lag and overshoot, instead of everything moving in lockstep.
- Every attack has a readable wind-up, a fast snap, and a follow-through; the defender braces during the wind-up.
- An impact freezes the world for 50 to 150 ms (hit-stop) while the camera shakes by trauma squared along smooth noise, and the target flashes and is knocked back.
- Ships float: four points on each hull sample the same waves the sea shader draws, and heave, pitch and roll follow them with weight.

Noise, hashes and the water waves in the shaders come from the [shader-skills](https://github.com/gokayfem/shader-skills) GLSL library (MIT), bundled into `js/glsl-lib.js`.

## Ways to play

### Quiz

Each correct answer is worth 100 points, plus up to 50 for answering quickly. Consecutive correct answers multiply the score, up to ×2 at five in a row. The best score for each quiz is kept.

### Battle

Available in the Pirate seas, Cyberpunk city and Jungle tomb themes.

- You and the enemy both start with 10 health for every question, so 200 each for a 20-question quiz.
- A correct answer hits the enemy for 10. A wrong answer, or running out of time, lets the enemy hit you for 10.
- You win by getting at least half of the questions right: 10 of 20, or 3 of 5. That is the same as finishing with at least as much health as the enemy.
- If you lose, restart the battle to try again. Battles do not change the quiz's best score.

### Flashcards

Each card shows a question and its options. Turn it over to see the answer and the explanation, then mark it "Got it" or "Still learning". Cards marked "Still learning" come back at the end of the deck until every card is known.

Keys: Space turns the card over, then 1 is "Still learning" and 2 is "Got it".

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

## Put it on GitHub Pages

Push these files to a repository, then in the repository open Settings, Pages, and choose "Deploy from a branch" with the `main` branch and the `/ (root)` folder.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and the import dialog |
| `css/style.css` | All styling and animation, including the colours and fonts of each theme |
| `js/app.js` | Views: home, editor, quiz and battle, flashcards, results |
| `js/themes.js` | The four themes: names, wording, background scene, battle text |
| `js/shader.js` | WebGL backgrounds (one scene per theme) and the reactor |
| `js/battle.js` | The battle: health bars at the top of the page over a fullscreen 3D scene |
| `js/stage3d.js` | The 3D stage: renderer, first-person camera, shaders, post pass, particles, trails, springs, hit-stop and camera shake |
| `js/glsl-lib.js` | GLSL hashes, noise, fBm, water waves and vignette, bundled from shader-skills |
| `js/pov3d.js` | The three fights in first person: scenery, what you hold, both sides' attacks and the endings |
| `js/models3d.js` | The ships, runner and gorilla as 3D models, and how they move |
| `js/music.js` | The four songs and the synth that plays them |
| `js/sfx.js` | Sound effects made with WebAudio |
| `js/audio.js` | The audio context shared by music and sound effects |
| `js/fx.js` | Particle bursts |
| `js/csv.js` | CSV parsing, validation and export |
| `js/pdf.js` | Reading text out of a PDF, with OCR for scanned pages |
| `js/paper.js` | Turning question-paper text into questions |
| `js/store.js` | Saving, loading and share links |
