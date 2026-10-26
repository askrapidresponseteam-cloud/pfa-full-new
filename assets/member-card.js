/* People for Animals - the membership card.

   One renderer draws every copy of the card: the preview a reviewer sees
   before approving a member's photograph, the card studio, and the pages the
   office prints from. It is loaded by the admin panel only. The member is
   never sent or shown the card: the printed card is the only copy (owner,
   26 Oct 2026, as for the colony caregiver card).

   The design is the owner's (26 Oct 2026): brushed silver, the PFA logo and
   MEMBERSHIP CARD across the top, the member's details on the left with the
   chairperson's signature under them, and the photograph on the right. On
   the back, the large logo and the same return lines as the caregiver card.
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

  var INK = '#1b1b1b';
  var MUTED = '#383836';
  var RULE = 'rgba(27,27,27,0.55)';
  var FRAME = 'rgba(27,27,27,0.40)';
  var WELL = 'rgba(255,255,255,0.18)';
  var EMBOSS = 'rgba(255,255,255,0.6)';

  var SERIF = '"PFA Card Cinzel", Georgia, serif';
  var SANS = '"PFA Card DM Sans", Arial, Helvetica, sans-serif';
  var FONTS = [
    ['PFA Card Cinzel', 'fonts/cinzel-latin-500.woff2', '500'],
    ['PFA Card Cinzel', 'fonts/cinzel-latin-600.woff2', '600'],
    ['PFA Card DM Sans', 'fonts/dm-sans-latin-400.woff2', '400'],
    ['PFA Card DM Sans', 'fonts/dm-sans-latin-500.woff2', '500'],
    ['PFA Card DM Sans', 'fonts/dm-sans-latin-600.woff2', '600']
  ];
  var LOGO_SRC = 'media/member-card-logo.png';
  var LOGO_ASPECT = 386 / 259;

  /* ---- the layout --------------------------------------------------------- */
  var L = {
    pad: { top: 42, side: 52, bottom: 44 },
    radius: 32,
    logo: { x: 52, y: 42, w: 140, h: 94 },
    title: { text: 'MEMBERSHIP CARD', right: 804, base: 102, size: 36, track: 0.1 },
    body: { top: 160, bottom: 496 },
    photo: { x: 552, y: 160, w: 252, h: 336, r: 14, line: 2 },
    left: { x: 52, w: 464 },
    label: { size: 16, track: 0.18 },
    name: { labelBase: 175, base: 217, size: 38, track: 0.04 },
    /* the left column is the wider: a member number is 18 characters, and
       one column line for both rows keeps them aligned */
    grid: { gap: 28, rows: [{ labelBase: 260, base: 290, split: 0.56 }, { labelBase: 334, base: 364, split: 0.56 }], size: 21, floor: 16, track: 0.02 },
    sign: { x: 52, lineY: 449, lineW: 250, nameBase: 474, nameSize: 17, roleBase: 494, roleSize: 14 },
    back: { logo: { w: 344, h: 231, y: 76 }, gap: 34, size: 18, lead: 23.4 }
  };

  var SIGNATORY = { name: 'Smt. Maneka Sanjay Gandhi', role: 'CHAIRPERSON, PEOPLE FOR ANIMALS' };
  var RETURN_LINES = [
    'This card is non-transferable.',
    'If found, please return it to-',
    'People For Animals.',
    '4-T, DCM Building, 16 Barakhamba Road,',
    'New Delhi 110001, India'
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
    loading = Promise.all(fonts.concat([image]));
    return loading;
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
    font(ctx, SERIF, '500', L.name.size);
    return measure(ctx, name, L.name.size, L.name.track) <= L.left.w;
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

  /* ---- the ground: brushed silver ----------------------------------------- */
  function ground(ctx, sheenX) {
    var g = ctx.createLinearGradient(0, 0, REF.w, REF.w * Math.tan(22 * Math.PI / 180));
    [[0, '#9a9995'], [0.24, '#c7c6c1'], [0.44, '#f1f0ec'], [0.62, '#b9b8b3'], [0.80, '#d4d3ce'], [1, '#9d9c97']]
      .forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, REF.w, REF.h);

    ctx.save();
    ctx.translate(REF.w * sheenX, REF.h * 0.2);
    ctx.scale(0.55 * REF.w / (1.4 * REF.h), 1);
    var r = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.4 * REF.h * 0.6);
    r.addColorStop(0, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(-REF.w * 2, -REF.h * 2, REF.w * 4, REF.h * 4);
    ctx.restore();

    for (var y = 0; y < REF.h; y += 4) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(0, y, REF.w, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(0, y + 1, REF.w, 1);
    }
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
  function front(ctx, card, photo) {
    ground(ctx, 0.4);
    logoAt(ctx, L.logo.x, L.logo.y, L.logo.w, L.logo.h);

    ctx.fillStyle = INK;
    font(ctx, SERIF, '600', L.title.size);
    tracked(ctx, L.title.text, L.title.right, L.title.base, L.title.size, L.title.track, 'right', true);

    /* the name */
    ctx.fillStyle = MUTED;
    font(ctx, SANS, '600', L.label.size);
    tracked(ctx, 'NAME', L.left.x, L.name.labelBase, L.label.size, L.label.track, 'left');
    ctx.fillStyle = INK;
    font(ctx, SERIF, '500', L.name.size);
    tracked(ctx, card.printName || card.name || '', L.left.x, L.name.base, L.name.size, L.name.track, 'left', true);

    /* the two rows of details */
    var cells = [
      [['MEMBER ID', card.cardId || card.reference || ''], ['VALID TILL', card.lifetime ? 'Lifetime' : shortDate(card.validUntil)]],
      [['DISTRICT', card.district || ''], ['STATE', card.state || '']]
    ];
    cells.forEach(function (row, i) {
      var r = L.grid.rows[i];
      var colA = (L.left.w - L.grid.gap) * r.split;
      var colB = L.left.w - L.grid.gap - colA;
      var xB = L.left.x + colA + L.grid.gap;
      row.forEach(function (cell, j) {
        var x = j ? xB : L.left.x;
        var max = j ? colB : colA;
        ctx.fillStyle = MUTED;
        font(ctx, SANS, '600', L.label.size);
        tracked(ctx, cell[0], x, r.labelBase, L.label.size, L.label.track, 'left');
        ctx.fillStyle = INK;
        var size = fitSize(ctx, SANS, '500', cell[1], L.grid.size, L.grid.floor, L.grid.track, max);
        tracked(ctx, cell[1], x, r.base, size, L.grid.track, 'left', true);
      });
    });

    /* the signature: a clear space to sign above the line */
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(L.sign.x, L.sign.lineY);
    ctx.lineTo(L.sign.x + L.sign.lineW, L.sign.lineY);
    ctx.stroke();
    ctx.fillStyle = INK;
    font(ctx, SERIF, '600', L.sign.nameSize);
    tracked(ctx, SIGNATORY.name, L.sign.x, L.sign.nameBase, L.sign.nameSize, 0.02, 'left');
    ctx.fillStyle = MUTED;
    font(ctx, SANS, '500', L.sign.roleSize);
    tracked(ctx, SIGNATORY.role, L.sign.x, L.sign.roleBase, L.sign.roleSize, 0.1, 'left');

    /* the photograph */
    var P = L.photo;
    ctx.save();
    roundRect(ctx, P.x, P.y, P.w, P.h, P.r);
    ctx.fillStyle = WELL;
    ctx.fill();
    ctx.clip();
    if (photo && photo.width) {
      var scale = Math.max(P.w / photo.width, P.h / photo.height);
      var w = photo.width * scale;
      var h = photo.height * scale;
      ctx.drawImage(photo, P.x + (P.w - w) / 2, P.y + (P.h - h) / 2, w, h);
    } else {
      ctx.fillStyle = MUTED;
      font(ctx, SANS, '600', L.label.size);
      tracked(ctx, 'PHOTO', P.x + P.w / 2, P.y + P.h / 2 + 6, L.label.size, 0.22, 'center');
    }
    ctx.restore();
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = P.line;
    roundRect(ctx, P.x + P.line / 2, P.y + P.line / 2, P.w - P.line, P.h - P.line, P.r);
    ctx.stroke();
  }

  function back(ctx) {
    ground(ctx, 0.6);
    var B = L.back;
    logoAt(ctx, (REF.w - B.logo.w) / 2, B.logo.y, B.logo.w, B.logo.h);
    ctx.fillStyle = INK;
    font(ctx, SANS, '400', B.size);
    var y = B.logo.y + B.logo.h + B.gap + B.size;
    RETURN_LINES.forEach(function (line, i) {
      tracked(ctx, line, REF.w / 2, y + i * B.lead, B.size, 0, 'center');
    });
  }

  /* Draws one face onto a canvas at `pxPerUnit` (1 = 856 x 540). Rounded
     corners for the screen; square for the printer, which cuts the card. */
  function draw(canvas, side, card, options) {
    var o = options || {};
    var k = o.pxPerUnit || 1;
    canvas.width = Math.round(REF.w * k);
    canvas.height = Math.round(REF.h * k);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, REF.w, REF.h);
    ctx.save();
    if (o.rounded !== false) { roundRect(ctx, 0, 0, REF.w, REF.h, L.radius); ctx.clip(); }
    if (side === 'back') back(ctx); else front(ctx, card || {}, o.photo || null);
    if (o.rounded !== false) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
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
    CARD: CARD, REF: REF, LAYOUT: L
  };
})();
