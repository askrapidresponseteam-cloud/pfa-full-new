'use strict';

/* What the QR code on an Aadhaar card says (owner, 7 Nov 2026: "hope you can
   validate whether the input pan and aadhar number is valid or not.
   enterprise grade validation").

   Every Aadhaar card, e-Aadhaar and Aadhaar letter carries a QR code
   printed by UIDAI. Two kinds are in circulation:

     Secure QR (from 2019, and every e-Aadhaar): one long decimal number.
       As bytes it is a gzip stream; unzipped, its fields are separated by
       the byte 255. One of them is the reference ID: the last four digits
       of the Aadhaar number, then the moment the code was made
       (YYYYMMDDHHMMSSsss). The holder's name is the field after it. Newer
       versions begin with a "V2", "V3" or "V4" field; older ones do not,
       so the reference ID is found by its shape, not by its position.
     The older printed QR: XML, <PrintLetterBarcodeData uid="..."
       name="..." ...>, with the full number or the last four digits.

   So a photo of the card says which Aadhaar it is, without asking anyone:
   the number typed on the form has to end in the same four digits (all
   twelve, where the card gives all twelve). The QR is read, not checked
   against UIDAI's signature: that needs UIDAI's certificate and is a
   further step; what it gives is that the card in the photo and the
   number on the form are the same card. */

const zlib = require('zlib');

function unzip(bytes) {
  for (const fn of [zlib.gunzipSync, zlib.inflateSync, zlib.unzipSync, zlib.inflateRawSync]) {
    try { return fn(bytes); } catch (_) { /* the next */ }
  }
  return null;
}

function title(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function fromSecure(text) {
  let n;
  try { n = BigInt(text); } catch (_) { return null; }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const raw = unzip(Buffer.from(hex, 'hex'));
  if (!raw) return null;
  /* the text fields come before the photograph; 16 is more than any version has */
  const fields = [];
  let start = 0;
  for (let i = 0; i < raw.length && fields.length < 16; i += 1) {
    if (raw[i] === 255) { fields.push(raw.slice(start, i).toString('latin1')); start = i + 1; }
  }
  const at = fields.findIndex((f) => /^\d{18,24}$/.test(f));
  if (at < 0) return null;
  return {
    kind: 'aadhaar-secure-qr',
    version: /^V\d$/.test(fields[0]) ? fields[0] : 'V1',
    last4: fields[at].slice(0, 4),
    uid: '',
    name: title(fields[at + 1]),
    dob: title(fields[at + 2])
  };
}

function attr(xml, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(xml) || new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(xml);
  return m ? m[1] : '';
}

function fromXml(text) {
  const m = /<PrintLetterBarcodeData\b[^>]*>/i.exec(text) || /<QPD[AB]?\b[^>]*>/i.exec(text);
  if (!m) return null;
  const tag = m[0];
  const uid = attr(tag, 'uid').replace(/[^0-9xX]/g, '');
  const digits = uid.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return {
    kind: 'aadhaar-printed-qr',
    version: 'xml',
    last4: digits.slice(-4),
    uid: /^\d{12}$/.test(uid) ? uid : '',
    name: title(attr(tag, 'name') || attr(tag, 'n')),
    dob: title(attr(tag, 'dob') || attr(tag, 'yob') || attr(tag, 'd'))
  };
}

/* The QR's text, read: { kind, version, last4, uid, name, dob }, or null
   when it is not an Aadhaar QR. */
function parse(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^\d{200,}$/.test(t)) return fromSecure(t);
  if (/<\?xml|<PrintLetterBarcodeData|<QPD/i.test(t)) return fromXml(t);
  return null;
}

module.exports = { parse };
