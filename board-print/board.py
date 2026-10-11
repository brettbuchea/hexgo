"""Builds the printable HexGo board as STL files, plus preview pictures.

A flat slab in the shape of the board. Every cell has a shallow dish for a Go stone to rest in
and a thin engraved outline. All sizes are in millimetres.

--layout whole   the board in one piece
--layout blocks  three blocks that spiral round the centre (the centre cell belongs to block A),
                 joined by dovetail tabs hidden in the lower half of the slab. A tab sticks out
                 of one block at the bottom; the next block has a matching socket underneath and
                 is pressed down onto it. Assemble in the order B, C, A.

Usage: .venv/bin/python board.py [--side 5] [--layout whole] [--cell 24] [--out out]
"""
import argparse
import math
import os
import struct

import numpy as np
from manifold3d import CrossSection, JoinType, Manifold, OpType

ap = argparse.ArgumentParser()
ap.add_argument('--side', type=int, default=5, help='cells along each edge of the board')
ap.add_argument('--layout', choices=['whole', 'blocks'], default='whole')
ap.add_argument('--cell', type=float, default=24.0, help='cell size, centre to centre (stone + gap)')
ap.add_argument('--thick', type=float, default=5.0, help='thickness of the slab')
ap.add_argument('--border', type=float, default=3.0, help='rim outside the outer cells')
ap.add_argument('--dish-width', type=float, default=14.0, help='width of the dish in each cell')
ap.add_argument('--dish-radius', type=float, default=20.0, help='radius of the sphere the dish is cut from')
ap.add_argument('--line-width', type=float, default=0.8, help='width of the engraved cell outlines')
ap.add_argument('--line-depth', type=float, default=0.5, help='depth of the engraved cell outlines')
ap.add_argument('--seam', type=float, default=0.1, help='gap left between neighbouring pieces')
ap.add_argument('--tab-length', type=float, default=5.5, help='how far a tab reaches into the next piece')
ap.add_argument('--tab-neck', type=float, default=5.0, help='width of a tab where it leaves its piece')
ap.add_argument('--tab-head', type=float, default=8.0, help='width of a tab at its far end')
ap.add_argument('--tab-height', type=float, default=2.5, help='thickness of a tab, from the underside up')
ap.add_argument('--tab-fit', type=float, default=0.15, help='clearance round a tab inside its socket')
ap.add_argument('--bed', type=float, default=256.0, help='printer bed width and depth')
ap.add_argument('--out', default='out')
a = ap.parse_args()

R = a.side - 1
DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
# Cell centres, laid out as in the app: rows run left to right, pointy corners up and down.
centre = lambda q, r: (a.cell * (q + r / 2), -a.cell * math.sqrt(3) / 2 * r)
cells = [(q, r) for r in range(-R, R + 1) for q in range(-R, R + 1) if abs(q + r) <= R]
corner = a.cell / math.sqrt(3)  # centre of a cell to its corners


def hexagon(cell, corner_radius):
    cx, cy = centre(*cell)
    return CrossSection([[(cx + corner_radius * math.cos(math.radians(60 * k + 30)),
                           cy + corner_radius * math.sin(math.radians(60 * k + 30))) for k in range(6)]])


union = lambda shapes: CrossSection.batch_boolean(shapes, OpType.Add)
solid = lambda shape, height, z=0.0: Manifold.extrude(shape, height).translate([0, 0, z])

# ---------- The whole board ----------
all_cells = union([hexagon(c, corner + 0.01) for c in cells])
outline = all_cells.offset(a.border, JoinType.Round, circular_segments=48)
board = solid(outline, a.thick)

# Engraved outlines: a thin hexagonal ring round every cell.
half = a.line_width / 2 / math.cos(math.radians(30))  # ring half-width, measured at the corners
rings = union([hexagon(c, corner + half) - hexagon(c, corner - half) for c in cells])
board -= solid(rings, a.line_depth + 1, a.thick - a.line_depth)

# Dishes: the bottom of a sphere pressed into the top of each cell.
dish_depth = a.dish_radius - math.sqrt(a.dish_radius ** 2 - (a.dish_width / 2) ** 2)
ball = Manifold.sphere(a.dish_radius, 160)
board -= Manifold.batch_boolean(
    [ball.translate([*centre(*c), a.thick + a.dish_radius - dish_depth]) for c in cells], OpType.Add)

# ---------- Cutting it into pieces ----------
parts = []  # (label, solid, angle to turn it by on the bed)
if a.layout == 'whole':
    parts.append(('', board, 0))
else:
    # Six triangular wedges spiral round the centre cell; a block is two wedges next to each other.
    block_of = {(0, 0): 0}
    for k in range(1, R + 1):
        for i in range(6):
            q, r = DIRS[i][0] * k, DIRS[i][1] * k
            d = DIRS[(i + 2) % 6]
            for s in range(k):
                block_of[(q + d[0] * s, r + d[1] * s)] = i // 2
    mine = [union([hexagon(c, corner + 0.01) for c in cells if block_of[c] == j]) for j in range(3)]
    rim = outline - all_cells
    shapes = []
    for j in range(3):
        # A block's share of the rim is the part next to its own cells; where two blocks' shares
        # meet at the end of a seam, the sliver goes to the block before.
        own_rim = rim ^ mine[j].offset(a.border, JoinType.Round, circular_segments=48)
        own_rim -= mine[(j - 1) % 3].offset(a.border, JoinType.Round, circular_segments=48)
        shapes.append((mine[j] + own_rim).offset(-a.seam / 2, JoinType.Miter))

    # Tabs. Each seam belongs to the block that goes down first (order B, C, A = 1, 2, 0); its
    # tabs point across every other cell edge along the seam, starting one in from the centre.
    order = {1: 0, 2: 1, 0: 2}
    seams = {}
    for c in cells:
        for d in DIRS:
            n = (c[0] + d[0], c[1] + d[1])
            if n in block_of and order[block_of[c]] < order[block_of[n]]:
                seams.setdefault((block_of[c], block_of[n]), []).append((c, n))
    tabs = {j: [] for j in range(3)}
    sockets = {j: [] for j in range(3)}
    for (owner, other), edges in seams.items():
        mid = lambda e: tuple((u + v) / 2 for u, v in zip(centre(*e[0]), centre(*e[1])))
        edges.sort(key=lambda e: math.hypot(*mid(e)))
        for c, n in edges[1::2]:
            (ax, ay), (bx, by) = centre(*c), centre(*n)
            mx, my = mid((c, n))
            ux, uy = (bx - ax) / a.cell, (by - ay) / a.cell  # across the seam, out of the owner
            vx, vy = -uy, ux                                  # along the cell edge
            at = lambda u, v: (mx + u * ux + v * vx, my + u * uy + v * vy)
            L, w0, w1 = a.tab_length, a.tab_neck / 2, a.tab_head / 2
            tab = CrossSection([[at(-1, -w0), at(0, -w0), at(L, -w1), at(L, w1), at(0, w0), at(-1, w0)]])
            tabs[owner].append(solid(tab, a.tab_height))
            sockets[other].append(solid(tab.offset(a.tab_fit, JoinType.Round, circular_segments=24),
                                        a.tab_height + 0.2 + 1, -1))
    for j in range(3):
        piece = board ^ solid(shapes[j], a.thick)
        if tabs[j]:
            piece += Manifold.batch_boolean(tabs[j], OpType.Add)
        if sockets[j]:
            piece -= Manifold.batch_boolean(sockets[j], OpType.Add)
        parts.append(('ABC'[j], piece, -120 * j))
    print('tabs per block:', {'ABC'[j]: len(tabs[j]) for j in range(3)},
          ' sockets per block:', {'ABC'[j]: len(sockets[j]) for j in range(3)})


def triangles(m):
    mesh = m.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float64)[:, :3]
    tris = np.asarray(mesh.tri_verts, dtype=np.int64)
    p = verts[tris]
    normals = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return p, normals


def write_stl(path, p, normals):
    with open(path, 'wb') as f:  # binary STL
        f.write(b'HexGo board'.ljust(80, b' '))
        f.write(struct.pack('<I', len(p)))
        rec = np.zeros(len(p), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('attr', '<u2')])
        rec['n'] = normals
        rec['v'] = p
        f.write(rec.tobytes())


os.makedirs(a.out, exist_ok=True)
name = f'hexgo-board-{a.side}'
print(f'{a.side} per side, {len(cells)} cells, cell {a.cell:g} mm; dish {a.dish_width:g} mm wide, {dish_depth:.2f} mm deep')
meshes = []
for label, m, turn in parts:
    # Turn the piece to its narrowest footprint and centre it on the bed.
    flat = m.rotate([0, 0, turn])
    box = flat.bounding_box()
    flat = flat.translate([-(box[0] + box[3]) / 2, -(box[1] + box[4]) / 2, 0])
    p, normals = triangles(flat)
    size = p.reshape(-1, 3).max(axis=0) - p.reshape(-1, 3).min(axis=0)
    path = os.path.join(a.out, name + (f'-block-{label}' if label else '') + '.stl')
    write_stl(path, p, normals)
    spare = a.bed - max(size[0], size[1])
    print(f'{("block " + label) if label else "board"}: {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} mm, '
          f'{"fits" if spare >= 0 else "DOES NOT FIT"} a {a.bed:g} mm bed ({spare:.1f} mm to spare); '
          f'closed solid in one piece: {m.status() == m.status().NoError and len(m.decompose()) == 1}, '
          f'{m.volume() / 1000:.1f} cm3, {len(p)} triangles -> {path}')
    meshes.append((label, *triangles(m)))

# ---------- Preview pictures, drawn from the same triangles that go in the STL files ----------
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

light = np.array([-0.45, 0.55, 0.7])
light /= np.linalg.norm(light)
WOOD = np.array([0.87, 0.73, 0.49])
TINTS = {'': WOOD, 'A': np.array([0.85, 0.55, 0.37]), 'B': np.array([0.50, 0.65, 0.63]), 'C': np.array([0.61, 0.75, 0.43])}


def picture(path, title, tilt_deg=0, underside=False, spread=0.0):
    """Looks down on the parts, tilted back by tilt_deg. `spread` pulls the pieces apart."""
    t = math.radians(tilt_deg)
    rot = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    flip = np.diag([-1.0, 1.0, -1.0]) if underside else np.eye(3)  # turned over, left to right
    polys, colours, depths, spots = [], [], [], []
    for label, p, normals in meshes:
        mid = p.reshape(-1, 3).mean(axis=0)
        away = np.array([mid[0], mid[1], 0.0])
        shift = spread * away / np.linalg.norm(away) if label and np.linalg.norm(away) > 0 else np.zeros(3)
        with np.errstate(all='ignore'):  # numpy on Apple silicon warns falsely about matmul
            turned = (p + shift) @ flip.T
            v = turned @ rot.T
            n = normals @ flip.T @ rot.T
            spots.append((label, (mid + shift) @ flip.T @ rot.T))
        facing = n[:, 2] > 1e-6
        shade = 0.35 + 0.65 * np.clip(np.einsum('ij,j->i', n[facing], light), 0, 1)
        # Darken anything below the surface facing us, so engraving, dishes and sockets show.
        z = turned[:, :, 2]
        sunk = z.max() - z[facing].mean(axis=1)
        shade *= 1 - 0.45 * np.clip(sunk / 1.0, 0, 1)
        polys.append(v[facing][:, :, :2])
        colours.append(np.outer(shade, TINTS[label]))
        depths.append(v[facing][:, :, 2].mean(axis=1))
    polys, colours, depths = np.concatenate(polys), np.concatenate(colours), np.concatenate(depths)
    order = np.argsort(depths)  # far to near
    fig, ax = plt.subplots(figsize=(10, 9), dpi=150)
    ax.add_collection(PolyCollection(polys[order], facecolors=colours[order], edgecolors=colours[order], linewidths=0.2))
    for label, spot in spots:
        if label:
            ax.text(spot[0], spot[1], label, ha='center', va='center', fontsize=20, fontweight='bold',
                    bbox=dict(boxstyle='round,pad=0.3', fc='white', ec='none', alpha=0.85))
    ax.set_aspect('equal')
    ax.autoscale_view()
    ax.margins(0.03)
    ax.axis('off')
    ax.set_title(title, fontsize=11)
    fig.savefig(path, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print('wrote', path)


caption = f'HexGo board, {a.side} per side'
if a.layout == 'whole':
    picture(os.path.join(a.out, name + '-top.png'), caption + ' (from above)')
    picture(os.path.join(a.out, name + '-angle.png'), caption, tilt_deg=55)
else:
    picture(os.path.join(a.out, name + '-blocks-top.png'), caption + ': the three blocks from above, pulled apart', spread=22)
    picture(os.path.join(a.out, name + '-blocks-underside.png'),
            caption + ': the three blocks turned over, showing tabs and sockets', underside=True, spread=22)
    picture(os.path.join(a.out, name + '-blocks-assembled.png'), caption + ': assembled', tilt_deg=50)
