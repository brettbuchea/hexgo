# HexGo Edge Eyes

A new game inspired by Go, played on a hexagonal grid. The rules in short:

- A group stays on the board if it has a liberty pair (two empty cells that touch each other and
  both touch the group) or a pair of eyes (at least two eye cells).
- An area closed off by your stones and the board edge is an eye, exactly like an area fully
  surrounded by your stones.
- There is no edge wrap-around. A liberty pair is always two empty cells that really touch, so
  a corner stone is captured by one stone on its middle neighbour and an edge stone by two.

`tools/edge-eyes.js` and `tools/edge-eyes-gallery.js` catalogue the minimal living groups that
use the edge; results are in `results/edge-eyes/`.

## Play

Open `index.html` in a browser. Each colour can be a person or a computer player, so you can
play person vs person, person vs computer, or watch computer vs computer. The match panel plays
many computer games in a row and lists the results; click View on any game, then use the slider
(or the arrow keys) to step through it.

Open `arena.html` to pick two computer players and a board size, watch a whole game, and
step through it turn by turn (slider, back/forward buttons, or arrow keys) with captures listed.

## Files

- `engine.js` — rules engine (liberty pairs, eyes, capture order, superko, scoring)
- `ai.js` — computer players: random mover and Monte Carlo tree search (UCT + RAVE)
- `index.html` — the game board
- `arena.html` — computer-vs-computer viewer
- `tools/scenarios.js` — rule checks: `node tools/scenarios.js`
- `tools/rule-examples.js` — worked rule examples with diagrams, checked against both engines;
  writes `results/rule-examples/rule-examples.html`: `node tools/rule-examples.js`
- `tools/eyeshapes.js` — classifies every enclosed eye shape: `node tools/eyeshapes.js 7`
- `tools/difftest.js` — checks the fast engine against `tools/engine-reference.js`
- `tools/match.js` — command-line matches, e.g.
  `node tools/match.js --side 5 --games 20 --black mcts:1000 --white mcts:1000 --komi 0 --swap`
- `tools/contact-sheet.js` — all of a results folder's boards on one image, after `report.js`:
  `node tools/contact-sheet.js results/medium-side8`
