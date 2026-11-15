'use strict';

/* The QR encoder has no third-party implementation to check against here, so
   it is made to prove itself: Reed-Solomon syndromes, a codeword count derived
   from the matrix geometry rather than from the encoder's own table, and a full
   read back out of the finished, masked matrix. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadQR() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'qr.js'), 'utf8');
  const context = { window: {}, unescape, encodeURIComponent, Math };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PFAQR;
}

const QR = loadQR();
const URL = 'https://peopleforanimalsindia.org/caregiver-card.html?id=PFA-CCT-7HQK2M4X';

test('the Galois field tables are self-consistent', () => {
  for (let i = 1; i < 256; i += 1) {
    assert.equal(QR._exp[QR._log[i]], i, `exp/log round trip failed at ${i}`);
  }
  // Multiplication must be commutative and have 1 as its identity.
  assert.equal(QR._mul(1, 87), 87);
  assert.equal(QR._mul(23, 45), QR._mul(45, 23));
  assert.equal(QR._mul(0, 99), 0);
});

test('Reed-Solomon syndromes are zero, which is what makes the codeword valid', () => {
  const code = QR.build(URL);
  const ecLength = QR.EC_CODEWORDS[code.version];

  /* QR's generator polynomial has roots alpha^0 .. alpha^(t-1), so those are
     the points a valid codeword must evaluate to zero at. Nothing about the
     encoder is trusted here beyond the field tables checked above. */
  for (let i = 0; i < ecLength; i += 1) {
    let syndrome = 0;
    for (let j = 0; j < code.codewords.length; j += 1) {
      const power = i === 0 ? 1 : QR._exp[(i * (code.codewords.length - 1 - j)) % 255];
      syndrome ^= QR._mul(code.codewords[j], power);
    }
    assert.equal(syndrome, 0, `syndrome ${i} is not zero`);
  }
});

test('the codeword count matches the space the matrix actually has', () => {
  const code = QR.build(URL);

  /* Rebuild only the function patterns and count the free modules. If this
     disagrees with the capacity table, the table is wrong. */
  const size = QR.SIZE[code.version];
  const reserved = [];
  for (let r = 0; r < size; r += 1) reserved.push(new Array(size).fill(false));

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) reserved[rr][cc] = true;
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 0; i < size; i += 1) { reserved[6][i] = true; reserved[i][6] = true; }

  const align = [null, null, 18, 22, 26, 30][code.version];
  if (align) {
    for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) reserved[align + r][align + c] = true;
  }

  for (let k = 0; k <= 8; k += 1) { reserved[8][k] = true; reserved[k][8] = true; }
  for (let m = 0; m < 8; m += 1) { reserved[8][size - 1 - m] = true; reserved[size - 1 - m][8] = true; }
  reserved[size - 8][8] = true;

  let free = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (!reserved[r][c]) free += 1;

  const expected = QR.DATA_CODEWORDS[code.version] + QR.EC_CODEWORDS[code.version];
  assert.equal(Math.floor(free / 8), expected,
    `version ${code.version} geometry holds ${Math.floor(free / 8)} codewords, table says ${expected}`);
});

test('format information survives its BCH encoding', () => {
  for (let pattern = 0; pattern < 8; pattern += 1) {
    const bits = QR._formatBits(pattern);
    const unmasked = bits ^ 0x5412;

    // The BCH remainder of a correct format word is zero.
    let value = unmasked;
    for (let i = 4; i >= 0; i -= 1) {
      if ((value >> (i + 10)) & 1) value ^= 0x537 << i;
    }
    assert.equal(value & 0x3FF, 0, `format BCH remainder non-zero for mask ${pattern}`);
    assert.equal((unmasked >> 13) & 0x03, 0x01, 'error-correction level must read back as L');
    assert.equal((unmasked >> 10) & 0x07, pattern, 'mask pattern must read back unchanged');
  }
});

test('the payload reads back out of the finished, masked matrix', () => {
  const code = QR.build(URL);
  const size = code.size;

  // Recreate the reservation map exactly as the encoder does.
  const reserved = [];
  for (let r = 0; r < size; r += 1) reserved.push(new Array(size).fill(false));
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) reserved[rr][cc] = true;
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) { reserved[6][i] = true; reserved[i][6] = true; }
  const align = [null, null, 18, 22, 26, 30][code.version];
  if (align) for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) reserved[align + r][align + c] = true;
  reserved[size - 8][8] = true;
  for (let k = 0; k <= 8; k += 1) { reserved[8][k] = true; reserved[k][8] = true; }
  for (let m = 0; m < 8; m += 1) { reserved[8][size - 1 - m] = true; reserved[size - 1 - m][8] = true; }

  // Walk the same serpentine, undoing the mask as we go.
  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        let bit = code.modules[row][col];
        if (QR._maskBit(code.pattern, row, col)) bit ^= 1;
        bits.push(bit);
      }
    }
    upward = !upward;
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }

  // Decode the header the way a reader would.
  const mode = bytes[0] >> 4;
  assert.equal(mode, 4, 'mode indicator must read back as byte mode');
  const length = ((bytes[0] & 0x0F) << 4) | (bytes[1] >> 4);
  assert.equal(length, URL.length, 'declared length must match the payload');

  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(((bytes[1 + i] & 0x0F) << 4) | (bytes[2 + i] >> 4));
  }
  assert.equal(text, URL, 'the URL must read back byte for byte');
});

test('a card URL fits, and an oversized payload is refused rather than silently truncated', () => {
  const code = QR.build(URL);
  assert.ok(code.version >= 1 && code.version <= 5);
  assert.throws(() => QR.build('x'.repeat(200)), /too long/);
});

/* 15 Nov 2026: the format information was written transposed, so the code
   proved itself to its own reader here and to no phone. It is now placed
   where ISO/IEC 18004 puts it, read from those places below, and the code
   for a card online was checked with two independent readers (zxing-cpp
   and OpenCV), which both read it back exactly; its fingerprint is kept
   so the encoder cannot drift from what they read. */
test('the format information sits where the standard puts it, so a phone can read the code', () => {
  for (const text of ['A', 'https://peopleforanimalsindia.org/card?id=PFA-CCT-AB2CD3EF', 'x'.repeat(100)]) {
    const q = QR.matrix(text);
    const m = q.modules;
    const n = q.size;
    const want = QR._formatBits(q.pattern);
    const bit = (i) => (want >> i) & 1;
    /* first copy: bits 0-5 down column 8, 6 at row 7, 7 at (8,8), 8 at column 7, 9-14 leftward along row 8 */
    for (let i = 0; i < 6; i += 1) assert.equal(m[i][8], bit(i), `${text.slice(0, 20)}: bit ${i}`);
    assert.equal(m[7][8], bit(6));
    assert.equal(m[8][8], bit(7));
    assert.equal(m[8][7], bit(8));
    for (let i = 9; i < 15; i += 1) assert.equal(m[8][14 - i], bit(i), `bit ${i}`);
    /* second copy: bits 0-7 along row 8 from the right, 8-14 up column 8 from the bottom */
    for (let i = 0; i < 8; i += 1) assert.equal(m[8][n - 1 - i], bit(i), `copy bit ${i}`);
    for (let i = 8; i < 15; i += 1) assert.equal(m[n - 15 + i][8], bit(i), `copy bit ${i}`);
    assert.equal(m[n - 8][8], 1, 'the dark module');
    assert.equal(want >> 13, 0b01 ^ 0b10, 'level L (01), under the format mask');
  }
  const card = QR.matrix('https://peopleforanimalsindia.org/card?id=PFA-MBR-AB2CD3EF');
  const print = require('node:crypto').createHash('sha256').update(card.modules.map((r) => r.join('')).join('|')).digest('hex');
  assert.equal(print, '67537de918cd25d834f232a9354f8460375121758aa94aa1df526edf645e7493', 'the code two independent readers read back exactly');
});
