// Builds contact-sheet.png for a results folder: every gameNN.svg on one page, five per row,
// under a heading with the match settings and the overall result.
// Run after tools/report.js (needs its gameNN.svg, summary.csv and sizes.txt). Uses headless Chrome.
// Usage: node tools/contact-sheet.js <results folder>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/contact-sheet.js <results folder>'); process.exit(1); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sizes = fs.readFileSync(path.join(dir, 'sizes.txt'), 'utf8').trim().split('\n').map((l) => {
  const [name, w, h] = l.split(/\s+/);
  return { name, w: +w, h: +h };
});
const lines = fs.readFileSync(path.join(dir, 'summary.csv'), 'utf8').trim().split('\n');
const head = lines[0].split(',');
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], +v])));
const rawDir = path.join(dir, 'raw');
const recs = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(rawDir, f))));
const side = recs[0].side, cells = 3 * side * (side - 1) + 1;

const LEVELS = { 200: 'Easy', 1000: 'Medium', 4000: 'Hard', 10000: 'Very hard' };
const sims = (name) => +name.split(':')[1];
const label = (name) => name === 'random' ? 'Random' : LEVELS[sims(name)] || `${sims(name).toLocaleString('en-US')} sims`;
// The two players, in the order of the first game (colours may swap between games).
const players = [recs[0].games[0].black, recs[0].games[0].white];
const simsText = players.every((p) => p === 'random') ? null
  : players[0] === players[1] ? `${sims(players[0]).toLocaleString('en-US')} simulations per move`
  : players.map((p) => p === 'random' ? 'random' : sims(p).toLocaleString('en-US')).join(' vs ') + ' simulations per move';

const n = rows.length, diffs = rows.map((r) => r.difference_black_minus_white);
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sgn = (x) => (x > 0 ? '+' : '') + x;
const wins = (f) => diffs.filter(f).length, draws = wins((d) => d === 0);

const title = `HexGo Edge Eyes: ${label(players[0])} vs ${label(players[1])}, ${n} game${n === 1 ? '' : 's'} on ${side} per side`;
const sub = [simsText, `${cells} cells`, 'edge areas are eyes, no edge wrap-around', 'territory scoring', 'no komi',
  `Black won ${wins((d) => d > 0)}, White won ${wins((d) => d < 0)}${draws ? `, ${draws} drawn` : ''}`,
  `median ${sgn(median(diffs))}, mean ${sgn(+mean(diffs).toFixed(1))}`,
  `mean ${+mean(rows.map((r) => r.moves)).toFixed(1)} moves`].filter(Boolean).join(' · ');

// Fixed layout in CSS pixels so the page height is known before the screenshot is taken.
const W = 1300, PAD = 10, GAP = 5, COLS = 5, HEAD = 46, CARD_PAD = 6;
const cardW = (W - 2 * PAD - (COLS - 1) * GAP) / COLS, imgW = cardW - 2 * CARD_PAD - 2;
const cardH = Math.ceil(Math.max(...sizes.map((s) => imgW * s.h / s.w)) + 2 * CARD_PAD + 2);
const rowsN = Math.ceil(sizes.length / COLS);
const H = PAD + HEAD + rowsN * cardH + (rowsN - 1) * GAP + PAD;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: ${PAD}px; width: ${W}px; background: #f2ede6; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #2b2620; }
  header { height: ${HEAD}px; }
  h1 { margin: 0; font-size: 15px; line-height: 20px; }
  p { margin: 0; font-size: 11px; line-height: 16px; color: #7a6f60; white-space: nowrap; overflow: hidden; }
  main { display: grid; grid-template-columns: repeat(${COLS}, ${cardW}px); grid-auto-rows: ${cardH}px; gap: ${GAP}px; }
  div { padding: ${CARD_PAD}px; background: #fffaf2; border: 1px solid #e0d6c6; border-radius: 4px; }
  img { display: block; width: 100%; }
</style>
<header><h1>${esc(title)}</h1><p>${esc(sub)}</p></header>
<main>${sizes.map((s) => `<div><img src="${s.name}.svg"></div>`).join('')}</main>
`;

const abs = path.resolve(dir), page = path.join(abs, 'contact-sheet.html'), out = path.join(abs, 'contact-sheet.png');
fs.writeFileSync(page, html);
try {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${W},${H}`, `--screenshot=${out}`, 'file://' + page], { stdio: 'ignore' });
} finally {
  fs.unlinkSync(page);
}
console.log(`${path.join(dir, 'contact-sheet.png')}: ${sizes.length} games, ${W * 2}x${H * 2}`);
