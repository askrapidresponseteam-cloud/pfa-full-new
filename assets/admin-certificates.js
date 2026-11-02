/* People for Animals - emailing an internship certificate, from the panel.
   ------------------------------------------------------------------------
   Owner, 2 Nov 2026: "once course is completed - admin should be able to
   issue the cert digitally which can be sent to the person completing it
   over email and there should be a publicy verifiable link that it is a
   genuine certificate".

   Email it (on an issued certificate, or Email in the list) opens one card:
   the certificate as it will be attached, and the email exactly as it will
   go, with the address it goes to (changeable, and looked at again when it
   changes). Send draws the certificate as an A4 PDF in this browser
   (assets/certificate.js, a size that keeps it under the server's limit)
   and sends it with the preview's token; the server refuses if anything
   changed since the preview (lib/routes/admin/certificates.js). Kept out of
   admin.html so that page stays under the page-weight ceiling; it uses the
   panel's helpers on window.PFAAdmin.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$, esc = A.esc, say = A.say, api = A.api;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var long = function (iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; };

  var dlg = document.createElement('dialog');
  dlg.className = 'rgm ctm';
  dlg.id = 'ctMail';
  dlg.setAttribute('aria-label', 'Check the certificate email before it goes');
  document.body.appendChild(dlg);
  var state = { cert: null, token: '', to: '' };

  function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

  function open(cert) {
    state = { cert: cert, token: '', to: cert.email || '' };
    dlg.innerHTML = '<div class="rgm-head"><h3>Check the email before it goes</h3>'
      + '<p class="rgm-sub">' + esc(cert.number) + ' · ' + esc(cert.name) + ', ' + esc(long(cert.startDate)) + ' to ' + esc(long(cert.endDate)) + '. The certificate goes as an A4 PDF, and the email links to the public check.</p></div>'
      + '<div class="rgm-cards">'
      + '<article class="rgm-card"><p class="rgm-to"><b>The certificate, attached</b><span>PFA-internship-certificate-' + esc(cert.number) + '.pdf</span></p><canvas class="ctm-cert" width="1672" height="941" aria-label="The certificate as it will be attached"></canvas></article>'
      + '<article class="rgm-card"><p class="rgm-to"><label for="ctmTo"><b>To</b></label><input id="ctmTo" class="ctm-to" type="email" maxlength="254" autocomplete="off" value="' + esc(state.to) + '" placeholder="Their email"></p><p class="rgm-subj" data-ctm-subj></p><iframe class="rgm-frame" sandbox="" title="The email" data-ctm-frame></iframe><p class="rgm-why" data-ctm-why hidden></p></article>'
      + '</div>'
      + '<div class="rgm-foot"><p class="rg-say" data-ctm-say role="status" aria-live="polite"></p><button class="ghost" type="button" data-ctm="cancel">Cancel</button><button class="press" type="button" data-ctm="send" disabled>Send the certificate</button></div>';
    var C = window.PFACertificate;
    var canvas = dlg.querySelector('.ctm-cert');
    if (C && canvas) {
      var data = { name: cert.name, startDate: cert.startDate, endDate: cert.endDate, issuedOn: cert.issuedOn, number: cert.number };
      C.draw(canvas, data, 1);
      C.load().then(function () { C.draw(canvas, data, 1); }, function () {});
    }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    preview();
  }

  /* the email as the server would send it, to the address typed */
  var asked = 0;
  function preview() {
    var to = String(($('#ctmTo') || {}).value || '').trim();
    var send = dlg.querySelector('[data-ctm="send"]');
    var why = dlg.querySelector('[data-ctm-why]');
    var frame = dlg.querySelector('[data-ctm-frame]');
    send.disabled = true;
    state.token = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
      frame.hidden = true; why.hidden = false; why.textContent = 'Type the email it goes to.';
      dlg.querySelector('[data-ctm-subj]').textContent = '';
      return;
    }
    var mine = ++asked;
    api('/api/admin/certificates', { method: 'POST', body: { action: 'preview', number: state.cert.number, email: to } }).then(function (d) {
      if (mine !== asked) return;
      state.token = d.token; state.to = d.to;
      why.hidden = true; frame.hidden = false;
      frame.setAttribute('srcdoc', d.html);
      dlg.querySelector('[data-ctm-subj]').textContent = d.subject;
      send.disabled = false;
    }).catch(function (err) {
      if (mine !== asked) return;
      frame.hidden = true; why.hidden = false; why.textContent = err.message;
    });
  }

  function base64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('The certificate could not be made in this browser.')); };
      r.readAsDataURL(blob);
    });
  }

  dlg.addEventListener('input', function (e) {
    if (e.target.id !== 'ctmTo') return;
    clearTimeout(preview.t);
    preview.t = setTimeout(preview, 450);
  });
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ctm]');
    if (!b) return;
    if (b.getAttribute('data-ctm') === 'cancel') { close(); return; }
    var said = dlg.querySelector('[data-ctm-say]');
    var C = window.PFACertificate;
    if (!C || !state.token) return;
    b.disabled = true;
    say(said, 'Making the PDF and sending...', '');
    var cert = state.cert;
    C.pdf({ name: cert.name, startDate: cert.startDate, endDate: cert.endDate, issuedOn: cert.issuedOn, number: cert.number }, { scale: 1.5, quality: 0.82 }).then(base64).then(function (pdf) {
      return api('/api/admin/certificates', { method: 'POST', body: { action: 'email', number: cert.number, email: state.to, token: state.token, pdf: pdf } });
    }).then(function (r) {
      close();
      var refresh = $('#refresh');
      if (refresh) refresh.click();
      setTimeout(function () {
        var node = $('[data-pane="certificates"] [data-ct-say]');
        if (node) say(node, (r.state === 'sent' ? 'Sent to ' : 'Queued for ') + r.to + (r.reason ? '. ' + r.reason : '.') + ' The public check: ' + r.verifyUrl, 'good');
      }, 600);
    }).catch(function (err) { b.disabled = false; say(said, err.message, 'bad'); });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pane="certificates"] [data-ct-mail]');
    if (!b) return;
    var number = b.getAttribute('data-ct-mail');
    var cert = (A.certificates ? A.certificates() : []).filter(function (c) { return c.number === number; })[0];
    if (cert) open(cert);
  });
}());
