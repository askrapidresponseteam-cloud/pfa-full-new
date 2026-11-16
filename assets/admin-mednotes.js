/* Medical notes in the panel (owner, 16 Nov 2026: "allow new submissions
   also, it needs to go to the admin, gandhim. and once approved, submitter
   will get an email confirming success. also admin should have option to
   send/ask for edit, update").

   The list first: notes waiting to be read, those sent back for changes,
   those on the site, and the rest. Read opens a note in place: what it says,
   its files (in the panel's own viewer), who sent it. Then one of four
   things, each a single press with a last look before anything is sent:

     Publish           on the site, and the sender emailed that it is live
     Edit              correct the words, or which files show; kept as a version
     Ask for changes   the sender is emailed what to change, with a private link
     Not for the site  closed as Not published (or, once live, Taken off the site)

   PFA's own notes (data/med-notes.json) are listed under their own heading,
   each with Take off the site or Put back. From /api/admin/med-notes
   (lib/routes/admin/med-notes.js); the status moves go through the case
   itself (/api/admin/case), so they read the same in every register.
   admin.html calls PFAMedNotes.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var M = { rows: [], own: [], view: 'waiting', open: '', mode: {}, said: '', tone: '', loading: false, drafts: {}, edits: {} };
  /* the panel is served from Firebase, which carries no public pages */
  var SITE = /(\.web\.app|\.firebaseapp\.com)$/.test(location.hostname) ? 'https://peopleforanimalsindia.org' : '';
  var ROLES = ['Pet parent', 'Caregiver or rescuer', 'Vet', 'Doctor', 'Someone else'];
  var ANIMALS = ['Dogs', 'Cats', 'Cows and cattle', 'Birds', 'Horses and donkeys', 'Any animal', 'Other animals'];

  var main = document.querySelector('[data-pane="submissions"]');
  if (main && !document.querySelector('[data-pane="mednotes"]')) {
    var node = document.createElement('div');
    node.className = 'pane';
    node.setAttribute('data-pane', 'mednotes');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', 'Medical notes');
    main.parentNode.insertBefore(node, main.nextSibling);
  }

  var style = document.createElement('style');
  style.textContent = [
    '.mn-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 16px}',
    '.mn-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line)}.mn-seg button{height:38px;padding:0 14px;border:0;border-right:1px solid var(--line);background:none;font:inherit;font-size:13px;cursor:pointer;color:var(--ink);white-space:nowrap}.mn-seg button:last-child{border-right:0}.mn-seg button[aria-pressed="true"]{background:var(--ink);color:var(--paper,#fff)}',
    '@media (max-width:560px){.mn-seg{display:grid;grid-template-columns:1fr 1fr;width:100%}.mn-seg button{border-bottom:1px solid var(--line)}.mn-seg button:nth-child(2n){border-right:0}.mn-seg button:last-child:nth-child(odd){grid-column:1 / -1;border-right:0}}',
    '.mn-say{margin:0 0 12px;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.mn-say:empty{display:none}.mn-say[data-tone="good"]{color:#1f6b3a}.mn-say[data-tone="bad"]{color:#a3251f}',
    '.mn-list{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}',
    '.mn-row{border-bottom:1px solid var(--line);padding:14px 0}',
    '.mn-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 18px;align-items:start}',
    '.mn-head h4{margin:0;font-family:var(--display);font-weight:400;font-size:19px;line-height:1.3;overflow-wrap:anywhere}',
    '.mn-meta{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}',
    '.mn-tag{display:inline-block;padding:3px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);white-space:nowrap}.mn-tag[data-on="1"]{background:#1f6b3a;border-color:#1f6b3a;color:#fff}',
    '.mn-acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.mn-acts .press,.mn-acts .ghost{width:auto;margin:0;min-height:38px;padding:0 14px;font-size:11px}',
    '.mn-body{margin-top:14px;display:grid;gap:12px;max-width:820px}',
    '.mn-body p{margin:0;font-size:14px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}',
    '.mn-k{display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}',
    '.mn-files{display:flex;flex-wrap:wrap;gap:10px}.mn-files button{min-height:38px;padding:0 14px;border:1px solid var(--line);background:var(--paper,#fff);font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}',
    '.mn-form{display:grid;gap:12px;max-width:820px;margin-top:14px}',
    '.mn-form label{display:grid;gap:6px;font-size:12px;color:var(--muted)}',
    '.mn-form input,.mn-form select,.mn-form textarea{width:100%;min-height:42px;padding:9px 12px;border:1px solid var(--line);background:var(--paper,#fff);font:inherit;font-size:14px;line-height:1.5;color:var(--ink);border-radius:0;box-sizing:border-box}',
    '.mn-form textarea{min-height:120px;resize:vertical}.mn-form textarea.mn-long{min-height:240px}',
    '.mn-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:640px){.mn-two{grid-template-columns:1fr}}',
    '.mn-check{display:flex!important;align-items:center;gap:12px!important;font-size:14px!important;color:var(--ink)!important}.mn-check input{width:18px;min-height:18px;height:18px;margin:0;flex:none}',
    '.mn-confirm{margin:12px 0 0;padding:14px 0 0;border-top:1px solid var(--line);font-size:14px;line-height:1.5}',
    '.mn-own{margin-top:26px}.mn-own h3{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}'
  ].join('');
  document.head.appendChild(style);

  function pane() { return $('[data-pane="mednotes"]'); }
  function day(v) { var d = new Date(v || ''); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function bucket(r) {
    if (r.status === 'removed') return 'removed';
    if (r.published) return 'on';
    if (r.status === 'changes') return 'changes';
    if (/^(rejected|withdrawn)$/.test(r.status)) return 'closed';
    return 'waiting';
  }
  function rowOf(ref) { return M.rows.filter(function (r) { return r.reference === ref; })[0]; }
  function opts(list, v) { return list.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }

  function readView(r) {
    var n = r.note || {};
    var s = r.sent || {};
    var files = [];
    for (var i = 1; i <= r.attachments; i++) files.push(String(i));
    return '<div class="mn-body">'
      + '<div><span class="mn-k">In a few lines</span><p>' + esc(n.summary) + '</p></div>'
      + (n.noteText ? '<details class="fold"><summary>The note</summary><p style="margin-top:8px">' + esc(n.noteText) + '</p></details>' : '')
      + (files.length ? '<div><span class="mn-k">Files</span><div class="mn-files">' + files.map(function (f) {
        return '<button type="button" data-mn-file="' + f + '">File ' + f + ((n.files || []).indexOf(f) === -1 ? ' (not shown on the site)' : '') + '</button>';
      }).join('') + '</div></div>' : '')
      + (n.sources ? '<div><span class="mn-k">Based on</span><p>' + esc(n.sources) + '</p></div>' : '')
      + '<div><span class="mn-k">Shown as</span><p>' + esc([n.credit, n.role, n.regNo ? 'Reg. ' + n.regNo : ''].filter(Boolean).join(', ')) + '</p></div>'
      + '<div><span class="mn-k">Sent by</span><p>' + esc([s.name, s.email, s.mobile].filter(Boolean).join(' · ')) + '</p></div>'
      + (r.changes && r.changes.text ? '<div><span class="mn-k">Changes asked on ' + esc(day(r.changes.at)) + '</span><p>' + esc(r.changes.text) + '</p>'
        + (r.changes.answeredAt ? '<p class="mn-meta">They updated it on ' + esc(day(r.changes.answeredAt)) + '.</p>' : '<p class="mn-meta">Not answered yet. The link works until ' + esc(day(r.changes.expiresAt)) + '.</p>') + '</div>' : '')
      + '</div>';
  }

  function editView(r) {
    var n = M.edits[r.reference] || r.note || {};
    var files = [];
    for (var i = 1; i <= r.attachments; i++) files.push(String(i));
    return '<div class="mn-form" data-mn-form>'
      + '<label>Title<input name="title" maxlength="140" value="' + esc(n.title) + '"></label>'
      + '<label>In a few lines<textarea name="summary" maxlength="240">' + esc(n.summary) + '</textarea></label>'
      + '<label>The note<textarea class="mn-long" name="noteText" maxlength="8000">' + esc(n.noteText) + '</textarea></label>'
      + '<div class="mn-two"><label>About<select name="animal">' + opts(ANIMALS, n.animal) + '</select></label>'
      + '<label>Who wrote it<select name="role">' + opts(ROLES, n.role) + '</select></label></div>'
      + '<div class="mn-two"><label>Name shown with it<input name="credit" maxlength="120" value="' + esc(n.credit) + '"></label>'
      + '<label>Registration number<input name="regNo" maxlength="60" value="' + esc(n.regNo) + '"></label></div>'
      + '<label>Based on<input name="sources" maxlength="400" value="' + esc(n.sources) + '"></label>'
      + (files.length ? '<div><span class="mn-k">Files shown on the site</span>' + files.map(function (f) {
        return '<label class="mn-check"><input type="checkbox" name="file" value="' + f + '"' + ((n.files || []).indexOf(f) !== -1 ? ' checked' : '') + '><span>File ' + f + '</span></label>';
      }).join('') + '</div>' : '')
      + '<div class="mn-acts"><button class="press" type="button" data-mn-do="save">Save</button>'
      + (r.published ? '' : '<button class="ghost" type="button" data-mn-do="savepub">Save and publish</button>')
      + '<button class="ghost" type="button" data-mn-mode="">Cancel</button></div></div>';
  }

  function askView(r) {
    return '<div class="mn-form"><label>What should change? The sender gets this in an email, with a private link to their note.'
      + '<textarea data-mn-ask maxlength="2000" placeholder="Please add what the dose is based on, and the source.">' + esc(M.drafts[r.reference] || '') + '</textarea></label>'
      + '<div class="mn-acts"><button class="press" type="button" data-mn-do="ask">Email the sender</button><button class="ghost" type="button" data-mn-mode="">Cancel</button></div></div>';
  }

  function confirmView(r, what) {
    var words = {
      publish: 'Put this note on the website and email ' + esc((r.sent || {}).email || 'the sender') + ' that it is live?',
      reject: 'Close this note as Not published? Nothing is emailed; reply from Open if you want to tell them why.',
      takeoff: 'Take this note off the website? Nothing is emailed.'
    };
    return '<p class="mn-confirm">' + words[what] + '</p><div class="mn-acts"><button class="press" type="button" data-mn-do="' + what + '">Yes</button><button class="ghost" type="button" data-mn-mode="">Cancel</button></div>';
  }

  function item(r) {
    var n = r.note || {};
    var b = bucket(r);
    var mode = M.mode[r.reference] || '';
    var openNow = M.open === r.reference;
    var acts = '<div class="mn-acts">'
      + '<button class="' + (openNow ? 'ghost' : 'press') + '" type="button" data-mn-read aria-expanded="' + openNow + '">' + (openNow ? 'Close' : 'Read') + '</button>'
      + (openNow && b !== 'removed' ? (b === 'on' ? '' : '<button class="press" type="button" data-mn-mode="publish">Publish</button>')
        + '<button class="ghost" type="button" data-mn-mode="edit">Edit</button>'
        + (b === 'on' ? '<button class="ghost" type="button" data-mn-mode="takeoff">Take off the site</button>'
          : '<button class="ghost" type="button" data-mn-mode="ask">Ask for changes</button>' + (b === 'closed' ? '' : '<button class="ghost" type="button" data-mn-mode="reject">Not for the site</button>')) : '')
      + '<button class="ghost" type="button" data-open-case="' + esc(r.reference) + '">Open</button></div>';
    return '<li class="mn-row" data-mn="' + esc(r.reference) + '"><div class="mn-head"><div><h4>' + esc(n.title || r.reference) + '</h4>'
      + '<p class="mn-meta">' + esc([n.animal, n.credit || (r.sent || {}).name, n.role, day(r.createdAt), r.reference, r.versions > 1 ? 'version ' + r.versions : ''].filter(Boolean).join(' · ')) + '</p></div>'
      + '<span class="mn-tag" data-on="' + (r.published ? 1 : 0) + '">' + esc(r.statusLabel) + '</span></div>'
      + (openNow ? (mode === 'edit' ? editView(r) : readView(r)) : '')
      + (openNow && mode === 'ask' ? askView(r) : '')
      + (openNow && /^(publish|reject|takeoff)$/.test(mode) ? confirmView(r, mode) : acts.replace('<div class="mn-acts">', openNow && mode ? '<div class="mn-acts" hidden>' : '<div class="mn-acts">'))
      + '</li>';
  }

  function ownItem(o) {
    return '<li class="mn-row" data-mn-seed="' + esc(o.seed) + '"><div class="mn-head"><div><h4>' + esc(o.title) + '</h4>'
      + '<p class="mn-meta">' + esc([o.animal, o.credit, o.role, 'put on the site by PFA'].filter(Boolean).join(' · ')) + '</p></div>'
      + '<span class="mn-tag" data-on="' + (o.hidden ? 0 : 1) + '">' + (o.hidden ? 'Off the site' : 'On the site') + '</span></div>'
      + '<div class="mn-acts">' + (o.files && o.files[0] ? '<a class="ghost" href="' + esc(SITE + o.files[0].url) + '" target="_blank" rel="noopener">Open the file</a>' : '')
      + '<button class="ghost" type="button" data-mn-seedset="' + (o.hidden ? '0' : '1') + '">' + (o.hidden ? 'Put back on the site' : 'Take off the site') + '</button></div></li>';
  }

  function paint() {
    var node = pane();
    if (!node) return;
    var counts = { waiting: 0, changes: 0, on: 0, closed: 0 };
    M.rows.forEach(function (r) { var b = bucket(r); if (counts[b] != null) counts[b] += 1; });
    var seg = [['waiting', 'To read ' + counts.waiting], ['changes', 'Changes asked ' + counts.changes], ['on', 'On the site ' + counts.on], ['closed', 'Closed ' + counts.closed], ['own', 'PFA\'s own ' + M.own.length]];
    var rows = M.rows.filter(function (r) { return bucket(r) === M.view; });
    var list = M.view === 'own'
      ? (M.own.length ? '<ul class="mn-list">' + M.own.map(ownItem).join('') + '</ul>' : '<div class="empty"><b>None</b>PFA has not put any notes on the site itself.</div>')
      : (rows.length ? '<ul class="mn-list">' + rows.map(item).join('') + '</ul>'
        : '<div class="empty"><b>' + (M.view === 'waiting' ? 'Nothing to read' : 'Nothing here') + '</b>' + (M.view === 'waiting' ? 'Every note sent has been read.' : 'Choose another view.') + '</div>');
    node.innerHTML = '<div class="mn-tools"><div class="mn-seg" role="group" aria-label="Show">' + seg.map(function (x) { return '<button type="button" data-mn-view="' + x[0] + '" aria-pressed="' + (M.view === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>'
      + '<a class="ghost" href="' + SITE + '/pet-health.html" target="_blank" rel="noopener" style="width:auto;margin:0;min-height:38px;display:inline-flex;align-items:center;padding:0 14px;font-size:11px;text-decoration:none;color:var(--ink)">See the page</a></div>'
      + '<p class="mn-say" role="status" aria-live="polite"' + (M.tone ? ' data-tone="' + M.tone + '"' : '') + '>' + esc(M.said) + '</p>' + list;
    var pip = document.getElementById('pipMed');
    if (pip) { pip.textContent = counts.waiting; pip.hidden = !counts.waiting; }
  }

  function load(quiet) {
    var node = pane();
    if (M.loading) return Promise.resolve();
    M.loading = true;
    if (node && !quiet) node.innerHTML = '<div class="loading">Reading the notes…</div>';
    return A.api('/api/admin/med-notes').then(function (d) {
      M.rows = d.rows || []; M.own = d.own || []; M.loading = false;
      if (!quiet) paint(); else { var pip = document.getElementById('pipMed'); var w = M.rows.filter(function (r) { return bucket(r) === 'waiting'; }).length; if (pip) { pip.textContent = w; pip.hidden = !w; } }
    }).catch(function (e) {
      M.loading = false;
      if (node && !quiet) A.fail(node, e);
    });
  }

  function tell(text, tone) { M.said = text || ''; M.tone = tone || 'good'; }
  function put(row) {
    if (!row) return;
    M.rows = M.rows.map(function (r) { return r.reference === row.reference ? row : r; });
  }
  function formNote(li) {
    var f = li.querySelector('[data-mn-form]');
    var out = { files: [] };
    ['title', 'summary', 'noteText', 'animal', 'role', 'credit', 'regNo', 'sources'].forEach(function (k) { var el = f.querySelector('[name="' + k + '"]'); out[k] = el ? el.value : ''; });
    Array.prototype.forEach.call(f.querySelectorAll('input[name="file"]:checked'), function (c) { out.files.push(c.value); });
    return out;
  }

  function act(ref, body, done) {
    return A.api('/api/admin/med-notes', { method: 'POST', body: Object.assign({ reference: ref }, body) }).then(function (d) {
      put(d.row); tell(d.message || 'Done.', 'good'); if (done) done(d); paint();
    }).catch(function (e) { tell(e.message || 'That did not go through.', 'bad'); paint(); });
  }
  function move(ref, status, note, said) {
    return A.api('/api/admin/case', { method: 'POST', body: { reference: ref, action: 'status', status: status, note: note } }).then(function () {
      M.mode[ref] = ''; M.open = ''; tell(said, 'good'); return load(true).then(paint);
    }).catch(function (e) { tell(e.message || 'That did not go through.', 'bad'); paint(); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pane="mednotes"] [data-mn-view], [data-pane="mednotes"] [data-mn-read], [data-pane="mednotes"] [data-mn-mode], [data-pane="mednotes"] [data-mn-do], [data-pane="mednotes"] [data-mn-file], [data-pane="mednotes"] [data-mn-seedset]');
    if (!t) return;
    if (t.hasAttribute('data-mn-view')) { M.view = t.getAttribute('data-mn-view'); M.open = ''; tell(''); paint(); return; }
    if (t.hasAttribute('data-mn-seedset')) {
      var id = t.closest('[data-mn-seed]').getAttribute('data-mn-seed');
      t.disabled = true;
      A.api('/api/admin/med-notes', { method: 'POST', body: { action: 'seed', id: id, hidden: t.getAttribute('data-mn-seedset') === '1' } }).then(function (d) {
        M.own = M.own.map(function (o) { return o.seed === id ? Object.assign({}, o, { hidden: d.hidden }) : o; });
        tell(d.hidden ? 'Taken off the site. It goes within a minute.' : 'Back on the site. It shows within a minute.', 'good'); paint();
      }).catch(function (err) { tell(err.message, 'bad'); paint(); });
      return;
    }
    var li = t.closest('[data-mn]');
    if (!li) return;
    var ref = li.getAttribute('data-mn');
    var r = rowOf(ref);
    if (!r) return;
    if (t.hasAttribute('data-mn-read')) { M.open = M.open === ref ? '' : ref; M.mode[ref] = ''; tell(''); paint(); return; }
    if (t.hasAttribute('data-mn-mode')) { M.mode[ref] = t.getAttribute('data-mn-mode'); if (M.mode[ref] === 'edit') M.edits[ref] = null; tell(''); paint(); var first = li.parentNode && pane().querySelector('[data-mn="' + ref + '"] textarea, [data-mn="' + ref + '"] input'); if (first) first.focus(); return; }
    if (t.hasAttribute('data-mn-file')) {
      var n = t.getAttribute('data-mn-file');
      t.disabled = true;
      A.api('/api/admin/attachment?reference=' + encodeURIComponent(ref) + '&n=' + encodeURIComponent(n)).then(function (d) {
        t.disabled = false;
        var src = 'data:' + d.contentType + ';base64,' + d.data;
        if (window.PFAViewer) window.PFAViewer.open([{ src: src, type: d.contentType, label: (r.note || {}).title + ', file ' + n }], 0);
      }).catch(function (err) { t.disabled = false; tell(err.message, 'bad'); paint(); });
      return;
    }
    var what = t.getAttribute('data-mn-do');
    t.disabled = true;
    if (what === 'save' || what === 'savepub') {
      var note = formNote(li);
      M.edits[ref] = note;
      act(ref, { action: what === 'savepub' ? 'publish' : 'save', note: note }, function (d) { if (d.ok) { M.mode[ref] = ''; M.edits[ref] = null; if (what === 'savepub') M.open = ''; } });
      return;
    }
    if (what === 'publish') { act(ref, { action: 'publish' }, function () { M.mode[ref] = ''; M.open = ''; }); return; }
    if (what === 'ask') {
      var text = String(M.drafts[ref] || '').trim();
      if (!text) { t.disabled = false; tell('Write what should change first.', 'bad'); paint(); return; }
      act(ref, { action: 'ask', text: text }, function () { M.drafts[ref] = ''; M.mode[ref] = ''; M.open = ''; });
      return;
    }
    if (what === 'reject') { move(ref, 'rejected', 'Not for the website.', 'Closed as Not published.'); return; }
    if (what === 'takeoff') { move(ref, 'withdrawn', 'Taken off the website.', 'Taken off the site. It goes within a minute.'); }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-mn-ask')) M.drafts[e.target.closest('[data-mn]').getAttribute('data-mn')] = e.target.value;
  });

  /* the count waiting shows on the rail, once signed in */
  var app = document.getElementById('app');
  if (app) {
    var started = false;
    new MutationObserver(function () { if (!started && !app.hidden) { started = true; load(true); } }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  }

  window.PFAMedNotes = { pane: function () { return load(false); } };
})();
