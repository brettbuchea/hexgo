// Draws the edge-eye catalogue (tools/edge-eyes.js output) as HTML pages for review.
// Keeps the layout with the fewest wall stones for each type (shape, edge or corner, which
// eyes touch the edge, result) and notes how many other variants of that type exist.
// Usage: node tools/edge-eyes-gallery.js <edge-eyes.json> <out folder>
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');

const [input, outDir] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(input));
const board = E.createBoard(data.side), R = data.side - 1;
const at = (q, r) => board.index.get(q + ',' + r);

const best = new Map(), count = new Map();
for (const r of data.results) {
  const k = [r.family, r.kind, r.edgeNote, r.status].join('|');
  count.set(k, (count.get(k) || 0) + 1);
  if (!best.has(k) || r.stones < best.get(k).stones) best.set(k, r);
}
const reps = [...best.entries()].map(([k, r]) => Object.assign({ variants: count.get(k) }, r));

const S = 18; // hex radius in px
const centre = ([q, r]) => [S * Math.sqrt(3) * (q + r / 2), S * 1.5 * r];
const corner = (x, y, k) => { const a = Math.PI / 180 * (60 * k - 30); return [x + S * Math.cos(a), y + S * Math.sin(a)]; };
// Pixel direction of each axial neighbour, to find the hex side facing it.
const sideAngle = { '1,0': 0, '1,-1': -60, '0,-1': -120, '-1,0': 180, '-1,1': 120, '0,1': 60 };

function svgFor(r) {
  const eyes = r.eyes.map(([q, rr]) => at(q, rr)), wall = r.wall.map(([q, rr]) => at(q, rr));
  const eyeSet = new Set(eyes), wallSet = new Set(wall);
  // Show the pattern plus two cells of surroundings.
  const show = new Set();
  for (const c of [...eyes, ...wall]) {
    show.add(c);
    for (const n of board.neighbors[c]) { show.add(n); for (const m of board.neighbors[n]) show.add(m); }
  }
  const pts = [...show].map((c) => centre(board.cells[c]));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = S * 1.3, minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
  const parts = [`<svg viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img">`];
  for (const c of show) {
    const [x, y] = centre(board.cells[c]);
    const poly = [0, 1, 2, 3, 4, 5].map((k) => corner(x, y, k).map((v) => v.toFixed(1)).join(',')).join(' ');
    const fill = eyeSet.has(c) ? 'var(--eye)' : 'var(--wood)';
    parts.push(`<polygon points="${poly}" fill="${fill}" stroke="var(--line)" stroke-width="1"/>`);
    if (wallSet.has(c)) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(S * 0.78).toFixed(1)}" fill="var(--stone)"/>`);
    // Thick line on every side that faces off the board.
    const [q, rr] = board.cells[c];
    for (const [dq, dr] of E.DIRS) {
      if (at(q + dq, rr + dr) !== undefined) continue;
      const a = sideAngle[dq + ',' + dr], k0 = Math.round((a + 30) / 60);
      const [x1, y1] = corner(x, y, k0 - 1 + 0), [x2, y2] = corner(x, y, k0);
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--edge)" stroke-width="5" stroke-linecap="round"/>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

const badge = { alive: ['Alive', 'ok'], 'alive if answered': ['Alive if defender answers', 'warn'], dead: ['Dead', 'bad'] };
function card(r) {
  const [label, cls] = badge[r.status];
  return `<article class="card"><div class="top"><span class="where">${r.kind === 'corner' ? 'Corner' : 'Straight edge'}</span><span class="badge ${cls}">${label}</span></div>` +
    svgFor(r) + `<p class="desc">${r.edgeNote}</p><p class="meta">${r.stones} wall stones${r.variants > 1 ? ` · ${r.variants} layouts of this type` : ''}</p></article>`;
}

const css = `:root{--bg:#f4efe6;--panel:#fffaf2;--ink:#2b2620;--muted:#7a6f60;--line:#9c7c48;--wood:#ead3a6;--eye:#bfe0b0;--stone:#1d1b19;--edge:#5b3f1c;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,Helvetica,Arial,sans-serif}
.wrap{padding:20px 22px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:22px 0 8px}.sub{color:var(--muted);margin:0 0 10px;max-width:1100px}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:6px 0 4px}.sw{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:5px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.card{background:var(--panel);border:1px solid #d9cdb8;border-radius:10px;padding:8px 10px}
.card svg{display:block;width:100%;height:150px}.top{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}
.badge{font-weight:700;font-size:12px}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.desc{margin:4px 0 0;font-size:13px}.meta{margin:2px 0 0;font-size:12px;color:var(--muted)}`;

const sections = [
  ['One eye of 3 cells', ['one eye: straight 3', 'one eye: bent 3', 'one eye: triangle 3']],
  ['Two eyes: 2 + 1', ['eyes 2 + 1']],
  ['Three single eyes: 1 + 1 + 1', ['eyes 1 + 1 + 1']],
  ['Triangle + 1', ['triangle 3 + 1']],
  ['Reference: too small to live', ['one eye: 2 (reference)', 'eyes 1 + 1 (reference)']],
];
const head = (title) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${css}</style><div class="wrap">`;
const legend = `<div class="legend"><span><span class="sw" style="background:var(--stone)"></span>Wall stones (fewest possible)</span><span><span class="sw" style="background:var(--eye)"></span>Eye cells</span><span><span class="sw" style="background:var(--edge)"></span>Board edge</span></div>`;
const intro = `<p class="sub">Edge areas count as eyes. Each group is assumed to have no liberties outside its wall, so only its eyes keep it alive. "Alive" means the attacker can't capture it even with unlimited free moves; "Dead" means the attacker kills it even when the defender replies. One example per type is shown: the one with the fewest wall stones.</p>`;

fs.mkdirSync(outDir, { recursive: true });
const pages = [['edge-eyes-1.html', 'HexGo edge eyes: single eyes and reference cases', [0, 4]], ['edge-eyes-2.html', 'HexGo edge eyes: two and three eyes', [1, 2, 3]]];
for (const [file, title, secIdx] of pages) {
  let html = head(title) + `<h1>${title}</h1>` + intro + legend;
  for (const i of secIdx) {
    const [name, fams] = sections[i];
    const rs = reps.filter((r) => fams.includes(r.family)).sort((a, b) => fams.indexOf(a.family) - fams.indexOf(b.family) || (a.kind > b.kind ? -1 : 1) || a.stones - b.stones);
    if (!rs.length) continue;
    html += `<h2>${name}</h2><div class="grid">${rs.map(card).join('')}</div>`;
  }
  fs.writeFileSync(path.join(outDir, file), html + '</div>');
}
console.log(reps.length + ' representative layouts drawn');
