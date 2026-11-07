'use strict';

/* Reads the QR code off the photo of an ID card (lib/aadhaar-qr.js says
   what an Aadhaar QR holds). Pure JavaScript, so it runs the same on Vercel
   and on Firebase with nothing to pay for: jpeg-js turns the photo into
   pixels, jsQR finds and decodes the code.

   A phone photo is not a scan: the code is tilted, small in the frame, or a
   little soft. So it is tried at the size it came, then at half (a soft
   photo often reads better smaller), each way round for light on dark.
   Nothing here throws: a photo it cannot read is answered with null, and
   PFA's accounts team checks that one by eye. */

const jpeg = require('jpeg-js');
const jsQR = require('jsqr');
const AADHAAR_QR = require('./aadhaar-qr');

const MAX_EDGE = 2400;

function half(img) {
  const w = Math.floor(img.width / 2), h = Math.floor(img.height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = ((2 * y) * img.width + 2 * x) * 4 + c;
        const b = a + 4, d = a + img.width * 4, e = d + 4;
        out[o + c] = (img.data[a] + img.data[b] + img.data[d] + img.data[e]) >> 2;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/* The QR's text, or '' when none could be read. */
function qrText(bytes) {
  let img;
  try {
    img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 160 });
  } catch (_) { return ''; }
  if (!img || !img.width || !img.height) return '';
  let pic = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) };
  while (Math.max(pic.width, pic.height) > MAX_EDGE) pic = half(pic);
  for (const p of [pic, Math.min(pic.width, pic.height) > 500 ? half(pic) : null]) {
    if (!p) continue;
    try {
      const code = jsQR(p.data, p.width, p.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
    } catch (_) { /* the next size */ }
  }
  return '';
}

/* What an Aadhaar card's photo says about it: { kind, last4, uid, name }
   from its QR code, or null. Only JPEG is read: the forms send every photo
   as JPEG (assets/tax-id.js). */
function readAadhaar(bytes, contentType) {
  if (!bytes || !/jpe?g/i.test(String(contentType || ''))) return null;
  const text = qrText(bytes);
  return text ? AADHAAR_QR.parse(text) : null;
}

module.exports = { qrText, readAadhaar };
