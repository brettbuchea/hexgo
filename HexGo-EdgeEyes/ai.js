// HexGo computer players.
//
// Classical (pre-neural-network) Go engines took one of two routes:
//   * Knowledge-based (GNU Go and its predecessors): hand-written patterns and tactical
//     readers. These need years of expert tuning, and none of that knowledge exists for HexGo.
//   * Monte Carlo tree search (Crazy Stone, MoGo, Fuego, 2006 onward): judge a move by playing
//     many random games from it to the end and counting wins, and grow a search tree toward
//     the moves that win most (UCT). It needs only the rules and the scorer, which is why it
//     is used here.
// This player is UCT plus RAVE ("all moves as first", the MoGo improvement): a move that won
// when played at any point in a random game gets early credit, which speeds up learning a lot
// when there are few simulations.
//
// hexGoAIModule(E) takes the engine API so the same source can run in Node, the page, or a
// Web Worker.
function hexGoAIModule(E) {
  'use strict';
  const { EMPTY, BLACK, WHITE, other } = E;
  const PASS = -1;

  // Small seeded PRNG (mulberry32) so matches can be replayed exactly.
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A cell is a sensible random move unless it fills one of our own single-point eyes.
  function sensible(board, stones, i, color) {
    if (stones[i] !== EMPTY) return false;
    const ns = board.neighbors[i];
    for (let j = 0; j < ns.length; j++) if (stones[ns[j]] !== color) return true;
    return false;
  }

  // Marks empty cells that sit in our own small eye space: an empty region of at most
  // `maxSize` cells bordered only by our stones and the edge. Filling these never helps
  // (HexGo needs 3+ eye cells to live), and random games that fill them misjudge life.
  function eyeSpace(board, stones, color, maxSize) {
    const N = board.size, mask = new Uint8Array(N), seen = new Uint8Array(N);
    const region = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] || stones[i] !== EMPTY) continue;
      region.length = 0; region.push(i); seen[i] = 1;
      let ours = true;
      for (let k = 0; k < region.length; k++) {
        const ns = board.neighbors[region[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j];
          if (stones[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
          else if (stones[n] !== color) ours = false;
        }
      }
      if (ours && region.length <= maxSize) for (const c of region) mask[c] = 1;
    }
    return mask;
  }

  // True when both colours are on the board and every empty region borders exactly one
  // colour: nothing is left to contest. (With one colour alone, a single stone "owns" the
  // whole empty board, which is not a finished position.)
  function settled(board, stones) {
    const N = board.size, seen = new Uint8Array(N), region = [];
    let present = 0;
    for (let i = 0; i < N; i++) present |= stones[i];
    if (present !== (BLACK | WHITE)) return false;
    for (let i = 0; i < N; i++) {
      if (seen[i] || stones[i] !== EMPTY) continue;
      region.length = 0; region.push(i); seen[i] = 1;
      let colors = 0;
      for (let k = 0; k < region.length; k++) {
        const ns = board.neighbors[region[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j];
          if (stones[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
          else colors |= stones[n];
        }
      }
      if (colors !== BLACK && colors !== WHITE) return false;
    }
    return true;
  }

  // Buffers reused by fillCandidates() so that random games allocate nothing per move.
  function scratchOf(board) {
    return board.ai || (board.ai = { seen: new Int32Array(board.size), region: new Int32Array(board.size), cand: new Int32Array(board.size), stamp: 0 });
  }

  // Candidate moves for `color`: empty, not a single-point own eye, and (when eyeSize > 0)
  // not inside our own small eye space (see eyeSpace). Writes them in board order to the
  // board's `ai.cand` buffer and returns how many there are.
  function fillCandidates(board, stones, color, eyeSize) {
    const a = scratchOf(board), N = board.size, nb = board.neighbors, { seen, region, cand } = a;
    let count = 0;
    if (!(eyeSize > 0)) {
      for (let i = 0; i < N; i++) if (sensible(board, stones, i, color)) cand[count++] = i;
      return count;
    }
    // seen[i] === st: an empty cell we may play on; st + 1: inside our own small eye space.
    // (A single-point own eye is an eye space of one cell, so `sensible` needs no separate check.)
    if (a.stamp > 2000000000) { seen.fill(0); a.stamp = 0; }
    const st = (a.stamp += 2);
    for (let i = 0; i < N; i++) {
      if (stones[i] !== EMPTY || seen[i] >= st) continue;
      let n0 = 0, ours = true;
      region[n0++] = i; seen[i] = st;
      for (let k = 0; k < n0; k++) {
        const ns = nb[region[k]];
        for (let j = 0; j < ns.length; j++) {
          const n = ns[j], v = stones[n];
          if (v === EMPTY) { if (seen[n] < st) { seen[n] = st; region[n0++] = n; } }
          else if (v !== color) ours = false;
        }
      }
      if (ours && n0 <= eyeSize) for (let k = 0; k < n0; k++) seen[region[k]] = st + 1;
    }
    for (let i = 0; i < N; i++) if (stones[i] === EMPTY && seen[i] === st) cand[count++] = i;
    return count;
  }
  function candidates(board, stones, color, eyeSize) {
    const n = fillCandidates(board, stones, color, eyeSize);
    return Array.from(scratchOf(board).cand.subarray(0, n));
  }

  // Random legal sensible move, or PASS. Returns { move, stones }.
  function randomMove(board, stones, color, rng, history, eyeSize) {
    const cand = candidates(board, stones, color, eyeSize || 0);
    while (cand.length) {
      const k = (rng() * cand.length) | 0, i = cand[k];
      cand[k] = cand[cand.length - 1]; cand.pop();
      const r = E.play(board, stones, i, color, history);
      if (r.ok) return { move: i, stones: r.stones };
    }
    return { move: PASS, stones };
  }

  const SURVEY_AFTER = 3;

  // Plays random moves to the end. Records who first played each cell for RAVE.
  // Works on its own copy of the position, changed in place by the engine's fast place().
  function playout(board, stones, toMove, passes, rng, firstBy, eyeSize) {
    const s = Uint8Array.from(stones), cand = scratchOf(board).cand;
    let c = toMove, p = passes, n = 0;
    const limit = board.size * 3;
    while (p < 2 && n < limit) {
      // A random legal sensible move, chosen exactly as randomMove() does.
      // After a few refusals on the same position (common near the end, when every remaining
      // point is tried and found illegal) it is cheaper to survey the board once.
      let len = fillCandidates(board, s, c, eyeSize || 0), move = PASS, tries = 0;
      while (len) {
        const k = (rng() * len) | 0, i = cand[k];
        cand[k] = cand[--len];
        if (tries === SURVEY_AFTER) E.survey(board, s);
        if (tries++ < SURVEY_AFTER ? E.place(board, s, i, c) : E.placeSurveyed(board, s, i, c)) { move = i; break; }
      }
      if (move === PASS) p++;
      else {
        p = 0;
        if (!firstBy[move]) firstBy[move] = c;
      }
      c = other(c); n++;
    }
    return s;
  }

  // Black's margin counting stones on the board plus territory (area scoring), with every
  // stone on the board counted alive.
  function areaMargin(board, stones, komi) {
    const sc = E.score(board, stones, komi, null, { rule: 'area' });
    return sc.black - sc.white;
  }
  // HexGo itself uses territory scoring: territory + prisoners. The two are tied by an exact
  // identity: territory margin = area margin - (stones Black placed - stones White placed),
  // because every stone placed is either still on the board or became the opponent's prisoner.
  // The search uses this, so a move inside your own area costs a point and passing is free.

  // Estimates which stones are dead by playing the position out at random many times (as Go
  // servers do): a group is dead when its cells end up owned by the opponent in most runs.
  function estimateDead(board, stones, opts) {
    const o = Object.assign({ playouts: 200, seed: 7, eyeSize: 6 }, opts);
    const rng = makeRng(o.seed);
    const N = board.size, theirs = new Float64Array(N), noRave = new Uint8Array(N);
    for (let k = 0; k < o.playouts; k++) {
      const end = playout(board, stones, k % 2 ? WHITE : BLACK, 0, rng, noRave, o.eyeSize);
      const owner = E.score(board, end, 0, null, { rule: 'area' }).territory;
      for (let i = 0; i < N; i++) {
        if (!stones[i]) continue;
        const own = end[i] || owner[i];
        if (own && own !== stones[i]) theirs[i]++;
      }
    }
    // Random games don't defend, so they can make a living group look dead. Confirm each
    // candidate with a short capture search: the group only counts as dead if the opponent
    // can force its capture even when the owner moves first.
    const dead = new Set();
    for (const g of E.analyze(board, stones).groups) {
      let sum = 0;
      for (const c of g.cells) sum += theirs[c];
      if (sum / g.cells.length <= o.playouts / 2) continue;
      if (o.verify === false || canForceCapture(board, stones, g.cells, o)) for (const c of g.cells) dead.add(c);
    }
    return dead;
  }

  // Can the opponent of the group at `cells` capture it by force, with the owner moving first?
  // Searches moves on empty cells within two steps of the group, up to `depth` plies; the owner
  // may pass, the attacker may not. If the search runs out of budget, the answer is "no".
  function canForceCapture(board, stones, cells, opts) {
    const o = Object.assign({ depth: 9, nodeLimit: 200000 }, opts);
    const owner = stones[cells[0]], attacker = other(owner), probe = cells[0];
    const near = new Set();
    for (const c of cells) for (const n of board.neighbors[c]) { near.add(n); for (const m of board.neighbors[n]) near.add(m); }
    const cand = [...near].filter((i) => stones[i] === EMPTY);
    const memo = new Map();
    let nodes = 0, outOfBudget = false;
    function attackerWins(s, toMove, depth, passed) {
      if (s[probe] !== owner) return true;
      if (depth === 0 || outOfBudget) return false;
      if (++nodes > o.nodeLimit) { outOfBudget = true; return false; }
      const key = E.keyOf(s) + toMove + depth + (passed ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      let res;
      if (toMove === attacker) {
        res = false;
        for (const c of cand) {
          if (s[c] !== EMPTY) continue;
          const r = E.play(board, s, c, attacker);
          if (r.ok && attackerWins(r.stones, owner, depth - 1, false)) { res = true; break; }
        }
      } else {
        res = passed ? false : attackerWins(s, attacker, depth - 1, true);
        if (res) for (const c of cand) {
          if (s[c] !== EMPTY) continue;
          const r = E.play(board, s, c, owner);
          if (r.ok && !attackerWins(r.stones, attacker, depth - 1, false)) { res = false; break; }
        }
      }
      memo.set(key, res);
      return res;
    }
    const result = attackerWins(stones, owner, o.depth, false);
    return result && !outOfBudget;
  }

  // Final territory score with dead stones found automatically.
  // prisoners = { [BLACK]: stones Black captured, [WHITE]: stones White captured }.
  function finalScore(board, stones, komi, prisoners, opts) {
    const dead = estimateDead(board, stones, opts);
    return Object.assign(E.score(board, stones, komi, dead, { prisoners }), { dead });
  }

  class Node {
    constructor(parent, move, stones, toMove, passes) {
      this.parent = parent; this.move = move; this.stones = stones;
      this.toMove = toMove; this.passes = passes;
      // Stones Black placed minus stones White placed since the root (for territory scoring).
      this.placed = parent ? parent.placed + (move === PASS ? 0 : parent.toMove === BLACK ? 1 : -1) : 0;
      this.children = []; this.untried = null;
      this.n = 0; this.w = 0;   // visits / total value for the player who made `move`
      this.wins = 0;            // plain wins, for reporting the winning chance
      this.margin = 0;          // sum of final margins for the player who made `move`
      this.rn = 0; this.rw = 0; // RAVE visits / value
    }
  }

  // Monte Carlo tree search. Options: playouts, komi, seed, history (Set of position keys
  // for superko at the root), passes (consecutive passes before this move),
  // eyeSize (protect own eye spaces up to this size; 0 = off),
  // scoreWeight (share of the reward that comes from the score margin rather than win/loss;
  //   the default 1 plays purely for points, since HexGo's komi isn't settled yet),
  // dynamicKomi (for scoreWeight < 1: when the game looks decided, play against the expected margin),
  // placedBefore (stones Black has placed minus stones White has placed so far this game;
  //   only shifts the reported expectedMargin, not the choice of move).
  // Returns { move, winRate, expectedMargin, playouts, visits }; expectedMargin is from toMove's view.
  // Returns { move, winRate, playouts, visits: [{move, n, winRate}] }.
  function mcts(board, stones, toMove, opts) {
    const o = Object.assign({ playouts: 1000, komi: 6, seed: 1, passes: 0, raveK: 600, explore: 0.35,
      eyeSize: 6, scoreWeight: 1, dynamicKomi: false, placedBefore: 0 }, opts);
    const rng = makeRng(o.seed);
    const firstBy = new Uint8Array(board.size);

    const expandList = (node) => {
      const list = candidates(board, node.stones, node.toMove, o.eyeSize);
      for (let k = list.length - 1; k > 0; k--) { const j = (rng() * (k + 1)) | 0; [list[k], list[j]] = [list[j], list[k]]; }
      // Passing early ends games before anything is decided, so passing is only considered
      // once the opponent has passed, no move is left, or (playing for points) the board is
      // settled: every empty area already belongs to one colour.
      if (node.passes === 1 || !list.length || (o.scoreWeight >= 1 && settled(board, node.stones))) list.unshift(PASS);
      return list;
    };

    const value = (child, logN) => {
      const q = child.w / child.n;
      const beta = Math.sqrt(o.raveK / (3 * child.n + o.raveK));
      const rq = child.rn ? child.rw / child.rn : q;
      return (1 - beta) * q + beta * rq + o.explore * Math.sqrt(logN / child.n);
    };

    // Runs `count` simulations into a fresh tree. `shift` is the dynamic-komi offset: margins
    // are judged against it, so a decided game still has something to play for.
    function search(root, count, shift) {
    let marginSum = 0;
    for (let it = 0; it < count; it++) {
      let node = root;
      // Selection: walk down fully expanded nodes.
      while (node.passes < 2) {
        if (node.untried === null) node.untried = expandList(node);
        if (node.untried.length) break;
        if (!node.children.length) break;
        const logN = Math.log(node.n + 1);
        let best = null, bv = -Infinity;
        for (const ch of node.children) { const v = value(ch, logN); if (v > bv) { bv = v; best = ch; } }
        node = best;
      }
      // Expansion: add one legal untried move.
      while (node.passes < 2 && node.untried.length) {
        const mv = node.untried.pop();
        let child = null;
        if (mv === PASS) child = new Node(node, PASS, node.stones, other(node.toMove), node.passes + 1);
        else {
          const r = E.play(board, node.stones, mv, node.toMove, node === root ? o.history : undefined);
          if (r.ok) child = new Node(node, mv, r.stones, other(node.toMove), 0);
        }
        if (child) { node.children.push(child); node = child; break; }
        // Every candidate was illegal: passing is the only option.
        if (!node.untried.length && !node.children.length) node.untried.push(PASS);
      }
      // Simulation.
      firstBy.fill(0);
      // After two passes the game is over, but dead stones may still be on the board: play
      // on at random to resolve them. That continuation only settles who owns what; its
      // stones don't count as placed, so they cost nothing under territory scoring.
      const end = playout(board, node.stones, node.toMove, node.passes >= 2 ? 0 : node.passes, rng, firstBy, o.eyeSize);
      // Reward: the score margin scaled to 0..1, optionally blended with win/loss
      // (1 = Black win, 0 = White win, 0.5 = draw). Playing for points also keeps a decided
      // game meaningful: with win/loss alone every move looks equally good once the result
      // is certain, and the choice becomes random.
      const real = areaMargin(board, end, o.komi) - (o.placedBefore + node.placed);
      marginSum += real;
      const m = real - shift;
      const blackWin = m > 0 ? 1 : m < 0 ? 0 : 0.5;
      const blackScore = Math.min(1, Math.max(0, 0.5 + m / (2 * board.size)));
      const blackResult = (1 - o.scoreWeight) * blackWin + o.scoreWeight * blackScore;
      // Backpropagation, with RAVE credit for moves played later in the same simulation.
      for (let n = node; n; n = n.parent) {
        // Walking up reaches earlier moves, so a tree move overrides any later use of its cell.
        if (n.move !== null && n.move !== PASS) firstBy[n.move] = other(n.toMove);
        n.n++;
        const mover = other(n.toMove);
        n.w += mover === BLACK ? blackResult : 1 - blackResult;
        n.wins += mover === BLACK ? blackWin : 1 - blackWin;
        n.margin += mover === BLACK ? real : -real;
        for (const ch of n.children) {
          if (ch.move === PASS || firstBy[ch.move] !== n.toMove) continue;
          ch.rn++;
          ch.rw += n.toMove === BLACK ? blackResult : 1 - blackResult;
        }
      }
    }

    return { root, meanMargin: marginSum / Math.max(1, count) };
    }

    // Dynamic komi (as in Pachi and Zen): if half the budget shows the game is all but decided,
    // search again judging moves against the expected margin, so the winner keeps building its
    // lead and the loser keeps limiting the damage instead of playing at random.
    const half = Math.max(1, Math.floor(o.playouts / 2));
    let root = new Node(null, null, stones, toMove, o.passes);
    const { meanMargin } = search(root, half, 0);
    const chance = root.n ? 1 - root.wins / root.n : 0.5; // winning chance for toMove
    let reported = null;
    if (o.dynamicKomi && (chance > 0.95 || chance < 0.05)) {
      reported = chance;
      root = new Node(null, null, stones, toMove, o.passes);
      search(root, o.playouts - half, meanMargin);
    } else {
      search(root, o.playouts - half, 0); // not decided: keep growing the same tree
    }

    let best = null;
    for (const ch of root.children) if (!best || ch.n > best.n) best = ch;
    // After the opponent passes, passing ends the game. If that scores as well as the
    // favourite move, end it rather than play a pointless move in a finished position.
    const pass = root.children.find((ch) => ch.move === PASS);
    const halfPoint = 0.5 / (2 * board.size); // half a point, in reward units
    if (o.passes === 1 && best && pass && pass !== best && pass.n >= 10 && pass.w / pass.n >= best.w / best.n - Math.max(halfPoint, 0.01 * (1 - o.scoreWeight))) best = pass;
    const visits = root.children.map((ch) => ({ move: ch.move, n: ch.n, winRate: ch.wins / ch.n }))
      .sort((a, b) => b.n - a.n);
    if (!best) return { move: PASS, winRate: reported ?? 0, expectedMargin: 0, playouts: o.playouts, visits };
    // Under dynamic komi the tree's win counts are against the shifted target, so report the
    // real chance from the first half instead.
    return { move: best.move, winRate: reported ?? best.wins / best.n, expectedMargin: best.margin / best.n,
             playouts: o.playouts, visits };
  }

  // Uniform entry point. player = { type: 'random' } | { type: 'mcts', playouts, options? }.
  function chooseMove(board, stones, toMove, player, opts) {
    opts = opts || {};
    if (player.type === 'random') {
      const r = randomMove(board, stones, toMove, makeRng(opts.seed || 1), opts.history);
      return { move: r.move, winRate: null };
    }
    return mcts(board, stones, toMove, Object.assign({}, opts, player.options, { playouts: player.playouts }));
  }

  // Plays one full game between two players and scores it with territory scoring.
  // Returns { moves, winner (null for a draw), margin, stones, score, prisoners }.
  function playGame(side, black, white, opts) {
    const o = Object.assign({ komi: 6, seed: 1, maxMoves: null }, opts);
    const board = E.createBoard(side);
    let stones = new Uint8Array(board.size), toMove = BLACK, passes = 0, placed = 0;
    const history = new Set([E.keyOf(stones)]);
    const prisoners = { [BLACK]: 0, [WHITE]: 0 };
    const moves = [];
    const limit = o.maxMoves || board.size * 4;
    while (passes < 2 && moves.length < limit) {
      const player = toMove === BLACK ? black : white;
      const res = chooseMove(board, stones, toMove, player,
        { komi: o.komi, seed: o.seed * 7919 + moves.length, history, passes, placedBefore: placed });
      if (res.move === PASS) passes++;
      else {
        const r = E.play(board, stones, res.move, toMove, history);
        stones = r.stones; passes = 0; history.add(E.keyOf(stones));
        prisoners[toMove] += r.captured.length;
        placed += toMove === BLACK ? 1 : -1;
      }
      moves.push(res.move);
      toMove = other(toMove);
    }
    const score = finalScore(board, stones, o.komi, prisoners, { seed: o.seed });
    const m = score.black - score.white;
    return { moves, winner: m > 0 ? BLACK : m < 0 ? WHITE : null, margin: m, stones, score, prisoners };
  }

  return { PASS, makeRng, randomMove, eyeSpace, mcts, chooseMove, playGame, areaMargin, estimateDead, canForceCapture, finalScore };
}

(function (root) {
  if (typeof module !== 'undefined' && module.exports) module.exports = hexGoAIModule;
  else root.hexGoAIModule = hexGoAIModule;
})(typeof window !== 'undefined' ? window : globalThis);
