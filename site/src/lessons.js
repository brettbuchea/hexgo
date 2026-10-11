// Board positions for the diagrams on the Learn page. Runs in the page and in Node
// (check-lessons.js plays every one on the Edge Eyes engine to confirm what the page says).
//
// Cells are axial "q,r" strings. A figure is { side, black, white, marks, puzzle }:
//   marks:  { pair: [cells], eye: [cells] } drawn on empty cells
//   puzzle: { solution: [cells] }  Black to play; exactly these moves capture something.
//           An empty solution means nothing captures (a "try it, you can't" figure).
//   last:   the cell just played; gone: [{ cell, color }] stones that move captured
//   eyes + verdict: an eye shape for the "Kinds of eyes" list, and how it fares when Black
//           plays inside it: 'pair' (one cell: the group lives on its outside pair),
//           'capture' (one move inside captures), 'dead' (Black captures whatever White
//           answers), 'safe' (Black has no legal move inside).
function hexGoLessons(E) {
  'use strict';
  const cells = (s) => s.trim().split(/\s+/).filter(Boolean);

  // Black stones on every cell that touches `white` from outside: all its neighbours except
  // the `eyes` it encloses and the cells in `leave`.
  function siege(side, white, eyes, leave) {
    const board = E.createBoard(side);
    const skip = new Set([...white, ...eyes, ...(leave || [])]);
    const out = new Set();
    for (const w of white) {
      for (const n of board.neighbors[board.index.get(w)]) {
        const name = board.cells[n].join(',');
        if (!skip.has(name)) out.add(name);
      }
    }
    return [...out];
  }

  // White stones on every cell that touches the `eyes` area.
  function ring(side, eyes) {
    const board = E.createBoard(side);
    const inside = new Set(eyes), out = new Set();
    for (const e of eyes) {
      for (const n of board.neighbors[board.index.get(e)]) {
        const name = board.cells[n].join(',');
        if (!inside.has(name)) out.add(name);
      }
    }
    return [...out];
  }

  // An eye shape closed in by White and surrounded by Black, except for the `leave` cells.
  function eyeShape(eyeCells, verdict, leave, side) {
    side = side || 4;
    const eyes = cells(eyeCells), white = ring(side, eyes);
    return { side, white, black: siege(side, white, eyes, leave && cells(leave)), marks: { eye: eyes }, eyes, verdict };
  }

  // The figure reached by playing `cell` for `color` ('black' or 'white') in figure `f`.
  function after(f, cell, color) {
    const board = E.createBoard(f.side);
    const stones = new Uint8Array(board.size);
    for (const c of f.black) stones[board.index.get(c)] = E.BLACK;
    for (const c of f.white) stones[board.index.get(c)] = E.WHITE;
    const r = E.play(board, stones, board.index.get(cell), color === 'black' ? E.BLACK : E.WHITE);
    if (!r.ok) throw new Error(`lesson move ${cell} is not legal: ${r.reason}`);
    const names = (c) => board.cells.map((x) => x.join(',')).filter((_, i) => r.stones[i] === c);
    return { side: f.side, black: names(E.BLACK), white: names(E.WHITE), last: cell,
             gone: r.captured.map((i) => ({ cell: board.cells[i].join(','), color: stones[i] })) };
  }

  const figs = {};

  figs.groups = { side: 4, black: cells('-1,0 0,0 0,-1 -2,2'), white: cells('1,1 2,0') };

  figs.pair = { side: 4, white: cells('0,0'), black: cells('1,0 0,-1'), marks: { pair: cells('-1,1 0,1') } };

  figs.open = { side: 4, white: cells('0,0'), black: cells('1,0 0,-1'), puzzle: { solution: cells('-1,1') } };

  figs.edge = { side: 4, white: cells('1,-3'), black: cells('1,-2'), puzzle: { solution: cells('0,-2 0,-3') } };

  figs.corner = { side: 4, white: cells('3,-3'), black: [], puzzle: { solution: cells('2,-2') } };

  {
    const white = cells('1,0 1,-1 0,-1 -1,0 -1,1 0,1'), eye = cells('0,0'), leave = cells('-2,2 -1,2');
    figs.oneEye = { side: 4, white, black: siege(4, white, eye, leave), marks: { eye }, puzzle: { solution: leave } };
  }
  {
    const white = cells('0,0 0,-1 -1,-1 -2,0 -2,1 -1,1 2,0 2,-1 1,-1 0,1 1,1'), eyes = cells('-1,0 1,0');
    figs.twoEyes = { side: 4, white, black: siege(4, white, eyes), marks: { eye: eyes }, puzzle: { solution: eyes } };
  }
  {
    const white = cells('0,-1 -1,-1 -2,0 -2,1 -1,1 1,-1 0,1 2,0 2,-1 1,1'), eyes = cells('-1,0 0,0 1,0');
    figs.safeEye = { side: 4, white, black: siege(4, white, eyes), marks: { eye: eyes }, puzzle: { solution: [] } };
  }
  {
    const white = cells('1,-3 -1,-2 0,-2 1,-2 2,-2 3,-3'), eyes = cells('0,-3 2,-3');
    figs.edgeEyes = { side: 4, white, black: siege(4, white, eyes), marks: { eye: eyes }, puzzle: { solution: eyes } };
  }
  {
    const white = cells('2,-3 1,-2 0,-2 -1,-2'), eyes = cells('0,-3 1,-3');
    figs.twoCellEye = { side: 4, white, black: siege(4, white, eyes), marks: { eye: eyes }, puzzle: { solution: eyes } };
  }
  {
    const white = cells('3,-3 2,-2 1,-2 0,-2 -1,-2'), eyes = cells('0,-3 1,-3 2,-3');
    figs.threeCellEye = { side: 4, white, black: siege(4, white, eyes), marks: { eye: eyes }, puzzle: { solution: [] } };
  }

  // Kinds of eyes, each in the centre and on the edge.
  figs.kOneC = eyeShape('0,0', 'pair', '-2,2 -1,2');
  figs.kOneE = eyeShape('1,-3', 'pair', '3,-3 2,-2');
  figs.kTwoC = eyeShape('0,0 1,0', 'capture');
  figs.kTwoE = eyeShape('1,-3 2,-3', 'capture');
  figs.kApartC = eyeShape('-1,0 1,0', 'capture');
  figs.kApartE = eyeShape('0,-3 2,-3', 'capture');
  figs.kRowC = eyeShape('-1,0 0,0 1,0', 'safe');
  figs.kRowE = eyeShape('0,-3 1,-3 2,-3', 'safe');
  figs.kBentC = eyeShape('-1,0 0,0 0,1', 'safe');
  figs.kBentE = eyeShape('1,-3 0,-3 -1,-2', 'safe');
  figs.kTwoOneC = eyeShape('0,0 1,0 -2,0', 'safe', null, 5);
  figs.kTwoOneE = eyeShape('0,-3 1,-3 3,-3', 'safe');
  figs.kThreeOnesC = eyeShape('1,0 0,-1 -1,1', 'safe', null, 5);
  figs.kThreeOnesE = eyeShape('2,-3 0,-3 -2,-1', 'safe');
  figs.kTriC = eyeShape('0,0 1,0 0,1', 'dead');
  figs.kTriE = eyeShape('1,-3 2,-3 1,-2', 'dead');

  // The triangle of death, step by step: Black goes in, White captures, Black goes in again.
  figs.tri1 = Object.assign(after(figs.kTriC, '0,0', 'black'), { marks: { eye: cells('1,0 0,1') } });
  figs.tri2 = Object.assign(after(figs.tri1, '1,0', 'white'), { marks: { eye: cells('0,1') } }); // 0,0 shows the captured stone
  figs.tri3 = { side: 4, black: figs.tri2.black, white: figs.tri2.white, marks: { eye: cells('0,0 0,1') }, puzzle: { solution: cells('0,0 0,1') } };
  return figs;
}

if (typeof module !== 'undefined' && module.exports) module.exports = hexGoLessons;
