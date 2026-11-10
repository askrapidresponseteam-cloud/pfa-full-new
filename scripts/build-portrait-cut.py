#!/usr/bin/env python3
"""Her, cut from the wall: media/picks/portrait-cut.png.

Owner, 10 Nov 2026, of Maneka's Picks' hero: "her head is getting chopped.
can you do it in a way where the header of the page is intact. her photo is
adjusted so nothing gets clipped". The hero now sits under the header and
shows her whole, from the top of her head; on a screen wider than her
photograph the wall runs on either side. So the photograph is shown through
this mask: her, and not the wall, which the page draws behind her the full
width of the screen (as jjettas.com's hero stands its cut-out player on its
own wall).

How the edge is found
  - Her: everything that is not the bright, even wall (the matte
    scripts/build-visor-mask.py makes, portrait-wall.png), the one piece
    that is her (a dark, out-of-focus shape at the photograph's right edge
    is not), its holes filled.
  - At her edge, strand by strand: how much darker each pixel is than the
    wall just behind it (the wall's own brightness, carried in under her
    hair), so a single strand of hair is as soft as it is thin. Her blouse
    and the sari's white border, which are not darker than the wall, keep
    the matte's own edge.

Run after scripts/build-visor-mask.py. Written at half size, as the wall
matte is; the page scales it to the photograph."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
PICKS = ROOT / 'media' / 'picks'

photo = Image.open(PICKS / 'portrait-visor.jpg').convert('L')
W, H = photo.size
w2, h2 = W // 2, H // 2
luma = np.asarray(photo.resize((w2, h2), Image.LANCZOS)).astype(float)
wall_a = np.asarray(Image.open(PICKS / 'portrait-wall.png'))[..., 3].astype(float) / 255
assert wall_a.shape == luma.shape, 'the wall matte is the size of the half-size photograph'

wall = wall_a > 0.5
# the matte stops three pixels short of the photograph's edges; carry it out
# to them, or the frame of pixels left would join her round the wall
rim = np.zeros_like(wall)
rim[:6, :] = rim[-6:, :] = True
rim[:, :6] = rim[:, -6:] = True
wall = wall | (rim & nd.binary_dilation(wall, iterations=6))
her = ~wall
lab, n = nd.label(her)
sizes = nd.sum(her, lab, range(1, n + 1))
keep = 1 + int(np.argmax(sizes))
her = nd.binary_fill_holes(lab == keep)
# wall the matte missed, low at the photograph's sides beside her shoulders:
# bright, even, and reaching the left or right edge
smooth_l = nd.gaussian_filter(luma, 2)
even = nd.gaussian_gradient_magnitude(luma, 2) < 8
pale = her & (smooth_l > 212) & even
plab, pn = nd.label(pale)
side = set(plab[:, :4].ravel().tolist()) | set(plab[:, -4:].ravel().tolist())
side.discard(0)
if side:
    her = her & ~nd.binary_dilation(np.isin(plab, sorted(side)), iterations=2)
    lab, n = nd.label(her)
    sizes = nd.sum(her, lab, range(1, n + 1))
    her = nd.binary_fill_holes(lab == 1 + int(np.argmax(sizes)))

# the wall's brightness, carried in under her: normalised convolution of the
# wall's own pixels
wf = wall.astype(float)
wall_l = nd.gaussian_filter(luma * wf, 18) / np.maximum(nd.gaussian_filter(wf, 18), 1e-3)

# her core is hers outright; in a band around it, how much darker than the wall
core = nd.binary_erosion(her, iterations=5)
band = nd.binary_dilation(her, iterations=6) & ~core
key = np.clip((wall_l - 6 - luma) / 34, 0, 1)
alpha = np.where(core, 1.0, 0.0)
alpha = np.where(band, np.maximum(key, her * 0.0), alpha)
# where she is not darker than the wall (the blouse's edge, the white
# border of the sari), the matte's own edge, softened a pixel
light = band & her & (luma >= wall_l - 10)
alpha = np.where(light, np.maximum(alpha, nd.gaussian_filter(her.astype(float), 1.0)), alpha)
alpha = np.clip(alpha, 0, 1)
# nothing of her lost at the photograph's own edges (her shoulders run off
# its foot and sides)
edge = np.zeros_like(her)
edge[-3:, :] = True
edge[:, :3] = True
edge[:, -3:] = True
alpha = np.where(edge & her, 1.0, alpha)

assert alpha[wall & ~nd.binary_dilation(her, iterations=6)].max() == 0, 'nothing of the wall away from her'
cy, cx = int(H * 0.37 / 2), int(W * 0.5 / 2)
assert alpha[cy - 40:cy + 40, cx - 120:cx + 120].min() == 1, 'her face and the visor are whole'

img = Image.new('RGBA', (w2, h2), (0, 0, 0, 0))
img.putalpha(Image.fromarray((alpha * 255).round().astype('uint8')))
img.save(PICKS / 'portrait-cut.png', optimize=True)
print(f'portrait-cut.png written: {w2} x {h2}, her {her.mean() * 100:.0f}% of the photograph')
