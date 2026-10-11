// Computer-vs-computer matches.
// Usage: node tools/match.js --side 5 --games 20 --black mcts:1000 --white random --komi 6
// Players: random | mcts:<playouts> | old:<playouts> | win:<playouts>. Colours alternate each game when --swap is given.
const E = require('../engine.js');
const AI = require('../ai.js')(E);
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((a) => { const [k, ...v] = a.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
// 'old:<playouts>' is the first version of the AI (no eye protection, win/loss only), and
// 'win:<playouts>' plays to win rather than for points (with dynamic komi), for comparison.
const parse = (s) => s === 'random' ? { type: 'random', name: s }
  : s.startsWith('old:') ? { type: 'mcts', playouts: +s.split(':')[1], name: s, options: { eyeSize: 0, scoreWeight: 0 } }
  : s.startsWith('win:') ? { type: 'mcts', playouts: +s.split(':')[1], name: s, options: { scoreWeight: 0.1, dynamicKomi: true } }
  : { type: 'mcts', playouts: +s.split(':')[1], name: s };
const side = +(args.side || 5), games = +(args.games || 10), komi = +(args.komi ?? 6), seed0 = +(args.seed || 0);
const A = parse(args.black || 'mcts:500'), B = parse(args.white || 'random');
const tally = { [A.name + ' (A)']: 0, [B.name + ' (B)']: 0, draws: 0 };
let blackWins = 0, totalMargin = 0, totalMoves = 0;
const records = []; // written to --out as JSON when given
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const swap = args.swap && g % 2 === 1;
  const [bl, wh] = swap ? [B, A] : [A, B];
  const res = AI.playGame(side, bl, wh, { komi, seed: seed0 + g + 1 });
  const pts = { black: res.score.black, white: res.score.white - komi }; // territory + prisoners, before komi
  if (res.winner === null) tally.draws++;
  else tally[(res.winner === E.BLACK) !== !!swap ? A.name + ' (A)' : B.name + ' (B)']++;
  if (res.winner === E.BLACK) blackWins++;
  totalMargin += res.margin; totalMoves += res.moves.length;
  records.push({ seed: seed0 + g + 1, black: bl.name, white: wh.name, moves: res.moves, stones: Array.from(res.stones), black_points: pts.black, white_points: pts.white, scoring: 'territory' });
  console.log(`game ${g + 1}: Black=${bl.name} White=${wh.name} -> ${res.winner === null ? 'Draw' : (res.winner === E.BLACK ? 'Black' : 'White') + ' by ' + Math.abs(res.margin)} (${res.moves.length} moves)  points: Black ${pts.black} White ${pts.white} diff ${pts.black - pts.white}`);
}
console.log(`\nside ${side}, komi ${komi}, ${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('wins:', tally);
console.log(`Black won ${blackWins}/${games}; mean Black margin before komi ${(totalMargin / games + komi).toFixed(1)}; mean length ${(totalMoves / games).toFixed(0)} moves`);
if (args.out) require('fs').writeFileSync(args.out, JSON.stringify({ side, komi, games: records }));
