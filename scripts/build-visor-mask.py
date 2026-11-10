#!/usr/bin/env python3
"""The visor on Maneka's Picks: the film's mask, the frame laid over it, and the reflections.

    python3 scripts/build-visor-mask.py      (needs Pillow, numpy, scipy)

Owner, 10 Nov 2026: "not even 1 pixel should flow out", then of the result,
"the borders are bleeding. can you fix to perfection". A mask held inside the
glass left a ragged amber band between the film and the frame. So the edge
is no longer the mask's; it is the frame's own, as it is in the photograph:

  1. The glass is found by its colour (the photograph is black and white, the
     glass alone is amber: red well above blue, even where the frame's shadow
     makes it nearly black), kept to its one large piece with its holes filled,
     and its outline smoothed so it runs as the frame's inner edge does.
  2. Then "draw perfectly clean boundaries and work from there": the outline
     becomes one closed curve, smoothed as a line (strongly along the top and
     round the ends, lightly round the nose bridge and the corner pads) and
     drawn at eight times the resolution, so its edge is exact.
  3. visor-mask.png lets the film through that curve and three pixels beyond.
  4. visor-frame.png is the frame, laid over the film and the glass's rim:
     outside the curve, every pixel of glass or warmth is covered, opaque and
     without colour, by the frame carried on from the frame beside it, with
     a fine dark lip drawn on the curve itself. It sits outside the film's
     mask, over the whole box, so the film ends exactly on the curve and no
     amber of the glass is left at its rim.

  The script proves it before writing: with any film, no pixel outside the
  curve shows film or amber, even blurred as a browser scales the layers.
  5. visor-shine.png: the glass's own reflections, to screen over the film.

Writes the three images for the box BOX (the .mp-lens rule on the page uses
the same box, and checks it holds the mask with room to spare). Run it again
only if the photograph changes.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
PHOTO = ROOT / 'media' / 'picks' / 'portrait-visor.jpg'
OUT = ROOT / 'media' / 'picks'
BOX = (906, 644, 1676, 918)
UNDER = 3  # pixels the film runs under the frame

im = Image.open(PHOTO).convert('RGB')
rgb = np.asarray(im).astype(float)
R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
H, W = R.shape
roi = np.zeros((H, W), bool)
roi[620:930, 860:1720] = True

# 1. the glass: amber, however dark
chroma = R - B
glass = (chroma >= 10) & (R >= G) & (G >= B - 2) & roi
glass = nd.binary_opening(glass, iterations=1)
lab, n = nd.label(glass)
glass = lab == (np.argmax(nd.sum(glass, lab, range(1, n + 1))) + 1)
glass = nd.binary_fill_holes(nd.binary_closing(glass, iterations=3))
# its outline, smoothed: a clean curve along the frame's inner edge
# (never past the glass by more than a pixel, so the film is never seen on
# the frame), then each edge drawn as one clean line inside the shadowed
# ragged one: the top edge column by column, the two ends row by row
inside = (nd.gaussian_filter(glass.astype(float), 2.2) >= 0.5) & nd.binary_dilation(glass, iterations=1)
inside = nd.binary_fill_holes(inside)
lab, n = nd.label(inside)
inside = lab == (np.argmax(nd.sum(inside, lab, range(1, n + 1))) + 1)


def clean_line(first, size, sigma):
    # a smooth line on the inner side of a ragged one
    line = nd.gaussian_filter1d(nd.maximum_filter1d(first, size=size, mode='nearest'), sigma, mode='nearest')
    return np.maximum(line, first)


cols = np.where(inside.any(0))[0]
top = np.array([np.argmax(inside[:, x]) for x in cols]).astype(float)
limit = np.zeros(W)
limit[cols] = clean_line(top, 15, 6.0)
# across the middle the frame's inner edge is one smooth arch: a curve fitted
# to it, lowered just enough to stay inside the glass everywhere, and eased
# into the ends over twenty columns
span = (cols >= cols.min() + 90) & (cols <= cols.max() - 85)
fit = np.polyval(np.polyfit(cols[span], top[span], 4), cols)
fit += max(0.0, float((top[span] - fit[span]).max()))
ease = np.clip(np.minimum(cols - (cols.min() + 30), (cols.max() - 25) - cols) / 60.0, 0, 1)
limit[cols] = np.maximum(limit[cols] * (1 - ease) + fit * ease, top)
inside &= np.arange(H)[:, None] >= limit[None, :] - 0.25
rows = np.where(inside.any(1))[0]
left = np.array([np.argmax(inside[y, :]) for y in rows]).astype(float)
right = np.array([W - 1 - np.argmax(inside[y, ::-1]) for y in rows]).astype(float)
lo = np.zeros(H); hi = np.full(H, W)
lo[rows] = clean_line(left, 15, 5.0)
hi[rows] = -clean_line(-right, 15, 5.0)
xs_ = np.arange(W)[None, :]
# only at the two ends: across the middle the rows' extent is the top edge's
ends_l = xs_ < cols.min() + 60
ends_r = xs_ > cols.max() - 50
inside &= ((xs_ >= lo[:, None] - 0.25) | ~ends_l) & ((xs_ <= hi[:, None] + 0.25) | ~ends_r)
inside = nd.binary_opening(inside, iterations=1)
lab, n = nd.label(inside)
inside = lab == (np.argmax(nd.sum(inside, lab, range(1, n + 1))) + 1)
# 2. the boundary, drawn: one closed curve along the frame's inner edge,
#    smoothed as a line (not as pixels) and rendered at eight times the
#    resolution, so its edge is exact to an eighth of a pixel
from skimage import measure
from PIL import ImageDraw

SS = 8
field = nd.gaussian_filter(inside.astype(float), 1.0)
curve = max(measure.find_contours(field, 0.5), key=len)            # (row, col)
seg = np.r_[0, np.cumsum(np.hypot(*np.diff(curve, axis=0).T))]
even = np.arange(0, seg[-1], 0.5)
curve = np.c_[np.interp(even, seg, curve[:, 0]), np.interp(even, seg, curve[:, 1])]
# the frame's edge is one long smooth sweep along the top and round the
# ends, where the glass darkens into the frame's shadow and its colour alone
# would make a shoulder; it is smoothed strongly there (ten pixels), less
# along the bottom past the corner pads (five), and least round the nose
# bridge (two and a half), whose curve is tight and real
def along(c, sigma):
    return np.c_[nd.gaussian_filter1d(c[:, 0], sigma, mode='wrap'), nd.gaussian_filter1d(c[:, 1], sigma, mode='wrap')]


def zone(where):
    return np.clip(nd.gaussian_filter1d(where.astype(float), 30, mode='wrap') * 2, 0, 1)[:, None]


bridge = zone((curve[:, 1] > 1210) & (curve[:, 1] < 1450) & (curve[:, 0] > 685))
bottom = zone(curve[:, 0] > 790) * (1 - bridge)
curve = along(curve, 5) * bridge + along(curve, 10) * bottom + along(curve, 20) * (1 - bridge - bottom)
x0, y0, x1, y1 = BOX


def render(points, width=0):
    big = Image.new('L', ((x1 - x0) * SS, (y1 - y0) * SS), 0)
    pts = [((c - x0 + 0.5) * SS, (r - y0 + 0.5) * SS) for r, c in points]
    d = ImageDraw.Draw(big)
    if width:
        d.line(pts + pts[:1], fill=255, width=int(round(width * SS)), joint='curve')
    else:
        d.polygon(pts, fill=255)
    small = big.resize((x1 - x0, y1 - y0), Image.BOX)
    out = np.zeros((H, W))
    out[y0:y1, x0:x1] = np.asarray(small).astype(float) / 255
    return out


edge = render(curve)                       # how much of each pixel is glass
# the glass, however deep in shadow: any warmth at all, the frame being grey
shadowed = nd.binary_fill_holes(nd.binary_closing(((chroma >= 6) & roi) | glass, iterations=2))
lab, n = nd.label(shadowed)
shadowed = lab == lab[tuple(np.argwhere(glass)[0])]
# where the smooth curve grazes the frame by a fraction of a pixel, the
# frame wins: not one pixel of film is ever drawn on it
edge = np.where(shadowed, edge, 0.0)
assert edge[~shadowed].max() == 0, 'the curve runs onto the frame'

# 3. what the film runs under: every amber pixel of the photograph and the
#    curve's surroundings, so no glass is left uncovered at the rim
amber = (chroma >= 8) & roi & nd.binary_dilation(glass, iterations=10)
cover = nd.binary_dilation(amber | glass | (edge > 0), iterations=UNDER)
ys, xs = np.where(cover)
assert x0 + 2 <= xs.min() and xs.max() < x1 - 2 and y0 + 2 <= ys.min() and ys.max() < y1 - 2, \
    f'the mask {xs.min()}..{xs.max()} x {ys.min()}..{ys.max()} does not sit inside BOX {BOX}'
assert not ((chroma >= 8) & roi & nd.binary_dilation(glass, iterations=10) & ~cover).any(), 'amber outside what is covered'


def save(alpha, colour, name):
    a = alpha[y0:y1, x0:x1]
    if colour is None:
        img = Image.new('RGBA', (x1 - x0, y1 - y0), (255, 255, 255, 0))
        img.putalpha(Image.fromarray((np.clip(a, 0, 1) * 255).round().astype('uint8')))
    else:
        c = np.clip(colour[y0:y1, x0:x1], 0, 255)
        img = Image.fromarray(np.dstack([c, c, c, np.clip(a, 0, 1) * 255]).round().astype('uint8'), 'RGBA')
    img.save(OUT / name, optimize=True)


# the film's own mask: the curve and three pixels beyond, under the frame,
# so that where a browser softens the frame's edge as it scales it, film is
# beneath, never the photograph's amber glass (the frame is not under this
# mask: it is laid over the whole box, opaque well past it)
film = nd.binary_dilation(edge > 0, iterations=UNDER)
save(film.astype(float), None, 'visor-mask.png')

# 4. the frame over the film: outside the curve, the photograph's own frame,
#    in grey; where the photograph has glass outside the curve, the frame
#    carried on from its nearest frame pixel; and on the curve itself a
#    fine dark lip, the clean edge the film meets
luma = 0.299 * R + 0.587 * G + 0.114 * B
frame_px = ~(amber | glass | (edge > 0))
# filled smoothly from the frame around it (a normalised blur, widening
# until every pixel is reached), not smeared from one neighbour
fill = np.full(luma.shape, np.nan)
known = frame_px.astype(float)
for sigma in (1.5, 3, 6, 12):
    num = nd.gaussian_filter(luma * known, sigma)
    den = nd.gaussian_filter(known, sigma)
    est = np.where(den > 0.05, num / np.maximum(den, 1e-6), np.nan)
    fill = np.where(np.isnan(fill), est, fill)
colour = np.where(frame_px, luma, np.nan_to_num(fill, nan=float(np.median(luma[frame_px & cover]))))
lip = render(curve, width=1.4)
lip_tone = np.percentile(luma[frame_px & cover], 20)
colour = colour * (1 - lip) + lip_tone * lip
# opaque over every pixel of glass or warmth outside the curve and a margin
# round them, then fading out over neutral photograph, where it is the
# photograph's own pixels and so changes nothing
reach = nd.gaussian_filter(nd.binary_dilation(cover | film, iterations=14).astype(float), 1.5)
reach = np.clip((reach - 0.5) * 2 + nd.binary_dilation(cover | film, iterations=12), 0, 1)
over = np.clip((1 - edge) + lip, 0, 1) * reach
save(over, colour, 'visor-frame.png')

# the proof: with any film at all, no pixel outside the curve shows it, and
# no pixel anywhere outside the glass has a trace of amber
through = film * (1 - over)
# and as a browser scales both (a filter of a pixel and a half): under a
# hundredth of the film four pixels past the curve, on the frame's dark lip
blurred = nd.gaussian_filter(film.astype(float), 1.5) * (1 - nd.gaussian_filter(over, 1.5))
dist = nd.distance_transform_edt(edge == 0)
assert blurred[dist >= 4].max() < 0.01, 'film could reach the frame when scaled'
assert not (through[edge == 0] > 0).any(), 'the film shows outside the curve'
assert not (through[~shadowed] > 0).any(), 'the film shows on the frame'
for film_rgb in [(0, 200, 255), (255, 0, 0), (255, 255, 255), (0, 0, 0)]:
    out = np.dstack([rgb[..., k] * (1 - film) + film_rgb[k] * film for k in range(3)])
    out = out * (1 - over[..., None]) + colour[..., None] * over[..., None]
    outside = edge == 0
    near = outside & nd.binary_dilation(glass, iterations=20)
    chroma_out = out.max(-1) - out.min(-1)
    chroma_in = rgb.max(-1) - rgb.min(-1)
    assert not (near & (chroma_out > np.maximum(chroma_in, 3) + 0.5)).any(), f'film or colour drawn outside the glass with {film_rgb}'
    assert not (near & (out[..., 0] - out[..., 2] >= 8)).any(), f'amber left outside the glass with {film_rgb}'

# 5. the glass's own reflections
v = luma[y0:y1, x0:x1]
gin = edge[y0:y1, x0:x1] >= 0.5
p60, p995 = np.percentile(v[gin], [60, 99.5])
highlights = np.clip((v - p60) / (p995 - p60), 0, 1) ** 1.3
hh, ww = v.shape
yy = np.linspace(0, 1, hh)[:, None]
xx = np.linspace(0, 1, ww)[None, :]
sheen = np.clip(1 - (xx * 0.35 + yy) / 0.5, 0, 1) ** 1.8 * 0.18
shine_a = np.clip(highlights * 0.55 + sheen, 0, 1) * edge[y0:y1, x0:x1]
shine = Image.new('RGBA', (ww, hh), (255, 236, 200, 0))
shine.putalpha(Image.fromarray((shine_a * 255).round().astype('uint8')))
shine.save(OUT / 'visor-shine.png', optimize=True)
print(f'visor-mask.png, visor-frame.png and visor-shine.png written for box {BOX}')
