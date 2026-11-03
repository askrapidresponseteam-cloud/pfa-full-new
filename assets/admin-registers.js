/* People for Animals - the registers in the admin panel (admin.html).
   ------------------------------------------------------------------------
   The colony card applications and the members, one line each, as the
   office keeps them in its own sheets (owner, 2 Nov 2026), from
   /api/admin/registers (lib/routes/admin/registers.js). Kept in its own
   file so admin.html stays under the page-weight ceiling; it uses the
   panel's own helpers, which admin.html puts on window.PFAAdmin, and the
   panel calls PFARegisters.pane(kind) when the tab opens.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api, token = A.token, on = A.on;

  /* The registers: the colony card applications and the members, one line
     each, as the office keeps them in its own sheets, and only what the
     website captured. Every item is a button that copies itself; Copy row
     puts the line on the clipboard as cells, so it pastes into Google Sheets
     or Excel across the columns; Export downloads it all as a CSV (logged).
     Shipping, on each line: the status, the courier and the tracking number,
     saved to the application; then the standard letter to the person, one
     or many, always previewed first, one card per letter (owner, 2 Nov 2026).
     Green: shipped or delivered. */
  var REG = {
    caregiver: {
      pane: 'cgsheet', noun: 'applications', todo: 'Not shipped', done: 'Shipped', file: 'colony-cards',
      cols: [
        ['Name', function (r) { return [[r.name]]; }, 'rg-name'],
        ['Phone number', function (r) { return [[r.mobile], r.altMobile ? [r.altMobile, 'other'] : null]; }, 'rg-nw'],
        ['Address', function (r) { return [[r.lines.join('\n')]]; }, 'rg-addr'],
        ['Application', function (r) { return [[r.id], r.cardId ? [r.cardId, 'card'] : null, r.appliedOn ? [r.appliedOn, 'sub'] : null]; }, 'rg-nw'],
        ['District / State', function (r) { return [[r.district], [r.state]]; }]
      ]
    },
    membership: {
      pane: 'memsheet', noun: 'members', todo: 'Not shipped', done: 'Shipped', file: 'members',
      cols: [
        ['Name / number / email', function (r) { return [[r.name], [r.mobile], r.altMobile ? [r.altMobile, 'other'] : null, [r.email]]; }, 'rg-name'],
        /* the state member number (lib/member-numbers.js); the reference under it */
        ['Member number', function (r) { return [r.memberNo ? [r.memberNo] : ['Not yet', 'sub'], r.numberHold ? [r.numberHold, 'sub'] : null, [r.id, 'sub']]; }, 'rg-nw'],
        ['Address', function (r) { return [[r.lines.join('\n')]]; }, 'rg-addr'],
        ['Membership type', function (r) { return [[r.type], r.amount ? [r.amount, 'sub'] : null, r.cardId ? [r.cardId, 'card'] : null]; }],
        ['Date', function (r) { return [[r.paidOn]]; }, 'rg-nw']
      ]
    }
  };
  var SHIP_LABELS = { processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned to sender' };
  var regState = { caregiver: { rows: [], q: '', show: 'all', picked: {} }, membership: { rows: [], q: '', show: 'all', picked: {} } };

  function registerPane(kind) {
    var spec = REG[kind];
    var box = $('[data-pane="' + spec.pane + '"]');
    if (!box) return;
    api('/api/admin/registers?kind=' + kind).then(function (d) {
      regState[kind].rows = d.rows || [];
      regState[kind].numbers = d.numbers || null;
      regState[kind].picked = {};
      paintRegister(kind);
    }).catch(function (e) { box.innerHTML = '<div class="empty"><b>Could not read the register</b>' + esc(e.message) + '</div>'; });
  }

  function regRows(kind) {
    var st = regState[kind];
    var q = st.q.trim().toLowerCase();
    return st.rows.filter(function (r) {
      if (st.show === 'todo' && r.done) return false;
      if (st.show === 'done' && !r.done) return false;
      if (!q) return true;
      return [r.name, r.mobile, r.altMobile, r.email, r.id, r.memberNo, r.cardId, r.lines.join(' '), r.district, r.state, r.type, r.courier, r.tracking].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function regPickedIds(kind) { var p = regState[kind].picked; return Object.keys(p).filter(function (k) { return p[k]; }); }

  function paintRegister(kind) {
    var spec = REG[kind];
    var st = regState[kind];
    var box = $('[data-pane="' + spec.pane + '"]');
    var all = st.rows;
    var nDone = all.filter(function (r) { return r.done; }).length;
    var seg = [['all', 'All', all.length], ['todo', spec.todo, all.length - nDone], ['done', spec.done, nDone]];
    box.innerHTML = '<div class="rg-tools">'
      + '<input type="search" data-rg="q" placeholder="Find a name, phone, email, number or place" aria-label="Find in the register" value="' + esc(st.q) + '">'
      + '<span class="rg-seg" role="group" aria-label="Show">' + seg.map(function (x) { return '<button type="button" data-rg-show="' + x[0] + '" aria-pressed="' + (st.show === x[0]) + '">' + esc(x[1]) + ' ' + x[2] + '</button>'; }).join('') + '</span>'
      + '<button class="press" type="button" data-rg="mailpicked" disabled>Preview emails</button>'
      + '<button class="ghost" type="button" data-rg="copyall">Copy table</button>'
      + '<button class="ghost" type="button" data-rg="csv">Export to Excel</button>'
      + '</div><p class="rg-hint">Click any item to copy it. Set the status, the courier and the tracking number; Preview email lights up when the line is complete, saves it, and shows the email before it goes. Tick several and Preview emails does the same for every ready line. Green rows are shipped.</p>'
      + '<datalist id="rgCouriers-' + kind + '">' + COURIERS.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>'
      + (kind === 'membership' ? numbersHtml(st) : '')
      + '<p class="rg-say" data-rg-say role="status" aria-live="polite"></p>'
      + '<div class="wrap"><table><thead><tr><th class="rg-nw"><label class="rg-pick"><input type="checkbox" data-rg="pickall" aria-label="Select every line shown"></label></th>' + spec.cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '<th>Shipping</th></tr></thead><tbody data-rg-body></tbody></table></div>';
    paintRegisterRows(kind);
  }

  /* Member numbers (owner, 3 Nov 2026: "enterprise grade numbering-
     statewise and ensure that no 2 members ever get same number, old , new
     and future"): every series, its last number and the next; the members
     not numbered yet and why; and what the old lists left for PFA to check.
     Folded: one line until opened. */
  function numbersHtml(st) {
    var n = st.numbers;
    if (!n) return '';
    var held = st.rows.filter(function (r) { return !r.memberNo; });
    var rep = n.oldReport || {};
    var check = (rep.unplacedCount || 0) + (rep.sharedByTwoCount || 0) + (rep.takenByNewCount || 0);
    var used = n.series.filter(function (x) { return x.last; });
    var line = function (t) { return '<li>' + esc(t) + '</li>'; };
    return '<details class="rg-nums"><summary>Member numbers: ' + used.length + ' series in use'
      + (held.length ? ' · ' + held.length + ' not numbered yet' : '') + (check ? ' · ' + check + ' old numbers to check' : '') + '</summary>'
      + '<p class="rg-hint">A member number is the state code and a number, given once from the state on the membership, the moment the payment succeeds. AP and TG, UP and UK, and MP and CG each share one count. No number is ever given twice: every old number from the old site lists is held first, and each count starts past the highest old number in it.</p>'
      + (held.length ? '<p class="rg-hint"><b>Not numbered yet</b></p><ul class="rg-list">' + held.map(function (r) { return line(r.name + ' (' + r.id + '): ' + (r.numberHold || 'waiting for the next run, every few minutes')); }).join('') + '</ul>' : '')
      + '<div class="wrap"><table><thead><tr><th>Series</th><th>States</th><th>Last given</th><th>Next</th></tr></thead><tbody>'
      + n.series.map(function (x) { return '<tr><td>' + esc(x.series) + '</td><td>' + esc(x.states.map(function (s) { return s.code + ' ' + s.state; }).join(', ')) + '</td><td>' + (x.last || '') + '</td><td>' + esc(x.states[0].code + ' ' + x.next) + (x.states.length > 1 ? ' (or ' + esc(x.states.slice(1).map(function (s) { return s.code; }).join(', ')) + ')' : '') + '</td></tr>'; }).join('')
      + '</tbody></table></div>'
      + (rep.unplacedCount ? '<p class="rg-hint"><b>Old numbers with no state (' + rep.unplacedCount + ')</b>: held nowhere, so give each a state code on the old site members page.</p><ul class="rg-list">' + (rep.unplaced || []).map(function (x) { return line(x.why); }).join('') + '</ul>' : '')
      + (rep.sharedByTwoCount ? '<p class="rg-hint"><b>Old numbers held by two different people (' + rep.sharedByTwoCount + ')</b>: never given again; decide whose it is on the old site members page.</p><ul class="rg-list">' + (rep.sharedByTwo || []).map(function (x) { return line(x.label + ': ' + x.people + ' people'); }).join('') + '</ul>' : '')
      + (rep.takenByNewCount ? '<p class="rg-hint"><b>Old numbers a new member already holds (' + rep.takenByNewCount + ')</b>: added to the old lists after the new number was given; the new member keeps it, so give the old one another.</p><ul class="rg-list">' + (rep.takenByNew || []).map(function (x) { return line(x.label + ': ' + x.reference); }).join('') + '</ul>' : '')
      + (n.oldSyncedAt ? '<p class="rg-hint">Old site lists last read ' + esc(String(n.oldSyncedAt).slice(0, 16).replace('T', ' ')) + ' UTC.</p>' : '<p class="rg-hint">The old site lists have not been read yet: they are, before the first number is given.</p>')
      + '</details>';
  }

  function regShipHtml(kind, r) {
    return '<div class="rg-ship">'
      + '<select data-f="ship" aria-label="Status">' + '<option value="">Status not set</option>' + Object.keys(SHIP_LABELS).map(function (k) { return '<option value="' + k + '"' + (r.ship === k ? ' selected' : '') + '>' + esc(SHIP_LABELS[k]) + '</option>'; }).join('') + '</select>'
      + '<input data-f="courier" maxlength="60" placeholder="Courier" aria-label="Courier" list="rgCouriers-' + kind + '" autocomplete="off" value="' + esc(r.courier || '') + '">'
      + '<input data-f="tracking" maxlength="40" placeholder="Tracking number" aria-label="Tracking number" autocomplete="off" spellcheck="false" value="' + esc(r.tracking || '') + '">'
      + '<span class="rg-why" data-rg-why></span>'
      + '<span class="rg-acts"><button type="button" class="rg-row" data-rg="save" disabled>Save</button><button type="button" class="rg-row" data-rg="mail" disabled>Preview email</button></span>'
      + (r.emailed ? '<span class="rg-sub rg-last">Emailed: ' + esc(r.emailed) + '</span>' : '')
      + '</div>';
  }

  /* What a line needs before its letter can go (owner, 2 Nov 2026: "email
     button should highlight only when all fields are filled for that
     particular entry. and valid entries only., be smart"): a status; for
     Shipped, Delivered and Returned also the courier and a tracking number
     in its courier's shape (India Post's is EE123456789IN); and an email
     address on the application. The server holds the same rules. */
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var INDIA_POST = /india\s*post|speed\s*post|registered\s*post|\bepost\b/i;
  var COURIERS = ['India Post', 'Speed Post', 'DTDC', 'Blue Dart', 'Delhivery', 'Professional Couriers', 'Ekart', 'Xpressbees', 'Shadowfax', 'Shree Maruti Courier', 'Trackon', 'Gati', 'DHL'];
  function trackOf(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }
  function regCheckValues(v, r) {
    var bad = {};
    var why = '';
    var need = v.ship && v.ship !== 'processing';
    if (!v.ship) { bad.ship = true; why = 'Choose a status.'; }
    if (need && v.courier.length < 2) { bad.courier = true; why = why || 'Add the courier.'; }
    if (need && !v.tracking) { bad.tracking = true; why = why || 'Add the tracking number.'; }
    else if (v.tracking && INDIA_POST.test(v.courier) && !/^[A-Z]{2}\d{9}IN$/.test(v.tracking)) { bad.tracking = true; why = why || 'An India Post number looks like EE123456789IN: 2 letters, 9 digits, then IN.'; }
    else if (v.tracking && !/^[A-Z0-9-]{4,40}$/.test(v.tracking)) { bad.tracking = true; why = why || 'A tracking number is 4 to 40 letters and digits.'; }
    var valid = !bad.ship && !bad.courier && !bad.tracking;
    var mailable = EMAIL_OK.test(r.email || '');
    if (valid && !mailable) why = 'No email address on the application, so no email can go.';
    return { ship: v.ship, courier: v.courier, tracking: v.tracking, bad: bad, why: why, valid: valid, ready: valid && mailable };
  }
  function regValues(tr) {
    var v = function (f) { var el = tr.querySelector('[data-f="' + f + '"]'); return el ? el.value.replace(/\s+/g, ' ').trim() : ''; };
    return { ship: v('ship'), courier: v('courier'), tracking: trackOf(v('tracking')) };
  }
  function regCheck(tr, r) { return regCheckValues(regValues(tr), r); }
  function regCheckSaved(r) { return regCheckValues({ ship: r.ship || '', courier: r.courier || '', tracking: r.tracking || '' }, r); }

  /* the line's buttons and marks, from what is typed now: Save when there is
     something valid to save, Preview email lit only when the line is ready;
     a field is marked wrong once someone has worked on the line */
  function regSync(kind, tr) {
    var r = regRow(kind, tr.getAttribute('data-rg-id'));
    if (!r) return;
    var c = regCheck(tr, r);
    var touched = tr.hasAttribute('data-touched');
    var save = tr.querySelector('[data-rg="save"]');
    var mail = tr.querySelector('[data-rg="mail"]');
    if (save) save.disabled = !(regDirty(tr, r) && c.valid);
    if (mail) { mail.disabled = !c.ready; mail.classList.toggle('is-ready', c.ready); mail.title = c.ready ? 'Save if needed, then see the email before it goes' : c.why; }
    ['ship', 'courier', 'tracking'].forEach(function (f) {
      var el = tr.querySelector('[data-f="' + f + '"]');
      if (el) el.setAttribute('aria-invalid', touched && c.bad[f] ? 'true' : 'false');
    });
    var why = tr.querySelector('[data-rg-why]');
    if (why) { why.textContent = c.ready ? '' : c.why; why.classList.toggle('is-bad', touched && !c.ready); }
  }
  function regRow(kind, id) { return regState[kind].rows.filter(function (x) { return x.id === id; })[0] || null; }

  function regRowHtml(kind, r) {
    var spec = REG[kind];
    return '<tr' + (r.done ? ' class="rg-done"' : '') + ' data-rg-id="' + esc(r.id) + '">'
      + '<td class="rg-nw"><label class="rg-pick"><input type="checkbox" data-rg="pick" aria-label="Select ' + esc(r.name) + '"' + (regState[kind].picked[r.id] ? ' checked' : '') + '></label><button type="button" class="rg-row" data-rg="row">Copy row</button></td>'
      + spec.cols.map(function (c) {
        return '<td' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + c[1](r).filter(function (x) { return x && x[0]; }).map(function (x) {
          return '<button type="button" class="rg-c' + (x[1] ? ' rg-sub' : '') + '" data-copy="' + esc(x[0]) + '" title="Copy">' + (x[1] === 'other' ? 'Other: ' : x[1] === 'card' ? 'Card ' : '') + esc(x[0]) + '</button>';
        }).join('') + '</td>';
      }).join('')
      + '<td>' + regShipHtml(kind, r) + '</td></tr>';
  }

  function paintRegisterRows(kind) {
    var spec = REG[kind];
    var box = $('[data-pane="' + spec.pane + '"]');
    var body = box.querySelector('[data-rg-body]');
    var rows = regRows(kind);
    body.innerHTML = rows.length ? rows.map(function (r) { return regRowHtml(kind, r); }).join('')
      : '<tr><td class="rg-empty" colspan="' + (spec.cols.length + 2) + '">' + (regState[kind].rows.length ? 'Nothing matches.' : 'No ' + spec.noun + ' yet.') + '</td></tr>';
    [].forEach.call(body.querySelectorAll('tr[data-rg-id]'), function (tr) { regSync(kind, tr); });
    regPickCount(kind);
  }

  /* the ticked lines that are ready, read from the screen where the line is
     shown (what is typed now) and from what is saved where it is not */
  function regPickedReady(kind) {
    var box = $('[data-pane="' + REG[kind].pane + '"]');
    return regPickedIds(kind).filter(function (id) {
      var r = regRow(kind, id);
      if (!r) return false;
      var tr = box.querySelector('tr[data-rg-id="' + id + '"]');
      return (tr ? regCheck(tr, r) : regCheckSaved(r)).ready;
    });
  }
  function regPickCount(kind) {
    var box = $('[data-pane="' + REG[kind].pane + '"]');
    var picked = regPickedIds(kind).length;
    var ready = regPickedReady(kind).length;
    var b = box.querySelector('[data-rg="mailpicked"]');
    if (!b) return;
    b.disabled = !ready;
    b.textContent = ready ? 'Preview emails (' + ready + ')' : 'Preview emails';
    b.title = picked > ready ? (picked - ready) + ' of the ' + picked + ' ticked are not ready yet; each line says what it needs.' : '';
  }

  /* save one line from what is typed; resolves once it is kept */
  function regSave(kind, tr) {
    var id = tr.getAttribute('data-rg-id');
    var row = regRow(kind, id);
    var c = regCheck(tr, row);
    if (!c.valid) return Promise.reject(new Error(row.name + ': ' + c.why));
    return api('/api/admin/registers', { method: 'POST', body: { action: 'save', kind: kind, id: id, status: c.ship, courier: c.courier, trackingNumber: c.tracking } }).then(function () {
      row.ship = c.ship; row.shipLabel = SHIP_LABELS[row.ship] || ''; row.courier = c.courier; row.tracking = c.tracking;
      row.done = row.ship === 'shipped' || row.ship === 'delivered';
      var fresh = document.createElement('tbody');
      fresh.innerHTML = regRowHtml(kind, row);
      var tr2 = fresh.firstChild;
      tr.parentNode.replaceChild(tr2, tr);
      regSync(kind, tr2);
      return row;
    });
  }

  /* text for a sheet: one line per row, a tab between cells; a cell with a
     line break is quoted, as Sheets and Excel read it. With it, the same
     rows as an HTML table, which Sheets prefers. Shipping goes as three
     columns: status, courier, tracking number. */
  function regHead(kind) { return REG[kind].cols.map(function (c) { return c[0]; }).concat(['Status', 'Courier', 'Tracking number']); }
  function regCells(kind, r) {
    return REG[kind].cols.map(function (c) { return c[1](r).filter(function (x) { return x && x[0]; }).map(function (x) { return (x[1] === 'other' ? 'Other: ' : x[1] === 'card' ? 'Card ' : '') + x[0]; }).join('\n'); })
      .concat([r.shipLabel || '', r.courier || '', r.tracking || '']);
  }
  function regClip(kind, rows, header) {
    var lines = (header ? [regHead(kind)] : []).concat(rows.map(function (r) { return regCells(kind, r); }));
    var text = lines.map(function (cells) { return cells.map(function (v) { return /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join('\t'); }).join('\n');
    var html = '<table>' + lines.map(function (cells, i) { var t = header && i === 0 ? 'th' : 'td'; return '<tr>' + cells.map(function (v) { return '<' + t + '>' + esc(v).replace(/\n/g, '<br>') + '</' + t + '>'; }).join('') + '</tr>'; }).join('') + '</table>';
    return copyText(text, html);
  }
  function copyText(text, html) {
    try {
      if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        return navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).catch(function () { return navigator.clipboard.writeText(text); });
      }
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    } catch (_) { /* the fallback below */ }
    var t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    t.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('This browser would not copy. Select the text and copy it instead.'));
  }

  /* a line whose fields differ from what is saved */
  function regDirty(tr, r) {
    var v = regValues(tr);
    return v.ship !== (r.ship || '') || v.courier !== (r.courier || '') || v.tracking !== (r.tracking || '');
  }

  /* The letters, before they go: one card each, as the person will read it,
     with who it goes to and the subject; a line that cannot be sent says
     why. Send sends exactly these (the server checks the preview token). */
  function regPreview(kind, ids) {
    var box = $('[data-pane="' + REG[kind].pane + '"]');
    var said = box.querySelector('[data-rg-say]');
    /* lines with changes not yet kept are saved first, so the email shows
       what is on record */
    var dirty = ids.map(function (id) { return box.querySelector('tr[data-rg-id="' + id + '"]'); })
      .filter(function (tr) { return tr && regDirty(tr, regRow(kind, tr.getAttribute('data-rg-id'))); });
    say(said, dirty.length ? 'Saving, then making the preview...' : 'Making the preview...', '');
    dirty.reduce(function (p, tr) { return p.then(function () { return regSave(kind, tr); }); }, Promise.resolve()).then(function () {
      return api('/api/admin/registers', { method: 'POST', body: { action: 'preview', kind: kind, ids: ids } });
    }).then(function (d) {
      say(said, '');
      var items = d.items || [];
      var good = items.filter(function (x) { return x.ok; });
      var dlg = $('#rgMail');
      dlg.innerHTML = '<div class="rgm-head"><h3>' + (good.length === 1 ? 'Check this email before it goes' : 'Check these ' + good.length + ' emails before they go') + '</h3>'
        + '<p class="rgm-sub">Each card is one email, exactly as the person will get it.' + (items.length > good.length ? ' ' + (items.length - good.length) + ' cannot be sent; each says why.' : '') + '</p></div>'
        + '<div class="rgm-cards">' + items.map(function (x) {
          return '<article class="rgm-card' + (x.ok ? '' : ' rgm-card--no') + '">'
            + '<p class="rgm-to"><b>' + esc(x.name || x.id) + '</b><span>' + esc(x.to || 'No email address') + '</span></p>'
            + (x.ok ? '<p class="rgm-subj">' + esc(x.subject) + '</p><iframe class="rgm-frame" sandbox="" title="' + esc('Email to ' + (x.name || x.to)) + '" srcdoc="' + esc(x.html) + '"></iframe>'
              : '<p class="rgm-why">' + esc(x.problem) + '</p>')
            + '</article>';
        }).join('') + '</div>'
        + '<div class="rgm-foot"><p class="rg-say" data-rgm-say role="status" aria-live="polite"></p><button class="ghost" type="button" data-rgm="cancel">Cancel</button>'
        + (good.length ? '<button class="press" type="button" data-rgm="send">Send ' + (good.length === 1 ? 'this email' : good.length + ' emails') + '</button>' : '') + '</div>';
      dlg.setAttribute('data-kind', kind);
      dlg.setAttribute('data-token', d.token || '');
      dlg.setAttribute('data-ids', JSON.stringify(ids));
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    }).catch(function (err) { say(said, err.message, 'bad'); });
  }

  on('#rgMail', 'click', function (e) {
    var dlg = $('#rgMail');
    var b = e.target.closest && e.target.closest('[data-rgm]');
    if (!b) return;
    if (b.getAttribute('data-rgm') === 'cancel') { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); return; }
    var kind = dlg.getAttribute('data-kind');
    var said = dlg.querySelector('[data-rgm-say]');
    b.disabled = true;
    say(said, 'Sending...', '');
    api('/api/admin/registers', { method: 'POST', body: { action: 'send', kind: kind, ids: JSON.parse(dlg.getAttribute('data-ids') || '[]'), token: dlg.getAttribute('data-token') } }).then(function (d) {
      if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
      registerPane(kind);
      var bad = (d.results || []).filter(function (x) { return x.state === 'failed'; }).length;
      setTimeout(function () {
        var box = $('[data-pane="' + REG[kind].pane + '"]');
        say(box.querySelector('[data-rg-say]'), (d.sent || 0) + ' sent' + (d.queued ? ', ' + d.queued + ' queued (they go within minutes)' : '') + (bad ? ', ' + bad + ' could not be queued' : '') + '.', bad ? 'bad' : 'good');
      }, 400);
    }).catch(function (err) { b.disabled = false; say(said, err.message, 'bad'); });
  });

  ['caregiver', 'membership'].forEach(function (kind) {
    var pane = '[data-pane="' + REG[kind].pane + '"]';
    on(pane, 'input', function (e) {
      var t = e.target;
      if (t.getAttribute('data-rg') === 'q') { regState[kind].q = t.value; paintRegisterRows(kind); return; }
      var tr = t.closest && t.closest('tr[data-rg-id]');
      if (tr && t.hasAttribute('data-f')) { tr.setAttribute('data-touched', ''); regSync(kind, tr); regPickCount(kind); }
    });
    on(pane, 'change', function (e) {
      var t = e.target;
      var box = $(pane);
      if (t.getAttribute('data-rg') === 'pick') { regState[kind].picked[t.closest('tr').getAttribute('data-rg-id')] = t.checked; regPickCount(kind); return; }
      if (t.getAttribute('data-rg') === 'pickall') {
        regRows(kind).forEach(function (r) { regState[kind].picked[r.id] = t.checked; });
        [].forEach.call(box.querySelectorAll('[data-rg="pick"]'), function (x) { x.checked = t.checked; });
        regPickCount(kind);
        return;
      }
      if (t.hasAttribute('data-f')) {
        var tr = t.closest('tr[data-rg-id]');
        tr.setAttribute('data-touched', '');
        /* tidy the tracking number as it will be kept */
        if (t.getAttribute('data-f') === 'tracking') t.value = trackOf(t.value);
        regSync(kind, tr);
        regPickCount(kind);
      }
    });
    on(pane, 'click', function (e) {
      var box = $(pane);
      var said = box.querySelector('[data-rg-say]');
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-rg-show')) {
        regState[kind].show = b.getAttribute('data-rg-show');
        [].forEach.call(box.querySelectorAll('[data-rg-show]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        paintRegisterRows(kind);
        return;
      }
      if (b.classList.contains('rg-c')) {
        copyText(b.getAttribute('data-copy')).then(function () {
          b.classList.add('is-copied');
          setTimeout(function () { b.classList.remove('is-copied'); }, 700);
          say(said, 'Copied: ' + b.getAttribute('data-copy').split('\n')[0], 'good');
        }, function (err) { say(said, err.message, 'bad'); });
        return;
      }
      var what = b.getAttribute('data-rg');
      var tr = b.closest('tr[data-rg-id]');
      var id = tr ? tr.getAttribute('data-rg-id') : '';
      var row = id ? regState[kind].rows.filter(function (r) { return r.id === id; })[0] : null;
      if (what === 'row' && row) {
        regClip(kind, [row], false).then(function () { say(said, 'Row copied: ' + row.name + '. Paste it into a sheet.', 'good'); }, function (err) { say(said, err.message, 'bad'); });
        return;
      }
      if (what === 'save' && row) {
        b.disabled = true;
        regSave(kind, tr).then(function (r) {
          regPickCount(kind);
          say(said, 'Saved: ' + r.name + ', ' + (r.shipLabel || 'no status') + '.' + (regCheckSaved(r).ready ? ' Preview the email when you are ready.' : ''), 'good');
        }).catch(function (err) { b.disabled = false; say(said, err.message, 'bad'); });
        return;
      }
      if (what === 'mail' && row) {
        if (!regCheck(tr, row).ready) return;
        regPreview(kind, [id]);
        return;
      }
      if (what === 'mailpicked') {
        var ready = regPickedReady(kind);
        if (ready.length) regPreview(kind, ready);
        return;
      }
      if (what === 'copyall') {
        var rows = regRows(kind);
        regClip(kind, rows, true).then(function () { say(said, rows.length + ' rows copied, with the headings. Paste them into a sheet.', 'good'); }, function (err) { say(said, err.message, 'bad'); });
        return;
      }
      if (what === 'csv') {
        b.disabled = true;
        token().then(function (idt) {
          return fetch('/api/admin/registers?kind=' + kind + '&format=csv', { headers: { Authorization: 'Bearer ' + idt } });
        }).then(function (r) {
          if (!r.ok) throw new Error('The export could not be made.');
          var name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || ('PFA-' + REG[kind].file + '.csv');
          return r.blob().then(function (blob) { return { blob: blob, name: name }; });
        }).then(function (x) {
          var url = URL.createObjectURL(x.blob);
          var a = document.createElement('a');
          a.href = url; a.download = x.name; a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
          say(said, 'Saved ' + x.name + '. It opens in Excel or Google Sheets.', 'good');
        }).catch(function (err) { say(said, err.message, 'bad'); }).then(function () { b.disabled = false; });
      }
    });
  });

  window.PFARegisters = { pane: registerPane };
}());
