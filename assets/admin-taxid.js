/* People for Animals - the PAN or Aadhaar card behind an 80G receipt, in a
   donation or membership case (admin.html).
   ------------------------------------------------------------------------
   Owner, 7 Nov 2026: "when someone is contributing 5k or more . make
   providing aadhar or pan upload mandatory for 80G receipt". A contribution
   of 5,000 rupees or more comes with the number and a photo of the card
   (lib/tax-id.js). The case shows both here, side by side, so whoever files
   the statement of donations checks the number against the card before it
   goes to the Income Tax Department. The number is shown in full only here;
   the receipt, the letters and the inbox copy show an Aadhaar number by its
   last four digits.

   admin.html leaves a <div data-tax-id="REF" data-t="{...}"> in the case;
   this fills it. Kept in its own file so admin.html stays under its weight
   ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || !window.MutationObserver) return;
  var esc = A.esc, api = A.api;

  var style = document.createElement('style');
  style.textContent = '.tx-card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:start;margin:0 0 24px;padding:14px;border:1px solid var(--line)}' +
    '.tx-card .tx-shot{display:block;width:168px;height:112px;padding:0;border:1px solid var(--line);background:var(--stone);cursor:zoom-in}' +
    '.tx-card .tx-shot img{width:100%;height:100%;object-fit:contain;display:block}' +
    '.tx-card .tx-none{display:grid;place-items:center;width:168px;height:112px;border:1px dashed var(--line);font-size:12px;line-height:1.4;color:var(--muted);text-align:center;padding:8px;box-sizing:border-box}' +
    '.tx-card h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}' +
    '.tx-card p.tx-no{margin:0;color:var(--ink);font-size:18px;font-weight:700;letter-spacing:.06em;overflow-wrap:anywhere}' +
    '.tx-card p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}' +
    '.tx-card ul{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px;font-size:13px;line-height:1.5}' +
    '.tx-card li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;overflow-wrap:anywhere}' +
    '.tx-card li b{font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border:1px solid var(--line);white-space:nowrap}' +
    '.tx-card li[data-tone="ok"] b{background:var(--ink);color:var(--paper);border-color:var(--ink)}' +
    '.tx-card li[data-tone="bad"] b{background:#b42318;color:#fff;border-color:#b42318}' +
    /* and, on a phone, a long field name such as "Aadhaar (for the 80G certificate)" wraps in its own column rather than squeezing the value beside it */
    '@media (max-width:560px){.kv{grid-template-columns:minmax(0,42%) minmax(0,1fr)}.tx-card{grid-template-columns:1fr}.tx-card .tx-shot,.tx-card .tx-none{width:100%;height:auto;aspect-ratio:3/2}}';
  document.head.appendChild(style);

  function spaced(type, n) {
    var v = String(n || '');
    return type === 'aadhaar' ? v.replace(/(\d{4})(?=\d)/g, '$1 ') : v;
  }

  /* what was checked, line by line: [tone, tag, words] */
  function checks(t) {
    var out = [];
    if (t.type === 'pan') out.push(['ok', 'Format', 'A valid PAN' + (t.holder ? ', held by ' + t.holder : '') + '.']);
    else out.push(['ok', 'Format', '12 digits with UIDAI\'s check digit right.']);
    if (t.cardMatch === 'matches' && t.read) out.push(['ok', 'Card', 'The QR code on the card is for an Aadhaar ' + (t.read.full ? 'with this exact number' : 'ending ' + t.read.last4) + (t.read.name ? ', in the name ' + t.read.name : '') + '.']);
    else if (t.cardMatch === 'differs' && t.read) out.push(['bad', 'Card', 'The QR code on the card is for an Aadhaar ending ' + t.read.last4 + ', not this number.']);
    else if (t.cardMatch === 'unread') out.push(['', 'Card', 'The QR code could not be read from the photo. Check the number by eye.']);
    else if (t.photo === 'attached') out.push(['', 'Card', 'Check the number on the photo by eye.']);
    (t.checks || []).forEach(function (c) { out.push(['bad', 'Check', c]); });
    return out;
  }

  function fill(box) {
    box.setAttribute('data-done', '1');
    var ref = box.getAttribute('data-tax-id');
    var t = {};
    try { t = JSON.parse(box.getAttribute('data-t') || '{}'); } catch (_) { t = {}; }
    var name = t.type === 'aadhaar' ? 'Aadhaar' : 'PAN';
    var label = t.label || (name + ' card');
    var missing = t.photo === 'missing';
    box.className = 'tx-card';
    box.innerHTML = '<div class="tx-pic">' + (missing
      ? '<span class="tx-none">The photo did not arrive with the payment. Ask them for it by reply.</span>'
      : '<span class="tx-none">' + (t.photo === 'pending' ? 'The photo is being attached. Try Refresh.' : 'Opening the photo…') + '</span>') + '</div>'
      + '<div><h4>For the 80G receipt: ' + esc(name) + '</h4><p class="tx-no">' + esc(spaced(t.type, t.number) || 'Not given') + '</p>'
      + '<ul>' + checks(t).map(function (c) { return '<li data-tone="' + c[0] + '"><b>' + esc(c[1]) + '</b><span>' + esc(c[2]) + '</span></li>'; }).join('') + '</ul>'
      + '<p>Check the number against the photo of the ' + esc(label) + ' before it goes into the statement of donations. Shown in full only here.</p></div>';
    if (missing || t.photo !== 'attached') return;
    api('/api/admin/attachment?reference=' + encodeURIComponent(ref) + '&n=tax-id').then(function (data) {
      var b64 = data && data.data;
      if (!b64 || !box.isConnected) throw new Error('none');
      var type = data.contentType || 'image/jpeg';
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: type }));
      var pic = box.querySelector('.tx-pic');
      pic.innerHTML = '<a class="tx-shot" href="' + url + '" target="_blank" rel="noopener" title="Open full size"><img alt="' + esc(label) + '"></a>';
      pic.querySelector('img').src = url;
    }).catch(function () {
      var pic = box.querySelector('.tx-pic');
      if (pic && box.isConnected) pic.innerHTML = '<span class="tx-none">The photo could not be opened just now. Try Refresh.</span>';
    });
  }

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tax-id]:not([data-done])'), fill);
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
}());
