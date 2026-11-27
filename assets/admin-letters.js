/* People for Animals - the Letter studio, in the panel.
   ------------------------------------------------------------------------
   Owner, 20 Nov 2026 (PFA-Letter-Studio.html): "add this feature to the
   admin panel. admin should be able to select the name of the person and
   issue the cert. the cert should automatically take the address from the
   selected. also the email ID should be fetchable"; "logo, signature, seal
   size and position should be adjustable"; "letter font to be arial".

   Choose the person (from the People directory): their name and address go
   on the letter, their name into it where it says [Name], and their email
   is ready to send to. Choose the kind of letter, change any word, move and
   size the letterhead, the signature and the seal. The preview is the PDF
   the server makes (lib/letters.js), drawn here by pdf.js, so it is the
   letter exactly as it will be issued. Issue gives it its reference
   (PFA/LET/2026/00001); then download it, email it (the email is shown
   before it goes), or withdraw it. Every step is in the audit log.

   Under Certificates, as its own pane: the 'letters' module
   (lib/routes/admin/letters.js). Kept out of admin.html so that page stays
   under its weight ceiling; it uses the panel's helpers on window.PFAAdmin.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api;
  var DRAFT = 'pfa.letters.draft';
  var PLACES = 'pfa.letters.layout';

  var style = document.createElement('style');
  style.textContent = [
    '.pane[data-pane="letters"]::before{content:"Letter studio";display:block;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}',
    '.ls-modes{display:flex;flex-wrap:wrap;gap:0;margin:0 0 20px;border-bottom:1px solid var(--line)}',
    '.ls-modes button{min-height:44px;padding:0 16px;border:0;border-bottom:2px solid transparent;background:none;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;margin-bottom:-1px}',
    '.ls-modes button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--ink);font-weight:600}',
    '.ls-modes button:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}',
    '.ls{display:grid;grid-template-columns:minmax(300px,400px) minmax(0,1fr);gap:28px;align-items:start}',
    '@media (max-width:1100px){.ls{grid-template-columns:minmax(0,1fr)}}',
    '.ls-form{display:grid;gap:14px;min-width:0}',
    '.ls-form label{display:grid;gap:6px;font-size:12px;color:var(--muted)}',
    '.ls-form input:not([type=checkbox]):not([type=range]),.ls-form select,.ls-form textarea{width:100%;min-height:42px;padding:9px 12px;border:1px solid var(--line);background:var(--paper,#fff);font:inherit;font-size:14px;line-height:1.5;color:var(--ink);border-radius:0}',
    '.ls-form textarea{resize:vertical;min-height:84px}.ls-form textarea[name=body]{min-height:260px}',
    '.ls-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.ls-k{display:block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:6px 0 0}',
    '[data-ls-amount]{display:grid;gap:14px}[data-ls-amount]:empty{display:none}',
    '.ls-find{position:relative}',
    '.ls-hits{display:grid;border:1px solid var(--line);border-top:0;max-height:320px;overflow:auto;background:var(--paper,#fff)}',
    '.ls-hit{display:grid;gap:3px;text-align:left;padding:10px 12px;border:0;border-bottom:1px solid var(--line);background:none;font:inherit;color:var(--ink);cursor:pointer}',
    '.ls-hit:hover,.ls-hit:focus-visible{background:#f3f1ed}',
    '.ls-hit b{font-size:14px;overflow-wrap:anywhere}.ls-hit span{font-size:12px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere}',
    '.ls-who{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid var(--line);background:#f8f7f4}',
    '.ls-who p{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere;min-width:0}.ls-who b{font-size:14px}',
    '.ls-check{display:flex!important;align-items:center;gap:12px!important;font-size:14px!important;color:var(--ink)!important}.ls-check input{width:18px;height:18px;margin:0;flex:none}',
    '.ls-range{display:grid!important;grid-template-columns:minmax(0,1fr) 64px;align-items:center;gap:4px 12px!important}',
    '.ls-range span{grid-column:1 / -1}.ls-range input{width:100%;margin:0}.ls-range output{font-size:12px;color:var(--ink);text-align:right;white-space:nowrap}',
    '.ls-places{border:1px solid var(--line);padding:0 14px}.ls-places[open]{padding-bottom:14px}.ls-places summary{padding:12px 0;font-size:13px;cursor:pointer}',
    '.ls-places .ls-group{display:grid;gap:10px;margin-top:10px}',
    '.ls-acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
    '.ls-done{padding:14px;border:1px solid var(--line);background:#f8f7f4;display:grid;gap:10px}.ls-done p{margin:0;font-size:14px;line-height:1.5}',
    '.ls-view{position:sticky;top:12px;min-width:0;background:#e9edf0;padding:14px;max-height:calc(100vh - 24px);overflow:auto}',
    '.ls-view canvas{display:block;width:100%;height:auto;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18);margin:0 auto 14px;max-width:794px}',
    '.ls-viewbar{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#4d5b67;margin:0 0 10px;max-width:794px;margin-left:auto;margin-right:auto}',
    '.ls-list{margin-top:34px}.ls-list h3{margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
    '.ls-table{width:100%;border-collapse:collapse;font-size:13px}.ls-table th,.ls-table td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}',
    '.ls-table th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}',
    '.ls-table td .ls-acts{gap:6px}.ls-table button{min-height:34px;padding:0 12px;font-size:12px}',
    '.ls-off{color:var(--muted)}.ls-off td:first-child::after{content:" (withdrawn)"}',
    '@media (max-width:760px){.ls-table thead{display:none}.ls-table tr{display:grid;padding:10px 0;border-bottom:1px solid var(--line)}.ls-table td{border:0;padding:3px 0}}'
  ].join('');
  document.head.appendChild(style);

  var S = { setup: null, letters: [], person: null, shownName: '', shownAmount: '', donation: '', timer: 0, ask: 0, issued: null, places: null };

  function pane() { return $('[data-pane="letters"]'); }
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; }
  function store(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* this browser keeps nothing */ } }
  function stored(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function template(kind) { return (S.setup.templates.filter(function (t) { return t.kind === kind; })[0]) || S.setup.templates[0]; }
  function placesDefault() { var o = {}; Object.keys(S.setup.layout).forEach(function (k) { o[k] = S.setup.layout[k].value; }); return o; }

  /* ---- letters, or the foreign contribution documents ----------------------
     (owner, 26 Nov 2026: the receipt and utilization certificate template,
     "add this to admin.. it has to render perfectly with signature and
     seal"): three choices across the top of the studio. The documents are
     drawn by assets/admin-fcdocs.js, fetched the first time one is chosen. */
  var MODES = [['letters', 'Letters and certificates'], ['fc-receipt', 'Foreign contribution receipt'], ['fc-uc', 'Utilization certificate']];
  function modes(now) {
    return '<div class="ls-modes" role="tablist" aria-label="What to make">' + MODES.map(function (m) {
      return '<button type="button" role="tab" data-ls-mode="' + m[0] + '" aria-selected="' + (m[0] === now) + '">' + esc(m[1]) + '</button>';
    }).join('') + '</div>';
  }
  function openMode(mode) {
    var node = pane();
    if (!node) return;
    if (mode === 'letters') { render(); return; }
    var go = function () {
      if (!window.PFAFcDocs) { A.fail(node, new Error('That part of the studio could not be loaded. Refresh the page.')); return; }
      window.PFAFcDocs.show(node, mode, { modes: modes, setup: S.setup, letters: S.letters, onIssued: function (row) { S.letters.unshift(row); } });
    };
    if (window.PFAFcDocs) return go();
    var sc = document.createElement('script');
    sc.src = 'assets/admin-fcdocs.js';
    sc.onload = go; sc.onerror = go;
    document.head.appendChild(sc);
  }

  /* ---- the pane ---------------------------------------------------------- */
  function render() {
    var node = pane();
    if (!node) return undefined;
    return api('/api/admin/letters').then(function (d) {
      S.setup = d;
      S.letters = d.letters || [];
      S.places = Object.assign(placesDefault(), stored(PLACES) || {});
      var draft = stored(DRAFT);
      node.innerHTML = modes('letters') + '<div class="ls"><div class="ls-form" data-ls-form></div><div class="ls-view" data-ls-view aria-label="The letter as it will be issued"><p class="ls-viewbar"><span>The letter, as it will be issued</span><span data-ls-pages></span></p><div data-ls-pagesbox></div></div></div>'
        + '<div class="ls-list"><h3>Letters issued</h3><div data-ls-list></div></div>';
      form(draft);
      list();
      preview(true);
    }).catch(function (e) { A.fail(node, e); });
  }

  function form(draft) {
    var t = template((draft && draft.kind) || S.setup.templates[0].kind);
    var v = draft || { kind: t.kind, date: S.setup.today, recipient: '', subject: t.subject, salutation: t.salutation, body: t.body, closing: t.closing, signed: true, sealed: true, email: '' };
    S.person = (draft && draft.person) || null;
    S.shownName = (draft && draft.shownName) || '';
    S.shownAmount = (draft && draft.shownAmount) || '';
    S.donation = (draft && draft.donation) || '';
    var box = $('[data-ls-form]');
    var P = S.places;
    var range = function (k) {
      var spec = S.setup.layout[k];
      return '<label class="ls-range"><span>' + esc(spec.label) + '</span><input type="range" name="' + k + '" min="' + spec.min + '" max="' + spec.max + '" step="0.5" value="' + esc(P[k]) + '"><output data-ls-out="' + k + '">' + esc(P[k]) + ' ' + esc(spec.unit) + '</output></label>';
    };
    box.innerHTML = '<span class="ls-k">Who it is for</span>'
      + '<div data-ls-who></div>'
      + '<div data-ls-amount></div>'
      + '<label>Kind of letter<select name="kind">' + S.setup.templates.map(function (x) { return '<option value="' + esc(x.kind) + '"' + (x.kind === v.kind ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select></label>'
      + '<label>Date on the letter<input type="date" name="date" value="' + esc(v.date || S.setup.today) + '"></label>'
      + '<label>Name and address on the letter<textarea name="recipient" rows="4" maxlength="600" placeholder="Choose the person above, or write their name and address">' + esc(v.recipient) + '</textarea></label>'
      + '<label>Subject<input name="subject" maxlength="200" value="' + esc(v.subject) + '"></label>'
      + '<label>Greeting<input name="salutation" maxlength="120" value="' + esc(v.salutation) + '" placeholder="None"></label>'
      + '<label>The letter<textarea name="body" maxlength="12000">' + esc(v.body) + '</textarea></label>'
      + '<div class="ls-acts"><button class="ghost" type="button" data-ls="bold">Bold the selected words</button><span class="ls-off" style="font-size:12px">A blank line starts a new paragraph.</span></div>'
      + '<label>Closing words<input name="closing" maxlength="160" value="' + esc(v.closing) + '"></label>'
      + '<details class="ls-places"><summary>Signature, seal and letterhead</summary>'
      + '<label class="ls-check"><input type="checkbox" name="signed"' + (v.signed !== false ? ' checked' : '') + '><span>Smt. Maneka Sanjay Gandhi\'s signature</span></label>'
      + '<label>Name under the signature<input name="signName" maxlength="120" value="' + esc(v.signName == null ? 'Smt. Maneka Sanjay Gandhi' : v.signName) + '" placeholder="None"></label>'
      + '<label class="ls-check"><input type="checkbox" name="sealed"' + (v.sealed !== false ? ' checked' : '') + '><span>PFA\'s seal</span></label>'
      + '<div class="ls-group"><span class="ls-k">Letterhead</span>' + range('headSize') + range('headX') + range('headY') + '</div>'
      + '<div class="ls-group"><span class="ls-k">Signature</span>' + range('sigSize') + range('sigX') + range('sigY') + '</div>'
      + '<div class="ls-group"><span class="ls-k">Seal</span>' + range('sealSize') + range('sealX') + range('sealY') + '</div>'
      + '<div class="ls-acts" style="margin-top:12px"><button class="ghost" type="button" data-ls="places">Put them back where they were</button></div>'
      + '</details>'
      + '<label>Email it goes to<input type="email" name="email" maxlength="254" autocomplete="off" value="' + esc(v.email) + '" placeholder="Filled in from the person, or type one"></label>'
      + '<div data-ls-issue></div>'
      + '<p class="rg-say" data-ls-say role="status" aria-live="polite"></p>';
    who();
    amountBox();
    issueBox();
  }

  function field(name) { return $('[data-ls-form] [name="' + name + '"]'); }
  function values() {
    var get = function (n) { var el = field(n); return el ? el.value : ''; };
    var layout = {};
    Object.keys(S.setup.layout).forEach(function (k) { layout[k] = Number(get(k)); });
    return {
      kind: get('kind'), date: get('date'), recipient: get('recipient'), subject: get('subject'), salutation: get('salutation'),
      body: get('body'), closing: get('closing'), signed: field('signed').checked, sealed: field('sealed').checked, signName: get('signName'), layout: layout,
      email: get('email').trim(), person: S.person ? { id: S.person.id, name: S.person.name, email: S.person.email, mobile: S.person.mobile } : null,
      amount: S.shownAmount, donation: S.donation === 'all' ? '' : S.donation
    };
  }
  function keepDraft() { var v = values(); v.person = S.person; v.shownName = S.shownName; v.shownAmount = S.shownAmount; store(DRAFT, v); store(PLACES, v.layout); }

  /* ---- who it is for: the People directory ------------------------------- */
  function who() {
    var box = $('[data-ls-who]');
    if (S.person) {
      var p = S.person;
      /* the address as the letter has it, the district and state not said twice */
      var lines = String(p.recipient || '').split('\n').slice(1).filter(Boolean);
      box.innerHTML = '<div class="ls-who"><p><b>' + esc(p.name) + '</b><br>' + (lines.length ? lines.map(esc).join('<br>') : '<span class="ls-off">No address on file</span>') + (p.email ? '<br>' + esc(p.email) : '<br><span class="ls-off">No email on file</span>') + '</p><button class="ghost" type="button" data-ls="change">Change</button></div>';
      return;
    }
    box.innerHTML = '<div class="ls-find"><label>Find them in the People directory<input type="search" data-ls-find placeholder="Name, email, phone or PIN" autocomplete="off"></label><div class="ls-hits" data-ls-hits hidden></div></div>';
  }
  var findTimer = 0;
  var findAsk = 0;
  function find(q) {
    var hits = $('[data-ls-hits]');
    clearTimeout(findTimer);
    if (String(q || '').trim().length < 2) { hits.hidden = true; hits.innerHTML = ''; return; }
    findTimer = setTimeout(function () {
      var mine = ++findAsk;
      api('/api/admin/letters?people=' + encodeURIComponent(q.trim())).then(function (d) {
        if (mine !== findAsk) return;
        S.hits = d.people || [];
        hits.hidden = false;
        hits.innerHTML = S.hits.length ? S.hits.map(function (p, i) {
          return '<button class="ls-hit" type="button" data-ls-pick="' + i + '"><b>' + esc(p.name || 'No name given') + '</b><span>' + esc([p.address, [p.district, p.state].filter(Boolean).join(', ')].filter(Boolean).join(', ') || 'No address on file') + '</span><span>' + esc([p.email || 'No email', (p.categories || []).join(', ')].filter(Boolean).join(' · ')) + '</span></button>';
        }).join('') : '<p class="ls-hit" style="cursor:default"><span>Nobody in the directory matches. Write their name and address below instead.</span></p>';
      }).catch(function (e) { if (mine === findAsk) { hits.hidden = false; hits.innerHTML = '<p class="ls-hit"><span>' + esc(e.message) + '</span></p>'; } });
    }, 250);
  }
  /* does the letter name them in its words ([Name], or the name put in)? Then
     the address goes on alone (owner, 20 Nov 2026: "name need not be here.
     just the address. since name is there next in the letter") */
  function namesThem(name) {
    var text = ['salutation', 'body', 'subject', 'closing'].map(function (n) { var el = field(n); return el ? el.value : ''; }).join(' ');
    return text.indexOf('[Name]') !== -1 || Boolean(name && text.indexOf(name) !== -1);
  }
  function addressFor(p) { return namesThem(S.shownName) ? (p.addressBlock || '') : (p.recipient || p.name); }
  function pick(p) {
    S.person = p;
    field('recipient').value = addressFor(p);
    field('email').value = p.email || '';
    /* their name where the letter says [Name], or where the last one chosen was */
    ['salutation', 'body', 'subject', 'closing'].forEach(function (n) {
      var el = field(n);
      var text = el.value.split('[Name]').join(p.name);
      if (S.shownName && S.shownName !== p.name) text = text.split(S.shownName).join(p.name);
      el.value = text;
    });
    S.shownName = p.name;
    who();
    var d = (p.donations || [])[0];
    S.donation = d ? d.reference : '';
    amountBox();
    setAmount(d ? d.money : '');
  }

  /* ---- the amount: from their donations, or typed ------------------------
     (owner, 20 Nov 2026: "amount isnt there in the body"). It goes into the
     letter where it says [Amount], or where the last amount chosen was. */
  function needsAmount() {
    var text = ['body', 'subject', 'closing'].map(function (n) { var el = field(n); return el ? el.value : ''; }).join(' ');
    return text.indexOf('[Amount]') !== -1 || (S.shownAmount && text.indexOf(S.shownAmount) !== -1);
  }
  function longDay(iso) { var d = new Date(iso || ''); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function amountBox() {
    var box = $('[data-ls-amount]');
    if (!box) return;
    if (!needsAmount()) { box.innerHTML = ''; return; }
    var list = (S.person && S.person.donations) || [];
    var inr = list.filter(function (d) { return d.currency === 'inr'; });
    var total = inr.reduce(function (n, d) { return n + d.amount; }, 0);
    var totalMoney = '₹' + String(Math.round(total * 100) / 100);
    var opts = list.map(function (d) {
      return '<option value="' + esc(d.reference) + '"' + (d.reference === S.donation ? ' selected' : '') + '>' + esc(d.money + ', ' + longDay(d.at) + (d.giftTo ? ', a gift for ' + d.giftTo : '') + ' (' + d.reference + ')') + '</option>';
    });
    if (inr.length > 1) opts.push('<option value="all"' + (S.donation === 'all' ? ' selected' : '') + '>' + esc('All ' + inr.length + ' donations: ' + totalMoney) + '</option>');
    opts.push('<option value=""' + (!S.donation ? ' selected' : '') + '>Another amount, typed below</option>');
    box.innerHTML = (list.length ? '<label>Their donation<select data-ls-donation>' + opts.join('') + '</select></label>'
      : (S.person ? '<p class="ls-off" style="font-size:12px;margin:0">No donation on file for ' + esc(S.person.name) + '. Type the amount, or take the amount out of the letter.</p>' : ''))
      + '<label>Amount on the letter<input data-ls-money maxlength="40" value="' + esc(S.shownAmount) + '" placeholder="For example ₹5000"></label>';
    box.setAttribute('data-total', totalMoney);
  }
  /* 5000 or 5,000 is rupees, written ₹5000 (no separators); anything else is kept as typed */
  function moneyTyped(raw) {
    var v = String(raw || '').trim();
    if (/^\d[\d,]*(\.\d{1,2})?$/.test(v)) { var n = Number(v.replace(/,/g, '')); if (n > 0) return '₹' + String(Math.round(n * 100) / 100); }
    return v;
  }
  function setAmount(value) {
    var v = String(value || '').trim();
    ['body', 'subject', 'closing'].forEach(function (n) {
      var el = field(n);
      if (!el) return;
      var text = el.value;
      if (S.shownAmount) text = text.split(S.shownAmount).join(v || '[Amount]');
      if (v) text = text.split('[Amount]').join(v);
      el.value = text;
    });
    S.shownAmount = v;
    var input = $('[data-ls-money]');
    if (input && input.value !== v) input.value = v;
    changed();
  }

  /* ---- the preview: the server's PDF, drawn by pdf.js -------------------- */
  var BASE = new URL('assets/vendor/pdfjs/pdf.min.js', document.baseURI).href.replace(/pdf\.min\.js$/, '');
  var lib = null;
  function pdfjs() {
    if (!lib) lib = import(BASE + 'pdf.min.js').then(function (p) { p.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js'; return p; }, function (e) { lib = null; throw e; });
    return lib;
  }
  function bytesOf(b64) { var s = atob(b64); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function draw(b64) {
    var holder = $('[data-ls-pagesbox]');
    return pdfjs().then(function (p) { return p.getDocument({ data: bytesOf(b64) }).promise; }).then(function (doc) {
      var width = Math.min(794, holder.clientWidth || 794);
      var ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      var made = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) {
        (function (n) {
          chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: (width / base.width) * ratio });
            var c = document.createElement('canvas');
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            c.setAttribute('aria-label', 'Page ' + n + ' of ' + doc.numPages);
            made.push(c);
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          });
        }(i));
      }
      /* swapped in whole, so the page does not jump while it draws */
      return chain.then(function () { holder.replaceChildren.apply(holder, made); $('[data-ls-pages]').textContent = doc.numPages + (doc.numPages === 1 ? ' page' : ' pages'); });
    });
  }
  function preview(now) {
    clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      var mine = ++S.ask;
      $('[data-ls-pages]').textContent = 'Updating';
      api('/api/admin/letters', { method: 'POST', body: { action: 'preview', letter: values() } }).then(function (d) {
        if (mine !== S.ask) return undefined;
        say($('[data-ls-say]'), '', '');
        return draw(d.pdf);
      }).catch(function (e) {
        if (mine !== S.ask) return;
        $('[data-ls-pages]').textContent = '';
        say($('[data-ls-say]'), e.message, 'bad');
      });
    }, now ? 0 : 600);
  }
  function changed() { keepDraft(); S.issued = null; issueBox(); preview(false); }

  /* ---- issuing ------------------------------------------------------------- */
  function issueBox() {
    var box = $('[data-ls-issue]');
    if (!box) return;
    if (S.issued) {
      var l = S.issued;
      box.innerHTML = '<div class="ls-done"><p><b>Issued: ' + esc(l.number) + '</b>, to ' + esc(l.name) + '.'
        + (l.verifyUrl ? ' Anyone can check it is genuine at <a href="' + esc(l.verifyUrl) + '" target="_blank" rel="noopener">its public check</a>: who it is to, when and what for, never the letter.' : '') + '</p>'
        + '<div class="ls-acts"><button class="press" type="button" data-ls-pdf="' + esc(l.number) + '">Download the PDF</button>'
        + '<button class="ghost" type="button" data-ls-mail="' + esc(l.number) + '">Email it' + (l.email ? ' to ' + esc(l.email) : '') + '</button>'
        + '<button class="ghost" type="button" data-ls="new">Write another</button></div></div>';
      return;
    }
    box.innerHTML = '<div class="ls-acts"><button class="press" type="button" data-ls="issue">Issue the letter</button><span class="ls-off" style="font-size:12px">It is given the next reference, and kept as it is.</span></div>';
  }
  function issue(btn) {
    if (btn.getAttribute('data-sure') !== '1') {
      btn.setAttribute('data-sure', '1');
      btn.textContent = 'Issue it now? It cannot be changed after';
      setTimeout(function () { if (btn.isConnected && btn.getAttribute('data-sure') === '1') { btn.removeAttribute('data-sure'); btn.textContent = 'Issue the letter'; } }, 6000);
      return;
    }
    btn.disabled = true;
    say($('[data-ls-say]'), 'Issuing...', '');
    api('/api/admin/letters', { method: 'POST', body: { action: 'issue', letter: values() } }).then(function (d) {
      S.issued = d.letter;
      S.letters.unshift(d.letter);
      store(DRAFT, null);
      say($('[data-ls-say]'), 'Issued as ' + d.letter.number + '.', 'good');
      issueBox();
      list();
      draw(d.pdf);
    }).catch(function (e) {
      btn.disabled = false; btn.removeAttribute('data-sure'); btn.textContent = 'Issue the letter';
      say($('[data-ls-say]'), e.message, 'bad');
      var f = e && e.data && e.data.field;
      var bad = f === 'amount' ? $('[data-ls-money]') : f ? field(f === 'person' ? 'recipient' : f) : null;
      if (bad && bad.focus) bad.focus();
    });
  }

  function download(number, btn) {
    if (btn) btn.disabled = true;
    A.token().then(function (id) {
      return fetch('/api/admin/letters?number=' + encodeURIComponent(number) + '&format=pdf', { headers: { Authorization: 'Bearer ' + id } });
    }).then(function (r) { if (!r.ok) throw new Error('The PDF could not be read just now.'); return r.blob(); }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'PFA-letter-' + number.replace(/\//g, '-') + '.pdf'; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }).catch(function (e) { say($('[data-ls-say]'), e.message, 'bad'); }).then(function () { if (btn) btn.disabled = false; });
  }

  /* ---- the email: seen before it goes ------------------------------------- */
  var dlg = document.createElement('dialog');
  dlg.className = 'rgm ctm';
  dlg.setAttribute('aria-label', 'Check the letter email before it goes');
  document.body.appendChild(dlg);
  var M = { number: '', to: '', ask: 0 };
  function closeMail() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  function mail(number) {
    var row = S.letters.filter(function (l) { return l.number === number; })[0] || {};
    M = { number: number, to: row.email || '', ask: 0 };
    dlg.innerHTML = '<div class="rgm-head"><h3>Check the email before it goes</h3><p class="rgm-sub">' + esc(number) + ' · ' + esc(row.name || '') + '. The letter goes as the PDF that was issued.</p></div>'
      + '<div class="rgm-cards"><article class="rgm-card" style="grid-column:1 / -1"><p class="rgm-to"><label for="lsTo"><b>To</b></label><input id="lsTo" class="ctm-to" type="email" maxlength="254" autocomplete="off" value="' + esc(M.to) + '" placeholder="Their email"></p><p class="rgm-subj" data-lsm-subj></p><iframe class="rgm-frame" sandbox="" title="The email" data-lsm-frame></iframe></article></div>'
      + '<div class="rgm-foot"><p class="rg-say" data-lsm-say role="status" aria-live="polite"></p><button class="ghost" type="button" data-lsm="cancel">Cancel</button><button class="press" type="button" data-lsm="send" disabled>Send the letter</button></div>';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    mailPreview();
  }
  function mailPreview() {
    var mine = ++M.ask;
    var to = $('#lsTo', dlg).value.trim();
    var send = $('[data-lsm="send"]', dlg);
    send.disabled = true;
    if (!to) { say($('[data-lsm-say]', dlg), 'Type the email it goes to.', 'bad'); return; }
    api('/api/admin/letters', { method: 'POST', body: { action: 'mail', number: M.number, email: to } }).then(function (d) {
      if (mine !== M.ask) return;
      M.to = d.to;
      $('[data-lsm-subj]', dlg).textContent = d.subject;
      $('[data-lsm-frame]', dlg).srcdoc = d.html;
      say($('[data-lsm-say]', dlg), '', '');
      send.disabled = false;
    }).catch(function (e) { if (mine === M.ask) say($('[data-lsm-say]', dlg), e.message, 'bad'); });
  }
  var mailTimer = 0;
  dlg.addEventListener('input', function (e) { if (e.target.id === 'lsTo') { clearTimeout(mailTimer); mailTimer = setTimeout(mailPreview, 400); } });
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lsm]');
    if (!b) return;
    if (b.getAttribute('data-lsm') === 'cancel') return closeMail();
    b.disabled = true;
    say($('[data-lsm-say]', dlg), 'Sending...', '');
    api('/api/admin/letters', { method: 'POST', body: { action: 'email', number: M.number, email: M.to } }).then(function (d) {
      S.letters = S.letters.map(function (l) { return l.number === d.letter.number ? d.letter : l; });
      if (S.issued && S.issued.number === d.letter.number) S.issued = d.letter;
      list();
      closeMail();
      say($('[data-ls-say]'), (d.state === 'sent' ? 'Sent to ' : 'Queued for ') + d.to + '.' + (d.reason ? ' ' + d.reason : ''), d.state === 'sent' ? 'good' : '');
    }).catch(function (err) { b.disabled = false; say($('[data-lsm-say]', dlg), err.message, 'bad'); });
  });

  /* ---- the letters issued -------------------------------------------------- */
  function list() {
    var box = $('[data-ls-list]');
    if (!box) return;
    if (!S.letters.length) { box.innerHTML = '<p class="ls-off" style="font-size:14px">No letters yet. The first one issued is listed here.</p>'; return; }
    box.innerHTML = '<table class="ls-table"><thead><tr><th>Reference</th><th>To</th><th>Subject</th><th>Dated</th><th>Emailed</th><th></th></tr></thead><tbody>'
      + S.letters.map(function (l) {
        var sent = l.sent ? (l.sent.state === 'sent' ? 'Sent to ' : 'Queued for ') + l.sent.to + ', ' + day(l.sent.at) : 'Not yet';
        return '<tr' + (l.withdrawn ? ' class="ls-off"' : '') + '><td>' + (l.verifyUrl ? '<a href="' + esc(l.verifyUrl) + '" target="_blank" rel="noopener" title="Its public check">' + esc(l.number) + '</a>' : esc(l.number)) + '</td><td>' + esc(l.name) + '</td><td>' + esc(l.subject) + '</td><td>' + esc(day(l.date)) + '</td><td>' + esc(l.withdrawn ? 'Withdrawn: ' + l.withdrawnReason : sent) + '</td>'
          + '<td><div class="ls-acts"><button class="ghost" type="button" data-ls-pdf="' + esc(l.number) + '">PDF</button>'
          + (l.withdrawn ? '' : '<button class="ghost" type="button" data-ls-mail="' + esc(l.number) + '">Email</button><button class="ghost" type="button" data-ls-off="' + esc(l.number) + '">Withdraw</button>')
          + '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function withdraw(number, btn) {
    var reason = window.prompt('Why is ' + number + ' withdrawn? This is kept with it, and it can no longer be emailed.');
    if (reason == null) return;
    btn.disabled = true;
    api('/api/admin/letters', { method: 'POST', body: { action: 'withdraw', number: number, reason: reason } }).then(function (d) {
      S.letters = S.letters.map(function (l) { return l.number === number ? d.letter : l; });
      list();
      say($('[data-ls-say]'), number + ' is withdrawn.', 'good');
    }).catch(function (e) { btn.disabled = false; say($('[data-ls-say]'), e.message, 'bad'); });
  }

  /* ---- what the pane does ----------------------------------------------- */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t.closest || !t.closest('[data-pane="letters"]') || t.closest('[data-fc]')) return;
    if (t.hasAttribute('data-ls-find')) return find(t.value);
    /* the amount goes into the letter when it is finished (change), never
       a keystroke at a time: "2" on its way to "2500" would match any 2 */
    if (t.hasAttribute('data-ls-money')) { S.donation = ''; var sel = $('[data-ls-donation]'); if (sel) sel.value = ''; return undefined; }
    if (t.type === 'range') { var spec = S.setup.layout[t.name]; var out = $('[data-ls-out="' + t.name + '"]'); if (out && spec) out.textContent = t.value + ' ' + spec.unit; }
    if (t.closest('[data-ls-form]')) changed();
    /* [Amount] typed into the letter, or taken out of it */
    if (/^(body|subject|closing)$/.test(t.name) && Boolean($('[data-ls-money]')) !== needsAmount()) amountBox();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t.closest || !t.closest('[data-pane="letters"]') || t.closest('[data-fc]')) return;
    if (t.hasAttribute('data-ls-money')) return setAmount(moneyTyped(t.value));
    if (t.hasAttribute('data-ls-donation')) {
      S.donation = t.value;
      var chosen = ((S.person && S.person.donations) || []).filter(function (d) { return d.reference === t.value; })[0];
      if (chosen) return setAmount(chosen.money);
      if (t.value === 'all') return setAmount($('[data-ls-amount]').getAttribute('data-total'));
      var typed = $('[data-ls-money]'); if (typed) typed.focus();
      return undefined;
    }
    if (t.name === 'kind') {
      var tp = template(t.value);
      var was = field('recipient').value;
      var auto = S.person && (was === S.person.addressBlock || was === S.person.recipient);
      var body = field('body');
      var name = S.person ? S.person.name : '';
      var fill = function (s) { return name ? String(s || '').split('[Name]').join(name) : String(s || ''); };
      field('subject').value = fill(tp.subject);
      field('salutation').value = fill(tp.salutation);
      body.value = fill(tp.body);
      field('closing').value = fill(tp.closing);
      if (S.shownAmount) { var amt = S.shownAmount; ['body', 'subject', 'closing'].forEach(function (n) { field(n).value = field(n).value.split('[Amount]').join(amt); }); }
      if (auto) field('recipient').value = addressFor(S.person);
      amountBox();
      changed();
    }
    if (t.type === 'checkbox' && t.closest('[data-ls-form]')) changed();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pane="letters"] button');
    if (!b) return;
    if (b.hasAttribute('data-ls-mode')) { if (b.getAttribute('aria-selected') !== 'true') openMode(b.getAttribute('data-ls-mode')); return; }
    if (b.closest('[data-fc]')) return;
    if (b.hasAttribute('data-ls-pick')) return pick(S.hits[Number(b.getAttribute('data-ls-pick'))]);
    if (b.hasAttribute('data-ls-pdf')) return download(b.getAttribute('data-ls-pdf'), b);
    if (b.hasAttribute('data-ls-mail')) return mail(b.getAttribute('data-ls-mail'));
    if (b.hasAttribute('data-ls-off')) return withdraw(b.getAttribute('data-ls-off'), b);
    var what = b.getAttribute('data-ls');
    if (what === 'change') { S.person = null; who(); var f = $('[data-ls-find]'); if (f) f.focus(); keepDraft(); return; }
    if (what === 'issue') return issue(b);
    if (what === 'new') { S.issued = null; S.person = null; S.shownName = ''; S.shownAmount = ''; S.donation = ''; store(DRAFT, null); form(null); preview(true); return; }
    if (what === 'places') {
      var d = placesDefault();
      Object.keys(d).forEach(function (k) { var el = field(k); if (el) { el.value = d[k]; var out = $('[data-ls-out="' + k + '"]'); if (out) out.textContent = d[k] + ' ' + S.setup.layout[k].unit; } });
      changed();
      return;
    }
    if (what === 'bold') {
      var ta = field('body');
      var a = ta.selectionStart, z = ta.selectionEnd;
      if (a === z) { say($('[data-ls-say]'), 'Select the words to make bold first.', ''); ta.focus(); return; }
      ta.setRangeText('**' + ta.value.slice(a, z) + '**', a, z, 'select');
      ta.focus();
      changed();
    }
  });

  window.PFALetters = { pane: render, draw: draw };
}());
