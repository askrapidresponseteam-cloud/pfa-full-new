/* People for Animals - form submission.
   ------------------------------------------------------------------------
   One helper, used by every form on the site that sends something to PFA, so
   they cannot disagree about what "sent" means.

   The rule it exists to enforce: **the server issues the reference, and the
   page shows success only if one comes back.** Three forms on this site used
   to validate the fields and then show a thank-you without sending anything
   at all - a person nominating a film-maker or reporting a rescue was told it
   had been received when nothing had been recorded. That is the failure this
   file is here to make impossible.

   POST /api/pfa-submissions  { kind, data, page }  ->  { ok, reference }

   Include with: <script src="pfa-forms.js" defer></script>
   ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var ENDPOINT = '/api/pfa-submissions';
  var TIMEOUT_MS = 15000;

  /* What the server said about each reference it issued on this page load,
     including what happened to the confirmation email. submit() still
     resolves with the reference alone, so no caller changes shape; a page
     that wants the email note asks for it by reference. */
  var receipts = {};

  /* One key per thing being sent, for the length of this page load. The
     server records the reference it issued under the key, so a double press,
     or a retry after the first attempt timed out on the way back, gets the
     same reference rather than a second record with a second number. What
     changes the key is a change in what is being sent: edit a field and it is
     a new submission again. */
  var NONCE = (function () {
    var v = '';
    try { v = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ''; } catch (_) {}
    return v || (String(Date.now()) + Math.random().toString(36).slice(2));
  })();
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  function requestKey(kind, data, photos) {
    var body = JSON.stringify([kind, data || {}, (photos || []).map(function (p) { return String(p || '').length; })]);
    return NONCE + '-' + hash(body);
  }

  function textOf(error) {
    var message = error && error.message ? String(error.message) : '';
    if (/abort/i.test(message)) return 'That took too long. Check your connection and try again.';
    if (/fetch|network|failed/i.test(message)) return 'That could not be sent. Check your connection and try again.';
    return message || 'That could not be sent. Please try again.';
  }

  function requestBody(kind, data, opts) {
    opts = opts || {};
    return JSON.stringify({
      kind: kind,
      data: data || {},
      /* The server checks these by their bytes, not their label, and keeps
         them as private documents beside the record. */
      photos: Array.isArray(opts.photos) ? opts.photos : undefined,
      page: opts.page || (location.pathname.replace(/^\//, '') || 'index.html'),
      clientRequestId: requestKey(kind, data, opts.photos)
    });
  }

  /* Resolves with a reference, or rejects. It never resolves without one:
     a caller cannot accidentally report success for a request that failed. */
  function submit(kind, data, options) {
    var opts = options || {};
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('This browser cannot send the form. Please email PFA instead.'));
    }
    /* The address on every form (owner, 24 Oct 2026: "ensure all the forms
       have the address clearly captured"): assets/address.js checks the
       form's address block and adds it to what the page collected, so no
       page can send without it. */
    if (root.PFAAddress && typeof root.PFAAddress.merge === 'function') {
      var placed = root.PFAAddress.merge(kind, data);
      if (placed.error) return Promise.reject(new Error(placed.error));
      data = placed.data;
    }

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: requestBody(kind, data, opts),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          return { ok: response.ok, status: response.status, payload: payload };
        });
      })
      .then(function (result) {
        if (timer) clearTimeout(timer);
        var payload = result.payload || {};
        if (!result.ok) {
          /* The server names the field it refused, so say which one. It sends
             them as `fields` (see test/submissions.test.js, which pins that
             name); this read `errors`, so every refusal reached the person as
             the generic "check the form" line and never said which box. */
          var first = Array.isArray(payload.fields) && payload.fields[0];
          throw new Error(first && first.message ? first.message
            : payload.error || 'That could not be sent. Please check the form and try again.');
        }
        if (!payload.reference) {
          throw new Error('That was sent, but no reference came back. Please try again before assuming it arrived.');
        }
        receipts[payload.reference] = payload;
        return payload.reference;
      })
      .catch(function (error) {
        if (timer) clearTimeout(timer);
        throw new Error(textOf(error));
      });
  }

  /* Wires a form once: disables the button while in flight, shows the
     reference on success, and shows the reason on failure rather than a
     thank-you. `collect` returns the data object, or null if the caller has
     already reported its own validation problem. */
  /* The last look before sending, from assets/form-preview.js when the page
     has it. Without it (a page that does not load it, or an old cached copy of
     this file meeting a new page) the form sends as before, and the server
     still refuses a submission with no email. */
  function preview(form, options) {
    if (!form || !window.PFAPreview || typeof window.PFAPreview.confirm !== 'function') return Promise.resolve(true);
    return window.PFAPreview.confirm(form, options || {});
  }

  function wire(form, config) {
    if (!form || form.dataset.pfaWired === 'yes') return;
    form.dataset.pfaWired = 'yes';

    var button = config.button || form.querySelector('[type="submit"], button:not([type="button"])');
    var status = config.status || form.querySelector('[data-form-status]');
    var busy = false;

    function say(message, kind) {
      if (!status) return;
      status.textContent = message || '';
      status.setAttribute('data-state', kind || '');
      status.hidden = !message;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;

      var data;
      try { data = config.collect(); } catch (error) { say(textOf(error), 'bad'); return; }
      if (!data) return;                       // the caller has flagged its own fields

      busy = true;
      say('', '');
      /* The last look: everything about to go, then the email and mobile on
         their own. Nothing is disabled or sent until the person confirms,
         so going back leaves the form exactly as it was. */
      preview(form, {
        title: config.previewTitle,
        send: button ? button.textContent : '',
        labels: config.previewLabels,
        extra: typeof config.previewExtra === 'function' ? config.previewExtra(data) : config.previewExtra
      }).then(function (confirmed) {
        if (!confirmed) { busy = false; return; }
        /* Read the fields again: the preview may have corrected the email, and
           what goes must be what the person confirmed, not what they typed first. */
        var fresh;
        try { fresh = config.collect(); } catch (error) { busy = false; say(textOf(error), 'bad'); return; }
        if (!fresh) { busy = false; return; }
        data = fresh;
        var label = button ? button.textContent : '';
        if (button) { button.disabled = true; button.textContent = config.sending || 'Sending\u2026'; }

        /* A form may hand over photographs alongside its fields; report.html
           does this through submit() directly, the newsroom through wire(). */
        var photos = typeof config.photos === 'function' ? config.photos() : config.photos;
        submit(config.kind, data, { page: config.page, photos: Array.isArray(photos) && photos.length ? photos : undefined })
          .then(function (reference) {
            busy = false;
            if (button) { button.disabled = false; button.textContent = label; }
            if (typeof config.onSent === 'function') config.onSent(reference);
            else {
              say('Sent. Your reference is ' + reference + '.', 'good');
              var note = emailNote(reference);
              if (note && status && status.parentNode) status.parentNode.insertBefore(note, status.nextSibling);
            }
          })
          .catch(function (error) {
            busy = false;
            if (button) { button.disabled = false; button.textContent = label; }
            if (typeof config.onFailed === 'function') config.onFailed(error);
            else say(error.message, 'bad');
          });
      });
    });
  }

  /* The endpoint takes JPEG, PNG or WebP up to 950 KB each. A photograph off a
     phone is usually several times that, so shrink before sending rather than
     bouncing the person off a size limit they cannot see. */
  function shrink(file, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) {
        reject(new Error('That is not an image. Photograph the prescription, or export the PDF as a picture.'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be opened.')); };
        img.onload = function () {
          var edge = maxEdge || 1600;
          var scale = Math.min(1, edge / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var out = canvas.toDataURL('image/jpeg', quality || 0.82);
          /* Still over the server's limit: drop the quality once more rather
             than fail. Base64 is about 4/3 of the bytes it encodes. */
          if (out.length * 0.75 > 950 * 1024) out = canvas.toDataURL('image/jpeg', 0.6);
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* The note under a reference: whether a confirmation was emailed, to which
     address, and where to look for it, Spam and Junk included. Every word of
     it comes from the server (lib/confirmations.js), which knows what actually
     happened to the email, so a page never promises one that is not coming.
     Built with textContent throughout: the address is what the person typed. */
  var STYLE = '.pfa-mail{margin:0;padding:18px 20px;border:1px solid var(--ink,#111);background:var(--paper,#fff);color:var(--ink,#111);'
    + 'font-family:var(--body,"Helvetica Neue",Helvetica,Arial,sans-serif);text-align:left;max-width:64ch;box-sizing:border-box}'
    + '.pfa-mail .pfa-mail__title{margin:0 0 8px;font-family:var(--display,Georgia,serif);font-size:22px;line-height:1.15;font-weight:400;color:var(--ink,#111)}'
    + '.pfa-mail .pfa-mail__line{margin:0;font-size:14px;line-height:1.6;color:var(--ink,#111)}'
    + '.pfa-mail .pfa-mail__line strong{font-weight:600;overflow-wrap:anywhere}'
    + '.pfa-mail .pfa-mail__ask{margin:14px 0 0;font-size:11px;line-height:1.4;letter-spacing:.16em;text-transform:uppercase;color:var(--muted,#6a6a6a)}'
    + '.pfa-mail .pfa-mail__steps{margin:8px 0 0;padding:0 0 0 22px;list-style:decimal outside;font-size:14px;line-height:1.6;color:var(--muted,#6a6a6a)}'
    + '.pfa-mail .pfa-mail__steps li{display:list-item;list-style:inherit;margin:3px 0;padding:0}';

  function ensureStyle() {
    if (document.getElementById('pfa-mail-style')) return;
    var tag = document.createElement('style');
    tag.id = 'pfa-mail-style';
    tag.textContent = STYLE;
    (document.head || document.documentElement).appendChild(tag);
  }

  function emailNote(reference) {
    var receipt = receipts[reference];
    var n = receipt && receipt.confirmation;
    if (!n || typeof document === 'undefined') return null;
    var lines = Array.isArray(n.lines) ? n.lines : [];
    if (!n.title && !lines.length) return null;
    ensureStyle();
    var box = document.createElement('div');
    box.className = 'pfa-mail';
    box.setAttribute('role', 'status');
    box.setAttribute('data-mail', String(n.state || ''));
    if (n.title) {
      var title = document.createElement('p');
      title.className = 'pfa-mail__title';
      title.textContent = n.title;
      box.appendChild(title);
    }
    var to = String(n.to || '');
    lines.forEach(function (line) {
      var p = document.createElement('p');
      p.className = 'pfa-mail__line';
      var at = to ? String(line).indexOf(to) : -1;
      if (at > -1) {
        var strong = document.createElement('strong');
        strong.textContent = to;
        p.appendChild(document.createTextNode(String(line).slice(0, at)));
        p.appendChild(strong);
        p.appendChild(document.createTextNode(String(line).slice(at + to.length)));
      } else {
        p.textContent = String(line);
      }
      box.appendChild(p);
    });
    var steps = Array.isArray(n.steps) ? n.steps : [];
    if (steps.length) {
      if (n.ask) {
        var ask = document.createElement('p');
        ask.className = 'pfa-mail__ask';
        ask.textContent = n.ask;
        box.appendChild(ask);
      }
      var list = document.createElement('ol');
      list.className = 'pfa-mail__steps';
      steps.forEach(function (step) {
        var item = document.createElement('li');
        item.textContent = String(step);
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    return box;
  }

  root.PFAForms = {
    submit: submit, wire: wire, shrink: shrink, emailNote: emailNote, preview: preview,
    receipt: function (reference) { return receipts[reference] || null; },
    ENDPOINT: ENDPOINT, _requestBody: requestBody
  };
}(typeof window !== 'undefined' ? window : this));
