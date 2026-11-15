/* Minimal QR encoder for the card back.

   Deliberately narrow: byte mode, error-correction level L, versions 1-5 only.
   Every one of those versions is a SINGLE error-correction block, which removes
   block interleaving - the part of the QR specification that is easiest to get
   quietly wrong. A card carrying a code that scans to the wrong thing would be
   worse than a card with no code, so the encoder is kept to the shape that can
   be verified end to end (see test/qr.test.js: Reed-Solomon syndromes, the
   codeword count derived from the matrix itself, and a full round-trip read
   back out of the placed and masked matrix). */
(function () {
  'use strict';

  var SIZE = [null, 21, 25, 29, 33, 37];
  var DATA_CODEWORDS = [null, 19, 34, 55, 80, 108];   // level L
  var EC_CODEWORDS = [null, 7, 10, 15, 20, 26];       // level L
  var ALIGN = [null, null, 18, 22, 26, 30];           // single alignment centre

  /* GF(256), primitive polynomial 0x11D. */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j += 1) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function generator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d += 1) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i += 1) {
        next[i] ^= poly[i];
        next[i + 1] ^= mul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  function remainder(data, ecLength) {
    var gen = generator(ecLength);
    var buffer = data.concat(new Array(ecLength).fill(0));
    for (var i = 0; i < data.length; i += 1) {
      var factor = buffer[i];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j += 1) {
        buffer[i + j] ^= mul(gen[j], factor);
      }
    }
    return buffer.slice(data.length);
  }

  function utf8(text) {
    var out = [];
    var encoded = unescape(encodeURIComponent(String(text)));
    for (var i = 0; i < encoded.length; i += 1) out.push(encoded.charCodeAt(i) & 0xff);
    return out;
  }

  function chooseVersion(byteLength) {
    for (var v = 1; v <= 5; v += 1) {
      // 4 bits mode + 8 bits length for versions 1-9.
      if (byteLength + 2 <= DATA_CODEWORDS[v]) return v;
    }
    return 0;
  }

  /* Mode indicator, length, payload, terminator, pad bytes. */
  function encodeData(bytes, version) {
    var capacity = DATA_CODEWORDS[version];
    var bits = [];

    function push(value, length) {
      for (var i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    }

    push(4, 4);                 // byte mode
    push(bytes.length, 8);
    bytes.forEach(function (b) { push(b, 8); });

    var capacityBits = capacity * 8;
    for (var t = 0; t < 4 && bits.length < capacityBits; t += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }

    var pad = [0xEC, 0x11];
    var p = 0;
    while (codewords.length < capacity) {
      codewords.push(pad[p % 2]);
      p += 1;
    }
    return codewords;
  }

  function blank(size) {
    var modules = [];
    var reserved = [];
    for (var r = 0; r < size; r += 1) {
      modules.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }
    return { modules: modules, reserved: reserved, size: size };
  }

  function placeFinder(grid, row, col) {
    for (var r = -1; r <= 7; r += 1) {
      for (var c = -1; c <= 7; c += 1) {
        var rr = row + r;
        var cc = col + c;
        if (rr < 0 || cc < 0 || rr >= grid.size || cc >= grid.size) continue;
        var inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        var inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid.modules[rr][cc] = (inRing || inCore) ? 1 : 0;
        grid.reserved[rr][cc] = true;
      }
    }
  }

  function placeAlignment(grid, centre) {
    for (var r = -2; r <= 2; r += 1) {
      for (var c = -2; c <= 2; c += 1) {
        var rr = centre + r;
        var cc = centre + c;
        var edge = Math.max(Math.abs(r), Math.abs(c));
        grid.modules[rr][cc] = (edge === 1) ? 0 : 1;
        grid.reserved[rr][cc] = true;
      }
    }
  }

  function placeFunction(grid, version) {
    placeFinder(grid, 0, 0);
    placeFinder(grid, 0, grid.size - 7);
    placeFinder(grid, grid.size - 7, 0);

    for (var i = 8; i < grid.size - 8; i += 1) {
      var bit = (i % 2 === 0) ? 1 : 0;
      grid.modules[6][i] = bit;
      grid.reserved[6][i] = true;
      grid.modules[i][6] = bit;
      grid.reserved[i][6] = true;
    }

    if (ALIGN[version]) placeAlignment(grid, ALIGN[version]);

    // Dark module, always set.
    grid.modules[grid.size - 8][8] = 1;
    grid.reserved[grid.size - 8][8] = true;

    // Format information area, reserved now and written after masking.
    for (var k = 0; k <= 8; k += 1) {
      if (!grid.reserved[8][k]) { grid.reserved[8][k] = true; grid.modules[8][k] = 0; }
      if (!grid.reserved[k][8]) { grid.reserved[k][8] = true; grid.modules[k][8] = 0; }
    }
    for (var m = 0; m < 8; m += 1) {
      grid.reserved[8][grid.size - 1 - m] = true;
      grid.reserved[grid.size - 1 - m][8] = true;
    }
  }

  /* Upward-then-downward serpentine over the two-module-wide columns. */
  function placeData(grid, codewords) {
    var bits = [];
    codewords.forEach(function (byte) {
      for (var i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
    });

    var index = 0;
    var upward = true;
    for (var right = grid.size - 1; right > 0; right -= 2) {
      if (right === 6) right -= 1;   // the vertical timing column is skipped
      for (var step = 0; step < grid.size; step += 1) {
        var row = upward ? grid.size - 1 - step : step;
        for (var offset = 0; offset < 2; offset += 1) {
          var col = right - offset;
          if (grid.reserved[row][col]) continue;
          grid.modules[row][col] = index < bits.length ? bits[index] : 0;
          index += 1;
        }
      }
      upward = !upward;
    }
    return index;
  }

  function maskBit(pattern, row, col) {
    switch (pattern) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    }
  }

  function applyMask(grid, pattern) {
    for (var r = 0; r < grid.size; r += 1) {
      for (var c = 0; c < grid.size; c += 1) {
        if (grid.reserved[r][c]) continue;
        if (maskBit(pattern, r, c)) grid.modules[r][c] ^= 1;
      }
    }
  }

  /* Format information: 5 data bits, BCH(15,5), XORed with 0x5412. */
  function formatBits(pattern) {
    var data = (0x01 << 3) | pattern;           // 01 = level L
    var value = data << 10;
    for (var i = 4; i >= 0; i -= 1) {
      if ((value >> (i + 10)) & 1) value ^= 0x537 << i;
    }
    return ((data << 10) | value) ^ 0x5412;
  }

  function placeFormat(grid, pattern) {
    var bits = formatBits(pattern);
    var size = grid.size;
    for (var i = 0; i < 15; i += 1) {
      var bit = (bits >> i) & 1;

      /* Around the top-left finder: bits 0 to 7 down column 8 (skipping
         the timing row), bits 8 to 14 leftward along row 8 (skipping the
         timing column), as ISO/IEC 18004 places them. Until 15 Nov 2026
         these were written transposed, which no phone reads; checked now
         against an independent reader (test/qr.test.js). */
      if (i < 6) grid.modules[i][8] = bit;
      else if (i === 6) grid.modules[7][8] = bit;
      else if (i === 7) grid.modules[8][8] = bit;
      else if (i === 8) grid.modules[8][7] = bit;
      else grid.modules[8][14 - i] = bit;

      // The duplicate copy: bits 0 to 7 along row 8 from the right edge,
      // bits 8 to 14 up column 8 from the bottom.
      if (i < 8) grid.modules[8][size - 1 - i] = bit;
      else grid.modules[size - 15 + i][8] = bit;
    }
    grid.modules[size - 8][8] = 1;
  }

  function penalty(grid) {
    var size = grid.size;
    var score = 0;
    var r;
    var c;

    // Runs of five or more.
    for (r = 0; r < size; r += 1) {
      var runV = 1;
      var runH = 1;
      for (c = 1; c < size; c += 1) {
        runH = grid.modules[r][c] === grid.modules[r][c - 1] ? runH + 1 : 1;
        if (runH === 5) score += 3; else if (runH > 5) score += 1;
        runV = grid.modules[c][r] === grid.modules[c - 1][r] ? runV + 1 : 1;
        if (runV === 5) score += 3; else if (runV > 5) score += 1;
      }
    }

    // 2x2 blocks.
    for (r = 0; r < size - 1; r += 1) {
      for (c = 0; c < size - 1; c += 1) {
        var v = grid.modules[r][c];
        if (v === grid.modules[r][c + 1] && v === grid.modules[r + 1][c] && v === grid.modules[r + 1][c + 1]) {
          score += 3;
        }
      }
    }

    // Proportion of dark modules.
    var dark = 0;
    for (r = 0; r < size; r += 1) for (c = 0; c < size; c += 1) dark += grid.modules[r][c];
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  function build(text) {
    var bytes = utf8(text);
    var version = chooseVersion(bytes.length);
    if (!version) throw new Error('That value is too long for this QR encoder.');

    var data = encodeData(bytes, version);
    var ec = remainder(data, EC_CODEWORDS[version]);
    var codewords = data.concat(ec);

    var best = null;
    for (var pattern = 0; pattern < 8; pattern += 1) {
      var grid = blank(SIZE[version]);
      placeFunction(grid, version);
      placeData(grid, codewords);
      applyMask(grid, pattern);
      placeFormat(grid, pattern);
      var score = penalty(grid);
      if (!best || score < best.score) best = { grid: grid, score: score, pattern: pattern };
    }

    return {
      version: version,
      pattern: best.pattern,
      size: best.grid.size,
      modules: best.grid.modules,
      codewords: codewords,
      dataCodewords: data,
      ecCodewords: ec
    };
  }

  var cache = {};
  function matrix(text) {
    if (!cache[text]) cache[text] = build(text);
    return cache[text];
  }

  /* Painted as whole modules snapped to device pixels: a QR with seams or
     half-pixel edges is a QR that a phone struggles to read. */
  function paint(ctx, text, x, y, size) {
    var code;
    try { code = matrix(text); } catch (error) { return false; }

    var step = size / code.size;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < code.size; r += 1) {
      for (var c = 0; c < code.size; c += 1) {
        if (!code.modules[r][c]) continue;
        var px = x + c * step;
        var py = y + r * step;
        ctx.fillRect(Math.floor(px), Math.floor(py),
          Math.ceil(px + step) - Math.floor(px), Math.ceil(py + step) - Math.floor(py));
      }
    }
    ctx.restore();
    return true;
  }

  window.PFAQR = {
    DATA_CODEWORDS: DATA_CODEWORDS,
    EC_CODEWORDS: EC_CODEWORDS,
    SIZE: SIZE,
    build: build,
    matrix: matrix,
    paint: paint,
    _exp: EXP,
    _log: LOG,
    _mul: mul,
    _formatBits: formatBits,
    _maskBit: maskBit
  };
})();
