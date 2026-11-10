#!/usr/bin/env python3
"""Her photograph on Maneka's Picks, without the generated skin texture.

    python3 scripts/retouch-portrait.py      (needs Pillow, numpy, scipy)
    then: python3 scripts/build-visor-mask.py

Owner, 10 Nov 2026: "the image has this kinda texture which is so gpt ish!.
fix". The photograph carried the fine wandering-line pattern an image
generator leaves on smooth surfaces: over her forehead, cheeks, lips, neck,
the white of the sari and the blouse. Read from the original
(scripts/source/portrait-visor-original.jpg, kept out of the site), written
to media/picks/portrait-visor.jpg:

  - where the picture is smooth (skin, cloth, the wall), and only there: in
    its mid tones, away from any edge or strong detail, so hair, lashes, the
    earrings, the sequins, the lips' outline, the nostrils and the glasses
    are left exactly as they were
  - the pattern is replaced by the tone beneath it and the detail a
    high-resolution camera records, sharp to the pixel and never blurred
    (owner: "image cannot be blurred though", "it has to be like shot in
    60MP canon mark dslr"): on her skin, fine pores and the faint unevenness
    of real skin; on cloth and the wall, only the finest sensor grain
  - every blemish, freckle and mole on her skin is healed from the skin
    around it ("skin cannot have blemishes")
  - the amber glass keeps its every pixel; the picture is otherwise grey

The visor's mask, frame and reflections are read from this photograph, so
build-visor-mask.py is run after it.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'scripts' / 'source' / 'portrait-visor-original.jpg'
OUT = ROOT / 'media' / 'picks' / 'portrait-visor.jpg'

rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(float)
L = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

# where the picture is smooth: mid tones, little detail, no edge
low = nd.gaussian_filter(L, 8)
detail = nd.gaussian_filter(np.abs(L - nd.gaussian_filter(L, 3)), 6)
edge = nd.maximum_filter(nd.gaussian_gradient_magnitude(L, 2.5), 5)
tones = np.clip((low - 35) / 15, 0, 1) * np.clip((250 - low) / 10, 0, 1)
smooth = np.clip((15 - detail) / 5, 0, 1) * np.clip((8 - edge) / 3, 0, 1) * tones
smooth = nd.gaussian_filter(smooth, 3)

# her skin, drawn by hand round the face, ears, neck and chest: the only
# place a sensor would record pores
from PIL import ImageDraw
SKIN = [(1150, 430), (1300, 395), (1450, 430), (1600, 520), (1680, 640), (1740, 700), (1760, 900),
        (1700, 1050), (1620, 1150), (1560, 1300), (1560, 1450), (1500, 1520), (1350, 1600), (1180, 1720),
        (1030, 1800), (980, 1700), (980, 1500), (1000, 1350), (960, 1200), (880, 1060), (800, 950),
        (790, 700), (880, 620), (960, 520), (1050, 460)]
H, W = L.shape
poly = Image.new('L', (W, H), 0)
ImageDraw.Draw(poly).polygon(SKIN, fill=255)
skin_area = nd.gaussian_filter(np.asarray(poly).astype(float) / 255, 12)

# blemishes, freckles and moles on her skin (owner: "skin cannot have
# blemishes"): every small dark spot, healed from the skin around it. The
# nostrils, the mouth's line and the glasses are far larger or long, and stay.
dog = nd.gaussian_filter(L, 1.2) - nd.gaussian_filter(L, 6)
spots = (dog < -5) & (skin_area > 0.5)
lab, n = nd.label(spots)
sizes = nd.sum(spots, lab, range(1, n + 1))
heal = np.zeros(n + 1, bool)
for i, (sl, size) in enumerate(zip(nd.find_objects(lab), sizes)):
    h = sl[0].stop - sl[0].start
    w = sl[1].stop - sl[1].start
    if 1 <= size <= 700 and max(h, w) <= 4 * max(1, min(h, w)) + 3 and max(h, w) <= 45:
        heal[i + 1] = True
blem = nd.binary_dilation(heal[lab], iterations=3)
known = (~blem).astype(float)
healed = L.copy()
for sigma in (2, 4, 8, 16):
    est = nd.gaussian_filter(L * known, sigma) / np.maximum(nd.gaussian_filter(known, sigma), 1e-6)
    take = blem & (nd.gaussian_filter(known, sigma) > 0.2) & (healed == L)
    healed = np.where(take, est, healed)
blem_w = nd.gaussian_filter(blem.astype(float), 1.0)
L_clean = L * (1 - blem_w) + healed * blem_w

# the tone beneath the pattern: its shading only (a median, so its mottle
# goes, then a soft blur), with nothing of the pattern left in it
tone = nd.gaussian_filter(nd.median_filter(L_clean, size=7), 1.5)

# and the detail a high-resolution camera records on it, sharp to the pixel:
# on skin, fine pores and the faint unevenness of real skin, a little
# stronger in its shadows than its highlights; elsewhere (cloth, the wall)
# only the finest, faintest sensor grain
rng = np.random.default_rng(23)
fine = nd.gaussian_filter(rng.standard_normal((H, W)), 0.5)
fine /= fine.std()
mid = nd.gaussian_filter(rng.standard_normal((H, W)), 1.1) - nd.gaussian_filter(rng.standard_normal((H, W)), 2.6)
mid /= mid.std()
pores = nd.gaussian_filter((rng.random((H, W)) < 0.022).astype(float), 0.85)
pores /= pores.max()
shade = np.clip((255 - tone) / 110, 0.6, 1)
skin_tex = (2.0 * fine + 2.8 * mid) * shade - 11.0 * pores * shade
cloth_tex = 1.1 * fine
clean = tone + skin_tex * skin_area + cloth_tex * (1 - skin_area)
# where a blemish was healed beside an edge (outside the smooth areas), the
# same skin texture over it, so it is not a flat patch
grey = (L_clean + skin_tex * blem_w * skin_area) * (1 - smooth) + clean * smooth

# the amber glass, untouched; everything else grey, as it was
chroma = rgb.max(-1) - rgb.min(-1)
glass = nd.gaussian_filter((chroma >= 6).astype(float), 1.0)
glass = np.clip(glass * 2, 0, 1)[..., None]
out = rgb * glass + np.repeat(grey[..., None], 3, -1) * (1 - glass)
Image.fromarray(np.clip(out, 0, 255).round().astype('uint8')).save(OUT, quality=88, optimize=True, progressive=True)
print(f'{OUT.relative_to(ROOT)} written; smoothed {float((smooth > 0.5).mean()) * 100:.0f}% of the picture, {int(heal.sum())} blemishes healed')
