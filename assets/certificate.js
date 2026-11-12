/* People for Animals - the internship certificate, drawn in the browser.
   ------------------------------------------------------------------------
   Owner, 31 Oct 2026: "this certificate should be admin generatable"; the
   design since 11 Nov 2026 is the owner's PFA-Certificate.html ("this is
   the internship certificate btw", "font has to be marcellus").

   The artwork is that design with its three blanks taken out
   (assets/certificates/completion.webp, 2240 x 1584, the design drawn at
   twice its 1120 x 792, which is A4 landscape exactly), made by
   scripts/build-certificate-art.js. On it this draws, where the design put
   them, all in Marcellus:
     the intern's name        43px, the design's ink, sized down to fit
     Date of completion       the internship's last day
     Certificate ID           the number the server gave it (PFA-INT-...)
   Nothing else is written; the words already in the design stay as drawn.
   The places are the design's own, read from it in a browser (the
   baselines below), so the drawn certificate and the design match.

   PFACertificate.draw(canvas, data, scale)   onto a canvas, at 1x or more
   PFACertificate.png(data, opts) -> Promise<Blob>  at print quality
   PFACertificate.pdf(data, opts) -> Promise<Blob>  A4 landscape, at print
                                               quality; opts { scale }

   Print quality (owner, 12 Nov 2026: "the cert sent as an attachment over
   email is of low res. can you make it super high/highest quality"): the
   PDF and the downloaded picture are drawn on the print masters
   (assets/certificates/completion-print.png and signature-print.png, the
   design at 6x, lossless) at 6x, 6720 x 4752, about 575 dots per inch on
   A4, and the PDF carries that picture losslessly: no JPEG anywhere, so
   every letter and line prints as sharp as the design. 6x is for the panel;
   a phone, whose browser cannot make a picture that large, is given 4x
   (about 380 dots per inch), and any browser that still cannot is given
   the largest it can make.
   PFACertificate.save(blob, filename)
   data: { name, startDate, endDate, issuedOn, number, sample }, dates as
   YYYY-MM-DD; sample marks it SAMPLE across its face (the public preview).
   ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var W = 1120;
  var H = 792;
  /* the page that loads this may sit anywhere on the site, so the files are
     asked for from the site's root */
  var ROOT = (function () {
    try { var s = root.document && root.document.currentScript; if (s && s.src) return s.src.replace(/assets\/certificate\.js(\?.*)?$/, ''); } catch (e) {}
    return '';
  }());
  var ART = ROOT + 'assets/certificates/completion.webp';
  var INK = '#242620';
  var FONTS = [
    ['Marcellus', ROOT + 'fonts/marcellus-latin.woff2', '400']
  ];
  var FACE = '"Marcellus", Georgia, serif';
  /* where the design writes them: x, and the baseline, in the design's own pixels */
  var AT = { name: { x: 560, y: 420.16, max: 900 }, date: { x: 66, y: 649.7 }, number: { x: 66, y: 697.7 } };
  /* The signature, drawn on its own (owner, 12 Nov 2026: "signature a bit
     more to the right", then with the design's own controls: "update this
     certificate with controls"): where the design first puts it (x, y, w, h,
     read by scripts/build-certificate-art.js), and how far it is moved from
     there, in the design's pixels. The move is the panel's Signature
     position, kept for the whole site (lib/certificate-layout.js) and set
     here by setLayout before a certificate is drawn; until it is, the
     design's own: 26 to the right. Within the design's own ranges: 100
     either way across, 50 up or down. */
  var SIG_ART = ROOT + 'assets/certificates/signature.png';
  /* the same two at 6x, lossless, for the PDF and the download */
  var ART_PRINT = ROOT + 'assets/certificates/completion-print.png';
  var SIG_PRINT = ROOT + 'assets/certificates/signature-print.png';
  var PRINT_SCALE = 6;
  var SIG = { x: 798, y: 653, w: 252, h: 73, dx: 26, dy: 0 };
  var SIG_RANGE = { x: 100, y: 50 };
  var SIG_DEFAULT = { x: 26, y: 0 };
  function setLayout(l) {
    var c = function (v, max, d) { var n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : d; };
    SIG.dx = c(l && l.x, SIG_RANGE.x, SIG_DEFAULT.x);
    SIG.dy = c(l && l.y, SIG_RANGE.y, SIG_DEFAULT.y);
    return layout();
  }
  function layout() { return { x: SIG.dx, y: SIG.dy }; }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var ready = null;
  var artwork = null;
  var signature = null;
  function load() {
    if (ready) return ready;
    var fonts = FONTS.map(function (f) {
      if (!root.FontFace || !root.document.fonts) return Promise.resolve();
      var face = new root.FontFace(f[0], 'url(' + f[1] + ')', { weight: f[2] });
      return face.load().then(function (loaded) { root.document.fonts.add(loaded); }).catch(function () { /* the fallback serif draws instead */ });
    });
    var painted = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { artwork = image; resolve(); };
      image.onerror = function () { reject(new Error('The certificate artwork could not be loaded.')); };
      image.src = ART;
    });
    /* the signature is part of the certificate: one that did not arrive is
       an error, as the artwork is, never a certificate without it */
    var signed = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { signature = image; resolve(); };
      image.onerror = function () { reject(new Error('The certificate signature could not be loaded.')); };
      image.src = SIG_ART;
    });
    ready = Promise.all(fonts.concat([painted, signed])).catch(function (error) { ready = null; throw error; });
    return ready;
  }

  /* the print masters, asked for only when a PDF or a download is made */
  var printReady = null;
  var print = { art: null, sig: null };
  function picture(src, what) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The certificate ' + what + ' could not be loaded.')); };
      image.src = src;
    });
  }
  function loadPrint() {
    if (printReady) return printReady;
    printReady = load().then(function () {
      return Promise.all([picture(ART_PRINT, 'artwork'), picture(SIG_PRINT, 'signature')]);
    }).then(function (both) { print.art = both[0]; print.sig = both[1]; }).catch(function (error) { printReady = null; throw error; });
    return printReady;
  }

  /* "2026-11-01" -> "1 November 2026" */
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  function fit(ctx, text, font, size, maxWidth) {
    var s = size;
    ctx.font = font.replace('{s}', s);
    while (s > 22 && ctx.measureText(text).width > maxWidth) {
      s -= 1;
      ctx.font = font.replace('{s}', s);
    }
    return s;
  }

  /* letter-spaced text, centred or from an edge */
  function spaced(ctx, text, x, y, spacing, align) {
    if (!('letterSpacing' in ctx)) {
      var chars = String(text).split('');
      var width = chars.reduce(function (sum, c) { return sum + ctx.measureText(c).width + spacing; }, -spacing);
      var start = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      var saved = ctx.textAlign;
      ctx.textAlign = 'left';
      chars.forEach(function (c) { ctx.fillText(c, start, y); start += ctx.measureText(c).width + spacing; });
      ctx.textAlign = saved;
      return;
    }
    ctx.letterSpacing = spacing + 'px';
    ctx.textAlign = align;
    /* the canvas adds the spacing after the last letter too; centre without it */
    ctx.fillText(text, align === 'center' ? x + spacing / 2 : x, y);
    ctx.letterSpacing = '0px';
  }

  function draw(canvas, data, scale, masters) {
    var d = data || {};
    var k = scale || 1;
    var art = (masters && masters.art) || artwork;
    var sig = (masters && masters.sig) || signature;
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    /* the paper first, then the art on it, then the signature on the art */
    if (art) ctx.drawImage(art, 0, 0, W, H);
    else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    if (sig) ctx.drawImage(sig, SIG.x + SIG.dx, SIG.y + SIG.dy, SIG.w, SIG.h);
    ctx.textBaseline = 'alphabetic';

    /* the name, as the design sets it, made smaller only if it would not fit */
    var name = String(d.name || '').replace(/\s+/g, ' ').trim() || 'Your Name';
    ctx.fillStyle = d.name ? INK : 'rgba(36,38,32,.32)';
    var size = fit(ctx, name, '400 {s}px ' + FACE, 43, AT.name.max);
    ctx.font = '400 ' + size + 'px ' + FACE;
    spaced(ctx, name, AT.name.x, AT.name.y, -0.8 * size / 43, 'center');

    /* the foot, on the left: the day it was completed, and its number */
    ctx.fillStyle = INK;
    ctx.font = '400 12px ' + FACE;
    spaced(ctx, longDate(d.endDate) || '. . .', AT.date.x, AT.date.y, 0.6, 'left');
    spaced(ctx, d.number || 'Given when issued', AT.number.x, AT.number.y, 0.6, 'left');

    /* The public page's preview (internship.html) is marked SAMPLE across
       its face, so a picture of it is never mistaken for one PFA issued. */
    if (d.sample) {
      /* a red rubber stamp over the lines below the name: it reads as a
         stamp at a glance, and cannot be cropped away without the words */
      ctx.save();
      ctx.translate(W / 2, 498);
      ctx.rotate(-0.1);
      ctx.font = '400 58px ' + FACE;
      /* its width with the spacing between the letters, measured without
         it, since not every canvas counts letter spacing when it measures */
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      var gap = 12;
      var tw = ctx.measureText('SAMPLE').width + gap * 5;
      ctx.strokeStyle = 'rgba(190,30,30,.62)';
      ctx.lineWidth = 4;
      ctx.strokeRect(-tw / 2 - 26, -50, tw + 52, 74);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-tw / 2 - 18, -42, tw + 36, 58);
      ctx.fillStyle = 'rgba(190,30,30,.62)';
      spaced(ctx, 'SAMPLE', 0, 9, gap, 'center');
      ctx.restore();
    }
    return canvas;
  }

  /* A canvas at the given scale, or the largest under it this browser can
     make: a browser refuses a canvas past its own limit (on a phone about
     16 million pixels) by giving one it cannot draw on, so the size asked
     for is tried, then smaller, down to 2x, which every browser makes. */
  function canvasFor(scale) {
    var tries = [scale, 5, 4, 3, 2].filter(function (k, i, all) { return k <= scale && all.indexOf(k) === i; });
    for (var i = 0; i < tries.length; i += 1) {
      var k = tries[i];
      var canvas = root.document.createElement('canvas');
      canvas.width = Math.round(W * k);
      canvas.height = Math.round(H * k);
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx || canvas.width !== Math.round(W * k)) continue;
      /* a canvas past the limit can still hand back a context that draws
         nothing: test one pixel */
      try {
        ctx.fillStyle = '#010203';
        ctx.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
        var px = ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data;
        if (px[0] !== 1 || px[1] !== 2 || px[2] !== 3) continue;
      } catch (e) { continue; }
      return { canvas: canvas, scale: k };
    }
    throw new Error('This browser could not make the certificate. Try again on a computer.');
  }

  /* the certificate at print quality, on the print masters */
  function printed(data, scale) {
    return loadPrint().then(function () {
      var made = canvasFor(scale || defaultScale());
      draw(made.canvas, data, made.scale, print);
      return made.canvas;
    });
  }

  /* 6x where the browser can (the panel); 4x on a phone or a small tablet */
  function defaultScale() {
    var nav = root.navigator || {};
    var small = /Android|iPhone|iPad|iPod|Mobile/i.test(String(nav.userAgent || '')) || (nav.maxTouchPoints > 1 && /Macintosh/.test(String(nav.userAgent || '')));
    return small ? 4 : PRINT_SCALE;
  }

  /* the picture download: PNG, lossless */
  function png(data, opts) {
    var o = opts || {};
    return printed(data, o.scale).then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('The picture could not be made.')); }, 'image/png');
      });
    });
  }

  /* The picture's pixels as one lossless image for the PDF: the colours of
     every pixel, row by row, deflated (the PDF's FlateDecode). Read from the
     canvas a band of rows at a time, so the whole picture is never held twice
     over. A browser without CompressionStream gets the best JPEG instead. */
  function pixels(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    if (typeof root.CompressionStream !== 'function') {
      var jpeg = atob(canvas.toDataURL('image/jpeg', 1).split(',')[1]);
      var raw = new Uint8Array(jpeg.length);
      for (var j = 0; j < jpeg.length; j += 1) raw[j] = jpeg.charCodeAt(j);
      return Promise.resolve({ bytes: raw, filter: 'DCTDecode' });
    }
    var stream = new root.CompressionStream('deflate');
    var writer = stream.writable.getWriter();
    var out = new Response(stream.readable).arrayBuffer();
    var BAND = 256;
    var write = function (top) {
      if (top >= h) return writer.close();
      var rows = Math.min(BAND, h - top);
      var rgba = ctx.getImageData(0, top, w, rows).data;
      var rgb = new Uint8Array(w * rows * 3);
      for (var i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
        rgb[o] = rgba[i]; rgb[o + 1] = rgba[i + 1]; rgb[o + 2] = rgba[i + 2];
      }
      return writer.write(rgb).then(function () { return write(top + rows); });
    };
    return write(0).then(function () { return out; }).then(function (buffer) {
      return { bytes: new Uint8Array(buffer), filter: 'FlateDecode' };
    });
  }

  /* One A4 landscape page (297 x 210 mm), the certificate filling it (the
     design is A4's own shape), at print quality and lossless. */
  function pdf(data, opts) {
    var o = opts || {};
    var canvas = null;
    return printed(data, o.scale).then(function (c) { canvas = c; return pixels(canvas); }).then(function (image) {
      var bytes = image.bytes;
      var pw = 841.89;
      var ph = 595.28;
      var w = pw;
      var h = w * H / W;
      if (h > ph) { h = ph; w = h * W / H; }
      var x = (pw - w) / 2;
      var y = (ph - h) / 2;
      var content = 'q\n' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm\n/Im0 Do\nQ\n';
      var title = 'Certificate of Completion' + (data && data.name ? ', ' + String(data.name) : '') + (data && data.number ? ', ' + String(data.number) : '');
      var parts = [];
      var length = 0;
      var offsets = [];
      var push = function (part) {
        var chunk = typeof part === 'string' ? new TextEncoder().encode(part) : part;
        parts.push(chunk);
        length += chunk.length;
      };
      var object = function (n, body, stream) {
        offsets[n] = length;
        push(n + ' 0 obj\n' + body);
        if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); }
        push('\nendobj\n');
      };
      /* a PDF string in UTF-16, so any name reads right in the file's title */
      var utf16 = function (text) {
        var hex = 'FEFF';
        for (var i = 0; i < text.length; i += 1) hex += ('000' + text.charCodeAt(i).toString(16).toUpperCase()).slice(-4);
        return '<' + hex + '>';
      };
      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
      object(1, '<< /Type /Catalog /Pages 2 0 R >>');
      object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
      object(4, '<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true /Filter /' + image.filter + ' /Length ' + bytes.length + ' >>', bytes);
      object(5, '<< /Length ' + new TextEncoder().encode(content).length + ' >>', new TextEncoder().encode(content));
      object(6, '<< /Title ' + utf16(title) + ' /Author ' + utf16('People for Animals') + ' /Producer ' + utf16('People for Animals') + ' >>');
      var xref = length;
      var table = 'xref\n0 7\n0000000000 65535 f \n';
      for (var n = 1; n <= 6; n += 1) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
      push(table);
      push('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      return new Blob(parts, { type: 'application/pdf' });
    });
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = root.document.createElement('a');
    link.href = url;
    link.download = filename;
    root.document.body.appendChild(link);
    link.click();
    root.document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* "Asha Rao" + "PFA-INT-AB12CD34" -> "pfa-internship-certificate-asha-rao-PFA-INT-AB12CD34" */
  function fileStem(data) {
    var slug = String((data && data.name) || 'intern').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'intern';
    return 'pfa-internship-certificate-' + slug + (data && data.number ? '-' + data.number : '');
  }

  root.PFACertificate = { W: W, H: H, PRINT_SCALE: PRINT_SCALE, loadPrint: loadPrint, SIG: SIG, SIG_RANGE: SIG_RANGE, SIG_DEFAULT: SIG_DEFAULT, setLayout: setLayout, layout: layout, load: load, draw: draw, png: png, pdf: pdf, save: save, fileStem: fileStem, longDate: longDate };
})(typeof window !== 'undefined' ? window : this);
