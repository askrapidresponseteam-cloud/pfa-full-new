/* Where an intern does their shelter work (owner, 3 Nov 2026: "before one
   starts, the applicant needs to enter where they plan to work. the address
   in full with phone number, 2-3 photos of the place. this needs to come to
   admin and it has to start building a directory"). The server side is
   lib/intern-shelters.js. intern.html calls PFAShelter.init() with its own
   helpers, and PFAShelter.card() on the shelter task's card: the place they
   named, or the form to name it. Any shelter: PFA does not have to know it. */
(function (root) {
  'use strict';
  var H = null;
  var INDIA = root.PFA_INDIA || { STATES: [], districtsOf: function () { return []; } };

  function esc(v) { return H.esc(v); }

  function field(name, label, opts) {
    var o = opts || {};
    return '<div class="ip-field"><label for="sh-' + name + '">' + esc(label) + (o.optional ? ' (optional)' : '') + '</label>'
      + (o.select ? '<select id="sh-' + name + '" name="' + name + '">' + o.select + '</select>'
        : '<input id="sh-' + name + '" name="' + name + '"' + (o.type ? ' type="' + o.type + '"' : '') + (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + ' maxlength="' + (o.max || 120) + '"' + (o.raw ? ' data-no-filter' : '') + (o.auto ? ' autocomplete="' + o.auto + '"' : ' autocomplete="off"') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>')
      + (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</div>';
  }

  function form(changing) {
    var states = '<option value="">Choose the state</option>' + INDIA.STATES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    return '<form class="ip-form sh-form" data-shelter-form novalidate>'
      + '<p class="task__ask">' + (changing ? 'Name the new place.' : 'Before your hours begin, tell PFA where you will work. Any shelter near you: it does not have to be one PFA knows.') + '</p>'
      + field('name', 'The shelter’s name', { max: 120, raw: true })
      + field('contact', 'The person you will work with there', { max: 80, raw: true })
      + field('phone', 'Their phone number', { type: 'tel', inputmode: 'tel', max: 16, hint: 'A mobile, or a landline with its STD code.', raw: true })
      + field('house', 'Building, plot or gate', { max: 120 })
      + field('street', 'Street and area', { max: 160 })
      + field('pin', 'PIN code', { inputmode: 'numeric', max: 6, hint: 'Typed in full, it fills the town, district and state.' })
      + field('city', 'Town or village', { max: 80 })
      + field('state', 'State', { select: states })
      + field('district', 'District', { select: '<option value="">Choose the state first</option>' })
      + '<details class="fold sh-more"><summary>More about the place (optional)</summary>'
      + field('landmark', 'A landmark near it', { optional: true, max: 120 })
      + field('altPhone', 'Another phone number', { optional: true, type: 'tel', inputmode: 'tel', max: 16, raw: true })
      + field('email', 'The shelter’s email', { optional: true, type: 'email', max: 254 })
      + field('mapLink', 'A Google Maps link to it', { optional: true, type: 'url', max: 500, placeholder: 'https://maps.app.goo.gl/...' })
      + field('animals', 'The animals it keeps', { optional: true, max: 160, placeholder: 'Dogs, cats, cattle...' })
      + '</details>'
      + '<div class="ip-field"><label for="sh-photos">Two or three photographs of the place</label><input id="sh-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>The gate or the front, and the animals’ area. Each up to 3 MB.</small></div>'
      + '<label class="ip-check"><input type="checkbox" name="agreed"> <span>I have spoken to the shelter, and they have agreed to my coming.</span></label>'
      + '<button class="btn" type="submit">' + (changing ? 'Name this place' : 'Name the place') + '</button>'
      + '<p class="say" data-say role="status" aria-live="polite"></p></form>';
  }

  /* The card: the place they named, or the way to name it. */
  function card(place, accepted) {
    if (!place || place.state === 'change') {
      var why = place && place.state === 'change' ? '<div class="fb"><small>From PFA</small><p>' + esc(place.changeReason || 'Please choose another place.') + '</p></div>' : '';
      return '<div class="sh">' + why + '<button class="btn btn--light" type="button" data-shelter="open">' + (place ? 'Name another place' : 'Name the shelter where you will work') + '</button><div data-shelter-slot></div></div>';
    }
    var s = place.shelter || {};
    return '<div class="sh"><div class="sh__place"><small class="tile__h">Where you work</small><b>' + esc(s.name) + '</b>'
      + '<span>' + esc((s.lines || []).join(', ')) + '</span>'
      + '<span>' + esc(s.contact) + (s.phone ? ' · ' + esc(s.phone) : '') + '</span>'
      + '<span class="sh__st">' + (s.status === 'verified' ? 'Verified by PFA' : 'PFA is checking it; you can begin') + '</span></div>'
      + (accepted ? '' : '<button class="linkish" type="button" data-shelter="open">Change the place</button><div data-shelter-slot></div>')
      + '</div>';
  }

  function districts(sel, state) {
    var list = state ? INDIA.districtsOf(state) : [];
    sel.innerHTML = '<option value="">' + (state ? 'Choose the district' : 'Choose the state first') + '</option>' + list.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '').replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { reject(new Error('That photograph could not be read.')); };
      r.readAsDataURL(file);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-shelter="open"]');
    if (!b || !H) return;
    var slot = b.parentNode.querySelector('[data-shelter-slot]');
    if (!slot) return;
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = form(b.textContent.indexOf('another') !== -1 || b.textContent.indexOf('Change') !== -1);
    var f = slot.querySelector('form');
    /* the PIN fills the town, district and state, as on every other form (3 Nov 2026) */
    if (root.PFAAddress && f) {
      var at = function (n) { return f.querySelector('[name="' + n + '"]'); };
      root.PFAAddress.enhance(f, { pincode: at('pin'), state: at('state'), district: at('district'), city: at('city'), address: at('street') });
    }
    try { f.querySelector('input').focus(); } catch (_) {}
  });
  document.addEventListener('input', function (e) {
    var f = e.target && e.target.closest && e.target.closest('[data-shelter-form]');
    var note = f && f.querySelector('[data-say][data-state="bad"]');
    if (note) { note.textContent = ''; note.removeAttribute('data-state'); }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sh-state') districts(document.getElementById('sh-district'), e.target.value);
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-shelter-form]');
    if (!f || !H) return;
    e.preventDefault();
    var note = f.querySelector('[data-say]');
    var btn = f.querySelector('button[type="submit"]');
    var val = function (n) { return String((f.elements[n] || {}).value || '').trim(); };
    var files = Array.prototype.slice.call(f.elements.photos.files || []);
    var bad = function (n, text) { note.textContent = text; note.setAttribute('data-state', 'bad'); var el = f.elements[n]; if (el && el.focus) el.focus(); };
    var need = [['name', 'Type the shelter’s name.'], ['contact', 'Type the name of the person you will work with.'], ['phone', 'Type their phone number.'], ['house', 'Type the building, plot or gate.'], ['street', 'Type the street and area.'], ['city', 'Type the town or village.'], ['state', 'Choose the state.'], ['district', 'Choose the district.'], ['pin', 'Type the 6 digit PIN code.']];
    for (var i = 0; i < need.length; i += 1) if (!val(need[i][0])) return bad(need[i][0], need[i][1]);
    if (!/^[1-9]\d{5}$/.test(val('pin'))) return bad('pin', 'Type the 6 digit PIN code.');
    if (INDIA.pinOk && !INDIA.pinOk(val('state'), val('pin'))) return bad('pin', 'That PIN code is not in ' + val('state') + '.');
    if (files.length < 2 || files.length > 3) return bad('photos', 'Choose two or three photographs of the place.');
    for (var j = 0; j < files.length; j += 1) if (files[j].size > 3 * 1048576) return bad('photos', files[j].name + ' is over 3 MB.');
    if (!f.elements.agreed.checked) return bad('agreed', 'Tick that the shelter has agreed to your coming.');
    btn.disabled = true;
    note.removeAttribute('data-state');
    var ids = [];
    var chain = Promise.resolve();
    files.forEach(function (file, n) {
      chain = chain.then(function () {
        note.textContent = 'Sending photograph ' + (n + 1) + ' of ' + files.length + '...';
        return readFile(file).then(function (b64) { return H.api('/api/intern/file', { method: 'POST', body: { taskKey: 'shelter', name: file.name, type: file.type, data: b64 } }); }).then(function (r) { ids.push(r.file.id); });
      });
    });
    chain.then(function () {
      note.textContent = 'Naming the place...';
      var body = { photos: ids, agreed: true };
      ['name', 'contact', 'phone', 'altPhone', 'email', 'house', 'street', 'landmark', 'city', 'district', 'state', 'pin', 'mapLink', 'animals'].forEach(function (k) { body[k] = val(k); });
      return H.api('/api/intern/shelter', { method: 'POST', body: body });
    }).then(function (d) {
      H.done(d, 'PFA has the place. You can begin your hours there.');
    }).catch(function (err) {
      btn.disabled = false;
      note.textContent = err.message;
      note.setAttribute('data-state', 'bad');
    });
  });

  root.PFAShelter = { init: function (host) { H = host; }, card: card };
})(window);
