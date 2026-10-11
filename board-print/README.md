# Printed board

A 3D-printed HexGo board for standard Go stones: design notes and the script that builds the model.

## Decided

- **Printer:** 256 x 256 mm bed (height is not a limit). The board may be printed in pieces.
- **Stones:** Japanese style, rounded on both sides. Not measured yet; designing for the
  standard size, about 22 mm across (black about 22.2 mm) and 8-10 mm thick.
- **Cells:** 24 mm centre to centre (stone + 2 mm gap).
- **Dish:** every cell has a shallow dish in the middle for the stone to rest in, about 14 mm
  wide and a little over 1 mm deep, curved slightly flatter than the underside of a stone so it
  sits on its centre and tips up when its edge is pressed.
- **Cell outlines:** thin engraved lines, no raised ridges.
- **Joints:** pieces are cut along cell outlines, so their zigzag edges key into each other.

## Open

- **Board size.** It decides how the board is cut:

  | Per side | Layout | Pieces | Board size |
  | --- | --- | --- | --- |
  | 5 | one piece | 1 | 216 x 194 mm |
  | 6 or 7 | centre cell + 3 slanted blocks of (n-1) x n cells | 4 | up to 312 x 277 mm |
  | 8 to 11 | centre cell + 6 triangular wedges, n-1 cells a side | 7 | up to 504 x 443 mm |

  Six per side misses fitting in one piece by about 14 mm; at a 23 mm cell it is 253 mm wide,
  too tight for the bed.
- **Stone measurements** (diameter and thickness), to size the cells and dish exactly.
- Layer height: a dish this shallow shows steps; 0.1-0.12 mm layers should keep it smooth.

## Files

- `board.py` — builds the board as an STL file, with preview pictures, in `out/`. Needs the
  Python packages in `.venv` (`python3 -m venv .venv && .venv/bin/pip install manifold3d numpy matplotlib`):
  `.venv/bin/python board.py --side 5 --cell 24`
- `out/hexgo-board-5.stl` — the 5-per-side board in one piece, 222 x 200 x 5 mm.
- `out/hexgo-board-7-block-A.stl`, `-B`, `-C` — a first draft of the 7-per-side board as three
  blocks (`board.py --side 7 --layout blocks`), each about 222 x 158 mm, one per print. Block A
  holds the centre cell. Dovetail tabs in the lower half of the slab join them: B has tabs on
  both seams, C has tabs into A and sockets for B, A has only sockets. Assemble B, then C, then A.
  The tab fit (0.15 mm) is untested, and the rim is slightly ragged where a seam meets it.
- `sizing.js` — which board sizes fit the bed, whole or in pieces:
  `node sizing.js --stone 22 --gap 2 --bed 256 --margin 3`
