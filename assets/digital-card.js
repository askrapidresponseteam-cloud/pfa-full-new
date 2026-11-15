/* People for Animals - the digital card, drawn (owner, 15 Nov 2026: "Add an
   option to issue digital caregiver and membership cards with front and back
   views and a flip feature premium style").

   PFADigitalCard.render(box, data, opts) puts one card in `box`: its front
   and its back, turned over by a tap, a click, Enter or Space, or the Flip
   button under it. data is what /api/digital-card answers (lib/digital-
   cards.js): kind ('caregiver' | 'member'), id, name, number, district,
   state, tier, issuedOn, validUntil, lifetime, standing, url. opts.root is
   where the site's files are ('' on the site, '/' from a deeper page);
   opts.photo the photograph's address. The back carries a QR code of the
   card's own address (assets/qr.js), so a phone held up to it opens the
   card and its standing. Styles: assets/digital-card.css. */
(function (root) {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function longDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  var CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var TURN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.6M13.5 8a5.5 5.5 0 0 1-9.6 3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.6 1.8v2.9H9.7M3.4 14.2v-2.9h2.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* the QR code of the card's address, as an SVG of whole modules */
  function qr(text) {
    var Q = root.PFAQR;
    if (!Q || !text) return '';
    var code;
    try { code = Q.matrix(text); } catch (e) { return ''; }
    var n = code.size;
    var q = 2;
    var path = '';
    for (var r = 0; r < n; r += 1) for (var c = 0; c < n; c += 1) if (code.modules[r][c]) path += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" shape-rendering="crispEdges" role="img" aria-label="QR code of this card’s address"><rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  /* The template's portrait fades into the black card; a member's photo
     is usually taken against a plain light wall, which would show as a
     pale panel. So the wall is found from the photo's top and sides and
     taken down to black, softly at the edge, before the photo goes on the
     card. A busy background is left as it is. Drawn here, in the browser,
     from the photo PFA keeps; nothing is stored. */
  function cutout(img) {
    if (!img || img._dcCut || typeof document === 'undefined') return;
    function run() {
      if (img._dcCut) return;
      img._dcCut = true;
      try {
        var w0 = img.naturalWidth;
        var h0 = img.naturalHeight;
        if (!w0 || !h0) return;
        var k = Math.min(1, 520 / Math.max(w0, h0));
        var w = Math.max(1, Math.round(w0 * k));
        var h = Math.max(1, Math.round(h0 * k));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext && c.getContext('2d');
        if (!x) return;
        x.drawImage(img, 0, 0, w, h);
        var px = x.getImageData(0, 0, w, h);
        var p = px.data;
        var seeds = [];
        var i;
        for (i = 0; i < w; i += 1) seeds.push(i);
        for (i = 1; i < Math.round(h * 0.75); i += 1) { seeds.push(i * w); seeds.push(i * w + w - 1); }
        function med(off) { var v = seeds.map(function (s) { return p[s * 4 + off]; }).sort(function (a, b) { return a - b; }); return v[v.length >> 1]; }
        var bg = [med(0), med(1), med(2)];
        function far(s) { var dr = p[s * 4] - bg[0]; var dg = p[s * 4 + 1] - bg[1]; var db = p[s * 4 + 2] - bg[2]; return Math.sqrt(dr * dr + dg * dg + db * db); }
        var T = 46;
        var plain = seeds.filter(function (s) { return far(s) < T; }).length / seeds.length;
        if (plain < 0.6) return;
        var wall = new Uint8Array(w * h);
        var queue = [];
        seeds.forEach(function (s) { if (far(s) < T && !wall[s]) { wall[s] = 1; queue.push(s); } });
        while (queue.length) {
          var s = queue.pop();
          var sx = s % w;
          var nb = [sx > 0 ? s - 1 : -1, sx < w - 1 ? s + 1 : -1, s - w, s + w];
          for (var n = 0; n < 4; n += 1) {
            var t = nb[n];
            if (t < 0 || t >= w * h || wall[t]) continue;
            if (far(t) < T) { wall[t] = 1; queue.push(t); }
          }
        }
        /* a soft edge: the wall's mask, blurred a few pixels each way */
        var a = new Float32Array(w * h);
        for (i = 0; i < w * h; i += 1) a[i] = wall[i] ? 0 : 1;
        var r = Math.max(2, Math.round(w / 160));
        for (var pass = 0; pass < 2; pass += 1) {
          var b = new Float32Array(w * h);
          for (var yy = 0; yy < h; yy += 1) {
            for (var xx = 0; xx < w; xx += 1) {
              var sum = 0; var cnt = 0;
              for (var d2 = -r; d2 <= r; d2 += 1) {
                var q = pass ? yy + d2 : xx + d2;
                if (q < 0 || q >= (pass ? h : w)) continue;
                sum += a[pass ? q * w + xx : yy * w + q]; cnt += 1;
              }
              b[yy * w + xx] = sum / cnt;
            }
          }
          a = b;
        }
        for (i = 0; i < w * h; i += 1) { p[i * 4] *= a[i]; p[i * 4 + 1] *= a[i]; p[i * 4 + 2] *= a[i]; }
        x.putImageData(px, 0, 0);
        img.src = c.toDataURL('image/jpeg', 0.92);
      } catch (e) { /* the photo as it is */ }
    }
    if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run);
  }

  /* The membership card online, on the owner's own template (15 Nov 2026:
     "PFA-Premium-Membership.html for membership. let this be the exact
     template"): matte black, the PFA logo for dark grounds, the member's
     photograph in black and white fading into the card on the right, the
     name, the place, and the number and the year along the foot; on the
     back "A voice for the voiceless.", what the card is and is not for,
     the chairperson's signature and the QR code that opens the card. */
  function premium(d, o, base, st) {
    var logo = '<img class="dcm__logo" src="' + esc(base) + 'img/logo-dark.png" alt="People for Animals" width="924" height="316">';
    var tier = String(d.tier || '').replace(/\s*membership$/i, '');
    var since = /^(\d{4})/.exec(String(d.issuedOn || ''));
    var place = [d.district, d.state].filter(Boolean).join(', ');
    var number = d.number || d.id;
    return ''
      + '<section class="dc__face dc__front" aria-label="Front">'
      + '<div class="dcm__brand">' + logo + '<span class="dcm__tier">' + esc((tier ? tier + ' ' : '') + 'Membership') + '</span></div>'
      + (o.photo ? '<img class="dcm__portrait" src="' + esc(o.photo) + '" alt="' + esc(d.name) + '">' : '')
      + '<div class="dcm__details"><div class="dcm__label">Member</div><div class="dcm__name">' + esc(d.name) + '</div>' + (place ? '<div class="dcm__role">' + esc(place) + '</div>' : '') + '</div>'
      + '<div class="dcm__footer"><span>' + esc(number) + '</span>' + (since ? '<span>Member since&nbsp;&nbsp;' + since[1] + '</span>' : '') + '</div>'
      + (st.s === 'valid' ? '' : '<div class="dc__void"><span>' + esc(st.word.toUpperCase()) + '</span></div>')
      + '</section>'
      + '<section class="dc__face dc__back" aria-label="Back">'
      + '<div class="dcm__brand">' + logo + '</div>'
      + '<div class="dcm__content"><div class="dcm__message"><h2>A voice for<br>the voiceless.</h2>'
      + '<p>This digital card identifies the named member of People for Animals. It is for display on screen only and is not to be printed.</p>'
      + '<p>Non-transferable. Any misuse will lead to its withdrawal.</p>'
      + '<div class="dcm__sign"><img src="' + esc(base) + 'assets/certificates/signature.png" alt="Signature of Smt. Maneka Sanjay Gandhi" width="504" height="146"><span>Smt. Maneka Sanjay Gandhi, Chairperson</span></div></div>'
      + '<div class="dcm__qr">' + qr(d.url) + '<div class="dcm__scan">Scan to verify</div></div></div>'
      + '<div class="dcm__footer"><span>peopleforanimalsindia.org</span><span>' + esc(number) + '</span></div>';
  }

  function state(d) {
    var s = d.standing || 'valid';
    return { s: s, word: s === 'valid' ? 'Verified' : s === 'expired' ? 'Expired' : 'Withdrawn' };
  }

  function render(box, data, opts) {
    var d = data || {};
    var o = opts || {};
    var base = o.root == null ? '' : o.root;
    var member = d.kind === 'member';
    var st = state(d);
    var title = member ? 'Membership Card' : 'Colony Caregiver Card';
    var place = [d.district, d.state].filter(Boolean).join(', ');
    var until = d.lifetime ? 'Lifetime' : (longDate(d.validUntil) || '');
    /* Clean, not cluttered (owner, 15 Nov 2026: "it cant be cluttered. have
       a clean and premium design"): the name, where, the number and how
       long it holds. The membership's tier stands under the title; the
       logo already says People for Animals, so nothing else repeats it. */
    var kicker = member ? String(d.tier || '').replace(/\s*membership$/i, '') : '';
    var cells = [
      [member ? 'Member number' : 'Card number', d.number || d.id],
      ['Valid until', until]
    ].filter(function (c) { return c[1]; });
    var logo = '<span class="dc__logo"><img src="' + esc(base) + 'media/member-card-logo.png" alt="People for Animals" width="386" height="259"></span>';
    var photo = o.photo ? '<img src="' + esc(o.photo) + '" alt="' + esc(d.name) + '">' : '<i>PHOTO</i>';

    box.className = 'dc';
    box.setAttribute('data-kind', member ? 'member' : 'caregiver');
    box.setAttribute('data-side', 'front');
    /* the signature's place on this kind of card online, as the panel set
       it, in tenths of a millimetre of a bank card's width */
    var sig = d.sig || {};
    box.style.setProperty('--sx', String(Number(sig.x) || 0));
    box.style.setProperty('--sy', String(Number(sig.y) || 0));
    /* the colony caregiver card: light, with the PFA logo in its own colours */
    var faces = member ? premium(d, o, base, st) : ''
      + '<section class="dc__face dc__front" aria-label="Front">'
      + '<div class="dc__top">' + logo + '<div class="dc__title"><b>' + esc(title) + '</b>' + (kicker ? '<span>' + esc(kicker) + '</span>' : '') + '</div></div>'
      + '<div class="dc__body"><span class="dc__name">' + esc(d.name) + '</span>' + (place ? '<span class="dc__place">' + esc(place) + '</span>' : '')
      + '<div class="dc__grid">' + cells.map(function (c, i) { return '<div><span class="dc__lab">' + esc(c[0]) + '</span><span class="dc__val' + (i === 0 ? ' dc__val--id' : '') + '">' + esc(c[1]) + '</span></div>'; }).join('') + '</div></div>'
      + '<div class="dc__photo">' + photo + '</div>'
      + '<div class="dc__foot"><div class="dc__sign"><img src="' + esc(base) + 'assets/certificates/signature.png" alt="Signature of Smt. Maneka Sanjay Gandhi" width="504" height="146"><b>Smt. Maneka Sanjay Gandhi</b><span>Chairperson, People for Animals</span></div>'
      + '<span class="dc__ok" data-state="' + esc(st.s) + '">' + (st.s === 'valid' ? CHECK : CROSS) + esc(st.word) + '</span></div>'
      + (st.s === 'valid' ? '' : '<div class="dc__void"><span>' + esc(st.word.toUpperCase()) + '</span></div>')
      + '</section>'
      + '<section class="dc__face dc__back" aria-label="Back">'
      + '<div class="dc__rest"><div class="dc__qr">' + qr(d.url) + '</div>'
      /* owner, 15 Nov 2026: "dont print the url instead if one scans the
         qr- it should open the right url and show the card ... mention it
         is digital card. not to be printed and have 1 line of no misues" */
      + '<div class="dc__check"><b>Scan to verify</b><p>Scan the QR code to view this card on the People for Animals website and confirm that it is valid.</p></div></div>'
      + '<div class="dc__return"><p>This is a digital card, for display on screen only. It is not to be printed.</p><p>This card is non-transferable. Any misuse will lead to its withdrawal.</p></div>';
    box.innerHTML = ''
      + '<div class="dc__stage" role="button" tabindex="0" aria-pressed="false" aria-label="' + esc(title) + ' of ' + esc(d.name) + '. Showing the front. Press to turn it over.">'
      + '<div class="dc__turn">'
      + faces
      + '</section>'
      + '</div></div>'
      + '<p class="dc__noprint">This is a digital card, for display on screen only. It is not to be printed.</p>'
      + (o.controls === false ? '' : '<div class="dc__acts"><button type="button" data-dc-flip>' + TURN + '<span>See the back</span></button></div><p class="dc__hint">Tap the card to turn it over.</p>');

    var stage = box.querySelector('.dc__stage');
    var front = box.querySelector('.dc__front');
    var back = box.querySelector('.dc__back');
    var label = box.querySelector('[data-dc-flip] span');
    function show(side) {
      box.setAttribute('data-side', side);
      var isBack = side === 'back';
      stage.setAttribute('aria-pressed', String(isBack));
      stage.setAttribute('aria-label', title + ' of ' + (d.name || '') + '. Showing the ' + (isBack ? 'back' : 'front') + '. Press to turn it over.');
      front.setAttribute('aria-hidden', String(isBack));
      back.setAttribute('aria-hidden', String(!isBack));
      if (label) label.textContent = isBack ? 'See the front' : 'See the back';
    }
    function flip() { show(box.getAttribute('data-side') === 'back' ? 'front' : 'back'); }
    stage.addEventListener('click', flip);
    stage.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    var btn = box.querySelector('[data-dc-flip]');
    if (btn) btn.addEventListener('click', flip);
    show('front');
    if (member) cutout(box.querySelector('.dcm__portrait'));

    /* A long name or place never runs into the logo or the signature: the
       name and the place step down in size until the front has room, at
       any width, once the card's own fonts are in. */
    function fit() {
      var top = front.querySelector(member ? '.dcm__brand' : '.dc__top');
      var name = front.querySelector(member ? '.dcm__name' : '.dc__name');
      var grid = front.querySelector(member ? '.dcm__details' : '.dc__grid');
      var foot = front.querySelector(member ? '.dcm__footer' : '.dc__foot');
      if (!top || !name || !grid || !foot) return;
      var f = 1;
      front.style.setProperty('--fit', '1');
      for (var i = 0; i < 12; i++) {
        var gap = front.getBoundingClientRect().width * 0.012;
        var crowded = name.getBoundingClientRect().top < top.getBoundingClientRect().bottom + gap
          || grid.getBoundingClientRect().bottom > foot.getBoundingClientRect().top - gap;
        if (!crowded) break;
        f = Math.round(f * 90) / 100;
        front.style.setProperty('--fit', String(f));
      }
    }
    /* the membership card's back: the message steps down until it stands
       clear of the foot, at any width */
    function fitBack() {
      if (!member) return;
      var msg = back.querySelector('.dcm__content');
      var foot = back.querySelector('.dcm__footer');
      if (!msg || !foot) return;
      var f = 1;
      back.style.setProperty('--bfit', '1');
      for (var i = 0; i < 10; i += 1) {
        if (msg.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top - back.getBoundingClientRect().width * 0.012) break;
        f = Math.round(f * 92) / 100;
        back.style.setProperty('--bfit', String(f));
      }
    }
    function fitAll() { fit(); fitBack(); }
    fitAll();
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    if (typeof ResizeObserver === 'function') {
      var lastW = 0;
      new ResizeObserver(function () { var w = stage.clientWidth; if (w && w !== lastW) { lastW = w; fitAll(); } }).observe(stage);
    }
    return { flip: flip, show: show };
  }

  root.PFADigitalCard = { render: render, longDate: longDate, qr: qr };
}(typeof window !== 'undefined' ? window : this));
