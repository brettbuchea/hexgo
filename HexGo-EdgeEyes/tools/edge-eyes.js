// Catalogue of minimal living groups whose eyes use the board edge.
//
// Enumerates every way to place eye space totalling 3 cells (one eye of 3, an eye of 2 plus an
// eye of 1, or three single eyes; plus "triangle + 1" and the 2-cell cases for reference)
// next to an edge, with at least one eye touching the edge. Each layout gets the smallest wall
// that encloses it: every cell next to an eye cell, and the wall must be one connected group.
// The layout is then tested by playing it out (the rest of the group is assumed to have no
// outside liberties, so only the eyes keep it alive):
//   alive        - the attacker can't capture it even with unlimited free moves
//   alive if answered - the attacker can kill it with free moves, but not if the defender replies
//   dead         - the attacker kills it even when the defender replies
// Positions along a straight edge and in a corner are both covered; mirror images and shifts
// along the edge are counted once.
// Usage: node tools/edge-eyes.js [out.json]
const fs = require('fs');
const E = require('../engine.js');
const { BLACK: D, WHITE: A, EMPTY } = E;

const SIDE = 9, R = SIDE - 1;
const board = E.createBoard(SIDE);
const at = (q, r) => board.index.get(q + ',' + r);
const isEdge = (i) => board.neighbors[i].length < 6;
const adj = (a, b) => board.adj[a].has(b);

// ---------- Life test (same method as tools/eyeshapes.js) ----------
function classify(eyeCells) {
  const start = new Uint8Array(board.size).fill(D);
  for (const c of eyeCells) start[c] = EMPTY;
  const probe = board.cells.findIndex((_, i) => !eyeCells.includes(i) && !eyeCells.some((e) => adj(e, i)) && start[i] === D);
  const wallAlive = (s) => s[probe] === D;
  if (!E.analyze(board, start).groups.every((g) => g.alive)) return 'dead';
  const seen = new Set();
  function attackerAlone(s) { // attacker moves, defender never answers
    const k = E.keyOf(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const c of eyeCells) {
      const r = E.play(board, s, c, A);
      if (r.ok && (!wallAlive(r.stones) || attackerAlone(r.stones))) return true;
    }
    return false;
  }
  const memo = new Map();
  function game(s, toMove, passed, depth) { // true if the wall dies
    if (depth === 0) return false;
    const k = E.keyOf(s) + toMove + passed + depth;
    if (memo.has(k)) return memo.get(k);
    let res;
    if (toMove === A) {
      res = false;
      for (const c of eyeCells) {
        const r = E.play(board, s, c, A);
        if (r.ok && (!wallAlive(r.stones) || game(r.stones, D, false, depth - 1))) { res = true; break; }
      }
      if (!res && !passed) res = game(s, D, true, depth - 1);
    } else {
      res = passed ? false : game(s, A, true, depth - 1);
      if (res) for (const c of eyeCells) {
        const r = E.play(board, s, c, D);
        if (r.ok && !game(r.stones, A, false, depth - 1)) { res = false; break; }
      }
    }
    memo.set(k, res);
    return res;
  }
  if (!attackerAlone(start)) return 'alive';
  if (!game(start, A, false, 14)) return 'alive if answered';
  return 'dead';
}

// ---------- Layout helpers ----------
function regionsOf(cells) {
  const set = new Set(cells), seen = new Set(), out = [];
  for (const c of cells) {
    if (seen.has(c)) continue;
    const reg = [c]; seen.add(c);
    for (let k = 0; k < reg.length; k++) for (const n of board.neighbors[reg[k]]) if (set.has(n) && !seen.has(n)) { seen.add(n); reg.push(n); }
    out.push(reg);
  }
  return out.sort((a, b) => b.length - a.length);
}
function shape3(reg) {
  const [a, b, c] = reg;
  const links = [adj(a, b), adj(b, c), adj(a, c)].filter(Boolean).length;
  if (links === 3) return 'triangle';
  // A line: the middle cell's two neighbours in the region are opposite each other.
  const mid = [a, b, c].find((x) => [a, b, c].filter((y) => y !== x && adj(x, y)).length === 2);
  const [p, q] = [a, b, c].filter((y) => y !== mid);
  const [mq, mr] = board.cells[mid], [pq, pr] = board.cells[p], [qq, qr] = board.cells[q];
  return pq + qq === 2 * mq && pr + qr === 2 * mr ? 'straight' : 'bent';
}
function wallOf(eyes) {
  const set = new Set(eyes), wall = new Set();
  for (const c of eyes) for (const n of board.neighbors[c]) if (!set.has(n)) wall.add(n);
  return [...wall];
}
function connected(cells) {
  const set = new Set(cells), seen = new Set([cells[0]]), stack = [cells[0]];
  while (stack.length) { const c = stack.pop(); for (const n of board.neighbors[c]) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
  return seen.size === set.size;
}
// Which board edges a set of cells touches (bottom r=R, left q=-R, right s=-R i.e. q+r=R).
function edgesTouched(cells) {
  const e = new Set();
  for (const c of cells) {
    const [q, r] = board.cells[c];
    if (r === R) e.add('bottom');
    if (q === -R) e.add('left');
    if (q + r === R) e.add('right');
    if (r === -R || q === R || q + r === -R) e.add('far');
  }
  return e;
}
// Canonical key: eyes as (q, r) after symmetry. Straight edge: shift along the bottom edge and
// mirror (q -> -q-r). Corner (bottom-left): mirror across the corner bisector (q, r) -> (-r, -q).
function key(eyes, kind) {
  const pts = eyes.map((c) => board.cells[c]);
  const variants = kind === 'edge'
    ? [pts, pts.map(([q, r]) => [-q - r, r])].map((v) => { const m = Math.min(...v.map((p) => p[0])); return v.map(([q, r]) => [q - m, r]); })
    : [pts, pts.map(([q, r]) => [-r, -q])];
  return variants.map((v) => JSON.stringify(v.sort((a, b) => a[0] - b[0] || a[1] - b[1]))).sort()[0];
}

// ---------- Enumeration ----------
function* subsets(arr, k, startAt = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = startAt; i < arr.length; i++) { acc.push(arr[i]); yield* subsets(arr, k, i + 1, acc); acc.pop(); }
}
const windows = {
  // Three rows next to the bottom edge, away from the corners.
  edge: board.cells.map((_, i) => i).filter((i) => { const [q, r] = board.cells[i]; return r >= R - 2 && q >= -6 && q <= -1; }),
  // Cells within 4 steps of the bottom-left corner.
  corner: board.cells.map((_, i) => i).filter((i) => { const [q, r] = board.cells[i]; const dq = q + R, dr = r - R; return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= 4; }),
};
const found = new Map();
for (const kind of ['edge', 'corner']) {
  for (const size of [2, 3, 4]) {
    for (const eyes of subsets(windows[kind], size)) {
      const regs = regionsOf(eyes);
      const sizes = regs.map((r) => r.length);
      const tri = regs.some((r) => r.length === 3 && shape3(r) === 'triangle');
      if (sizes.some((n) => n > 3)) continue;
      if (size === 4 && !(tri && sizes.length === 2)) continue; // only triangle + 1 at size 4
      if (!regs.some((r) => r.some(isEdge))) continue; // at least one eye touches the edge
      const wall = wallOf(eyes);
      if (!connected(wall)) continue;
      const touched = edgesTouched([...eyes, ...wall]);
      if (touched.has('far') || touched.has('right')) continue;
      if (kind === 'edge' && touched.has('left')) continue;
      if (kind === 'corner' && !(touched.has('left') && touched.has('bottom'))) continue;
      const k = kind + key(eyes, kind);
      if (found.has(k)) continue;
      found.set(k, { kind, eyes, wall, regs });
    }
  }
}

// ---------- Classify and describe ----------
const results = [];
for (const { kind, eyes, wall, regs } of found.values()) {
  const status = classify(eyes);
  const parts = regs.map((r) => {
    const onEdge = r.filter(isEdge).length;
    const shape = r.length === 3 ? shape3(r) + ' 3' : r.length === 2 ? '2' : '1';
    return { size: r.length, shape, onEdge };
  });
  const type = parts.map((p) => p.size).join('+');
  const family = type === '3' ? `one eye: ${parts[0].shape}` : type === '3+1' ? 'triangle 3 + 1' : type === '2+1' ? 'eyes 2 + 1'
    : type === '1+1+1' ? 'eyes 1 + 1 + 1' : type === '2' ? 'one eye: 2 (reference)' : 'eyes 1 + 1 (reference)';
  const edgeNote = parts.map((p) => `${p.shape === '1' ? 'single' : p.shape} ${p.onEdge ? `(${p.onEdge}/${p.size} on edge)` : '(inside)'}`).join(', ');
  results.push({ kind, family, type, status, stones: wall.length, eyes: eyes.map((c) => board.cells[c]), wall: wall.map((c) => board.cells[c]), edgeNote,
    allEyesOnEdge: parts.every((p) => p.onEdge > 0) });
}
const famOrder = ['one eye: straight 3', 'one eye: bent 3', 'one eye: triangle 3', 'eyes 2 + 1', 'eyes 1 + 1 + 1', 'triangle 3 + 1', 'one eye: 2 (reference)', 'eyes 1 + 1 (reference)'];
results.sort((a, b) => famOrder.indexOf(a.family) - famOrder.indexOf(b.family) || (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : 0) || a.stones - b.stones);
const out = process.argv[2] || 'edge-eyes.json';
fs.writeFileSync(out, JSON.stringify({ side: SIDE, results }, null, 1));
const tally = {};
for (const r of results) { const k = `${r.family} | ${r.kind} | ${r.status}`; tally[k] = (tally[k] || 0) + 1; }
console.log(results.length + ' layouts');
for (const [k, v] of Object.entries(tally)) console.log(String(v).padStart(4), k);
