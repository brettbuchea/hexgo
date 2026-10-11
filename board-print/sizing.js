// Sizing for a 3D-printed HexGo board: which board sizes fit the printer, whole or in pieces.
// Usage: node sizing.js [--stone 22] [--gap 2] [--bed 256] [--margin 3]
//   stone   diameter of a Go stone, mm
//   gap     space between neighbouring stones, mm (room for the ridge between cells)
//   bed     printable width and depth, mm
//   margin  bed kept clear on every side, mm
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((a) => { const [k, v] = a.trim().split(/\s+/); return [k, +v]; }));
const stone = args.stone ?? 22, gap = args.gap ?? 2, bed = args.bed ?? 256, margin = args.margin ?? 3;
const p = stone + gap;           // cell size: centre to centre, and flat side to flat side
const usable = bed - 2 * margin;
const ROW = Math.sqrt(3) / 2;    // row spacing, in cells
const TALL = 2 / Math.sqrt(3);   // height of one cell point to point, in cells

// Bounding box in mm of a block of cells: `across` cell-widths wide, `rows` rows tall.
const box = (across, rows) => [across * p, ((rows - 1) * ROW + TALL) * p];
const fits = ([w, h]) => Math.max(w, h) <= usable;
const mm = ([w, h]) => `${w.toFixed(0)} x ${h.toFixed(0)}`;

// Ways to cut a board with `n` cells per side (3n(n-1)+1 cells).
const layouts = {
  // The whole board: 2n-1 cells across the middle row, 2n-1 rows.
  'one piece': (n) => ({ pieces: 1, box: box(2 * n - 1, 2 * n - 1) }),
  // Centre cell plus 3 slanted blocks of (n-1) x n cells.
  '3 blocks + centre': (n) => ({ pieces: 4, box: box(n + (n - 2) / 2, n - 1) }),
  // Centre cell plus 6 triangles with n-1 cells along each side.
  '6 wedges + centre': (n) => ({ pieces: 7, box: box(n - 1, n - 1) }),
};

console.log(`stone ${stone} mm + gap ${gap} mm = cell ${p} mm; bed ${bed} mm with ${margin} mm kept clear = ${usable} mm usable\n`);
console.log('per side | cells | whole board (mm) | ' + Object.keys(layouts).map((k) => k.padEnd(22)).join('| '));
for (let n = 3; n <= 13; n++) {
  const whole = box(2 * n - 1, 2 * n - 1);
  const cols = Object.values(layouts).map((f) => { const l = f(n); return ((fits(l.box) ? 'fits  ' : 'no    ') + mm(l.box)).padEnd(22); });
  console.log(`${String(n).padStart(8)} | ${String(3 * n * (n - 1) + 1).padStart(5)} | ${mm(whole).padEnd(16)} | ${cols.join('| ')}`);
}
console.log('\nLargest board per layout:');
for (const [name, f] of Object.entries(layouts)) {
  let best = 0;
  for (let n = 2; n <= 40; n++) if (fits(f(n).box)) best = n;
  console.log(`  ${name}: ${best} per side, ${f(best).pieces} piece(s), board ${mm(box(2 * best - 1, 2 * best - 1))} mm`);
}
