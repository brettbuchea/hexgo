// HexGo Edge Eyes reference engine — the same rules as ../engine.js, written the slow, plain way.
//
// A group stays on the board if it has
//   (a) a LIBERTY PAIR: two empty cells that touch each other and both touch the group, or
//   (b) at least 2 EYE LIBERTIES: empty cells inside regions the group encloses.
// An eye region is a connected area of empty cells enclosed by the owner's stones; the board
// edge counts as part of the enclosure (EDGE_EYES), so edge areas work like internal eyes. When a move is resolved, the opponent is judged first, and the mover's
// *doomed* stones (no liberty pair, fewer than 2 empty cells in regions bordered only by
// themselves) do not break an eye — an invader that cannot live cannot hold an eye open.
// This only applies to invaders inside a single group's enclosure, not to walls.
//
// Works in the browser (window.HexGoEngine) and in Node (require('./engine.js')).
(function (root) {
  'use strict';

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  // Axial directions in ring order: consecutive entries are neighbours of each other.
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  const other = (c) => (c === BLACK ? WHITE : BLACK);

  // A hexagon-shaped board with `side` cells along each edge.
  function createBoard(side) {
    const R = side - 1;
    const cells = [];
    const index = new Map();
    for (let r = -R; r <= R; r++) {
      for (let q = -R; q <= R; q++) {
        if (Math.abs(q + r) > R) continue;
        index.set(q + ',' + r, cells.length);
        cells.push([q, r]);
      }
    }
    const neighbors = cells.map(([q, r]) => {
      const out = [];
      for (const [dq, dr] of DIRS) {
        const j = index.get((q + dq) + ',' + (r + dr));
        if (j !== undefined) out.push(j);
      }
      return out;
    });
    const adj = cells.map((_, i) => new Set(neighbors[i]));
    return { side, size: cells.length, cells, index, neighbors, adj };
  }

  // Connected components of cells satisfying `pred`; `same(a, b)` optionally splits them further.
  function components(board, pred, same) {
    const comp = new Int32Array(board.size).fill(-1);
    const list = [];
    for (let i = 0; i < board.size; i++) {
      if (comp[i] !== -1 || !pred(i)) continue;
      const id = list.length, cellsOf = [i];
      comp[i] = id;
      for (let k = 0; k < cellsOf.length; k++) {
        for (const n of board.neighbors[cellsOf[k]]) {
          if (comp[n] === -1 && pred(n) && (!same || same(i, n))) { comp[n] = id; cellsOf.push(n); }
        }
      }
      list.push(cellsOf);
    }
    return { comp, list };
  }

  // Full life analysis of every group on the board. Doomed groups of `ghost` (a colour, or
  // nothing) are see-through when measuring the other colour's eyes.
  function analyze(board, stones, ghost) {
    const { comp: groupOf, list: groupCells } = components(board, (i) => stones[i] !== EMPTY, (a, b) => stones[a] === stones[b]);
    const groups = groupCells.map((cells, id) => {
      const color = stones[cells[0]];
      const libs = new Set();
      for (const c of cells) for (const n of board.neighbors[c]) if (stones[n] === EMPTY) libs.add(n);
      let pair = null;
      for (const l of libs) {
        for (const m of board.neighbors[l]) if (m > l && libs.has(m)) { pair = [l, m]; break; }
        if (pair) break;
      }
      return { id, color, cells, libs, pair, eyeLibs: 0, eyes: [], basicEyeLibs: 0, doomed: false, alive: false };
    });

    // Groups bordering a region, and whether the edge-free border is all one colour.
    const borderOf = (cells, inRegion) => {
      const touching = new Set();
      for (const c of cells) for (const n of board.neighbors[c]) if (!inRegion(n)) touching.add(groupOf[n]);
      return touching;
    };

    // Pass 1: plain empty regions, used only to decide which groups are doomed.
    const empties = components(board, (i) => stones[i] === EMPTY);
    const EDGE_EYES = true; // keep in step with engine.js: edge areas count as eyes
    const onEdge = (cells) => !EDGE_EYES && cells.some((c) => board.neighbors[c].length < 6);
    empties.list.forEach((cells, rid) => {
      if (onEdge(cells)) return;
      const touching = borderOf(cells, (n) => empties.comp[n] === rid);
      const colors = new Set([...touching].map((g) => groups[g].color));
      if (colors.size !== 1) return;
      for (const g of touching) groups[g].basicEyeLibs += cells.length;
    });
    for (const g of groups) g.doomed = !g.pair && g.basicEyeLibs < 2;

    // Pass 2: per colour, eye regions may contain doomed `ghost` stones.
    for (const color of [BLACK, WHITE]) {
      const passable = (i) => stones[i] === EMPTY ||
        (stones[i] === ghost && ghost !== color && groups[groupOf[i]].doomed);
      const regions = components(board, passable);
      regions.list.forEach((cells, rid) => {
        const touching = borderOf(cells, (n) => regions.comp[n] === rid);
        if (touching.size === 0) return;
        const hasGhost = cells.some((i) => stones[i] !== EMPTY);
        const allOurs = [...touching].every((g) => groups[g].color === color);
        // Doomed invaders only count inside a single group's enclosure; otherwise fall back
        // to the plain empty eyes inside the region.
        if (hasGhost && !(allOurs && touching.size === 1 && !onEdge(cells))) {
          const done = new Set();
          for (const c of cells) {
            if (stones[c] !== EMPTY) continue;
            const e = empties.comp[c];
            if (done.has(e)) continue;
            done.add(e);
            const ecells = empties.list[e];
            if (onEdge(ecells)) continue;
            const et = borderOf(ecells, (n) => empties.comp[n] === e);
            if (!et.size || [...et].some((g) => groups[g].color !== color)) continue;
            for (const g of et) { groups[g].eyeLibs += ecells.length; groups[g].eyes.push(ecells); }
          }
          return;
        }
        if (!allOurs || onEdge(cells)) return;
        const emptyCells = cells.filter((i) => stones[i] === EMPTY);
        for (const g of touching) {
          groups[g].eyeLibs += emptyCells.length;
          groups[g].eyes.push(emptyCells);
        }
      });
    }
    for (const g of groups) g.alive = !!g.pair || g.eyeLibs >= 2;
    return { groups, groupOf };
  }

  const keyOf = (stones) => String.fromCharCode.apply(null, stones);

  // Try to play `color` at cell `idx`. Returns { ok, stones, captured, reason }.
  // `history` (optional Set of position keys) enforces positional superko.
  function play(board, stones, idx, color, history) {
    if (stones[idx] !== EMPTY) return { ok: false, reason: 'occupied' };
    const next = Uint8Array.from(stones);
    next[idx] = color;
    const captured = [];
    // Opponent groups fall first; repeat in case one removal exposes another.
    for (;;) {
      const { groups } = analyze(board, next, color);
      const dead = groups.filter((g) => g.color !== color && !g.alive);
      if (!dead.length) break;
      for (const g of dead) for (const c of g.cells) { next[c] = EMPTY; captured.push(c); }
    }
    const { groups } = analyze(board, next);
    if (groups.some((g) => g.color === color && !g.alive)) return { ok: false, reason: 'suicide' };
    if (history && history.has(keyOf(next))) return { ok: false, reason: 'ko' };
    return { ok: true, stones: next, captured };
  }

  // Area score: stones plus empty regions bordered by only one colour.
  // `deadCells` (optional Set) are treated as removed before counting.
  function score(board, stones, komi, deadCells) {
    const s = Uint8Array.from(stones);
    if (deadCells) for (const c of deadCells) s[c] = EMPTY;
    const result = { black: 0, white: komi, territory: new Uint8Array(board.size) };
    for (let i = 0; i < board.size; i++) {
      if (s[i] === BLACK) result.black++;
      else if (s[i] === WHITE) result.white++;
    }
    const regions = components(board, (i) => s[i] === EMPTY);
    for (const cells of regions.list) {
      const colors = new Set();
      for (const c of cells) for (const n of board.neighbors[c]) if (s[n] !== EMPTY) colors.add(s[n]);
      if (colors.size !== 1) continue;
      const owner = [...colors][0];
      for (const c of cells) result.territory[c] = owner;
      if (owner === BLACK) result.black += cells.length; else result.white += cells.length;
    }
    return result;
  }

  // Groups of `color` that the opponent could capture with a single move right now.
  function threatened(board, stones, color, history) {
    const { groupOf } = analyze(board, stones);
    const atRisk = new Set();
    for (let i = 0; i < board.size; i++) {
      if (stones[i] !== EMPTY) continue;
      const res = play(board, stones, i, other(color), history);
      if (!res.ok) continue;
      for (const c of res.captured) if (stones[c] === color) atRisk.add(groupOf[c]);
    }
    return atRisk;
  }

  const api = { EMPTY, BLACK, WHITE, DIRS, other, createBoard, analyze, play, score, threatened, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HexGoEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
