/* People for Animals - certificates, made in the panel.
   ------------------------------------------------------------------------
   Owner, 31 Oct 2026: "this certificate should be admin generatable"; and
   15 Nov 2026: "create certificate variants for different purposes, with
   distinct colour options".

   First what it is for: an internship, a volunteer thanked, taking part in
   a camp or event, a recognition or award, or a donor thanked. Then the
   colour: each purpose has its own (gold, forest green, royal blue,
   maroon), and any one certificate can be given another. Then the person
   and the details: an internship asks its two dates as it always has; the
   others ask one line (what they did, took part in or were recognised
   for) and, optionally, the date of it (the day of issue when empty). The certificate
   is drawn as you type (assets/certificate.js). Issue certificate gives it
   its number on the server (PFA-INT-, PFA-VOL-, PFA-PAR-, PFA-REC- or
   PFA-DNR-, at random, recorded); then it downloads as a PDF for A4 or a
   PNG, or is emailed (assets/admin-certificates.js). Every certificate
   issued is listed, can be drawn again exactly as issued, and can be
   withdrawn with a reason.

   Moved out of admin.html on 15 Nov 2026, so that page stays under its
   page-weight ceiling; admin.html's certificatesPane() calls open() here.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFACertPane) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api;
  var fail = function (node, e) { if (A.fail) A.fail(node, e); else node.textContent = (e && e.message) || 'That could not be read.'; };
  var dayOf = function (iso) { return A.dayOf ? A.dayOf(iso) : String(iso || '').slice(0, 10); };
  /* + Signatures, the password-kept collection (assets/admin-signatures.js,
     22 Nov 2026), loaded with this pane so admin.html stays under its ceiling */
  var vault = null;
  function needVault() {
    if (window.PFASignatures) return Promise.resolve(window.PFASignatures);
    if (vault) return vault;
    vault = new Promise(function (ok, no) {
      var js = document.createElement('script');
      js.src = 'assets/admin-signatures.js';
      js.onload = function () { if (window.PFASignatures) ok(window.PFASignatures); else no(new Error('signatures')); };
      js.onerror = function () { vault = null; no(new Error('signatures')); };
      document.head.appendChild(js);
    });
    return vault;
  }
  function placeVault() {
    needVault().then(function (S) { S.mount($('[data-pane="certificates"] [data-sv-slot]')); }, function () {});
  }
  function C() { return window.PFACertificate; }

  var style = document.createElement('style');
  style.textContent = [
    '.ct-kind{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,2fr);gap:10px 14px;align-items:end}',
    '.ct-kind label,.ct-kind .ct-lab{display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}',
    '.ct-kind select{display:block;width:100%;height:42px;padding:0 12px;border:1px solid var(--line);font:inherit;font-size:14px;background:var(--paper);color:var(--ink)}',
    '.ct-kind select:focus{border-color:var(--ink);outline:none}',
    '.ct-hues{display:flex;flex-wrap:wrap;gap:8px}',
    '.ct-hues button{display:inline-flex;align-items:center;gap:9px;min-height:42px;padding:0 14px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;font-size:13px;cursor:pointer}',
    '.ct-hues button i{flex:none;width:14px;height:14px;border-radius:50%;background:var(--hue);box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}',
    '.ct-hues button[aria-pressed="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}',
    '.ct-hues button:disabled{cursor:default;opacity:.55}',
    '.ct-hues button:disabled[aria-pressed="true"]{opacity:1}',
    '.ct-fields.ct-fields--other{grid-template-columns:minmax(0,1.3fr) minmax(0,1.7fr) repeat(2,minmax(0,.9fr))}',
    '.ct-fields .ct-opt{text-transform:none;letter-spacing:0}',
    '.ct-fields{align-items:end}',
    '@media (max-width:760px){.ct-kind{grid-template-columns:minmax(0,1fr)}.ct-fields.ct-fields--other{grid-template-columns:minmax(0,1fr)}}'
  ].join('');
  document.head.appendChild(style);

  var ct = { rows: [], today: '', current: null, withdrawing: '', kind: 'internship', colour: '', layout: null };

  function kinds() { var c = C(); return c ? c.KIND_ORDER.map(function (k) { return [k, c.KINDS[k]]; }) : [['internship', { label: 'Internship completion', colour: 'gold', line: false }]]; }
  function spec(kind) { var c = C(); return c ? c.KINDS[kind] || c.KINDS.internship : { label: 'Internship completion', colour: 'gold', line: false }; }
  function colourNow() { return ct.colour || spec(ct.kind).colour; }
  function val(id) { var el = $(id); return el ? el.value : ''; }

  function data() {
    if (ct.current) return ct.current;
    var d = { kind: ct.kind, colour: colourNow(), name: val('#ctName'), issuedOn: val('#ctOn'), email: val('#ctEmail'), number: '' };
    if (ct.kind === 'internship') { d.startDate = val('#ctFrom'); d.endDate = val('#ctTo'); } else { d.line = val('#ctLine'); d.date = val('#ctDate'); }
    return d;
  }
  function draw() {
    var canvas = $('#ctCanvas');
    var c = C();
    if (!canvas || !c) return;
    canvas._ctData = data();
    c.draw(canvas, canvas._ctData, 2);
  }

  function open(said) {
    var node = $('[data-pane="certificates"]');
    if (!node) return undefined;
    return api('/api/admin/certificates').then(function (d) {
      ct.rows = d.certificates || [];
      ct.today = d.today || '';
      ct.layout = d.layout || null;
      render(said);
      seed();
    }).catch(function (e) { fail(node, e); });
  }

  /* what it is for, and its colour */
  function purpose(c) {
    var kind = c ? c.kind || 'internship' : ct.kind;
    var colour = c ? c.colour || spec(kind).colour : colourNow();
    var cc = C();
    var hues = cc ? cc.COLOUR_ORDER : ['gold'];
    return '<div class="ct-kind">'
      + '<div><label for="ctKind">What it is for</label><select id="ctKind"' + (c ? ' disabled' : '') + '>'
      + kinds().map(function (k) { return '<option value="' + esc(k[0]) + '"' + (k[0] === kind ? ' selected' : '') + '>' + esc(k[1].label) + '</option>'; }).join('')
      + '</select></div>'
      + '<div><span class="ct-lab" id="ctHueLab">Colour</span><div class="ct-hues" role="group" aria-labelledby="ctHueLab">'
      + hues.map(function (h) {
        var hue = cc ? cc.COLOURS[h] : { label: 'Gold', border: '#b8a77c' };
        return '<button type="button" data-ct-hue="' + esc(h) + '" aria-pressed="' + String(h === colour) + '" style="--hue:' + esc(hue.border) + '"' + (c ? ' disabled' : '') + '><i aria-hidden="true"></i>' + esc(hue.label) + '</button>';
      }).join('')
      + '</div></div></div>';
  }

  function fields(c) {
    var keep = c ? null : data();
    var v = function (k, fallback) { return esc(c ? (c[k] || '') : ((keep && keep[k]) || fallback || '')); };
    var lock = c ? ' readonly' : '';
    var kind = c ? c.kind || 'internship' : ct.kind;
    var name = '<div><label for="ctName">' + (kind === 'internship' ? 'Intern\u2019s name' : 'Their name') + '</label><input id="ctName" maxlength="48" autocomplete="off" placeholder="As it should read on the certificate" value="' + v('name') + '"' + lock + '></div>';
    var on = '<div><label for="ctOn">Issued on</label><input id="ctOn" type="date" value="' + v('issuedOn', ct.today) + '"' + lock + '></div>';
    var email = '<div><label for="ctEmail">Their email</label><input id="ctEmail" type="email" maxlength="254" autocomplete="off" placeholder="To email it to them" value="' + v('email') + '"' + lock + '></div>';
    if (kind === 'internship') {
      return '<div class="ct-fields">' + name
        + '<div><label for="ctFrom">Internship from</label><input id="ctFrom" type="date" value="' + v('startDate') + '"' + lock + '></div>'
        + '<div><label for="ctTo">To</label><input id="ctTo" type="date" value="' + v('endDate') + '"' + lock + '></div>'
        + on + email + '</div>';
    }
    var s = spec(kind);
    return '<div class="ct-fields ct-fields--other">' + name
      + '<div><label for="ctLine">' + esc(s.line.label) + '</label><input id="ctLine" maxlength="70" autocomplete="off" placeholder="' + esc(s.line.hint) + '" value="' + v('line') + '"' + lock + '></div>'
      + '<div><label for="ctDate">Date <span class="ct-opt">(optional)</span></label><input id="ctDate" type="date" value="' + v('date') + '"' + lock + '></div>'
      + on + email + '</div>';
  }

  function render(said) {
    var node = $('[data-pane="certificates"]');
    var c = ct.current;
    var title = c ? spec(c.kind || 'internship') : null;
    node.innerHTML = '<div class="ct">'
      + purpose(c)
      + fields(c)
      + (c
        ? '<div class="ct-issued"><p><b>' + esc(c.number) + '</b> \u00b7 ' + esc(c.name) + ' \u00b7 ' + esc(title.label) + (c.revoked ? ' \u00b7 <span class="flag" data-s="failed">Withdrawn</span>' : '') + '<br><span class="note">Issued ' + esc(dayOf(c.issuedAt || c.issuedOn)) + (c.issuedBy ? ' by ' + esc(c.issuedBy) : '') + '. This is the certificate exactly as issued.</span></p>'
          + '<div class="ct-acts">' + (c.revoked ? '' : '<button class="press" type="button" data-ct-mail="' + esc(c.number) + '">Email it</button><button class="ghost" type="button" data-ct="pdf">Download PDF</button><button class="ghost" type="button" data-ct="png">Download PNG</button>')
          + '<button class="ghost" type="button" data-ct="new">Make another</button></div></div>'
        : '<div class="ct-acts"><button class="press" type="button" data-ct="issue">Issue certificate</button><p class="say" data-ct-say role="status" aria-live="polite"></p></div>')
      /* where the signature sits, for every certificate (assets/admin-cert-layout.js, 12 Nov 2026) */
      + (window.PFACertLayout ? window.PFACertLayout.panel(ct.layout) : '')
      + '<div data-sv-slot></div>'
      + '<figure class="ct-preview"><canvas id="ctCanvas" width="1120" height="792" aria-label="The certificate as it will print"></canvas>'
      + '<figcaption>' + (c ? 'Downloads as an A4 landscape PDF, or a PNG at print quality.' : 'Drawn as you type. The certificate number is given when you issue it, and is kept so the certificate can be checked.') + '</figcaption></figure>'
      + list()
      + '</div>';
    if (said && !c) say($('[data-pane="certificates"] [data-ct-say]'), said.text, said.tone);
    placeVault();
    if (C()) C().load().then(draw, function () { draw(); });
    draw();
  }

  function about(r) {
    var long = C() ? C().longDate : function (x) { return x; };
    if ((r.kind || 'internship') === 'internship') return esc(long(r.startDate)) + ' to ' + esc(long(r.endDate));
    return esc(r.line || (C() ? C().lineOf(r) : '')) + (r.date ? '<br><span class="note">' + esc(long(r.date)) + '</span>' : '');
  }
  function list() {
    if (!ct.rows.length) return '<p class="note" style="font-size:13px;color:var(--muted)">No certificates issued yet.</p>';
    var long = C() ? C().longDate : function (x) { return x; };
    return '<details class="fold ct-list"><summary>Issued certificates (' + ct.rows.length + ')</summary>'
      + '<div class="wrap"><table><thead><tr><th>Number</th><th>Name</th><th>For</th><th>Issued</th><th aria-label="Actions"></th></tr></thead><tbody>'
      + ct.rows.map(function (r) {
        return '<tr data-ref="' + esc(r.number) + '"><td><b>' + esc(r.number) + '</b><br><span class="note">' + esc(r.kindLabel || spec(r.kind || 'internship').label) + '</span></td>'
          + '<td>' + esc(r.name) + (r.revoked ? '<br><span class="flag" data-s="failed">Withdrawn</span><br><span class="note">' + esc(r.revokedReason) + '</span>' : '') + '</td>'
          + '<td>' + about(r) + '</td>'
          + '<td>' + esc(long(r.issuedOn)) + (r.issuedBy ? '<br><span class="note">by ' + esc(r.issuedBy) + '</span>' : '') + '</td>'
          + '<td><button class="linky" type="button" data-ct="open">Open</button>'
          + (r.revoked ? '' : (r.certificateUrl ? ' \u00b7 <a class="linky" href="' + esc(r.certificateUrl) + '" target="_blank" rel="noopener">Online</a>' : '') + ' \u00b7 <button class="linky" type="button" data-ct-mail="' + esc(r.number) + '">Email</button> \u00b7 <button class="linky" type="button" data-ct="withdraw">Withdraw</button>')
          + (r.sent ? '<br><span class="note">Emailed to ' + esc(r.sent.to) + ', ' + esc(dayOf(r.sent.at)) + '</span>' : '')
          + (ct.withdrawing === r.number ? '<div class="ct-why"><input id="ctWhy" maxlength="300" placeholder="Why it is withdrawn"><button class="ghost" type="button" data-ct="withdraw-yes">Withdraw it</button><button class="ghost" type="button" data-ct="withdraw-no">Keep it</button></div>' : '')
          + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  A.on('[data-pane="certificates"]', 'input', function (e) {
    if (ct.current) return;
    var f = e.target.closest && e.target.closest('.ct-fields > div');
    if (f) f.classList.remove('bad');
    draw();
  });
  /* a new purpose: its own fields and its own colour, the name kept */
  A.on('[data-pane="certificates"]', 'change', function (e) {
    if (ct.current || !e.target || e.target.id !== 'ctKind') return;
    var keep = { name: val('#ctName'), issuedOn: val('#ctOn'), email: val('#ctEmail') };
    ct.kind = e.target.value;
    ct.colour = '';
    render();
    ['name', 'issuedOn', 'email'].forEach(function (k) { var el = $({ name: '#ctName', issuedOn: '#ctOn', email: '#ctEmail' }[k]); if (el && keep[k]) el.value = keep[k]; });
    draw();
    var k = $('#ctKind'); if (k) k.focus();
  });
  A.on('[data-pane="certificates"]', 'click', function (e) {
    var hue = e.target.closest && e.target.closest('[data-ct-hue]');
    if (hue && !ct.current) {
      ct.colour = hue.getAttribute('data-ct-hue');
      Array.prototype.forEach.call(document.querySelectorAll('[data-ct-hue]'), function (b) { b.setAttribute('aria-pressed', String(b === hue)); });
      draw();
      return;
    }
    var b = e.target.closest && e.target.closest('[data-ct]');
    if (!b) return;
    var what = b.getAttribute('data-ct');
    var row = b.closest('tr[data-ref]');
    var number = row ? row.getAttribute('data-ref') : '';
    var PC = C();
    if (what === 'issue') {
      var sayNode = $('[data-pane="certificates"] [data-ct-say]');
      var body = Object.assign({ action: 'issue' }, data());
      delete body.number;
      var fieldOf = { name: '#ctName', startDate: '#ctFrom', endDate: '#ctTo', issuedOn: '#ctOn', email: '#ctEmail', line: '#ctLine', date: '#ctDate', kind: '#ctKind' };
      b.disabled = true;
      say(sayNode, 'Issuing\u2026');
      api('/api/admin/certificates', { method: 'POST', body: body }).then(function (r) {
        ct.current = r.certificate;
        ct.rows.unshift(r.certificate);
        render();
      }).catch(function (err) {
        b.disabled = false;
        var field = err && err.data && err.data.field;
        if (field && fieldOf[field]) { var box = $(fieldOf[field]); if (box) { box.closest('div').classList.add('bad'); box.focus(); } }
        say(sayNode, err.message || 'That could not be issued.', 'bad');
      });
      return;
    }
    if ((what === 'pdf' || what === 'png') && PC && ct.current) {
      b.disabled = true;
      var made = what === 'pdf' ? PC.pdf(ct.current) : PC.png(ct.current);
      made.then(function (blob) { PC.save(blob, PC.fileStem(ct.current) + '.' + what); })
        .catch(function (err) { console.warn('certificate download', err && err.message); b.textContent = 'Could not make the file. Try again'; })
        .then(function () { b.disabled = false; });
      return;
    }
    if (what === 'new') {
      var was = ct.current;
      ct.current = null;
      if (was) { ct.kind = was.kind || 'internship'; ct.colour = was.colour === spec(ct.kind).colour ? '' : (was.colour || ''); }
      render();
      var n = $('#ctName'); if (n) { n.value = ''; n.focus(); }
      draw();
      return;
    }
    if (what === 'open') {
      ct.current = ct.rows.filter(function (r) { return r.number === number; })[0] || null;
      render();
      $('[data-pane="certificates"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (what === 'withdraw') { ct.withdrawing = number; render(); var d = $('[data-pane="certificates"] details.ct-list'); if (d) d.open = true; var w = $('#ctWhy'); if (w) w.focus(); return; }
    if (what === 'withdraw-no') { ct.withdrawing = ''; render(); var d2 = $('[data-pane="certificates"] details.ct-list'); if (d2) d2.open = true; return; }
    if (what === 'withdraw-yes') {
      b.disabled = true;
      api('/api/admin/certificates', { method: 'POST', body: { action: 'revoke', number: number, reason: $('#ctWhy').value } }).then(function (r) {
        ct.withdrawing = '';
        ct.rows = ct.rows.map(function (x) { return x.number === number ? r.certificate : x; });
        if (ct.current && ct.current.number === number) ct.current = r.certificate;
        render();
        var d3 = $('[data-pane="certificates"] details.ct-list'); if (d3) d3.open = true;
      }).catch(function (err) {
        b.disabled = false;
        var w = $('#ctWhy'); if (w) { w.setCustomValidity(err.message || ''); if (w.reportValidity) w.reportValidity(); w.setCustomValidity(''); }
      });
    }
  });

  /* From an intern's record (16 Nov 2026): an internship certificate with
     their name, email and dates already in, to check and issue. */
  function prefill(p) {
    ct.current = null; ct.kind = (p && p.kind) || 'internship'; ct.colour = ''; ct.seed = p || null;
    if ($('#ctName')) { render(); seed(); }
  }
  function seed() {
    var p = ct.seed;
    ct.seed = null;
    if (!p) return;
    [['#ctName', p.name], ['#ctEmail', p.email], ['#ctFrom', p.startDate], ['#ctTo', p.endDate]].forEach(function (x) { var el = $(x[0]); if (el && x[1]) el.value = x[1]; });
    draw();
    var n = $('#ctName'); if (n) n.focus();
  }

  window.PFACertPane = { open: open, prefill: prefill, rows: function () { return ct.rows; }, data: data, draw: draw };
}());
