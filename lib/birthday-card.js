'use strict';

/* The birthday card, drawn on the server for the 8 am email (owner, 17 Nov
   2026: "automatically trigger the birthday greetings between 6-7 A.M on
   that special day").

   The card is drawn by assets/birthday-card.js, the same file the panel
   draws it with, so the card that arrives by email is the card the panel
   shows: the same words, the same layout, the same rule that keeps every
   line clear of the flowers. That file draws on a browser canvas; here it is
   given a small canvas of its own that does only what it asks for:

     - the dahlias (media/birthday/card-flowers.jpg) read with jpeg-js, and
       PFA's mark (card-logo.png) with png-js, scaled down by averaging;
     - text set with fontkit, the font engine the site's PDFs already use:
       Marcellus (fonts/), and Noto Serif Devanagari for a name in Hindi,
       chosen letter by letter as a browser would, shaped as a browser
       would, and filled with 16 samples a pixel so its edges are smooth;
     - the result saved as a JPEG (jpeg-js), small enough for an email.

   No new package: jpeg-js is the site's own, and fontkit and png-js come
   with pdfkit. A name in a script none of these fonts has (Tamil, say) is
   drawn as the card without a name, never as empty boxes; the letter itself
   still opens with the name.

   card(name) -> Promise<{ jpeg: Buffer, name, lines, fileName, named }> */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
/* named in full, so a bundler that follows files finds each one */
const FILES = {
  script: path.join(__dirname, '..', 'assets', 'birthday-card.js'),
  flowers: path.join(__dirname, '..', 'media', 'birthday', 'card-flowers.jpg'),
  logo: path.join(__dirname, '..', 'media', 'birthday', 'card-logo.png'),
  latin: path.join(__dirname, '..', 'fonts', 'marcellus-latin.woff2'),
  latinExt: path.join(__dirname, '..', 'fonts', 'marcellus-latin-ext.woff2'),
  devanagari: path.join(__dirname, '..', 'fonts', 'noto-serif-devanagari-400.woff2')
};

/* pdfkit's own fontkit and png-js, wherever npm put them */
function viaPdfkit(name) {
  try { return require(name); } catch (_) {
    return require(require.resolve(name, { paths: [path.dirname(require.resolve('pdfkit'))] }));
  }
}

let fontsCache = null;
function fonts() {
  if (fontsCache) return fontsCache;
  const fontkit = viaPdfkit('fontkit');
  fontsCache = [FILES.latin, FILES.latinExt, FILES.devanagari].map((file) => fontkit.create(fs.readFileSync(file)));
  return fontsCache;
}

/* the first font that has every letter of a run, letter by letter */
function fontFor(cp) {
  const all = fonts();
  for (const f of all) if (f.hasGlyphForCodePoint(cp)) return f;
  return null;
}
/* a line cut into runs, each in one font; a space keeps the run it is in */
function runs(text) {
  const out = [];
  for (const ch of Array.from(String(text))) {
    const cp = ch.codePointAt(0);
    const f = /\s/.test(ch) && out.length ? out[out.length - 1].font : fontFor(cp);
    if (!f) return null;
    if (out.length && out[out.length - 1].font === f) out[out.length - 1].text += ch;
    else out.push({ font: f, text: ch });
  }
  return out;
}
/* every font can draw this text */
function drawable(text) { return runs(text) !== null; }

function sizeOf(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return m ? Number(m[1]) : 10;
}

/* the line's glyphs, placed: [{ glyph, x, y, scale }] from the pen at 0,0 */
function shape(text, size) {
  const parts = runs(text) || [];
  const placed = [];
  let x = 0; let top = 0; let bottom = 0;
  for (const part of parts) {
    const scale = size / part.font.unitsPerEm;
    const laid = part.font.layout(part.text);
    laid.glyphs.forEach((glyph, i) => {
      const pos = laid.positions[i];
      const gx = x + pos.xOffset * scale;
      const gy = -pos.yOffset * scale;
      placed.push({ glyph, x: gx, y: gy, scale });
      const b = glyph.bbox;
      if (b && isFinite(b.maxY)) {
        top = Math.max(top, b.maxY * scale - gy);
        bottom = Math.max(bottom, -b.minY * scale + gy);
      }
      x += pos.xAdvance * scale;
    });
  }
  return { placed, width: x, ascent: top, descent: bottom };
}

/* ---- filling a path: nonzero winding, 4 by 4 samples a pixel ---- */
const SUB = 4;
function flatten(commands, ox, oy, scale) {
  const polys = [];
  let cur = null; let px = 0; let py = 0; let sx = 0; let sy = 0;
  const pt = (x, y) => [ox + x * scale, oy - y * scale];
  const add = (x, y) => { cur.push(pt(x, y)); px = x; py = y; };
  for (const c of commands) {
    const a = c.args;
    if (c.command === 'moveTo') { cur = []; polys.push(cur); add(a[0], a[1]); sx = a[0]; sy = a[1]; }
    else if (c.command === 'lineTo') add(a[0], a[1]);
    else if (c.command === 'quadraticCurveTo') {
      const steps = 8;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps; const u = 1 - t;
        add(u * u * px + 2 * u * t * a[0] + t * t * a[2], u * u * py + 2 * u * t * a[1] + t * t * a[3]);
      }
    } else if (c.command === 'bezierCurveTo') {
      const steps = 10; const x0 = px; const y0 = py;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps; const u = 1 - t;
        add(u * u * u * x0 + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4],
          u * u * u * y0 + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5]);
      }
    } else if (c.command === 'closePath' && cur) { add(sx, sy); }
  }
  return polys;
}

function fillPolys(polys, rgba, width, height, ink) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i += 1) {
      const [x0, y0] = poly[i]; const [x1, y1] = poly[(i + 1) % poly.length];
      minX = Math.min(minX, x0); maxX = Math.max(maxX, x0); minY = Math.min(minY, y0); maxY = Math.max(maxY, y0);
      if (y0 !== y1) edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
    }
  }
  if (!edges.length) return;
  const bx0 = Math.max(0, Math.floor(minX)); const bx1 = Math.min(width, Math.ceil(maxX) + 1);
  const by0 = Math.max(0, Math.floor(minY)); const by1 = Math.min(height, Math.ceil(maxY) + 1);
  const bw = bx1 - bx0;
  if (bw <= 0 || by1 <= by0) return;
  const cover = new Float32Array(bw);
  for (let py = by0; py < by1; py += 1) {
    cover.fill(0);
    let any = false;
    for (let s = 0; s < SUB; s += 1) {
      const y = py + (s + 0.5) / SUB;
      const xs = [];
      for (const e of edges) {
        if (y >= e[1] && y < e[3]) xs.push([e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1]), e[4]]);
      }
      if (!xs.length) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i += 1) {
        wind += xs[i][1];
        if (!wind) continue;
        /* the span xs[i] to xs[i+1], sampled SUB times across each pixel */
        const a = xs[i][0]; const b = xs[i + 1][0];
        const first = Math.max(bx0, Math.floor(a)); const last = Math.min(bx1 - 1, Math.floor(b));
        for (let px = first; px <= last; px += 1) {
          let n = 0;
          for (let k = 0; k < SUB; k += 1) { const x = px + (k + 0.5) / SUB; if (x >= a && x < b) n += 1; }
          if (n) { cover[px - bx0] += n; any = true; }
        }
      }
    }
    if (!any) continue;
    for (let i = 0; i < bw; i += 1) {
      const a = Math.min(1, cover[i] / (SUB * SUB));
      if (!a) continue;
      const o = (py * width + bx0 + i) * 4;
      rgba[o] = Math.round(rgba[o] * (1 - a) + ink[0] * a);
      rgba[o + 1] = Math.round(rgba[o + 1] * (1 - a) + ink[1] * a);
      rgba[o + 2] = Math.round(rgba[o + 2] * (1 - a) + ink[2] * a);
      rgba[o + 3] = 255;
    }
  }
}

function inkOf(style) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(style || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* an image laid on the canvas at x, y, w, h: copied when it is the same size,
   averaged down otherwise, over what is there by its alpha */
function lay(dst, dw, dh, img, x, y, w, h) {
  const sw = img.width; const sh = img.height; const src = img.data;
  if (sw === w && sh === h && x === 0 && y === 0 && w === dw && h === dh) {
    dst.set(src.subarray(0, dst.length));
    return;
  }
  const fx = sw / w; const fy = sh / h;
  for (let ty = 0; ty < h; ty += 1) {
    const dy = y + ty; if (dy < 0 || dy >= dh) continue;
    const y0 = ty * fy; const y1 = y0 + fy;
    for (let tx = 0; tx < w; tx += 1) {
      const dx = x + tx; if (dx < 0 || dx >= dw) continue;
      const x0 = tx * fx; const x1 = x0 + fx;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const k = wx * wy; const o = (sy * sw + sx) * 4; const al = src[o + 3] / 255;
          r += src[o] * al * k; g += src[o + 1] * al * k; b += src[o + 2] * al * k; a += al * k; wsum += k;
        }
      }
      if (!a) continue;
      const al = a / wsum; const o = (dy * dw + dx) * 4;
      dst[o] = Math.round(dst[o] * (1 - al) + (r / a) * al);
      dst[o + 1] = Math.round(dst[o + 1] * (1 - al) + (g / a) * al);
      dst[o + 2] = Math.round(dst[o + 2] * (1 - al) + (b / a) * al);
      dst[o + 3] = 255;
    }
  }
}

/* ---- the canvas assets/birthday-card.js asks for ---- */
function makeCanvas() {
  const canvas = {
    width: 300, height: 150, data: null,
    setAttribute() {}, getAttribute() { return null; },
    getContext() { return ctx; }
  };
  const pixels = () => {
    if (!canvas.data || canvas.data.length !== canvas.width * canvas.height * 4) canvas.data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    return canvas.data;
  };
  const ctx = {
    font: '10px serif', fillStyle: '#000000', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr',
    clearRect() { pixels().fill(0); },
    drawImage(img, x, y, w, h) { lay(pixels(), canvas.width, canvas.height, img, Math.round(x), Math.round(y), Math.round(w == null ? img.width : w), Math.round(h == null ? img.height : h)); },
    getImageData(x, y, w, h) {
      if (x || y || w !== canvas.width || h !== canvas.height) throw new Error('only the whole canvas is read');
      return { width: w, height: h, data: pixels() };
    },
    measureText(text) {
      const s = shape(text, sizeOf(ctx.font));
      return { width: s.width, actualBoundingBoxAscent: s.ascent, actualBoundingBoxDescent: s.descent };
    },
    fillText(text, x, y) {
      const size = sizeOf(ctx.font);
      const s = shape(text, size);
      const left = ctx.textAlign === 'center' ? x - s.width / 2 : (ctx.textAlign === 'right' || ctx.textAlign === 'end') ? x - s.width : x;
      const polys = [];
      for (const p of s.placed) for (const poly of flatten(p.glyph.path.commands, left + p.x, y + p.y, p.scale)) polys.push(poly);
      fillPolys(polys, pixels(), canvas.width, canvas.height, inkOf(ctx.fillStyle));
    }
  };
  return canvas;
}

function decodeFile(file) {
  const bytes = fs.readFileSync(file);
  if (/\.jpe?g$/i.test(file)) {
    const img = require('jpeg-js').decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
    return Promise.resolve({ width: img.width, height: img.height, data: img.data });
  }
  const PNG = viaPdfkit('png-js');
  const png = new PNG(bytes);
  return new Promise((resolve) => png.decodePixels((raw) => {
    /* png-js gives the colour channels it has; this logo is RGBA */
    const n = png.width * png.height;
    const ch = raw.length / n;
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i += 1) {
      data[i * 4] = raw[i * ch]; data[i * 4 + 1] = raw[i * ch + (ch >= 3 ? 1 : 0)]; data[i * 4 + 2] = raw[i * ch + (ch >= 3 ? 2 : 0)];
      data[i * 4 + 3] = ch === 4 ? raw[i * ch + 3] : ch === 2 ? raw[i * ch + 1] : 255;
    }
    resolve({ width: png.width, height: png.height, data });
  }));
}

/* the Image the script makes: '/media/birthday/...' read from the tree */
function makeImage() {
  return class Img {
    constructor() { this.onload = null; this.onerror = null; this.width = 0; this.height = 0; this.data = null; }
    set src(url) {
      const rel = String(url || '').replace(/^\/+/, '');
      const file = rel === 'media/birthday/card-flowers.jpg' ? FILES.flowers : rel === 'media/birthday/card-logo.png' ? FILES.logo : path.join(ROOT, rel);
      decodeFile(file).then((img) => {
        Object.assign(this, img);
        if (this.onload) this.onload();
      }, (error) => { if (this.onerror) this.onerror(error); });
    }
  };
}

let api = null;
function renderer() {
  if (api) return api;
  const window = {};
  const sandbox = {
    window,
    document: { createElement: () => makeCanvas(), fonts: null },
    Image: makeImage(),
    Intl, Promise, Math, String, Array, Number, Error, RangeError, Object, Date, JSON, console, setTimeout
  };
  vm.runInNewContext(fs.readFileSync(FILES.script, 'utf8'), sandbox, { filename: 'birthday-card.js' });
  api = window.PFABirthdayCard;
  return api;
}

/* The card for a name, as a JPEG. A name with a letter none of the fonts
   has gives the card without a name. */
async function card(value, options) {
  const o = options || {};
  const C = renderer();
  let name = '';
  try { name = C.clean(value); } catch (_) { name = ''; }
  const named = Boolean(name) && drawable(name);
  const canvas = makeCanvas();
  let r;
  try { r = await C.draw(canvas, named ? name : ''); } catch (_) { r = await C.draw(canvas, ''); }
  const jpeg = require('jpeg-js').encode({ width: canvas.width, height: canvas.height, data: canvas.data }, o.quality || 90).data;
  return { jpeg: Buffer.from(jpeg), name: r.name, lines: Array.from(r.lines || [], String), named: Boolean(r.name), fileName: C.fileName(name).replace(/\.png$/, '.jpg') };
}

module.exports = { card, drawable, FILES };
