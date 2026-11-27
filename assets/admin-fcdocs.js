/* People for Animals - foreign contribution documents, in the Letter studio.
   ------------------------------------------------------------------------
   Owner, 26 Nov 2026, with the receipt and utilization certificate
   template: "add this to admin.. it has to render perfectly with signature
   and seal. plan and build the template editable".

   Two documents, chosen across the top of the Letter studio:
     Foreign contribution receipt  money received from a foreign donor
     Utilization certificate       how it was spent, payment by payment
   Each is a short form in stages, with the rest under a +: the donor (PFA's
   donors are kept, one choice), the money, the project, then the wording,
   the bank, the signatures. The preview is the PDF the server makes (lib/
   fc-docs.js), drawn by the studio's own pdf.js, so it is the document
   exactly as it will be issued. Issuing keeps it as a letter is kept: its
   reference, its PDF, email, the public check, withdrawal.

   + Edit the template changes the wording, PFA's registration and bank
   details and the signatory for every document made after; one already
   issued keeps what it was issued with.

   Loaded by assets/admin-letters.js the first time it is needed.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api;
  var DRAFT = 'pfa.fcdocs.draft.';

  var style = document.createElement('style');
  style.textContent = [
    '.fc-sec{display:grid;gap:12px;padding:14px 0 4px;border-top:1px solid var(--line)}',
    '.fc-sec>h4{margin:0;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
    '.fc-more{border:1px solid var(--line);padding:0 14px}.fc-more[open]{padding-bottom:14px}',
    '.fc-more>summary{list-style:none;display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px;cursor:pointer}',
    '.fc-more>summary::-webkit-details-marker{display:none}',
    '.fc-more>summary::before{content:"+";font-size:17px;line-height:1;display:inline-block;transition:transform .2s}',
    '.fc-more[open]>summary::before{transform:rotate(45deg)}',
    '.fc-more>div{display:grid;gap:12px}',
    '.fc-three{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr));gap:12px}',
    '.fc-clause{display:grid;gap:8px;padding:12px;border:1px solid var(--line);background:#fbfaf8}',
    '.fc-row{display:grid;gap:8px;padding:12px;border:1px solid var(--line);background:#fbfaf8}',
    '.fc-row .ls-two{gap:8px}',
    '.fc-sum{display:grid;gap:4px;padding:12px 14px;border:1px solid var(--line);font-size:14px;line-height:1.5}',
    '.fc-sum b{font-variant-numeric:tabular-nums}',
    '.fc-warn{color:#a3251f}',
    '.fc-note{margin:0;font-size:12px;line-height:1.5;color:var(--muted)}',
    '.fc-tpl{margin:0 0 18px}',
    '.fc-tpl .fc-more>div{max-width:820px}',
    '.fc-encl{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;align-items:start}',
    '.fc-encl input[type=checkbox]{width:18px;height:18px;margin:11px 0 0}',
    '[data-fc] textarea.fc-grow{min-height:42px!important;resize:none;overflow:hidden;field-sizing:content;line-height:1.45}',
    '[data-fc] .ls-acts .press{width:auto;display:inline-flex;align-items:center;min-height:42px;padding:0 20px}'
  ].join('');
  document.head.appendChild(style);

  var F = { node: null, kind: 'fc-receipt', ctx: null, tpl: null, doc: null, issued: null, timer: 0, ask: 0 };
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'SGD', 'AED', 'JPY', 'NZD'];

  function store(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* nothing kept */ } }
  function stored(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function n2(v) { var n = Number(String(v == null ? '' : v).replace(/[,\s]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function amt(n) { if (n == null) return ''; var v = Math.round(n * 100) / 100; return v % 1 === 0 ? String(v) : v.toFixed(2); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---- a document, fresh from the template ---------------------------- */
  function fresh(kind) {
    var t = F.tpl, o = t.org;
    var donor = t.donors[0] || {};
    var d = {
      donorName: donor.name || '', donorAka: donor.aka || '', donorStatus: donor.status || '', donorAddress: donor.address || '', donorCountry: donor.country || '',
      sanctionRef: '', sanctionDate: '', currency: 'USD', foreignAmount: '', inrAmount: '', rate: '', creditDate: '', project: '', location: '',
      office: o.office, fcraNo: o.fcraNo, pan: o.pan, signName: o.signName, signTitle: o.signTitle,
      printedNo: '', labels: clone((t.labels || {})[kind === 'fc-receipt' ? 'receipt' : 'uc'] || {})
    };
    if (kind === 'fc-receipt') {
      return Object.assign(d, { title: t.receipt.title, mode: 'SWIFT Wire Transfer', utr: '', bank: o.bank, fcraAccount: o.fcraAccount, utilBank: '', utilAccount: '',
        intro: t.receipt.intro, clauses: clone(t.receipt.clauses), enclosure: t.receipt.enclosure, enclosed: true });
    }
    return Object.assign(d, { title: t.uc.title, periodFrom: '', periodTo: '', receiptNo: '', rows: [{ date: '', vendor: '', invoice: '', desc: '', payRef: '', amount: '' }],
      clauses: clone(t.uc.clauses), enclosures: t.uc.enclosures.map(function (x) { return { text: x, checked: true }; }),
      secondOn: true, secondName: '', secondTitle: t.uc.secondLabel });
  }
  function places() {
    var o = {}, L = F.ctx.setup.layout, fc = F.ctx.setup.fc.layout || {};
    Object.keys(L).forEach(function (k) { o[k] = fc[k] != null ? fc[k] : L[k].value; });
    return o;
  }

  /* ---- the view ---------------------------------------------------------- */
  function show(node, kind, ctx) {
    F.node = node; F.kind = kind; F.ctx = ctx; F.issued = null;
    F.tpl = ctx.setup.fc.template;
    var draft = stored(DRAFT + kind);
    F.doc = draft && draft.doc ? draft : { doc: fresh(kind), date: ctx.setup.today, signed: true, sealed: true, layout: places(), email: '' };
    paint();
  }
  function paint() {
    var node = F.node;
    node.innerHTML = F.ctx.modes(F.kind) + '<div data-fc>' + templateBox() + '<div class="ls"><div class="ls-form" data-fc-form></div>'
      + '<div class="ls-view" data-ls-view aria-label="The document as it will be issued"><p class="ls-viewbar"><span>The document, as it will be issued</span><span data-ls-pages></span></p><div data-ls-pagesbox></div></div></div>'
      + '<div class="ls-list"><h3>' + (F.kind === 'fc-receipt' ? 'Receipts issued' : 'Certificates issued') + '</h3><div data-fc-list></div></div></div>';
    form();
    list();
    preview(true);
  }

  /* Text that can be long wraps and grows, never cut off at the box's edge:
     a one-line box that becomes two when it needs to. Dates, sums and the
     email stay plain inputs. */
  function input(name, label, value, extra) {
    var e = extra || {};
    if (!e.type && !e.inputmode) return '<label>' + esc(label) + '<textarea class="fc-grow" rows="1" name="' + name + '" maxlength="' + (e.max || 300) + '"' + (e.ph ? ' placeholder="' + esc(e.ph) + '"' : '') + '>' + esc(value == null ? '' : value) + '</textarea></label>';
    return '<label>' + esc(label) + '<input name="' + name + '"' + (e.type ? ' type="' + e.type + '"' : '') + (e.inputmode ? ' inputmode="' + e.inputmode + '"' : '') + ' maxlength="' + (e.max || 300) + '" value="' + esc(value == null ? '' : value) + '"' + (e.ph ? ' placeholder="' + esc(e.ph) + '"' : '') + '></label>';
  }
  function area(name, label, value, rows, max) {
    return '<label>' + esc(label) + '<textarea name="' + name + '" rows="' + (rows || 3) + '" maxlength="' + (max || 1500) + '">' + esc(value || '') + '</textarea></label>';
  }
  function more(title, inner, open) { return '<details class="fc-more"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div>' + inner + '</div></details>'; }

  function donorPick(d) {
    var list = F.tpl.donors || [];
    var at = -1;
    list.forEach(function (x, i) { if (x.name === d.donorName) at = i; });
    return '<label>PFA’s donors<select data-fc-donor>' + list.map(function (x, i) { return '<option value="' + i + '"' + (i === at ? ' selected' : '') + '>' + esc(x.aka ? x.aka.replace(/^d\/b\/a\s*/i, '') : x.name) + '</option>'; }).join('')
      + '<option value="new"' + (at < 0 ? ' selected' : '') + '>Someone new, typed below</option></select></label>';
  }
  function clausesBox(list) {
    return list.map(function (c, i) {
      return '<div class="fc-clause">' + input('clause-lead-' + i, 'Point ' + (i + 1) + ', in bold', c.lead, { max: 120 }) + area('clause-text-' + i, 'Its words', c.text, 3)
        + '<div class="ls-acts"><button class="ghost" type="button" data-fc="clause-del" data-i="' + i + '">Remove this point</button></div></div>';
    }).join('') + '<div class="ls-acts"><button class="ghost" type="button" data-fc="clause-add">Add a point</button></div>'
      + '<p class="fc-note">{donor}, {project}, {received} and {utilized} are filled in from the document.</p>';
  }
  function spec(kind) { return (F.ctx.setup.fc.labelSpec || {})[kind] || []; }
  /* every heading and label the document prints, one box each */
  function labelsBox(prefix, kind, values) {
    return '<p class="fc-note">What the document prints for each heading and label. Empty puts back the original.</p>'
      + spec(kind).map(function (x) { return input(prefix + x[0], x[1], (values || {})[x[0]] != null ? values[x[0]] : x[1], { max: 160 }); }).join('');
  }
  function placesBox(v) {
    var L = F.ctx.setup.layout, P = v.layout || places();
    var range = function (k) {
      var spec = L[k];
      return '<label class="ls-range"><span>' + esc(spec.label) + '</span><input type="range" name="L-' + k + '" min="' + spec.min + '" max="' + spec.max + '" step="0.5" value="' + esc(P[k]) + '"><output data-fc-out="' + k + '">' + esc(P[k]) + ' ' + esc(spec.unit) + '</output></label>';
    };
    return '<label class="ls-check"><input type="checkbox" name="signed"' + (v.signed !== false ? ' checked' : '') + '><span>Smt. Maneka Sanjay Gandhi’s signature</span></label>'
      + '<label class="ls-check"><input type="checkbox" name="sealed"' + (v.sealed !== false ? ' checked' : '') + '><span>PFA’s seal</span></label>'
      + '<div class="ls-group"><span class="ls-k">Letterhead</span>' + range('headSize') + range('headX') + range('headY') + '</div>'
      + '<div class="ls-group"><span class="ls-k">Signature</span>' + range('sigSize') + range('sigX') + range('sigY') + '</div>'
      + '<div class="ls-group"><span class="ls-k">Seal</span>' + range('sealSize') + range('sealX') + range('sealY') + '</div>'
      + '<div class="ls-acts"><button class="ghost" type="button" data-fc="places">Put them back where they were</button></div>';
  }

  function form() {
    var v = F.doc, d = v.doc, uc = F.kind === 'fc-uc';
    var out = [];
    out.push('<div class="ls-two">' + input('date', uc ? 'Date on the certificate' : 'Date on the receipt', v.date, { type: 'date' })
      + input('printedNo', uc ? 'UC number printed' : 'Receipt number printed', d.printedNo, { max: 40, ph: 'Empty: PFA\u2019s reference' }) + '</div>');
    if (uc) {
      var rs = (F.ctx.setup.fc.receipts || []).filter(function (r) { return !r.withdrawn; });
      out.push('<div class="ls-two">' + input('periodFrom', 'Reporting period from', d.periodFrom, { type: 'date' }) + input('periodTo', 'to', d.periodTo, { type: 'date' }) + '</div>');
      if (rs.length) out.push('<label>Start from a receipt PFA issued<select data-fc-receipt><option value="">Choose a receipt</option>' + rs.map(function (r) { return '<option value="' + esc(r.number) + '"' + (r.number === d.receiptNo ? ' selected' : '') + '>' + esc(r.number + ' · INR ' + amt(r.inrAmount)) + '</option>'; }).join('') + '</select></label>');
    }
    /* who gave */
    out.push('<div class="fc-sec"><h4>The donor</h4>' + donorPick(d) + input('donorName', 'Legal name', d.donorName, { max: 160 })
      + (uc ? '' : input('donorAka', 'Also known as', d.donorAka, { max: 120, ph: 'd/b/a ...' }))
      + input('donorStatus', 'Legal status and tax ID', d.donorStatus, { max: 200 })
      + (uc ? '' : input('donorAddress', 'Registered address', d.donorAddress, { max: 300 }) + input('donorCountry', 'Country', d.donorCountry, { max: 80 }))
      + more('Grant sanction letter', input('sanctionRef', 'Reference', d.sanctionRef, { max: 80 }) + (uc ? input('receiptNo', 'PFA receipt number', d.receiptNo, { max: 40, ph: 'PFA-LET-...' }) : input('sanctionDate', 'Dated', d.sanctionDate, { type: 'date' })), Boolean(d.sanctionRef || d.sanctionDate || d.receiptNo))
      + '</div>');
    /* the money */
    var rate = n2(d.rate) || (n2(d.foreignAmount) && n2(d.inrAmount) ? Math.round(n2(d.inrAmount) / n2(d.foreignAmount) * 100) / 100 : null);
    out.push('<div class="fc-sec"><h4>The money</h4><div class="fc-three"><label>Currency<select name="currency">' + CURRENCIES.map(function (c) { return '<option' + (c === d.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>'
      + input('foreignAmount', 'Amount remitted', d.foreignAmount, { inputmode: 'decimal', max: 20, ph: '2664.92' })
      + input('inrAmount', 'Net INR credited', d.inrAmount, { inputmode: 'decimal', max: 20, ph: '255433' }) + '</div>'
      + '<div class="ls-two">' + input('creditDate', 'Credited to the FCRA account on', d.creditDate, { type: 'date' })
      + (uc ? '' : input('rate', 'Exchange rate (worked out if left empty)', d.rate, { inputmode: 'decimal', max: 12, ph: rate ? String(rate) : '' })) + '</div>'
      + (uc ? '' : '<div class="ls-two">' + input('mode', 'How it came', d.mode, { max: 120 }) + input('utr', 'SWIFT or UTR number', d.utr, { max: 80 }) + '</div>')
      + '</div>');
    /* what it is for */
    out.push('<div class="fc-sec"><h4>The project</h4>' + input('project', 'Approved project or initiative', d.project, { max: 300, ph: 'Animal ambulance for PFA Khamgaon' }) + input('location', 'Where', d.location, { max: 200, ph: 'Khamgaon, Buldhana district, Maharashtra' }) + '</div>');
    if (uc) {
      out.push('<div class="fc-sec"><h4>The payments</h4>' + d.rows.map(function (r, i) {
        return '<div class="fc-row"><div class="ls-two">' + input('row-date-' + i, 'Date', r.date, { type: 'date' }) + input('row-amount-' + i, 'Amount paid (INR)', r.amount, { inputmode: 'decimal', max: 20 }) + '</div>'
          + input('row-vendor-' + i, 'Vendor or contractor, and GSTIN', r.vendor, { max: 200 })
          + input('row-desc-' + i, 'What was bought or done', r.desc, { max: 400 })
          + '<div class="ls-two">' + input('row-invoice-' + i, 'Invoice or bill no.', r.invoice, { max: 60 }) + input('row-payRef-' + i, 'Payment reference', r.payRef, { max: 80, ph: 'UTR or cheque number' }) + '</div>'
          + (d.rows.length > 1 ? '<div class="ls-acts"><button class="ghost" type="button" data-fc="row-del" data-i="' + i + '">Remove this payment</button></div>' : '') + '</div>';
      }).join('') + '<div class="ls-acts"><button class="ghost" type="button" data-fc="row-add">Add a payment</button></div><div class="fc-sum" data-fc-sum></div></div>');
    }
    /* the rest, under + */
    var wording = uc
      ? input('title', 'Title', d.title, { max: 120 }) + clausesBox(d.clauses)
        + '<span class="ls-k">Enclosures</span>' + d.enclosures.map(function (e, i) { return '<div class="fc-encl"><input type="checkbox" name="encl-on-' + i + '"' + (e.checked ? ' checked' : '') + ' aria-label="Enclosed"><label>Enclosure ' + (i + 1) + '<input name="encl-text-' + i + '" maxlength="300" value="' + esc(e.text) + '"></label></div>'; }).join('')
      : input('title', 'Title', d.title, { max: 120 }) + area('intro', 'Before the points', d.intro, 3) + clausesBox(d.clauses)
        + area('enclosure', 'The bank enclosure', d.enclosure, 3, 600) + '<label class="ls-check"><input type="checkbox" name="enclosed"' + (d.enclosed !== false ? ' checked' : '') + '><span>Ticked as enclosed</span></label>';
    out.push('<div class="fc-sec"><h4>Wording and details</h4>'
      + more('Wording', wording + '<div class="ls-acts"><button class="ghost" type="button" data-fc="wording-reset">Use the template’s wording</button></div>')
      + (uc ? '' : more('Bank accounts', input('bank', 'Designated FCRA bank', d.bank, { max: 240 }) + input('fcraAccount', 'FCRA account number', d.fcraAccount, { max: 40 })
        + input('utilBank', 'Utilization bank and branch (if moved there)', d.utilBank, { max: 240 }) + input('utilAccount', 'Utilization account number', d.utilAccount, { max: 40 })))
      + more('Headings and labels', labelsBox('lab-', F.kind, d.labels))
      + more('Signed by', '<div class="ls-two">' + input('signName', 'Name', d.signName, { max: 120 }) + input('signTitle', 'Designation', d.signTitle, { max: 120 }) + '</div>'
        + (uc ? '<label class="ls-check"><input type="checkbox" name="secondOn"' + (d.secondOn !== false ? ' checked' : '') + '><span>A second signature line</span></label>'
          + '<div class="ls-two">' + input('secondTitle', 'Its title', d.secondTitle, { max: 120 }) + input('secondName', 'Name (or leave for a hand signature)', d.secondName, { max: 120 }) + '</div>' : ''))
      + more('Signature, seal and letterhead', placesBox(v))
      + more('Registration line under the letterhead', input('office', 'Registered office', d.office, { max: 200 }) + '<div class="ls-two">' + input('fcraNo', 'FCRA registration number', d.fcraNo, { max: 40 }) + input('pan', 'PAN', d.pan, { max: 20 }) + '</div>')
      + '</div>');
    out.push('<label>Email it goes to<input type="email" name="email" maxlength="254" autocomplete="off" value="' + esc(v.email || '') + '" placeholder="The donor’s email, if it is to be sent"></label>');
    out.push('<div data-fc-issue></div><p class="rg-say" data-fc-say role="status" aria-live="polite"></p>');
    $('[data-fc-form]').innerHTML = out.join('');
    grow($('[data-fc-form]'));
    /* once more after layout settles, when the boxes have their real width */
    setTimeout(function () { grow($('[data-fc-form]')); }, 50);
    sums();
    issueBox();
  }

  function grow(root) {
    [].forEach.call((root || document).querySelectorAll('[data-fc] textarea.fc-grow'), function (t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; });
  }

  /* what the form says, into F.doc */
  function read() {
    var box = $('[data-fc-form]');
    if (!box) return;
    var v = F.doc, d = v.doc;
    var get = function (n) { var el = box.querySelector('[name="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    var take = function (n) { var x = get(n); if (x !== undefined) d[n] = x; };
    v.date = get('date') || v.date;
    v.email = (get('email') || '').trim();
    ['donorName', 'donorAka', 'donorStatus', 'donorAddress', 'donorCountry', 'sanctionRef', 'sanctionDate', 'receiptNo', 'currency', 'foreignAmount', 'inrAmount', 'rate', 'creditDate', 'mode', 'utr',
      'project', 'location', 'title', 'intro', 'enclosure', 'enclosed', 'bank', 'fcraAccount', 'utilBank', 'utilAccount', 'signName', 'signTitle', 'secondOn', 'secondTitle', 'secondName',
      'office', 'fcraNo', 'pan', 'periodFrom', 'periodTo', 'printedNo'].forEach(take);
    d.labels = d.labels || {};
    spec(F.kind).forEach(function (x) { var val = get('lab-' + x[0]); if (val !== undefined) d.labels[x[0]] = val; });
    d.clauses = d.clauses.map(function (c, i) { return { lead: get('clause-lead-' + i) != null ? get('clause-lead-' + i) : c.lead, text: get('clause-text-' + i) != null ? get('clause-text-' + i) : c.text }; });
    if (d.rows) d.rows = d.rows.map(function (r, i) { var o = {}; ['date', 'amount', 'vendor', 'desc', 'invoice', 'payRef'].forEach(function (k) { var x = get('row-' + k + '-' + i); o[k] = x != null ? x : r[k]; }); return o; });
    if (d.enclosures) d.enclosures = d.enclosures.map(function (e, i) { return { text: get('encl-text-' + i) != null ? get('encl-text-' + i) : e.text, checked: get('encl-on-' + i) != null ? get('encl-on-' + i) : e.checked }; });
    v.signed = get('signed') !== false; v.sealed = get('sealed') !== false;
    var L = {};
    Object.keys(F.ctx.setup.layout).forEach(function (k) { var x = get('L-' + k); L[k] = x != null ? Number(x) : (v.layout || {})[k]; });
    v.layout = L;
  }
  function body() { return { kind: F.kind, date: F.doc.date, doc: F.doc.doc, signed: F.doc.signed, sealed: F.doc.sealed, layout: F.doc.layout, email: F.doc.email }; }

  function sums() {
    var box = $('[data-fc-sum]');
    if (!box) return;
    var d = F.doc.doc;
    var used = (d.rows || []).reduce(function (s, r) { return s + (n2(r.amount) || 0); }, 0);
    used = Math.round(used * 100) / 100;
    var got = n2(d.inrAmount);
    var left = got != null ? Math.round((got - used) * 100) / 100 : null;
    box.innerHTML = '<span>Total paid: <b>INR ' + amt(used) + '</b></span>'
      + (got != null ? '<span>Received: <b>INR ' + amt(got) + '</b></span><span' + (left < 0 ? ' class="fc-warn"' : '') + '>' + (left < 0 ? 'More than received by: <b>INR ' + amt(-left) + '</b>' : 'Unexpended balance: <b>INR ' + amt(left) + '</b>') + '</span>' : '');
  }

  /* ---- the preview -------------------------------------------------------- */
  function preview(now) {
    clearTimeout(F.timer);
    F.timer = setTimeout(function () {
      var mine = ++F.ask;
      var pages = $('[data-ls-pages]'); if (pages) pages.textContent = 'Updating';
      api('/api/admin/letters', { method: 'POST', body: { action: 'preview', letter: body() } }).then(function (r) {
        if (mine !== F.ask) return undefined;
        say($('[data-fc-say]'), '', '');
        return window.PFALetters.draw(r.pdf);
      }).catch(function (e) {
        if (mine !== F.ask) return;
        var p = $('[data-ls-pages]'); if (p) p.textContent = '';
        say($('[data-fc-say]'), e.message, 'bad');
      });
    }, now ? 0 : 600);
  }
  function changed() { read(); store(DRAFT + F.kind, F.doc); F.issued = null; issueBox(); sums(); preview(false); }

  /* ---- issuing -------------------------------------------------------------- */
  function issueBox() {
    var box = $('[data-fc-issue]');
    if (!box) return;
    var what = F.kind === 'fc-receipt' ? 'receipt' : 'certificate';
    if (F.issued) {
      var l = F.issued;
      box.innerHTML = '<div class="ls-done"><p><b>Issued: ' + esc(l.number) + '</b>, to ' + esc(l.name) + '.' + (l.verifyUrl ? ' Anyone can check it is genuine at <a href="' + esc(l.verifyUrl) + '" target="_blank" rel="noopener">its public check</a>.' : '') + '</p>'
        + '<div class="ls-acts"><button class="press" type="button" data-fc="pdf" data-n="' + esc(l.number) + '">Download the PDF</button>'
        + '<button class="ghost" type="button" data-fc="email" data-n="' + esc(l.number) + '">Email it' + (F.doc.email ? ' to ' + esc(F.doc.email) : '') + '</button>'
        + '<button class="ghost" type="button" data-fc="new">Make another</button></div></div>';
      return;
    }
    box.innerHTML = '<div class="ls-acts"><button class="press" type="button" data-fc="issue">Issue the ' + what + '</button><button class="ghost" type="button" data-fc="new">Start again</button></div>'
      + '<p class="fc-note">It is given its reference and kept. It cannot be changed after; it can be withdrawn from the Letters list.</p>';
  }
  function issue(btn) {
    if (btn.getAttribute('data-sure') !== '1') {
      btn.setAttribute('data-sure', '1');
      btn.textContent = 'Issue it now? It cannot be changed after';
      setTimeout(function () { if (btn.isConnected && btn.getAttribute('data-sure') === '1') { btn.removeAttribute('data-sure'); issueBox(); } }, 6000);
      return;
    }
    btn.disabled = true;
    read();
    say($('[data-fc-say]'), 'Issuing...', '');
    api('/api/admin/letters', { method: 'POST', body: { action: 'issue', letter: body() } }).then(function (r) {
      F.issued = r.letter;
      F.ctx.onIssued(r.letter);
      F.ctx.letters = [r.letter].concat(F.ctx.letters || []);
      if (F.kind === 'fc-receipt') {
        var d = F.doc.doc;
        (F.ctx.setup.fc.receipts = F.ctx.setup.fc.receipts || []).unshift({ number: r.letter.number, date: F.doc.date, donorName: d.donorName, donorStatus: d.donorStatus, sanctionRef: d.sanctionRef, currency: d.currency, foreignAmount: n2(d.foreignAmount), inrAmount: n2(d.inrAmount), creditDate: d.creditDate, project: d.project, location: d.location });
      }
      /* the donor is kept by the server; the next form offers them */
      var dn = F.doc.doc;
      if (dn.donorName && !(F.tpl.donors || []).some(function (x) { return x.name === dn.donorName; })) F.tpl.donors.unshift({ name: dn.donorName, aka: dn.donorAka || '', status: dn.donorStatus || '', address: dn.donorAddress || '', country: dn.donorCountry || '' });
      store(DRAFT + F.kind, null);
      say($('[data-fc-say]'), 'Issued as ' + r.letter.number + '.', 'good');
      issueBox();
      list();
      window.PFALetters.draw(r.pdf);
    }).catch(function (e) {
      btn.disabled = false; btn.removeAttribute('data-sure'); issueBox();
      say($('[data-fc-say]'), e.message, 'bad');
      var f = e && e.data && e.data.field;
      var el = f ? $('[data-fc-form] [name="' + (f === 'rows' ? 'row-amount-0' : f) + '"]') : null;
      if (el) { var det = el.closest('details'); if (det) det.open = true; el.focus(); }
    });
  }
  function download(number, btn) {
    if (btn) btn.disabled = true;
    A.token().then(function (id) {
      return fetch('/api/admin/letters?number=' + encodeURIComponent(number) + '&format=pdf', { headers: { Authorization: 'Bearer ' + id } });
    }).then(function (r) { if (!r.ok) throw new Error('The PDF could not be read just now.'); return r.blob(); }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'PFA-' + (F.kind === 'fc-receipt' ? 'receipt' : 'utilization-certificate') + '-' + number + '.pdf'; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }).catch(function (e) { say($('[data-fc-say]'), e.message, 'bad'); }).then(function () { if (btn) btn.disabled = false; });
  }
  function email(number, btn) {
    var row = (F.ctx.letters || []).filter(function (l) { return l.number === number; })[0] || {};
    var to = (F.issued && F.issued.number === number ? F.doc.email : '') || row.email || '';
    if (!to) { say($('[data-fc-say]'), 'Type the email it goes to in the form, then press Email it.', 'bad'); var el = $('[data-fc-form] [name="email"]'); if (el) el.focus(); return; }
    if (!window.confirm('Email ' + number + ' to ' + to + ', with the PDF attached?')) return;
    btn.disabled = true;
    api('/api/admin/letters', { method: 'POST', body: { action: 'email', number: number, email: to } }).then(function (r) {
      say($('[data-fc-say]'), (r.state === 'sent' ? 'Sent to ' : 'Queued for ') + r.to + '.' + (r.reason ? ' ' + r.reason : ''), r.state === 'sent' ? 'good' : '');
      F.ctx.letters = (F.ctx.letters || []).map(function (l) { return l.number === number ? r.letter : l; });
      list();
    }).catch(function (e) { say($('[data-fc-say]'), e.message, 'bad'); }).then(function () { btn.disabled = false; });
  }
  function list() {
    var box = $('[data-fc-list]');
    if (!box) return;
    var rows = (F.ctx.letters || []).filter(function (l) { return l.kind === F.kind; });
    if (!rows.length) { box.innerHTML = '<p class="ls-off" style="font-size:14px">None yet. The first one issued is listed here.</p>'; return; }
    box.innerHTML = '<table class="ls-table"><thead><tr><th>Reference</th><th>Donor</th><th>Dated</th><th>Emailed</th><th></th></tr></thead><tbody>' + rows.map(function (l) {
      return '<tr' + (l.withdrawn ? ' class="ls-off"' : '') + '><td>' + esc(l.number) + '</td><td>' + esc(l.name) + '</td><td>' + esc(l.date) + '</td><td>' + esc(l.sent ? (l.sent.state === 'sent' ? 'Sent to ' : 'Queued for ') + l.sent.to : 'Not yet') + '</td>'
        + '<td><div class="ls-acts"><button class="ghost" type="button" data-fc="pdf" data-n="' + esc(l.number) + '">PDF</button>' + (l.withdrawn ? '' : '<button class="ghost" type="button" data-fc="email" data-n="' + esc(l.number) + '">Email</button>') + '</div></td></tr>';
    }).join('') + '</tbody></table>';
  }

  /* ---- + Edit the template ------------------------------------------------ */
  function templateBox() {
    var t = F.tpl, o = t.org;
    var clauseEd = function (prefix, list) {
      return list.map(function (c, i) { return '<div class="fc-clause">' + input(prefix + '-lead-' + i, 'Point ' + (i + 1) + ', in bold', c.lead, { max: 120 }) + area(prefix + '-text-' + i, 'Its words', c.text, 3) + '</div>'; }).join('');
    };
    var inner = '<p class="fc-note">Changes here are used for every document made after. One already issued keeps what it was issued with.' + (t.updatedAt ? ' Last changed ' + esc(new Date(t.updatedAt).toLocaleString('en-IN')) + (t.updatedBy ? ' by ' + esc(t.updatedBy) : '') + '.' : '') + '</p>'
      + '<span class="ls-k">PFA</span>' + input('t-office', 'Registered office', o.office, { max: 200 })
      + '<div class="ls-two">' + input('t-fcraNo', 'FCRA registration number', o.fcraNo, { max: 40 }) + input('t-pan', 'PAN', o.pan, { max: 20 }) + '</div>'
      + input('t-bank', 'Designated FCRA bank', o.bank, { max: 200 }) + input('t-fcraAccount', 'FCRA account number', o.fcraAccount, { max: 40 })
      + '<div class="ls-two">' + input('t-signName', 'Signed by', o.signName, { max: 120 }) + input('t-signTitle', 'Designation', o.signTitle, { max: 120 }) + '</div>'
      + '<span class="ls-k">Receipt</span>' + input('t-r-title', 'Title', t.receipt.title, { max: 120 }) + area('t-r-intro', 'Before the points', t.receipt.intro, 3) + clauseEd('t-rc', t.receipt.clauses) + area('t-r-encl', 'The bank enclosure', t.receipt.enclosure, 3, 600)
      + '<span class="ls-k">Utilization certificate</span>' + input('t-u-title', 'Title', t.uc.title, { max: 120 }) + clauseEd('t-uc', t.uc.clauses)
      + t.uc.enclosures.map(function (e, i) { return input('t-u-encl-' + i, 'Enclosure ' + (i + 1), e, { max: 300 }); }).join('')
      + input('t-u-second', 'Second signature line', t.uc.secondLabel, { max: 120 })
      + more('Receipt: headings and labels', labelsBox('t-lab-r-', 'fc-receipt', (t.labels || {}).receipt))
      + more('Utilization certificate: headings and labels', labelsBox('t-lab-u-', 'fc-uc', (t.labels || {}).uc))
      + '<span class="ls-k">Donors</span>' + (t.donors.length ? t.donors.map(function (x, i) { return '<div class="fc-clause">' + input('t-d-name-' + i, 'Legal name', x.name, { max: 160 }) + input('t-d-aka-' + i, 'Also known as', x.aka, { max: 120 }) + input('t-d-status-' + i, 'Legal status and tax ID', x.status, { max: 200 }) + input('t-d-address-' + i, 'Registered address', x.address, { max: 300 }) + input('t-d-country-' + i, 'Country', x.country, { max: 80 }) + '<div class="ls-acts"><button class="ghost" type="button" data-fc="donor-del" data-i="' + i + '">Remove this donor</button></div></div>'; }).join('') : '<p class="fc-note">None yet. A donor is kept here when a document is issued for them.</p>')
      + '<div class="ls-acts"><button class="press" type="button" data-fc="tpl-save">Save the template</button><button class="ghost" type="button" data-fc="tpl-reset">Put back the original wording</button></div><p class="rg-say" data-fc-tsay role="status" aria-live="polite"></p>';
    return '<div class="fc-tpl" data-fc-tpl>' + more('Edit the template', '<div class="ls-form">' + inner + '</div>') + '</div>';
  }
  function readTemplate() {
    var box = $('[data-fc-tpl]');
    var get = function (n) { var el = box.querySelector('[name="' + n + '"]'); return el ? el.value : undefined; };
    var t = clone(F.tpl);
    ['office', 'fcraNo', 'pan', 'bank', 'fcraAccount', 'signName', 'signTitle'].forEach(function (k) { var x = get('t-' + k); if (x !== undefined) t.org[k] = x; });
    t.receipt.title = get('t-r-title'); t.receipt.intro = get('t-r-intro'); t.receipt.enclosure = get('t-r-encl');
    t.receipt.clauses = t.receipt.clauses.map(function (c, i) { return { lead: get('t-rc-lead-' + i), text: get('t-rc-text-' + i) }; });
    t.uc.title = get('t-u-title'); t.uc.secondLabel = get('t-u-second');
    t.uc.clauses = t.uc.clauses.map(function (c, i) { return { lead: get('t-uc-lead-' + i), text: get('t-uc-text-' + i) }; });
    t.uc.enclosures = t.uc.enclosures.map(function (e, i) { return get('t-u-encl-' + i); });
    t.labels = { receipt: {}, uc: {} };
    spec('fc-receipt').forEach(function (x) { var v = get('t-lab-r-' + x[0]); t.labels.receipt[x[0]] = v != null ? v : x[1]; });
    spec('fc-uc').forEach(function (x) { var v = get('t-lab-u-' + x[0]); t.labels.uc[x[0]] = v != null ? v : x[1]; });
    t.donors = t.donors.map(function (x, i) { return { name: get('t-d-name-' + i), aka: get('t-d-aka-' + i), status: get('t-d-status-' + i), address: get('t-d-address-' + i), country: get('t-d-country-' + i) }; });
    return t;
  }
  function saveTemplate(action, t, btn) {
    btn.disabled = true;
    say($('[data-fc-tsay]'), 'Saving...', '');
    api('/api/admin/letters', { method: 'POST', body: { action: action, template: t } }).then(function (r) {
      F.tpl = F.ctx.setup.fc.template = r.template;
      var open = true;
      $('[data-fc-tpl]').outerHTML = templateBox();
      var det = $('[data-fc-tpl] details'); if (det) det.open = open;
      say($('[data-fc-tsay]'), action === 'fc-template-reset' ? 'The original wording is back. New documents use it.' : 'Saved. New documents use it; press Use the template’s wording to bring it into this one.', 'good');
    }).catch(function (e) { btn.disabled = false; say($('[data-fc-tsay]'), e.message, 'bad'); });
  }

  /* ---- what the view does --------------------------------------------------- */
  function inside(t) { return t && t.closest && t.closest('[data-fc]'); }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (inside(t) && t.classList.contains('fc-grow')) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
    if (!inside(t) || t.closest('[data-fc-tpl]')) return;
    if (t.type === 'range') { var o = $('[data-fc-out="' + t.name.slice(2) + '"]'); var spec = F.ctx.setup.layout[t.name.slice(2)]; if (o && spec) o.textContent = t.value + ' ' + spec.unit; }
    changed();
  });
  window.addEventListener('resize', function () { if ($('[data-fc]')) grow(); });
  document.addEventListener('toggle', function (e) { if (inside(e.target) && e.target.open) grow(e.target); }, true);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!inside(t) || t.closest('[data-fc-tpl]')) return;
    if (t.hasAttribute('data-fc-donor')) {
      read();
      var d = F.doc.doc, x = F.tpl.donors[Number(t.value)];
      if (x) { d.donorName = x.name; d.donorAka = x.aka; d.donorStatus = x.status; d.donorAddress = x.address; d.donorCountry = x.country; }
      else { d.donorName = ''; d.donorAka = ''; d.donorStatus = ''; d.donorAddress = ''; d.donorCountry = ''; }
      form(); store(DRAFT + F.kind, F.doc); preview(false);
      if (!x) { var n = $('[data-fc-form] [name="donorName"]'); if (n) n.focus(); }
      return;
    }
    if (t.hasAttribute('data-fc-receipt')) {
      read();
      var r = (F.ctx.setup.fc.receipts || []).filter(function (z) { return z.number === t.value; })[0];
      if (r) {
        var dd = F.doc.doc;
        dd.receiptNo = r.number; dd.donorName = r.donorName; dd.donorStatus = r.donorStatus; dd.sanctionRef = r.sanctionRef || dd.sanctionRef;
        dd.currency = r.currency || 'USD'; dd.foreignAmount = r.foreignAmount != null ? String(r.foreignAmount) : ''; dd.inrAmount = r.inrAmount != null ? String(r.inrAmount) : '';
        dd.creditDate = r.creditDate || ''; dd.project = r.project || dd.project; dd.location = r.location || dd.location;
        if (!dd.periodFrom && r.creditDate) dd.periodFrom = r.creditDate;
        form(); store(DRAFT + F.kind, F.doc); preview(false);
      }
      return;
    }
    if (t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'date') changed();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fc] button[data-fc]');
    if (!b) return;
    var what = b.getAttribute('data-fc'), i = Number(b.getAttribute('data-i'));
    if (what === 'tpl-save') return saveTemplate('fc-template', readTemplate(), b);
    if (what === 'tpl-reset') { if (window.confirm('Put back the original wording and PFA details? The donors are kept.')) saveTemplate('fc-template-reset', null, b); return; }
    if (what === 'donor-del') { var t = readTemplate(); t.donors.splice(i, 1); F.tpl = t; $('[data-fc-tpl]').outerHTML = templateBox(); $('[data-fc-tpl] details').open = true; say($('[data-fc-tsay]'), 'Removed here. Press Save the template to keep it removed.', ''); return; }
    if (what === 'issue') return issue(b);
    if (what === 'pdf') return download(b.getAttribute('data-n'), b);
    if (what === 'email') return email(b.getAttribute('data-n'), b);
    if (what === 'new') { store(DRAFT + F.kind, null); F.issued = null; F.doc = { doc: fresh(F.kind), date: F.ctx.setup.today, signed: true, sealed: true, layout: places(), email: '' }; form(); preview(true); return; }
    read();
    var d = F.doc.doc;
    if (what === 'clause-add') d.clauses.push({ lead: '', text: '' });
    else if (what === 'clause-del') d.clauses.splice(i, 1);
    else if (what === 'row-add') d.rows.push({ date: '', vendor: '', invoice: '', desc: '', payRef: '', amount: '' });
    else if (what === 'row-del') d.rows.splice(i, 1);
    else if (what === 'places') F.doc.layout = places();
    else if (what === 'wording-reset') {
      var f = fresh(F.kind);
      ['title', 'intro', 'clauses', 'enclosure', 'enclosures', 'secondTitle', 'labels'].forEach(function (k) { if (f[k] !== undefined) d[k] = f[k]; });
    } else return;
    var openNow = [].map.call($('[data-fc-form]').querySelectorAll('details'), function (x) { return x.open; });
    form();
    [].forEach.call($('[data-fc-form]').querySelectorAll('details'), function (x, k) { if (openNow[k]) x.open = true; });
    changed();
  });

  window.PFAFcDocs = { show: show };
}());
