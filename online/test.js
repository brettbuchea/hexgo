// Plays a short game against a running server and checks its answers.
// Usage: npm run dev (in another terminal), then node test.js [server address]
const base = process.argv[2] || 'http://127.0.0.1:8787';
const wsBase = base.replace(/^http/, 'ws');
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const secret = (n) => `test-secret-${n}-0123456789abcdef`;

function player(id, n) {
  const ws = new WebSocket(`${wsBase}/games/${id}/ws`);
  const p = { ws, last: null, state: null, waiters: [] };
  ws.onmessage = (e) => {
    if (e.data === 'pong') { p.pong = true; return; }
    const m = JSON.parse(e.data);
    p.last = m;
    if (m.t === 'state') p.state = m;
    for (const w of p.waiters.splice(0)) w(m);
  };
  p.next = () => new Promise((r) => p.waiters.push(r));
  p.send = (m) => { const n = p.next(); ws.send(JSON.stringify(m)); return n; };
  p.open = new Promise((r) => { ws.onopen = r; }).then(() => p.send({ t: 'join', secret: secret(n) }));
  return p;
}
const settle = () => new Promise((r) => setTimeout(r, 150));

(async () => {
  let r = await fetch(`${base}/games`, { method: 'POST', body: JSON.stringify({ side: 9, komi: 6, colour: 'black', secret: secret(1) }) });
  check(r.status === 400, 'a board size that is not offered is refused');
  r = await fetch(`${base}/games`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' });
  check(r.status === 403, 'a page from another site is refused');
  r = await fetch(`${base}/games`, { method: 'POST', body: JSON.stringify({ side: 4, komi: 6, colour: 'white', secret: secret(1) }) });
  const { id } = await r.json();
  check(r.status === 201 && /^[a-z0-9]{10}$/.test(id), `game created (${id})`);

  const a = player(id, 1); await a.open;
  check(a.state.you === 'white' && a.state.seats.white && !a.state.seats.black, 'creator has the white seat, black is empty');
  const b = player(id, 2); await b.open; await settle();
  check(b.state.you === 'black' && a.state.seats.black && a.state.present.black, 'friend takes the black seat and both are told');
  const c = player(id, 3); await c.open;
  check(c.last.t === 'full', 'a third browser is turned away');
  await settle(); // the two players are told again when the third connection closes

  let m = await a.send({ t: 'move', n: 0, cell: 18 });
  check(m.t === 'error' && /not your turn/.test(m.message), 'white cannot move first');
  await settle();
  await b.send({ t: 'move', n: 0, cell: 18 }); await settle();
  check(a.state.moves.length === 1 && a.state.moves[0] === 18, 'black moves and white sees it');
  m = await a.send({ t: 'move', n: 1, cell: 18 });
  check(m.t === 'error' && /taken/.test(m.message), 'an occupied cell is refused');
  await settle();
  m = await a.send({ t: 'move', n: 0, cell: 5 });
  check(m.t === 'error' && /changed/.test(m.message), 'a move based on an old board is refused');
  await settle();
  // White plays in a corner; black captures it with one stone on the middle neighbour (cells 0, 5 on 4 per side).
  await a.send({ t: 'move', n: 1, cell: 0 }); await settle();
  await b.send({ t: 'move', n: 2, cell: 5 }); await settle();
  m = await a.send({ t: 'move', n: 3, cell: 0 });
  check(m.t === 'error' && /captured at once/.test(m.message), 'the corner stone was captured, and playing there again is suicide');
  await settle();
  await a.send({ t: 'move', n: 3, cell: 30 }); await settle();
  check(b.state.moves.length === 4, 'white plays elsewhere');
  m = await b.send({ t: 'toggle', cell: 18 });
  check(m.t === 'error', 'stones cannot be marked dead during play');
  await settle();

  // Reconnect with the same secret: same seat, same game.
  a.ws.close(); await settle();
  check(b.state.present.white === false, 'the friend is told when a player leaves');
  const a2 = player(id, 1); await a2.open;
  check(a2.state.you === 'white' && a2.state.moves.length === 4, 'coming back with the same secret gives the same seat and game');

  await b.send({ t: 'pass', n: 4 }); await settle();
  await a2.send({ t: 'pass', n: 5 }); await settle();
  m = await b.send({ t: 'move', n: 6, cell: 20 });
  check(m.t === 'error' && /over/.test(m.message), 'no moves after two passes');
  await settle();
  await b.send({ t: 'toggle', cell: 18 }); await settle();
  check(a2.state.toggles.length === 1, 'a dead-stone change reaches both players');
  await a2.send({ t: 'resume' }); await settle();
  check(b.state.moves[6] === -2 && b.state.toggles.length === 0, 'play can be resumed');
  await b.send({ t: 'move', n: 7, cell: 20 }); await settle();
  check(a2.state.moves.length === 8, 'and continues with the player whose turn it was');
  await a2.send({ t: 'resign' }); await settle();
  check(b.state.resigned === 'white', 'resignation ends the game');

  b.pong = false; b.ws.send('ping'); await settle();
  check(b.pong, 'ping is answered');

  const d = player('zzzzzzzzzz', 4); await d.open;
  check(d.last.t === 'gone', 'an unknown game says so');
  for (const p of [a2, b]) p.ws.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
