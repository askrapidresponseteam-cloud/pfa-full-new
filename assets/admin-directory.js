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
    '.dr-bday{white-space:nowrap}',
    /* the Map (18 Nov 2026) */
    '.dr-view{display:inline-flex;border:1px solid var(--line)}.dr-view button{min-height:38px;padding:0 16px;border:0;border-right:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--muted);cursor:pointer}.dr-view button:last-child{border-right:0}.dr-view button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}',
    '.dr-map{height:min(70vh,620px);min-height:380px;border:1px solid var(--line);background:#e9eef3;position:relative;z-index:0}',
    '.dr-dt{font:500 12px/1.3 var(--sans,Arial,sans-serif);padding:4px 8px;white-space:normal;max-width:240px}',
    '.dr-pop{font:13px/1.45 var(--sans,inherit);min-width:220px;max-width:300px}.dr-pop h4{margin:0 0 6px;font-size:13px;font-weight:700}.dr-pop ul{list-style:none;margin:0 0 8px;padding:0;max-height:220px;overflow:auto}.dr-pop li{padding:5px 0;border-top:1px solid #eee}.dr-pop li small{display:block;color:#666}.leaflet-container .dr-pop a{color:inherit}',
    '.dr-pop button{min-height:34px;padding:0 12px;border:1px solid #111;background:#111;color:#fff;font:inherit;font-size:12px;cursor:pointer}',
    '@media (max-width:700px){.dr-table thead{display:none}.dr-table,.dr-table tbody,.dr-table tr,.dr-table td{display:block;width:100%}.dr-table tr{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 4px;padding:14px;border-bottom:1px solid var(--line)}.dr-table td{padding:0;border:0;grid-column:1 / -1}.dr-table td:nth-child(3){order:-2;font-size:15px}.dr-table td[data-place]{order:-1;grid-column:auto;color:var(--muted);font-size:12px}.dr-table td:nth-child(1)::after{content:","}.dr-table td[data-bday]::before{content:"Birthday ";color:var(--muted)}.dr-table td[data-bday=""]{display:none}.dr-addr{min-width:0}.dr-wrap{overflow:visible}}'
  ].join('');
  document.head.appendChild(style);

  var D = { data: null, cat: '', state: '', district: '', q: '', shown: 200, view: 'list', map: null };
  var PAGE = 200;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function node() { return $('[data-pane="directory"]'); }
  function day(ms) {
    if (!ms) return '';
    var d = new Date(Number(ms) + 330 * 60000);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  /* 1990-05-12 as 12 May 1990 (the date of birth, where one was given) */
  function born(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
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
    var hay = [p.name, p.mobile, p.otherMobiles.join(' '), p.email, p.address, p.district, p.state, p.pin, born(p.dob), p.records.map(function (r) { return r.id; }).join(' ')].join(' ').toLowerCase();
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
      + '<span class="dr-view" role="group" aria-label="Show as"><button type="button" data-dr-view="list" aria-pressed="' + String(D.view === 'list') + '">List</button><button type="button" data-dr-view="map" aria-pressed="' + String(D.view === 'map') + '">Map</button></span>'
      + '<button class="ghost" type="button" data-dr="csv">Download for Excel</button></div>');
    var on = rows.filter(function (p) { return p.at; });
    out.push('<p class="dr-line" role="status">' + (rows.length === people.length ? 'Showing everyone.' : 'Showing <b>' + rows.length + '</b> of ' + people.length + '.')
      + (D.view === 'map'
        ? (on.length === rows.length ? '' : ' ' + (rows.length - on.length) + ' gave no PIN or district, so are not on the map.') + ' Each dot is a PIN code, bigger where more people share it; a pale dot is a district, for someone with no PIN. Tap a dot to see who.'
        : ' A state or district marked * was read from the PIN code.') + '</p>');
    if (D.map) { try { D.map.remove(); } catch (_) { /* gone with the page */ } D.map = null; }
    if (!rows.length) {
      out.push('<div class="empty"><b>No one matches</b>Clear a filter or the search to see more.</div>');
    } else if (D.view === 'map') {
      out.push('<div class="dr-map" id="drMap" role="region" aria-label="Map of the people shown"></div>');
    } else {
      out.push('<div class="wrap dr-wrap"><table class="dr-table"><thead><tr><th>State</th><th>District</th><th>Name</th><th>Address</th><th>Phone</th><th>Birthday</th><th>Category</th></tr></thead><tbody>');
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
          + '<td class="dr-bday" data-bday="' + esc(p.dob || '') + '">' + (p.dob ? esc(born(p.dob)) : '-') + '</td>'
          + '<td><span class="dr-tags">' + p.categories.map(function (c) { return '<span class="flag">' + esc(label(c)) + '</span>'; }).join('') + '</span>'
          + '<span class="detail" title="' + esc(p.records.map(function (r) { return r.id; }).join(', ')) + '">' + p.records.length + (p.records.length === 1 ? ' record' : ' records') + ', last ' + esc(day(p.last)) + '</span></td>'
          + '</tr>');
      });
      out.push('</tbody></table></div>');
      if (rows.length > D.shown) out.push('<div class="more"><button class="ghost" type="button" data-dr="more">Show ' + Math.min(PAGE, rows.length - D.shown) + ' more of ' + (rows.length - D.shown) + '</button></div>');
    }
    n.innerHTML = out.join('');
    if (D.view === 'map' && rows.length) drawMap(rows);
    if (focus) {
      var f = n.querySelector(focus);
      if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
    }
    A.say($('#paneNote'), people.length + (people.length === 1 ? ' person' : ' people'));
  }

  /* ---- the Map (owner, 18 Nov 2026: "can you give map view") ----------
     Leaflet, served from the site, over OpenStreetMap's map, as RRT's own
     map. Each person is at their PIN code's place (India Post's directory,
     lib/pin-places.js), or their district's middle when they gave no PIN;
     no address goes anywhere to be placed. */
  var leaflet = null;
  function needLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    var me = document.querySelector('script[src*="admin-directory.js"]');
    var v = me && /\?v=([^&]+)/.exec(me.getAttribute('src') || '');
    var tag = v ? '?v=' + v[1] : '';
    leaflet = new Promise(function (ok, no) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/vendor/leaflet/leaflet.css' + tag; document.head.appendChild(css);
      var js = document.createElement('script'); js.src = 'assets/vendor/leaflet/leaflet.js' + tag;
      js.onload = function () { if (window.L) ok(window.L); else no(new Error('map')); };
      js.onerror = function () { leaflet = null; no(new Error('map')); };
      document.head.appendChild(js);
    });
    return leaflet;
  }
  /* District borders (owner, 21 Nov 2026: "can you have district borders in
     the map using https://github.com/abhatia08/india_shp_2020"): India's
     735 districts of 2020, simplified to about 300 KB, from the site's own
     copy (assets/vendor/india-districts/SOURCE.txt). Fetched once, the
     first time the map opens. */
  var borders = null;
  function needBorders(tag) {
    if (borders) return borders;
    borders = fetch('assets/vendor/india-districts/india-districts.json' + tag, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('borders'); return r.json(); })
      .catch(function () { borders = null; return null; });
    return borders;
  }
  function drawBorders(L, map, geo) {
    if (!geo || !geo.features) return;
    /* under the dots, which stay where they are clicked */
    map.createPane('drBorders').style.zIndex = 350;
    var renderer = L.canvas({ pane: 'drBorders', padding: 0.5 });
    var districts = geo.features.filter(function (f) { return f.properties && f.properties.d; });
    var states = geo.features.filter(function (f) { return f.properties && f.properties.k === 'state'; });
    L.geoJSON({ type: 'FeatureCollection', features: districts }, {
      pane: 'drBorders', renderer: renderer,
      style: { color: '#4a5866', weight: 0.7, opacity: 0.55, fill: true, fillOpacity: 0, fillColor: '#4a5866' },
      onEachFeature: function (f, layer) {
        layer.bindTooltip(esc(f.properties.d) + (f.properties.s ? ', ' + esc(f.properties.s) : ''), { sticky: true, direction: 'top', className: 'dr-dt' });
        layer.on('mouseover', function () { layer.setStyle({ fillOpacity: 0.08, weight: 1.4, opacity: 0.9 }); });
        layer.on('mouseout', function () { layer.setStyle({ fillOpacity: 0, weight: 0.7, opacity: 0.55 }); });
      }
    }).addTo(map);
    L.geoJSON({ type: 'FeatureCollection', features: states }, {
      pane: 'drBorders', renderer: renderer, interactive: false,
      style: { color: '#1f2933', weight: 1.6, opacity: 0.8 }
    }).addTo(map);
  }
  function drawMap(rows) {
    var box = document.getElementById('drMap');
    if (!box) return;
    var me = document.querySelector('script[src*="admin-directory.js"]');
    var v = me && /\?v=([^&]+)/.exec(me.getAttribute('src') || '');
    var tag = v ? '?v=' + v[1] : '';
    Promise.all([needLeaflet(), needBorders(tag)]).then(function (got) {
      var L = got[0];
      if (!document.body.contains(box)) return;
      var map = L.map(box, { scrollWheelZoom: true, worldCopyJump: false });
      D.map = map;
      /* OpenStreetMap turns away a map image that does not say which site
         asked for it (its tile policy; owner's screenshot, 18 Nov 2026:
         "Access blocked" on every square). The panel sends no referrer at
         all (admin.html), so the map's images alone say the site's name:
         the origin only, never the panel's page or anything after it. */
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        referrerPolicy: 'strict-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
      }).addTo(map);
      drawBorders(L, map, got[1]);
      var spots = {};
      rows.forEach(function (p) {
        if (!p.at) return;
        var k = p.at[0] + ',' + p.at[1];
        (spots[k] || (spots[k] = { at: p.at, by: p.atBy, people: [] })).people.push(p);
      });
      var all = [];
      Object.keys(spots).forEach(function (k) {
        var s = spots[k];
        var n = s.people.length;
        var first = s.people[0];
        var where = (s.by === 'pin' ? 'PIN ' + first.pin + ', ' : '') + [first.district, first.state].filter(Boolean).join(', ');
        var dot = L.circleMarker(s.at, { radius: Math.min(22, 6 + 3 * Math.sqrt(n - 1)), color: '#ffffff', weight: 2, fillColor: '#c62828', fillOpacity: s.by === 'pin' ? 0.9 : 0.45 });
        dot.bindTooltip(n === 1 ? esc(first.name || 'No name given') : n + ' people');
        dot.bindPopup('<div class="dr-pop"><h4>' + esc(where) + ' \u00b7 ' + n + (n === 1 ? ' person' : ' people') + '</h4><ul>'
          + s.people.slice(0, 12).map(function (p) {
            return '<li><b>' + esc(p.name || 'No name given') + '</b><small>' + esc(p.categories.map(label).join(', ')) + (p.mobile ? ' \u00b7 <a href="tel:+91' + esc(p.mobile) + '">' + esc(phone(p.mobile)) + '</a>' : '') + '</small></li>';
          }).join('') + (n > 12 ? '<li><small>and ' + (n - 12) + ' more</small></li>' : '') + '</ul>'
          + '<button type="button" data-dr-mapshow="' + esc(s.by === 'pin' ? 'pin:' + first.pin : 'district:' + (first.state || '') + '|' + (first.district || '')) + '">Show ' + (n === 1 ? 'them' : 'these ' + n) + ' in the list</button></div>', { maxWidth: 320 });
        dot.on('popupopen', function () { dot.closeTooltip(); });
        dot.addTo(map);
        all.push(s.at);
      });
      if (all.length) map.fitBounds(all, { padding: [30, 30], maxZoom: 12 });
      else map.setView([22.5, 80], 5);
    }).catch(function () {
      box.innerHTML = '<div class="empty"><b>The map could not be loaded</b>Check the connection and press Map again.</div>';
    });
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
      var b = e.target && e.target.closest ? e.target.closest('[data-dr-cat],[data-dr="csv"],[data-dr="more"],[data-dr-view],[data-dr-mapshow]') : null;
      if (!b) return;
      if (b.hasAttribute('data-dr-view')) { D.view = b.getAttribute('data-dr-view'); D.shown = PAGE; return paint('[data-dr-view="' + D.view + '"]'); }
      /* from a dot: who is there, in the list */
      if (b.hasAttribute('data-dr-mapshow')) {
        var w = b.getAttribute('data-dr-mapshow');
        if (w.indexOf('pin:') === 0) D.q = w.slice(4);
        else { var sd = w.slice(9).split('|'); D.state = sd[0]; D.district = sd[1] || ''; }
        D.view = 'list'; D.shown = PAGE;
        return paint();
      }
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
