/* People for Animals - the internship certificate, drawn in the browser.
   ------------------------------------------------------------------------
   Owner, 31 Oct 2026: "this certificate should be admin generatable".

   The artwork is the owner's own design with its blanks taken out
   (assets/certificates/internship.webp, 1672 x 941). On it this draws, in
   the places the design left for them:
     the intern's name        Cinzel, in the design's blue, sized to fit
     from <start> to <end>    the internship's dates, in EB Garamond
     Certificate No. <no.>    the number the server gave it (PFA-INT-...)
     Issued on <date>
   Nothing else is written; the words already in the design stay as drawn.

   PFACertificate.draw(canvas, data, scale)   onto a canvas, at 1x or more
   PFACertificate.png(data)  -> Promise<Blob>  at 2x, 3344 x 1882
   PFACertificate.pdf(data)  -> Promise<Blob>  A4 landscape, the certificate
                                               centred with a white margin
   PFACertificate.save(blob, filename)
   data: { name, startDate, endDate, issuedOn, number, sample }, dates as
   YYYY-MM-DD; sample marks it SAMPLE across its face (the public preview).
   ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var W = 1672;
  var H = 941;
  var ART = 'assets/certificates/internship.webp';
  var BLUE = '#09429c';
  var INK = '#14120f';
  var FONTS = [
    ['Cinzel', 'fonts/cinzel-latin-600.woff2', '600'],
    ['EB Garamond', 'fonts/eb-garamond-latin-500.woff2', '500'],
    ['Marcellus', 'fonts/marcellus-latin.woff2', '400']
  ];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var ready = null;
  var art = null;
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
    ready = Promise.all(fonts.concat([picture])).catch(function (error) { ready = null; throw error; });
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
    while (s > 18 && ctx.measureText(text).width > maxWidth) {
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
    if (art) ctx.drawImage(art, 0, 0, W, H);
    else { ctx.fillStyle = '#f2ebdc'; ctx.fillRect(0, 0, W, H); }
    ctx.textBaseline = 'alphabetic';

    /* the name, in capitals, as large as the space between the lines allows */
    var name = String(d.name || '').replace(/\s+/g, ' ').trim().toUpperCase() || 'INTERN NAME';
    ctx.fillStyle = d.name ? BLUE : 'rgba(9,66,156,.35)';
    var size = fit(ctx, name, '600 {s}px Cinzel, "Marcellus", Georgia, serif', 68, 760);
    ctx.font = '600 ' + size + 'px Cinzel, "Marcellus", Georgia, serif';
    spaced(ctx, name, W / 2, 528, Math.max(1, size * 0.03), 'center');

    /* from ... to ... */
    var from = longDate(d.startDate);
    var to = longDate(d.endDate);
    ctx.fillStyle = INK;
    var dates = from && to ? 'from ' + from + ' to ' + to : 'from  .  .  .  to  .  .  .';
    /* EB Garamond for anything with figures, the book face of the design's
       own lines: Marcellus and Cinzel both draw a 1 that reads as a capital I */
    var dsize = fit(ctx, dates, '500 {s}px "EB Garamond", Georgia, serif', 29, 720);
    ctx.font = '500 ' + dsize + 'px "EB Garamond", Georgia, serif';
    spaced(ctx, dates, W / 2, 690, 0.8, 'center');

    /* the foot: the number on the left, the date on the right */
    ctx.font = '500 19px "EB Garamond", Georgia, serif';
    spaced(ctx, 'Certificate No. ' + (d.number || 'given when issued'), 426, 872, 0.5, 'left');
    var issued = longDate(d.issuedOn);
    spaced(ctx, 'Issued on ' + (issued || '. . .'), 1246, 872, 0.5, 'right');

    /* The public page's preview (internship.html) is marked SAMPLE across
       its face, so a picture of it is never mistaken for one PFA issued. */
    if (d.sample) {
      /* a red rubber stamp over the lines below the name: it reads as a
         stamp at a glance, and cannot be cropped away without the words */
      ctx.save();
      ctx.translate(W / 2, 706);
      ctx.rotate(-0.1);
      ctx.font = '600 76px Cinzel, Georgia, serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '14px';
      var tw = ctx.measureText('SAMPLE').width;
      ctx.strokeStyle = 'rgba(190,30,30,.62)';
      ctx.lineWidth = 5;
      ctx.strokeRect(-tw / 2 - 30, -62, tw + 46, 96);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-tw / 2 - 20, -52, tw + 26, 76);
      ctx.fillStyle = 'rgba(190,30,30,.62)';
      ctx.textAlign = 'center';
      ctx.fillText('SAMPLE', 7, 14);
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

  /* One A4 landscape page (297 x 210 mm) with the certificate centred on it,
     drawn at 2x and embedded as a high-quality JPEG. */
  function pdf(data) {
    return load().then(function () {
      var canvas = offscreen(data, 2);
      var jpeg = atob(canvas.toDataURL('image/jpeg', 0.95).split(',')[1]);
      var bytes = new Uint8Array(jpeg.length);
      for (var i = 0; i < jpeg.length; i += 1) bytes[i] = jpeg.charCodeAt(i);
      var pw = 841.89;
      var ph = 595.28;
      var margin = 24;
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

  root.PFACertificate = { W: W, H: H, load: load, draw: draw, png: png, pdf: pdf, save: save, fileStem: fileStem, longDate: longDate };
})(typeof window !== 'undefined' ? window : this);
