/* People for Animals - the signature collection, in the panel.
   ------------------------------------------------------------------------
   Owner, 22 Nov 2026: "add this to signature collection. it should be
   workable on letter, certificates and cards. and color should be
   changable", "ensure that signature should not be accesable even if one
   gets the code. it should be protected by password", and "there has to
   be 2 sign vectors".

   In Certificates, under + Signatures. Closed, it asks only the password.
   Open, it shows what letters, certificates and cards are signed with,
   and one row to change that: where, which signature, the ink colour, a
   preview, Save. Under it, + Add a signature (a name and its SVG) and
   + Change the password.

   The password stays in this page's memory only, while the section is
   open, and is forgotten on Lock, on leaving Certificates, or after 15
   minutes without use. A signature's vector comes from the server only
   after the password, for this page alone; the picture made from it here,
   in the colour chosen, is what the server keeps for documents
   (lib/signature-vault.js, lib/routes/admin/signatures.js).

   Loaded by assets/admin-cert-pane.js, so admin.html stays under its
   page-weight ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFASignatures) return;
  var esc = A.esc;
  var URL_ = '/api/admin/signatures';
  var IDLE = 15 * 60 * 1000;
  var INKS = [
    ['#193b84', 'Navy'], ['#1b1b1b', 'Black'], ['#1f45a8', 'Royal blue'],
    ['#1e5b3b', 'Green'], ['#7b1e2a', 'Maroon'], ['#8a6a1f', 'Gold']
  ];

  var st = {
    password: '', timer: 0, open: false,
    info: null,           /* the names and what each place uses */
    vectors: {},          /* opened this session, by id; forgotten on Lock */
    place: 'certificate', id: '', colour: '#193b84',
    say: '', tone: ''
  };

  var style = document.createElement('style');
  style.textContent = [
    '.sv{margin:0}',
    '.sv__body{display:grid;gap:16px;max-width:680px;padding:12px 0 4px}',
    '.sv__row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
    '.sv__row .press{display:inline-flex;width:auto;align-items:center;min-height:40px;padding:0 20px}',
    '.sv__row .ghost{min-height:40px}',
    '.sv__in{height:40px;padding:0 10px;border:1px solid var(--line);font:inherit;font-size:14px;background:var(--paper);color:var(--ink);min-width:0}',
    '.sv__in:focus{border-color:var(--ink);outline:none}',
    '.sv__pw{flex:1 1 220px;max-width:300px}',
    '.sv__lab{display:grid;gap:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.sv__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '.sv__grid .sv__in{width:100%}',
    '.sv__uses{display:grid;gap:6px;margin:0;padding:0;list-style:none;font-size:13px;line-height:1.5}',
    '.sv__uses li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;overflow-wrap:anywhere}',
    '.sv__uses b{min-width:96px;font-weight:600}',
    '.sv__dot{display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid var(--line);flex:none}',
    '.sv__inks{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.sv__ink{width:28px;height:28px;border-radius:50%;border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);cursor:pointer;padding:0}',
    '.sv__ink[aria-pressed="true"]{box-shadow:0 0 0 2px var(--ink)}',
    '.sv__pick{width:28px;height:28px;padding:0;border:0;border-radius:50%;box-shadow:0 0 0 1px var(--line);background:none;cursor:pointer;overflow:hidden}',
    '.sv__pick::-webkit-color-swatch-wrapper{padding:0}',
    '.sv__pick::-webkit-color-swatch{border:0;border-radius:50%}',
    '.sv__pick::-moz-color-swatch{border:0;border-radius:50%}',
    '.sv__wheel{position:relative;display:inline-block;width:28px;height:28px;border-radius:50%;box-shadow:0 0 0 1px var(--line);background:conic-gradient(#c0392b,#d4a017,#2e8b57,#1f6fbf,#7b3fa0,#c0392b)}',
    '.sv__wheel[aria-pressed="true"]{box-shadow:0 0 0 2px var(--ink)}',
    '.sv__wheel .sv__pick{position:absolute;inset:0;box-shadow:none}',
    '.sv__wheel[aria-pressed="false"] .sv__pick{opacity:0}',
    '.sv__other{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-left:6px;text-transform:none;letter-spacing:0}',
    '.sv__prev{margin:0;border:1px solid var(--line);background:#fff;padding:10px}',
    '.sv__prev canvas{display:block;width:100%;height:auto}',
    '.sv__note{margin:0;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}',
    '.sv .say{margin:0;font-size:12px;overflow-wrap:anywhere}',
    '.sv details.fold{margin:0}',
    '.sv__sub{display:grid;gap:12px;padding:10px 0 2px}',
    '@media (max-width:560px){.sv__grid{grid-template-columns:minmax(0,1fr)}}'
  ].join('');
  document.head.appendChild(style);

  function api(body) {
    touch();
    return A.api(URL_, { method: 'POST', body: Object.assign({ password: st.password }, body) });
  }
  function touch() {
    if (st.timer) clearTimeout(st.timer);
    st.timer = st.password ? setTimeout(function () { lock('Locked after 15 minutes without use.'); }, IDLE) : 0;
  }
  function lock(said) {
    st.password = '';
    st.vectors = {};
    st.info = null;
    if (st.timer) clearTimeout(st.timer);
    st.timer = 0;
    st.say = said || '';
    st.tone = '';
    paint();
  }
  function custom() { return !INKS.some(function (k) { return k[0] === st.colour; }); }
  function places() { return (st.info && st.info.places) || []; }
  function placeOf(id) { return places().filter(function (p) { return p.id === id; })[0]; }
  function labelOf(id) { var p = placeOf(id); return p ? p.label : id; }

  /* ---- the section ------------------------------------------------------ */
  function locked() {
    return '<form class="sv__row" data-sv-form="unlock" autocomplete="off">'
      + '<input class="sv__in sv__pw" type="password" name="password" autocomplete="current-password" aria-label="Signatures password" placeholder="Password" required>'
      + '<button class="press" type="submit">Unlock</button></form>'
      + '<p class="sv__note">The signatures are kept sealed on the server. The password opens them here only, until you lock them or leave Certificates.</p>';
  }
  function uses() {
    var u = (st.info && st.info.using) || {};
    return '<ul class="sv__uses">' + places().map(function (p) {
      var x = u[p.id];
      return '<li><b>' + esc(p.label) + '</b>' + (x && x.id
        ? '<span class="sv__dot" style="background:' + esc(x.colour) + '"></span><span>' + esc(x.name || x.id) + '</span>'
        : '<span>The clean signature</span>') + '</li>';
    }).join('') + '</ul>'
      /* 26 Nov 2026: every earlier signature retired, never drawn again */
      + (st.info && st.info.retired ? '<p class="sv__note">' + st.info.retired + ' earlier ' + (st.info.retired === 1 ? 'signature was' : 'signatures were') + ' retired on 26 Nov 2026, when the clean signature replaced every other. They are never drawn.</p>' : '');
  }
  function opened() {
    var sigs = (st.info && st.info.signatures) || [];
    if (!st.id && sigs.length) st.id = sigs[0].id;
    var editor = sigs.length
      ? '<div class="sv__grid">'
        + '<label class="sv__lab">Where<select class="sv__in" data-sv="place">' + places().map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.place ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select></label>'
        + '<label class="sv__lab">Signature<select class="sv__in" data-sv="id">' + sigs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === st.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>'
        + '</div>'
        + '<div class="sv__lab">Ink colour<div class="sv__inks">' + INKS.map(function (k) { return '<button type="button" class="sv__ink" data-sv-ink="' + k[0] + '" style="background:' + k[0] + '" aria-label="' + esc(k[1]) + '" title="' + esc(k[1]) + '" aria-pressed="' + (k[0] === st.colour ? 'true' : 'false') + '"></button>'; }).join('')
        + '<label class="sv__other"><span class="sv__wheel" aria-pressed="' + (custom() ? 'true' : 'false') + '"><input class="sv__pick" type="color" data-sv="colour" value="' + esc(st.colour) + '" aria-label="Any other colour"></span>Other</label></div></div>'
        + '<figure class="sv__prev"><canvas data-sv-canvas width="1512" height="438" aria-label="The signature as it will be drawn"></canvas></figure>'
        + '<div class="sv__row"><button class="press" type="button" data-sv-act="use">Use for ' + esc(labelOf(st.place).toLowerCase()) + '</button>'
        + '<button class="ghost" type="button" data-sv-act="builtin">Clean signature for ' + esc(labelOf(st.place).toLowerCase()) + '</button>'
        + '<button class="ghost" type="button" data-sv-act="lock">Lock</button></div>'
      : '<p class="sv__note">No signatures in the collection yet. Add one below.</p><div class="sv__row"><button class="ghost" type="button" data-sv-act="lock">Lock</button></div>';
    return uses() + editor
      + '<details class="fold"><summary>Add a signature</summary><form class="sv__sub" data-sv-form="add" autocomplete="off">'
      + '<label class="sv__lab">Name<input class="sv__in" name="name" maxlength="80" required placeholder="e.g. Signature with name"></label>'
      + '<label class="sv__lab">SVG file<input class="sv__in" type="file" name="svg" accept=".svg,image/svg+xml" required></label>'
      + '<div class="sv__row"><button class="press" type="submit">Add to the collection</button></div>'
      + '<p class="sv__note">Only the shapes are kept, sealed with the password. Their colour is chosen above, for each place.</p></form></details>'
      + '<details class="fold"><summary>Change the password</summary><form class="sv__sub" data-sv-form="password" autocomplete="off">'
      + '<label class="sv__lab">New password<input class="sv__in" type="password" name="next" minlength="8" autocomplete="new-password" required></label>'
      + '<label class="sv__lab">New password again<input class="sv__in" type="password" name="again" minlength="8" autocomplete="new-password" required></label>'
      + '<div class="sv__row"><button class="press" type="submit">Change password</button></div>'
      + '<p class="sv__note">At least 8 characters. Every signature is sealed again with it; the old password opens nothing after this.</p></form></details>';
  }
  function body() {
    return (st.password && st.info ? opened() : locked())
      + '<p class="say" data-sv-say role="status" aria-live="polite"' + (st.tone ? ' data-tone="' + st.tone + '"' : '') + '>' + esc(st.say) + '</p>';
  }
  function panel() {
    return '<details class="fold sv" id="ctVault"' + (st.open ? ' open' : '') + '><summary>Signatures</summary><div class="sv__body" data-sv-body>' + body() + '</div></details>';
  }
  function paint() {
    var node = document.querySelector('[data-sv-body]');
    if (!node) return;
    node.innerHTML = body();
    preview();
  }
  function tell(text, tone) {
    st.say = text || ''; st.tone = tone || '';
    var n = document.querySelector('[data-sv-say]');
    if (n) A.say(n, st.say, st.tone);
  }

  /* ---- drawing ------------------------------------------------------------ */
  /* the vector, fitted to the place's shape and centred, in the colour */
  function drawOn(canvas, vector, colour) {
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!vector || typeof Path2D === 'undefined') return false;
    var vb = vector.viewBox;
    var pad = 0.02;
    var s = Math.min(canvas.width * (1 - 2 * pad) / vb[2], canvas.height * (1 - 2 * pad) / vb[3]);
    var ox = (canvas.width - vb[2] * s) / 2 - vb[0] * s;
    var oy = (canvas.height - vb[3] * s) / 2 - vb[1] * s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.fillStyle = colour;
    vector.paths.forEach(function (p) { ctx.fill(new Path2D(p.d), p.rule === 'evenodd' ? 'evenodd' : 'nonzero'); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }
  function vectorOf(id) {
    if (st.vectors[id]) return Promise.resolve(st.vectors[id]);
    return api({ action: 'unlock', id: id }).then(function (r) { st.vectors[id] = r.vector; return r.vector; });
  }
  function sizeFor(place, canvas) {
    var p = placeOf(place);
    if (!p) return;
    var w = Math.round(p.width / 2);
    canvas.width = w;
    canvas.height = Math.round(w / p.aspect);
  }
  function preview() {
    var canvas = document.querySelector('[data-sv-canvas]');
    if (!canvas || !st.id) return;
    sizeFor(st.place, canvas);
    var id = st.id;
    if (st.vectors[id]) { drawOn(canvas, st.vectors[id], st.colour); return; }
    vectorOf(id).then(function (v) { if (id === st.id) drawOn(canvas, v, st.colour); }).catch(failed);
  }
  function pictureFor(place) {
    var p = placeOf(place);
    var canvas = document.createElement('canvas');
    canvas.width = p.width;
    canvas.height = Math.round(p.width / p.aspect);
    return vectorOf(st.id).then(function (v) {
      if (!drawOn(canvas, v, st.colour)) throw new Error('This browser cannot draw the signature.');
      return canvas.toDataURL('image/png');
    });
  }

  function failed(err) {
    var code = err && err.code;
    if (code === 'WRONG_PASSWORD' || code === 'LOCKED') {
      lock();
      return tell((err && err.message) || 'That password is not right.', 'bad');
    }
    tell((err && err.message) || 'That could not be done.', 'bad');
  }
  function refresh() {
    return A.api(URL_).then(function (info) { st.info = info; });
  }

  /* ---- what is done here ------------------------------------------------ */
  document.addEventListener('toggle', function (e) {
    if (e.target && e.target.id === 'ctVault') st.open = e.target.open;
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-sv-form]');
    if (!f) return;
    e.preventDefault();
    var what = f.getAttribute('data-sv-form');
    var btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    var done = function () { if (btn) btn.disabled = false; };
    if (what === 'unlock') {
      var pw = f.password.value;
      if (!pw) { done(); return; }
      tell('Opening…');
      st.password = pw;
      api({ action: 'check' }).then(refresh).then(function () {
        var u = st.info.using[st.place];
        if (u && u.id) { st.id = u.id; st.colour = u.colour || st.colour; }
        st.say = ''; st.tone = '';
        touch();
        paint();
      }).catch(function (err) { done(); failed(err); });
      return;
    }
    if (what === 'add') {
      var name = f.name.value.trim();
      var file = f.svg.files && f.svg.files[0];
      if (!name || !file) { done(); tell('Name it and choose its SVG file.', 'bad'); return; }
      if (file.size > 2 * 1024 * 1024) { done(); tell('That SVG is larger than 2 MB.', 'bad'); return; }
      tell('Adding…');
      file.text().then(function (svg) { return api({ action: 'add', name: name, svg: svg }); })
        .then(function (r) { st.id = r.id; return refresh().then(function () { st.say = r.name + ' is in the collection. Choose where to use it above.'; st.tone = 'good'; paint(); }); })
        .catch(function (err) { done(); failed(err); });
      return;
    }
    if (what === 'password') {
      var next = f.next.value;
      if (next !== f.again.value) { done(); tell('The two new passwords are not the same.', 'bad'); return; }
      tell('Changing…');
      api({ action: 'password', next: next }).then(function (r) {
        st.password = next;
        f.reset();
        done();
        tell('Password changed. ' + r.resealed + ' signature' + (r.resealed === 1 ? '' : 's') + ' sealed again with it.', 'good');
      }).catch(function (err) { done(); failed(err); });
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    var k = t && t.getAttribute && t.getAttribute('data-sv');
    if (!k) return;
    touch();
    tell('');
    if (k === 'place') {
      st.place = t.value;
      var u = st.info && st.info.using[st.place];
      if (u && u.id) { st.id = u.id; st.colour = u.colour || st.colour; }
      paint();
      return;
    }
    if (k === 'id') { st.id = t.value; preview(); return; }
    if (k === 'colour') { st.colour = t.value.toLowerCase(); paint(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-sv') !== 'colour') return;
    st.colour = t.value.toLowerCase();
    var w = t.closest('.sv__wheel');
    if (w) w.setAttribute('aria-pressed', 'true');
    Array.prototype.forEach.call(document.querySelectorAll('[data-sv-ink]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-sv-ink') === st.colour)); });
    preview();
  });

  document.addEventListener('click', function (e) {
    var ink = e.target.closest && e.target.closest('[data-sv-ink]');
    if (ink) { st.colour = ink.getAttribute('data-sv-ink'); st.say = ''; st.tone = ''; touch(); paint(); return; }
    var b = e.target.closest && e.target.closest('[data-sv-act]');
    if (!b) return;
    var what = b.getAttribute('data-sv-act');
    if (what === 'lock') { lock('Locked.'); return; }
    var place = st.place;
    b.disabled = true;
    if (what === 'use') {
      tell('Saving…');
      pictureFor(place).then(function (picture) {
        return api({ action: 'use', place: place, id: st.id, colour: st.colour, picture: picture });
      }).then(function () { return refresh(); }).then(function () {
        st.say = 'Saved. ' + labelOf(place) + ' are signed with this from now on.'; st.tone = 'good';
        paint();
      }).catch(function (err) { b.disabled = false; failed(err); });
      return;
    }
    if (what === 'builtin') {
      tell('Saving…');
      api({ action: 'builtin', place: place }).then(function () { return refresh(); }).then(function () {
        st.say = 'Saved. ' + labelOf(place) + ' use the clean signature again.'; st.tone = 'good';
        paint();
      }).catch(function (err) { b.disabled = false; failed(err); });
    }
  });

  /* leaving Certificates forgets the password */
  document.addEventListener('click', function (e) {
    if (st.password && e.target.closest && e.target.closest('[data-tab], [data-pane-tab], .tab') && !e.target.closest('[data-pane="certificates"]')) lock();
  }, true);

  /* the pane drawn again: this section put back as it was */
  function mount(slot) {
    if (!slot) return;
    slot.outerHTML = panel();
    preview();
  }

  window.PFASignatures = { panel: panel, mount: mount, forget: function () { if (st.password) lock(); }, drawOn: drawOn };
}());
