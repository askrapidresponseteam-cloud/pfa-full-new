/* People for Animals - the membership card.

   One renderer draws every copy of the card: the preview a reviewer sees
   before approving a member's photograph, the card studio, and the pages the
   office prints from. It is loaded by the admin panel only. The member is
   never sent or shown the card: the printed card is the only copy (owner,
   26 Oct 2026, as for the colony caregiver card).

   The design is the owner's own template (15 Nov 2026: "PFA-Premium-
   Membership.html for membership. let this be the exact template", then
   "Black design everywhere"), the same as the card online
   (assets/digital-card.js): matte black, the PFA logo for dark grounds
   and the tier across the top, Member, the name and the place on the
   left, and the member number and Member since along the foot, all in
   Marcellus; the member's approved photograph framed on the right (16 Nov 2026). On the
   back, A voice for the voiceless., what the card is for, a QR code that
   checks the member number on the site, and the chairperson's signature
   just above the line.
   ISO/IEC 7810 ID-1, 85.6 x 54 mm, landscape. Every number below is in
   tenths of a millimetre on that card (856 x 540).

   Type is fixed: the name prints at one size, and a name that does not fit
   is shortened by the reviewer before approval (fitsName, suggestName). A
   district or state too long for its column (a handful of Indian place
   names are) is set a little smaller to fit, down to a floor, rather than
   run into its neighbour. */
(function () {
  'use strict';

  var CARD = { w: 85.6, h: 54 };       // mm
  var REF = { w: 856, h: 540 };        // tenths of a mm

  var INK = '#e7e7e5';
  var TIER = '#c1c5c9';
  var LABEL = '#969da5';
  var ROLE = '#b4b9bf';
  var FOOT = '#aeb4bb';
  var RULE = 'rgba(255,255,255,0.18)';
  var EMBOSS = '';

  var SERIF = '"PFA Card Marcellus", Marcellus, Georgia, serif';
  var SANS = SERIF;
  var FONTS = [
    ['PFA Card Marcellus', 'fonts/marcellus-latin.woff2', '400']
  ];
  var LOGO_SRC = 'img/logo-dark.png';
  /* the member number, checked on the site by anyone who scans the back */
  var CHECK_URL = 'https://peopleforanimalsindia.org/verify-certificate.html?n=';
  /* Smt. Maneka Sanjay Gandhi's signature (owner, 15 Nov 2026: "Add Maneka
     Gandhi's signature to caregiver and membership cards using the same
     logic as the internship certificate"): the certificate's own, at print
     quality, above the signature line and centred on it, moved from there
     by the studio's Signature position, kept for the whole site
     (lib/certificate-layout.js, /api/certificate-layout). A card is never
     printed without it. */
  var SIG_SRC = 'assets/certificates/signature-print.png';
  /* the signature chosen for cards in the panel, in its colour (lib/routes/
     signature.js; owner, 22 Nov 2026); the built-in one when it cannot be had */
  var SIG_LIVE = '/api/signature?for=card';
  var SIG_BOX = { h: 62, aspect: 1512 / 438, gap: 1 };
  var SIG_RANGE = { x: 860, y: 540, s: [20, 300] };
  var SIG_DEFAULT = { x: 0, y: 0, s: 100 };
  var sigAt = { x: 0, y: 0, s: 100 };
  var signature = null;
  function setSignature(l) {
    var c = function (v, max, d) { var n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : d; };
    var s = Math.round(Number(l && l.s));
    sigAt = { x: c(l && l.x, SIG_RANGE.x, SIG_DEFAULT.x), y: c(l && l.y, SIG_RANGE.y, SIG_DEFAULT.y), s: Number.isFinite(s) && s > 0 ? Math.max(SIG_RANGE.s[0], Math.min(SIG_RANGE.s[1], s)) : SIG_DEFAULT.s };
    return signatureAt();
  }
  function signatureAt() { return { x: sigAt.x, y: sigAt.y, s: sigAt.s }; }
  var LOGO_ASPECT = 924 / 316;

  /* ---- the layout: the template's 640 px card, in tenths of a mm -------- */
  var L = {
    pad: 51,
    radius: 40,
    logo: { x: 51, y: 51, w: 233, h: 80 },
    tier: { right: 805, base: 97, size: 16, track: 0.24 },
    left: { x: 51, w: 640 },
    /* the member's photograph, on the right (owner, 16 Nov 2026: "We can
       still have photo appended on membership card (right side) - find the
       place and position- state of the art class"): below the tier, clear
       of the foot, 3:4 as the member framed it; the name keeps clear of it */
    photo: { x: 594, y: 138, w: 211, h: 281, r: 12, nameW: 503 },
    label: { size: 14, track: 0.26 },
    name: { labelBase: 330, base: 382, size: 42, track: 0.01 },
    role: { base: 424, size: 15, track: 0.18 },
    rule: { y: 456 },
    foot: { base: 502, size: 16, track: 0.2 },
    back: {
      head: { base: 206, size: 35, track: 0 },
      lines: { first: 244, lead: 24, size: 15 },
      qr: { x: 655, y: 160, w: 150, label: 336, labelSize: 12 },
      sign: { h: 50, nameBase: 420, nameSize: 15, roleBase: 441, roleSize: 12.5 }
    }
  };

  var SIGNATORY = { name: 'SMT. MANEKA SANJAY GANDHI', role: 'CHAIRPERSON, PEOPLE FOR ANIMALS' };
  var BACK_LINES = [
    'This card identifies the named member of People for Animals.',
    'If found, please return it to a PFA centre.',
    'Non-transferable. Any misuse will lead to its withdrawal.'
  ];

  /* ---- loading ------------------------------------------------------------ */
  var loading = null;
  var logo = null;

  function ready() {
    if (loading) return loading;
    var fonts = FONTS.map(function (f) {
      if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve();
      var face = new FontFace(f[0], 'url("' + f[1] + '") format("woff2")', { weight: f[2], style: 'normal' });
      return face.load().then(function (loaded) { document.fonts.add(loaded); }).catch(function () {});
    });
    var image = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { logo = img; resolve(); };
      img.onerror = function () { resolve(); };
      img.src = LOGO_SRC;
    });
    var signed = new Promise(function (resolve) {
      var img = new Image();
      var tried = false;
      img.onload = function () { signature = whiten(img); resolve(); };
      img.onerror = function () { if (!tried) { tried = true; img.src = SIG_SRC; return; } resolve(); };
      img.src = SIG_LIVE;
    });
    var placed = (typeof fetch === 'function' ? fetch('/api/certificate-layout', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null))
      .then(function (l) { if (l && l.cards && l.cards.member) setSignature(l.cards.member); }, function () {});
    loading = Promise.all(fonts.concat([image, signed, placed]));
    return loading;
  }

  /* the signature in white, for the black card: its own ink, filled white */
  function whiten(img) {
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
      return c;
    } catch (e) { return img; }
  }

  /* ---- type ----------------------------------------------------------------- */
  function font(ctx, family, weight, size) {
    ctx.font = weight + ' ' + size + 'px ' + family;
  }

  /* Width with tracking, drawn character by character so the measure is the
     same in every browser (canvas letterSpacing is not everywhere yet). */
  function measure(ctx, text, size, track) {
    var t = String(text || '');
    var w = 0;
    for (var i = 0; i < t.length; i += 1) w += ctx.measureText(t.charAt(i)).width;
    return w + Math.max(0, t.length - 1) * track * size;
  }

  function tracked(ctx, text, x, y, size, track, align, emboss) {
    var t = String(text || '');
    var total = measure(ctx, t, size, track);
    var start = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    function pass(dy, colour) {
      var save = ctx.fillStyle;
      if (colour) ctx.fillStyle = colour;
      var cx = start;
      for (var i = 0; i < t.length; i += 1) {
        var ch = t.charAt(i);
        ctx.fillText(ch, cx, y + dy);
        cx += ctx.measureText(ch).width + track * size;
      }
      ctx.fillStyle = save;
    }
    if (emboss) pass(1, EMBOSS);
    pass(0);
    return total;
  }

  /* The largest size from `size` down to `floor` at which `text` fits `max`. */
  function fitSize(ctx, family, weight, text, size, floor, track, max) {
    for (var s = size; s >= floor; s -= 0.5) {
      font(ctx, family, weight, s);
      if (measure(ctx, text, s, track) <= max) return s;
    }
    font(ctx, family, weight, floor);
    return floor;
  }

  var probe = null;
  function probeCtx() {
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    return probe;
  }

  /* Whether a name prints whole at the card's one size. */
  function fitsName(name) {
    var ctx = probeCtx();
    font(ctx, SERIF, '400', L.name.size);
    return measure(ctx, name, L.name.size, L.name.track) <= L.photo.nameW;
  }

  /* A name that fits: whole if it does, else middle names to initials, else
     the first name to an initial too. '' when nothing fits. */
  function suggestName(name) {
    var words = String(name || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return '';
    var whole = words.join(' ');
    if (fitsName(whole)) return whole;
    var initial = function (w) { return w.charAt(0).toUpperCase() + '.'; };
    if (words.length > 2) {
      var mid = [words[0]].concat(words.slice(1, -1).map(initial), [words[words.length - 1]]).join(' ');
      if (fitsName(mid)) return mid;
    }
    if (words.length > 1) {
      var short = words.slice(0, -1).map(initial).concat([words[words.length - 1]]).join(' ');
      if (fitsName(short)) return short;
    }
    return '';
  }

  /* ---- the ground: the template's matte black ----------------------------- */
  function ground(ctx) {
    /* linear-gradient(125deg, #303234 0%, #111213 39%, #08090a 75%, #202224 100%) */
    var a = 125 * Math.PI / 180;
    var dx = Math.sin(a);
    var dy = -Math.cos(a);
    var half = (Math.abs(REF.w * dx) + Math.abs(REF.h * dy)) / 2;
    var g = ctx.createLinearGradient(REF.w / 2 - dx * half, REF.h / 2 - dy * half, REF.w / 2 + dx * half, REF.h / 2 + dy * half);
    [[0, '#303234'], [0.39, '#111213'], [0.75, '#08090a'], [1, '#202224']].forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, REF.w, REF.h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function logoAt(ctx, x, y, w, h) {
    if (!logo) return;
    var fitW = Math.min(w, h * LOGO_ASPECT);
    var fitH = fitW / LOGO_ASPECT;
    ctx.drawImage(logo, x, y + (h - fitH) / 2, fitW, fitH);
  }

  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var ist = new Date(d.getTime() + 330 * 60 * 1000);
    return p(ist.getUTCDate()) + '/' + p(ist.getUTCMonth() + 1) + '/' + ist.getUTCFullYear();
  }

  /* ---- the faces ------------------------------------------------------------ */
  function memberSince(card) {
    var m = /^(\d{4})/.exec(String(card.approvedAt || card.validFrom || card.paidAt || ''));
    return m ? m[1] : '';
  }
  function tierText(card) {
    var t = String(card.tierWord || card.tierLabel || '').replace(/\s*membership$/i, '').trim();
    return ((t ? t + ' ' : '') + 'Membership').toUpperCase();
  }
  function rule(ctx) {
    ctx.fillStyle = RULE;
    ctx.fillRect(L.pad, L.rule.y, REF.w - 2 * L.pad, 1.2);
  }

  function front(ctx, card, photo) {
    ground(ctx);
    var withPhoto = Boolean(photo && photo.width);
    var nameW = withPhoto ? L.photo.nameW : L.left.w;
    if (withPhoto) {
      var P = L.photo;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 10;
      roundRect(ctx, P.x, P.y, P.w, P.h, P.r);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, P.x, P.y, P.w, P.h, P.r);
      ctx.clip();
      /* the whole photograph, never cut to fit (29 Oct 2026) */
      var scale = Math.min(P.w / photo.width, P.h / photo.height);
      var pw = photo.width * scale;
      var ph = photo.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(photo, P.x + (P.w - pw) / 2, P.y + (P.h - ph) / 2, pw, ph);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.2;
      roundRect(ctx, P.x + 0.6, P.y + 0.6, P.w - 1.2, P.h - 1.2, P.r);
      ctx.stroke();
      ctx.restore();
    }
    logoAt(ctx, L.logo.x, L.logo.y, L.logo.w, L.logo.h);
    ctx.fillStyle = TIER;
    font(ctx, SERIF, '400', L.tier.size);
    tracked(ctx, tierText(card), L.tier.right, L.tier.base, L.tier.size, L.tier.track, 'right');

    ctx.fillStyle = LABEL;
    font(ctx, SERIF, '400', L.label.size);
    tracked(ctx, 'MEMBER', L.left.x, L.name.labelBase, L.label.size, L.label.track, 'left');
    ctx.fillStyle = INK;
    var name = card.printName || card.name || '';
    var size = fitSize(ctx, SERIF, '400', name, L.name.size, 30, L.name.track, nameW);
    tracked(ctx, name, L.left.x, L.name.base, size, L.name.track, 'left');
    var place = [card.district, card.state].filter(Boolean).join(', ').toUpperCase();
    if (place) {
      ctx.fillStyle = ROLE;
      var ps = fitSize(ctx, SERIF, '400', place, L.role.size, 11, L.role.track, nameW);
      tracked(ctx, place, L.left.x, L.role.base, ps, L.role.track, 'left');
    }

    rule(ctx);
    ctx.fillStyle = FOOT;
    font(ctx, SERIF, '400', L.foot.size);
    tracked(ctx, String(card.cardId || card.reference || '').toUpperCase(), L.pad, L.foot.base, L.foot.size, L.foot.track, 'left');
    var since = memberSince(card);
    if (since) tracked(ctx, 'MEMBER SINCE  ' + since, REF.w - L.pad, L.foot.base, L.foot.size, L.foot.track, 'right');
  }

  function back(ctx, card) {
    ground(ctx);
    var B = L.back;
    logoAt(ctx, L.logo.x, L.logo.y, L.logo.w, L.logo.h);

    ctx.fillStyle = INK;
    font(ctx, SERIF, '400', B.head.size);
    tracked(ctx, 'A voice for the voiceless.', L.pad, B.head.base, B.head.size, B.head.track, 'left');
    ctx.fillStyle = FOOT;
    font(ctx, SERIF, '400', B.lines.size);
    BACK_LINES.forEach(function (line, i) { tracked(ctx, line, L.pad, B.lines.first + i * B.lines.lead, B.lines.size, 0.01, 'left'); });

    /* the QR code: the member number, checked on the site */
    var number = String((card && (card.cardId || card.reference)) || '');
    var Q = B.qr;
    if (number && window.PFAQR) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, Q.x, Q.y, Q.w, Q.w, 8);
      ctx.fill();
      ctx.restore();
      var quiet = Q.w * 2 / 37;
      window.PFAQR.paint(ctx, CHECK_URL + encodeURIComponent(number), Q.x + quiet, Q.y + quiet, Q.w - 2 * quiet);
      ctx.fillStyle = FOOT;
      font(ctx, SERIF, '400', Q.labelSize);
      tracked(ctx, 'SCAN TO VERIFY', Q.x + Q.w / 2, Q.label, Q.labelSize, 0.24, 'center');
    }

    /* the signature, just above the line, the name and the role under it */
    if (signature) {
      var shh = B.sign.h * sigAt.s / 100;
      var sw = shh * SIG_BOX.aspect;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(signature, L.pad + sigAt.x, B.sign.nameBase - 16 - shh + sigAt.y, sw, shh);
      ctx.restore();
    }
    ctx.fillStyle = INK;
    font(ctx, SERIF, '400', B.sign.nameSize);
    tracked(ctx, SIGNATORY.name, L.pad, B.sign.nameBase, B.sign.nameSize, 0.12, 'left');
    ctx.fillStyle = LABEL;
    font(ctx, SERIF, '400', B.sign.roleSize);
    tracked(ctx, SIGNATORY.role, L.pad, B.sign.roleBase, B.sign.roleSize, 0.12, 'left');

    rule(ctx);
    ctx.fillStyle = FOOT;
    font(ctx, SERIF, '400', 14);
    tracked(ctx, 'peopleforanimalsindia.org', L.pad, L.foot.base, 14, 0.08, 'left');
    font(ctx, SERIF, '400', L.foot.size);
    tracked(ctx, number.toUpperCase(), REF.w - L.pad, L.foot.base, L.foot.size, L.foot.track, 'right');
  }

  /* Draws one face onto a canvas at `pxPerUnit` (1 = 856 x 540). Rounded
     corners for the screen; square for the printer, which cuts the card. */
  function draw(canvas, side, card, options) {
    var o = options || {};
    /* kept, so a new signature place redraws every card on screen */
    canvas._pfaMember = [side, card, options];
    var k = o.pxPerUnit || 1;
    canvas.width = Math.round(REF.w * k);
    canvas.height = Math.round(REF.h * k);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, REF.w, REF.h);
    ctx.save();
    if (o.rounded !== false) { roundRect(ctx, 0, 0, REF.w, REF.h, L.radius); ctx.clip(); }
    if (side === 'back') back(ctx, card || {}); else front(ctx, card || {}, o.photo || null);
    if (o.rounded !== false) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      roundRect(ctx, 1, 1, REF.w - 2, REF.h - 2, L.radius);
      ctx.stroke();
    }
    ctx.restore();
    return canvas;
  }

  /* ---- for the printer ------------------------------------------------------ */
  var PRINT_DPI = 600;
  function printScale() { return (CARD.w / 25.4) * PRINT_DPI / REF.w; }   // about 2.36 px a unit

  function pngOf(side, card, photo) {
    if (!signature) throw new Error('The signature did not load, so the card is not printed. Reload the page and try again.');
    var c = document.createElement('canvas');
    draw(c, side, card, { pxPerUnit: printScale(), rounded: false, photo: photo });
    return c.toDataURL('image/png');
  }

  function loadPhoto(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  /* A print window: each card's front, then its back, one face to a page at
     85.6 x 54 mm, for a card printer (or a PDF from the print dialog). */
  function printCards(list) {
    var win = window.open('', '_blank');
    if (!win) return Promise.reject(new Error('The browser blocked the print window. Allow pop-ups for the panel and try again.'));
    win.document.write('<!doctype html><title>Membership cards</title><p style="font:14px Arial;margin:24px">Preparing the cards...</p>');
    return ready().then(function () {
      if (!signature) { win.close(); throw new Error('The signature did not load, so the cards are not printed. Reload the page and try again.'); }
      return Promise.all((list || []).map(function (item) {
        return loadPhoto(item.photoSrc).then(function (photo) {
          return [pngOf('front', item.card, photo), pngOf('back', item.card, null)];
        });
      }));
    }).then(function (pairs) {
      var pages = [];
      pairs.forEach(function (p) { pages.push(p[0], p[1]); });
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>Membership cards</title><style>'
        + '@page{size:85.6mm 54mm;margin:0}html,body{margin:0;padding:0;background:#fff}'
        + 'img{display:block;width:85.6mm;height:54mm;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}'
        + '@media screen{body{background:#ddd;padding:12px}img{margin:0 auto 12px;box-shadow:0 1px 4px rgba(0,0,0,.25)}}'
        + '</style></head><body>' + pages.map(function (src) { return '<img alt="" src="' + src + '">'; }).join('')
        + '<script>window.onload=function(){setTimeout(function(){window.print();},300);};</' + 'script></body></html>';
      win.document.open();
      win.document.write(html);
      win.document.close();
      return pages.length / 2;
    });
  }

  window.PFAMemberCard = {
    ready: ready, draw: draw, pngOf: pngOf, printCards: printCards, loadPhoto: loadPhoto,
    fitsName: fitsName, suggestName: suggestName, shortDate: shortDate,
    setSignature: setSignature, signatureAt: signatureAt, SIG_RANGE: SIG_RANGE, SIG_DEFAULT: SIG_DEFAULT,
    redraw: function () {
      Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (c) {
        if (c._pfaMember && document.body.contains(c)) draw.apply(null, [c].concat(c._pfaMember));
      });
    },
    CARD: CARD, REF: REF, LAYOUT: L
  };
})();
