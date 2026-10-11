// Summary statistics for a results folder, from the summary.csv that tools/report.js writes.
// Usage: node tools/stats.js <results folder>   (prints and writes <folder>/stats.md)
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/stats.js <results folder>'); process.exit(1); }
const lines = fs.readFileSync(path.join(dir, 'summary.csv'), 'utf8').trim().split('\n');
const head = lines[0].split(',');
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], +v])));
const n = rows.length;
const col = (k) => rows.map((r) => r[k]);

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sorted = (v) => [...v].sort((a, b) => a - b);
const quantile = (v, q) => { // linear interpolation between closest ranks
  const s = sorted(v), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };
const fmt = (x, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const signed = (x, d = 1) => (x > 0 ? '+' : '') + fmt(x, d);

const diff = col('difference_black_minus_white'), moves = col('moves');
const blackWins = diff.filter((d) => d > 0).length, whiteWins = diff.filter((d) => d < 0).length, draws = n - blackWins - whiteWins;
// Board size and scoring rule come from the saved game records.
const rawDir = path.join(dir, 'raw');
const firstRaw = JSON.parse(fs.readFileSync(path.join(rawDir, fs.readdirSync(rawDir).find((f) => f.endsWith('.json')))));
const side = firstRaw.side, cells = 3 * side * (side - 1) + 1;
const scoring = firstRaw.games[0].scoring === 'territory' ? 'territory scoring (territory + captures + dead stones)' : 'area scoring (stones + territory)';
const se = sd(diff) / Math.sqrt(n);

const out = [];
out.push(`# Statistics: ${path.basename(dir)}`, '');
out.push(`${n} games, ${side} per side (${cells} cells), ${scoring}, no komi. Difference is Black's points minus White's.`, '');
out.push('| Measure | Value |', '| --- | --- |');
out.push(`| Black wins | ${blackWins} (${(100 * blackWins / n).toFixed(0)}%) |`);
out.push(`| White wins | ${whiteWins} (${(100 * whiteWins / n).toFixed(0)}%) |`);
out.push(`| Draws | ${draws} |`);
out.push(`| Mean difference | ${signed(mean(diff), 2)} |`);
out.push(`| Median difference | ${signed(quantile(diff, 0.5))} |`);
out.push(`| 95% range for the true mean | ${signed(mean(diff) - 1.96 * se)} to ${signed(mean(diff) + 1.96 * se)} |`);
out.push(`| Standard deviation | ${fmt(sd(diff), 1)} |`);
out.push(`| Middle half of games (25th–75th percentile) | ${signed(quantile(diff, 0.25))} to ${signed(quantile(diff, 0.75))} |`);
out.push(`| Smallest / largest difference | ${signed(Math.min(...diff))} / ${signed(Math.max(...diff))} |`);
out.push(`| Mean Black points / White points | ${fmt(mean(col('black_points')), 1)} / ${fmt(mean(col('white_points')), 1)} |`);
out.push(`| Mean moves | ${fmt(mean(moves), 1)} |`);
out.push(`| Median moves | ${fmt(quantile(moves, 0.5))} |`);
out.push(`| Fewest / most moves | ${Math.min(...moves)} / ${Math.max(...moves)} |`);
out.push(`| Mean stones captured: Black / White | ${fmt(mean(col('black_captured')), 1)} / ${fmt(mean(col('white_captured')), 1)} |`);
out.push('');
out.push('## How often each difference occurred', '');
out.push('| Difference (B − W) | Games | Share |', '| --- | --- | --- |');
const counts = new Map();
for (const d of diff) counts.set(d, (counts.get(d) || 0) + 1);
for (const [d, c] of [...counts].sort((a, b) => b[0] - a[0])) out.push(`| ${signed(d)} | ${c} | ${(100 * c / n).toFixed(0)}% |`);
out.push('');
const text = out.join('\n');
fs.writeFileSync(path.join(dir, 'stats.md'), text);
console.log(text);
