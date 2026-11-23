/* People for Animals - an email in a case, drawn as a mail program draws it.
   ------------------------------------------------------------------------
   Owner, 23 Nov 2026, of a reply in a case: "can the emails look/render
   like how they render within mailbox/gmail.. right now looks like lines?"

   An email that came with its HTML (lib/inbound-mail.js keeps it, from 23
   Nov 2026) is drawn in a frame of its own, as Gmail draws it: its fonts,
   colours, links, tables and pictures. Made safe first: no scripts, forms,
   embedded pages or plug-ins, no event handlers or javascript: links; the
   frame runs no script at all, and its own rules allow only the email's
   styles and pictures. Links open in a new tab. Pictures load without
   telling their server which page asked.

   What the person quoted back (Gmail's "On ... wrote:" and the old
   message under it) is folded away behind a ... button, as in Gmail, and
   opens in place.

   An email kept before then, as text only, reads as text: the new words,
   links that can be pressed, and the quoted part folded behind the same
   button, its lines set in, not repeated.

   Loaded with the file viewer (assets/admin-viewer.js), so admin.html
   stays under its page-weight ceiling; admin.html's conversation() calls
   PFAMail.view(message) for every email that came in.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.PFAMail) return;

  var esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

  var style = document.createElement('style');
  style.textContent = [
    '.mailv{margin:8px 0 0;max-width:820px}',
    '.mailv__frame{display:block;width:100%;height:60px;border:0;background:#fff;overflow:hidden}',
    '.mailv__more{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;margin:6px 0 2px;padding:0 8px;border:1px solid var(--line,#ddd);border-radius:10px;background:#f1f1f1;color:#444;font:700 13px/1 Arial,sans-serif;letter-spacing:1px;cursor:pointer}',
    '.mailv__more:hover,.mailv__more:focus-visible{background:#e4e4e4}',
    '.mailv__more[aria-expanded="true"]{background:#e4e4e4}',
    '.mailv__text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.55}',
    '.mailv__text a{text-decoration:underline;text-underline-offset:2px}',
    '.mailv__quote{margin:6px 0 0 4px;padding:0 0 0 12px;color:#5f6368;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;line-height:1.5}',
    '.mailv__quote[hidden],.mailv__frame[hidden]{display:none}'
  ].join('');
  document.head.appendChild(style);

  /* ---- making an email safe ------------------------------------------- */
  var DROP = 'script,noscript,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,option,link,meta,base,title,svg,math,template,audio,video,source,track,portal';
  var URL_ATTRS = ['href', 'src', 'background', 'action', 'formaction', 'xlink:href', 'poster', 'srcset', 'lowsrc', 'dynsrc', 'cite', 'longdesc', 'usemap'];
  function safeUrl(v) {
    var u = String(v || '').replace(/[\u0000- ]+/g, '').toLowerCase();
    return !/^(javascript|vbscript|data:text|data:application|file):/.test(u);
  }
  function clean(html) {
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll(DROP), function (n) { n.remove(); });
    Array.prototype.forEach.call(doc.querySelectorAll('*'), function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (/^on/.test(name) || name === 'srcdoc' || name === 'formaction' || name === 'http-equiv') { el.removeAttribute(a.name); return; }
        if (URL_ATTRS.indexOf(name) > -1 && !safeUrl(a.value)) el.removeAttribute(a.name);
        if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(a.value)) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (el.tagName === 'IMG') {
        var src = el.getAttribute('src') || '';
        /* a picture carried inside the email (cid:) is among its files, not
           here; a picture from the web loads as Gmail's would */
        if (!/^(https?:|data:image\/)/i.test(src)) {
          var alt = el.getAttribute('alt');
          if (alt) el.replaceWith(doc.createTextNode(alt)); else el.remove();
          return;
        }
        el.setAttribute('referrerpolicy', 'no-referrer');
        el.setAttribute('loading', 'lazy');
      }
    });
    Array.prototype.forEach.call(doc.querySelectorAll('style'), function (s) {
      s.textContent = s.textContent.replace(/@import[^;]*;?/gi, '').replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding/gi, '');
    });
    return doc;
  }

  /* ---- what was quoted back, as Gmail folds it -------------------------- */
  var QUOTED = [
    '.gmail_quote', '.gmail_attr', 'blockquote[type="cite"]', '.yahoo_quoted', '#divRplyFwdMsg', '[id^="divRplyFwdMsg"]',
    '#appendonsend', '.OutlookMessageHeader', '#mail-editor-reference-message-container', '.moz-cite-prefix', '.zmail_extra',
    'div[style*="border-top:solid #E1E1E1"]', 'div[style*="border-top: solid #E1E1E1"]', 'div[style*="border-top:solid #B5C4DF"]'
  ].join(',');
  /* the first quoted thing in reading order, and everything after it */
  function split(doc) {
    var first = doc.body && doc.body.querySelector(QUOTED);
    if (!first) {
      /* a plain "On ... wrote:" or "-----Original Message-----" line */
      var walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
      for (var t = walker.nextNode(); t; t = walker.nextNode()) {
        if (/^\s*(On\s[\s\S]{0,300}wrote:|-{2,}\s*Original Message\s*-{2,})\s*$/i.test(t.nodeValue || '')) { first = t.parentNode === doc.body ? t : t.parentNode; break; }
      }
    }
    if (!first) return null;
    /* an Outlook line above its quoted header goes with it */
    var prev = first.previousElementSibling;
    if (prev && prev.tagName === 'HR') first = prev;
    var range = doc.createRange();
    range.setStartBefore(first);
    range.setEndAfter(doc.body.lastChild || first);
    var holder = doc.createElement('div');
    holder.appendChild(range.extractContents());
    if (!(doc.body.textContent || '').trim() && !doc.body.querySelector('img')) return null;
    return { trimmed: doc.body.innerHTML, quoted: holder.innerHTML };
  }

  var FRAME_CSS = 'html,body{margin:0;padding:0;background:#fff}body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;overflow-wrap:anywhere;word-wrap:break-word}'
    + 'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#1a5fb4}'
    + 'blockquote{margin:0 0 0 .8ex;padding-left:1ex}';
  var POLICY = "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:";
  function page(htmlDoc) {
    var head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + POLICY + '"><meta name="referrer" content="no-referrer"><base target="_blank"><style>' + FRAME_CSS + '</style>';
    return '<!doctype html><html><head>' + head + '</head><body>' + htmlDoc + '</body></html>';
  }
  var VIEWS = {};
  var n = 0;

  function htmlView(m) {
    var doc = clean(m.html);
    var styles = Array.prototype.map.call(doc.querySelectorAll('style'), function (s) { return '<style>' + s.textContent + '</style>'; }).join('');
    Array.prototype.forEach.call(doc.querySelectorAll('style'), function (s) { s.remove(); });
    var parts = split(doc);
    var id = 'mv' + (++n);
    /* the quote in a frame of its own under the ... button, as Gmail opens
       it in place; drawn only when asked for */
    VIEWS[id] = parts ? page(styles + parts.quoted) : '';
    var FRAME = '<iframe class="mailv__frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" ';
    return '<div class="mailv" data-mailv="' + id + '">'
      + FRAME + 'title="The email, as it was written" srcdoc="' + esc(page(styles + (parts ? parts.trimmed : doc.body.innerHTML))) + '"></iframe>'
      + (parts ? '<button type="button" class="mailv__more" data-mailv-more="' + id + '" aria-expanded="false" aria-label="Show the quoted text" title="Show the quoted text">&middot;&middot;&middot;</button>'
        + FRAME + 'title="The quoted text" data-mailv-quoted="' + id + '" hidden></iframe>' : '')
      + '</div>';
  }

  /* ---- an email kept as text only -------------------------------------- */
  var LINK = /\b(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;
  function linked(text) {
    var out = '', last = 0, m;
    var t = String(text || '');
    LINK.lastIndex = 0;
    while ((m = LINK.exec(t))) {
      out += esc(t.slice(last, m.index)) + '<a href="' + esc(m[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[1]) + '</a>';
      last = m.index + m[1].length;
    }
    return out + esc(t.slice(last));
  }
  var ATTRIBUTION = /\n*On [^\n]{0,200}(?:\n[^\n]{0,200})?wrote:\s*$/;
  function textView(m) {
    var full = String(m.fullText || m.text || '').replace(/\r\n/g, '\n');
    var mine = String(m.text || '').replace(/\r\n/g, '\n');
    /* an "On ... wrote:" left on the end of the new words (before 23 Nov
       2026 a wrapped one was not caught) goes with the quote */
    var shown = mine.replace(ATTRIBUTION, '').trim();
    var at = shown && full.indexOf(shown) === 0 ? shown.length : -1;
    var rest = at > -1 ? full.slice(at).replace(/^\s+/, '') : (full !== mine ? full : '');
    if (rest && shown && rest.indexOf(shown) === 0 && rest.length === shown.length) rest = '';
    var id = 'mv' + (++n);
    return '<div class="mailv" data-mailv="' + id + '">'
      + (shown ? '<p class="mailv__text">' + linked(shown) + '</p>' : '')
      + (rest ? '<button type="button" class="mailv__more" data-mailv-more="' + id + '" aria-expanded="false" aria-label="Show the quoted text" title="Show the quoted text">&middot;&middot;&middot;</button>'
        + '<p class="mailv__quote" data-mailv-quote="' + id + '" hidden>' + linked(rest.replace(/^> ?/gm, '')) + '</p>' : '')
      + '</div>';
  }

  function view(m) {
    if (!m) return '';
    try { if (m.html && window.DOMParser) return htmlView(m); } catch (e) { /* the text stands in */ }
    return textView(m);
  }

  /* the frame as tall as the email, once it has drawn, and again as its
     pictures arrive */
  function fit(frame) {
    try {
      var d = frame.contentDocument;
      if (!d || !d.documentElement) return;
      frame.style.height = Math.max(40, Math.ceil(d.documentElement.scrollHeight)) + 'px';
      Array.prototype.forEach.call(d.images, function (img) {
        if (!img.complete) img.addEventListener('load', function () { fit(frame); }, { once: true });
      });
    } catch (e) { /* drawn at its first height */ }
  }
  document.addEventListener('load', function (e) {
    var f = e.target;
    if (f && f.classList && f.classList.contains('mailv__frame')) fit(f);
  }, true);
  window.addEventListener('resize', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.mailv__frame'), fit);
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mailv-more]');
    if (!b) return;
    var id = b.getAttribute('data-mailv-more');
    var open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.setAttribute('aria-label', open ? 'Hide the quoted text' : 'Show the quoted text');
    b.title = b.getAttribute('aria-label');
    var q = document.querySelector('[data-mailv-quote="' + id + '"]') || document.querySelector('[data-mailv-quoted="' + id + '"]');
    if (!q) return;
    /* shown first, then drawn: a frame measured while hidden has no width */
    q.hidden = !open;
    if (open && q.tagName === 'IFRAME') {
      if (!q.getAttribute('srcdoc')) q.setAttribute('srcdoc', VIEWS[id] || '');
      else fit(q);
    }
  });

  window.PFAMail = { view: view, clean: clean, split: split, textView: textView };
}());
