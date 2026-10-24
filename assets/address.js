/* People for Animals - the address on every form.
   ------------------------------------------------------------------------
   Owner, 24 Oct 2026, forwarding Maneka Gandhi's own words about a cruelty
   report that reached her with a map link and a PIN code and nothing else:
   "This is NOT working out. 90% of people filling in this rubbish do not
   give any addresses, not even the city." And: "ensure all the forms have
   the address clearly captured and sent to gandhim email ID".

   So every form that writes to PFA carries the same block, and cannot be
   sent without it:

     House, street and area   (a landmark helps)
     PIN code                 6 digits; typed in full, it fills the state,
                              the district and the town from India Post
     City, town or village
     State, District          chosen from the one list the server checks

   The cruelty report also offers "Use my location", which fills the block
   from the phone and attaches a map link to the exact spot, and a place to
   paste a Google Maps link. Neither replaces the address.

   Markup: <fieldset data-address data-kind="PFA-CR" data-legend="Where it is
   happening" data-locate></fieldset> inside the form, anywhere. This file
   fills it, checks it before the page's own send runs, and pfa-forms.js adds
   what is in it to what the page sends (PFAAddress.merge), so no page can
   leave it out. The server holds every form to the same five fields
   (lib/submission-fields.js), and the copy to gandhim shows them as one line
   at the top (lib/submission-forward.js).

   Needs assets/india-districts.js before it; assets/field-rules.js and
   assets/field-validate.js, where the page has them, tidy what is typed.
   ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var doc = root.document;
  var KEYS = ['address', 'pincode', 'city', 'state', 'district'];
  var PIN = /^[1-9]\d{5}$/;
  var LINK = /^https?:\/\/\S+\.\S+/i;
  /* two letters in any script, the server's own test (lib/submission-fields.js);
     a browser too old for Unicode classes judges Latin letters only, and the
     server still judges the rest */
  var WORDS = (function () {
    try { return new RegExp('\\p{L}.*\\p{L}', 'u'); } catch (_) { return /[A-Za-z\u00C0-\u024F].*[A-Za-z\u00C0-\u024F]/; }
  }());

  function india() {
    return root.PFA_INDIA || { STATES: [], districtsOf: function () { return []; }, pairOk: function () { return false; }, isState: function () { return false; } };
  }

  var CSS = '.addr{border:0;margin:6px 0 2px;padding:0;min-width:0;grid-column:1/-1}'
    + '.addr>legend{display:block;width:100%;padding:14px 0 0;margin:0 0 14px;border-top:1px solid rgba(0,0,0,.14);font-size:16px;font-weight:700;letter-spacing:0;text-transform:none;line-height:1.3;color:inherit}'
    + '.addr__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 18px;align-items:start}'
    + '.addr__grid>.field{margin:0;min-width:0}'
    + '.addr__wide{grid-column:1/-1}'
    + '.addr .field select[disabled]{opacity:.55}'
    + '.addr .err{margin:6px 0 0;font-size:12.5px;line-height:1.4;color:#b3261e}'
    + '.addr__tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 16px}'
    + '.addr__locate{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid currentColor;background:none;color:inherit;font:inherit;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}'
    + '.addr__locate[disabled]{opacity:.5;cursor:wait}'
    + '.addr__said{font-size:13px;line-height:1.4;opacity:.8}'
    + '.addr__map{margin:12px 0 0}'
    + '.addr__map>summary{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;list-style:none}'
    + '.addr__map>summary::-webkit-details-marker{display:none}'
    + '.addr__plus{position:relative;width:16px;height:16px;border:1px solid currentColor;border-radius:50%;flex:none}'
    + '.addr__plus::before,.addr__plus::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:1.5px;background:currentColor;transform:translate(-50%,-50%)}'
    + '.addr__plus::after{transform:translate(-50%,-50%) rotate(90deg);transition:transform .2s}'
    + '.addr__map[open] .addr__plus::after{transform:translate(-50%,-50%) rotate(0deg)}'
    + '.addr__map .field{margin:12px 0 0}'
    + '@media (max-width:560px){.addr__grid{grid-template-columns:minmax(0,1fr)}}';

  function style() {
    if (doc.getElementById('pfa-addr-style')) return;
    var s = doc.createElement('style');
    s.id = 'pfa-addr-style';
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* The words of each message, kept here so the page, the server and the
     test agree (lib/submission-fields.js ADDRESS has the same). */
  var SAY = {
    address: 'Add the address: house or building, street and area.',
    addressHere: 'Add where it is: house or shop, street, area, and a landmark.',
    addressShort: 'Add the full address: house or building, street and area.',
    addressNumbers: 'Add the street or area by name, not just numbers.',
    addressCity: 'Add the house or building and the street or area, not just the place name.',
    addressWords: 'Add the house or building and the street or area.',
    pincode: 'Add the 6-digit PIN code.',
    pincodeBad: 'A PIN code is 6 digits and does not start with 0.',
    pincodeNowhere: 'That is not a PIN code in India. Check the six digits.',
    pincodeUnknown: 'India Post has no such PIN code. Check the six digits.',
    city: 'Add the city, town or village.',
    state: 'Choose the state.',
    district: 'Choose the district.',
    mapLink: 'A map link starts with https://'
  };

  function field(block, key) {
    return block.querySelector('[data-addr="' + key + '"]');
  }

  /* Pages show a message one of two ways: <p class="err" hidden> (report,
     ask, careers, the block itself) or <span class="error"> shown by .is-bad
     (get-involved, donate). The page's own wording of an .error is kept, to
     be put back once the box is right. */
  function flag(el, message) {
    if (!el) return;
    var box = el.closest('.field');
    var err = box && box.querySelector('.err');
    var span = !err && box && box.querySelector('.error');
    if (box) box.classList.toggle('is-bad', !!message);
    if (err) { err.textContent = message || ''; err.hidden = !message; }
    if (span) {
      if (!span.hasAttribute('data-said')) span.setAttribute('data-said', span.textContent);
      span.textContent = message || span.getAttribute('data-said');
    }
    if (message) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }

  function districts(block, keep) {
    var I = india();
    var stateEl = field(block, 'state');
    var distEl = field(block, 'district');
    var names = I.districtsOf(stateEl.value);
    distEl.disabled = !names.length;
    distEl.innerHTML = '<option value="">' + (names.length ? 'Choose district' : 'Choose the state first') + '</option>'
      + names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    if (keep && names.indexOf(keep) > -1) distEl.value = keep;
  }

  /* The district list for the state now chosen: the block builds its own;
     a page with its own boxes rebuilds its list on its own change event,
     which this raises (the district chosen is kept where it still fits). */
  function listFor(block, keep) {
    if (block.hasAttribute('data-address')) { districts(block, keep); return; }
    var stateEl = field(block, 'state');
    var distEl = field(block, 'district');
    var ev;
    try { ev = new Event('change', { bubbles: true }); } catch (_) { ev = doc.createEvent('Event'); ev.initEvent('change', true, true); }
    ev.pfaAuto = true;
    stateEl.dispatchEvent(ev);
    if (distEl && keep) { var has = Array.prototype.some.call(distEl.options, function (o) { return o.value === keep; }); if (has) distEl.value = keep; }
  }

  /* A place name as India Post or a map service spells it, matched to the
     list: "Bangalore" is "Bengaluru (Bangalore) Urban" only if no other
     district also matches, or the district is left for the person. */
  function norm(v) {
    return String(v || '').toLowerCase().replace(/&amp;|&/g, ' and ').replace(/[^a-z ]+/g, ' ').replace(/\b(district|city)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function bare(v) { return norm(String(v || '').replace(/\([^)]*\)/g, ' ')); }
  function stateOf(name) {
    var n = norm(name);
    if (!n) return '';
    var all = india().STATES;
    for (var i = 0; i < all.length; i++) if (norm(all[i]) === n) return all[i];
    var hits = all.filter(function (s) { var x = norm(s); return x.indexOf(n) > -1 || n.indexOf(x) > -1; });
    return hits.length === 1 ? hits[0] : '';
  }
  function districtOf(state, name) {
    var n = norm(name);
    if (!state || !n) return '';
    var list = india().districtsOf(state);
    for (var i = 0; i < list.length; i++) if (bare(list[i]) === n || norm(list[i]) === n) return list[i];
    var hits = list.filter(function (d) { return norm(d).indexOf(n) > -1; });
    return hits.length === 1 ? hits[0] : '';
  }

  /* What came back from India Post or the map service, put in the boxes the
     person has not filled already. */
  /* A box this filled in (not the person) says so, and is the one a later
     PIN may fill again; anything the person typed or chose is theirs. */
  function free(el, overwrite) {
    return overwrite || !String(el.value || '').trim() || el.getAttribute('data-auto') === 'yes';
  }
  function put(el, value) {
    el.value = value;
    el.setAttribute('data-auto', 'yes');
    flag(el, '');
  }
  function fill(block, place, overwrite) {
    if (!place) return false;
    var did = false;
    var stateEl = field(block, 'state');
    var distEl = field(block, 'district');
    var cityEl = field(block, 'city');
    var pinEl = field(block, 'pincode');
    var addrEl = field(block, 'address');
    var s = stateOf(place.state);
    if (s && stateEl && free(stateEl, overwrite) && stateEl.value !== s) { put(stateEl, s); listFor(block, distEl ? distEl.value : ''); did = true; }
    var d = stateEl ? districtOf(stateEl.value, place.district) || districtOf(stateEl.value, place.city) : '';
    if (d && distEl && free(distEl, overwrite)) { put(distEl, d); did = true; }
    var c = String(place.city || '').trim();
    if (/^n\.?a\.?$/i.test(c)) c = '';
    if (c && cityEl && free(cityEl, overwrite)) { put(cityEl, c); did = true; }
    if (place.pincode && PIN.test(place.pincode) && pinEl && free(pinEl, overwrite)) { put(pinEl, place.pincode); did = true; }
    if (place.street && addrEl && !addrEl.value.trim()) { addrEl.value = place.street; did = true; }
    return did;
  }

  function lookup(query) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('no fetch'));
    return root.fetch('/api/location-lookup?' + query, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (r.ok) return body;
          var e = new Error('HTTP ' + r.status);
          e.code = body && body.code;
          throw e;
        });
      });
  }

  /* What India Post said about each PIN asked on this page: its place, or
     'unknown'. A PIN it could not be asked about is simply not judged. */
  var verdicts = {};

  /* The states a PIN can be in, in words: "West Bengal", "Punjab or
     Chandigarh". */
  function pinWhere(pin) {
    var list = (india().pinStates || function () { return []; })(pin);
    return list.length > 2 ? list.slice(0, 2).join(', ') + ' or ' + list[2] : list.join(' or ');
  }

  /* Everything wrong with a PIN, given the state chosen beside it. */
  function pinMessage(p, s) {
    var I = india();
    if (!p) return SAY.pincode;
    if (!PIN.test(p)) return SAY.pincodeBad;
    if (I.pinStates && !I.pinStates(p).length) return SAY.pincodeNowhere;
    if (verdicts[p] === 'unknown') return SAY.pincodeUnknown;
    if (s && I.pinOk && I.isState(s) && !I.pinOk(s, p)) return 'PIN code ' + p + ' is in ' + (pinWhere(p) || 'another state') + ', not ' + s + '. Check the PIN code or the state.';
    return '';
  }

  function say(block, text) {
    var el = block.querySelector('.addr__said');
    if (el) el.textContent = text || '';
  }

  function locate(block, button) {
    var geo = root.navigator && root.navigator.geolocation;
    if (!geo) { say(block, 'This browser cannot share where you are. Type the address instead.'); return; }
    button.disabled = true;
    say(block, 'Finding where you are…');
    geo.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude.toFixed(6);
      var lng = pos.coords.longitude.toFixed(6);
      var map = field(block, 'mapLink');
      if (map) map.value = 'https://maps.google.com/?q=' + lat + ',' + lng;
      lookup('lat=' + lat + '&lng=' + lng)
        .then(function (place) {
          fill(block, place, false);
          say(block, 'Filled in from your phone, with a map link to the spot. Check it, and add the house, street or a landmark.');
        })
        .catch(function () { say(block, 'A map link to the spot is attached. Type the address too.'); })
        .then(function () { button.disabled = false; });
    }, function () {
      button.disabled = false;
      say(block, 'Your location was not shared. Type the address instead.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  var made = 0;
  function mount(block) {
    if (!block || block.getAttribute('data-address-ready') === 'yes') return;
    block.setAttribute('data-address-ready', 'yes');
    style();
    made += 1;
    var id = 'addr' + made + '-';
    var here = block.hasAttribute('data-locate');
    var legend = block.getAttribute('data-legend') || 'Your address';
    var I = india();
    var need = function (key) { return here && key === 'address' ? SAY.addressHere : SAY[key]; };
    var box = function (key, label, control, wide) {
      return '<div class="field' + (wide ? ' addr__wide' : '') + '"><label for="' + id + key + '">' + label + '</label>' + control + '<p class="err" hidden></p></div>';
    };
    block.classList.add('addr');
    block.innerHTML = '<legend>' + esc(legend) + '</legend>'
      + (here ? '<p class="addr__tools"><button class="addr__locate" type="button">Use my location</button><span class="addr__said" role="status" aria-live="polite"></span></p>' : '')
      + '<div class="addr__grid">'
      + box('address', here ? 'House or shop, street and area' : 'House or flat, street and area',
        '<input id="' + id + 'address" name="address" data-addr="address" required data-say="' + esc(need('address')) + '" autocomplete="street-address" placeholder="' + (here ? 'A landmark helps: near the temple, opposite the bank' : 'House or flat number, building, street, area') + '">', true)
      + box('pincode', 'PIN code',
        '<input id="' + id + 'pincode" name="pincode" data-addr="pincode" required data-say="' + esc(SAY.pincode) + '" inputmode="numeric" maxlength="6" autocomplete="postal-code" placeholder="6 digits">')
      + box('city', 'City, town or village',
        '<input id="' + id + 'city" name="city" data-addr="city" required data-say="' + esc(SAY.city) + '" autocomplete="address-level2">')
      + box('state', 'State',
        '<select id="' + id + 'state" name="state" data-addr="state" required data-say="' + esc(SAY.state) + '"><option value="">Choose state</option>'
        + I.STATES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>')
      + box('district', 'District',
        '<select id="' + id + 'district" name="district" data-addr="district" required data-say="' + esc(SAY.district) + '" disabled><option value="">Choose the state first</option></select>')
      + '</div>'
      + (here
        ? '<details class="addr__map"><summary><span class="addr__plus" aria-hidden="true"></span>Add a Google Maps link</summary>'
          + box('mapLink', 'Google Maps link <small>(optional)</small>', '<input id="' + id + 'mapLink" name="mapLink" data-addr="mapLink" type="url" inputmode="url" placeholder="https://maps.app.goo.gl/...">')
          + '</details>'
        : '');

    wire(block, true);
  }

  /* The PIN's intelligence and the boxes' messages, on the block or on a
     form's own boxes (enhance). `ours` is false where the page builds its
     own district list. */
  function wire(block, ours) {
    var stateEl = field(block, 'state');
    var pinEl = field(block, 'pincode');
    if (!stateEl || !pinEl) return;
    stateEl.addEventListener('change', function () {
      if (ours) districts(block, field(block, 'district').value);
      flag(stateEl, '');
      if (field(block, 'district')) flag(field(block, 'district'), '');
      /* a state that does not hold the PIN already typed says so on the PIN */
      var pv = pinEl.value.replace(/\D/g, '');
      if (PIN.test(pv)) flag(pinEl, pinMessage(pv, stateEl.value));
    });
    /* a box being corrected loses its message; the PIN says its own */
    var mine = function (e) {
      var k = e.target.getAttribute('data-addr');
      if (k && e.isTrusted !== false && !e.pfaAuto) e.target.removeAttribute('data-auto');
      return k && k !== 'pincode';
    };
    block.addEventListener('input', function (e) { if (mine(e)) flag(e.target, ''); });
    block.addEventListener('change', function (e) { if (mine(e) && e.target !== stateEl) flag(e.target, ''); });
    /* A PIN typed in full fills the state, district and town the person has
       not chosen yet. Best effort: India Post may be slow or down, and then
       the person simply chooses them. */
    var asked = '';
    /* Heard on the document, after the form's own input handler: a page that
       clears a box's message on every keystroke (donate, get-involved, the
       shop) clears it first, and the PIN's verdict is what stays. */
    doc.addEventListener('input', function (e) {
      if (e.target !== pinEl) return;
      var v = pinEl.value.replace(/\D/g, '');
      if (v.length < 6) { flag(pinEl, ''); return; }
      if (!PIN.test(v)) { flag(pinEl, pinMessage(v, stateEl.value)); return; }
      if (v === asked && verdicts[v]) {
        if (verdicts[v] !== 'unknown') fill(block, verdicts[v], false);
        flag(pinEl, pinMessage(v, stateEl.value));
        return;
      }
      asked = v;
      var I = india();
      /* at once, without the network: the state the PIN belongs to, when
         only one can be meant; a state this filled for an earlier PIN is
         replaced, one the person chose is not */
      var where = I.pinStates ? I.pinStates(v) : [];
      if (free(stateEl, false)) {
        if (where.length === 1 && stateEl.value !== where[0]) { put(stateEl, where[0]); listFor(block, ''); }
        else if (where.length !== 1 && stateEl.getAttribute('data-auto') === 'yes') { stateEl.value = ''; listFor(block, ''); }
      }
      if (verdicts[v] && verdicts[v] !== 'unknown') fill(block, verdicts[v], false);
      flag(pinEl, pinMessage(v, stateEl.value));
      /* then India Post: does it exist, and where is it */
      lookup('pin=' + v).then(function (place) {
        verdicts[v] = place || {};
        if (pinEl.value.replace(/\D/g, '') !== v) return;
        fill(block, place, false);
        flag(pinEl, pinMessage(v, stateEl.value));
      }).catch(function (e) {
        if (e && e.code === 'UNKNOWN_PIN') {
          verdicts[v] = 'unknown';
          if (pinEl.value.replace(/\D/g, '') === v) flag(pinEl, SAY.pincodeUnknown);
        }
      });
    });
    var locateBtn = block.querySelector('.addr__locate');
    if (locateBtn) locateBtn.addEventListener('click', function () { locate(block, locateBtn); });
  }

  /* A form that has its own address boxes already (the membership and
     caregiver forms, donate) gets the same PIN intelligence: the state,
     district and town filled from a PIN typed in full, and a PIN that
     cannot be in the state chosen said so on the PIN. `els` names the
     boxes: { pincode, state, district, city, address }. */
  function enhance(form, els) {
    if (!form || !els || !els.pincode || !els.state || form.getAttribute('data-address-wired') === 'yes') return;
    form.setAttribute('data-address-wired', 'yes');
    style();
    Object.keys(els).forEach(function (k) { if (els[k]) els[k].setAttribute('data-addr', k); });
    wire(form, false);
  }

  /* The block's own check. Returns the first control that needs attention,
     or null; flags every one that does. */
  function check(block) {
    if (!block) return null;
    var I = india();
    var here = block.hasAttribute('data-locate');
    var first = null;
    var mark = function (key, message) {
      var el = field(block, key);
      flag(el, message);
      if (message && !first) first = el;
    };
    var v = function (key) { var el = field(block, key); return el ? String(el.value || '').trim() : ''; };
    var a = v('address');
    var c = v('city');
    var s = v('state');
    var d = v('district');
    var same = function (x) { return x && a.toLowerCase().replace(/[^a-z]/g, '') === x.toLowerCase().replace(/[^a-z]/g, ''); };
    mark('address', !a ? (here ? SAY.addressHere : SAY.address)
      : a.replace(/\s/g, '').length < 8 ? SAY.addressShort
      : !WORDS.test(a) ? SAY.addressNumbers
      : same(c) || same(d) || same(s) ? SAY.addressCity
      : a.split(/[\s,]+/).filter(Boolean).length < 2 && !/^https?:/i.test(a) ? SAY.addressWords : '');
    mark('pincode', pinMessage(v('pincode').replace(/\D/g, ''), s));
    var R = root.PFA_RULES;
    mark('city', !c ? SAY.city : (R && R.checkField ? R.checkField('city', c, { required: false }) : '') || '');
    mark('state', !s ? SAY.state : !I.isState(s) ? SAY.state : '');
    mark('district', !d ? SAY.district : s && !I.pairOk(s, d) ? 'Choose a district in ' + s + '.' : '');
    var m = v('mapLink');
    if (field(block, 'mapLink')) mark('mapLink', m && !LINK.test(m) ? SAY.mapLink : '');
    return first;
  }

  /* What the block holds, ready to send. */
  function read(block) {
    var out = {};
    var R = root.PFA_RULES;
    KEYS.concat(['mapLink']).forEach(function (key) {
      var el = field(block, key);
      if (!el) return;
      var value = String(el.value || '').trim();
      if (key === 'pincode') value = value.replace(/\D/g, '');
      else if (R && R.normaliseField && (key === 'address' || key === 'city')) value = R.normaliseField(key, value);
      out[key] = value;
    });
    if (!out.mapLink) delete out.mapLink;
    return out;
  }

  function shown(block) {
    return !block.closest('[hidden]') && !block.closest('[inert]');
  }

  function blocksFor(kind) {
    return Array.prototype.slice.call(doc.querySelectorAll('[data-address]')).filter(function (b) {
      return (' ' + (b.getAttribute('data-kind') || '') + ' ').indexOf(' ' + kind + ' ') > -1;
    });
  }

  /* pfa-forms.js asks this before it sends anything: the address of the
     form being sent, checked, added to what the page collected. */
  function merge(kind, data) {
    var blocks = blocksFor(kind);
    if (!blocks.length) return { data: data };
    var block = blocks.filter(shown)[0] || blocks[0];
    var bad = check(block);
    if (bad) {
      try { bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); bad.focus({ preventScroll: true }); } catch (_) { /* best effort */ }
      var err = bad.closest('.field') && bad.closest('.field').querySelector('.err');
      return { error: (err && err.textContent) || SAY.address, field: bad };
    }
    var out = {};
    Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
    var place = read(block);
    Object.keys(place).forEach(function (k) { out[k] = place[k]; });
    return { data: out };
  }

  function mountAll() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-address]'), mount);
  }

  /* Before the page's own send: an address that is not complete stops the
     send here, says which box, and puts the cursor in it. A form in screens
     (assets/micro.js) checks the block on its own screen as well. */
  doc.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.querySelectorAll) return;
    /* a page that checks the block with its own fields, so every problem is
       shown at once, says so on the form */
    if (form.hasAttribute('data-address-own')) return;
    var blocks = Array.prototype.slice.call(form.querySelectorAll('[data-address]')).filter(shown);
    var first = null;
    blocks.forEach(function (b) { var bad = check(b); if (bad && !first) first = bad; });
    if (!first) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.focus({ preventScroll: true }); } catch (_) { /* best effort */ }
  }, true);

  /* A form in steps (assets/chrome.js data-steps) asks each step to be
     checked with pfa:step-check before Continue: a step holding the block
     goes no further until the address is right. */
  doc.addEventListener('pfa:step-check', function (e) {
    var step = e.detail && e.detail.step;
    if (!step || !step.querySelectorAll) return;
    var bad = false;
    Array.prototype.forEach.call(step.querySelectorAll('[data-address]'), function (b) { if (check(b)) bad = true; });
    if (bad) e.preventDefault();
  }, true);

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  root.PFAAddress = {
    mount: mount, mountAll: mountAll, check: check, read: read, merge: merge, fill: fill, enhance: enhance,
    /* for a page's own checks: what is wrong with this PIN beside this state, or '' */
    pinProblem: function (pin, state) { return pinMessage(String(pin || '').replace(/\D/g, ''), String(state || '')); },
    SAY: SAY, _stateOf: stateOf, _districtOf: districtOf
  };
})(typeof window !== 'undefined' ? window : this);
