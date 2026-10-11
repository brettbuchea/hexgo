# HexGo

Go on a hexagonal board. A group needs a liberty pair (two touching empty cells) or a pair of
eyes to stay on the board, and the edge of the board helps close off eyes. Play it at
https://brettbuchea.github.io/hexgo/.

| Folder | What it holds |
| --- | --- |
| `HexGo-EdgeEyes/` | The rules engine, the computer players (Monte Carlo tree search), the tools used to test the rules, and recorded computer games (`results/`). Its README lists the tools. |
| `site/` | The website: play the computer or a friend, watch two computers, and learn the rules with live diagrams. `node site/build.js` writes the public page to `docs/index.html`. |
| `online/` | The server for online play between two friends (a Cloudflare Worker). |
| `docs/` | The built website, served by GitHub Pages. |
| `board-print/` | Design notes, sizing and the model script for a 3D-printed board. |
