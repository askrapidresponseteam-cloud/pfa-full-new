#!/usr/bin/env python3
"""Every shop photograph on one canvas shape, untouched and whole.

Owner, 30 Oct 2026: "photos render differently in each tile looks diff and
odd. make it uniform and supreme". Owner, 1 Nov 2026: "the shop/merchandise
photos are distorted and messed. fix it professionally" and "no part of the
photo can be clipped or messed with".

The photographs came from many shoots, in shapes from 3:2 to 9:20. The
earlier frames (v3) widened each to 2:3 by smearing its edge pixels outwards,
which showed as streaks beside arms, jeans and T-shirts. Now each original is
placed whole, at its own size and shape, in the middle of a 2:3 canvas, and
the canvas around it is the same photograph blurred and softened: the tile is
filled edge to edge in the photograph's own colours, and the photograph
itself is not stretched, cut, smeared or retouched.

Reads the originals (media/shop/v2/<name> or media/shop/<name>) and writes
media/shop/v4/<same name>.webp.
Run: python3 scripts/shop-frames.py
"""
import os
import re

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter1d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RATIO = 2 / 3          # width / height of every shop photograph
OUT = os.path.join(ROOT, 'media', 'shop', 'v4')


def original(name):
    for d in (os.path.join(ROOT, 'media', 'shop', 'v2'), os.path.join(ROOT, 'media', 'shop')):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    raise SystemExit(f'no original for {name}')


def unframed(im):
    """Takes off a thin frame line some shoots left on an edge: up to 6
    pixels of near-uniform colour clearly unlike the photograph just inside
    it. Nothing of the picture itself is removed."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    cut = {'l': 0, 'r': 0, 't': 0, 'b': 0}
    def line(side, k):
        return {'l': a[:, k], 'r': a[:, w - 1 - k], 't': a[k], 'b': a[h - 1 - k]}[side]
    for side in cut:
        inner = line(side, 10).mean(axis=0)
        k = 0
        while k < 6:
            px = line(side, k)
            if float(np.abs(px.mean(axis=0) - inner).max()) > 28 and float(px.std(axis=0).max()) < 40:
                k += 1
            else:
                break
        cut[side] = k
    return im.crop((cut['l'], cut['t'], w - cut['r'], h - cut['b'])), cut


def frame(src):
    im, _ = unframed(Image.open(src).convert('RGB'))
    w, h = im.size
    if w > h:
        return im      # a front-and-back picture side by side: left as shot
    if w / h <= RATIO:
        cw, ch = round(h * RATIO), h
    else:
        cw, ch = w, round(w / RATIO)
    # room goes beside a person, or above them; never below their feet
    x0, y0 = (cw - w) // 2, ch - h
    a = np.asarray(im).astype(np.float32)
    out = np.zeros((ch, cw, 3), np.float32)
    ys, xs = np.mgrid[0:ch, 0:cw]
    band = max(6, round(min(w, h) * 0.012))

    # The margin is more of the backdrop: the colour of the photograph's own
    # edge, taken from a thin band and smoothed broadly ALONG the edge, so a
    # shoulder or a head that touches the edge does not draw out into it, and
    # easing with distance into that edge's overall tone. Nothing of the
    # photograph is copied, blurred or stretched into it.
    # The backdrop's own tone: the photograph's top edge, which is backdrop
    # in every shoot here (the sides can be a sleeve or a T-shirt)
    top_band = a[:band].reshape(-1, 3)
    tone = np.median(top_band, axis=0)
    # how far the backdrop itself drifts from that tone (a vignette, a
    # gradient), so an edge in the backdrop's own shading still counts as it
    drift = float(np.percentile(np.abs(top_band - tone).max(axis=1), 70))
    limit = max(34.0, drift * 1.6)

    def backdrop(strip, outer):
        """An edge's colours (the band, and its outermost pixels) with
        whatever is not backdrop (a T-shirt, an arm, an inset picture touching
        it) left out and filled across from the backdrop either side; None
        when the edge is mostly not backdrop."""
        off = np.maximum(np.abs(strip - tone).max(axis=1), np.abs(outer - tone).max(axis=1))
        keep = off <= limit
        if keep.mean() < 0.45:
            return None
        i = np.arange(len(strip))
        mend = lambda v: np.stack([np.interp(i, i[keep], v[keep, c]) for c in range(3)], axis=1)
        return mend(strip), mend(outer)

    def fill(pair, along, length, sigma, dist, reach):
        # at the join, the photograph's outermost pixels (so there is no
        # line); a little further out, its edge smoothed; furthest, its mean
        profile, outer = pair
        raw = gaussian_filter1d(outer, 1.5, axis=0, mode='nearest')
        col = gaussian_filter1d(profile, sigma, axis=0, mode='nearest')
        idx = np.clip(along, 0, length - 1)
        d = np.clip(dist, 0, None)
        near = np.exp(-d / max(4.0, reach * 0.12))[..., None]
        wgt = np.exp(-d / reach)[..., None]
        edge = near * raw[idx] + (1 - near) * col[idx]
        return wgt * edge + (1 - wgt) * col.mean(axis=0)

    if x0 > 0:
        sig = 0.10 * h
        reach = max(8.0, x0 * 1.5)
        lp = backdrop(a[:, :band].mean(axis=1), a[:, :2].mean(axis=1))
        rp = backdrop(a[:, -band:].mean(axis=1), a[:, -2:].mean(axis=1))
        flat = (np.tile(tone, (h, 1)), np.tile(tone, (h, 1)))
        lp = lp if lp is not None else (rp if rp is not None else flat)
        rp = rp if rp is not None else lp
        left = fill(lp, ys - y0, h, sig, (x0 - xs).astype(np.float32), reach)
        right = fill(rp, ys - y0, h, sig, (xs - (x0 + w - 1)).astype(np.float32), reach)
        out[xs < x0] = left[xs < x0]
        out[xs >= x0 + w] = right[xs >= x0 + w]
    if y0 > 0:
        sig = 0.18 * w
        reach = max(8.0, y0 * 1.2)
        tp = backdrop(a[:band].mean(axis=0), a[:2].mean(axis=0))
        tp = tp if tp is not None else (np.tile(tone, (w, 1)), np.tile(tone, (w, 1)))
        top = fill(tp, xs - x0, w, sig, (y0 - ys).astype(np.float32), reach)
        m = ys < y0
        out[m] = top[m]

    # the photograph's grain, so the margin does not read as flat paint
    grain = float(np.clip(np.std(a[:, :band] - gaussian_filter1d(a[:, :band], 2, axis=0)), 0.8, 3.5))
    rng = np.random.default_rng(7)
    out = out + rng.normal(0, grain, out.shape[:2])[..., None]
    out[y0:y0 + h, x0:x0 + w] = a          # the photograph itself, exactly as shot
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main():
    html = open(os.path.join(ROOT, 'shop.html'), encoding='utf-8').read()
    names = sorted(set(re.findall(r'media/shop/v[34]/([\w.-]+\.webp)', html)))
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        frame(original(name)).save(os.path.join(OUT, name), 'WEBP', quality=84, method=6)
        print(name)


if __name__ == '__main__':
    main()
