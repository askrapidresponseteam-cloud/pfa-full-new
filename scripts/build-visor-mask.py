#!/usr/bin/env python3
"""The visor on Maneka's Picks: its mask and its reflections, read from the photograph.

    python3 scripts/build-visor-mask.py      (needs Pillow, numpy, scipy)

Owner, 10 Nov 2026: "not even 1 pixel should flow out". The trailer plays in
the amber visor of media/picks/portrait-visor.jpg through a mask. The mask is
the amber glass itself, found by its colour (the photograph is black and
white, the glass alone is amber), kept to its one large piece with its holes
filled, its top edge smoothed where the frame's shadow makes it ragged (never
above the glass), then held 4 pixels inside the glass with a fine feather,
and zeroed wherever the glass is not. Checked in a browser at 390 to 1920
wide: no pixel outside the glass changes when the film plays.

Writes media/picks/visor-mask.png and visor-shine.png for the box 925..1664
across and 663..899 down (the .mp-lens rule on the page uses the same box).
Run it again only if the photograph changes, and then re-measure the box.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
PHOTO = ROOT / 'media' / 'picks' / 'portrait-visor.jpg'
BOX = (925, 663, 1664, 899)

im = Image.open(PHOTO).convert('RGB')
h_, s_, _ = [np.asarray(c).astype(float) for c in im.convert('HSV').split()]
H, W = s_.shape
roi = np.zeros((H, W), bool)
roi[620:930, 860:1720] = True
glass = (s_ > 60) & (h_ > 8) & (h_ < 45) & roi
lab, n = nd.label(glass)
glass = lab == (np.argmax(nd.sum(glass, lab, range(1, n + 1))) + 1)
glass = nd.binary_fill_holes(glass)

cols = np.where(glass.any(0))[0]
top = np.array([np.argmax(glass[:, x]) for x in cols]).astype(float)
smooth = np.maximum(nd.gaussian_filter1d(nd.maximum_filter1d(top, size=13, mode='nearest'), 4, mode='nearest') + 0.5, top)
limit = np.full(W, H, float)
limit[cols] = smooth
cut = nd.binary_fill_holes(glass & (np.arange(H)[:, None] >= limit[None, :]))
alpha = np.clip(nd.gaussian_filter(nd.binary_erosion(cut, iterations=4).astype(float), 0.9), 0, 1)
alpha[~nd.binary_erosion(glass, iterations=1)] = 0
assert not ((alpha > 0) & ~glass).any(), 'the mask reaches past the glass'

x0, y0, x1, y1 = BOX
a = alpha[y0:y1, x0:x1]
mask = Image.new('RGBA', (x1 - x0, y1 - y0), (255, 255, 255, 0))
mask.putalpha(Image.fromarray((a * 255).round().astype('uint8')))
mask.save(ROOT / 'media' / 'picks' / 'visor-mask.png', optimize=True)

v = np.asarray(im.convert('L')).astype(float)[y0:y1, x0:x1]
p60, p995 = np.percentile(v[glass[y0:y1, x0:x1]], [60, 99.5])
highlights = np.clip((v - p60) / (p995 - p60), 0, 1) ** 1.3
hh, ww = a.shape
yy = np.linspace(0, 1, hh)[:, None]
xx = np.linspace(0, 1, ww)[None, :]
sheen = np.clip(1 - (xx * 0.35 + yy) / 0.5, 0, 1) ** 1.8 * 0.18
shine_a = np.clip(highlights * 0.55 + sheen, 0, 1) * a
shine = Image.new('RGBA', (ww, hh), (255, 236, 200, 0))
shine.putalpha(Image.fromarray((shine_a * 255).round().astype('uint8')))
shine.save(ROOT / 'media' / 'picks' / 'visor-shine.png', optimize=True)
print('visor-mask.png and visor-shine.png written')
