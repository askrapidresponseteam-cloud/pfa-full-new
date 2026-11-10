/* People for Animals - the PAN or Aadhaar card for an 80G receipt, on the
   donate and membership forms.
   ------------------------------------------------------------------------
   Owner, 7 Nov 2026: "when someone is contributing 5k or more . make
   providing aadhar or pan upload mandatory for 80G receipt. give proper
   reason to people as well".

   Since 10 Nov 2026 the block is on one page only, tax-receipt.html, which
   a donor or member reaches from the link in their receipt email after
   paying: nothing about a card is asked for before paying. The block is
   PAN or Aadhaar, the number, and a photo of the card, with the reason in
   two lines and the rest under "Why we ask". The photo is shrunk here and
   sent to /api/payment/tax-id as soon as it is attached; the token it comes
   back under goes with the number to /api/payment/tax-receipt.

   window.PFATaxId:
     set(block, on)     show or hide the block for the amount chosen
     check(block)       mark what is missing; the number of problems
     upload(block)      the photo sent; a promise of its token
     summary(block)     a line for the last look before paying
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var R = window.PFA_RULES;
  var THRESHOLD = 5000;
  var WORD = { pan: 'PAN', aadhaar: 'Aadhaar' };

  var style = document.createElement('style');
  style.textContent = '.taxid{display:grid;gap:14px;margin:6px 0 22px;padding:18px;border:1px solid var(--ink,#111);background:var(--paper,#fff)}' +
    '.taxid[hidden],.taxid [hidden]{display:none!important}' +
    '.taxid__head{margin:0;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink,#111)}' +
    '.taxid__why{margin:-6px 0 0;font-size:14px;line-height:1.55;color:#3b3b3b}' +
    '.taxid__more{margin:-4px 0 0;font-size:13px;line-height:1.6;color:#3b3b3b}' +
    '.taxid__more summary{display:inline-flex;align-items:center;gap:8px;min-height:32px;cursor:pointer;list-style:none;font-weight:700;color:var(--ink,#111)}' +
    '.taxid__more summary::-webkit-details-marker{display:none}' +
    '.taxid__more summary::before{content:"+";display:inline-grid;place-items:center;width:18px;height:18px;font-size:22px;line-height:1;font-weight:300;transition:transform .2s}' +
    '.taxid__more[open] summary::before{transform:rotate(45deg)}' +
    '.taxid__more p{margin:8px 0 0}' +
    '.taxid__pick{display:flex;flex-wrap:wrap;gap:10px}' +
    '.taxid__pick label{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 18px;border:1px solid var(--line,#d9d9d9);font-size:14px;font-weight:700;cursor:pointer}' +
    '.taxid__pick input{margin:0;width:16px;height:16px;accent-color:var(--ink,#111)}' +
    '.taxid__pick label:has(input:checked){border-color:var(--ink,#111);box-shadow:inset 0 0 0 1px var(--ink,#111)}' +
    '.taxid .field{margin:0}' +
    '.taxid__file{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}' +
    '.taxid__attach{display:flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;width:100%;min-height:56px;margin:0;padding:12px 16px;border:1px dashed var(--ink,#111);background:#fff;color:var(--ink,#111);font-size:14px;font-weight:700;letter-spacing:0;text-transform:none;text-align:center;cursor:pointer}' +
    '.taxid__attach::before{content:"";width:20px;height:20px;flex:none;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M4 8h3l2-3h6l2 3h3v11H4z%27/%3E%3Ccircle cx=%2712%27 cy=%2713%27 r=%273.5%27/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M4 8h3l2-3h6l2 3h3v11H4z%27/%3E%3Ccircle cx=%2712%27 cy=%2713%27 r=%273.5%27/%3E%3C/svg%3E") center/contain no-repeat}' +
    '.taxid__attach:hover{background:var(--ink,#111);color:#fff}' +
    '.taxid__file:focus-visible + .taxid__attach{outline:2px solid var(--ink,#111);outline-offset:3px}' +
    '.taxid__attach[hidden]{display:none}' +
    '.taxid__doc.is-bad .taxid__attach{border-color:#b3261e;border-style:solid}' +
    '.taxid__preview{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:2px 0 0}' +
    '.taxid__preview[hidden]{display:none}' +
    '.taxid__preview img{width:150px;height:100px;object-fit:contain;border:1px solid var(--line,#d9d9d9);background:#f6f6f4;display:block}' +
    '.taxid__preview button{min-height:40px;padding:0 16px;border:1px solid var(--ink,#111);background:#fff;color:var(--ink,#111);font:inherit;font-size:13px;font-weight:700;cursor:pointer}' +
    '.taxid .hint{display:block;margin-top:6px;font-size:12px;line-height:1.5;color:#6a6a6a}' +
    '.taxid__status{margin:10px 0 0;padding:10px 12px;border-left:3px solid var(--line,#d9d9d9);font-size:13px;line-height:1.5;color:#3b3b3b;overflow-wrap:anywhere}' +
    '.taxid__status[data-tone="ok"]{border-left-color:#16794b;color:#14532d}' +
    '.taxid__status[data-tone="bad"]{border-left-color:#b3261e;color:#b3261e}' +
    '.taxid__notes{display:grid;gap:8px;padding:12px 14px;background:#fff8e6;border:1px solid #e8c36a;font-size:13px;line-height:1.5;color:#5c4400}' +
    '.taxid__notes p{margin:0;overflow-wrap:anywhere}';
  document.head.appendChild(style);

  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function typeOf(block) {
    var on = $('input[name="idType"]:checked', block);
    return on && WORD[on.value] ? on.value : 'pan';
  }

  /* the box the block takes the place of (donate.html's optional PAN) */
  function instead(block) {
    var sel = block.getAttribute('data-instead');
    return sel ? $(sel) : null;
  }

  function paint(block) {
    var type = typeOf(block);
    var on = !block.hidden;
    all('[data-tax-for]', block).forEach(function (f) {
      var mine = f.getAttribute('data-tax-for') === type;
      f.hidden = !mine;
      all('input', f).forEach(function (i) { i.disabled = !on || !mine; });
    });
    all('input[name="idType"], input[name="taxIdDoc"], input[type="file"]', block).forEach(function (i) { i.disabled = !on; });
    all('[data-tax-word]', block).forEach(function (w) { w.textContent = WORD[type]; });
    var hint = $('.taxid__doc .hint', block);
    if (hint) hint.textContent = type === 'aadhaar'
      ? 'The side with the QR code, flat, sharp and whole: the QR code lets the number be checked straight away.'
      : 'The side with the number, clear and whole.';
    var alt = instead(block);
    if (alt) {
      var box = alt.closest('.field') || alt;
      box.hidden = on;
      alt.disabled = on;
    }
  }

  function set(block, on) {
    if (!block) return;
    if (block.hidden === !on) { paint(block); return; }
    block.hidden = !on;
    paint(block);
  }

  /* An Aadhaar photo goes up larger, so the dense QR code on it can be read. */
  function shrink(file, edge) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) { reject(new Error('That is not a photo. Take a photo of the card, or save the e-PAN or e-Aadhaar as a picture.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That photo could not be read. Try another.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That photo could not be opened. Try another.')); };
        img.onload = function () {
          if (Math.max(img.width, img.height) < 480) { reject(new Error('That photo is too small to read the card. Take it closer, with the whole card in the frame.')); return; }
          var scale = Math.min(1, edge / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          var q = [0.9, 0.8, 0.7, 0.6], out = '';
          for (var i = 0; i < q.length; i++) { out = c.toDataURL('image/jpeg', q[i]); if (out.length * 0.75 <= 900 * 1024) break; }
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function bad(el, on) { var f = el && el.closest('.field'); if (f) f.classList.toggle('is-bad', on); return on; }

  /* the donor's name on the same form, to compare with the card */
  function donorName(block) {
    var sel = block.getAttribute('data-name-from');
    var el = sel ? $(sel) : null;
    return el ? el.value : '';
  }

  function numberBox(block) { return $('[data-tax-for="' + typeOf(block) + '"] input', block); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }

  /* What the card in the photo says against the number typed: an error
     when they are two different cards. */
  function cardProblem(block) {
    var read = block._read;
    if (!read || typeOf(block) !== 'aadhaar' || block._readFor !== 'aadhaar') return '';
    var n = digits(numberBox(block).value);
    if (n.length !== 12 || !read.last4) return '';
    return n.slice(-4) === read.last4 ? '' : 'This is not the number on the card in the photo: its QR code is for an Aadhaar ending ' + read.last4 + '. Check the number, or attach the right card.';
  }

  /* Things worth a second look that do not stop anyone paying. */
  function notes(block) {
    var out = [], type = typeOf(block), name = donorName(block);
    var v = String(numberBox(block).value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (type === 'pan' && R && !R.checkField('pan', v) && !R.panNameOk(v, name)) {
      out.push('The 5th letter of a personal PAN is the first letter of the holder’s surname, and here it is ' + v.charAt(4) + '. The 80G receipt is in your name, so check that this is your own PAN.');
    }
    if (type === 'aadhaar' && block._read && block._read.name && R && name && !R.namesAgree(block._read.name, name)) {
      out.push('The card is in the name ' + block._read.name + ', and the receipt will be in the name ' + name + '. The 80G receipt is issued to the card holder, so use your own card.');
    }
    return out;
  }

  function paintNotes(block) {
    var box = $('.taxid__notes', block);
    var list = notes(block);
    box.hidden = !list.length;
    box.innerHTML = '';
    list.forEach(function (t) { var p = document.createElement('p'); p.textContent = t; box.appendChild(p); });
  }

  function check(block) {
    if (!block || block.hidden) return 0;
    var type = typeOf(block), errs = 0;
    var input = numberBox(block);
    var why = R ? R.checkField(type, input.value, { required: true }) : (input.value.trim() ? null : 'Enter the number.');
    if (!why) why = cardProblem(block) || null;
    var said = input.closest('.field').querySelector('.error');
    if (said) {
      if (!said.hasAttribute('data-said')) said.setAttribute('data-said', said.textContent);
      said.textContent = !input.value.trim() ? (type === 'pan' ? 'Enter your PAN.' : 'Enter your Aadhaar number.') : (why || said.getAttribute('data-said'));
    }
    errs += bad(input, !!why) ? 1 : 0;
    var doc = $('.taxid__doc', block);
    var missing = !block._photo;
    doc.classList.toggle('is-bad', missing);
    if (missing) errs += 1;
    paintNotes(block);
    return errs;
  }

  /* The photo sent and read. Once per photo and kind of card; a promise of
     the token it is kept under. */
  function send(block) {
    var keep = $('input[name="taxIdDoc"]', block);
    var type = typeOf(block);
    var key = type + '|' + block._photo.length + '|' + block._photo.slice(-64);
    if (keep.value && block._sent === key) return Promise.resolve(keep.value);
    if (block._busy && block._busyKey === key) return block._busy;
    block._busyKey = key;
    block._busy = fetch('/api/payment/tax-id', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type: type, photo: block._photo })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (p) {
        if (!r.ok || !p.token) throw new Error(p.error || 'The photo of your card could not be sent. Check your connection and try again.');
        if (block._busyKey !== key) return keep.value;
        keep.value = p.token;
        block._sent = key;
        block._read = p.read || null;
        block._readFor = type;
        return p.token;
      });
    });
    block._busy.then(function () { block._busy = null; }, function () { block._busy = null; });
    return block._busy;
  }

  function upload(block) {
    if (!block || block.hidden) return Promise.resolve('');
    return send(block).then(function (token) {
      var why = cardProblem(block);
      if (why) { check(block); throw new Error(why); }
      return token;
    });
  }

  function summary(block) {
    if (!block || block.hidden) return null;
    var type = typeOf(block);
    var v = numberBox(block).value || '';
    if (type === 'aadhaar') v = 'XXXX XXXX ' + v.replace(/\D/g, '').slice(-4);
    return [WORD[type] + ' for the 80G receipt', v.toUpperCase() + (block._photo ? ', photo of the card attached' : '')];
  }

  function wire(block) {
    var file = $('input[type="file"]', block);
    var preview = $('.taxid__preview', block);
    var err = $('.taxid__doc .error', block);
    var said = err ? err.textContent : '';
    var status = document.createElement('p');
    status.className = 'taxid__status'; status.hidden = true; status.setAttribute('aria-live', 'polite');
    preview.parentNode.insertBefore(status, preview.nextSibling);
    var noteBox = document.createElement('div');
    noteBox.className = 'taxid__notes'; noteBox.hidden = true; noteBox.setAttribute('role', 'status');
    block.appendChild(noteBox);

    function say(text, tone) { status.hidden = !text; status.textContent = text || ''; status.setAttribute('data-tone', tone || ''); }
    function show() {
      preview.hidden = !block._photo;
      $('.taxid__attach', block).hidden = !!block._photo;
      if (block._photo) { $('img', preview).src = block._photo; $('.taxid__doc', block).classList.remove('is-bad'); }
    }
    /* sent as soon as it is attached, so an Aadhaar's QR code is read while
       the person is still on the form */
    function read() {
      if (!block._photo || block.hidden) { say(''); return; }
      var type = typeOf(block);
      say(type === 'aadhaar' ? 'Reading the QR code on your card…' : 'Attaching the photo…', '');
      send(block).then(function () {
        if (typeOf(block) !== type) return;
        if (type !== 'aadhaar') say('Photo attached. PFA’s accounts team checks the PAN against it.', 'ok');
        else if (block._read) say('Read from the QR code on your card: Aadhaar ending ' + block._read.last4 + (block._read.name ? ', ' + block._read.name : '') + '.', 'ok');
        else say('Photo attached. Its QR code could not be read, so PFA’s accounts team will check the number against the photo by eye. A sharper photo of the side with the QR code lets it be checked now.', '');
        var input = numberBox(block);
        if (input.value.trim()) check(block); else paintNotes(block);
      }).catch(function (error) { say(error.message, 'bad'); });
    }
    block.addEventListener('change', function (e) {
      var t = e.target;
      /* another kind of card: another photo */
      if (t.name === 'idType') { paint(block); block._photo = ''; block._read = null; $('input[name="taxIdDoc"]', block).value = ''; say(''); show(); paintNotes(block); return; }
      if (t !== file || !file.files || !file.files[0]) return;
      if (err) err.textContent = said;
      say('');
      shrink(file.files[0], typeOf(block) === 'aadhaar' ? 2200 : 1600).then(function (data) {
        block._photo = data;
        block._read = null;
        $('input[name="taxIdDoc"]', block).value = '';
        show();
        read();
      }).catch(function (error) {
        if (err) err.textContent = error.message;
        $('.taxid__doc', block).classList.add('is-bad');
      });
      file.value = '';
    });
    block.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('[data-tax-clear]')) return;
      block._photo = '';
      block._read = null;
      $('input[name="taxIdDoc"]', block).value = '';
      say('');
      show();
      file.click();
    });
    block.addEventListener('input', function (e) { if (e.target.closest('.field')) bad(e.target, false); });
    /* the number checked when the person leaves the box, the card and the
       name compared with it */
    block.addEventListener('focusout', function (e) {
      var t = e.target;
      if (!t.closest || !t.closest('[data-tax-for]') || !t.value.trim()) return;
      var why = (R && R.checkField(typeOf(block), t.value, { required: true })) || cardProblem(block);
      var box = t.closest('.field'), msg = box.querySelector('.error');
      if (why && msg) { if (!msg.hasAttribute('data-said')) msg.setAttribute('data-said', msg.textContent); msg.textContent = why; }
      bad(t, !!why);
      paintNotes(block);
    });
    var nameSel = block.getAttribute('data-name-from');
    var nameBox = nameSel ? $(nameSel) : null;
    if (nameBox) nameBox.addEventListener('change', function () { if (!block.hidden) paintNotes(block); });
    paint(block);
  }

  all('[data-tax-id]').forEach(wire);
  window.PFATaxId = { THRESHOLD: THRESHOLD, set: set, check: check, upload: upload, summary: summary };
}());
