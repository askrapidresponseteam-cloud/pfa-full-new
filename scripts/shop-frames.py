#!/usr/bin/env python3
"""Every shop photograph on one canvas shape, nothing of it cut.

Owner, 30 Oct 2026: "photos render differently in each tile looks diff and
odd. make it uniform and supreme". And, standing since 26 Oct 2026: "no
person's head or any part can be clipped anywhere".

The photographs came from many shoots: 4:5, 3:5, 2:3 and as tall as 9:20,
each on its own backdrop. Shown whole in one frame, each left a different
band of flat ground around it. So each photograph is widened (or heightened)
to 2:3 by carrying its own backdrop out to the new edges: every row (or
column) of the new margin takes the colour of the photograph's own edge
beside it, softened along the edge and given the photograph's grain, so it
reads as more of the same backdrop. The person is never moved, scaled or
cut; the canvas around them grows. More of the margin goes to the side whose
edge is plain backdrop, so a shoe or an elbow at the other edge is not drawn
out.

Writes media/shop/v3/<same name>.webp; the originals stay as they were.
Run: python3 scripts/shop-frames.py
"""
import os
import re
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RATIO = 2 / 3          # width / height of every shop photograph
EDGE = 10              # pixels of the photograph's edge a margin is read from
JOIN = 4               # pixels either side of a join that are softened
OUT = os.path.join(ROOT, 'media', 'shop', 'v3')


def plainness(strip):
    """How much an edge strip varies along its length: low is plain backdrop."""
    flat = strip.reshape(-1, strip.shape[-1]).astype(np.float32)
    return float(np.mean(np.std(flat, axis=0)))


BUSY = 14.0           # an edge varying more than this is not plain backdrop


def split(a_strip, b_strip, total):
    """Share `total` pixels of margin between two sides. An edge that is the
    person (legs cut by the shot, an arm) gets none if the other is plain
    backdrop; otherwise the plainer side gets more."""
    a, b = plainness(a_strip), plainness(b_strip)
    if a >= BUSY > b:
        return 0, total
    if b >= BUSY > a:
        return total, 0
    a, b = a + 1.0, b + 1.0
    share = (1 / a) / ((1 / a) + (1 / b))
    share = min(0.85, max(0.15, share))
    first = int(round(total * share))
    return first, total - first


def band(strip, depth, outward):
    """`depth` columns of backdrop beside an edge strip (length x EDGE x 3).

    Right at the join each row is the photograph's own edge colour, so
    nothing jumps; moving out it eases into the backdrop's trend down the
    edge, read with a long median that ignores an arm or a pocket touching
    the edge, so those fade out instead of being drawn out as streaks.
    `outward` is +1 when the margin grows away from column 0 of the strip."""
    if depth <= 0:
        return np.zeros((strip.shape[0], 0, 3), np.float32)
    length = strip.shape[0]
    edge_col = strip[:, 0] if outward < 0 else strip[:, -1]
    exact = cv2.GaussianBlur(edge_col.astype(np.float32)[:, None, :], (1, 0), sigmaX=0.1, sigmaY=2)[:, 0]
    row = np.median(strip, axis=1).astype(np.uint8)[:, None, :]
    # the backdrop's own trend down the edge: a median over two fifths of
    # the length (read at a tenth of the size), so even a long run of arm or
    # trouser at the edge is read past
    small = cv2.resize(row, (1, max(8, length // 10)), interpolation=cv2.INTER_AREA)
    k = max(5, (int(small.shape[0] * 0.4)) | 1)
    trend = cv2.medianBlur(small, min(k, 255)) if k <= 255 else small
    trend = cv2.resize(trend, (1, length), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    trend = cv2.GaussianBlur(trend, (1, 0), sigmaX=0.1, sigmaY=max(6.0, length / 30))[:, 0]
    fade = min(depth, max(24, length // 30))
    d = np.arange(depth, dtype=np.float32)            # distance from the join
    t = np.clip(d / fade, 0, 1)
    t = t * t * (3 - 2 * t)                            # smoothstep
    out = exact[:, None, :] * (1 - t)[None, :, None] + trend[:, None, :] * t[None, :, None]
    return out if outward > 0 else out[:, ::-1]


def trim(img):
    """A thin frame line (up to 6 pixels) a shoot left on an edge is not the
    photograph and would be drawn out as a stripe: it is taken off."""
    def lines(view):
        inner = view[:, 8:16].reshape(-1, 3).astype(np.float32).mean(axis=0)
        n = 0
        for i in range(6):
            if np.abs(view[:, i].astype(np.float32).mean(axis=0) - inner).max() > 18:
                n = i + 1
        return n
    h, w = img.shape[:2]
    left, right = lines(img), lines(img[:, ::-1])
    top, bottom = lines(img.transpose(1, 0, 2)), lines(img.transpose(1, 0, 2)[:, ::-1])
    return img[top:h - bottom, left:w - right]


def grain_like(img, shape, seed):
    noise = img.astype(np.float32) - cv2.GaussianBlur(img.astype(np.float32), (0, 0), 1.2)
    level = float(np.std(noise)) * 0.6
    return np.random.default_rng(seed).normal(0, level, shape).astype(np.float32)


def frame(img):
    """The photograph on a 2:3 canvas, its own pixels exactly as shot apart
    from JOIN pixels at each join."""
    img = trim(img)
    h, w = img.shape[:2]
    if abs(w / h - RATIO) < 0.004 or w > h:
        # a side-by-side picture (front and back in one) is left as it is
        return img
    tall = w / h < RATIO
    # work as if the margin goes left and right; a wide photograph is turned
    src = img if tall else img.transpose(1, 0, 2)
    H, W = src.shape[:2]
    depth = int(round(H * RATIO)) - W if tall else int(round(H / RATIO)) - W
    if tall:
        a, b = split(src[:, :EDGE], src[:, -EDGE:], depth)
    else:
        # a photograph wider than 2:3 is given head room only: its foot is
        # where the shot cut the legs or the floor, and is never drawn out
        a, b = depth, 0
    left = band(src[:, :EDGE], a, -1)
    right = band(src[:, -EDGE:], b, +1)
    out = np.concatenate([left, src.astype(np.float32), right], axis=1)
    margin = np.ones(out.shape[:2], np.float32)
    margin[:, a:a + W] = 0
    out += grain_like(src, out.shape, 7) * margin[..., None]
    # soften the two joins only
    soft = cv2.GaussianBlur(out, (0, 0), 2.5)
    mask = np.zeros(out.shape[:2], np.float32)
    for x in (a, a + W):
        mask[:, max(0, x - JOIN):x + JOIN] = 1
    out = out * (1 - mask[..., None]) + soft * mask[..., None]
    # the photograph itself, exactly as shot, inside the joins
    out[:, a + JOIN:a + W - JOIN] = src[:, JOIN:W - JOIN]
    out = np.clip(out, 0, 255).astype(np.uint8)
    return out if tall else out.transpose(1, 0, 2).copy()


def main():
    html = open(os.path.join(ROOT, 'shop.html'), encoding='utf8').read()
    # the page names the framed copies; each is made from its original, in
    # media/shop/v2/ for the 2025 shoots and media/shop/ for the older ones
    names = []
    for base in sorted(set(re.findall(r'media/shop/v3/([\w.-]+\.webp)', html))):
        v2 = os.path.join('media', 'shop', 'v2', base)
        names.append(v2 if os.path.exists(os.path.join(ROOT, v2)) else os.path.join('media', 'shop', base))
    os.makedirs(OUT, exist_ok=True)
    for rel in names:
        img = cv2.imread(os.path.join(ROOT, rel), cv2.IMREAD_COLOR)
        if img is None:
            print(f'cannot read {rel}', file=sys.stderr)
            return 1
        out = frame(img)
        cv2.imwrite(os.path.join(OUT, os.path.basename(rel)), out, [cv2.IMWRITE_WEBP_QUALITY, 86])
        print(f'{rel}  {img.shape[1]}x{img.shape[0]} -> {out.shape[1]}x{out.shape[0]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
