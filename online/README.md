# HexGo online play

The small server behind Play → Online on the website: a Cloudflare Worker with one Durable
Object per game. It keeps each game's list of moves, checks every move with the same rules
engine as the site (`../HexGo-EdgeEyes/engine.js`), and passes moves between the two players
over WebSockets.

- A game has two seats and no spectators. Whoever creates it picks a colour and gets a link
  (`.../hexgo/#g-<id>`); the first other browser to open the link takes the other seat.
- No accounts. Each browser makes up a secret for the game and keeps it; that is what gives it
  its seat back later. The server stores only a hash of it.
- After two passes either player can mark groups dead or resume play. A player can resign.
- A game is deleted after 2 days without a move.
- New games are limited to 3 a minute and 10 a day from one internet address, and 1,000 a day from
  everyone together. Addresses are counted in scrambled form and the counts are replaced each day.

## Files

- `src/worker.js` — the server.
- `wrangler.toml` — Cloudflare settings, including which website may use the server.
- `test.js` — plays a short game against a running server and checks its answers.

## Commands

    npm install
    npm run dev        # run the server on this computer, at http://127.0.0.1:8787
    npm test           # with the dev server running
    npm run deploy     # publish to Cloudflare (needs a token that may edit Workers)

After the first deploy, put the server's address in `../site/online.json`, for example
`{ "url": "https://hexgo-online.<name>.workers.dev" }`, then run `node ../site/build.js` and
push. Without that file the website keeps its Online option switched off.
