/* PFA's birthday card, drawn for any name (owner, 11 Nov 2026, with
   PFA-Birthday-Template.html: "ensure that there is no abnormal amount of
   gap anywhere. implement enterprise grade. have this in the admin panel",
   then "let the font in the card also be marcellus to match website theme").

   The card is the template's: the dahlias, the paper, PFA's mark, and the
   same words. What changed:
     - every line is in Marcellus, the site's display face (fonts/), with the
       browser's serif only for a letter Marcellus does not have (a name in
       Devanagari or Tamil);
     - the words are laid out together, with the same rhythm between them
       whatever the name: a short name no longer leaves the space kept for a
       three-line one empty. The block sits in the middle of the paper, below
       the mark, and every line is kept inside the paper's own outline, which
       narrows near the bottom where the flowers overlap it;
     - it is drawn on a canvas at the template's size (1122 x 1402), so what
       is previewed is exactly the PNG that is saved.

   A name is text, never markup. Control and direction-override characters
   are taken out, and a name over 160 letters is refused, as the template
   did. A long name wraps at spaces onto up to three lines and grows smaller
   until it fits; one that cannot fit legibly is refused with a reason. An
   empty name gives the card without one.

   PFABirthdayCard.draw(canvas, name)  -> Promise<{ name, lines, size }>
   PFABirthdayCard.png(name)           -> Promise<Blob>  (image/png)
   PFABirthdayCard.fileName(name)      -> "PFA-Birthday-Ananya-Sharma.png" */
(function () {
  'use strict';

  var W = 1122;
  var H = 1402;
  var CX = 561;                       /* the template's centre line, under the mark */
  var LOGO = { x: 474, y: 474, w: 174, h: 117 };
  var TOP = LOGO.y + LOGO.h + 12;     /* the words start below the mark, clear of it */
  var BOTTOM = 948;                   /* and end above the flowers at the foot */
  var INK = '#241b17';
  var FACE = 'Marcellus, "Noto Serif", Georgia, "Times New Roman", serif';
  var IMAGES = { flowers: '/media/birthday/card-flowers.jpg', logo: '/media/birthday/card-logo.png' };
  var FONTS = ['/fonts/marcellus-latin.woff2', '/fonts/marcellus-latin-ext.woff2'];
  var MAX_LETTERS = 160;

  /* The paper's width at a height, inside a margin: measured from the
     flowers image, it is 635 wide to y 860 and narrows to the bottom tip. */
  function widthAt(y) {
    var pts = [[860, 560], [900, 380], [940, 300], [960, 270]];
    if (y <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i += 1) {
      if (y <= pts[i][0]) {
        var a = pts[i - 1]; var b = pts[i];
        return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]);
      }
    }
    return pts[pts.length - 1][1];
  }

  var ready = null;
  function load() {
    if (ready) return ready;
    var fonts = Promise.resolve();
    if (window.FontFace && document.fonts) {
      fonts = Promise.all(FONTS.map(function (url, i) {
        var f = new FontFace('Marcellus', 'url(' + url + ') format("woff2")', i ? { unicodeRange: 'U+0100-024F, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF' } : {});
        return f.load().then(function (x) { document.fonts.add(x); }).catch(function () {});
      }));
    }
    var image = function (src) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('The card picture could not be loaded.')); };
        img.src = src;
      });
    };
    ready = Promise.all([image(IMAGES.flowers), image(IMAGES.logo), fonts]).then(function (x) {
      return { flowers: x[0], logo: x[1] };
    });
    ready.catch(function () { ready = null; });
    return ready;
  }

  function letters(s) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), function (x) { return x.segment; });
    }
    return Array.from(s);
  }

  function clean(value) {
    var s = String(value == null ? '' : value).normalize('NFC')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (letters(s).length > MAX_LETTERS) throw new RangeError('Use a name of 160 letters or fewer.');
    return s;
  }

  /* the lines of the card, top to bottom: [text, size, gap above] */
  function plan(nameLines, nameSize) {
    var out = [['Happy Birthday', 54, 0]];
    nameLines.forEach(function (t, i) { out.push([t, nameSize, i ? 0 : 16]); });
    out.push(['The world is kinder', 31, 26], ['because of you.', 31, 0], ['Wishing you joy, today and always.', 23, 18], ['Warm regards,', 21, 22], ['Maneka Sanjay Gandhi', 26, 4]);
    return out;
  }
  var LEAD = 1.16; /* line height, as a share of the size */
  function heightOf(lines) {
    return lines.reduce(function (h, l) { return h + l[2] + l[1] * LEAD; }, 0);
  }

  /* the name broken at spaces into lines no wider than the paper allows,
     a word too long for a line broken between its letters */
  function wrap(ctx, name, size) {
    ctx.font = size + 'px ' + FACE;
    var rows = [];
    var row = '';
    name.split(' ').forEach(function (word) {
      var next = row ? row + ' ' + word : word;
      if (ctx.measureText(next).width <= 520) { row = next; return; }
      if (row) rows.push(row);
      row = word;
      while (ctx.measureText(row).width > 520) {
        var parts = letters(row); var cut = parts.length;
        while (cut > 1 && ctx.measureText(parts.slice(0, cut).join('')).width > 520) cut -= 1;
        rows.push(parts.slice(0, cut).join(''));
        row = parts.slice(cut).join('');
      }
    });
    if (row) rows.push(row);
    return rows;
  }

  /* Every line placed from the middle of the space down, or null when one
     would run past the paper at its height or the block is too tall. */
  function place(ctx, rows, size, scale) {
    var lines = plan(rows, size).map(function (l) { return [l[0], Math.round(l[1] * scale * 10) / 10, l[2] * scale]; });
    var h = heightOf(lines);
    if (h > BOTTOM - TOP) return null;
    var y = TOP + (BOTTOM - TOP - h) / 2;
    var placed = [];
    for (var i = 0; i < lines.length; i += 1) {
      var l = lines[i];
      y += l[2];
      var base = y + l[1] * 0.92;   /* Marcellus sits its letters this far into the line */
      ctx.font = l[1] + 'px ' + FACE;
      if (ctx.measureText(l[0]).width > widthAt(base)) return null;
      placed.push({ text: l[0], size: l[1], y: base });
      y += l[1] * LEAD;
    }
    return placed;
  }

  /* The largest name that fits with everything else at its own size; for
     a name that needs two or three lines, the whole card a little smaller
     together (to 80%), so the spacing keeps the same rhythm, before the
     name is made smaller than 24. */
  function layout(ctx, name) {
    var tries = [];
    var size;
    var scale;
    for (scale = 1; scale >= 0.8; scale -= 0.02) for (size = 36; size >= 24; size -= 1) tries.push([size, scale]);
    for (size = 23; size >= 16; size -= 1) for (scale = 1; scale >= 0.8; scale -= 0.02) tries.push([size, scale]);
    if (!name) tries = [[0, 1], [0, 0.9]];
    for (var i = 0; i < tries.length; i += 1) {
      var rows = name ? wrap(ctx, name, tries[i][0]) : [];
      if (rows.length > 3) continue;
      var placed = place(ctx, rows, tries[i][0], tries[i][1]);
      if (placed) return { placed: placed, name: { lines: rows, size: Math.round(tries[i][0] * tries[i][1] * 10) / 10 } };
    }
    throw new RangeError('This name cannot fit on the card legibly. Use a shorter form of it.');
  }

  function draw(canvas, value) {
    var name;
    try { name = clean(value); } catch (e) { return Promise.reject(e); }
    return load().then(function (img) {
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      var plan2 = layout(ctx, name);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img.flowers, 0, 0, W, H);
      ctx.drawImage(img.logo, LOGO.x, LOGO.y, LOGO.w, LOGO.h);
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      plan2.placed.forEach(function (l) {
        ctx.font = l.size + 'px ' + FACE;
        ctx.direction = /^[^A-Za-z\u00c0-\u024f]*[\u0590-\u08ff]/.test(l.text) ? 'rtl' : 'ltr';
        ctx.fillText(l.text, CX, l.y);
      });
      ctx.direction = 'ltr';
      canvas.setAttribute('aria-label', name ? 'Birthday card: Happy Birthday, ' + name + '. The world is kinder because of you.' : 'Birthday card from People for Animals');
      return { name: name, lines: plan2.name.lines, size: plan2.name.size };
    });
  }

  function png(value) {
    var c = document.createElement('canvas');
    return draw(c, value).then(function () {
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('The card could not be saved as a picture.')); }, 'image/png');
      });
    });
  }

  function fileName(value) {
    var s = '';
    try { s = clean(value); } catch (_) { s = ''; }
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return 'PFA-Birthday' + (s ? '-' + s : '') + '.png';
  }

  window.PFABirthdayCard = { draw: draw, png: png, fileName: fileName, clean: clean, size: { width: W, height: H } };
})();
