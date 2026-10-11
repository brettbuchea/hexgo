// HexGo Edge Eyes rules engine — HexGo where areas closed off by your stones and the board edge
// are eyes, and there is no edge wrap-around: a liberty pair is always two cells that really touch.
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
// The whole engine lives in hexGoEngineModule so it can also be shipped to a Web Worker
// as source text (see ai.js).
function hexGoEngineModule() {
  'use strict';

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  // Axial directions in ring order: consecutive entries are neighbours of each other.
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  const other = (c) => (c === BLACK ? WHITE : BLACK);

  // Edge areas closed off by your stones and the board edge count as eyes, like internal ones.
  // (Set to false for the variant where an eye must be fully ringed by stones.)
  const EDGE_EYES = true;

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
    const size = cells.length;
    // Scratch buffers reused by analyze() so the hot path allocates little.
    // For each cell, its neighbours that touch each other, as a flat list of pairs.
    const nbPairs = neighbors.map((ring) => {
      const out = [];
      for (let a = 0; a < ring.length; a++) for (let b = a + 1; b < ring.length; b++) if (adj[ring[a]].has(ring[b])) out.push(ring[a], ring[b]);
      return Int32Array.from(out);
    });
    const buf = () => new Int32Array(size);
    const scratch = { regionOf: buf(), mark: buf(), seen: buf(), rseen: buf(), gdone: buf(), stack: buf(), stack2: buf(), dead: buf(), stamp: 0,
      // Tables filled by survey().
      sv: { gid: buf(), pairs: buf(), gm: buf(), gm2: buf(), rid: buf(), rcol: new Uint8Array(size), rweak: new Uint8Array(size) } };
    return { side, size, cells, index, neighbors, adj, nbPairs, scratch };
  }

  // A fresh stamp for the scratch `mark` / `seen` / `rseen` / `gdone` buffers: a cell counts as
  // marked when it holds the current stamp. Starts again from 1 long before the stamp could
  // outgrow an Int32Array.
  function nextStamp(sc) {
    if (sc.stamp > 2000000000) { sc.mark.fill(0); sc.seen.fill(0); sc.rseen.fill(0); sc.gdone.fill(0); sc.stamp = 0; }
    return ++sc.stamp;
  }

  // Life analysis of every group. Doomed groups of `ghost` (a colour, or nothing) are
  // see-through when measuring the other colour's eyes.
  // Returns { groups, groupOf }; each group is { color, cells, pair, eyeLibs, doomed, alive }.
  function analyze(board, stones, ghost) {
    const N = board.size, nb = board.neighbors, sc = board.scratch;
    const { mark, stack, regionOf } = sc;
    const groupOf = new Int32Array(N).fill(-1);
    const groups = [];

    // Groups: flood fill same-coloured stones.
    for (let i = 0; i < N; i++) {
      const color = stones[i];
      if (color === EMPTY || groupOf[i] !== -1) continue;
      const gid = groups.length, cells = [i];
      groupOf[i] = gid;
      for (let k = 0; k < cells.length; k++) {
        const ns = nb[cells[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j];
          if (groupOf[n] === -1 && stones[n] === color) { groupOf[n] = gid; cells.push(n); }
        }
      }
      groups.push({ color, cells, pair: false, basic: 0, eyeLibs: 0, doomed: false, alive: false });
    }

    // Liberty pairs: mark each group's liberties, then look for two that touch.
    for (const g of groups) {
      const st = nextStamp(sc);
      let nl = 0;
      for (const c of g.cells) {
        const ns = nb[c];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j];
          if (stones[n] === EMPTY && mark[n] !== st) { mark[n] = st; stack[nl++] = n; }
        }
      }
      outer: for (let k = 0; k < nl; k++) {
        const ns = nb[stack[k]];
        for (let j = 0; j < ns.length; j++) if (mark[ns[j]] === st) { g.pair = true; break outer; }
      }
    }

    // Eye regions. `passable(i)` says which cells a region may contain; a region bordered by
    // one colour (optionally only `onlyColor`) adds its empty cells to each group it touches.
    // The first pass (plain empty regions) is remembered so the second can fall back to it.
    const gmark = new Int32Array(groups.length);
    let gstamp = 0;
    const touching = [];
    let basicOf = null; const basicEyes = []; // basic region id -> { size, groups } if one-coloured
    function eyes(passable, onlyColor, field) {
      regionOf.fill(-1);
      let rid = 0;
      const seenBasic = new Int32Array(basicEyes.length).fill(-1);
      for (let i = 0; i < N; i++) {
        if (regionOf[i] !== -1 || !passable(i)) continue;
        let n0 = 0, empties = 0, colors = 0, ghosts = 0, onEdge = false;
        stack[n0++] = i; regionOf[i] = rid;
        touching.length = 0; gstamp++;
        for (let k = 0; k < n0; k++) {
          const c = stack[k];
          if (stones[c] === EMPTY) empties++; else ghosts++;
          const ns = nb[c];
          if (ns.length < 6) onEdge = true;
          for (let j = 0; j < ns.length; j++) {
            const n = ns[j];
            if (regionOf[n] === rid) continue;
            if (passable(n)) { regionOf[n] = rid; stack[n0++] = n; continue; }
            colors |= stones[n];
            const g = groupOf[n];
            if (gmark[g] !== gstamp) { gmark[g] = gstamp; touching.push(g); }
          }
        }
        // With EDGE_EYES off, an eye must be fully ringed by stones and may not reach the edge.
        const oneColour = (EDGE_EYES || !onEdge) && (colors === BLACK || colors === WHITE) && (!onlyColor || colors === onlyColor);
        if (field === 'basic') basicEyes.push(oneColour ? { size: empties, groups: touching.slice() } : null);
        // Doomed invaders only count as part of an eye when they sit inside one group's
        // enclosure. A doomed stone that touches several enemy groups is a wall, not an
        // invader: seeing through it would invent an eye spanning the whole wall.
        if (oneColour && (!ghosts || touching.length === 1)) {
          for (const g of touching) groups[g][field] += empties;
        } else if (ghosts) {
          // Rejected: fall back to the plain empty eyes inside this region.
          for (let k = 0; k < n0; k++) {
            const c = stack[k];
            if (stones[c] !== EMPTY) continue;
            const b = basicOf[c], e = basicEyes[b];
            if (!e || seenBasic[b] === rid) continue;
            seenBasic[b] = rid;
            for (const g of e.groups) if (groups[g].color === onlyColor) groups[g][field] += e.size;
          }
        }
        rid++;
      }
    }
    eyes((i) => stones[i] === EMPTY, 0, 'basic');
    basicOf = Int32Array.from(regionOf);
    let ghostDoomed = false;
    for (const g of groups) {
      g.doomed = !g.pair && g.basic < 2;
      g.eyeLibs = g.basic;
      if (g.doomed && g.color === ghost) ghostDoomed = true;
    }
    // Doomed ghost stones only change the other colour's eyes, so that is all we recount.
    if (ghostDoomed) {
      const target = other(ghost);
      for (const g of groups) if (g.color === target) g.eyeLibs = 0;
      eyes((i) => stones[i] === EMPTY || (stones[i] === ghost && groups[groupOf[i]].doomed), target, 'eyeLibs');
    }
    for (const g of groups) g.alive = g.pair || g.eyeLibs >= 2;
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
    let a = analyze(board, next, color);
    for (;;) {
      let any = false;
      for (const g of a.groups) {
        if (g.color === color || g.alive) continue;
        any = true;
        for (const c of g.cells) { next[c] = EMPTY; captured.push(c); }
      }
      if (!any) break;
      a = analyze(board, next, color);
    }
    // The ghost only affects the opponent's eyes, so own groups were already judged
    // exactly as a no-ghost analysis would judge them.
    for (const g of a.groups) if (g.color === color && !g.alive) return { ok: false, reason: 'suicide' };
    if (history && history.has(keyOf(next))) return { ok: false, reason: 'ko' };
    return { ok: true, stones: next, captured };
  }

  // Does the group containing `start` have a liberty pair? Marks the group's cells in `seen`
  // with `gst`. Stops at the first pair unless `whole` is set, which marks the entire group so
  // that a caller looking at several stones can skip those of a group it has already checked.
  function hasPair(board, stones, start, gst, whole) {
    const nb = board.neighbors, sc = board.scratch, { mark, seen, stack2 } = sc;
    const st = nextStamp(sc), color = stones[start];
    let n0 = 0, found = false;
    stack2[n0++] = start; seen[start] = gst;
    for (let k = 0; k < n0; k++) {
      const ns = nb[stack2[k]];
      for (let j = 0; j < ns.length; j++) {
        const n = ns[j], v = stones[n];
        if (v === color) { if (seen[n] !== gst) { seen[n] = gst; stack2[n0++] = n; } }
        else if (v === EMPTY && !found && mark[n] !== st) {
          mark[n] = st;
          const ms = nb[n];
          for (let m = 0; m < ms.length; m++) if (mark[ms[m]] === st) { if (!whole) return true; found = true; break; }
        }
      }
    }
    return found;
  }

  // Eye cells of the group containing `start`: the empty cells of every area next to it that is
  // bordered by its own colour only, as analyze() counts them when nothing is see-through.
  function eyeCells(board, stones, start) {
    const nb = board.neighbors, sc = board.scratch, { seen, rseen, stack, stack2 } = sc;
    const st = nextStamp(sc), color = stones[start];
    let n0 = 0, total = 0;
    stack2[n0++] = start; seen[start] = st;
    for (let k = 0; k < n0; k++) {
      const ns = nb[stack2[k]];
      for (let j = 0; j < ns.length; j++) {
        const n = ns[j], v = stones[n];
        if (v === color) { if (seen[n] !== st) { seen[n] = st; stack2[n0++] = n; } continue; }
        if (v !== EMPTY || rseen[n] === st) continue;
        let r0 = 0, colors = 0, onEdge = false;
        stack[r0++] = n; rseen[n] = st;
        for (let a = 0; a < r0; a++) {
          const ms = nb[stack[a]];
          if (ms.length < 6) onEdge = true;
          for (let b = 0; b < ms.length; b++) {
            const m = ms[b], w = stones[m];
            if (w !== EMPTY) colors |= w;
            else if (rseen[m] !== st) { rseen[m] = st; stack[r0++] = m; }
          }
        }
        if (colors === color && (EDGE_EYES || !onEdge)) total += r0;
      }
    }
    return total;
  }

  // The capturing half of place(): `color` has just been put on `idx`, in an empty area that
  // touches both colours, and its group has a liberty pair. Removes the enemy groups next to
  // the new stone that have neither a pair nor two eye cells and returns true. Returns false,
  // changing nothing, if taking them off might leave another enemy group dead, which only
  // play() works out: that can happen when a captured group helped to enclose an eye that a
  // group without a liberty pair lives on.
  function captureNear(board, stones, idx, color) {
    const nb = board.neighbors, sc = board.scratch, { seen, rseen, gdone, stack, dead } = sc;
    const ns = nb[idx], opp = other(color);
    const gst = nextStamp(sc), dst = nextStamp(sc);
    let nd = 0;
    for (let j = 0; j < ns.length; j++) {
      const start = ns[j];
      if (stones[start] !== opp || gdone[start] === gst || gdone[start] === dst) continue;
      // List the group after the dead stones found so far; keep it there only if it is dead.
      let m = nd;
      dead[m++] = start; gdone[start] = gst;
      for (let k = nd; k < m; k++) {
        const ms = nb[dead[k]];
        for (let a = 0; a < ms.length; a++) {
          const n = ms[a];
          if (stones[n] === opp && gdone[n] !== gst) { gdone[n] = gst; dead[m++] = n; }
        }
      }
      if (hasPair(board, stones, start, nextStamp(sc), false) || eyeCells(board, stones, start) >= 2) continue;
      for (let k = nd; k < m; k++) gdone[dead[k]] = dst;
      nd = m;
    }
    if (!nd) return true;
    // An enemy-only area next to a dead group stops being an eye once the group is gone. Every
    // other group on its border must have a liberty pair, or it may die too.
    const rst = nextStamp(sc), pst = nextStamp(sc);
    for (let k = 0; k < nd; k++) {
      const ds = nb[dead[k]];
      for (let a = 0; a < ds.length; a++) {
        const e = ds[a];
        if (stones[e] !== EMPTY || rseen[e] === rst) continue;
        let r0 = 0, ours = false;
        stack[r0++] = e; rseen[e] = rst;
        area: for (let b = 0; b < r0; b++) {
          const ms = nb[stack[b]];
          for (let c = 0; c < ms.length; c++) {
            const n = ms[c], v = stones[n];
            if (v === EMPTY) { if (rseen[n] !== rst) { rseen[n] = rst; stack[r0++] = n; } }
            else if (v === color) { ours = true; break area; }
          }
        }
        if (ours) continue;
        for (let b = 0; b < r0; b++) {
          const ms = nb[stack[b]];
          for (let c = 0; c < ms.length; c++) {
            const n = ms[c];
            if (stones[n] === opp && gdone[n] !== dst && seen[n] !== pst && !hasPair(board, stones, n, pst, true)) return false;
          }
        }
      }
    }
    for (let k = 0; k < nd; k++) stones[dead[k]] = EMPTY;
    return true;
  }

  // Fast version of play() for random games: plays `color` at `idx` by changing `stones` itself.
  // Returns true if the move was legal (captures are removed), false if not (nothing changes).
  // No ko check. `stones` must be a position reached by legal play, so that every group on it
  // is alive; play() makes no such assumption.
  //
  // Most moves capture nothing, and that can be told without analysing the whole board. The
  // only groups a new stone can harm are those that lose a liberty to it and those that live on
  // the eye it is played in. So look at the empty area the stone goes into:
  //   - if the area touches both colours it is nobody's eye, and only the enemy groups next to
  //     the new stone are at risk;
  //   - otherwise it is one side's territory, and every group bordering it is at risk.
  // If all of those groups still have a liberty pair, nothing is captured, and the move is legal
  // exactly when the new stone's own group has a liberty pair or two eye cells. If one of them
  // has no pair, captureNear() handles the common captures and play() decides the rest.
  function place(board, stones, idx, color) {
    if (stones[idx] !== EMPTY) return false;
    const nb = board.neighbors, sc = board.scratch, { seen, stack } = sc;
    const ns = nb[idx], opp = other(color), BOTH = BLACK | WHITE;
    let met = 0, n0 = 0;
    for (let j = 0; j < ns.length; j++) met |= stones[ns[j]];
    if (met !== BOTH) {
      // Search the empty area round idx until stones of both colours have turned up. If they
      // don't, stack[0..n0) ends up holding the whole area.
      const st = nextStamp(sc);
      stack[n0++] = idx; seen[idx] = st;
      scan: for (let k = 0; k < n0; k++) {
        const ms = nb[stack[k]];
        for (let j = 0; j < ms.length; j++) {
          const n = ms[j], v = stones[n];
          if (v === EMPTY) { if (seen[n] !== st) { seen[n] = st; stack[n0++] = n; } }
          else if ((met |= v) === BOTH) break scan;
        }
      }
    }
    stones[idx] = color;
    let safe = true, ownPair;
    if (met === BOTH) {
      ownPair = hasPair(board, stones, idx, nextStamp(sc), false);
      for (let j = 0; safe && j < ns.length; j++) if (stones[ns[j]] === opp) safe = hasPair(board, stones, ns[j], nextStamp(sc), false);
      if (!safe && ownPair && captureNear(board, stones, idx, color)) return true;
    } else {
      // One stamp for all of these searches, so each bordering group is searched once.
      const gst = nextStamp(sc);
      ownPair = hasPair(board, stones, idx, gst, true);
      for (let k = 0; safe && k < n0; k++) {
        const ms = nb[stack[k]];
        for (let j = 0; j < ms.length; j++) {
          const n = ms[j];
          if (stones[n] !== EMPTY && seen[n] !== gst && !hasPair(board, stones, n, gst, true)) { safe = false; break; }
        }
      }
    }
    if (safe) {
      if (ownPair || eyeCells(board, stones, idx) >= 2) return true;
      stones[idx] = EMPTY;
      return false;
    }
    stones[idx] = EMPTY;
    const r = play(board, stones, idx, color);
    if (!r.ok) return false;
    stones.set(r.stones);
    return true;
  }

  // Tables describing one position, for trying many moves on it with placeSurveyed():
  // the group each stone is in, how many liberty pairs each group has, the empty area each
  // empty cell is in, which colours border each area, and whether any group on an area's
  // border has no liberty pair.
  function survey(board, stones) {
    const N = board.size, nb = board.neighbors, sc = board.scratch, q = sc.stack;
    const { gid, pairs, gm, gm2, rid, rcol, rweak } = sc.sv;
    let ng = 0, nr = 0;
    gid.fill(-1); rid.fill(-1);
    for (let i = 0; i < N; i++) {
      const color = stones[i];
      if (color === EMPTY || gid[i] !== -1) continue;
      let n0 = 0;
      q[n0++] = i; gid[i] = ng;
      for (let k = 0; k < n0; k++) {
        const ns = nb[q[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j];
          if (gid[n] === -1 && stones[n] === color) { gid[n] = ng; q[n0++] = n; }
        }
      }
      pairs[ng] = 0; gm[ng] = -1; gm2[ng] = -1;
      ng++;
    }
    // Each pair of touching empty cells (e, f) counts once for every group that touches both.
    for (let e = 0; e < N; e++) {
      if (stones[e] !== EMPTY) continue;
      const es = nb[e];
      for (let j = 0; j < es.length; j++) if (stones[es[j]] !== EMPTY) gm[gid[es[j]]] = e;
      for (let j = 0; j < es.length; j++) {
        const f = es[j];
        if (f < e || stones[f] !== EMPTY) continue;
        const fs = nb[f], key = e * N + f;
        for (let k = 0; k < fs.length; k++) {
          if (stones[fs[k]] === EMPTY) continue;
          const g = gid[fs[k]];
          if (gm[g] === e && gm2[g] !== key) { gm2[g] = key; pairs[g]++; }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (stones[i] !== EMPTY || rid[i] !== -1) continue;
      let n0 = 0, colors = 0, weak = 0;
      q[n0++] = i; rid[i] = nr;
      for (let k = 0; k < n0; k++) {
        const ns = nb[q[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j], v = stones[n];
          if (v === EMPTY) { if (rid[n] === -1) { rid[n] = nr; q[n0++] = n; } }
          else { colors |= v; if (pairs[gid[n]] === 0) weak = 1; }
        }
      }
      rcol[nr] = colors; rweak[nr] = weak;
      nr++;
    }
  }

  // place() for a position that survey() has just been run on and that has not changed since.
  // It answers the same questions as place() from the tables instead of searching the board,
  // which pays off when many moves are tried on one position. Same result as place().
  function placeSurveyed(board, stones, idx, color) {
    if (stones[idx] !== EMPTY) return false;
    const nb = board.neighbors, { gid, pairs, rid, rcol, rweak } = board.scratch.sv;
    const ns = nb[idx], opp = other(color), r = rid[idx];
    // In one side's territory every group on the border is at risk; one without a pair needs place().
    if (rcol[r] !== (BLACK | WHITE) && rweak[r]) return place(board, stones, idx, color);
    let ownNear = false, ownPair = false;
    for (let j = 0; j < ns.length; j++) {
      const n = ns[j], v = stones[n];
      if (v === EMPTY) continue;
      // Does this group keep a liberty pair that does not use idx? It loses one pair for each
      // of its liberties next to idx, and idx has at most five empty neighbours.
      const g = gid[n];
      let left = pairs[g];
      if (left <= 5) {
        for (let a = 0; a < ns.length; a++) {
          const e = ns[a];
          if (stones[e] !== EMPTY) continue;
          const es = nb[e];
          for (let b = 0; b < es.length; b++) if (stones[es[b]] !== EMPTY && gid[es[b]] === g) { left--; break; }
        }
      }
      if (v === opp) { if (left <= 0) return place(board, stones, idx, color); }
      else { ownNear = true; if (left > 0) ownPair = true; }
    }
    // Nothing is captured, so the move is legal exactly when the new stone's group has a pair
    // or two eye cells. Two empty neighbours of idx that touch each other are a pair.
    const np = board.nbPairs[idx];
    for (let a = 0; !ownPair && a < np.length; a += 2) ownPair = stones[np[a]] === EMPTY && stones[np[a + 1]] === EMPTY;
    if (ownPair) { stones[idx] = color; return true; }
    if (ownNear) return place(board, stones, idx, color); // a pair made some other way, or none
    stones[idx] = color;
    if (eyeCells(board, stones, idx) >= 2) return true;
    stones[idx] = EMPTY;
    return false;
  }

  // Final score. HexGo uses territory scoring (as in Japanese-rules Go):
  //   empty cells you surround + stones you captured during the game
  //   + dead enemy stones removed from your area at the end (+ komi for White).
  // A dead stone in your area is therefore worth 2: one as a prisoner, one for the cell.
  // `deadCells` (optional Set) are removed before counting. `opts.prisoners` is
  // { [BLACK]: stones Black captured, [WHITE]: stones White captured } during the game.
  // `opts.rule = 'area'` counts stones on the board instead of prisoners (Chinese-style),
  // which the AI uses internally.
  // Returns { black, white, territory: per-cell owner, detail: { [colour]: { territory,
  // captures, dead, stones } } }.
  function score(board, stones, komi, deadCells, opts) {
    const o = opts || {};
    const area = o.rule === 'area';
    const pris = o.prisoners || { [BLACK]: 0, [WHITE]: 0 };
    const s = Uint8Array.from(stones);
    const detail = { [BLACK]: { territory: 0, captures: pris[BLACK] || 0, dead: 0, stones: 0 },
                     [WHITE]: { territory: 0, captures: pris[WHITE] || 0, dead: 0, stones: 0 } };
    if (deadCells) for (const c of deadCells) {
      if (s[c] === EMPTY) continue;
      detail[other(s[c])].dead++; // a removed dead stone is a prisoner for the other side
      s[c] = EMPTY;
    }
    const territory = new Uint8Array(board.size);
    const seen = new Uint8Array(board.size);
    for (let i = 0; i < board.size; i++) {
      if (s[i] !== EMPTY) { detail[s[i]].stones++; continue; }
      if (seen[i]) continue;
      const region = [i];
      let colors = 0;
      seen[i] = 1;
      for (let k = 0; k < region.length; k++) {
        for (const n of board.neighbors[region[k]]) {
          if (s[n] !== EMPTY) colors |= s[n];
          else if (!seen[n]) { seen[n] = 1; region.push(n); }
        }
      }
      if (colors !== BLACK && colors !== WHITE) continue;
      for (const c of region) territory[c] = colors;
      detail[colors].territory += region.length;
    }
    const total = (c) => detail[c].territory + (area ? detail[c].stones : detail[c].captures + detail[c].dead);
    return { black: total(BLACK), white: total(WHITE) + komi, territory, detail, rule: area ? 'area' : 'territory' };
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

  return { EMPTY, BLACK, WHITE, DIRS, EDGE_EYES, other, createBoard, analyze, play, place, survey, placeSurveyed, score, threatened, keyOf };
}

(function (root) {
  const api = hexGoEngineModule();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.HexGoEngine = api; root.hexGoEngineModule = hexGoEngineModule; }
})(typeof window !== 'undefined' ? window : globalThis);
