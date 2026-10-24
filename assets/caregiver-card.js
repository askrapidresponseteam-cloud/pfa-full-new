/* People for Animals - the Colony Caregiver Card.

   One renderer draws every copy of the card: the preview in the panel's
   application drawer, the queue of applications to issue, the batch sheet
   the office prints from, and the holder's own card page. So the card a
   reviewer approves is stroke for stroke the card that is printed.

   The design is the owner's template (24 Oct 2026, "caregiver card ditto"):
   PFA_Colony_Caregiver_Card_Template.html. Its front is laid out on a 785 x
   500 pixel artboard and drawn here from that template's own export
   coordinates, so nothing is eyeballed; its back is the PFA mark, kept as
   the template carries it (media/caregiver-card-back.png, its frame taken
   off, since the card draws its own edge).

   The artboard is placed on an ISO/IEC 7810 ID-1 card turned landscape
   (85.6 x 54 mm). The template's proportions are a hair narrower than ID-1
   (1.570 against 1.585), so it is scaled to the card's height, never
   stretched, and centred: 0.41 mm of white either side, which no eye will
   find and which keeps every letter in its drawn shape. */
(function () {
  'use strict';

  var CARD = { w: 85.6, h: 54 };          // mm, ID-1 landscape
  var REF = { w: 785, h: 500 };           // the template's artboard, in its pixels
  var K = CARD.h / REF.h;                 // mm per template pixel
  var OFF_X = (CARD.w - REF.w * K) / 2;   // mm of white each side

  /* The template's palette, by what each colour is for. */
  var PURPLE = '#41308f';     // heading, labels, values, the chairperson's role
  var RULE = '#766b6b';       // the underline of each row, the authorisation line
  var FRAME = '#7768ba';      // the photograph's rounded frame
  var EDGE = '#807979';       // the card's own edge
  var DARK = '#252327';       // "Authorised By:" and the chairperson's name
  var GHOST = '#a49cc9';      // a value not known yet, on a preview only

  /* Arial is what the template names. Arimo is the open-licence face drawn
     to Arial's exact widths, loaded with the card, so the card is laid out
     identically on a phone that has no Arial (Android, Linux) as on the
     office computer that has. */
  var FACE = '"PFA Card Arial", Arial, "Liberation Sans", Helvetica, sans-serif';
  var FACES = [
    ['PFA Card Arial', 'fonts/arimo-latin-400.woff2', '400'],
    ['PFA Card Arial', 'fonts/arimo-latin-700.woff2', '700']
  ];
  var BACK_SRC = 'media/caregiver-card-back.png';

  var PRINT_DPI = 600;

  /* The rows of the front, in the template's order and words. */
  var ROWS = [
    { label: 'NAME', key: 'name' },
    { label: 'ID NUMBER', key: 'cardId' },
    { label: 'DISTRICT', key: 'district' },
    { label: 'STATE', key: 'state' },
    { label: 'ISSUED ON', key: 'issuedShort' }
  ];
  /* The photograph's well, inside its 1 px frame: 166.3 x 230.1. */
  var PHOTO_ASPECT = 230.06 / 166.34;    // height / width, for a photo editor

  /* A real card number from the register. A preview has none. */
  var ISSUED_CARD = /^PFA-CCT-[A-Z0-9]{8}$/;
  function isIssued(data) {
    return ISSUED_CARD.test(String(data && data.cardId || '').toUpperCase());
  }

  var assetCache = {};
  var fontReady = null;

  function loadImage(src) {
    if (assetCache[src]) return assetCache[src];
    assetCache[src] = new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { resolve(null); };
      image.src = src;
    });
    return assetCache[src];
  }

  function loadFont() {
    if (fontReady) return fontReady;
    if (typeof FontFace === 'undefined' || !document.fonts) {
      fontReady = Promise.resolve(null);
      return fontReady;
    }
    fontReady = Promise.all(FACES.map(function (entry) {
      var face = new FontFace(entry[0], 'url(' + entry[1] + ') format("woff2")', { weight: entry[2] });
      return face.load().then(function (loaded) {
        document.fonts.add(loaded);
        return true;
      }).catch(function () { return false; });   // Arial, then the stack, stands in
    })).then(function (results) { return results.some(Boolean); });
    return fontReady;
  }

  /* The fonts and the back, which every card needs. */
  function loadAssets() {
    return Promise.all([loadFont(), loadImage(BACK_SRC)]).then(function (out) {
      return { back: out[1] };
    });
  }

  /* ---- drawing on the template's artboard -------------------------------

     Every number below is a pixel of the template's 785 x 500 artboard,
     measured off the template as a browser lays it out (24 Oct 2026: each
     text's baseline and left edge, each box, read in Chromium at full size).
     That is the layout the owner sees on screen and the one its Print / Save
     PDF prints. The template's own Save PNG draws from rounder numbers (rows
     about 6 px higher, values 10 px further left); the screen is what was
     approved, so the screen is what is copied. */
  var L = {
    heading: { x: 50.33, y: 74.38, size: 47, track: 0.705 },
    rowTop: 118.52, rowStep: 43.0125, rowH: 43.02, ruleW: 1.5,
    label: { x: 62.06, drop: 27.0, size: 21 },
    colon: { x: 224.42, size: 21 },
    value: { x: 252.97, drop: 26.5, size: 18.06, room: 220.15 },
    ruleX: [62.06, 473.12],
    photo: { x: 578.06, y: 117.53, w: 168.34, h: 232.06, round: 0.14 },
    photoText: { x: 623.31, y: 327.63, size: 22 },
    auth: { x: 234.33, w: 305.36, top: 387.44, line: 3 },
    authLines: [
      { text: 'Authorised By:', y: 414.44, size: 19, bold: false, colour: 'dark' },
      { text: 'Smt. Maneka Sanjay Gandhi', y: 443.55, size: 19.95, bold: true, colour: 'dark' },
      { text: 'Chairperson, People For Animals', y: 473.06, size: 19.95, bold: true, colour: 'purple' }
    ]
  };

  function painter(ctx, scale) {
    var px = K * scale;                     // device pixels per template pixel
    var ox = OFF_X * scale;
    return {
      px: px,
      x: function (v) { return ox + v * px; },
      y: function (v) { return v * px; },
      s: function (v) { return v * px; },
      font: function (size, bold) {
        ctx.font = (bold ? '700 ' : '400 ') + (size * px).toFixed(2) + 'px ' + FACE;
      }
    };
  }

  /* A rounded rectangle whose corners may be elliptical, as CSS draws a
     percentage radius (the photograph's 14% is 23.6 across and 32.5 down). */
  var KAPPA = 0.5522847498;
  function roundRect(ctx, x, y, w, h, rx, ry) {
    var a = Math.min(rx, w / 2);
    var b = Math.min(ry === undefined ? rx : ry, h / 2);
    var ka = a * KAPPA;
    var kb = b * KAPPA;
    ctx.beginPath();
    ctx.moveTo(x + a, y);
    ctx.lineTo(x + w - a, y);
    ctx.bezierCurveTo(x + w - a + ka, y, x + w, y + b - kb, x + w, y + b);
    ctx.lineTo(x + w, y + h - b);
    ctx.bezierCurveTo(x + w, y + h - b + kb, x + w - a + ka, y + h, x + w - a, y + h);
    ctx.lineTo(x + a, y + h);
    ctx.bezierCurveTo(x + a - ka, y + h, x, y + h - b + kb, x, y + h - b);
    ctx.lineTo(x, y + b);
    ctx.bezierCurveTo(x, y + b - kb, x + a - ka, y, x + a, y);
    ctx.closePath();
  }

  function coverDraw(ctx, image, x, y, w, h) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    var ratio = Math.max(w / iw, h / ih);
    var dw = iw * ratio;
    var dh = ih * ratio;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  /* Letter-spaced text, as CSS letter-spacing draws it: the canvas's own
     letterSpacing where the browser has it, otherwise a letter at a time. */
  function tracked(ctx, text, x, y, track) {
    if ('letterSpacing' in ctx) {
      /* save and restore, never read-and-put-back: after a save() Chromium
         reads letterSpacing as '', and putting '' back is ignored, which
         left the heading's spacing on every line drawn after it */
      ctx.save();
      ctx.letterSpacing = track.toFixed(3) + 'px';
      ctx.fillText(text, x, y);
      ctx.restore();
      if (ctx.letterSpacing && ctx.letterSpacing !== '0px') ctx.letterSpacing = '0px';
      return;
    }
    var cursor = x;
    String(text).split('').forEach(function (ch) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + track;
    });
  }

  /* Every value at one size, the template's 18.06 px, on every card: never
     shrunk, never pressed narrower, never cut (owner, 24 Oct 2026: "text/font
     size needs to be same for every card ... like aadhar card, credit card
     printing system"). What would not fit is printed in its fixed short
     form instead (assets/card-print.js), and that is settled before the card
     is issued, so nothing here ever has to squeeze. */
  function valueText(ctx, P, text, x, y) {
    P.font(L.value.size);
    ctx.fillText(text, P.x(x), P.y(y));
  }

  /* The card's own edge, at the edge of the card. */
  function edge(ctx, W, H, P) {
    var lw = Math.max(1, P.s(1));
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = lw;
    ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
  }

  function titleCase(text) {
    var R = window.PFA_RULES;
    return R && R.titleCase ? R.titleCase(text) : text;
  }

  /* What each line prints, and whether it is a stand-in (a preview's grey).
     { text, ghost }. The name is the name on the card (printName) when the
     card has one; otherwise the fixed rule's form of the name. */
  function lineOf(data, key) {
    var PR = window.PFACardPrint;
    if (key === 'name') {
      if (data.ghost && data.ghost.name) return { text: 'Your Name', ghost: true };
      var given = String(data.printName || '').trim();
      if (given) return PR && !PR.fits(given) ? { text: 'Name too long for the card', ghost: true } : { text: given, ghost: false };
      var name = String(data.name || '').trim().replace(/\s+/g, ' ');
      if (window.PFA_RULES && window.PFA_RULES.nameCase) name = window.PFA_RULES.nameCase(name);
      if (!PR) return { text: name, ghost: false };
      var made = PR.suggestName(name);
      return made.fits ? { text: made.text, ghost: false } : { text: 'Name too long for the card', ghost: true };
    }
    if (key === 'cardId') return isIssued(data) ? { text: String(data.cardId).toUpperCase(), ghost: false } : { text: 'Given when issued', ghost: true };
    if (key === 'district' || key === 'state') {
      if (data.ghost && data.ghost[key]) return { text: 'Not given', ghost: true };
      var place = String(data[key] || '');
      place = PR ? PR.placeName(place) : titleCase(place);
      return PR && !PR.fits(place) ? { text: 'Too long for the card', ghost: true } : { text: place, ghost: false };
    }
    if (key === 'issuedShort') return { text: String(data.issuedShort || ''), ghost: false };
    return { text: String(data[key] || ''), ghost: false };
  }

  /* What stops this card being printed: a stand-in where a value should be.
     A preview may show them; a card for the printer may not. */
  function unprintable(data) {
    return ROWS.map(function (row) { return { row: row, line: lineOf(data, row.key) }; })
      .filter(function (r) { return r.line.ghost; })
      .map(function (r) { return r.row.label.toLowerCase().replace(/^id number$/, 'card number').replace(/^issued on$/, 'issue date'); });
  }

  function drawFront(ctx, scale, data) {
    var W = CARD.w * scale;
    var H = CARD.h * scale;
    var P = painter(ctx, scale);
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    /* COLONY CAREGIVER CARD */
    ctx.fillStyle = PURPLE;
    P.font(L.heading.size);
    tracked(ctx, 'COLONY CAREGIVER CARD', P.x(L.heading.x), P.y(L.heading.y), P.s(L.heading.track));

    /* The five rows: label, colon, value, and the rule under each. */
    ROWS.forEach(function (row, i) {
      var top = L.rowTop + L.rowStep * i;
      ctx.fillStyle = PURPLE;
      P.font(L.label.size);
      ctx.fillText(row.label, P.x(L.label.x), P.y(top + L.label.drop));
      P.font(L.colon.size, true);
      ctx.fillText(':', P.x(L.colon.x), P.y(top + L.label.drop));
      var line = lineOf(data, row.key);
      ctx.fillStyle = line.ghost ? GHOST : PURPLE;
      valueText(ctx, P, line.text, L.value.x, top + L.value.drop);
      ctx.strokeStyle = RULE;
      ctx.lineWidth = P.s(L.ruleW);
      var ruleY = top + L.rowH - L.ruleW / 2;
      ctx.beginPath();
      ctx.moveTo(P.x(L.ruleX[0]), P.y(ruleY));
      ctx.lineTo(P.x(L.ruleX[1]), P.y(ruleY));
      ctx.stroke();
    });

    /* The photograph, in its rounded frame: a 1 px border, the picture
       inside it, both with the template's 14% corners. */
    var ph = L.photo;
    var rx = ph.w * ph.round;
    var ry = ph.h * ph.round;
    if (data.photoImage) {
      ctx.save();
      roundRect(ctx, P.x(ph.x + 1), P.y(ph.y + 1), P.s(ph.w - 2), P.s(ph.h - 2), P.s(rx - 1), P.s(ry - 1));
      ctx.clip();
      coverDraw(ctx, data.photoImage, P.x(ph.x + 1), P.y(ph.y + 1), P.s(ph.w - 2), P.s(ph.h - 2));
      ctx.restore();
    } else {
      ctx.fillStyle = PURPLE;
      P.font(L.photoText.size, true);
      ctx.fillText('PHOTO', P.x(L.photoText.x), P.y(L.photoText.y));
    }
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = P.s(1);
    roundRect(ctx, P.x(ph.x + 0.5), P.y(ph.y + 0.5), P.s(ph.w - 1), P.s(ph.h - 1), P.s(rx - 0.5), P.s(ry - 0.5));
    ctx.stroke();

    /* The authorisation: the line, then three centred lines under it. A
       line wider than its box starts at the box's left edge, as the
       browser sets it. */
    var au = L.auth;
    ctx.fillStyle = RULE;
    ctx.fillRect(P.x(au.x), P.y(au.top), P.s(au.w), P.s(au.line));
    L.authLines.forEach(function (line) {
      ctx.fillStyle = line.colour === 'purple' ? PURPLE : DARK;
      P.font(line.size, line.bold);
      var width = ctx.measureText(line.text).width;
      var x = width > P.s(au.w) ? P.x(au.x) : P.x(au.x + au.w / 2) - width / 2;
      ctx.fillText(line.text, x, P.y(line.y));
    });

    edge(ctx, W, H, P);
    ctx.restore();
  }

  /* The back: the PFA mark, as the template carries it. */
  function drawBack(ctx, scale, data) {
    var W = CARD.w * scale;
    var H = CARD.h * scale;
    var P = painter(ctx, scale);
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    var back = data && data.backImage;
    if (back) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(back, P.x(0), 0, P.s(REF.w), P.s(REF.h));
    } else {
      /* the image did not load: the name, so the back is never blank */
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.font = '400 ' + (40 * P.px).toFixed(2) + 'px "Times New Roman", Times, serif';
      ctx.fillText('PEOPLE FOR ANIMALS', W / 2, P.y(400));
    }
    edge(ctx, W, H, P);
    ctx.restore();
  }

  function draw(canvas, side, data, assets, cssWidth, density) {
    var scale = (cssWidth * density) / CARD.w;
    canvas.width = Math.round(CARD.w * scale);
    canvas.height = Math.round(CARD.h * scale);
    if (cssWidth) {
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = (cssWidth * (CARD.h / CARD.w)) + 'px';
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var full = withBack(data, assets);
    if (side === 'back') drawBack(ctx, scale, full);
    else drawFront(ctx, scale, full);
    return canvas;
  }

  function offscreen(side, data, dpi) {
    var scale = (dpi || PRINT_DPI) / 25.4;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(CARD.w * scale);
    canvas.height = Math.round(CARD.h * scale);
    var ctx = canvas.getContext('2d');
    if (side === 'back') drawBack(ctx, scale, data);
    else drawFront(ctx, scale, data);
    return canvas;
  }

  /* hydrate() puts the back on the data; draw() is also handed the assets. */
  function withBack(data, assets) {
    if (!data || data.backImage || !assets || !assets.back) return data;
    var out = {};
    Object.keys(data).forEach(function (key) { out[key] = data[key]; });
    out.backImage = assets.back;
    return out;
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('The card image could not be created.'));
        }, type, quality);
        return;
      }
      try {
        var url = canvas.toDataURL(type, quality);
        var binary = atob(url.split(',')[1]);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: type }));
      } catch (error) {
        reject(error);
      }
    });
  }

  /* JPEG has no alpha. The card is drawn inside a rounded clip, so the four
     corners of the canvas are transparent - and a transparent pixel encodes as
     black. On the old near-black card that was invisible; on a white one it
     puts a black wedge in every corner of the emailed and printed artwork. So
     the canvas is flattened onto white first. The PNG path is left alone:
     there, transparent corners are correct. */
  function jpegBytes(canvas, quality) {
    var flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    var fctx = flat.getContext('2d');
    fctx.fillStyle = '#FFFFFF';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    var url = flat.toDataURL('image/jpeg', quality || 0.94);
    var binary = atob(url.split(',')[1]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildPdf(pages) {
    var encoder = new TextEncoder();
    var parts = [];
    var length = 0;
    var offsets = [0];

    function push(chunk) {
      var bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
      parts.push(bytes);
      length += bytes.length;
    }

    function startObject(number) {
      offsets[number] = length;
      push(number + ' 0 obj\n');
    }

    /* Pages default to the colony caregiver card size; a page may carry its own
       size in millimetres (the landscape Patron card uses this). */
    var first = pages[0] || {};
    var widthPt = ((first.wMm || CARD.w) * 72) / 25.4;
    var heightPt = ((first.hMm || CARD.h) * 72) / 25.4;
    var kids = pages.map(function (_, index) { return (3 + index * 3) + ' 0 R'; }).join(' ');

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    startObject(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    startObject(2); push('<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>\nendobj\n');

    pages.forEach(function (page, index) {
      var pageNumber = 3 + index * 3;
      var imageNumber = pageNumber + 1;
      var contentNumber = pageNumber + 2;
      var content = 'q ' + widthPt.toFixed(3) + ' 0 0 ' + heightPt.toFixed(3) + ' 0 0 cm /Im0 Do Q\n';

      startObject(pageNumber);
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + widthPt.toFixed(3) + ' ' + heightPt.toFixed(3)
        + '] /Resources << /XObject << /Im0 ' + imageNumber + ' 0 R >> >> /Contents ' + contentNumber + ' 0 R >>\nendobj\n');

      startObject(imageNumber);
      push('<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height
        + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length + ' >>\nstream\n');
      push(page.bytes);
      push('\nendstream\nendobj\n');

      startObject(contentNumber);
      push('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    });

    var objectCount = 2 + pages.length * 3;
    var xrefOffset = length;
    var xref = 'xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n';
    for (var number = 1; number <= objectCount; number += 1) {
      xref += String(offsets[number]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    return new Blob(parts, { type: 'application/pdf' });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function normalisePhoto(file, maxEdge) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That image could not be read.')); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error('That image could not be read.')); };
        image.onload = function () {
          var limit = maxEdge || 1400;
          var ratio = Math.min(1, limit / Math.max(image.width, image.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * ratio);
          canvas.height = Math.round(image.height * ratio);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        image.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  /* Every value goes through PFACardFields first: the short date derived,
     what is not known marked as a ghost, nothing left empty. See
     assets/card-fields.js. Whether the card is issued is read from the data
     as it arrived, before anything is filled in, so a completed placeholder
     can never make a preview look like an issued card. */
  function complete(data) {
    if (!window.PFACardFields) return data;
    var filled = window.PFACardFields.caregiver(data);
    var out = {};
    Object.keys(data || {}).forEach(function (key) { out[key] = data[key]; });
    ['name', 'district', 'state', 'issuedOn', 'issuedShort'].forEach(function (key) {
      out[key] = filled[key];
    });
    out.ghost = filled.ghost;
    out.missing = filled.missing;
    return out;
  }

  function hydrate(data) {
    var issued = isIssued(data);
    var filled = complete(data || {});
    var copy = {};
    Object.keys(filled).forEach(function (key) { copy[key] = filled[key]; });
    copy.issued = issued;
    if (!issued) copy.cardId = '';

    return Promise.all([
      filled.photo ? loadImage(filled.photo) : Promise.resolve(null),
      loadImage(BACK_SRC),
      loadFont()
    ]).then(function (out) {
      copy.photoImage = out[0];
      copy.backImage = out[1];
      return copy;
    });
  }

  function fileStem(data) {
    var id = String(data.cardId || 'caregiver-card').replace(/[^A-Za-z0-9-]/g, '');
    return id || 'caregiver-card';
  }

  /* The card's own font, or no print: a card drawn in a stand-in face would
     not be the card the server measured. */
  function printReady(data) {
    return loadFont().then(function () {
      if (document.fonts && document.fonts.check && !document.fonts.check('18px "PFA Card Arial"')) {
        throw new Error('The card font did not load, so the card cannot be printed exactly. Reload the page and try again.');
      }
      var missing = unprintable(data || {});
      if (missing.length) throw new Error('This card is not ready to print: no ' + missing.join(', no ') + '.');
      return data;
    });
  }

  function downloadPng(data, side) {
    /* A card has two sides, so "download" gives both. An explicit 'front' or
       'back' gives that side alone. */
    var sides = (side === 'front' || side === 'back') ? [side] : ['front', 'back'];
    var ready = (data && data.backImage ? Promise.resolve(data) : hydrate(data)).then(printReady);
    return Promise.all([loadAssets(), ready]).then(function (out) {
      return sides.reduce(function (chain, one) {
        return chain.then(function (blobs) {
          var canvas = offscreen(one, out[1], PRINT_DPI);
          return toBlob(canvas, 'image/png').then(function (blob) {
            saveBlob(blob, fileStem(data) + '-' + one + '.png');
            blobs.push(blob);
            return blobs;
          });
        });
      }, Promise.resolve([]));
    });
  }

  /* Front and back as a two-page PDF at true card size, for a card printer. */
  function pagesOf(data) {
    return ['front', 'back'].map(function (side) {
      var canvas = offscreen(side, data, PRINT_DPI);
      return { width: canvas.width, height: canvas.height, bytes: jpegBytes(canvas, 0.95) };
    });
  }

  function downloadPdf(data) {
    var ready = (data && data.backImage ? Promise.resolve(data) : hydrate(data)).then(printReady);
    return Promise.all([loadAssets(), ready]).then(function (out) {
      saveBlob(buildPdf(pagesOf(out[1])), fileStem(data) + '-print.pdf');
    });
  }

  function issuedOnLabel(date) {
    return (date || new Date()).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  window.PFACaregiverCard = {
    CARD: CARD,
    REF: REF,
    PHOTO_ASPECT: PHOTO_ASPECT,
    _buildPdf: buildPdf,
    PRINT_DPI: PRINT_DPI,
    draw: draw,
    downloadPng: downloadPng,
    downloadPdf: downloadPdf,
    pagesOf: pagesOf,
    jpegBytes: jpegBytes,
    hydrate: hydrate,
    isIssued: isIssued,
    printReady: printReady,
    unprintable: unprintable,
    lineOf: lineOf,
    issuedOnLabel: issuedOnLabel,
    loadAssets: loadAssets,
    loadFont: loadFont,
    loadImage: loadImage,
    normalisePhoto: normalisePhoto,
    offscreen: offscreen,
    saveBlob: saveBlob
  };
})();
