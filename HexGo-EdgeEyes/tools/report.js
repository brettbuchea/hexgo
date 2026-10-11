// Builds a results folder from saved game records (match.js --out files):
//   gameNN.svg  final board with territory shading and a caption
//   summary.csv / summary.md  points per colour, difference and length of every game
// Usage: node tools/report.js <folder containing raw/*.json>
// PNG copies are made separately (see tools/render-png.sh).
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const AI = require('../ai.js')(E);
const { BLACK, WHITE } = E;

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/report.js <results folder>'); process.exit(1); }
const rawDir = path.join(dir, 'raw');
const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'))
  .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));

const COLORS = { edge: '#b9965e', wood: '#e2c48f', line: '#9c7c48', terrB: '#7d6643', terrW: '#f4e6c6',
  black: '#1d1b19', white: '#fbfaf7', stoneEdge: '#6b6157', ink: '#2b2620', muted: '#7a6f60', bg: '#fffaf2' };

function boardSvg(board, stones, sc, title, lines) {
  const R = 26, side = board.side, pad = R * 1.2;
  const w = Math.max(600, Math.ceil(R * Math.sqrt(3) * (2 * side - 1) + pad * 2)); // wide enough for the caption
  const bh = Math.ceil(R * 1.5 * (2 * side - 2) + 2 * R + pad * 2);
  const capH = 34 + 22 * lines.length, h = bh + capH;
  const cx0 = w / 2, cy0 = capH + bh / 2;
  const centre = ([q, r]) => [cx0 + R * Math.sqrt(3) * (q + r / 2), cy0 + R * 1.5 * r];
  const hexPts = (cx, cy, rad, off) => Array.from({ length: 6 }, (_, k) => {
    const a = Math.PI / 180 * (60 * k + off);
    return (cx + rad * Math.cos(a)).toFixed(1) + ',' + (cy + rad * Math.sin(a)).toFixed(1);
  }).join(' ');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system, Helvetica, Arial, sans-serif">`,
    `<rect width="${w}" height="${h}" fill="${COLORS.bg}"/>`,
    `<text x="16" y="28" font-size="18" font-weight="700" fill="${COLORS.ink}">${title}</text>`];
  lines.forEach((l, k) => out.push(`<text x="16" y="${52 + 22 * k}" font-size="14" fill="${k ? COLORS.muted : COLORS.ink}">${l}</text>`));
  out.push(`<polygon points="${hexPts(cx0, cy0, R * Math.sqrt(3) * (side - 0.5) + R * 0.6, 0)}" fill="${COLORS.edge}"/>`);
  board.cells.forEach((c, i) => {
    const [x, y] = centre(c);
    const t = sc.territory[i];
    out.push(`<polygon points="${hexPts(x, y, R, -30)}" fill="${t === BLACK ? COLORS.terrB : t === WHITE ? COLORS.terrW : COLORS.wood}" stroke="${COLORS.line}" stroke-width="1"/>`);
    const dead = sc.deadCells && sc.deadCells.has(i);
    const op = dead ? ' opacity="0.4"' : '';
    if (stones[i] === BLACK) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(R * 0.78).toFixed(1)}" fill="${COLORS.black}"${op}/>`);
    if (stones[i] === WHITE) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(R * 0.78).toFixed(1)}" fill="${COLORS.white}" stroke="${COLORS.stoneEdge}" stroke-width="1"${op}/>`);
    if (dead) { // dead stones: faded with a red cross; scored as prisoners for the other side
      const d = R * 0.32;
      out.push(`<path d="M${(x - d).toFixed(1)} ${(y - d).toFixed(1)}L${(x + d).toFixed(1)} ${(y + d).toFixed(1)}M${(x - d).toFixed(1)} ${(y + d).toFixed(1)}L${(x + d).toFixed(1)} ${(y - d).toFixed(1)}" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/>`);
    }
  });
  out.push('</svg>');
  return { svg: out.join('\n'), w, h };
}

const LEVELS = { 200: 'Easy', 1000: 'Medium', 4000: 'Hard', 10000: 'Very hard' };
const label = (name) => {
  if (name === 'random') return 'Random';
  const sims = +name.split(':')[1];
  return LEVELS[sims] || `${sims.toLocaleString('en-US')} sims`;
};

const rows = [];
let n = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(rawDir, f)));
  const board = E.createBoard(rec.side);
  for (const g of rec.games) {
    n++;
    // Replay to count captures and confirm the saved final position.
    let s = new Uint8Array(board.size), c = BLACK;
    const caps = { [BLACK]: 0, [WHITE]: 0 };
    for (const m of g.moves) {
      if (m >= 0) { const r = E.play(board, s, m, c); s = r.stones; caps[c] += r.captured.length; }
      c = E.other(c);
    }
    if (E.keyOf(s) !== E.keyOf(Uint8Array.from(g.stones))) throw new Error('replay mismatch in ' + f);
    // Territory scoring: territory + prisoners (captures, plus dead stones found automatically).
    const deadCells = AI.estimateDead(board, s, { seed: g.seed || 1 });
    const sc = Object.assign(E.score(board, s, 0, deadCells, { prisoners: caps }), { deadCells });
    const diff = sc.black - sc.white;
    const part = (c) => { const d = sc.detail[c]; return `territory ${d.territory} + captured ${d.captures} + stones in territory ${d.dead} = ${d.territory + d.captures + d.dead}`; };
    const result = diff === 0 ? 'Draw' : `${diff > 0 ? 'Black' : 'White'} +${Math.abs(diff)}`;
    const id = String(n).padStart(2, '0');
    const { svg, w, h } = boardSvg(board, s, sc, `Game ${n}: ${result}`, [
      `Black ${sc.black} · White ${sc.white} · difference ${diff > 0 ? '+' : ''}${diff} (before komi)`,
      `Black: ${part(BLACK)}`,
      `White: ${part(WHITE)}`,
      `${g.moves.length} moves${sc.deadCells.size ? ' · ✕ = stone in enemy territory, counted as captured' : ''}`,
      `${label(g.black)} vs ${label(g.white)} · ${rec.side} per side · no komi`,
    ]);
    fs.writeFileSync(path.join(dir, `game${id}.svg`), svg);
    rows.push({ game: n, black: sc.black, white: sc.white, diff, moves: g.moves.length, capB: caps[BLACK], capW: caps[WHITE], seed: g.seed, w, h,
      terrB: sc.detail[BLACK].territory, terrW: sc.detail[WHITE].territory, deadB: sc.detail[BLACK].dead, deadW: sc.detail[WHITE].dead });
  }
}

fs.writeFileSync(path.join(dir, 'summary.csv'),
  'game,black_points,white_points,difference_black_minus_white,moves,black_captured,white_captured,seed,black_territory,white_territory,black_dead_prisoners,white_dead_prisoners\n' +
  rows.map((r) => [r.game, r.black, r.white, r.diff, r.moves, r.capB, r.capW, r.seed, r.terrB, r.terrW, r.deadB, r.deadW].join(',')).join('\n') + '\n');
const median = (k) => {
  const v = rows.map((r) => r[k]).sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const sgn = (x) => (x > 0 ? '+' : '') + x;
const md = ['Territory scoring, no komi. Each colour: territory + stones captured during the game + enemy stones left in its territory at the end (counted as captured) = total.', '',
  '| Game | Black territory | Black captured | Black: stones in territory | **Black total** | White territory | White captured | White: stones in territory | **White total** | Difference (B − W) | Moves |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.game} | ${r.terrB} | ${r.capB} | ${r.deadB} | **${r.black}** | ${r.terrW} | ${r.capW} | ${r.deadW} | **${r.white}** | ${sgn(r.diff)} | ${r.moves} |`),
  `| **Median** | ${median('terrB')} | ${median('capB')} | ${median('deadB')} | **${median('black')}** | ${median('terrW')} | ${median('capW')} | ${median('deadW')} | **${median('white')}** | **${sgn(median('diff'))}** | ${median('moves')} |`,
  `| **Average** | ${avg('terrB').toFixed(1)} | ${avg('capB').toFixed(1)} | ${avg('deadB').toFixed(1)} | **${avg('black').toFixed(1)}** | ${avg('terrW').toFixed(1)} | ${avg('capW').toFixed(1)} | ${avg('deadW').toFixed(1)} | **${avg('white').toFixed(1)}** | **${sgn(+avg('diff').toFixed(1))}** | ${avg('moves').toFixed(1)} |`];
fs.writeFileSync(path.join(dir, 'summary.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'sizes.txt'), rows.map((r) => `game${String(r.game).padStart(2, '0')} ${r.w} ${r.h}`).join('\n') + '\n');
console.log(md.join('\n'));
