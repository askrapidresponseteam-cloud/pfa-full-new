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

  var GHOST = '#9fb3d1';      // a value not known yet, on a preview only
  var PATTERN_SRC = 'media/caregiver-card-pattern.jpg';
  /* the PFA logo in its own colours on a clear ground, as on the card online */
  var LOGO_SRC = 'media/member-card-logo.png';
  /* Smt. Maneka Sanjay Gandhi's signature (owner, 15 Nov 2026: "Add Maneka
     Gandhi's signature to caregiver and membership cards using the same
     logic as the internship certificate"): the certificate's own signature,
     at print quality, drawn above the signatory's line, centred on it, and
     moved from there by the card studio's Signature position, kept for the
     whole site (lib/certificate-layout.js, read from /api/certificate-layout
     with the card's other assets). A card is never printed without it. */
  var SIG_SRC = 'assets/certificates/signature-print.png';
  /* the signature chosen for cards in the panel, in its colour (lib/routes/
     signature.js; owner, 22 Nov 2026); the built-in one when it cannot be had */
  var SIG_LIVE = '/api/signature?for=card';
  var SIG_BOX = { h: 62, aspect: 1512 / 438, gap: 1 };
  var SIG_RANGE = { x: 60, y: 30, s: [60, 160] };
  var SIG_DEFAULT = { x: 0, y: 0, s: 100 };
  var sigAt = { x: SIG_DEFAULT.x, y: SIG_DEFAULT.y, s: SIG_DEFAULT.s };
  function setSignature(l) {
    var c = function (v, max, d) { var n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : d; };
    var s = Math.round(Number(l && l.s));
    sigAt = { x: c(l && l.x, SIG_RANGE.x, SIG_DEFAULT.x), y: c(l && l.y, SIG_RANGE.y, SIG_DEFAULT.y), s: Number.isFinite(s) && s > 0 ? Math.max(SIG_RANGE.s[0], Math.min(SIG_RANGE.s[1], s)) : SIG_DEFAULT.s };
    return signatureAt();
  }
  function signatureAt() { return { x: sigAt.x, y: sigAt.y, s: sigAt.s }; }
  /* the saved place, asked once; the card's own place if it cannot be read */
  var placeReady = null;
  function loadPlace() {
    if (placeReady) return placeReady;
    placeReady = (typeof fetch === 'function' ? fetch('/api/certificate-layout', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null))
      .then(function (l) { if (l && l.cards && l.cards.caregiver) setSignature(l.cards.caregiver); }, function () {});
    return placeReady;
  }

  var PRINT_DPI = 600;

  /* The rows of the front, in the template's order and words. */
  var ROWS = [
    { label: 'NAME', key: 'name' },
    { label: 'ID NUMBER', key: 'cardId' },
    { label: 'DISTRICT', key: 'district' },
    { label: 'STATE', key: 'state' },
    { label: 'ISSUED ON', key: 'issuedShort' }
  ];



  /* The photograph's well, inside its border: for a photo editor. A
     picture of these proportions fills it; any other is shown whole,
     smaller, and never cut. */
  var PHOTO_ASPECT = photoWell().h / photoWell().w;   // height / width

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

  /* The card's faces: Marcellus for the title and the name, DM Sans for
     every detail, as the card online is set (assets/digital-card.css). */
  var FACES = [
    ['PFA CC Serif', 'fonts/marcellus-latin.woff2', '400'],
    ['PFA CC Sans', 'fonts/dm-sans-latin-400.woff2', '400'],
    ['PFA CC Sans', 'fonts/dm-sans-latin-500.woff2', '500'],
    ['PFA CC Sans', 'fonts/dm-sans-latin-600.woff2', '600']
  ];
  function loadFont() {
    if (fontReady) return fontReady;
    if (typeof FontFace === 'undefined' || !document.fonts) {
      fontReady = Promise.resolve(false);
      return fontReady;
    }
    fontReady = Promise.all(FACES.map(function (f) {
      var face = new FontFace(f[0], 'url(' + f[1] + ') format("woff2")', { weight: f[2] });
      return face.load().then(function (loaded) { document.fonts.add(loaded); return true; });
    })).then(function () { return true; }).catch(function () { return false; });   // the stack stands in for a preview; printing refuses
    return fontReady;
  }

  /* The font and the two images every card needs. */
  function loadAssets() {
    return Promise.all([loadFont(), loadImage(PATTERN_SRC), loadImage(LOGO_SRC), loadImage(SIG_LIVE).then(function (im) { return im || loadImage(SIG_SRC); }), loadPlace(), loadQr()]).then(function (out) {
      return { pattern: out[1], logo: out[2], signature: out[3] };
    });
  }

  function painter(ctx, scale) {
    var u = K * scale;                      // device pixels per tenth of a millimetre
    return {
      u: u,
      v: function (n) { return n * u; }
    };
  }


  /* Inside the photograph's border, a hairline clear of it all round. */
  function photoWell() {
    var ph = { x: 612, y: 132, w: 192, h: 256, edge: 6 };   // NEW.photo
    return { x: ph.x + ph.edge, y: ph.y + ph.edge, w: ph.w - ph.edge * 2, h: ph.h - ph.edge * 2 };
  }

  /* The largest the whole picture can be inside a box, in its own
     proportions, centred: where it goes, in the box's units. */
  function fitWhole(image, b) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    if (!iw || !ih) return { x: b.x, y: b.y, w: b.w, h: b.h };
    var ratio = Math.min(b.w / iw, b.h / ih);
    var w = iw * ratio;
    var h = ih * ratio;
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w: w, h: h };
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

  /* ---- the card, in its new style (owner, 17 Nov 2026: "dont need this
     old colony caregiver card to be there anywhere") ----------------------
     The colony caregiver card online, drawn for the panel and the printer:
     sky blue, light where the logo stands; the PFA logo in its own colours;
     COLONY CAREGIVER CARD; the holder's name and place; the card number and
     the date it holds until; the photograph, whole, in a white frame on the
     right; and Smt. Maneka Sanjay Gandhi's signature. The back: the logo, a
     QR code of the card's own address, Scan to verify, and where to return
     a card that is found. In tenths of a millimetre, on 856 x 540. */
  var NEW = {
    ink: '#0b1f3a', soft: '#2b4468', hair: 'rgba(11,31,58,0.30)',
    serif: '"PFA CC Serif", Marcellus, Georgia, serif',
    sans: '"PFA CC Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
    pad: 52,
    logo: { x: 52, y: 40, h: 94 },
    title: { x: 804, y: 92, size: 34, track: 0.06 },
    /* one size for every name (owner, 24 Oct 2026: "it cannot look and feel
       different for diff people- no matter the length of the name"): the
       longest name card-print.js lets through fits beside the photograph */
    name: { x: 52, y: 222, size: 39, min: 30, maxW: 548 },
    place: { y: 258, size: 22 },
    cells: { y: 312, gap: 34, label: 14, value: 25, track: 0.16, second: 300 },
    photo: { x: 612, y: 132, w: 192, h: 256, r: 16, edge: 6 },
    sign: { x: 52, line: 452, w: 280, name: 20, role: 12.5 },
    back: { qr: { x: 52, y: 162, s: 196 }, text: { x: 290, y: 196 } }
  };
  var VALIDITY_YEARS = 3;   // lib/caregiver.js VALIDITY_YEARS

  function loadQr() { return Promise.resolve(window.PFAQR || null); }

  function sky(ctx, P, back) {
    var W = P.v(REF.w); var H = P.v(REF.h);
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#f5faff'); g.addColorStop(0.38, '#deedff'); g.addColorStop(0.75, '#bfdbfe'); g.addColorStop(1, back ? '#a9cdfb' : '#93c5fd');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    /* light where the logo stands */
    var r = ctx.createRadialGradient(P.v(150), P.v(90), 0, P.v(150), P.v(90), P.v(420));
    r.addColorStop(0, 'rgba(255,255,255,0.75)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
  }
  function font(ctx, P, weight, size, face) { ctx.font = weight + ' ' + (size * P.u).toFixed(3) + 'px ' + face; }
  function tracked(ctx, P, text, x, y, track, align) {
    /* letter-spaced text, laid letter by letter so every browser spaces it the same */
    var gap = track * parseFloat(ctx.font.split('px')[0].split(' ').pop());
    var widths = Array.prototype.map.call(text, function (ch) { return ctx.measureText(ch).width; });
    var total = widths.reduce(function (a, w) { return a + w; }, 0) + gap * Math.max(0, text.length - 1);
    var at = align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    Array.prototype.forEach.call(text, function (ch, i) { ctx.fillText(ch, at, y); at += widths[i] + gap; });
    return total;
  }
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function logo(ctx, P, data) {
    var l = NEW.logo;
    if (data && data.logoImage) {
      var im = data.logoImage;
      var w = l.h * (im.naturalWidth || im.width) / (im.naturalHeight || im.height);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, P.v(l.x), P.v(l.y), P.v(w), P.v(l.h));
      ctx.restore();
    } else {
      ctx.fillStyle = NEW.ink; font(ctx, P, '400', 22, NEW.serif);
      ctx.fillText('PEOPLE FOR ANIMALS', P.v(l.x), P.v(l.y + 60));
    }
  }
  function validUntilOf(data) {
    var v = String(data.validUntil || '');
    var d = v ? new Date(v) : (data.issuedOn ? new Date(data.issuedOn) : null);
    if (!d || isNaN(d.getTime())) return '';
    if (!v) d.setFullYear(d.getFullYear() + VALIDITY_YEARS);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  /* where there is no photograph yet: a portrait in soft navy on the
     frame's light ground (owner, 17 Nov 2026), never printed so */
  function sitter(ctx, P, well, ph) {
    ctx.save();
    rounded(ctx, P.v(well.x), P.v(well.y), P.v(well.w), P.v(well.h), P.v(ph.r - ph.edge / 2));
    ctx.clip();
    var g = ctx.createLinearGradient(0, P.v(well.y), 0, P.v(well.y + well.h));
    g.addColorStop(0, '#eef4fc'); g.addColorStop(1, '#d9e6f6');
    ctx.fillStyle = g; ctx.fillRect(P.v(well.x), P.v(well.y), P.v(well.w), P.v(well.h));
    var cx = well.x + well.w / 2; var hr = well.w * 0.21; var hy = well.y + well.h * 0.36;
    ctx.fillStyle = '#9fb4cf';
    ctx.beginPath(); ctx.arc(P.v(cx), P.v(hy), P.v(hr), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(P.v(well.x + well.w * 0.08), P.v(well.y + well.h));
    ctx.bezierCurveTo(P.v(well.x + well.w * 0.08), P.v(hy + hr * 1.55), P.v(well.x + well.w * 0.92), P.v(hy + hr * 1.55), P.v(well.x + well.w * 0.92), P.v(well.y + well.h));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawFront(ctx, scale, data) {
    var P = painter(ctx, scale);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    sky(ctx, P, false);
    logo(ctx, P, data);
    ctx.fillStyle = NEW.ink;
    font(ctx, P, '400', NEW.title.size, NEW.serif);
    tracked(ctx, P, 'COLONY CAREGIVER CARD', P.v(NEW.title.x), P.v(NEW.title.y), NEW.title.track, 'right');

    /* the name, at the one size; stepped down only in the rare case the
       card's own face runs wider than the rule measured it */
    var name = lineOf(data, 'name');
    var size = NEW.name.size;
    font(ctx, P, '400', size, NEW.serif);
    while (size > NEW.name.min && ctx.measureText(name.text).width > P.v(NEW.name.maxW)) { size -= 1; font(ctx, P, '400', size, NEW.serif); }
    ctx.fillStyle = name.ghost ? GHOST : NEW.ink;
    ctx.fillText(name.text, P.v(NEW.name.x), P.v(NEW.name.y));
    var district = lineOf(data, 'district'); var state = lineOf(data, 'state');
    font(ctx, P, '500', NEW.place.size, NEW.sans);
    ctx.fillStyle = district.ghost || state.ghost ? GHOST : NEW.soft;
    ctx.fillText([district.text, state.text].filter(Boolean).join(', '), P.v(NEW.name.x), P.v(NEW.place.y));

    /* the card number and the date it holds until */
    var c = NEW.cells;
    var id = lineOf(data, 'cardId');
    var until = validUntilOf(data);
    [[0, 'CARD NUMBER', id.text, id.ghost], [c.second, 'VALID UNTIL', until || 'When issued', !until]].forEach(function (cell) {
      ctx.fillStyle = NEW.soft; font(ctx, P, '600', c.label, NEW.sans);
      tracked(ctx, P, cell[1], P.v(NEW.pad + cell[0]), P.v(c.y), c.track);
      ctx.fillStyle = cell[3] ? GHOST : NEW.ink; font(ctx, P, '500', c.value, NEW.sans);
      ctx.fillText(cell[2], P.v(NEW.pad + cell[0]), P.v(c.y + c.gap));
    });

    /* the photograph, whole, never cropped, in a white frame; a portrait in
       soft navy where there is none yet (17 Nov 2026), never printed so */
    var ph = NEW.photo;
    ctx.save();
    ctx.shadowColor = 'rgba(11,31,58,0.28)'; ctx.shadowBlur = P.v(14); ctx.shadowOffsetY = P.v(6);
    rounded(ctx, P.v(ph.x), P.v(ph.y), P.v(ph.w), P.v(ph.h), P.v(ph.r));
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    var well = photoWell();
    if (data.photoImage) {
      /* inside the frame's straight edges, clear of its rounded corners, so
         the whole picture shows: never cut (owner, 24 Oct 2026) */
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      var fit = fitWhole(data.photoImage, well);
      ctx.drawImage(data.photoImage, P.v(fit.x), P.v(fit.y), P.v(fit.w), P.v(fit.h));
      ctx.restore();
    } else sitter(ctx, P, well, ph);

    /* the signatory: the signature on its line, the name and the role */
    var sg = NEW.sign;
    if (data.signatureImage) {
      var shh = SIG_BOX.h * sigAt.s / 100;
      var sw = shh * SIG_BOX.aspect;
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(data.signatureImage, P.v(sg.x + 6 + sigAt.x), P.v(sg.line - SIG_BOX.gap - shh + sigAt.y), P.v(sw), P.v(shh));
      ctx.restore();
    }
    ctx.fillStyle = NEW.hair; ctx.fillRect(P.v(sg.x), P.v(sg.line), P.v(sg.w), Math.max(1, P.v(1.5)));
    ctx.fillStyle = NEW.ink; font(ctx, P, '500', sg.name, NEW.sans);
    ctx.fillText('Smt. Maneka Sanjay Gandhi', P.v(sg.x), P.v(sg.line + 26));
    ctx.fillStyle = NEW.soft; font(ctx, P, '600', sg.role, NEW.sans);
    tracked(ctx, P, 'CHAIRPERSON, PEOPLE FOR ANIMALS', P.v(sg.x), P.v(sg.line + 48), 0.12);
    ctx.restore();
  }

  /* The back: the logo, the QR code of the card's own address, Scan to
     verify, and where to return a card that is found. */
  function drawBack(ctx, scale, data) {
    var P = painter(ctx, scale);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    sky(ctx, P, true);
    logo(ctx, P, data);
    ctx.fillStyle = NEW.ink;
    font(ctx, P, '400', NEW.title.size, NEW.serif);
    tracked(ctx, P, 'COLONY CAREGIVER CARD', P.v(NEW.title.x), P.v(NEW.title.y), NEW.title.track, 'right');
    var q = NEW.back.qr;
    ctx.fillStyle = '#ffffff';
    rounded(ctx, P.v(q.x), P.v(q.y), P.v(q.s), P.v(q.s), P.v(10)); ctx.fill();
    var Q = window.PFAQR;
    var url = isIssued(data) ? 'https://peopleforanimalsindia.org/card?id=' + String(data.cardId).toUpperCase() : '';
    var code = null;
    if (Q && url) { try { code = Q.matrix(url); } catch (e) { code = null; } }
    if (code) {
      var n = code.size; var quiet = 2; var cell = (q.s - 16) / (n + quiet * 2);
      ctx.fillStyle = '#000000';
      for (var rr = 0; rr < n; rr += 1) for (var cc = 0; cc < n; cc += 1) if (code.modules[rr][cc]) ctx.fillRect(P.v(q.x + 8 + (cc + quiet) * cell), P.v(q.y + 8 + (rr + quiet) * cell), Math.ceil(P.v(cell)), Math.ceil(P.v(cell)));
    } else {
      ctx.fillStyle = GHOST; font(ctx, P, '500', 16, NEW.sans);
      ctx.textAlign = 'center'; ctx.fillText('QR code once issued', P.v(q.x + q.s / 2), P.v(q.y + q.s / 2)); ctx.textAlign = 'left';
    }
    var t = NEW.back.text;
    ctx.fillStyle = NEW.ink; font(ctx, P, '400', 36, NEW.serif);
    ctx.fillText('Scan to verify', P.v(t.x), P.v(t.y + 20));
    ctx.fillStyle = NEW.soft; font(ctx, P, '400', 19, NEW.sans);
    ['Scan the QR code to see this card on the', 'People for Animals website and confirm', 'that it is valid.'].forEach(function (line, i) { ctx.fillText(line, P.v(t.x), P.v(t.y + 64 + i * 28)); });
    ctx.fillStyle = NEW.hair; ctx.fillRect(P.v(NEW.pad), P.v(430), P.v(REF.w - NEW.pad * 2), Math.max(1, P.v(1.5)));
    ctx.fillStyle = NEW.soft; font(ctx, P, '400', 15, NEW.sans);
    ctx.fillText('This card is non-transferable. If found, please return it to People for Animals,', P.v(NEW.pad), P.v(466));
    ctx.fillText('4-T, DCM Building, 16 Barakhamba Road, New Delhi 110001, India.', P.v(NEW.pad), P.v(492));
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
    /* kept, so a new signature place redraws every card on screen */
    canvas._pfaCard = [side, data, assets, cssWidth, density];
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
    if (!data || !assets || (data.patternImage && data.logoImage && data.signatureImage)) return data;
    var out = {};
    Object.keys(data).forEach(function (key) { out[key] = data[key]; });
    out.patternImage = out.patternImage || assets.pattern;
    out.logoImage = out.logoImage || assets.logo;
    out.signatureImage = out.signatureImage || assets.signature;
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

  /* ---- A4 paper (24 Oct 2026, the template's print guide) -------------------
     The template prints on A4 at actual size: "use A4, 100% / Actual size,
     with browser headers and footers off. Each card prints at 85.6 x 54 mm."
     So does this: an A4 portrait PDF, 15 mm margins as the template sets
     them, one card to a row with its front on the left and its back on the
     right, 10 mm between rows: four cards to a sheet, each face at exactly
     85.6 x 54 mm, its own edge line to cut along. */
  var A4 = { w: 210, h: 297, margin: 15, rowGap: 10, perSheet: 4 };

  function a4Layout(count) {
    var sheets = [];
    var colGap = A4.w - A4.margin * 2 - CARD.w * 2;
    for (var i = 0; i < count; i += 1) {
      var sheet = Math.floor(i / A4.perSheet);
      var row = i % A4.perSheet;
      var y = A4.margin + row * (CARD.h + A4.rowGap);
      if (!sheets[sheet]) sheets[sheet] = [];
      sheets[sheet].push({ card: i, side: 'front', xMm: A4.margin, yMm: y });
      sheets[sheet].push({ card: i, side: 'back', xMm: A4.margin + CARD.w + colGap, yMm: y });
    }
    return sheets;
  }

  /* A PDF of sheets, each with images placed in millimetres from the top
     left: { wMm, hMm, items: [{ xMm, yMm, wMm, hMm, width, height, bytes }] }. */
  function buildSheetPdf(sheets) {
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
    function pt(mm) { return (mm * 72) / 25.4; }
    var next = 3;
    var plan = sheets.map(function (sheet) {
      var page = next; next += 1;
      var content = next; next += 1;
      var images = sheet.items.map(function () { var n = next; next += 1; return n; });
      return { sheet: sheet, page: page, content: content, images: images };
    });
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    startObject(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    startObject(2); push('<< /Type /Pages /Kids [' + plan.map(function (p) { return p.page + ' 0 R'; }).join(' ') + '] /Count ' + plan.length + ' >>\nendobj\n');
    plan.forEach(function (p) {
      var W = pt(p.sheet.wMm);
      var H = pt(p.sheet.hMm);
      var draw = p.sheet.items.map(function (item, i) {
        var w = pt(item.wMm);
        var h = pt(item.hMm);
        return 'q ' + w.toFixed(3) + ' 0 0 ' + h.toFixed(3) + ' ' + pt(item.xMm).toFixed(3) + ' ' + (H - pt(item.yMm) - h).toFixed(3) + ' cm /Im' + i + ' Do Q';
      }).join('\n') + '\n';
      var xobjects = p.images.map(function (n, i) { return '/Im' + i + ' ' + n + ' 0 R'; }).join(' ');
      startObject(p.page);
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W.toFixed(3) + ' ' + H.toFixed(3)
        + '] /Resources << /XObject << ' + xobjects + ' >> >> /Contents ' + p.content + ' 0 R >>\nendobj\n');
      startObject(p.content);
      push('<< /Length ' + draw.length + ' >>\nstream\n' + draw + 'endstream\nendobj\n');
      p.sheet.items.forEach(function (item, i) {
        startObject(p.images[i]);
        push('<< /Type /XObject /Subtype /Image /Width ' + item.width + ' /Height ' + item.height
          + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + item.bytes.length + ' >>\nstream\n');
        push(item.bytes);
        push('\nendstream\nendobj\n');
      });
    });
    var objectCount = next - 1;
    var xrefOffset = length;
    var xref = 'xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n';
    for (var number = 1; number <= objectCount; number += 1) {
      xref += String(offsets[number]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  /* Ready cards (hydrated and checked) onto A4 sheets. */
  function a4Pdf(cards) {
    var faces = cards.map(function (data) {
      return { front: offscreen('front', data, PRINT_DPI), back: offscreen('back', data, PRINT_DPI) };
    });
    var sheets = a4Layout(cards.length).map(function (placed) {
      return {
        wMm: A4.w, hMm: A4.h,
        items: placed.map(function (spot) {
          var canvas = faces[spot.card][spot.side];
          return { xMm: spot.xMm, yMm: spot.yMm, wMm: CARD.w, hMm: CARD.h, width: canvas.width, height: canvas.height, bytes: jpegBytes(canvas, 0.95) };
        })
      };
    });
    return buildSheetPdf(sheets);
  }

  function downloadA4(list, filename) {
    var cards = Array.isArray(list) ? list : [list];
    return loadAssets().then(function () {
      return Promise.all(cards.map(function (data) {
        return (data && data.patternImage ? Promise.resolve(data) : hydrate(data)).then(printReady);
      }));
    }).then(function (ready) {
      saveBlob(a4Pdf(ready), filename || (cards.length === 1 ? fileStem(cards[0]) + '-a4.pdf' : 'pfa-colony-cards-a4.pdf'));
    });
  }

  /* ---- a PNG that prints at its size -------------------------------------
     The template's PNGs are "approximately 600 dpi at that size; set their
     printed width to 85.6 mm". These carry their resolution in the file (a
     pHYs chunk), so a photo printer or a layout program places them at
     85.6 x 54 mm without being told. */
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function pngWithDpi(bytes, dpi) {
    var ppm = Math.round(dpi / 0.0254);
    var chunk = new Uint8Array(21);
    var view = new DataView(chunk.buffer);
    view.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);           // pHYs
    view.setUint32(8, ppm);
    view.setUint32(12, ppm);
    chunk[16] = 1;                                    // per metre
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    var ihdrEnd = 8 + 4 + 4 + 13 + 4;                 // signature, then IHDR
    var out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, ihdrEnd), 0);
    out.set(chunk, ihdrEnd);
    out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
    return out;
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
      copy.signatureImage = out[1].signature;
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
      if (document.fonts && document.fonts.check && !(document.fonts.check('25px "PFA CC Serif"') && document.fonts.check('600 25px "PFA CC Sans"'))) {
        throw new Error('The card font did not load, so the card cannot be printed exactly. Reload the page and try again.');
      }
      var missing = unprintable(data || {});
      if (missing.length) throw new Error('This card is not ready to print: no ' + missing.join(', no ') + '.');
      /* a card is never printed with PHOTO where the face should be */
      if (!data.photoImage) throw new Error('This card has no photograph, so it is not printed. Add one with "Use a photograph from this computer", or match one from a folder.');
      /* nor without the signature (15 Nov 2026) */
      if (!data.signatureImage) throw new Error('The signature did not load, so the card is not printed. Reload the page and try again.');
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
            return blob.arrayBuffer().then(function (buffer) {
              return new Blob([pngWithDpi(new Uint8Array(buffer), PRINT_DPI)], { type: 'image/png' });
            });
          }).then(function (blob) {
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
    photoFit: function (image) { return fitWhole(image, photoWell()); },
    photoWell: photoWell,
    PHOTO_ASPECT: PHOTO_ASPECT,
    _buildPdf: buildPdf,
    _buildSheetPdf: buildSheetPdf,
    _pngWithDpi: pngWithDpi,
    A4: A4,
    a4Layout: a4Layout,
    downloadA4: downloadA4,
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
    saveBlob: saveBlob,
    setSignature: setSignature,
    signatureAt: signatureAt,
    SIG_RANGE: SIG_RANGE,
    SIG_DEFAULT: SIG_DEFAULT,
    loadPlace: loadPlace,
    /* every card drawn on screen, drawn again (the studio's Signature position) */
    redraw: function () {
      Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (c) {
        if (c._pfaCard && document.body.contains(c)) draw.apply(null, [c].concat(c._pfaCard));
      });
    }
  };
})();
