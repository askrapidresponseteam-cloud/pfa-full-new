/* People for Animals - the Colony Caregiver Card.

   One renderer draws every copy of the card: the preview in the panel's
   application drawer, the queue of applications to issue, and the batch
   sheet and PDF the office prints from. It is loaded by the admin panel
   only: the holder is never sent or shown the card, only the printed card
   by post (owner, 24 Oct 2026). So the card a reviewer approves is stroke
   for stroke the card that is printed.

   The design is the owner's Classical White template (24 Oct 2026, "use
   this template instead"): PFA_Caregiver_Classical_White.html, a physical
   design master at ISO/IEC 7810 ID-1, 85.6 x 54 mm, landscape. Every
   number below is in tenths of a millimetre on that card (856 x 540),
   measured off the template as Chromium lays it out: each text's baseline
   and left edge or centre, each box and each line. Its fonts, colours and
   sizes are the template's own; its pattern and its PFA logo are the
   template's own images (media/caregiver-card-pattern.jpg, drawn at 12%,
   and media/caregiver-card-logo.png, multiplied onto the card as the
   template does).

   What the template leaves to the page, a card printer cannot: there, a
   value too long for its column wraps onto a second line, into the row
   below. Here every value is drawn on one line at the template's one size,
   and what would not fit is settled before the card is issued
   (assets/card-print.js). */
(function () {
  'use strict';

  var CARD = { w: 85.6, h: 54 };          // mm, ID-1 landscape
  var REF = { w: 856, h: 540 };           // the card, in tenths of a millimetre
  var K = CARD.w / REF.w;                 // mm per unit: 0.1

  /* The template's palette, by what each colour is for. */
  var INK = '#111111';        // the heading, the labels, the signatory's name
  var VALUE = '#174d99';      // the holder's details
  var SOFT = '#222222';       // the signatory's role, the back's return address
  var PHOTO_INK = '#444444';  // PHOTO, where there is no photograph yet
  var EDGE = '#9b8a68';       // the card's own edge
  var FRAME = '#b9aa8e';      // the frame inside it
  var RULE = '#a99a80';       // the rule under the heading
  var PHOTO_LINE = '#8d8066'; // the photograph's border
  var SIGN = '#766b57';       // the line for the signature
  var GHOST = '#9fb3d1';      // a value not known yet, on a preview only

  /* Absans, the template's own font (fonts/absans-card.woff2, cut to the
     characters the card prints, without its ligatures, so card-print.js can
     add up a width letter by letter). */
  var FACE = '"PFA Card Absans", Arial, Helvetica, sans-serif';
  var FONT_SRC = 'fonts/absans-card.woff2';
  var PATTERN_SRC = 'media/caregiver-card-pattern.jpg';
  var LOGO_SRC = 'media/caregiver-card-logo.png';

  var PRINT_DPI = 600;

  /* The rows of the front, in the template's order and words. */
  var ROWS = [
    { label: 'NAME', key: 'name' },
    { label: 'ID NUMBER', key: 'cardId' },
    { label: 'DISTRICT', key: 'district' },
    { label: 'STATE', key: 'state' },
    { label: 'ISSUED ON', key: 'issuedShort' }
  ];

  /* ---- the layout, in tenths of a millimetre -------------------------- */
  var L = {
    line: 1.5,                                            // every hairline: 0.15 mm, the template's print width
    edge: { x: 0, y: 0, w: 856, h: 540 },
    frame: { x: 32.594, y: 20.891, w: 790.812, h: 498.218 },
    pattern: { x: 1, y: 1, w: 854, h: 538, alpha: 0.12 },
    centre: 427.99,                                        // the heading, the signatory and the back's lines
    heading: { text: 'Colony Caregiver Card', y: 81.031, size: 40.4747 },
    rule: { x: 60.766, y: 119.859, w: 734.438 },
    rows: { labelX: 60.766, labelY: 173.672, valueX: 242.484, valueY: 174.422, step: 49.484, size: 25.3407 },
    photo: { x: 594.516, y: 146.25, w: 179.328, h: 203.359 },
    photoText: { y: 253.922, size: 19.7094 },
    sign: { x: 272.563, y: 448.734, w: 310.844 },
    signatory: [
      { text: 'Smt. Maneka Sanjay Gandhi', y: 471.203, size: 18.6535, colour: 'ink' },
      { text: 'Chairperson', y: 491.5, size: 14.0781, colour: 'soft' },
      { text: 'People For Animals', y: 508.391, size: 14.0781, colour: 'soft' }
    ],
    logo: { x: 257.203, y: 162.406, w: 341.594, h: 215.188 },
    back: [
      { text: 'This card is non-transferable.', y: 405.734 },
      { text: 'If found, please return it to-', y: 422.625 },
      { text: 'People For Animals.', y: 439.516 },
      { text: '4-T, DCM Building, 16 Barakhamba Road,', y: 456.406 },
      { text: 'New Delhi 110001, India', y: 473.297 }
    ],
    backSize: 14.0781
  };

  /* The photograph's well, inside its border: for a photo editor. */
  var PHOTO_ASPECT = (L.photo.h - 2) / (L.photo.w - 2);   // height / width

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
      fontReady = Promise.resolve(false);
      return fontReady;
    }
    var face = new FontFace('PFA Card Absans', 'url(' + FONT_SRC + ') format("woff2")', { weight: '400' });
    fontReady = face.load().then(function (loaded) {
      document.fonts.add(loaded);
      return true;
    }).catch(function () { return false; });   // the stack stands in for a preview; printing refuses
    return fontReady;
  }

  /* The font and the two images every card needs. */
  function loadAssets() {
    return Promise.all([loadFont(), loadImage(PATTERN_SRC), loadImage(LOGO_SRC)]).then(function (out) {
      return { pattern: out[1], logo: out[2] };
    });
  }

  function painter(ctx, scale) {
    var u = K * scale;                      // device pixels per tenth of a millimetre
    return {
      u: u,
      v: function (n) { return n * u; },
      font: function (size) { ctx.font = '400 ' + (size * u).toFixed(3) + 'px ' + FACE; }
    };
  }

  function coverDraw(ctx, image, x, y, w, h) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    var ratio = Math.max(w / iw, h / ih);
    var dw = iw * ratio;
    var dh = ih * ratio;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function containDraw(ctx, image, x, y, w, h) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    var ratio = Math.min(w / iw, h / ih);
    var dw = iw * ratio;
    var dh = ih * ratio;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  /* A line of text centred on the card, as the template centres it. */
  function centred(ctx, P, text, y, size) {
    P.font(size);
    ctx.textAlign = 'center';
    ctx.fillText(text, P.v(L.centre), P.v(y));
    ctx.textAlign = 'left';
  }

  /* A hairline box, drawn inside its own edge as CSS draws a border. */
  function box(ctx, P, b, colour) {
    var lw = P.v(L.line);
    ctx.strokeStyle = colour;
    ctx.lineWidth = lw;
    ctx.strokeRect(P.v(b.x) + lw / 2, P.v(b.y) + lw / 2, P.v(b.w) - lw, P.v(b.h) - lw);
  }

  function hairline(ctx, P, x, y, w, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(P.v(x), P.v(y) - P.v(L.line) / 2, P.v(w), P.v(L.line));
  }

  /* White, the template's pattern at 12%, the edge and the frame: both faces. */
  function ground(ctx, P, data) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, P.v(REF.w), P.v(REF.h));
    var pat = L.pattern;
    if (data && data.patternImage) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(P.v(pat.x), P.v(pat.y), P.v(pat.w), P.v(pat.h));
      ctx.clip();
      ctx.globalAlpha = pat.alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      coverDraw(ctx, data.patternImage, P.v(pat.x), P.v(pat.y), P.v(pat.w), P.v(pat.h));
      ctx.restore();
    }
    box(ctx, P, L.edge, EDGE);
    box(ctx, P, L.frame, FRAME);
  }

  function titleCase(text) {
    var R = window.PFA_RULES;
    return R && R.titleCase ? R.titleCase(text) : text;
  }

  /* What each line prints, and whether it is a stand-in (a preview's pale
     blue). { text, ghost }. The name is the name on the card (printName)
     when the card has one; otherwise the fixed rule's form of the name. */
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
    var P = painter(ctx, scale);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ground(ctx, P, data);

    /* Colony Caregiver Card, and the rule under it */
    ctx.fillStyle = INK;
    centred(ctx, P, L.heading.text, L.heading.y, L.heading.size);
    hairline(ctx, P, L.rule.x, L.rule.y, L.rule.w, RULE);

    /* The five rows: the label, then the value, each at the template's one
       size on every card (owner, 24 Oct 2026: "text/font size needs to be
       same for every card"). Never shrunk, never wrapped: what would not
       fit was put in its short form before the card was issued. */
    var r = L.rows;
    ROWS.forEach(function (row, i) {
      P.font(r.size);
      ctx.fillStyle = INK;
      ctx.fillText(row.label, P.v(r.labelX), P.v(r.labelY + r.step * i));
      var line = lineOf(data, row.key);
      ctx.fillStyle = line.ghost ? GHOST : VALUE;
      ctx.fillText(line.text, P.v(r.valueX), P.v(r.valueY + r.step * i));
    });

    /* The photograph: white, the picture inside its border, the border. */
    var ph = L.photo;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(P.v(ph.x), P.v(ph.y), P.v(ph.w), P.v(ph.h));
    if (data.photoImage) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(P.v(ph.x + 1), P.v(ph.y + 1), P.v(ph.w - 2), P.v(ph.h - 2));
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      coverDraw(ctx, data.photoImage, P.v(ph.x + 1), P.v(ph.y + 1), P.v(ph.w - 2), P.v(ph.h - 2));
      ctx.restore();
    } else {
      ctx.fillStyle = PHOTO_INK;
      P.font(L.photoText.size);
      ctx.textAlign = 'center';
      ctx.fillText('PHOTO', P.v(ph.x + ph.w / 2), P.v(L.photoText.y));
      ctx.textAlign = 'left';
    }
    box(ctx, P, ph, PHOTO_LINE);

    /* The signatory: the line left for the signature, then the name and
       the role, centred under it. */
    hairline(ctx, P, L.sign.x, L.sign.y, L.sign.w, SIGN);
    L.signatory.forEach(function (line) {
      ctx.fillStyle = line.colour === 'soft' ? SOFT : INK;
      centred(ctx, P, line.text, line.y, line.size);
    });
    ctx.restore();
  }

  /* The back: the PFA logo, and where to return a card that is found. */
  function drawBack(ctx, scale, data) {
    var P = painter(ctx, scale);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ground(ctx, P, data);
    var lg = L.logo;
    if (data && data.logoImage) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';    // as the template sets it: the logo's white takes the pattern
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      containDraw(ctx, data.logoImage, P.v(lg.x), P.v(lg.y), P.v(lg.w), P.v(lg.h));
      ctx.restore();
    } else {
      /* the image did not load: the name, so the back is never blank */
      ctx.fillStyle = INK;
      centred(ctx, P, 'PEOPLE FOR ANIMALS', lg.y + lg.h * 0.6, 30);
    }
    ctx.fillStyle = SOFT;
    L.back.forEach(function (line) { centred(ctx, P, line.text, line.y, L.backSize); });
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
    var full = withAssets(data, assets);
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

  /* hydrate() puts the images on the data; draw() is also handed the assets. */
  function withAssets(data, assets) {
    if (!data || !assets || (data.patternImage && data.logoImage)) return data;
    var out = {};
    Object.keys(data).forEach(function (key) { out[key] = data[key]; });
    out.patternImage = out.patternImage || assets.pattern;
    out.logoImage = out.logoImage || assets.logo;
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
      loadAssets()
    ]).then(function (out) {
      copy.photoImage = out[0];
      copy.patternImage = out[1].pattern;
      copy.logoImage = out[1].logo;
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
      if (document.fonts && document.fonts.check && !document.fonts.check('25px "PFA Card Absans"')) {
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
    var ready = (data && data.patternImage ? Promise.resolve(data) : hydrate(data)).then(printReady);
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
    var ready = (data && data.patternImage ? Promise.resolve(data) : hydrate(data)).then(printReady);
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
