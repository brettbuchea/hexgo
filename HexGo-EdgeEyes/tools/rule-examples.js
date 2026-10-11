// Worked examples of the Edge Eyes rules, for review, and a test that the engine plays them as
// written. Each example is a small position, one or more moves, and the outcome the rules call
// for (written by hand, not taken from the engine). The tool plays every move on the main engine
// and on tools/engine-reference.js, runs a life search on the eye examples, and writes a page
// with a board diagram for each example and a tick or a cross against every expected outcome.
// Usage: node tools/rule-examples.js [out folder]     (default results/rule-examples)
const fs = require('fs');
const path = require('path');
const MAIN = require('../engine.js');
const REF = require('./engine-reference.js');
const { BLACK: B, WHITE: W, EMPTY, DIRS } = MAIN;

const outDir = process.argv[2] || path.join(__dirname, '..', 'results', 'rule-examples');

// ---------- Boards and cell names ----------
const boards = {};
const boardOf = (side) => boards[side] || (boards[side] = { main: MAIN.createBoard(side), ref: REF.createBoard(side) });
const nameOf = (side, i) => {
  const R = side - 1, [q, r] = boardOf(side).main.cells[i];
  return String.fromCharCode(65 + r + R) + (q - Math.max(-R, -R - r) + 1);
};
const byName = (side, n) => {
  const b = boardOf(side).main;
  for (let i = 0; i < b.size; i++) if (nameOf(side, i) === n) return i;
  throw new Error('no cell ' + n);
};

// ---------- Position builders (5 per side unless stated) ----------
const SIDE = 5;
const at = (q, r) => {
  const i = boardOf(SIDE).main.index.get(q + ',' + r);
  if (i === undefined) throw new Error(`off board: ${q},${r}`);
  return i;
};
const nb = (i) => boardOf(SIDE).main.neighbors[i];
const D = (k) => at(...DIRS[k]); // the six cells round the centre, in ring order

function position(black, white) {
  const stones = new Uint8Array(boardOf(SIDE).main.size);
  for (const i of black) stones[i] = B;
  for (const i of white) stones[i] = W;
  return { side: SIDE, stones, black, white };
}
// A Black group whose only liberties are its eyes: Black on every cell next to an eye cell,
// White on every cell next to that wall. `gaps` are outside cells left empty.
function enclose(eyes, gaps = []) {
  const eye = new Set(eyes), black = new Set(), white = new Set();
  for (const e of eyes) for (const n of nb(e)) if (!eye.has(n)) black.add(n);
  for (const b of black) for (const n of nb(b)) if (!eye.has(n) && !black.has(n) && !gaps.includes(n)) white.add(n);
  return Object.assign(position([...black], [...white]), { eyes });
}
function named(side, blackNames, whiteNames) {
  const stones = new Uint8Array(boardOf(side).main.size);
  for (const n of blackNames) stones[byName(side, n)] = B;
  for (const n of whiteNames) stones[byName(side, n)] = W;
  return { side, stones };
}

const ok = (cap) => ({ r: 'ok', cap });
const SUICIDE = { r: 'suicide' }, KO = { r: 'ko' };
const mv = (c, cell, exp, why) => ({ c, at: cell, exp, why });
const allSuicide = (cells, why) => cells.map((c) => mv(W, c, SUICIDE, why));

// ---------- The examples ----------
const sections = [];
let cur;
const section = (title, intro) => { cur = { title, intro, examples: [] }; sections.push(cur); };
const example = (ex) => { ex.id = `${sections.length}.${cur.examples.length + 1}`; cur.examples.push(ex); };

section('Liberty pairs', 'A group stays on the board while it has a liberty pair: two empty cells that touch each other and both touch the group. Counting liberties is not enough; two liberties that do not touch each other do not save a group.');
example({
  title: 'A lone stone, opponent on every other side',
  rule: 'Three liberties, none of them touching another, is not a liberty pair.',
  ...position([at(0, 0)], [D(0), D(2)]),
  tries: [mv(W, D(4), ok(1), 'Black is left with three liberties that are all apart from each other.')],
});
example({
  title: 'Two liberties: touching or not',
  rule: 'With two liberties left, the stone lives only if the two liberties touch.',
  ...position([at(0, 0)], [D(0), D(1), D(3)]),
  tries: [
    mv(W, D(2), ok(0), 'The two liberties left are next to each other: a liberty pair.'),
    mv(W, D(4), ok(1), 'The two liberties left are on opposite sides and do not touch.'),
  ],
});
example({
  title: 'The same rule for a group of two',
  rule: 'A group is judged as a whole: any two touching empty cells next to any of its stones will do.',
  ...position([at(0, 0), at(1, 0)], [at(0, -1), at(2, -1), at(1, 1)]),
  tries: [
    mv(W, at(-1, 0), ok(0), 'Two touching liberties remain below the left stone.'),
    mv(W, at(-1, 1), ok(2), 'Four liberties remain, but no two of them touch.'),
  ],
});
example({
  title: 'Suicide is not allowed',
  rule: 'A move that leaves your own group without a liberty pair or two eye cells, and captures nothing, is illegal.',
  ...position([D(0), D(2), D(4)], []),
  tries: [mv(W, at(0, 0), SUICIDE, 'White would have three liberties, none touching.')],
});
{
  const p = position([at(1, 0), at(0, -1), at(-1, 1)], [at(2, -1), at(1, 1)]);
  example({
    title: 'Captures are settled before suicide',
    rule: 'The opponent’s groups are judged first. A move that would be suicide is legal if it captures and the capture gives the mover a liberty pair.',
    ...p,
    tries: [mv(W, at(0, 0), ok(1), 'The Black stone on the right is left with three liberties that do not touch, so it goes. The cell it leaves gives White a liberty pair.')],
  });
  example({
    title: 'No taking straight back (ko)',
    rule: 'A move may not recreate an earlier position of the whole board.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(1), 'As in the previous example.'),
      mv(B, at(1, 0), KO, 'Retaking would capture the White stone and put the board back exactly as it was.'),
    ],
  });
}

section('Stones on the edge', 'There is no wrap-around at the edge. A liberty pair is always two empty cells that really touch, so an edge stone (four neighbours) and a corner stone (three) are easier to capture than a stone in the middle.');
example({
  title: 'Edge stone: captured by two stones',
  rule: 'An edge stone’s four neighbours run in a line from edge to edge. It lives only while two of them that sit side by side are empty.',
  ...position([at(4, -2)], [at(3, -2)]),
  tries: [
    mv(W, at(3, -1), ok(1), 'The two liberties left are the neighbours along the edge, on either side of the stone. They do not touch.'),
    mv(W, at(4, -1), ok(1), 'The two liberties left do not touch.'),
    mv(W, at(4, -3), ok(0), 'The two liberties left are side by side: a liberty pair.'),
  ],
});
example({
  title: 'Corner stone: captured by one stone',
  rule: 'A corner stone has three neighbours. The middle one touches both of the others, so taking it leaves two liberties that do not touch.',
  ...position([at(4, -4)], []),
  tries: [
    mv(W, at(3, -3), ok(1), 'The two liberties left lie along the two edges and do not touch.'),
    mv(W, at(4, -3), ok(0), 'The two liberties left are side by side: a liberty pair.'),
  ],
});

section('Eyes away from the edge', 'An eye is a connected area of empty cells bordered only by one colour. A group with no liberty pair stays on the board if it borders at least two eye cells in total. An invading stone that cannot live itself does not break the eye. In these examples Black has no liberties outside, so only the eyes matter.');
example({
  title: 'One one-cell eye is not enough',
  rule: 'One eye cell does not save a group. It needs a liberty pair or two eye cells.',
  ...enclose([at(0, 0)], [at(2, -1), at(2, 0)]),
  tries: [
    mv(W, at(2, 0), ok(6), 'Black is left with one eye cell and one outside liberty. They do not touch, and one eye cell is not two.'),
    mv(W, at(0, 0), SUICIDE, 'Black still has its liberty pair outside, so nothing is captured and the White stone has no liberties.'),
  ],
});
{
  const p = enclose([at(-1, 0), at(1, 0)]);
  example({
    title: 'Two one-cell eyes: unsafe',
    rule: 'Two separate single eyes are exactly two eye cells. Filling either leaves one, and the group is captured.',
    ...p,
    tries: p.eyes.map((c) => mv(W, c, ok(p.black.length), 'One eye cell is left.')),
    life: { expect: 'dead' },
  });
}
{
  const p = enclose([at(-2, 0), at(0, 0), at(2, 0)]);
  example({
    title: 'Three one-cell eyes: safe',
    rule: 'Fill one of three single eyes and two eye cells remain, so nothing is captured and the move is suicide.',
    ...p, tries: allSuicide(p.eyes, 'Two eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(0, 0), at(1, 0)]);
  example({
    title: 'One two-cell eye: unsafe',
    rule: 'An invader that cannot live does not break the eye, but the cell it stands on no longer counts. One eye cell is left.',
    ...p,
    tries: p.eyes.map((c) => mv(W, c, ok(p.black.length), 'One empty eye cell is left.')),
    life: { expect: 'dead' },
  });
}
{
  const p = enclose([at(-2, 0), at(0, 0), at(1, 0)]);
  example({
    title: 'A two-cell eye and a one-cell eye: safe',
    rule: 'Three eye cells in total: whichever one White takes, two remain.',
    ...p, tries: allSuicide(p.eyes, 'Two eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(-1, 0), at(0, 0), at(1, 0)]);
  example({
    title: 'Straight three: safe',
    rule: 'A stone inside has at most two liberties and they do not touch, so it cannot live, and two eye cells remain.',
    ...p, tries: allSuicide(p.eyes, 'Two eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(0, 0), at(0, 1), at(1, 1)]);
  example({
    title: 'Bent three: safe',
    rule: 'Same as the straight three: the two end cells do not touch each other.',
    ...p, tries: allSuicide(p.eyes, 'Two eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(0, 0), at(1, 0), at(0, 1)]);
  example({
    title: 'Triangle of three: unsafe (White plays twice)',
    rule: 'In a triangle the two cells left after an invasion touch each other, so the invader has a liberty pair and lives. A living invader breaks the eye.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(0), 'White has a liberty pair. So does Black, sharing the same two cells.'),
      mv(W, at(1, 0), ok(p.black.length), 'White’s two stones cannot live, so they do not count against the eye, but only one empty eye cell is left.'),
    ],
    lineNote: 'Black passes in between.',
    life: { expect: 'dead' },
  });
  example({
    title: 'Triangle of three: unsafe (Black answers)',
    rule: 'Capturing the invader does not help: it leaves a two-cell eye.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(0), 'White has a liberty pair.'),
      mv(B, at(1, 0), ok(1), 'The White stone has one liberty left and is captured.'),
      mv(W, at(0, 0), ok(p.black.length + 1), 'A two-cell eye: one empty eye cell is left.'),
    ],
  });
}
{
  const p = enclose([at(-2, 0), at(0, 0), at(1, 0), at(0, 1)]);
  example({
    title: 'Triangle and a one-cell eye: safe',
    rule: 'White can put one stone in the triangle but can never fill it: the last empty triangle cell and the single eye are two eye cells.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(0), 'White has a liberty pair. Black shares it.'),
      mv(W, at(1, 0), SUICIDE, 'White’s two stones cannot live; one triangle cell plus the single eye is two eye cells.'),
      mv(W, at(-2, 0), SUICIDE, 'Black still has the liberty pair in the triangle.'),
    ],
    lineNote: 'Black passes throughout.',
    life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(-2, 0), at(-2, 1), at(1, 0), at(1, -1)]);
  example({
    title: 'Two two-cell eyes: safe',
    rule: 'Four eye cells: an invader takes one and three remain.',
    ...p, tries: allSuicide(p.eyes, 'Three eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(-2, 0), at(-1, 0), at(0, 0), at(1, 0)]);
  example({
    title: 'Straight four: safe',
    rule: 'No stone inside a straight line can get a liberty pair.',
    ...p, tries: allSuicide(p.eyes, 'Three eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(0, 0), at(1, 0), at(1, -1), at(0, 1)]);
  example({
    title: 'Diamond of four: unsafe if Black ignores it',
    rule: 'In a diamond an invader in the middle has a liberty pair. Three White moves in a row capture.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(0), 'White has a liberty pair.'),
      mv(W, at(1, -1), ok(0), 'White’s two stones still have a liberty pair (the last two cells touch).'),
      mv(W, at(1, 0), ok(p.black.length), 'One empty eye cell is left.'),
    ],
    lineNote: 'Black passes in between.',
    life: { expect: 'defend' },
  });
  example({
    title: 'Diamond of four: safe if Black answers',
    rule: 'Black takes the other middle cell, capturing the invader and leaving a bent three.',
    ...p,
    line: [
      mv(W, at(0, 0), ok(0), 'White has a liberty pair.'),
      mv(B, at(1, 0), ok(1), 'The White stone’s two liberties no longer touch.'),
      mv(W, at(0, 0), SUICIDE, 'The eye is now a bent three.'),
    ],
  });
}

section('Eyes on the edge', 'An area closed off by your stones and the board edge is an eye, exactly like one ringed by stones. The same shapes are safe and unsafe as away from the edge.');
{
  const p = enclose([at(-3, 4), at(-1, 4)]);
  example({
    title: 'Two one-cell eyes on the edge: unsafe',
    rule: 'Edge cells closed off by Black are eyes, so this group stands with two eye cells. As away from the edge, two single eyes are one move from capture.',
    ...p,
    tries: p.eyes.map((c) => mv(W, c, ok(p.black.length), 'One eye cell is left.')),
    life: { expect: 'dead' },
  });
}
{
  const p = enclose([at(-4, 4), at(-2, 4), at(0, 4)]);
  example({
    title: 'Three one-cell eyes on the edge, two in corners: safe',
    rule: 'Corner cells and edge cells are eyes like any other.',
    ...p, tries: allSuicide(p.eyes, 'Two eye cells remain.'), life: { expect: 'safe' },
  });
}
{
  const p = named(5, ['E8', 'E9', 'F7', 'G4', 'G6', 'G7', 'H5', 'I4'], ['D7', 'D8', 'E7', 'F6', 'G5', 'H4', 'I3']);
  const eyes = ['F8', 'H6', 'I5'].map((n) => byName(5, n));
  example({
    title: 'A two-cell and a one-cell eye on the edge: safe',
    rule: 'The position that prompted this rule set. Black’s eyes are F8 (one cell) and H6 + I5 (two cells), all closed off by Black stones and the edge.',
    ...p, eyes, tries: allSuicide([eyes[1], eyes[2], eyes[0]], 'Two eye cells remain.'),
    life: { expect: 'safe', target: byName(5, 'G6') },
  });
}
{
  const p = enclose([at(-3, 4), at(-2, 4), at(-1, 4)]);
  example({
    title: 'Straight three flat along the edge: safe',
    rule: 'A stone in the middle cell has a liberty on each side along the edge, but they do not touch each other, so it cannot live.',
    ...p,
    tries: [
      mv(W, at(-2, 4), SUICIDE, 'Two liberties that do not touch; two eye cells remain.'),
      mv(W, at(-3, 4), SUICIDE, 'One liberty; two eye cells remain.'),
      mv(W, at(-1, 4), SUICIDE, 'One liberty; two eye cells remain.'),
    ],
    life: { expect: 'safe' },
  });
}
example({
  title: 'The same stone out in the open',
  rule: 'The same edge cell with the same two Black stones above it, but no eye round it. The answer is the same, because the edge never gives a liberty pair.',
  ...position([at(-2, 3), at(-1, 3)], []),
  tries: [mv(W, at(-2, 4), SUICIDE, 'Two liberties along the edge that do not touch, and nothing is captured.')],
});
{
  const p = enclose([at(-3, 4), at(-2, 4)]);
  example({
    title: 'Two-cell eye flat along the edge: unsafe',
    rule: 'Same as a two-cell eye away from the edge.',
    ...p,
    tries: p.eyes.map((c) => mv(W, c, ok(p.black.length), 'One empty eye cell is left.')),
    life: { expect: 'dead' },
  });
}
{
  const p = enclose([at(-1, 4), at(0, 4), at(1, 3)]);
  example({
    title: 'Three cells round a corner: safe',
    rule: 'The corner cell’s two neighbours along the edges do not touch each other, so this is a bent three.',
    ...p,
    tries: [
      mv(W, at(0, 4), SUICIDE, 'Two liberties that do not touch; two eye cells remain.'),
      mv(W, at(-1, 4), SUICIDE, 'One liberty; two eye cells remain.'),
      mv(W, at(1, 3), SUICIDE, 'One liberty; two eye cells remain.'),
    ],
    life: { expect: 'safe' },
  });
}
{
  const p = enclose([at(-2, 4), at(-1, 4), at(-1, 3)]);
  example({
    title: 'Triangle on the edge: unsafe',
    rule: 'Same as a triangle away from the edge: the invader gets a liberty pair, two cells that really touch.',
    ...p,
    line: [
      mv(W, at(-1, 3), ok(0), 'The two edge cells touch each other: a liberty pair.'),
      mv(W, at(-2, 4), ok(p.black.length), 'One empty eye cell is left.'),
    ],
    lineNote: 'Black passes in between.',
    life: { expect: 'dead' },
  });
}

section('Order of events', 'After a stone is placed, the opponent’s groups are judged first and captured; only then are the mover’s own groups judged.');
{
  // From a Hard game on 4 per side: White's wall and the four Black stones inside it share
  // their only liberty pair.
  const side = 4;
  const stones = Uint8Array.from('2101221002121111102110102100221110210', Number);
  example({
    title: 'Two groups sharing their only liberty pair',
    rule: 'White’s wall and the four Black stones inside it share one liberty pair, D3 and E2. Whoever fills it leaves both groups without a pair, but the opponent is judged first, so the mover captures.',
    side, stones,
    tries: ['D3', 'E2'].map((n) => mv(W, byName(side, n), ok(4), 'Black’s four stones are judged first and captured; that gives White’s wall its liberties back.')),
  });
}

// ---------- Run the examples ----------
const outcome = (r) => (r.ok ? { r: 'ok', cap: r.captured.length } : { r: r.reason });
const same = (a, b) => a.r === b.r && (a.r !== 'ok' || a.cap === b.cap);
const colourName = (c) => (c === B ? 'Black' : 'White');
const say = (o) => o.r === 'suicide' ? 'illegal (suicide)' : o.r === 'ko' ? 'illegal (repeats a position)'
  : o.r !== 'ok' ? `illegal (${o.r})` : o.cap ? `legal, captures ${o.cap}` : 'legal, captures nothing';

// Life search, as in tools/eyeshapes.js: both sides play only inside the eye cells.
function lifeStatus(eng, board, start, cells, target) {
  const alive = (s) => s[target] === B;
  const seen = new Set();
  function attackerAlone(s) {
    const k = eng.keyOf(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const c of cells) {
      const r = eng.play(board, s, c, W);
      if (r.ok && (!alive(r.stones) || attackerAlone(r.stones))) return true;
    }
    return false;
  }
  const memo = new Map();
  function game(s, toMove, passed, depth) { // true if the group is captured
    if (depth === 0) return false;
    const k = eng.keyOf(s) + toMove + passed + depth;
    if (memo.has(k)) return memo.get(k);
    let res;
    if (toMove === W) {
      res = false;
      for (const c of cells) {
        const r = eng.play(board, s, c, W);
        if (r.ok && (!alive(r.stones) || game(r.stones, B, false, depth - 1))) { res = true; break; }
      }
      if (!res && !passed) res = game(s, B, true, depth - 1);
    } else {
      res = passed ? false : game(s, W, true, depth - 1);
      if (res) for (const c of cells) {
        const r = eng.play(board, s, c, B);
        if (r.ok && !game(r.stones, W, false, depth - 1)) { res = false; break; }
      }
    }
    memo.set(k, res);
    return res;
  }
  if (!attackerAlone(start)) return 'safe';
  if (!game(start, W, false, 14)) return 'defend';
  return game(start, B, false, 14) ? 'dead' : 'unsettled';
}
const LIFE = {
  safe: 'Safe: White cannot capture the group even if Black never answers.',
  defend: 'Safe only if Black answers: White captures with free moves, but not if Black replies.',
  unsettled: 'Unsettled: whoever plays first decides.',
  dead: 'Unsafe: White captures the group even if Black replies.',
};

let checks = 0, fails = 0;
const log = [];
function check(ex, what, good, detail) {
  checks++;
  if (!good) fails++;
  log.push(`${good ? 'ok   ' : 'FAIL '}${ex.id} ${ex.title}: ${what}${good ? '' : ' -- ' + detail}`);
  return good;
}

for (const sec of sections) for (const ex of sec.examples) {
  const { main, ref } = boardOf(ex.side);
  const nm = (i) => nameOf(ex.side, i);
  // The starting position must be one that can stand: every group alive on both engines.
  const a = MAIN.analyze(main, ex.stones), b = REF.analyze(ref, ex.stones);
  ex.stable = check(ex, 'starting position stands', a.groups.every((g) => g.alive) && b.groups.every((g) => g.alive), 'a group is already dead');

  const run = (m, stones, history) => {
    const r1 = MAIN.play(main, stones, m.at, m.c, history), r2 = REF.play(ref, stones, m.at, m.c, history);
    m.got = outcome(r1); m.gotRef = outcome(r2);
    m.captured = r1.ok ? r1.captured : [];
    m.before = stones; m.after = r1.ok ? r1.stones : null;
    m.pass = same(m.got, m.exp) && same(m.gotRef, m.exp) && (!r1.ok || !r2.ok || MAIN.keyOf(r1.stones) === REF.keyOf(r2.stones));
    check(ex, `${colourName(m.c)} ${nm(m.at)} -> ${say(m.exp)}`, m.pass, `engine: ${say(m.got)}; reference: ${say(m.gotRef)}`);
    return r1;
  };
  for (const m of ex.tries || []) run(m, ex.stones, new Set([MAIN.keyOf(ex.stones)]));
  if (ex.line) {
    let s = ex.stones;
    const history = new Set([MAIN.keyOf(s)]);
    for (const m of ex.line) {
      const r = run(m, s, history);
      if (r.ok) { s = r.stones; history.add(MAIN.keyOf(s)); }
    }
  }
  if (ex.life) {
    const target = ex.life.target ?? ex.black[0];
    ex.life.got = lifeStatus(MAIN, main, ex.stones, ex.eyes, target);
    ex.life.gotRef = lifeStatus(REF, ref, ex.stones, ex.eyes, target);
    ex.life.pass = ex.life.got === ex.life.expect && ex.life.gotRef === ex.life.expect;
    check(ex, `life search -> ${ex.life.expect}`, ex.life.pass, `engine: ${ex.life.got}; reference: ${ex.life.gotRef}`);
  }
}

// ---------- The page ----------
const S = 15; // hex radius in px
const INK = { wood: '#e2c48f', line: '#9c7c48', edge: '#5b4526', black: '#1d1b19', white: '#fbfaf7', stoneEdge: '#6b6157', label: '#8a6d3b', red: '#c0392b' };
const sideAngle = { '1,0': 0, '1,-1': -60, '0,-1': -120, '-1,0': 180, '-1,1': 120, '0,1': 60 };
// marks: Map cell -> { label, colour? (a move still to be played), cross? (captured) }
function boardSvg(side, stones, marks) {
  const board = boardOf(side).main, R = side - 1, pad = 5;
  const w = S * Math.sqrt(3) * (2 * side - 1) + 2 * pad, h = S * 1.5 * (2 * side - 2) + 2 * S + 2 * pad;
  const centre = ([q, r]) => [w / 2 + S * Math.sqrt(3) * (q + r / 2), h / 2 + S * 1.5 * r];
  const pt = (x, y, deg) => `${(x + S * Math.cos(deg * Math.PI / 180)).toFixed(1)},${(y + S * Math.sin(deg * Math.PI / 180)).toFixed(1)}`;
  const hexes = [], edges = [], tops = [];
  board.cells.forEach(([q, r], i) => {
    const [x, y] = centre([q, r]);
    hexes.push(`<polygon points="${[0, 1, 2, 3, 4, 5].map((k) => pt(x, y, 60 * k - 30)).join(' ')}" fill="${INK.wood}" stroke="${INK.line}" stroke-width="0.7"/>`);
    for (const [dq, dr] of DIRS) {
      if (Math.abs(q + dq) <= R && Math.abs(r + dr) <= R && Math.abs(q + dq + r + dr) <= R) continue;
      const a = sideAngle[dq + ',' + dr];
      edges.push(`<polyline points="${pt(x, y, a - 30)} ${pt(x, y, a + 30)}" stroke="${INK.edge}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`);
    }
    const m = marks && marks.get(i), X = x.toFixed(1), Y = y.toFixed(1);
    if (stones[i] !== EMPTY) {
      const blk = stones[i] === B;
      tops.push(`<circle cx="${X}" cy="${Y}" r="${(S * 0.72).toFixed(1)}" fill="${blk ? INK.black : INK.white}" stroke="${m ? INK.red : INK.stoneEdge}" stroke-width="${m ? 1.8 : 0.8}"/>`);
      if (m) tops.push(`<text x="${X}" y="${(y + 3.6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${blk ? '#fff' : INK.red}">${m.label}</text>`);
    } else if (m && m.cross) {
      const d = S * 0.34;
      tops.push(`<path d="M${(x - d).toFixed(1)} ${(y - d).toFixed(1)}L${(x + d).toFixed(1)} ${(y + d).toFixed(1)}M${(x + d).toFixed(1)} ${(y - d).toFixed(1)}L${(x - d).toFixed(1)} ${(y + d).toFixed(1)}" stroke="${INK.red}" stroke-width="2" stroke-linecap="round"/>`);
    } else if (m) {
      const blk = m.colour === B;
      tops.push(`<circle cx="${X}" cy="${Y}" r="${(S * 0.62).toFixed(1)}" fill="${blk ? INK.black : INK.white}" fill-opacity="0.45" stroke="${INK.red}" stroke-width="1.6" stroke-dasharray="3 2"/>`);
      tops.push(`<text x="${X}" y="${(y + 3.6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${blk ? '#fff' : INK.red}">${m.label}</text>`);
    } else {
      tops.push(`<text x="${X}" y="${(y + 2.6).toFixed(1)}" text-anchor="middle" font-size="7" fill="${INK.label}">${nameOf(side, i)}</text>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">${hexes.join('')}${edges.join('')}${tops.join('')}</svg>`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tick = (pass) => `<span class="${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'}</span>`;
const figure = (svg, caption) => `<figure>${svg}<figcaption>${esc(caption)}</figcaption></figure>`;

function exampleHtml(ex) {
  const nm = (i) => nameOf(ex.side, i);
  const figs = [], rows = [];
  const moves = ex.tries || ex.line, isLine = !!ex.line;
  const labelOf = (k) => (isLine ? String(k + 1) : String.fromCharCode(97 + k));
  // Starting position with every move marked; a cell played more than once shows its first label.
  const start = new Map();
  moves.forEach((m, k) => { if (!start.has(m.at)) start.set(m.at, { label: labelOf(k), colour: m.c }); });
  figs.push(figure(boardSvg(ex.side, ex.stones, start), 'Position'));
  moves.forEach((m, k) => {
    const l = labelOf(k);
    if (m.after) {
      const marks = new Map([[m.at, { label: l }]]);
      for (const c of m.captured) marks.set(c, { cross: true });
      figs.push(figure(boardSvg(ex.side, m.after, marks), `After ${l}`));
    }
    const got = m.pass ? '' : ` <span class="fail">Engine: ${esc(say(m.got))}. Reference engine: ${esc(say(m.gotRef))}.</span>`;
    rows.push(`<li>${tick(m.pass)} <b>${l}</b> · ${colourName(m.c)} ${nm(m.at)}: <b>${esc(say(m.exp))}</b>. ${esc(m.why)}${got}</li>`);
  });
  const life = ex.life ? `<p class="life">${tick(ex.life.pass)} <b>${esc(LIFE[ex.life.expect])}</b>${ex.life.pass ? '' : ` <span class="fail">Engine: ${esc(ex.life.got)}. Reference engine: ${esc(ex.life.gotRef)}.</span>`}</p>` : '';
  return `<article id="ex-${ex.id}">
  <h3><span class="num">${ex.id}</span> ${esc(ex.title)}</h3>
  <p class="rule">${esc(ex.rule)}</p>
  <div class="figs">${figs.join('')}</div>
  ${ex.lineNote ? `<p class="note">Moves are played in order. ${esc(ex.lineNote)}</p>` : isLine ? '<p class="note">Moves are played in order.</p>' : moves.length > 1 ? '<p class="note">Each lettered move is tried separately from the position shown.</p>' : ''}
  <ul>${rows.join('')}</ul>
  ${life}
  ${ex.stable ? '' : '<p class="fail">The starting position does not stand: a group in it is already dead.</p>'}
  ${ex.review ? `<p class="review"><b>Please check:</b> ${esc(ex.review)}</p>` : ''}
</article>`;
}

const count = sections.reduce((n, s) => n + s.examples.length, 0);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge Eyes Rule Examples</title>
<style>
  /* One reading column of example cards; diagrams wrap under each other on a phone. */
  :root { --bg: #f2ede6; --card: #fffaf2; --line: #e0d6c6; --fg: #2b2620; --muted: #6f6455; --accent: #8a6d3b; --pass: #2e7d32; --fail: #c0392b; --flag-bg: #fff3cd; --flag: #d9a400; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #1b1814; --card: #26221c; --line: #3d362c; --fg: #ece4d6; --muted: #a99d8a; --accent: #d3b072; --pass: #7cc47f; --fail: #f08a7b; --flag-bg: #3a3013; --flag: #d9a400; color-scheme: dark } }
  :root[data-theme="dark"] { --bg: #1b1814; --card: #26221c; --line: #3d362c; --fg: #ece4d6; --muted: #a99d8a; --accent: #d3b072; --pass: #7cc47f; --fail: #f08a7b; --flag-bg: #3a3013; --flag: #d9a400; color-scheme: dark }
  body { margin: 0; padding-block: 24px 60px; padding-inline: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; text-wrap: balance; }
  h2 { font-size: 20px; margin: 40px 0 6px; }
  h3 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 6px 0; }
  .lede, .intro { color: var(--muted); }
  .summary { padding: 10px 14px; border-radius: 6px; background: var(--card); border: 1px solid var(--line); }
  article { margin: 14px 0; padding: 14px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
  .num { display: inline-block; min-width: 34px; color: var(--accent); }
  .figs { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 8px 0 2px; }
  figure { margin: 0; max-width: 100%; }
  figcaption { font-size: 12px; color: var(--muted); text-align: center; }
  ul { margin: 6px 0; padding-left: 4px; list-style: none; }
  li { margin: 3px 0; }
  .note { font-size: 13px; color: var(--muted); }
  .pass { color: var(--pass); font-weight: 700; }
  .fail { color: var(--fail); font-weight: 700; }
  .review { padding: 8px 12px; background: var(--flag-bg); border-left: 4px solid var(--flag); border-radius: 3px; }
  .life { margin-top: 8px; }
  svg { display: block; max-width: 100%; height: auto; }
</style></head><body><main>
<h1>HexGo Edge Eyes: rule examples</h1>
<p class="lede">${count} worked examples of what is captured, what is safe and what is illegal, on a board of 5 per side unless stated. Each outcome was written down from the rules and then played on the engine and on the independent reference engine.</p>
<p class="summary">${fails ? `<span class="fail">${fails} of ${checks} checks disagree with the engine.</span> They are marked ✗ below.` : `<span class="pass">All ${checks} checks agree</span> with both engines.`} A ✓ means the engines do what the line says; it does not mean the rule itself is what you want.</p>
<p class="intro"><b>Reading the diagrams.</b> The thick outline is the board edge. A dashed circle is a move about to be played, in the mover’s colour, lettered or numbered. In the “After” diagrams the stone just played carries its label and a red ✕ marks each captured stone. Cells are named by row letter and position in the row.</p>
${sections.map((s, k) => `<h2>${k + 1}. ${esc(s.title)}</h2>\n<p class="intro">${esc(s.intro)}</p>\n${s.examples.map(exampleHtml).join('\n')}`).join('\n')}
</main></body></html>
`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'rule-examples.html'), html);

console.log(log.join('\n'));
console.log(`\n${count} examples, ${checks} checks, ${fails} failure(s)`);
console.log('wrote ' + path.join(outDir, 'rule-examples.html'));
process.exit(fails ? 1 : 0);
