// Classifies small enclosed eye shapes under HexGo rules.
// The defender (Black) fills the whole board except the eye; the attacker (White) plays inside it.
const E = require('../engine.js');
const { BLACK: D, WHITE: A } = E;
const board = E.createBoard(8);
const key = (q, r) => q + ',' + r;

// 12 symmetries of the hex grid in axial coords.
const rot = ([q, r]) => [-r, q + r];
const refl = ([q, r]) => [r, q];
function canon(shape) {
  let best = null;
  let cur = shape;
  for (let m = 0; m < 2; m++) {
    for (let k = 0; k < 6; k++) {
      cur = cur.map(rot);
      const mq = Math.min(...cur.map((c) => c[0])), mr = Math.min(...cur.map((c) => c[1]));
      const s = cur.map(([q, r]) => [q - mq, r - mr]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const str = JSON.stringify(s);
      if (best === null || str < best) best = str;
    }
    cur = cur.map(refl);
  }
  return best;
}
function polyhexes(n) {
  let level = new Map([[canon([[0, 0]]), [[0, 0]]]]);
  for (let s = 2; s <= n; s++) {
    const next = new Map();
    for (const shape of level.values()) {
      const have = new Set(shape.map((c) => key(...c)));
      for (const [q, r] of shape) for (const [dq, dr] of E.DIRS) {
        const c = [q + dq, r + dr];
        if (have.has(key(...c))) continue;
        const ns = [...shape, c];
        const k = canon(ns);
        if (!next.has(k)) next.set(k, JSON.parse(k));
      }
    }
    level = next;
  }
  return [...level.values()];
}

function solve(shape) {
  const cells = shape.map(([q, r]) => board.index.get(key(q - 1, r - 1)));
  const start = new Uint8Array(board.size).fill(D);
  for (const c of cells) start[c] = E.EMPTY;
  // Shapes with holes leave stray defender stones; the wall is the stone at a board corner.
  const wallCell = board.index.get(key(7, -7));
  const wallAlive = (s) => s[wallCell] === D;
  const startAlive = E.analyze(board, start).groups.every((g) => g.alive);
  if (!startAlive) return { name: 'dead already' };

  // Attacker plays repeatedly, defender never answers.
  const seen = new Set();
  function attackerAlone(s) {
    const k = E.keyOf(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const c of cells) {
      const r = E.play(board, s, c, A);
      if (!r.ok) continue;
      if (!wallAlive(r.stones) || attackerAlone(r.stones)) return true;
    }
    return false;
  }
  // Alternating play; returns true if the wall dies. Passes allowed; two passes end it.
  const memo = new Map();
  function game(s, toMove, passed, depth) {
    if (depth === 0) return false;
    const k = E.keyOf(s) + toMove + passed + depth;
    if (memo.has(k)) return memo.get(k);
    let res;
    if (toMove === A) {
      res = false;
      for (const c of cells) {
        const r = E.play(board, s, c, A);
        if (r.ok && (!wallAlive(r.stones) || game(r.stones, D, false, depth - 1))) { res = true; break; }
      }
      if (!res && !passed) res = game(s, D, true, depth - 1);
    } else {
      res = passed ? false : game(s, A, true, depth - 1);
      if (res) for (const c of cells) {
        const r = E.play(board, s, c, D);
        if (r.ok && !game(r.stones, A, false, depth - 1)) { res = false; break; }
      }
    }
    memo.set(k, res);
    return res;
  }
  const uncond = !attackerAlone(start);
  const attackFirst = game(start, A, false, 14);
  const defendFirst = game(start, D, false, 14);
  const name = uncond ? 'alive, no answer needed'
    : !attackFirst ? 'alive if defender answers'
    : !defendFirst ? 'unsettled (whoever moves first)'
    : 'dead';
  return { name };
}

function picture(shape) {
  const set = new Set(shape.map((c) => key(...c)));
  const rs = shape.map((c) => c[1]), qs = shape.map((c) => c[0]);
  const lines = [];
  for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
    let line = ' '.repeat(r - Math.min(...rs));
    for (let q = Math.min(...qs); q <= Math.max(...qs); q++) line += set.has(key(q, r)) ? 'O ' : '. ';
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

const max = +(process.argv[2] || 5);
for (let n = 1; n <= max; n++) {
  const shapes = polyhexes(n);
  const tally = {};
  for (const sh of shapes) {
    const { name } = solve(sh);
    tally[name] = (tally[name] || 0) + 1;
    if (process.argv.includes('-v')) console.log(`size ${n}: ${name}\n${picture(sh)}\n`);
  }
  console.log(`size ${n}: ${shapes.length} shapes`, tally);
}
