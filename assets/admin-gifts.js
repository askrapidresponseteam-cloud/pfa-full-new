/* The panel's Seasonal gifts section (owner, 10 Nov 2026: "Let admins
   configure gift collections and offers by season and year, schedule
   upcoming seasons, and automatically display the active season's content.
   Add an admin toggle to show or hide the page and its navigation links on
   the public site").

   One list of seasons, each one occasion in one year, marked On the page,
   Scheduled, Draft or Ended; a season opens into its form. Above the list,
   the page's own Visible / Hidden switch. Everything is read from and
   saved through /api/admin/gifts (lib/routes/admin/gifts.js), which checks
   it (lib/gift-seasons.js). admin.html calls PFAGifts.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;

  var style = document.createElement('style');
  style.textContent = [
    '.gx-top{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;justify-content:space-between}',
    '.gx-top .press{width:auto;display:inline-flex;align-items:center;min-height:38px;padding:0 18px}',
    '.gx-now{margin:12px 0 0;font-size:14px;line-height:1.55}',
    '.gx-acts{display:flex;flex-wrap:wrap;gap:6px}',
    '.gx-acts .ghost{height:32px;padding:0 11px}',
    '.flag[data-s="live"]{border-color:var(--ink);background:var(--ink);color:var(--paper)}',
    '.flag[data-s="scheduled"]{border-color:var(--working);color:var(--working)}',
    '.flag[data-s="ended"]{color:var(--muted)}',
    '.gx-form{display:grid;gap:22px;max-width:980px}',
    '.gx-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px 16px}',
    '.gx-f{display:grid;gap:7px;min-width:0}',
    '.gx-f>span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.gx-f input,.gx-f select,.gx-f textarea{width:100%;padding:11px 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0}',
    '.gx-f textarea{min-height:76px;resize:vertical;line-height:1.5}',
    '.gx-f input:focus,.gx-f select:focus,.gx-f textarea:focus{outline:none;border-color:var(--ink)}',
    '.gx-radio{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:14px}',
    '.gx-radio label{display:inline-flex;align-items:center;gap:8px;cursor:pointer}',
    '.gx-radio input{width:18px;height:18px;margin:0}',
    '.gx-box{border:1px solid var(--line);padding:18px;display:grid;gap:14px}',
    '.gx-box h4{margin:0;font-size:13px;letter-spacing:.12em;text-transform:uppercase}',
    '.gx-boxhead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between}',
    '.gx-pieces{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:8px}',
    '.gx-piece{display:grid;grid-template-columns:18px 44px minmax(0,1fr);gap:10px;align-items:center;padding:8px;border:1px solid var(--line);cursor:pointer;font-size:13px;line-height:1.35}',
    '.gx-piece input{width:18px;height:18px;margin:0}',
    '.gx-piece img{width:44px;height:55px;object-fit:cover;background:#eee}',
    '.gx-piece small{display:block;color:var(--muted)}',
    '.gx-piece:has(input:checked){border-color:var(--ink)}',
    '.gx-line{display:grid;gap:12px;padding:14px;border:1px dashed var(--line)}',
    '.gx-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;position:sticky;bottom:0;background:var(--paper);padding:12px 0;border-top:1px solid var(--line)}',
    '.gx-foot .press{width:auto;display:inline-flex;align-items:center;min-height:42px;padding:0 22px}',
    '.gx-err{margin:0;color:#a3251f;font-size:13px;line-height:1.5}',
    '.gx-err:empty{display:none}',
    '@media (max-width:700px){.gx-table thead{display:none}.gx-table,.gx-table tbody,.gx-table tr,.gx-table td{display:block;width:100%}.gx-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:14px;border-bottom:1px solid var(--line)}.gx-table td{padding:0;border:0}.gx-table td:nth-child(3){grid-column:2;grid-row:1}.gx-table td:nth-child(2),.gx-table td:nth-child(4),.gx-table td:nth-child(5){grid-column:1 / -1}.gx-table td:nth-child(2) .detail,.gx-table td:nth-child(4) .detail{display:inline;margin:0 0 0 6px}.gx-wrap{overflow:visible}}'
  ].join('');
  document.head.appendChild(style);

  var G = { data: null, edit: null, editId: '', busy: false, note: '' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STATE = { live: 'On the page', scheduled: 'Scheduled', draft: 'Draft', ended: 'Ended' };
  /* The panel on Firebase has no copy of the shop's photographs: they come
     from the site, which its img-src allows (firebase.json). */
  var SITE = /(\.web\.app|\.firebaseapp\.com)$/.test(location.hostname) ? 'https://peopleforanimalsindia.org/' : '/';

  function node() { return $('[data-pane="gifts"]'); }
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function fail(e) {
    var n = node();
    if (!n) return;
    n.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e && e.denied ? 'Your account does not carry this section.' : (e && e.message) || 'That could not be read.') + '</div>';
  }

  function pane() {
    var n = node();
    if (!n) return;
    n.innerHTML = '<div class="loading">Reading the gift seasons…</div>';
    A.api('/api/admin/gifts').then(function (d) { G.data = d; G.edit = null; paintList(); }).catch(fail);
  }

  function post(body) {
    G.busy = true;
    return A.api('/api/admin/gifts', { method: 'POST', body: body }).then(function (d) {
      G.busy = false;
      G.data = d;
      return d;
    }, function (e) { G.busy = false; throw e; });
  }

  /* ---- the list ----------------------------------------------------------- */

  function paintList() {
    var d = G.data;
    var n = node();
    var seasons = d.seasons || [];
    var live = seasons.filter(function (s) { return s.id === d.live; })[0];
    var next = seasons.filter(function (s) { return s.id === d.next; })[0];
    var hidden = d.page && d.page.hidden;
    var out = [];
    out.push('<div class="panel"><div class="gx-top"><div><h3>The gifts page</h3>'
      + '<p class="hint" style="margin:0">gifts.html, in Get Involved under Give and partner, and in the footer.</p></div>'
      + '<span class="vis" role="group" aria-label="The gifts page on the site">'
      + '<button type="button" data-gx="page" data-to="1" aria-pressed="' + String(!hidden) + '">Visible</button>'
      + '<button type="button" data-gx="page" data-to="0" aria-pressed="' + String(Boolean(hidden)) + '">Hidden</button></span></div>'
      + '<p class="gx-now">' + (hidden
        ? '<b>Hidden.</b> The page, and every link to it in the menus, the footer and the search, are off the site. Seasons can still be set up and scheduled.'
        : live
          ? '<b>On the page today: ' + esc(live.name + ' ' + live.year) + '</b>, until ' + esc(day(live.endDate)) + '.'
          : '<b>No season on today.</b> The page shows its year-round gifts.')
      + (next ? ' Next: ' + esc(next.name + ' ' + next.year) + ', from ' + esc(day(next.startDate)) + '.' : '') + '</p>'
      + (G.note ? '<p class="note">' + esc(G.note) + '</p>' : '')
      + '</div>');

    out.push('<div class="gx-top" style="margin:0 0 12px"><p class="lab" style="margin:0">Seasons</p><button class="press" type="button" data-gx="new">New season</button></div>');
    if (!seasons.length) {
      out.push('<div class="empty"><b>No seasons yet</b>Add Deepawali, Christmas or New Year: its dates, its collections and its offers. It shows on the page by itself between its dates.</div>');
    } else {
      out.push('<div class="wrap gx-wrap"><table class="gx-table"><thead><tr><th>Season</th><th>Dates</th><th>State</th><th>On it</th><th></th></tr></thead><tbody>');
      seasons.forEach(function (s) {
        var gifts = (s.collections || []).reduce(function (t, c) { return t + (c.items || []).length; }, 0);
        out.push('<tr><td><b>' + esc(s.name + ' ' + s.year) + '</b><span class="detail">' + esc(s.headline || 'No headline yet') + '</span></td>'
          + '<td>' + esc(day(s.startDate)) + '<span class="detail">to ' + esc(day(s.endDate)) + '</span></td>'
          + '<td><span class="flag" data-s="' + esc(s.state) + '">' + esc(STATE[s.state] || s.state) + '</span></td>'
          + '<td>' + (s.collections || []).length + ((s.collections || []).length === 1 ? ' collection' : ' collections') + '<span class="detail">' + gifts + (gifts === 1 ? ' gift' : ' gifts') + ', ' + (s.offers || []).length + ((s.offers || []).length === 1 ? ' offer' : ' offers') + '</span></td>'
          + '<td><span class="gx-acts"><button class="ghost" type="button" data-gx="edit" data-id="' + esc(s.id) + '">Edit</button>'
          + '<button class="ghost" type="button" data-gx="copy" data-id="' + esc(s.id) + '" title="The same season a year on, as a draft">Copy to ' + (Number(s.year) + 1) + '</button>'
          + '<button class="ghost danger" type="button" data-gx="remove" data-id="' + esc(s.id) + '">Remove</button></span></td></tr>');
      });
      out.push('</tbody></table></div>');
    }
    n.innerHTML = out.join('');
    A.say($('#paneNote'), live ? 'On the page: ' + live.name + ' ' + live.year : 'No season on today');
  }

  /* ---- the form ----------------------------------------------------------- */

  function blankCollection() { return { title: '', blurb: '', items: [] }; }
  function startEdit(id) {
    var d = G.data;
    var s = (d.seasons || []).filter(function (x) { return x.id === id; })[0];
    G.editId = s ? s.id : '';
    G.edit = s ? JSON.parse(JSON.stringify({
      occasion: s.occasion, name: s.name, year: s.year, startDate: s.startDate, endDate: s.endDate, status: s.status,
      headline: s.headline, intro: s.intro, offers: s.offers || [], collections: s.collections || []
    })) : {
      occasion: 'deepawali', name: '', year: Number(String(d.today || '').slice(0, 4)) || new Date().getFullYear(),
      startDate: '', endDate: '', status: 'draft', headline: '', intro: '', offers: [], collections: [blankCollection()]
    };
    if (!G.edit.collections.length) G.edit.collections.push(blankCollection());
    paintForm('');
  }

  function field(label, html) { return '<label class="gx-f"><span>' + esc(label) + '</span>' + html + '</label>'; }
  function input(attrs, value, type) {
    return '<input ' + attrs + ' type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '">';
  }

  function paintForm(error, focus) {
    var e = G.edit;
    var d = G.data;
    var occ = (d.occasions || []).map(function (o) {
      return '<option value="' + esc(o.key) + '"' + (o.key === e.occasion ? ' selected' : '') + '>' + esc(o.name || 'Another occasion') + '</option>';
    }).join('');
    var out = [];
    out.push('<div class="gx-form">');
    out.push('<div><button class="ghost" type="button" data-gx="back">Back to the seasons</button></div>');
    out.push('<div class="panel" style="margin:0"><h3>' + (G.editId ? 'Edit ' + esc(e.name + ' ' + e.year) : 'A new season') + '</h3>'
      + '<p class="hint">It shows on the gifts page by itself from its first day to its last, India time, once it is published. If two seasons overlap, the one that started last is shown.</p>'
      + '<div class="gx-row">' + field('Occasion', '<select data-f="occasion">' + occ + '</select>')
      + (e.occasion === 'other' ? field('Its name', input('data-f="name" maxlength="40" placeholder="Mother’s Day"', e.name)) : '')
      + field('Year', input('data-f="year" min="2024" max="2100" inputmode="numeric"', e.year, 'number'))
      + field('First day', input('data-f="startDate"', e.startDate, 'date'))
      + field('Last day', input('data-f="endDate"', e.endDate, 'date')) + '</div>'
      + '<div class="gx-radio" role="radiogroup" aria-label="Status" style="margin-top:16px">'
      + '<label><input type="radio" name="gxStatus" data-f="status" value="draft"' + (e.status !== 'published' ? ' checked' : '') + '> Draft: not on the page</label>'
      + '<label><input type="radio" name="gxStatus" data-f="status" value="published"' + (e.status === 'published' ? ' checked' : '') + '> Published: on the page between its dates</label></div>'
      + '</div>');

    out.push('<div class="gx-box"><h4>The page opens with</h4>'
      + field('Headline', input('data-f="headline" maxlength="90" placeholder="Light up their Deepawali."', e.headline))
      + field('A line under it', '<textarea data-f="intro" maxlength="320" placeholder="Gifts that pay for rescue, treatment and care.">' + esc(e.intro || '') + '</textarea>')
      + '</div>');

    out.push('<div class="gx-box"><div class="gx-boxhead"><h4>Offers</h4><button class="ghost" type="button" data-gx="add-offer">Add an offer</button></div>'
      + '<p class="hint" style="margin:0">Shown on the page as written. The shop charges what its prices say and takes no codes, so write only what a shopper will really get.</p>');
    (e.offers || []).forEach(function (o, i) {
      out.push('<div class="gx-line"><div class="gx-row">'
        + field('Offer', input('data-o="' + i + '" data-of="title" maxlength="60" placeholder="Half price on every designer T-shirt"', o.title))
        + field('Until (optional)', input('data-o="' + i + '" data-of="until"', o.until, 'date')) + '</div>'
        + field('A line about it', input('data-o="' + i + '" data-of="detail" maxlength="200"', o.detail))
        + '<div><button class="ghost danger" type="button" data-gx="del-offer" data-i="' + i + '">Remove this offer</button></div></div>');
    });
    out.push('</div>');

    (e.collections || []).forEach(function (c, ci) {
      var chosen = {};
      (c.items || []).forEach(function (it) { if (it.type === 'piece') chosen[it.id] = true; });
      out.push('<div class="gx-box"><div class="gx-boxhead"><h4>Collection ' + (ci + 1) + '</h4>'
        + ((e.collections || []).length > 1 ? '<button class="ghost danger" type="button" data-gx="del-col" data-i="' + ci + '">Remove this collection</button>' : '') + '</div>'
        + '<div class="gx-row">' + field('Title', input('data-c="' + ci + '" data-cf="title" maxlength="60" placeholder="For the ones who have everything"', c.title)) + '</div>'
        + field('A line about it (optional)', input('data-c="' + ci + '" data-cf="blurb" maxlength="200"', c.blurb))
        + '<p class="lab" style="margin:6px 0 0">From the shop</p><div class="gx-pieces">'
        + (d.pieces || []).map(function (p) {
          return '<label class="gx-piece"><input type="checkbox" data-c="' + ci + '" data-piece="' + esc(p.id) + '"' + (chosen[p.id] ? ' checked' : '') + (p.available ? '' : ' disabled') + '>'
            + '<img src="' + esc(SITE + p.image) + '" alt="" loading="lazy"><span>' + esc(p.name) + '<small>' + esc(rupees(p.price)) + (p.available ? '' : ', not on sale') + '</small></span></label>';
        }).join('') + '</div>'
        + '<div class="gx-boxhead" style="margin-top:6px"><p class="lab" style="margin:0">Gift cards that lead elsewhere</p><button class="ghost" type="button" data-gx="add-link" data-i="' + ci + '">Add a gift card</button></div>');
      (c.items || []).forEach(function (it, li) {
        if (it.type !== 'link') return;
        out.push('<div class="gx-line"><div class="gx-row">'
          + field('Title', input('data-c="' + ci + '" data-l="' + li + '" data-lf="title" maxlength="60" placeholder="A donation in their name"', it.title))
          + field('Link', input('data-c="' + ci + '" data-l="' + li + '" data-lf="href" maxlength="300" placeholder="donate.html?gift=1"', it.href))
          + field('Price, as words (optional)', input('data-c="' + ci + '" data-l="' + li + '" data-lf="price" maxlength="30" placeholder="Any amount"', it.price)) + '</div>'
          + '<div class="gx-row">' + field('A line about it', input('data-c="' + ci + '" data-l="' + li + '" data-lf="text" maxlength="160"', it.text))
          + field('Picture (optional)', input('data-c="' + ci + '" data-l="' + li + '" data-lf="image" maxlength="300" placeholder="A picture of the site, or https://"', it.image)) + '</div>'
          + '<div><button class="ghost danger" type="button" data-gx="del-link" data-i="' + ci + '" data-j="' + li + '">Remove this gift card</button></div></div>');
      });
      out.push('</div>');
    });
    out.push('<div><button class="ghost" type="button" data-gx="add-col">Add a collection</button></div>');

    out.push('<div class="gx-foot"><button class="press" type="button" data-gx="save">' + (G.editId ? 'Save the season' : 'Add the season') + '</button>'
      + '<button class="ghost" type="button" data-gx="back">Cancel</button><p class="gx-err" role="alert">' + esc(error || '') + '</p></div>');
    out.push('</div>');
    var n = node();
    n.innerHTML = out.join('');
    if (focus) { var f = n.querySelector(focus); if (f) f.focus(); }
  }

  /* what is typed goes into G.edit as it is typed, so redrawing the form to
     add or remove a line never loses anything */
  function onInput(ev) {
    var t = ev.target;
    var e = G.edit;
    if (!e || !t || !t.getAttribute) return;
    var f = t.getAttribute('data-f');
    if (f) {
      if (f === 'status') { if (t.checked) e.status = t.value; return; }
      e[f] = f === 'year' ? Number(t.value) : t.value;
      if (f === 'occasion') {
        var o = (G.data.occasions || []).filter(function (x) { return x.key === t.value; })[0];
        e.name = o && o.name ? o.name : '';
        paintForm('', '[data-f="occasion"]');
      }
      return;
    }
    var oi = t.getAttribute('data-o');
    if (oi !== null) { e.offers[Number(oi)][t.getAttribute('data-of')] = t.value; return; }
    var ci = t.getAttribute('data-c');
    if (ci === null) return;
    var c = e.collections[Number(ci)];
    if (t.hasAttribute('data-cf')) { c[t.getAttribute('data-cf')] = t.value; return; }
    if (t.hasAttribute('data-piece')) {
      var id = t.getAttribute('data-piece');
      c.items = c.items.filter(function (it) { return !(it.type === 'piece' && it.id === id); });
      if (t.checked) c.items.push({ type: 'piece', id: id });
      return;
    }
    if (t.hasAttribute('data-l')) { c.items[Number(t.getAttribute('data-l'))][t.getAttribute('data-lf')] = t.value; }
  }

  function onClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-gx]') : null;
    if (!b || G.busy) return;
    var act = b.getAttribute('data-gx');
    var e = G.edit;
    var i = Number(b.getAttribute('data-i'));
    if (act === 'new') return startEdit('');
    if (act === 'edit') return startEdit(b.getAttribute('data-id'));
    if (act === 'back') { G.edit = null; G.note = ''; return paintList(); }
    if (act === 'add-offer') { e.offers.push({ title: '', detail: '', until: '' }); return paintForm('', '[data-o="' + (e.offers.length - 1) + '"][data-of="title"]'); }
    if (act === 'del-offer') { e.offers.splice(i, 1); return paintForm(''); }
    if (act === 'add-col') { e.collections.push(blankCollection()); return paintForm('', '[data-c="' + (e.collections.length - 1) + '"][data-cf="title"]'); }
    if (act === 'del-col') { if (window.confirm('Remove collection ' + (i + 1) + ' and everything in it?')) { e.collections.splice(i, 1); paintForm(''); } return undefined; }
    if (act === 'add-link') { e.collections[i].items.push({ type: 'link', title: '', text: '', href: '', image: '', price: '' }); return paintForm(''); }
    if (act === 'del-link') { e.collections[i].items.splice(Number(b.getAttribute('data-j')), 1); return paintForm(''); }
    if (act === 'save') {
      b.disabled = true;
      return post({ action: 'save', id: G.editId || undefined, season: e }).then(function () {
        G.note = (G.editId ? 'Saved. ' : 'Added. ') + (e.status === 'published' ? 'It is on the page between its dates.' : 'It is a draft: publish it to put it on the page.');
        G.edit = null;
        paintList();
      }, function (err) { b.disabled = false; var m = node().querySelector('.gx-err'); if (m) m.textContent = (err && err.message) || 'That could not be saved.'; });
    }
    if (act === 'copy') {
      return post({ action: 'copy', id: b.getAttribute('data-id') }).then(function (d) {
        G.note = 'Copied, as a draft, with its dates a year on. Check the dates, then publish it.';
        startEdit(d.saved);
      }, function (err) { G.note = (err && err.message) || 'That could not be copied.'; paintList(); });
    }
    if (act === 'remove') {
      var s = (G.data.seasons || []).filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
      if (!s || !window.confirm('Remove ' + s.name + ' ' + s.year + ' from the list?' + (s.state === 'live' ? ' It is on the page now; the page goes back to its year-round gifts.' : '') + ' It stays in PFA\u2019s records.')) return undefined;
      return post({ action: 'remove', id: s.id }).then(function () { G.note = s.name + ' ' + s.year + ' removed.'; paintList(); }, function (err) { G.note = (err && err.message) || 'That could not be removed.'; paintList(); });
    }
    if (act === 'page') {
      var visible = b.getAttribute('data-to') === '1';
      if (b.getAttribute('aria-pressed') === 'true') return undefined;
      if (!visible && !window.confirm('Hide the gifts page? It leaves the site, with every link to it, within a few seconds.')) return undefined;
      return post({ action: 'page', visible: visible }).then(function () { G.note = visible ? 'The gifts page is back on the site.' : 'The gifts page is hidden.'; paintList(); }, function (err) { G.note = (err && err.message) || 'That could not be changed.'; paintList(); });
    }
    return undefined;
  }

  var wired = false;
  function wire() {
    var n = node();
    if (!n || wired) return;
    wired = true;
    n.addEventListener('input', onInput);
    n.addEventListener('change', onInput);
    n.addEventListener('click', onClick);
  }

  window.PFAGifts = { pane: function () { wire(); G.note = ''; pane(); } };
})();
