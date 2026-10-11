// Plays every Learn-page diagram on the Edge Eyes engine and checks it behaves as the page says:
// the starting position is legal (every group alive), and in a puzzle the moves that capture
// are exactly the listed solution; an eye shape fares as its verdict says. Usage: node check-lessons.js [--verbose]
const E = require('../HexGo-EdgeEyes/engine.js');
const figs = require('./src/lessons.js')(E);
const verbose = process.argv.includes('--verbose');

// Can Black capture the group holding `target` by playing only inside the eye, whatever White
// answers there (White may also pass)?
function blackWins(board, s, eye, target, depth) {
  if (depth === 0) return false;
  for (const i of eye) {
    if (s[i]) continue;
    const r = E.play(board, s, i, E.BLACK);
    if (!r.ok) continue;
    if (!r.stones[target]) return true;
    let all = true;
    for (const j of [null, ...eye]) {
      let t = r.stones;
      if (j !== null) { if (t[j]) continue; const w = E.play(board, t, j, E.WHITE); if (!w.ok) continue; t = w.stones; }
      if (!blackWins(board, t, eye, target, depth - 1)) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

let failed = 0;
for (const [name, f] of Object.entries(figs)) {
  const board = E.createBoard(f.side);
  const at = (c) => {
    const i = board.index.get(c);
    if (i === undefined) throw new Error(`${name}: ${c} is off the board`);
    return i;
  };
  const stones = new Uint8Array(board.size);
  for (const c of f.black) stones[at(c)] = E.BLACK;
  for (const c of f.white) stones[at(c)] = E.WHITE;
  const problems = [];
  for (const g of E.analyze(board, stones).groups) {
    if (!g.alive) problems.push(`${g.color === E.BLACK ? 'black' : 'white'} group at ${board.cells[g.cells[0]]} is already dead`);
  }
  for (const kind of Object.keys(f.marks || {})) for (const c of f.marks[kind]) if (stones[at(c)]) problems.push(`mark on a stone at ${c}`);
  const notes = [];
  if (f.puzzle) {
    const capturing = [];
    for (let i = 0; i < board.size; i++) {
      if (stones[i]) continue;
      const r = E.play(board, stones, i, E.BLACK);
      const cell = board.cells[i].join(',');
      if (!r.ok) notes.push(`${cell}: ${r.reason}`);
      else if (r.captured.length) { capturing.push(cell); notes.push(`${cell}: captures ${r.captured.length}`); }
    }
    const want = [...f.puzzle.solution].sort().join(' '), got = capturing.sort().join(' ');
    if (want !== got) problems.push(`capturing moves are [${got}], page says [${want}]`);
  }
  if (f.verdict) {
    const eye = f.eyes.map(at), target = at(f.white[0]);
    const first = eye.map((i) => E.play(board, stones, i, E.BLACK));
    const captures = first.some((r) => r.ok && r.captured.length), anyLegal = first.some((r) => r.ok);
    const got = f.eyes.length === 1 ? 'pair' : captures ? 'capture' : blackWins(board, stones, eye, target, 6) ? 'dead' : anyLegal ? 'unsettled' : 'safe';
    if (got !== f.verdict) problems.push(`eye is '${got}', page says '${f.verdict}'`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? ': ' + problems.join('; ') : ''}`);
  if (verbose || problems.length) for (const n of notes) console.log('       ' + n);
}
console.log(failed ? `${failed} figure(s) failed` : `all ${Object.keys(figs).length} figures behave as described`);
process.exit(failed ? 1 : 0);
