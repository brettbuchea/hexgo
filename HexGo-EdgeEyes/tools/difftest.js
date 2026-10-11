// Differential test: the fast engine must agree with the reference engine on every move
// of many random games, including all candidate moves at each position. The engine's fast
// place() and placeSurveyed() are checked against play() on the same moves.
const F = require('../engine.js'), R = require('./engine-reference.js');
let checks = 0, bad = 0;
for (const side of [3, 4, 5, 6]) {
  const bf = F.createBoard(side), br = R.createBoard(side);
  for (let game = 0; game < 40; game++) {
    let s = new Uint8Array(bf.size), c = 1;
    for (let mv = 0; mv < bf.size * 2; mv++) {
      const legal = [];
      for (let i = 0; i < bf.size; i++) {
        const a = F.play(bf, s, i, c), b = R.play(br, s, i, c);
        checks++;
        const same = a.ok === b.ok && (a.ok ? F.keyOf(a.stones) === R.keyOf(b.stones) : a.reason === b.reason);
        if (!same && bad++ < 5) console.log('mismatch', side, i, c, a.ok, b.ok, a.reason, b.reason);
        // The fast in-place move must give the same answer and the same position as play().
        const t = Uint8Array.from(s), fast = F.place(bf, t, i, c);
        checks++;
        if ((fast !== a.ok || F.keyOf(t) !== F.keyOf(a.ok ? a.stones : s)) && bad++ < 5) console.log('place mismatch', side, i, c, fast, a.ok);
        // So must the table-driven version, on tables made once for the position.
        const u = Uint8Array.from(s);
        if (i === 0) F.survey(bf, s);
        const fast2 = F.placeSurveyed(bf, u, i, c);
        checks++;
        if ((fast2 !== a.ok || F.keyOf(u) !== F.keyOf(a.ok ? a.stones : s)) && bad++ < 5) console.log('placeSurveyed mismatch', side, i, c, fast2, a.ok);
        if (a.ok) legal.push(a);
      }
      if (!legal.length) break;
      s = legal[Math.random() * legal.length | 0].stones;
      c = 3 - c;
    }
  }
}
console.log(checks + ' move checks, ' + bad + ' mismatches');
process.exit(bad ? 1 : 0);
