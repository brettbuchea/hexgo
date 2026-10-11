# HexGo site

A one-page site for HexGo (Edge Eyes rules) with a home page and two sections:

- **Play** — Local (against the computer, two players on one device, or watching two computers) and Online
  (against a friend, by sending a link; needs the server in `../online`).
- **Learn** — the rules, with diagrams you can tap. They are played by the same engine as the game.

## Files

- `src/page.html` — the page: layout, styles and script.
- `src/lessons.js` — the board positions for the Learn diagrams.
- `src/fonts.css` — the fonts for the public page, served from `../docs/fonts/` instead of Google.
- `build.js` — writes `hexgo.html`: the page with `../HexGo-EdgeEyes/engine.js`, `ai.js` and the
  lessons written into it. Run it after changing any of them: `node build.js`
- `online.json` — the address of the online-play server (`../online`). The Online option is switched on
  in the public page only when this file exists.
- `check-lessons.js` — plays every Learn diagram on the engine and checks it behaves as the page
  says (the starting position is legal, and the moves that capture are the ones listed):
  `node check-lessons.js`
- `hexgo.html` — the built page for the Claude Artifact.
- `../docs/index.html` — the same page as a complete document. GitHub Pages serves the `docs/` folder at
  https://brettbuchea.github.io/hexgo/, so the public site changes when a rebuilt copy is pushed.

The recorded game on the home page and in the scoring lesson is Medium against Medium on 5 per
side, seed 21 (`AI.playGame`), recorded with komi 5.5. Scored with the current komi of 6 it is a draw.
