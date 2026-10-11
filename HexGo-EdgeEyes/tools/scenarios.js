// Sanity checks for the capture rules described in the design doc.
const E = require('../engine.js');
const { BLACK: B, WHITE: W, EMPTY } = E;
const board = E.createBoard(7);
const at = (q, r) => board.index.get(q + ',' + r);
const D = E.DIRS;
let fails = 0;
function check(name, cond) { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fails++; }
function place(stones, list) { for (const [q, r, c] of list) stones[at(q, r)] = c; return stones; }
const fresh = () => new Uint8Array(board.size);

// 1. Lone stone, opponent on every other neighbour -> captured on the third stone.
{
  const s = place(fresh(), [[0, 0, W], [...D[0], B], [...D[2], B]]);
  const r = E.play(board, s, at(...D[4]), B);
  check('alternating ring captures lone stone', r.ok && r.captured.includes(at(0, 0)));
}
// 2. Four contiguous enemies leave a liberty pair -> safe.
{
  const s = place(fresh(), [[0, 0, W], [...D[0], B], [...D[1], B], [...D[2], B]]);
  const r = E.play(board, s, at(...D[3]), B);
  check('two adjacent liberties keep a lone stone alive', r.ok && r.captured.length === 0);
}
// 3. Five enemies -> one liberty -> captured.
{
  const s = place(fresh(), [[0, 0, W], ...[0, 1, 2, 3].map((k) => [...D[k], B])]);
  const r = E.play(board, s, at(...D[4]), B);
  check('single liberty is captured', r.ok && r.captured.includes(at(0, 0)));
}
// 4. No edge wrap-around: a liberty pair is two cells that really touch, also on the edge.
{
  // Edge cell (6,-3): its neighbours in order are (6,-4) (5,-3) (5,-2) (6,-2).
  const s = place(fresh(), [[6, -3, W], [5, -3, B]]);
  const r = E.play(board, s, at(5, -2), B);
  check('edge stone dies when only its two neighbours along the edge are empty', r.ok && r.captured.includes(at(6, -3)));
  const s2 = place(fresh(), [[6, -3, W], [6, -4, B]]);
  const r2 = E.play(board, s2, at(5, -2), B);
  check('edge stone dies when every other neighbour is blocked', r2.ok && r2.captured.includes(at(6, -3)));
  const r3 = E.play(board, s2, at(5, -3), B);
  check('edge stone with two touching liberties is alive', r3.ok && r3.captured.length === 0);
}
{
  // Corner cell (6,-6): neighbours (5,-6) (5,-5) (6,-5); the middle one touches both others.
  const s = place(fresh(), [[6, -6, W]]);
  const r1 = E.play(board, s, at(5, -5), B);
  check('corner stone dies to one blocker on its middle neighbour', r1.ok && r1.captured.includes(at(6, -6)));
  const r2 = E.play(board, s, at(6, -5), B);
  check('corner stone survives one blocker along the edge', r2.ok && r2.captured.length === 0);
}

// Eye tests: Black fills the board except the listed cells; White attacks.
const walled = (cells) => { const s = new Uint8Array(board.size).fill(B); for (const c of cells) s[at(...c)] = EMPTY; return s; };
const wallDead = (r) => r.ok && r.captured.length > 100;
{
  // Two separate one-cell eyes = atari: filling either one captures the wall.
  const s = walled([[0, 0], [3, 0]]);
  check('two single eyes: fill one, wall captured', wallDead(E.play(board, s, at(0, 0), W)));
}
{
  // Three separate one-cell eyes: every fill is illegal suicide.
  const s = walled([[0, 0], [3, 0], [-3, 0]]);
  check('three single eyes: invasion is suicide', ['0,0', '3,0', '-3,0'].every((k) => E.play(board, s, board.index.get(k), W).reason === 'suicide'));
}
{
  // Two-cell eye + one-cell eye = 3 eye liberties: alive.
  const s = walled([[0, 0], [1, 0], [-3, 0]]);
  check('two-cell + one-cell eye lives', [[0, 0], [1, 0], [-3, 0]].every((c) => E.play(board, s, at(...c), W).reason === 'suicide'));
}
{
  // Straight three: both points are suicide for the invader.
  const s = walled([[0, -1], [0, 0], [0, 1]]);
  check('straight three: invasion is suicide', [[0, -1], [0, 0], [0, 1]].every((c) => E.play(board, s, at(...c), W).reason === 'suicide'));
}
{
  // Triangle: invader lives on a liberty pair, second stone captures the wall.
  const s = walled([[0, 0], [1, 0], [0, 1]]);
  const r1 = E.play(board, s, at(0, 0), W);
  check('triangle: first invader stone is legal', r1.ok && r1.captured.length === 0);
  check('triangle: second invader stone captures wall', wallDead(E.play(board, r1.stones, at(1, 0), W)));
  // Defender answer: capture the invader, leaving a two-cell eye, which the attacker then kills.
  const r2 = E.play(board, r1.stones, at(1, 0), B);
  check('triangle: defender can remove invader', r2.ok && r2.captured.includes(at(0, 0)));
  check('triangle: leftover two-cell eye dies', wallDead(E.play(board, r2.stones, at(0, 0), W)));
}
{
  // Superko: an immediate recapture that repeats the position is refused.
  const s = walled([[0, 0], [3, 0]]);
  const after = Uint8Array.from(s).fill(EMPTY);
  after[at(0, 0)] = W; // the position White's capture would produce
  check('superko blocks a repeated position', E.play(board, s, at(0, 0), W, new Set([E.keyOf(after)])).reason === 'ko');
}

// Eye combinations that total three eye cells (and a few neighbours of them).
// `alive` means every invasion point is illegal suicide or, if legal, does not lead to capture
// in two invader moves with no answer.
function invasionKills(cells) {
  const s = walled(cells);
  for (const a of cells) {
    const r1 = E.play(board, s, at(...a), W);
    if (!r1.ok) continue;
    if (wallDead(r1)) return true;
    for (const b of cells) {
      const r2 = E.play(board, r1.stones, at(...b), W);
      if (r2.ok && wallDead(r2)) return true;
    }
  }
  return false;
}
check('eyes 1+1+1 (three single eyes) are alive', !invasionKills([[0, 0], [3, 0], [-3, 0]]));
check('eyes 2+1 are alive', !invasionKills([[0, 0], [1, 0], [-3, 0]]));
check('one straight 3 eye is alive', !invasionKills([[0, -1], [0, 0], [0, 1]]));
check('one bent 3 eye is alive', !invasionKills([[0, 0], [0, 1], [1, 1]]));
check('one triangle 3 eye is NOT alive', invasionKills([[0, 0], [1, 0], [0, 1]]));
check('eyes 1+1 are NOT alive (atari)', invasionKills([[0, 0], [3, 0]]));
check('one 2-cell eye is NOT alive', invasionKills([[0, 0], [1, 0]]));
check('triangle eye + single eye is alive', !invasionKills([[0, 0], [1, 0], [0, 1], [-3, 0]]));
check('eyes 2+2 are alive', !invasionKills([[0, 0], [1, 0], [-3, 0], [-3, 1]]));

// Regression (Hard game 5, 4 per side): White's wall shares its only liberty pair with four
// Black stones inside it. Filling that pair leaves White's wall briefly without a pair too,
// but the capture comes first, so White must capture the four stones. The wall must not be
// treated as a see-through "doomed invader".
{
  const b4 = E.createBoard(4);
  const s = Uint8Array.from('2101221002121111102110102100221110210', Number);
  const name = (i) => { const [q, r] = b4.cells[i]; return String.fromCharCode(65 + r + 3) + (q - Math.max(-3, -3 - r) + 1); };
  const idx = (n) => [...Array(b4.size).keys()].find((i) => name(i) === n);
  for (const n of ['D3', 'E2']) {
    const r = E.play(b4, s, idx(n), W);
    check(`wall fills shared pair at ${n} and captures the 4 stones inside`, r.ok && r.captured.length === 4);
  }
}

// Edge rule for eyes: areas closed off by stones plus the board edge count as eyes.
// User's position (5 per side): Black's edge eyes are F8 (1 cell) and H6+I5 (2 cells), so
// Black is alive with 2 + 1 and White's H6 is suicide. (With EDGE_EYES off, H6 captures 7.)
{
  const b5 = E.createBoard(5);
  const name = (i) => { const [q, r] = b5.cells[i]; return String.fromCharCode(65 + r + 4) + (q - Math.max(-4, -4 - r) + 1); };
  const idx = (n) => [...Array(b5.size).keys()].find((i) => name(i) === n);
  const s = new Uint8Array(b5.size);
  for (const n of ['D7', 'D8', 'E7', 'F6', 'G5', 'H4', 'I3']) s[idx(n)] = W;
  for (const n of ['E8', 'E9', 'F7', 'G4', 'G6', 'G7', 'H5', 'I4']) s[idx(n)] = B;
  const r = E.play(b5, s, idx('H6'), W);
  if (E.EDGE_EYES) check('edge eyes 2+1: White H6 is suicide', r.reason === 'suicide');
  else check('edge areas are not eyes: White H6 captures the 7-stone group', r.ok && r.captured.length === 7);
}

// Edge Eyes rule set: an eye lying flat along the edge works like an internal eye. An invader's
// two liberties along the edge do not touch, so it has no liberty pair.
{
  const b9 = E.createBoard(9);
  const at9 = (q, r) => b9.index.get(q + ',' + r);
  const flat = [[-4, 8], [-3, 8], [-2, 8]].map((p) => at9(...p)); // straight 3 along the bottom edge
  const s = new Uint8Array(b9.size).fill(B);
  for (const c of flat) s[c] = EMPTY;
  check('flat straight 3 on the edge: White in the middle is suicide', E.play(b9, s, flat[1], W).reason === 'suicide');
  check('flat straight 3 on the edge: White at an end is suicide', E.play(b9, s, flat[0], W).reason === 'suicide');
}
console.log(fails ? fails + ' failure(s)' : 'all scenarios pass');
process.exit(fails ? 1 : 0);
