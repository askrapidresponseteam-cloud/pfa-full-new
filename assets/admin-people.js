/* The panel by people (owner, 3 Nov 2026: "admin should have sections like
   members, [caregivers], interns, employees etc..not like membership cards
   etc..and the search should work like google grade").

   Job applicants: everyone who applied through the careers page (owner, the
   same day: "these are not employees, they are people who applied"), by the post they
   applied for, each opening their full application. And the search's
   results by who someone is (Members, Caregivers, Interns given an ID,
   Volunteers, then those who applied, Shelters, then the rest), with what an intern or a shelter
   opens to. admin.html calls PFAPeople.pane('employees'), asks
   PFAPeople.open(result) first when a search result is chosen, and paints
   the results in PFAPeople.groups' order. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;

  var ROLES = { 'zonal-head': 'Zonal Head', 'veterinary-team': 'Veterinary doctors', 'cruelty-response-coordinator': 'Cruelty Response Coordinator', 'social-media-fundraising': 'Social Media and Fundraising', internship: 'Internship' };
  var STATUS = { new: 'New', 'in-review': 'In review', review: 'In review', shortlisted: 'Shortlisted', interview: 'Interview', hired: 'Hired', approved: 'Hired', rejected: 'Not taken', closed: 'Closed', withdrawn: 'Withdrawn' };
  var EM = { rows: [], q: '', role: '', loading: false };

  var style = document.createElement('style');
  style.textContent = '.em-line{margin:0 0 10px;font-size:14px}.em-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px}.em-tools input{flex:1 1 240px;min-width:0;height:38px;padding:0 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink)}.em-tools select{height:38px;padding:0 10px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink);max-width:100%}.em-tools input:focus-visible,.em-tools select:focus-visible{outline:none;border-color:var(--ink)}.em-tools .ghost{width:auto;margin:0}.em-ref{white-space:nowrap}';
  document.head.appendChild(style);

  function role(r) { var f = r.fields || {}; return ROLES[f.roleId] || (f.roleId ? f.roleId : ROLES['zonal-head']); }
  function contact(r) { var f = r.fields || {}; return { name: f.name || '', email: f.email || '', mobile: f.mobile || '' }; }
  function day(v) { var d = new Date(v || ''); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

  /* every job application, a page at a time, up to 500 */
  function readAll(cursor, out) {
    return A.api('/api/admin/records?type=submissions&kind=PFA-J&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
      out = out.concat(d.rows || []);
      return d.cursor && out.length < 500 ? readAll(d.cursor, out) : out;
    });
  }

  function shown() {
    var q = EM.q.toLowerCase();
    return EM.rows.filter(function (r) {
      if (EM.role && (r.fields || {}).roleId !== EM.role && !(EM.role === 'zonal-head' && !(r.fields || {}).roleId)) return false;
      if (!q) return true;
      var c = contact(r);
      return [r.reference, c.name, c.email, c.mobile, role(r), (r.fields || {}).zone, (r.fields || {}).background].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function paint() {
    var node = $('[data-pane="employees"]');
    if (!node) return;
    var rows = shown();
    var by = {};
    EM.rows.forEach(function (r) { var k = role(r); by[k] = (by[k] || 0) + 1; });
    var hired = EM.rows.filter(function (r) { return /hired|approved/.test(r.status || ''); }).length;
    node.innerHTML = '<p class="em-line"><b>' + EM.rows.length + (EM.rows.length === 1 ? ' applicant' : ' applicants') + '</b>'
      + (hired ? ' · ' + hired + ' hired' : '') + Object.keys(by).map(function (k) { return ' · ' + esc(k) + ' ' + by[k]; }).join('') + '</p>'
      + '<div class="em-tools"><input type="search" data-em="q" placeholder="Find a name, phone, email, post or zone" aria-label="Find an applicant" value="' + esc(EM.q) + '">'
      + '<select data-em="role" aria-label="Post"><option value="">Every post</option>' + Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (EM.role === k ? ' selected' : '') + '>' + esc(ROLES[k]) + '</option>'; }).join('') + '</select>'
      + '<button class="ghost" type="button" data-em="csv">Download for Excel</button></div>'
      + '<div class="wrap"><table><thead><tr><th>Applicant</th><th>Post</th><th>Contact</th><th>Status</th><th>Applied</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) {
        var c = contact(r);
        return '<tr><td><button class="rowopen" type="button" data-open-case="' + esc(r.reference) + '">' + esc(c.name || r.reference) + '</button><br><span class="note em-ref">' + esc(r.reference) + '</span></td>'
          + '<td>' + esc(role(r)) + ((r.fields || {}).zone ? '<br><span class="note">' + esc(r.fields.zone) + '</span>' : '') + '</td>'
          + '<td>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '') + (c.mobile ? '<br>' + esc(c.mobile) : '') + '</td>'
          + '<td>' + esc(STATUS[r.status] || r.statusLabel || r.status || 'New') + '</td>'
          + '<td>' + esc(day(r.createdAt)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5"><div class="empty"><b>' + (EM.rows.length ? 'Nothing matches' : 'No applications yet') + '</b>' + (EM.rows.length ? 'Try fewer words.' : 'Applications from the careers page arrive here.') + '</div></td></tr>')
      + '</tbody></table></div>';
  }

  function pane() {
    var node = $('[data-pane="employees"]');
    if (!node || EM.loading) return;
    EM.loading = true;
    node.innerHTML = '<div class="loading">Reading the applications…</div>';
    readAll('', []).then(function (rows) { EM.rows = rows; EM.loading = false; paint(); }).catch(function (e) {
      EM.loading = false;
      node.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e.message) + '</div>';
    });
  }

  function csv() {
    var cell = function (v) { var s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [['Applicant', 'Reference', 'Post', 'Zone', 'Email', 'Mobile', 'Status', 'Applied'].map(cell).join(',')].concat(shown().map(function (r) {
      var c = contact(r);
      return [c.name, r.reference, role(r), (r.fields || {}).zone, c.email, c.mobile, STATUS[r.status] || r.status || 'New', day(r.createdAt)].map(cell).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    a.download = 'pfa-job-applicants-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-em') === 'q') {
      EM.q = e.target.value;
      var at = e.target.selectionStart;
      paint();
      var box = $('[data-pane="employees"] [data-em="q"]');
      if (box) { box.focus(); try { box.setSelectionRange(at, at); } catch (_) {} }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-em') === 'role') { EM.role = e.target.value; paint(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-em="csv"]');
    if (b) csv();
  });

  /* ---- the search's people ------------------------------------------------ */

  var GROUPS = [['member', 'Members'], ['caregiver', 'Caregivers'], ['intern', 'Interns'], ['volunteer', 'Volunteers'], ['internapplicant', 'Internship applicants'], ['jobapplicant', 'Job applicants'], ['shelter', 'Shelters'],
    ['case', 'Other cases'], ['payment', 'Payments'], ['card', 'Colony cards'], ['email', 'Emails'], ['person', 'Panel admins'], ['audit', 'Audit log'], ['page', 'Website: pages and sections'], ['panel', 'In the panel']];

  /* what an intern or a shelter opens to; anything else is the panel's own */
  function open(r) {
    if (!r || (r.type !== 'intern' && r.type !== 'shelter')) return false;
    A.show('internship');
    var go = function (tries) {
      var P = window.PFAInternship;
      if (P && document.querySelector('[data-pane="' + (r.type === 'intern' ? 'interns' : 'shelters') + '"] .rg-tools')) return r.type === 'intern' ? P.open(r.id) : P.shelter(r.id);
      if (tries < 60) setTimeout(function () { go(tries + 1); }, 100);
      return undefined;
    };
    go(0);
    return true;
  }

  window.PFAPeople = { pane: pane, open: open, groups: GROUPS };
})();
