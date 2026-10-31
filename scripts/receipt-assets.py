"""Builds lib/receipt-assets.js: what the donation receipt PDF is drawn with.

The receipt (lib/donation-receipt.js) is written by hand as a PDF, on the
server, with no PDF library. It carries the site's own type, Marcellus for
the headings and EB Garamond for everything with figures in it, embedded as
TrueType from fonts/, with each font's widths for the WinAnsi characters so
lines can be measured and set; and the PFA logo (img/mail/logo-ink.png, the ink one), as a JPEG on white.

Run again only if a font or the logo changes:
    python3 scripts/receipt-assets.py
"""
import base64, io, json, os
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# WinAnsiEncoding, codes 128 to 159 (the rest are Latin-1)
WIN = {128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x02C6,
       137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017D, 145: 0x2018, 146: 0x2019, 147: 0x201C,
       148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A,
       156: 0x0153, 158: 0x017E, 159: 0x0178}


def font(path, name):
    t = TTFont(os.path.join(ROOT, path))
    t.flavor = None
    raw = io.BytesIO()
    t.save(raw)
    upm = t['head'].unitsPerEm
    scale = 1000.0 / upm
    cmap = t.getBestCmap()
    hmtx = t['hmtx'].metrics
    widths = []
    for code in range(32, 256):
        uni = WIN.get(code, code)
        glyph = cmap.get(uni)
        widths.append(round(hmtx[glyph][0] * scale) if glyph else 0)
    os2 = t['OS/2']
    head = t['head']
    return {
        'name': name,
        'ttf': base64.b64encode(raw.getvalue()).decode('ascii'),
        'widths': widths,
        'ascent': round(os2.sTypoAscender * scale),
        'descent': round(os2.sTypoDescender * scale),
        'capHeight': round(getattr(os2, 'sCapHeight', 0) * scale) or 700,
        'bbox': [round(head.xMin * scale), round(head.yMin * scale), round(head.xMax * scale), round(head.yMax * scale)],
    }


def logo():
    im = Image.open(os.path.join(ROOT, 'img', 'mail', 'logo-ink.png')).convert('RGBA')
    white = Image.new('RGBA', im.size, (255, 255, 255, 255))
    white.alpha_composite(im)
    out = white.convert('RGB')
    out = out.resize((600, round(600 * im.size[1] / im.size[0])), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, 'JPEG', quality=92, optimize=True)
    return {'jpeg': base64.b64encode(buf.getvalue()).decode('ascii'), 'width': out.size[0], 'height': out.size[1]}


data = {
    'display': font('fonts/marcellus-latin.woff2', 'Marcellus'),
    'text': font('fonts/eb-garamond-latin-500.woff2', 'EBGaramond-Medium'),
    'logo': logo(),
}
with open(os.path.join(ROOT, 'lib', 'receipt-assets.js'), 'w') as f:
    f.write("'use strict';\n\n/* Made by scripts/receipt-assets.py: do not edit. The donation receipt's\n   fonts (OFL: fonts/OFL-*.txt) and logo, for lib/donation-receipt.js. */\n\nmodule.exports = ")
    f.write(json.dumps(data, separators=(',', ':')))
    f.write(';\n')
print('lib/receipt-assets.js', os.path.getsize(os.path.join(ROOT, 'lib', 'receipt-assets.js')))
