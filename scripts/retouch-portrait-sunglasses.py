#!/usr/bin/env python3
"""Her photograph on Maneka's Picks (the sunglasses portrait), without the
generated texture, as a high-resolution camera records it.

    python3 scripts/retouch-portrait-sunglasses.py   (needs Pillow, numpy, scipy)

Owner, 11 Nov 2026, with this photograph: "there cannot be any ai texture on
the photo. and it should look like shot from a 100mp dslr". The photograph
carries the fine wandering-line pattern an image generator leaves on smooth
surfaces: over her forehead, cheeks, nose, lips, chin and neck, and faintly
on the blouse and the white of the sari. Read from the original
(scripts/source/portrait-sunglasses-original.png, kept out of the site),
written to media/picks/portrait.jpg:

  - on her skin and lips, inside a hand-drawn outline and away from every
    edge (the lips' outline, the nostrils, the brows, the glasses and their
    frame, the earrings, the hair): the pattern is replaced by the tone
    beneath it, an edge-keeping smoothing that never blurs an edge
  - every blemish and freckle on her skin is healed from the skin around it
    (owner, 10 Nov 2026: "skin cannot have blemishes")
  - in its place, the detail a high-resolution sensor records: fine pores and
    the faint unevenness of real skin; on cloth and the wall, only the finest
    grain
  - the whole picture at twice its size (2770 by 2272), scaled, never
    stretched, with one even sensor grain over it at that size, so nothing
    looks painted; its shape, framing and everything that is not texture
    stay exactly as they were
The noise is seeded, so a run makes the same file every time.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'scripts' / 'source' / 'portrait-sunglasses-original.png'
OUT = ROOT / 'media' / 'picks' / 'portrait.jpg'
rng = np.random.default_rng(20261111)

rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64)
H, W, _ = rgb.shape
L = rgb @ np.array([0.299, 0.587, 0.114])


def poly_mask(points, blur):
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return nd.gaussian_filter(np.asarray(m, np.float64) / 255, blur)


def bilateral(img, sigma_s, sigma_r, radius):
    """An edge-keeping smoothing: each pixel the mean of its neighbours of a
    like tone, so an edge (a darker or lighter neighbour) is never pulled in."""
    pad = np.pad(img, radius, mode='reflect')
    num = np.zeros_like(img)
    den = np.zeros_like(img)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = np.exp(-(dx * dx + dy * dy) / (2 * sigma_s ** 2))
            nb = pad[radius + dy:radius + dy + H, radius + dx:radius + dx + W]
            w = ws * np.exp(-((nb - img) ** 2) / (2 * sigma_r ** 2))
            num += w * nb
            den += w
    return num / den


# her skin: face, ears, neck and the chest above the sari
SKIN = [(590, 252), (650, 236), (700, 232), (760, 238), (830, 262), (880, 312), (905, 372), (925, 368),
        (940, 410), (935, 470), (915, 520), (895, 560), (880, 610), (855, 665), (830, 705), (835, 760),
        (850, 795), (800, 830), (760, 880), (725, 925), (690, 900), (640, 850), (590, 805), (575, 760),
        (590, 715), (560, 680), (530, 630), (505, 560), (485, 520), (462, 470), (455, 410), (470, 372),
        (495, 372), (515, 320), (550, 280)]
skin = poly_mask(SKIN, 3)
# the glasses: the skin seen through the lenses is skin too; the frame, the
# eyes, the lashes and the reflections are edges, and edges are kept
GLASSES = [(488, 352), (700, 352), (915, 352), (915, 490), (790, 492), (735, 470), (700, 465), (665, 470),
           (612, 492), (488, 490)]
glasses = poly_mask(GLASSES, 2)
# her eyes and lashes behind the glass are left exactly as they are
yy, xx = np.ogrid[:H, :W]
eyes = np.zeros((H, W))
for cx, cy in ((612, 402), (795, 400)):
    eyes = np.maximum(eyes, ((((xx - cx) / 78.0) ** 2 + ((yy - cy) / 36.0) ** 2) < 1).astype(np.float64))
eyes = nd.gaussian_filter(eyes, 4)
# the earrings and their hooks
yy, xx = np.ogrid[:H, :W]
for cx, cy, r in ((485, 560, 42), (900, 560, 42)):
    skin *= 1 - nd.gaussian_filter((((xx - cx) / 0.8) ** 2 + ((yy - cy) / 1.6) ** 2 < r * r).astype(np.float64), 3)

# edges: where the picture really changes (the lips' line, the nostrils,
# the brows, strands of hair), read through the pattern
grad = nd.gaussian_gradient_magnitude(L, 2.2)
edge = np.clip((grad - 5.5) / 4, 0, 1)
edge = nd.maximum_filter(edge, 3)
edge = nd.gaussian_filter(edge, 1.2)
dark = np.clip((95 - nd.gaussian_filter(L, 2)) / 20, 0, 1) * (1 - glasses)  # hair and brows, not the tinted glass

# 1. the pattern out: smooth where it is skin and not an edge
base = bilateral(L, 3.0, 16.0, 6)
base = bilateral(base, 2.0, 10.0, 4)
keep = np.clip(edge + dark + eyes, 0, 1)
w_skin = skin * (1 - keep)
clean = L + w_skin * (base - L)

# 2. blemishes and freckles: small spots darker than the skin round them
med = nd.median_filter(clean, 13)
spot = np.clip((med - clean - 3.0) / 4.0, 0, 1)
spot = nd.grey_dilation(spot, size=(3, 3))
spot = nd.gaussian_filter(spot, 1.0) * w_skin
clean = clean + spot * (med - clean)

# 3. cloth and wall: smooth, mid to light, little detail; a lighter touch
low = nd.gaussian_filter(L, 6)
detail = nd.gaussian_filter(np.abs(L - nd.gaussian_filter(L, 2.5)), 5)
flat = np.clip((6 - detail) / 3, 0, 1) * np.clip((low - 50) / 15, 0, 1) * (1 - keep) * (1 - skin)
clean = clean + 0.8 * flat * (bilateral(clean, 2.0, 8.0, 4) - clean)

# 4. what a sensor records: pores and the faint unevenness of skin
pores = nd.gaussian_filter(rng.standard_normal((H, W)), 0.7)
pores /= pores.std()
uneven = nd.gaussian_filter(rng.standard_normal((H, W)), 7)
uneven /= uneven.std()
tone = np.clip(clean / 200, 0.35, 1.0)
clean = clean + w_skin * tone * (2.1 * pores + 1.2 * uneven)

# the change, laid on every channel, so its own tint stays
delta = (clean - L)[..., None]
out = np.clip(rgb + delta, 0, 255)

# 5. twice the size, scaled (never stretched), with one even grain and a
#    light sharpening at that size
big = Image.fromarray(out.round().astype(np.uint8)).resize((W * 2, H * 2), Image.LANCZOS)
b = np.asarray(big).astype(np.float64)
bl = b @ np.array([0.299, 0.587, 0.114])
soft = nd.gaussian_filter(bl, 1.1)
sharp = 0.45 * (bl - soft)
grain = nd.gaussian_filter(rng.standard_normal(bl.shape), 0.55)
grain /= grain.std()
mid = 4 * (bl / 255) * (1 - bl / 255)  # grain shows most in the mid tones, as a sensor's does
b = np.clip(b + (sharp + 1.6 * mid * grain)[..., None], 0, 255)
Image.fromarray(b.round().astype(np.uint8)).save(OUT, quality=93, subsampling=0, optimize=True, progressive=True)
print(OUT.relative_to(ROOT), Image.open(OUT).size)
