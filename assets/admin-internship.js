/* People for Animals - the internship in the admin panel, intern by intern
   and shelter by shelter (admin.html).
   ------------------------------------------------------------------------
   Owner, 3 Nov 2026: "there needs to be a proper panel for the admin to see
   who worked where. their contact details etc. enterprise grade
   implementation. the admin panel needs to have the whole internship
   management module comprehensive, that is aligned with the end user
   site's remote internship program".

   Two parts of the Internship section, beside proof to review, batches and
   issuing (in admin.html) and certificates (assets/admin-certificates.js):

   Interns. Every intern in every batch, one line each: how to reach them,
   their batch and week, the eight tasks, the law quiz, where they do their
   shelter work and their hours, their certificate. A line opens to all of
   it: their application, every task with its proof and history, every quiz
   attempt, their shelter and its changes; and PFA can ask them to work at
   another shelter. Searchable, filtered by batch and standing, and
   downloadable for Excel.

   Shelter directory. Every shelter an intern has named (lib/intern-shelters.js),
   new ones first: the person there and the phone, the full address, who
   worked there and their hours. An entry opens to its photographs, each
   intern's own report of it, and its history; PFA marks it Verified or Not
   a shelter, corrects it, or merges two entries that are one place.

   Kept in its own file so admin.html stays under the page-weight ceiling;
   it uses the panel's helpers on window.PFAAdmin, and the panel calls
   PFAInternship.pane(name) when the section opens.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api, token = A.token;

  /* its own styles, here so admin.html stays under its weight ceiling */
  var style = document.createElement('style');
  style.textContent = '#ipIssueFold td .linky{display:inline;width:auto;margin:0;padding:0;text-align:left}#ipIssueFold [data-ip="issue-app"]{width:auto;min-width:120px}.vi-ok{display:grid;gap:8px;margin:14px 0;padding:12px 14px;border:1px solid var(--ink)}.vi-ok[hidden]{display:none}.vi-ok .note,.vi-ok .say{margin:0}.vi-ok .say:empty{display:none}.vi-ok .press,.vi-ok .ghost{width:auto;justify-self:start;margin:0}.vi-again{margin:0}.vi-again .lab{margin:10px 0 4px}#ipIssueFold td .note+.ghost{width:auto;margin:0 0 0 10px;vertical-align:middle}@media (max-width:640px){.vi-ok .press,.vi-ok .ghost{width:100%}#ipIssueFold td .note+.ghost{display:block;width:100%;margin:8px 0 0}#ipIssueFold thead{display:none}#ipIssueFold tr[data-app]{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;padding:10px 0}#ipIssueFold tr[data-app] td{padding:0;border:0}#ipIssueFold tr[data-app] td:last-child{grid-column:1/-1}#ipIssueFold tr[data-app] [data-ip="issue-app"]{width:100%}#ipIssueFold [data-ip-dob]{width:100%}}'
    + '[data-ip-dob]{height:36px;margin:0 8px 8px 0;padding:0 8px;border:1px solid var(--line);font:inherit;font-size:13px;background:var(--paper);color:var(--ink);max-width:100%}.ix-det{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0;padding:12px;border:1px solid var(--line)}.ix-det .note{grid-column:1/-1;margin:0}.ix-det label{display:grid;gap:4px;font-size:12px;color:var(--muted)}.ix-det input{height:36px;padding:0 10px;border:1px solid var(--line);font:inherit;font-size:13px;background:var(--paper);color:var(--ink);min-width:0}.ix-det__acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}.ix-det__acts .press,.ix-det__acts .ghost{width:auto}' +
    '.rg-tools select{height:38px;padding:0 10px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink);max-width:100%}.rg-tools select:focus-visible{outline:none;border-color:var(--ink)}.ix-line{margin:0 0 10px;font-size:14px}.ix-row{cursor:pointer}.ix-row:hover td,.ix-row.is-open td{background:var(--soft,#f6f6f4)}.ix-detail>td{padding:0 0 18px}' +
    '.ix-d{display:grid;gap:18px;padding:16px;border:1px solid var(--line);border-top:0}.ix-d h4{margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}' +
    '.ix-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 14px;margin:0;font-size:13px}.ix-dl dt{color:var(--muted)}.ix-dl dd{margin:0;overflow-wrap:anywhere}' +
    '.ix-list{margin:0;padding-left:18px;font-size:13px;line-height:1.6}.ix-tasks td{vertical-align:top;font-size:13px;overflow-wrap:anywhere}' +
    '.ix-st{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border:1px solid var(--line)}.ix-st[data-s="new"]{border-color:var(--ink)}.ix-st[data-s="verified"]{background:var(--ink);color:#fff;border-color:var(--ink)}' +
    '.sx-photos{display:flex;flex-wrap:wrap;gap:8px}.sx-ph{width:140px;height:105px;padding:0;border:1px solid var(--line);background:var(--soft,#f6f6f4);cursor:zoom-in;display:grid;place-items:center;overflow:hidden}.sx-ph img{width:100%;height:100%;object-fit:cover}' +
    '.sx-acts{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 8px}.sx-acts .press,.sx-acts .ghost{width:auto;flex:0 0 auto;margin:0;height:40px;min-height:0;padding:0 18px}.ix-detail .ct-why{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.ix-detail .ct-why input,.ix-detail .ct-why select{flex:1 1 260px;min-width:0;height:38px;padding:0 10px;border:1px solid var(--line);font:inherit;font-size:13px;background:var(--paper);color:var(--ink)}.ix-detail .ct-why input:focus-visible,.ix-detail .ct-why select:focus-visible{outline:none;border-color:var(--ink)}.ix-detail .linky{display:inline;margin:0;padding:0;font-size:inherit;color:var(--ink);font-weight:600}.sx-edit{margin:12px 0}';
  document.head.appendChild(style);
  var URL_ = '/api/admin/internship';
  var STATE = { todo: 'To do', submitted: 'Waiting', revise: 'Revise', accepted: 'Accepted' };
  var IN = { rows: [], q: '', batch: '', show: 'all', open: '', detail: null, doing: '' };
  var SHL = { rows: [], counts: {}, q: '', show: 'all', open: '', detail: null, editing: false };

  function day(v) { if (!v) return ''; try { return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); } catch (_) { return String(v).slice(0, 10); } }
  function when(v) { if (!v) return ''; try { return new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); } catch (_) { return v; } }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function box(name) { return $('[data-pane="' + name + '"]'); }

  function download(url, fallback, sayNode, btn) {
    btn.disabled = true;
    token().then(function (id) { return fetch(url, { headers: { Authorization: 'Bearer ' + id } }); }).then(function (r) {
      if (!r.ok) throw new Error('The list could not be made.');
      var name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || fallback;
      return r.blob().then(function (blob) { return { blob: blob, name: name }; });
    }).then(function (x) {
      var u = URL.createObjectURL(x.blob);
      var a = document.createElement('a');
      a.href = u; a.download = x.name; a.click();
      setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
      say(sayNode, 'Saved ' + x.name + '. It opens in Excel or Google Sheets.', 'good');
    }).catch(function (err) { say(sayNode, err.message, 'bad'); }).then(function () { btn.disabled = false; });
  }

  /* a file an intern sent: opened with the panel's sign-in */
  function fileUrl(id) {
    return token().then(function (t) { return fetch(URL_ + '?file=' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + t } }); })
      .then(function (r) { if (!r.ok) throw new Error('That file is not kept.'); return r.blob(); })
      .then(function (blob) { return URL.createObjectURL(blob); });
  }
  function openFile(id, sayNode) {
    fileUrl(id).then(function (u) { window.open(u, '_blank', 'noopener'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); })
      .catch(function (err) { say(sayNode, err.message, 'bad'); });
  }

  /* ================= Interns ================= */

  function internsPane() {
    var node = box('interns');
    if (!node) return;
    api(URL_ + '?interns=all').then(function (d) { IN.rows = d.interns || []; paintInterns(); })
      .catch(function (e) { node.innerHTML = '<div class="empty"><b>Could not read the interns</b>' + esc(e.message) + '</div>'; });
  }

  function internsShown() {
    var q = IN.q.trim().toLowerCase();
    return IN.rows.filter(function (r) {
      if (IN.batch && r.batchId !== IN.batch) return false;
      if (IN.show === 'active' && r.status !== 'active') return false;
      if (IN.show === 'invited' && r.status !== 'invited') return false;
      if (IN.show === 'revoked' && r.status !== 'revoked') return false;
      if (IN.show === 'complete' && !(r.progress && r.progress.complete)) return false;
      if (IN.show === 'waiting' && !(r.progress && r.progress.waiting)) return false;
      if (!q) return true;
      return [r.name, r.internId, r.email, r.mobile, r.town, r.college, r.batch, r.place && r.place.name, r.certificate && r.certificate.number].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function paintInterns() {
    var node = box('interns');
    var all = IN.rows;
    var batches = [];
    all.forEach(function (r) { if (r.batchId && !batches.some(function (b) { return b.id === r.batchId; })) batches.push({ id: r.batchId, name: r.batch || r.batchId }); });
    var active = all.filter(function (r) { return r.status === 'active'; }).length;
    var complete = all.filter(function (r) { return r.progress && r.progress.complete; }).length;
    var certs = all.filter(function (r) { return r.certificate; }).length;
    node.innerHTML = '<p class="ix-line"><b>' + plural(all.length, 'intern', 'interns') + '</b> · ' + active + ' active · ' + complete + ' with every task accepted · ' + plural(certs, 'certificate', 'certificates') + ' issued</p>'
      + '<div class="rg-tools"><input type="search" data-ix="q" placeholder="Find a name, ID, email, phone, town, college or shelter" aria-label="Find an intern" value="' + esc(IN.q) + '">'
      + '<select data-ix="batch" aria-label="Batch"><option value="">Every batch</option>' + batches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (IN.batch === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select>'
      + '<select data-ix="show" aria-label="Show">' + [['all', 'Everyone'], ['active', 'Active'], ['waiting', 'Proof waiting'], ['complete', 'Every task accepted'], ['invited', 'Link sent, not in yet'], ['revoked', 'Withdrawn']].map(function (x) { return '<option value="' + x[0] + '"' + (IN.show === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'
      + '<button class="ghost" type="button" data-ix="csv">Download for Excel</button></div>'
      + '<p class="say" data-ix-say role="status" aria-live="polite"></p>'
      + '<div class="wrap"><table class="ix-t"><thead><tr><th>Intern</th><th>Batch</th><th>The eight tasks</th><th>Law quiz</th><th>Shelter work</th><th>Certificate</th></tr></thead><tbody data-ix-body></tbody></table></div>';
    paintInternRows();
  }

  function paintInternRows() {
    var body = box('interns').querySelector('[data-ix-body]');
    var rows = internsShown();
    body.innerHTML = rows.length ? rows.map(internRow).join('') : '<tr><td colspan="6" class="rg-empty">' + (IN.rows.length ? 'Nothing matches.' : 'No interns yet. Approve applications under Internship.') + '</td></tr>';
  }

  function internRow(r) {
    var p = r.progress || { tasks: [] };
    var dots = p.tasks.map(function (t) { return '<i class="ip-dot" data-s="' + esc(t.state) + '" title="' + esc(t.title + ': ' + (STATE[t.state] || t.state) + (t.score != null ? ', ' + t.score + '/10' : '')) + '"></i>'; }).join('');
    var open = IN.open === r.internId;
    var q = r.quiz || {};
    var st = r.status === 'active' ? '' : r.status === 'invited' ? 'Link sent, not in yet' : r.status === 'revoked' ? 'Withdrawn' : r.status;
    return '<tr class="ix-row' + (open ? ' is-open' : '') + '" data-ix-id="' + esc(r.internId) + '" tabindex="0">'
      + '<td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.internId) + (st ? ' · ' + esc(st) : '') + '</span><br><span class="note">' + esc(r.email) + (r.mobile ? ' · ' + esc(r.mobile) : '') + '</span>' + (r.town || r.college ? '<br><span class="note">' + esc([r.town, r.college].filter(Boolean).join(' · ')) + '</span>' : '') + '</td>'
      + '<td>' + esc(r.batch) + '<br><span class="note">' + (r.week < 1 ? 'Not started' : r.week > r.weeks ? 'Ended' : 'Week ' + r.week + ' of ' + r.weeks) + '</span></td>'
      + '<td><span class="ip-dots">' + dots + '</span><br><span class="note">' + (p.accepted != null ? p.accepted + ' of ' + p.need + ' accepted' : '') + (p.waiting ? ' · ' + p.waiting + ' waiting' : '') + (p.revise ? ' · ' + p.revise + ' to revise' : '') + '</span></td>'
      + '<td>' + (q.best != null ? '<b>' + q.best + '%</b>' + (q.passed ? ' pass' : '') : (q.open ? 'Taking it now' : 'Not taken')) + '<br><span class="note">' + (q.attempts ? q.attempts + ' of ' + q.max + ' attempts' : '') + '</span></td>'
      + '<td>' + (r.place ? esc(r.place.name) + '<br><span class="note">' + esc(r.place.city) + (r.place.state === 'change' ? ' · asked to change' : '') + (r.hours ? ' · ' + r.hours + ' hours' : '') + '</span>' : '<span class="note">Not named yet</span>') + '</td>'
      + '<td>' + (r.certificate ? esc(r.certificate.number) + '<br><span class="note">' + esc(day(r.certificate.issuedOn)) + '</span>' : '<span class="note">Not issued</span>') + '</td></tr>'
      + (open ? '<tr class="ix-detail"><td colspan="6">' + (IN.detail ? internDetail(r, IN.detail) : '<p class="loading">Reading…</p>') + '</td></tr>' : '');
  }

  function internDetail(r, d) {
    var c = d.contact || {};
    var out = '<div class="ix-d">';
    out += '<section><h4>How to reach them</h4><dl class="ix-dl">'
      + '<dt>Email</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd>'
      + (c.mobile ? '<dt>Mobile</dt><dd><a href="tel:' + esc(c.mobile) + '">' + esc(c.mobile) + '</a></dd>' : '')
      /* what they sign in with (5 Nov 2026): email, mobile and date of birth */
      + '<dt>Date of birth</dt><dd>' + (c.dob ? esc(c.dob.split('-').reverse().join('/')) : '<span class="note">Not on record: they cannot sign in until it is added</span>') + '</dd>'
      + (c.status !== 'revoked' ? '<dt>Sign-in</dt><dd>Their email, mobile and date of birth. <button class="linky" type="button" data-ix="details">Change</button></dd>' : '')
      + (c.town ? '<dt>From</dt><dd>' + esc(c.town) + '</dd>' : '')
      + (c.college ? '<dt>College</dt><dd>' + esc(c.college) + (c.course ? ', ' + esc(c.course) : '') + '</dd>' : '')
      + (d.application ? '<dt>Application</dt><dd><button class="linky" type="button" data-open-case="' + esc(d.application.reference) + '">' + esc(d.application.reference) + '</button> · ' + esc(day(d.application.receivedAt)) + '</dd>' : '')
      + '<dt>Signed in</dt><dd>' + (r.lastSignInAt ? esc(when(r.lastSignInAt)) : 'Not yet') + '</dd>'
      + '<dt>RRT</dt><dd>' + (Number((d.referral || {}).registrations) || 0) + ' joined through code ' + esc((d.referral || {}).code || '') + '</dd>'
      + '</dl>'
      + (IN.doing === 'details' ? '<div class="ix-det"><p class="note">Change these only after checking it is them, for example by calling the number they applied with. Any device signed in is signed out.</p>'
        + '<label>Email<input type="email" maxlength="160" data-ix-d="email" value="' + esc(c.email || '') + '"></label>'
        + '<label>Mobile<input inputmode="tel" maxlength="16" data-ix-d="mobile" value="' + esc(c.mobile || '') + '"></label>'
        + '<label>Date of birth<input type="date" data-ix-d="dob" value="' + esc(c.dob || '') + '"></label>'
        + '<div class="ix-det__acts"><button class="press" type="button" data-ix="details-yes">Save sign-in details</button><button class="ghost" type="button" data-ix="details-no">Cancel</button></div></div>' : '')
      + (d.application && d.application.answers && d.application.answers.length ? '<details class="fold"><summary>Their application</summary><dl class="ix-dl">' + d.application.answers.map(function (x) { return '<dt>' + esc(x.q) + '</dt><dd>' + esc(x.a) + '</dd>'; }).join('') + '</dl></details>' : '')
      + '</section>';

    out += '<section><h4>The tasks</h4><div class="wrap"><table class="ix-tasks"><thead><tr><th>Task</th><th>Standing</th><th>Sent</th><th>What they sent</th></tr></thead><tbody>'
      + ((r.progress || {}).tasks || []).map(function (t) {
        var w = (d.works || []).filter(function (x) { return x.taskKey === t.key; })[0];
        return '<tr><td>' + esc(t.title) + '</td><td>' + esc(STATE[t.state] || t.state) + (t.score != null ? ' · ' + t.score + '/10' : '') + (w && w.round > 1 ? ' · round ' + w.round : '') + '</td>'
          + '<td>' + (w && w.submittedAt ? esc(when(w.submittedAt)) : '') + '</td>'
          + '<td>' + (w ? (w.hours ? '<b>' + w.hours + ' hours</b><br>' : '')
            + (w.links || []).map(function (l) { return '<a href="' + esc(l) + '" target="_blank" rel="noopener noreferrer">' + esc(l.replace(/^https?:\/\//, '').slice(0, 48)) + '</a>'; }).join('<br>')
            + ((w.files || []).length ? '<br>' + w.files.map(function (f) { return '<button class="linky" type="button" data-ix-file="' + esc(f.id) + '">' + esc(f.name) + '</button>'; }).join(' ') : '')
            + (w.note ? '<br><span class="note">' + esc(w.note) + '</span>' : '')
            + (w.feedback ? '<br><span class="note">PFA: ' + esc(w.feedback) + '</span>' : '') : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

    var qz = d.quiz || { attempts: [] };
    out += '<section><h4>The law quiz</h4>' + (qz.attempts.length ? '<ul class="ix-list">' + qz.attempts.map(function (a) {
      return '<li>Attempt ' + a.n + ', ' + esc(when(a.finishedAt)) + ': <b>' + a.percent + '%</b>' + (a.pass ? ' pass' : '') + ' · ' + a.byLevel.map(function (l) { return l.label + ' ' + l.right + '/' + l.of; }).join(', ') + ' · ' + Math.round(a.seconds / 60) + ' min' + (a.timedOut ? ', time ran out' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="note">Not taken yet.</p>') + '</section>';

    var pl = d.place;
    out += '<section><h4>Shelter work</h4>' + (pl ? '<p><button class="linky" type="button" data-ix-shelter="' + esc(pl.shelterId) + '">' + esc(pl.name) + '</button>, ' + esc([pl.city, pl.district !== pl.city ? pl.district : ''].filter(Boolean).join(', ')) + (pl.phone ? ' · ' + esc(pl.phone) : '') + '<br><span class="note">Named ' + esc(day(pl.registeredAt)) + (pl.state === 'change' ? ' · asked to change: ' + esc(pl.changeReason) : '') + '</span></p>'
      + (IN.doing === 'change' ? '<div class="ct-why"><input data-ix-why maxlength="400" placeholder="Why they should work elsewhere, in a line they will read"><button class="ghost" type="button" data-ix="change-yes">Email them to choose another place</button></div>'
        : (pl.state !== 'change' ? '<button class="ghost" type="button" data-ix="change">Ask them to work at another shelter</button>' : ''))
      : '<p class="note">They have not named a shelter yet. The portal asks them to before their hours begin.</p>') + '</section>';

    out += '<section><h4>Certificate</h4>' + (d.certificate ? '<p>' + esc(d.certificate.number) + ', issued ' + esc(day(d.certificate.issuedOn)) + (d.certificate.emailedTo ? ', emailed to ' + esc(d.certificate.emailedTo) : '') + '</p>' : '<p class="note">' + ((r.progress || {}).complete ? 'Every task is accepted: issue it under Internship certificates.' : 'Issued once every task is accepted.') + '</p>') + '</section>';
    return out + '</div>';
  }

  function openIntern(id) {
    IN.open = IN.open === id ? '' : id;
    IN.detail = null;
    IN.doing = '';
    paintInternRows();
    if (!IN.open) return;
    api(URL_ + '?profile=' + encodeURIComponent(id)).then(function (d) { if (IN.open === id) { IN.detail = d; paintInternRows(); } })
      .catch(function (e) { say(box('interns').querySelector('[data-ix-say]'), e.message, 'bad'); });
  }

  document.addEventListener('click', function (e) {
    var node = box('interns');
    if (!node || !node.contains(e.target)) return;
    var sayNode = node.querySelector('[data-ix-say]');
    var f = e.target.closest('[data-ix-file]');
    if (f) { openFile(f.getAttribute('data-ix-file'), sayNode); return; }
    var sh = e.target.closest('[data-ix-shelter]');
    if (sh) { showShelter(sh.getAttribute('data-ix-shelter')); return; }
    var b = e.target.closest('[data-ix]');
    if (b) {
      var what = b.getAttribute('data-ix');
      if (what === 'csv') { download(URL_ + '?interns=all&format=csv', 'pfa-interns.csv', sayNode, b); return; }
      if (what === 'details' || what === 'details-no') { IN.doing = what === 'details' ? 'details' : ''; paintInternRows(); var first = node.querySelector('[data-ix-d="email"]'); if (first) first.focus(); return; }
      if (what === 'details-yes') {
        var v = function (k) { return (node.querySelector('[data-ix-d="' + k + '"]') || {}).value || ''; };
        b.disabled = true;
        api(URL_, { method: 'POST', body: { action: 'details', internId: IN.open, email: v('email'), mobile: v('mobile'), dob: v('dob') } }).then(function (r) {
          say(sayNode, r.changed && r.changed.length ? 'Saved: ' + r.changed.join(', ') + ' changed. They sign in with the new details.' : 'Saved. Nothing had changed.', 'good');
          var id = IN.open; IN.open = ''; internsPane(); setTimeout(function () { openIntern(id); }, 400);
        }).catch(function (err) { b.disabled = false; say(sayNode, err.message, 'bad'); });
        return;
      }
      if (what === 'change') { IN.doing = 'change'; paintInternRows(); var w = node.querySelector('[data-ix-why]'); if (w) w.focus(); return; }
      if (what === 'change-yes') {
        var reason = (node.querySelector('[data-ix-why]') || {}).value || '';
        b.disabled = true;
        api(URL_, { method: 'POST', body: { action: 'place-change', internId: IN.open, reason: reason } }).then(function (r) {
          say(sayNode, 'Asked to choose another place; the email was ' + (r.mailed === 'sent' ? 'sent' : r.mailed === 'queued' ? 'queued' : 'not sent') + '. Their shelter proof waits until they do.', 'good');
          var id = IN.open; IN.open = ''; internsPane(); setTimeout(function () { openIntern(id); }, 400);
        }).catch(function (err) { b.disabled = false; say(sayNode, err.message, 'bad'); });
        return;
      }
      return;
    }
    if (e.target.closest('a, button, input, select, textarea, details')) return;
    var row = e.target.closest('tr[data-ix-id]');
    if (row) openIntern(row.getAttribute('data-ix-id'));
  });
  document.addEventListener('keydown', function (e) {
    var row = e.target.closest && e.target.closest('tr[data-ix-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openIntern(row.getAttribute('data-ix-id')); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-ix') === 'q') { IN.q = e.target.value; paintInternRows(); }
    if (e.target.getAttribute && e.target.getAttribute('data-sx') === 'q') { SHL.q = e.target.value; paintShelterRows(); }
  });
  document.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-ix');
    if (k === 'batch') { IN.batch = e.target.value; paintInternRows(); }
    if (k === 'show') { IN.show = e.target.value; paintInternRows(); }
    var s = e.target.getAttribute && e.target.getAttribute('data-sx');
    if (s === 'show') { SHL.show = e.target.value; paintShelterRows(); }
  });

  /* ================= Shelter directory ================= */

  function sheltersPane() {
    var node = box('shelters');
    if (!node) return;
    api(URL_ + '?shelters=1').then(function (d) { SHL.rows = d.rows || []; SHL.counts = d.counts || {}; paintShelters(); })
      .catch(function (e) { node.innerHTML = '<div class="empty"><b>Could not read the directory</b>' + esc(e.message) + '</div>'; });
  }

  function sheltersShown() {
    var q = SHL.q.trim().toLowerCase();
    return SHL.rows.filter(function (r) {
      if (SHL.show !== 'all' && r.status !== SHL.show) return false;
      if (!q) return true;
      return [r.name, r.shelterId, r.contact, r.phone, r.altPhone, r.email, r.lines.join(' '), r.animals, r.interns.map(function (x) { return x.name + ' ' + x.internId; }).join(' ')].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function paintShelters() {
    var node = box('shelters');
    var c = SHL.counts || {};
    node.innerHTML = '<p class="ix-line"><b>' + plural(c.all || 0, 'shelter', 'shelters') + '</b> named by interns · ' + (c.new || 0) + ' new to check · ' + (c.verified || 0) + ' verified' + (c.notShelter ? ' · ' + c.notShelter + ' not a shelter' : '') + '</p>'
      + '<p class="rg-hint">Every shelter an intern names for their shelter work, once: the same phone number, or the same name at the same PIN code, is the same entry. New ones first. Open one to see its photographs and each intern’s report, and to mark, correct or merge it.</p>'
      + '<div class="rg-tools"><input type="search" data-sx="q" placeholder="Find a shelter, town, phone, person or intern" aria-label="Find a shelter" value="' + esc(SHL.q) + '">'
      + '<select data-sx="show" aria-label="Show">' + [['all', 'Every shelter'], ['new', 'New, to check'], ['verified', 'Verified'], ['not-shelter', 'Not a shelter']].map(function (x) { return '<option value="' + x[0] + '"' + (SHL.show === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'
      + '<button class="ghost" type="button" data-sx="csv">Download for Excel</button></div>'
      + '<p class="say" data-sx-say role="status" aria-live="polite"></p>'
      + '<div class="wrap"><table class="ix-t"><thead><tr><th>Shelter</th><th>Where</th><th>Who worked there</th><th>Standing</th></tr></thead><tbody data-sx-body></tbody></table></div>';
    paintShelterRows();
  }

  function paintShelterRows() {
    var node = box('shelters');
    if (!node || !node.querySelector('[data-sx-body]')) return;
    var rows = sheltersShown();
    node.querySelector('[data-sx-body]').innerHTML = rows.length ? rows.map(shelterRow).join('') : '<tr><td colspan="4" class="rg-empty">' + (SHL.rows.length ? 'Nothing matches.' : 'No shelters yet. They appear here as interns name where they will work.') + '</td></tr>';
  }

  function shelterRow(r) {
    var open = SHL.open === r.shelterId;
    return '<tr class="ix-row' + (open ? ' is-open' : '') + '" data-sx-id="' + esc(r.shelterId) + '" tabindex="0">'
      + '<td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.shelterId) + '</span><br><span class="note">' + esc(r.contact) + ' · <a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' + (r.altPhone ? ' · ' + esc(r.altPhone) : '') + '</span></td>'
      + '<td>' + esc(r.lines.join(', ')) + (r.mapLink ? '<br><a href="' + esc(r.mapLink) + '" target="_blank" rel="noopener noreferrer">Map</a>' : '') + '</td>'
      + '<td>' + (r.interns.length ? r.interns.map(function (x) { return esc(x.name) + (x.hours ? ' (' + x.hours + ' h)' : '') + (x.current ? '' : ', left'); }).join('<br>') : '<span class="note">No one now</span>') + '<br><span class="note">' + r.hours + ' hours in all</span></td>'
      + '<td><span class="ix-st" data-s="' + esc(r.status) + '">' + esc(r.statusLabel) + '</span>' + (r.statusNote ? '<br><span class="note">' + esc(r.statusNote) + '</span>' : '') + '<br><span class="note">' + plural(r.photos, 'photograph', 'photographs') + ' · ' + esc(day(r.createdAt)) + '</span></td></tr>'
      + (open ? '<tr class="ix-detail"><td colspan="4">' + (SHL.detail ? shelterDetail(SHL.detail) : '<p class="loading">Reading…</p>') + '</td></tr>' : '');
  }

  function shelterDetail(d) {
    var s = d.shelter || {};
    var a = s.address || {};
    var out = '<div class="ix-d">';
    out += '<section><h4>Photographs</h4><div class="sx-photos" data-sx-photos>' + (s.photos || []).map(function (p) { return '<button type="button" class="sx-ph" data-sx-photo="' + esc(p.fileId) + '" aria-label="Open the photograph"><span>…</span></button>'; }).join('') + '</div></section>';
    out += '<section><h4>The place</h4><dl class="ix-dl"><dt>Address</dt><dd>' + esc((s.lines || []).join(', ')) + '</dd><dt>Person there</dt><dd>' + esc(s.contact) + '</dd><dt>Phone</dt><dd><a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' + (s.altPhone ? ', ' + esc(s.altPhone) : '') + '</dd>'
      + (s.email ? '<dt>Email</dt><dd><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></dd>' : '') + (s.animals ? '<dt>Animals</dt><dd>' + esc(s.animals) + '</dd>' : '') + (s.mapLink ? '<dt>Map</dt><dd><a href="' + esc(s.mapLink) + '" target="_blank" rel="noopener noreferrer">Open the map</a></dd>' : '') + '</dl>'
      + '<div class="ct-why"><input data-sx-note maxlength="300" placeholder="A note with the mark: who you spoke to, or why it is not a shelter"></div>'
      + '<div class="sx-acts">' + (s.status !== 'verified' ? '<button class="press" type="button" data-sx="verified">Mark verified</button>' : '') + (s.status !== 'not-shelter' ? '<button class="ghost" type="button" data-sx="not-shelter">Not a shelter</button>' : '') + (s.status !== 'new' ? '<button class="ghost" type="button" data-sx="new">Back to new</button>' : '') + '<button class="ghost" type="button" data-sx="edit">' + (SHL.editing ? 'Close the correction' : 'Correct it') + '</button></div>'
      + (SHL.editing ? editForm(s, a) : '')
      + '<details class="fold"><summary>Merge with another entry for the same place</summary><p class="note">This entry is folded into the one you choose; its interns, photographs and reports go with it.</p><div class="ct-why"><select data-sx-into><option value="">Choose the entry to keep</option>' + SHL.rows.filter(function (x) { return x.shelterId !== s.shelterId; }).map(function (x) { return '<option value="' + esc(x.shelterId) + '">' + esc(x.name + ', ' + x.city + ' (' + x.shelterId + ')') + '</option>'; }).join('') + '</select><button class="ghost" type="button" data-sx="merge">Merge into it</button></div></details>'
      + '</section>';
    out += '<section><h4>Who worked there</h4>' + ((d.interns || []).length ? '<div class="wrap"><table class="ix-tasks"><thead><tr><th>Intern</th><th>Contact</th><th>Since</th><th>Hours</th><th>Proof</th></tr></thead><tbody>' + d.interns.map(function (x) {
      return '<tr><td>' + esc(x.name) + '<br><span class="note">' + esc(x.internId) + ' · ' + esc(x.batchId) + '</span></td><td><a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' + (x.mobile ? '<br>' + esc(x.mobile) : '') + '</td><td>' + esc(day(x.since)) + (x.current ? '' : '<br><span class="note">left ' + esc(day(x.leftAt)) + '</span>') + '</td><td>' + (x.hours || '') + '</td><td>' + esc(STATE[x.work] || 'Not sent') + (x.score != null ? ' · ' + x.score + '/10' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="note">No one yet.</p>') + '</section>';
    out += '<section><h4>Each intern’s report of it</h4><ul class="ix-list">' + (d.reports || []).map(function (r) {
      return '<li><b>' + esc(r.name) + '</b>, ' + esc(day(r.at)) + ': ' + esc([r.name === s.name ? '' : 'named it ' + r.name, r.contact, r.phone, (r.lines || []).join(', ')].filter(Boolean).join(' · ')) + '</li>';
    }).join('') + '</ul></section>';
    out += '<details class="fold"><summary>History</summary><ul class="ix-list">' + (s.history || []).slice().reverse().map(function (h) { return '<li>' + esc(when(h.at)) + ', ' + esc(h.by) + ': ' + esc(String(h.event).replace('status:', 'marked ')) + (h.note ? ' (' + esc(h.note) + ')' : '') + '</li>'; }).join('') + '</ul></details>';
    return out + '</div>';
  }

  function editForm(s, a) {
    var f = function (k, label, v) { return '<div><label>' + esc(label) + '</label><input data-sx-f="' + k + '" maxlength="160" value="' + esc(v || '') + '"></div>'; };
    return '<div class="so-fields sx-edit">' + f('name', 'Name', s.name) + f('contact', 'Person there', s.contact) + f('phone', 'Phone', s.phone) + f('altPhone', 'Other phone', s.altPhone) + f('email', 'Email', s.email)
      + f('house', 'Building, plot or gate', a.house) + f('street', 'Street and area', a.street) + f('landmark', 'Landmark', a.landmark) + f('city', 'Town', a.city) + f('district', 'District', a.district) + f('state', 'State', a.state) + f('pin', 'PIN code', a.pin)
      + f('mapLink', 'Map link', s.mapLink) + f('animals', 'Animals', s.animals) + '</div><button class="press" type="button" data-sx="save">Save the correction</button>';
  }

  function loadPhotos() {
    var node = box('shelters');
    Array.prototype.forEach.call(node.querySelectorAll('[data-sx-photo]:not([data-done])'), function (b) {
      b.setAttribute('data-done', '1');
      fileUrl(b.getAttribute('data-sx-photo')).then(function (u) { b.innerHTML = '<img alt="" src="' + u + '">'; b.setAttribute('data-url', u); })
        .catch(function () { b.innerHTML = '<span>Not kept</span>'; });
    });
  }

  function openShelter(id) {
    SHL.open = SHL.open === id ? '' : id;
    SHL.detail = null;
    SHL.editing = false;
    paintShelterRows();
    if (!SHL.open) return;
    api(URL_ + '?shelter=' + encodeURIComponent(id)).then(function (d) { if (SHL.open === id) { SHL.detail = d; paintShelterRows(); loadPhotos(); } })
      .catch(function (e) { say(box('shelters').querySelector('[data-sx-say]'), e.message, 'bad'); });
  }

  /* from an intern's line: the directory, opened at their shelter */
  function showShelter(id) {
    var node = box('shelters');
    if (!node) return;
    var go = function () { SHL.open = ''; openShelter(id); try { node.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} };
    if (SHL.rows.length) go(); else api(URL_ + '?shelters=1').then(function (d) { SHL.rows = d.rows || []; SHL.counts = d.counts || {}; paintShelters(); go(); });
  }

  function act(body, done) {
    var sayNode = box('shelters').querySelector('[data-sx-say]');
    return api(URL_, { method: 'POST', body: body }).then(function (d) {
      SHL.detail = d; SHL.editing = false;
      say(sayNode, done, 'good');
      return api(URL_ + '?shelters=1');
    }).then(function (d) {
      SHL.rows = d.rows || []; SHL.counts = d.counts || {};
      var keep = SHL.detail && SHL.detail.shelter ? SHL.detail.shelter.shelterId : SHL.open;
      SHL.open = keep;
      paintShelters(); loadPhotos();
    }).catch(function (err) { say(sayNode, err.message, 'bad'); });
  }

  document.addEventListener('click', function (e) {
    var node = box('shelters');
    if (!node || !node.contains(e.target)) return;
    var sayNode = node.querySelector('[data-sx-say]');
    var ph = e.target.closest('[data-sx-photo]');
    if (ph) { var u = ph.getAttribute('data-url'); if (u) window.open(u, '_blank', 'noopener'); return; }
    var b = e.target.closest('[data-sx]');
    if (b && b.tagName === 'BUTTON') {
      var what = b.getAttribute('data-sx');
      var id = SHL.open;
      if (what === 'csv') { download(URL_ + '?shelters=1&format=csv', 'pfa-shelters.csv', sayNode, b); return; }
      if (what === 'verified' || what === 'not-shelter' || what === 'new') {
        var note = (node.querySelector('[data-sx-note]') || {}).value || '';
        act({ action: 'shelter-status', shelterId: id, status: what, note: note }, what === 'verified' ? 'Marked verified.' : what === 'new' ? 'Back to new.' : 'Marked not a shelter. Ask the interns there to choose another place from their lines under Interns.');
        return;
      }
      if (what === 'edit') { SHL.editing = !SHL.editing; paintShelterRows(); loadPhotos(); return; }
      if (what === 'save') {
        var fields = {};
        Array.prototype.forEach.call(node.querySelectorAll('[data-sx-f]'), function (i) { fields[i.getAttribute('data-sx-f')] = i.value; });
        act({ action: 'shelter-edit', shelterId: id, fields: fields }, 'Corrected. The interns’ own reports are kept as they sent them.');
        return;
      }
      if (what === 'merge') {
        var into = (node.querySelector('[data-sx-into]') || {}).value;
        if (!into) { say(sayNode, 'Choose the entry to keep.', 'bad'); return; }
        act({ action: 'shelter-merge', from: id, into: into }, 'Merged.');
        return;
      }
      return;
    }
    if (e.target.closest('a, button, input, select, textarea, details')) return;
    var row = e.target.closest('tr[data-sx-id]');
    if (row) openShelter(row.getAttribute('data-sx-id'));
  });
  document.addEventListener('keydown', function (e) {
    var row = e.target.closest && e.target.closest('tr[data-sx-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openShelter(row.getAttribute('data-sx-id')); }
  });

  /* The internship application in Submissions (owner, 7 Nov 2026: "this
     has to be approved ... once approved the person should be able to login
     with the combi of 3"; "if person had not provided whatever needs to go
     in for login, ask for those to be submitted through the form. and the
     application has to be merged"). admin.html leaves a box in the case;
     this fills it from the application as it stands (every sending of the
     form by that email, lib/intern-applications.js): Approve when it has all
     three sign-in details, Ask for it when one is missing, and each later
     sending under a +. Approve puts them in the open batch, or a new one,
     emails them that the internship has started and marks it Accepted. */
  var LABEL = { name: 'Name', email: 'Email', mobile: 'Mobile', dob: 'Date of birth', age: 'Age', city: 'City', why: 'Why', work: 'College or work' };
  function vi(boxEl) {
    var ref = boxEl.getAttribute('data-vi-case');
    boxEl.setAttribute('data-vi-done', '1');
    api(URL_ + '?application=' + encodeURIComponent(ref)).then(function (d) {
      var a = d.application;
      var out = '';
      if (a.intern) out += '<p class="note">Approved as <b>' + esc(a.intern.internId) + '</b>' + (a.intern.applicationRef && a.intern.applicationRef !== a.reference ? ', from ' + esc(a.intern.applicationRef) + ' (the same email)' : '') + '. They sign in with their email, mobile and date of birth.</p>';
      else if (a.missing.length) {
        out += '<p class="note"><b>No ' + esc(a.missing.join(', ')) + '.</b> They sign in with it, so ask for it: they fill in the internship form again with the same email and it is added here.' + (a.askedAt ? ' Asked on ' + esc(day(a.askedAt)) + '.' : '') + '</p>'
          + '<button class="ghost" type="button" data-vi-ask="' + esc(a.reference) + '">' + (a.askedAt ? 'Ask again' : 'Ask for it by email') + '</button>';
      } else out += '<p class="note">Approve, and they can sign in with the email, mobile and date of birth below.</p><button class="press" type="button" data-vi-approve="' + esc(a.reference) + '">Approve</button>';
      if (a.resent.length) {
        out += '<details class="fold vi-again"><summary>Sent ' + a.sentTimes + ' times; the newest details count</summary>' + a.resent.map(function (x) {
          var f = x.fields || {};
          return '<p class="lab">Sent again ' + esc(when(x.at)) + '</p><dl class="ix-dl">' + Object.keys(f).filter(function (k) { return f[k] !== '' && f[k] != null; }).map(function (k) { return '<dt>' + esc(LABEL[k] || k) + '</dt><dd>' + esc(f[k]) + '</dd>'; }).join('') + '</dl>';
        }).join('') + '</details>';
      }
      out += '<p class="say" data-vi-say role="status"></p>';
      boxEl.innerHTML = out;
      boxEl.hidden = !(a.intern ? a.resent.length || a.status !== 'approved' : true);
    }).catch(function () { boxEl.hidden = true; });
  }
  function fillCases() { [].forEach.call(document.querySelectorAll('[data-vi-case]:not([data-vi-done])'), vi); }
  if (window.MutationObserver) new MutationObserver(fillCases).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-vi-approve],[data-vi-ask]');
    if (!b) return;
    var approve = b.hasAttribute('data-vi-approve');
    var ref = b.getAttribute(approve ? 'data-vi-approve' : 'data-vi-ask');
    var node = b.parentNode.querySelector('[data-vi-say]');
    b.disabled = true;
    say(node, approve ? 'Approving…' : 'Sending…', '');
    api(URL_, { method: 'POST', body: approve ? { action: 'issue', applicationRef: ref } : { action: 'ask-details', applicationRef: ref } }).then(function (r) {
      var mailed = r.mailed === 'sent' ? 'The email went to them.' : r.mailed === 'queued' ? 'The email is queued and goes out shortly.' : 'The email could not be sent just now.';
      var text = approve ? 'Approved as ' + r.internId + '. ' + mailed + ' They sign in with their email, mobile and date of birth.' : 'Asked for their ' + r.missing.join(', ') + '. ' + mailed + ' What they send is added to this application.';
      var done = function () { say($('#caseSay'), text, 'good'); };
      Promise.resolve(A.showCase && A.showCase(ref)).then(done, done);
      if (A.refresh) A.refresh();
    }).catch(function (err) { b.disabled = false; say(node, err.message, 'bad'); });
  });

  window.PFAInternship = {
    pane: function (name) { return name === 'shelters' ? sheltersPane() : internsPane(); },
    shelter: function (id) { showShelter(id); },
    open: function (id) { IN.open = ''; if (IN.rows.length) openIntern(id); else api(URL_ + '?interns=all').then(function (d) { IN.rows = d.interns || []; paintInterns(); openIntern(id); }); try { box('interns').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }
  };
})();
