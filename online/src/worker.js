// HexGo online play: a Cloudflare Worker with one Durable Object per game.
//
//   POST /games            { side, komi, colour, secret }  ->  { id }
//   GET  /games/<id>/ws    WebSocket for that game
//
// A game has two seats and no spectators. A browser proves which seat is its own with a secret
// it made up and keeps; the server stores only a hash of it. The server holds the list of moves
// and checks every move with the same rules engine as the site, so both players always see the
// same legal game. A game is deleted after KEEP_DAYS without activity.
//
// Messages from a player (JSON): { t: 'join', secret } first, then
//   { t: 'move', n, cell } | { t: 'pass', n }   n = number of entries in `moves` the player has seen
//   { t: 'toggle', cell }   after two passes: flip whether the group on `cell` counts as dead
//   { t: 'resume' }         after two passes: carry on playing
//   { t: 'resign' }
// Messages to a player: { t: 'state', ... } after every change, { t: 'error', message },
//   { t: 'full' } (both seats taken by others), { t: 'gone' } (no such game).
import { DurableObject } from 'cloudflare:workers';
import E from '../../HexGo-EdgeEyes/engine.js';

const PASS = -1, RESUME = -2; // entries in `moves` besides cell numbers
const SIDES = [4, 5, 6, 7];
const KEEP_DAYS = 2;
const SEATS = ['black', 'white'];

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function originAllowed(origin, env) {
  if (!origin) return true; // not a browser page (a test script, curl)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

function newId() {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => letters[b % letters.length]).join('');
}

async function hashOf(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Limits on new games. One visitor is one internet address.
const NEW_PER_MINUTE = 3, NEW_PER_DAY = 10, NEW_PER_DAY_EVERYONE = 1000;

// True if this request is within the named Cloudflare limit (see wrangler.toml).
async function allowed(limiter, key) {
  if (!limiter) return true; // no limiter when run on a developer's computer
  return (await limiter.limit({ key })).success;
}
const TOO_FAST = 'Too many new games. Try again later.';

const validSecret = (s) => typeof s === 'string' && s.length >= 16 && s.length <= 80;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
                   'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    if (!originAllowed(origin, env)) return json({ error: 'This page may not use the HexGo server.' }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (url.pathname === '/games' && request.method === 'POST') {
      // The address is scrambled together with today's date before it is counted, so the count
      // cannot be traced back to an address and means nothing the next day.
      const day = new Date().toISOString().slice(0, 10);
      const who = (await hashOf(visitor + '|' + day)).slice(0, 16);
      if (!(await env.LIMITER.get(env.LIMITER.idFromName('games-' + day)).take(who, day))) return json({ error: TOO_FAST }, 429, cors);
      const b = await request.json().catch(() => null);
      if (!b || !SIDES.includes(b.side) || typeof b.komi !== 'number' || !(b.komi >= 0 && b.komi <= 20) ||
          !SEATS.includes(b.colour) || !validSecret(b.secret)) return json({ error: 'Bad game settings.' }, 400, cors);
      const id = newId();
      await env.GAMES.get(env.GAMES.idFromName(id)).create({ id, side: b.side, komi: b.komi, colour: b.colour, secret: b.secret });
      return json({ id }, 201, cors);
    }

    const m = url.pathname.match(/^\/games\/([a-z0-9]{6,16})\/ws$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426, cors);
      if (!(await allowed(env.CONNECT_PER_VISITOR, visitor))) return json({ error: TOO_FAST }, 429, cors);
      return env.GAMES.get(env.GAMES.idFromName(m[1])).fetch(request);
    }
    return json({ error: 'Not found.' }, 404, cors);
  },
};

// The position after game.moves: { stones, toMove, passes, history }.
function position(game) {
  const board = E.createBoard(game.side);
  let stones = new Uint8Array(board.size), toMove = E.BLACK, passes = 0;
  const history = new Set([E.keyOf(stones)]);
  for (const m of game.moves) {
    if (m === RESUME) { passes = 0; continue; }
    if (m === PASS) passes++;
    else { stones = E.play(board, stones, m, toMove).stones; history.add(E.keyOf(stones)); passes = 0; }
    toMove = E.other(toMove);
  }
  return { board, stones, toMove, passes, history };
}

// Counts new games: per visitor per minute (in memory) and per visitor and overall per day (stored).
// There is one of these per date, and it deletes itself two days later.
export class Limiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.recent = new Map(); // visitor -> times of their new games in the last minute
  }

  async take(who, day) {
    const now = Date.now();
    let d = await this.ctx.storage.get('day');
    if (!d) { d = { day, total: 0, visitors: {} }; await this.ctx.storage.setAlarm(now + 2 * 86400000); }
    const times = (this.recent.get(who) || []).filter((t) => now - t < 60000);
    if (times.length >= NEW_PER_MINUTE || (d.visitors[who] || 0) >= NEW_PER_DAY || d.total >= NEW_PER_DAY_EVERYONE) return false;
    if (this.recent.size > 2000) this.recent.clear();
    times.push(now);
    this.recent.set(who, times);
    d.total++;
    d.visitors[who] = (d.visitors[who] || 0) + 1;
    await this.ctx.storage.put('day', d);
    return true;
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Lets a browser keep its connection open with 'ping' without waking the game up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async create({ id, side, komi, colour, secret }) {
    if (await this.ctx.storage.get('game')) return;
    const game = { id, side, komi, moves: [], toggles: [], resigned: null, seats: { black: null, white: null } };
    game.seats[colour] = await hashOf(secret);
    await this.save(game);
  }

  async save(game) {
    await this.ctx.storage.put('game', game);
    await this.ctx.storage.setAlarm(Date.now() + KEEP_DAYS * 86400000);
  }

  async alarm() { await this.ctx.storage.deleteAll(); }

  async fetch() {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  seatOf(ws) { return (ws.deserializeAttachment() || {}).seat || null; }

  // Sends every player the game as it now stands. `leaving` is a socket that is closing.
  broadcast(game, leaving) {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== leaving);
    const present = { black: false, white: false };
    for (const s of sockets) { const seat = this.seatOf(s); if (seat) present[seat] = true; }
    for (const s of sockets) {
      const you = this.seatOf(s);
      if (!you) continue;
      try {
        s.send(JSON.stringify({ t: 'state', id: game.id, side: game.side, komi: game.komi, moves: game.moves, toggles: game.toggles,
          resigned: game.resigned, seats: { black: !!game.seats.black, white: !!game.seats.white }, present, you }));
      } catch (e) { /* that socket has gone; its close event follows */ }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 500) return; // every real message is far shorter
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    const game = await this.ctx.storage.get('game');
    if (!game) { ws.send(JSON.stringify({ t: 'gone' })); ws.close(4004, 'No such game'); return; }

    if (msg.t === 'join') {
      if (!validSecret(msg.secret)) return;
      const h = await hashOf(msg.secret);
      let seat = SEATS.find((s) => game.seats[s] === h);
      if (!seat) {
        seat = SEATS.find((s) => !game.seats[s]);
        if (!seat) { ws.send(JSON.stringify({ t: 'full' })); ws.close(4001, 'Game is full'); return; }
        game.seats[seat] = h;
        await this.save(game);
      }
      ws.serializeAttachment({ seat });
      this.broadcast(game);
      return;
    }

    const seat = this.seatOf(ws);
    if (!seat) return;
    const error = this.apply(game, seat, msg);
    if (error) { ws.send(JSON.stringify({ t: 'error', message: error })); this.broadcast(game); return; }
    await this.save(game);
    this.broadcast(game);
  }

  // Changes `game` as `seat` asks. Returns a message for the player if that is not allowed.
  apply(game, seat, msg) {
    const colour = seat === 'black' ? E.BLACK : E.WHITE;
    if (game.resigned) return 'The game is over.';
    const pos = position(game);
    const ended = pos.passes >= 2;
    switch (msg.t) {
      case 'move':
      case 'pass': {
        if (ended) return 'The game is over.';
        if (msg.n !== game.moves.length) return 'The board changed before your move arrived.';
        if (pos.toMove !== colour) return 'It is not your turn.';
        if (msg.t === 'pass') { game.moves.push(PASS); return null; }
        if (!Number.isInteger(msg.cell) || msg.cell < 0 || msg.cell >= pos.board.size) return 'No such cell.';
        const r = E.play(pos.board, pos.stones, msg.cell, colour, pos.history);
        if (!r.ok) return { occupied: 'That cell is taken.', suicide: 'Not allowed: that stone would be captured at once.',
                            ko: 'Not allowed: it would repeat an earlier position.' }[r.reason];
        game.moves.push(msg.cell);
        return null;
      }
      case 'toggle':
        if (!ended) return 'Stones can only be marked dead once the game has ended.';
        if (!Number.isInteger(msg.cell) || !pos.stones[msg.cell]) return 'There is no stone there.';
        if (game.toggles.length >= 500) return 'Too many changes.';
        game.toggles.push(msg.cell);
        return null;
      case 'resume':
        if (!ended) return 'The game has not ended.';
        game.moves.push(RESUME);
        game.toggles = [];
        return null;
      case 'resign':
        if (ended) return 'The game is over.';
        game.resigned = seat;
        return null;
      default:
        return 'Unknown request.';
    }
  }

  async webSocketClose(ws) { await this.left(ws); }
  async webSocketError(ws) { await this.left(ws); }
  async left(ws) {
    const game = await this.ctx.storage.get('game');
    if (game) this.broadcast(game, ws);
  }
}
