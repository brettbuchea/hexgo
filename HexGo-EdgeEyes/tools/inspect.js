// Move-by-move records and a rules audit for saved games (match.js --out files).
//
// For every game in <folder>/raw it writes:
//   steps/gameNN.txt   readable record: each move, captures, the board and every group's state
//   steps/gameNN.json  the same, structured, for checking by program
// and for the whole folder:
//   audit.md           every check that was run and anything that looked wrong
//
// Checks on every move:
//   - the move is legal and the main engine and the slow reference engine agree on the result
//   - only enemy stones were captured, and each captured group really had no liberty pair and
//     fewer than 2 eye cells once the move was placed (opponent judged first)
//   - after the move, every group left on the board is alive (pair or 2+ eye cells)
//   - no whole-board position repeats (superko)
// Checks on the final board:
//   - every group counted alive survives a forced-capture search with its owner to move
//     (so it is not secretly dead)
//   - every group marked dead can be captured by force with its owner moving first
//   - the score adds up: territory + captures + dead stones, and territory cells only border
//     one colour once dead stones are removed
//   - neutral cells (touching both colours) are listed
// Usage: node tools/inspect.js <results folder>
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const REF = require('./engine-reference.js');
const AI = require('../ai.js')(E);
const { BLACK, WHITE, EMPTY } = E;

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/inspect.js <results folder>'); process.exit(1); }
const rawDir = path.join(dir, 'raw');
const stepsDir = path.join(dir, 'steps');
fs.mkdirSync(stepsDir, { recursive: true });
const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'))
  .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));

const colourName = (c) => (c === BLACK ? 'Black' : 'White');
const audit = [];
let totalMoves = 0, totalIssues = 0;

for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(rawDir, f)));
  const board = E.createBoard(rec.side), refBoard = REF.createBoard(rec.side);
  const R = rec.side - 1;
  const name = (i) => {
    if (i < 0) return 'pass';
    const [q, r] = board.cells[i];
    return String.fromCharCode(65 + r + R) + (q - Math.max(-R, -R - r) + 1);
  };
  const names = (list) => list.map(name).sort().join(',') || '-';
  const diagram = (s, marks) => {
    const lines = [];
    for (let r = -R; r <= R; r++) {
      let line = String.fromCharCode(65 + r + R) + ' ' + ' '.repeat(Math.abs(r));
      for (let q = -R; q <= R; q++) {
        const i = board.index.get(q + ',' + r);
        if (i === undefined) continue;
        line += (marks && marks.get(i)) || '.XO'[s[i]];
        line += ' ';
      }
      lines.push(line.trimEnd());
    }
    return lines.join('\n');
  };
  const groupInfo = (s) => {
    const { groups } = E.analyze(board, s);
    const threatened = new Set([...E.threatened(board, s, BLACK), ...E.threatened(board, s, WHITE)]);
    return groups.map((g, gi) => {
      const libs = new Set();
      for (const c of g.cells) for (const n of board.neighbors[c]) if (s[n] === EMPTY) libs.add(n);
      return { colour: colourName(g.color), stones: g.cells.map(name).sort(), liberties: [...libs].map(name).sort(),
        pair: g.pair, eyeCells: g.eyeLibs, alive: g.alive, inDanger: threatened.has(gi) };
    });
  };
  const groupLines = (info) => info.map((g) =>
    `  ${g.colour.padEnd(5)} [${g.stones.join(',')}]  liberties ${g.liberties.join(',') || '-'}  ` +
    `pair ${g.pair ? 'yes' : 'no'}  eye cells ${g.eyeCells}  ${g.alive ? 'alive' : 'NOT ALIVE'}${g.inDanger ? ' (can be captured next move)' : ''}`).join('\n');

  for (const g of rec.games) {
    const id = String(parseInt(f.match(/\d+/))).padStart(2, '0');
    const issues = [];
    const out = [`HexGo game ${id}: ${g.black} (Black, X) vs ${g.white} (White, O), ${rec.side} per side, seed ${g.seed}`,
      'Cells are named row letter + position in the row, counted from the left.', ''];
    const steps = [];
    let s = new Uint8Array(board.size), c = BLACK;
    const history = new Set([E.keyOf(s)]);
    const caps = { [BLACK]: 0, [WHITE]: 0 };
    out.push('Start: empty board', diagram(s), '');
    g.moves.forEach((m, k) => {
      const n = k + 1, who = colourName(c);
      const step = { move: n, player: who, cell: name(m), captured: [], issues: [] };
      if (m < 0) {
        out.push(`Move ${n}: ${who} passes`, '');
      } else {
        const r = E.play(board, s, m, c, history);
        const rr = REF.play(refBoard, s, m, c);
        if (!r.ok) step.issues.push(`illegal move (${r.reason})`);
        else {
          if (!rr.ok || E.keyOf(rr.stones) !== E.keyOf(r.stones)) step.issues.push('main and reference engines disagree');
          if (r.captured.some((x) => s[x] === c)) step.issues.push('captured its own stones');
          // Each captured group must have had no pair and < 2 eye cells at the step it was removed.
          // Removals can cascade: in this rule set, losing a neighbour can seal a group inside an
          // enemy pocket, so groups are re-checked after each round of removals.
          if (r.captured.length) {
            const placed = Uint8Array.from(s); placed[m] = c;
            const remaining = new Set(r.captured);
            let round = 0;
            while (remaining.size) {
              const { groups, groupOf } = E.analyze(board, placed, c);
              const dead = groups.filter((cg) => cg.color !== c && !cg.alive);
              if (!dead.length) { step.issues.push(`captured stones [${names([...remaining])}] were never without life`); break; }
              for (const cg of dead) for (const x of cg.cells) {
                if (!remaining.has(x)) step.issues.push(`group [${names(cg.cells)}] was without life but not captured`);
                remaining.delete(x); placed[x] = EMPTY;
              }
              if (round > 0) step.cascade = (step.cascade || []).concat(dead.map((cg) => names(cg.cells)));
              round++;
            }
            if (step.cascade) step.notes = [`chain capture: ${step.cascade.join(' ')} died only after the first stones were removed`];
          }
          const after = E.analyze(board, r.stones);
          for (const ag of after.groups) if (!ag.alive) step.issues.push(`${colourName(ag.color)} group [${names(ag.cells)}] left on board without life`);
          step.captured = r.captured.map(name).sort();
          caps[c] += r.captured.length;
          s = r.stones;
          history.add(E.keyOf(s));
        }
        const marks = new Map([[m, c === BLACK ? 'x' : 'o']]);
        out.push(`Move ${n}: ${who} ${name(m)}${step.captured.length ? ` - captures ${step.captured.length}: ${step.captured.join(',')}` : ''}` +
          (step.notes ? `  [${step.notes.join('; ')}]` : '') +
          `   (captured so far: Black ${caps[BLACK]}, White ${caps[WHITE]})`, diagram(s, marks));
        const info = groupInfo(s);
        out.push(groupLines(info), '');
        step.board = diagram(s).split('\n');
        step.groups = info;
      }
      for (const issue of step.issues) issues.push(`move ${n} (${who} ${name(m)}): ${issue}`);
      steps.push(step);
      c = E.other(c);
    });
    totalMoves += g.moves.length;

    // Final board.
    const dead = AI.estimateDead(board, s, { seed: g.seed || 1 });
    const sc = E.score(board, s, 0, dead, { prisoners: caps });
    const { groups } = E.analyze(board, s);
    const finalGroups = [];
    for (const fg of groups) {
      const isDead = fg.cells.some((x) => dead.has(x));
      // Alive groups must not be capturable by force; dead groups must be.
      const capturable = AI.canForceCapture(board, s, fg.cells, { depth: 9 });
      if (!isDead && capturable) issues.push(`final: ${colourName(fg.color)} group [${names(fg.cells)}] counted alive but can be captured by force`);
      if (isDead && !capturable) issues.push(`final: ${colourName(fg.color)} group [${names(fg.cells)}] marked dead but can't be captured by force`);
      finalGroups.push({ colour: colourName(fg.color), stones: fg.cells.map(name).sort(), status: isDead ? 'dead' : 'alive', capturableByForce: capturable });
    }
    const cleared = Uint8Array.from(s);
    for (const x of dead) cleared[x] = EMPTY;
    const neutral = [];
    for (let i = 0; i < board.size; i++) {
      if (cleared[i] !== EMPTY) continue;
      const t = sc.territory[i];
      if (!t) { neutral.push(name(i)); continue; }
      for (const nb of board.neighbors[i]) if (cleared[nb] !== EMPTY && cleared[nb] !== t) issues.push(`final: territory cell ${name(i)} touches the other colour`);
    }
    for (const col of [BLACK, WHITE]) {
      const d = sc.detail[col];
      if (d.territory + d.captures + d.dead !== (col === BLACK ? sc.black : sc.white)) issues.push('final: score does not add up');
    }
    if (g.moves.length < 2 || g.moves.slice(-2).some((m) => m >= 0)) issues.push('final: game did not end with two passes');

    const finalMarks = new Map();
    for (const x of dead) finalMarks.set(x, s[x] === BLACK ? 'x' : 'o');
    for (let i = 0; i < board.size; i++) if (!cleared[i] && sc.territory[i] && !finalMarks.has(i)) finalMarks.set(i, sc.territory[i] === BLACK ? 'b' : 'w');
    out.push('==== Final board ====',
      'X/O stones · x/o dead stones (removed as captured) · b/w territory · . neutral', diagram(s, finalMarks), '');
    for (const fg of finalGroups) out.push(`  ${fg.colour.padEnd(5)} [${fg.stones.join(',')}]  ${fg.status}${fg.capturableByForce ? ' (capturable by force)' : ''}`);
    const part = (col) => { const d = sc.detail[col]; return `territory ${d.territory} + captured ${d.captures} + dead stones ${d.dead} = ${d.territory + d.captures + d.dead}`; };
    out.push('', `Black: ${part(BLACK)}`, `White: ${part(WHITE)}`, `Difference (B - W): ${sc.black - sc.white}`,
      `Neutral cells: ${neutral.join(',') || 'none'}`, '',
      issues.length ? 'ISSUES:\n' + issues.map((x) => '  - ' + x).join('\n') : 'No issues found.');
    fs.writeFileSync(path.join(stepsDir, `game${id}.txt`), out.join('\n') + '\n');
    fs.writeFileSync(path.join(stepsDir, `game${id}.json`), JSON.stringify({
      game: +id, side: rec.side, black: g.black, white: g.white, seed: g.seed, steps,
      final: { board: diagram(s, finalMarks).split('\n'), groups: finalGroups, dead: [...dead].map(name).sort(), neutral,
        score: { black: sc.black, white: sc.white, detail: { black: sc.detail[BLACK], white: sc.detail[WHITE] } } },
      issues }, null, 1));
    totalIssues += issues.length;
    audit.push({ id, moves: g.moves.length, diff: sc.black - sc.white, neutral: neutral.length, dead: dead.size, issues });
  }
}

const md = [`# Rules audit: ${path.basename(dir)}`, '',
  `${audit.length} games, ${totalMoves} moves checked. Issues found: ${totalIssues}.`, '',
  'Every move: legal; main and reference engines agree; only enemy stones captured; each captured group had no liberty pair and fewer than 2 eye cells; every group left on the board is alive; no repeated position.',
  'Final board: alive groups survive a forced-capture search, dead groups can be captured by force, territory only borders its owner, scores add up, game ended with two passes.', '',
  '| Game | Moves | Difference (B − W) | Dead stones | Neutral cells | Issues |', '| --- | --- | --- | --- | --- | --- |',
  ...audit.map((a) => `| ${a.id} | ${a.moves} | ${a.diff > 0 ? '+' : ''}${a.diff} | ${a.dead} | ${a.neutral} | ${a.issues.length ? a.issues.join('; ') : 'none'} |`), ''];
fs.writeFileSync(path.join(dir, 'audit.md'), md.join('\n'));
console.log(md.join('\n'));
