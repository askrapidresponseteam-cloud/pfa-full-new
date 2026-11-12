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
   PFACertificate.png(data)  -> Promise<Blob>  at 2x, 3344 x 1882
   PFACertificate.pdf(data, opts) -> Promise<Blob>  A4 landscape, the
                                               certificate centred with a white
                                               margin; opts { scale, quality }
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
  var art = null;
  var sig = null;
  function load() {
    if (ready) return ready;
    var fonts = FONTS.map(function (f) {
      if (!root.FontFace || !root.document.fonts) return Promise.resolve();
      var face = new root.FontFace(f[0], 'url(' + f[1] + ')', { weight: f[2] });
      return face.load().then(function (loaded) { root.document.fonts.add(loaded); }).catch(function () { /* the fallback serif draws instead */ });
    });
    var picture = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { art = image; resolve(); };
      image.onerror = function () { reject(new Error('The certificate artwork could not be loaded.')); };
      image.src = ART;
    });
    /* the signature is part of the certificate: one that did not arrive is
       an error, as the artwork is, never a certificate without it */
    var signature = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { sig = image; resolve(); };
      image.onerror = function () { reject(new Error('The certificate signature could not be loaded.')); };
      image.src = SIG_ART;
    });
    ready = Promise.all(fonts.concat([picture, signature])).catch(function (error) { ready = null; throw error; });
    return ready;
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

  function draw(canvas, data, scale) {
    var d = data || {};
    var k = scale || 1;
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

  function offscreen(data, scale) {
    var canvas = root.document.createElement('canvas');
    return draw(canvas, data, scale);
  }

  function png(data) {
    return load().then(function () {
      var canvas = offscreen(data, 2);
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    });
  }

  /* One A4 landscape page (297 x 210 mm), the certificate filling it (the
     design is A4's own shape), drawn at 2x and embedded as a high-quality
     JPEG. */
  /* opts: { scale, quality } - the emailed copy is drawn at 1.5x and 0.82,
     about 600 KB (assets/admin-certificates.js); the download keeps 2x */
  function pdf(data, opts) {
    var o = opts || {};
    return load().then(function () {
      var canvas = offscreen(data, o.scale || 2);
      var jpeg = atob(canvas.toDataURL('image/jpeg', o.quality || 0.95).split(',')[1]);
      var bytes = new Uint8Array(jpeg.length);
      for (var i = 0; i < jpeg.length; i += 1) bytes[i] = jpeg.charCodeAt(i);
      var pw = 841.89;
      var ph = 595.28;
      var margin = 0;
      var w = pw - margin * 2;
      var h = w * H / W;
      if (h > ph - margin * 2) { h = ph - margin * 2; w = h * W / H; }
      var x = (pw - w) / 2;
      var y = (ph - h) / 2;
      var content = 'q\n' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm\n/Im0 Do\nQ\n';
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
      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
      object(1, '<< /Type /Catalog /Pages 2 0 R >>');
      object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
      object(4, '<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>', bytes);
      object(5, '<< /Length ' + new TextEncoder().encode(content).length + ' >>', new TextEncoder().encode(content));
      var xref = length;
      var table = 'xref\n0 6\n0000000000 65535 f \n';
      for (var n = 1; n <= 5; n += 1) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
      push(table);
      push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
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

  root.PFACertificate = { W: W, H: H, SIG: SIG, SIG_RANGE: SIG_RANGE, SIG_DEFAULT: SIG_DEFAULT, setLayout: setLayout, layout: layout, load: load, draw: draw, png: png, pdf: pdf, save: save, fileStem: fileStem, longDate: longDate };
})(typeof window !== 'undefined' ? window : this);
