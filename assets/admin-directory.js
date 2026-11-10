/* The panel's People directory (owner, 10 Nov 2026: "for admin create a
   people's directory section. state, district, name, address, phone number.
   ensure no duplicates. category- members, caregivers etc.. whatever
   applicable").

   One line per person (lib/people-directory.js decides who is the same
   person), in the owner's order: State, District, Name, Address, Phone,
   then the categories. Filter by category, state and district, or find by
   anything typed; download what is shown for Excel (/api/admin/directory,
   format=csv, logged). Two hundred lines at a time. admin.html calls
   PFADirectory.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;

  var style = document.createElement('style');
  style.textContent = [
    '.dr-cats{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
    '.dr-cats button{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:12px;color:var(--ink);cursor:pointer}',
    '.dr-cats button b{font-weight:700}',
    '.dr-cats button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}',
    '.dr-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px}',
    '.dr-tools input,.dr-tools select{height:38px;padding:0 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink);max-width:100%;border-radius:0}',
    '.dr-tools input{flex:1 1 240px;min-width:0}',
    '.dr-tools select{flex:0 1 200px}',
    '.dr-tools input:focus-visible,.dr-tools select:focus-visible{outline:none;border-color:var(--ink)}',
    '.dr-tools .ghost{width:auto;margin:0}',
    '.dr-line{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--muted)}',
    '.dr-line b{color:var(--ink)}',
    '.dr-tags{display:flex;flex-wrap:wrap;gap:4px}',
    '.dr-addr{min-width:220px;white-space:normal;overflow-wrap:anywhere}',
    '.dr-tel a{color:inherit;text-decoration:none;white-space:nowrap}',
    '.dr-pin{color:var(--muted)}',
    '@media (max-width:700px){.dr-table thead{display:none}.dr-table,.dr-table tbody,.dr-table tr,.dr-table td{display:block;width:100%}.dr-table tr{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 4px;padding:14px;border-bottom:1px solid var(--line)}.dr-table td{padding:0;border:0;grid-column:1 / -1}.dr-table td:nth-child(3){order:-2;font-size:15px}.dr-table td[data-place]{order:-1;grid-column:auto;color:var(--muted);font-size:12px}.dr-table td:nth-child(1)::after{content:","}.dr-addr{min-width:0}.dr-wrap{overflow:visible}}'
  ].join('');
  document.head.appendChild(style);

  var D = { data: null, cat: '', state: '', district: '', q: '', shown: 200 };
  var PAGE = 200;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function node() { return $('[data-pane="directory"]'); }
  function day(ms) {
    if (!ms) return '';
    var d = new Date(Number(ms) + 330 * 60000);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function phone(m) { return m ? m.slice(0, 5) + ' ' + m.slice(5) : ''; }
  function label(key) {
    var c = ((D.data && D.data.categories) || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.label : key;
  }

  function pane() {
    var n = node();
    if (!n) return;
    n.innerHTML = '<div class="loading">Reading the directory…</div>';
    A.api('/api/admin/directory').then(function (d) { D.data = d; D.shown = PAGE; paint(); }).catch(function (e) {
      n.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e && e.denied ? 'Your account does not carry the People directory. A super admin can add it under People.' : (e && e.message) || 'That could not be read.') + '</div>';
    });
  }

  function matches(p) {
    if (D.cat && p.categories.indexOf(D.cat) === -1) return false;
    if (D.state && p.state !== D.state) return false;
    if (D.district && p.district !== D.district) return false;
    var words = D.q.toLowerCase().split(' ').filter(Boolean);
    if (!words.length) return true;
    var hay = [p.name, p.mobile, p.otherMobiles.join(' '), p.email, p.address, p.district, p.state, p.pin, p.records.map(function (r) { return r.id; }).join(' ')].join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function options(list, chosen, all) {
    return '<option value="">' + esc(all) + '</option>' + list.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function uniq(list) {
    var seen = {};
    return list.filter(function (v) { if (!v || seen[v]) return false; seen[v] = true; return true; }).sort();
  }

  function paint(focus) {
    var n = node();
    var people = D.data.people || [];
    var states = uniq(people.map(function (p) { return p.state; }));
    var districts = uniq(people.filter(function (p) { return !D.state || p.state === D.state; }).map(function (p) { return p.district; }));
    if (D.district && districts.indexOf(D.district) === -1) D.district = '';
    var rows = people.filter(matches);
    var out = [];
    out.push('<p class="dr-line"><b>' + people.length + (people.length === 1 ? ' person' : ' people') + '</b>, each listed once: one who is a member and a volunteer is one line with both. '
      + 'From the website’s members, colony caregivers, volunteers, interns, job applicants, donors, shop customers and unit applicants. '
      + 'The old website’s members are kept apart, in their own section.</p>');
    out.push('<div class="dr-cats" role="group" aria-label="Category"><button type="button" data-dr-cat="" aria-pressed="' + String(!D.cat) + '">Everyone <b>' + people.length + '</b></button>'
      + (D.data.categories || []).filter(function (c) { return c.count; }).map(function (c) {
        return '<button type="button" data-dr-cat="' + esc(c.key) + '" aria-pressed="' + String(D.cat === c.key) + '">' + esc(c.label) + ' <b>' + c.count + '</b></button>';
      }).join('') + '</div>');
    out.push('<div class="dr-tools"><input type="search" data-dr="q" placeholder="Find a name, phone, email, address or PIN" aria-label="Find a person" value="' + esc(D.q) + '">'
      + '<select data-dr="state" aria-label="State">' + options(states, D.state, 'Every state') + '</select>'
      + '<select data-dr="district" aria-label="District">' + options(districts, D.district, D.state ? 'Every district' : 'Every district') + '</select>'
      + '<button class="ghost" type="button" data-dr="csv">Download for Excel</button></div>');
    out.push('<p class="dr-line" role="status">' + (rows.length === people.length ? 'Showing everyone.' : 'Showing <b>' + rows.length + '</b> of ' + people.length + '.') + ' A state or district marked * was read from the PIN code.</p>');
    if (!rows.length) {
      out.push('<div class="empty"><b>No one matches</b>Clear a filter or the search to see more.</div>');
    } else {
      out.push('<div class="wrap dr-wrap"><table class="dr-table"><thead><tr><th>State</th><th>District</th><th>Name</th><th>Address</th><th>Phone</th><th>Category</th></tr></thead><tbody>');
      rows.slice(0, D.shown).forEach(function (p) {
        var star = p.placeFromPin ? '<span class="dr-pin" title="Read from the PIN code"> *</span>' : '';
        out.push('<tr>'
          + '<td data-place>' + esc(p.state || '-') + (p.state ? star : '') + '</td>'
          + '<td data-place>' + esc(p.district || '-') + (p.district ? star : '') + '</td>'
          + '<td><b>' + esc(p.name || 'No name given') + '</b>'
          + (p.email ? '<span class="detail">' + esc(p.email) + '</span>' : '')
          + (p.sharesWith.length ? '<span class="detail">Shares a phone or email with ' + esc(p.sharesWith.join(', ')) + '</span>' : '') + '</td>'
          + '<td class="dr-addr">' + esc(p.address || '-') + '</td>'
          + '<td class="dr-tel">' + (p.mobile ? '<a href="tel:+91' + esc(p.mobile) + '">' + esc(phone(p.mobile)) + '</a>' : '-')
          + (p.otherMobiles.length ? '<span class="detail">Also ' + esc(p.otherMobiles.map(phone).join(', ')) + '</span>' : '') + '</td>'
          + '<td><span class="dr-tags">' + p.categories.map(function (c) { return '<span class="flag">' + esc(label(c)) + '</span>'; }).join('') + '</span>'
          + '<span class="detail" title="' + esc(p.records.map(function (r) { return r.id; }).join(', ')) + '">' + p.records.length + (p.records.length === 1 ? ' record' : ' records') + ', last ' + esc(day(p.last)) + '</span></td>'
          + '</tr>');
      });
      out.push('</tbody></table></div>');
      if (rows.length > D.shown) out.push('<div class="more"><button class="ghost" type="button" data-dr="more">Show ' + Math.min(PAGE, rows.length - D.shown) + ' more of ' + (rows.length - D.shown) + '</button></div>');
    }
    n.innerHTML = out.join('');
    if (focus) {
      var f = n.querySelector(focus);
      if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
    }
    A.say($('#paneNote'), people.length + (people.length === 1 ? ' person' : ' people'));
  }

  function download(b) {
    var q = ['format=csv'];
    if (D.cat) q.push('category=' + encodeURIComponent(D.cat));
    if (D.state) q.push('state=' + encodeURIComponent(D.state));
    if (D.district) q.push('district=' + encodeURIComponent(D.district));
    if (D.q) q.push('q=' + encodeURIComponent(D.q));
    b.disabled = true;
    A.token().then(function (idt) {
      return fetch('/api/admin/directory?' + q.join('&'), { headers: { Authorization: 'Bearer ' + idt } });
    }).then(function (r) {
      if (!r.ok) throw new Error('The download could not be made.');
      var name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'PFA-people-directory.csv';
      return r.blob().then(function (blob) { return { blob: blob, name: name }; });
    }).then(function (x) {
      var url = URL.createObjectURL(x.blob);
      var a = document.createElement('a');
      a.href = url; a.download = x.name; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      A.say($('#paneNote'), 'Saved ' + x.name);
    }).catch(function (err) { A.say($('#paneNote'), err.message); }).then(function () { b.disabled = false; });
  }

  var wired = false;
  var timer = 0;
  function wire() {
    var n = node();
    if (!n || wired) return;
    wired = true;
    n.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-dr-cat],[data-dr="csv"],[data-dr="more"]') : null;
      if (!b) return;
      if (b.hasAttribute('data-dr-cat')) { D.cat = b.getAttribute('data-dr-cat'); D.shown = PAGE; return paint('[data-dr-cat="' + D.cat + '"]'); }
      if (b.getAttribute('data-dr') === 'more') { D.shown += PAGE; return paint(); }
      return download(b);
    });
    n.addEventListener('change', function (e) {
      var w = e.target.getAttribute && e.target.getAttribute('data-dr');
      if (w === 'state') { D.state = e.target.value; D.district = ''; D.shown = PAGE; paint('[data-dr="state"]'); }
      if (w === 'district') { D.district = e.target.value; D.shown = PAGE; paint('[data-dr="district"]'); }
    });
    n.addEventListener('input', function (e) {
      if (!e.target.getAttribute || e.target.getAttribute('data-dr') !== 'q') return;
      D.q = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(function () { D.shown = PAGE; paint('[data-dr="q"]'); }, 200);
    });
  }

  window.PFADirectory = { pane: function () { wire(); pane(); } };
})();
