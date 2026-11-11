/* Page designs in the panel's Website section (owner, 11 Nov 2026: "have 2
   options in the admin for manekas picks page. 1 and 2. which can be
   switched on the admin panel").

   One card at the top of Website: for each page design (CHOICES in
   lib/site-visibility.js), its name, the options as one joined control like
   Visible / Hidden, a line on the option shown now, who chose it, and the
   page to look at. Pressing an option saves it at once through
   /api/admin/site, in the audit log like any other change there, and the
   site follows within a few seconds. What each option is folds under its +
   (turned to a cross when open: no dash-shaped mark anywhere).

   admin.html draws Website and calls PFADesigns.panel(site) for this card's
   markup, and PFADesigns.press(button, site, repaint) when an option is
   pressed. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var esc = A.esc;
  var SITE = 'https://peopleforanimalsindia.org/';

  var style = document.createElement('style');
  style.textContent = [
    '.sd-list{margin:14px 0 0;padding:0;list-style:none;border-top:1px solid var(--line)}',
    '.sd-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 24px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line)}',
    '.sd-row>div>b{display:block;font-size:15px;overflow-wrap:anywhere}',
    '.sd-row .detail{display:block;margin-top:6px;font-size:13px;line-height:1.5;color:var(--muted);max-width:70ch;overflow-wrap:anywhere}',
    '.sd-row .detail a{color:inherit;text-decoration:underline;text-underline-offset:3px}',
    '.sd-more{margin:10px 0 0}.sd-more>summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:10px;min-height:32px;font-size:12px;color:var(--muted)}',
    '.sd-more>summary::-webkit-details-marker{display:none}.sd-more>summary::before{content:"";flex:none;width:10px;height:10px;background:linear-gradient(currentColor,currentColor) center/10px 2px no-repeat,linear-gradient(currentColor,currentColor) center/2px 10px no-repeat}',
    '.sd-more>summary::before{transition:transform .2s}.sd-more[open]>summary::before{transform:rotate(45deg)}',
    '.sd-more ul{margin:8px 0 0;padding:0 0 0 20px;font-size:13px;line-height:1.55;color:var(--ink);max-width:70ch}.sd-more li+li{margin-top:6px}',
    '.sd-row>.vis{justify-self:end}',
    '@media (max-width:760px){.sd-row{grid-template-columns:minmax(0,1fr)}.sd-row>.vis{justify-self:start}}'
  ].join('');
  document.head.appendChild(style);

  function optionOf(choice, value) {
    var found = null;
    (choice.options || []).forEach(function (o) { if (o.value === value) found = o; });
    return found;
  }

  function mark(site, id) {
    var m = (((site.state || {}).marks) || {})['choice:' + id];
    if (!m || !m.at) return '';
    return ' Chosen by ' + esc(m.by || 'someone') + ', ' + esc(new Date(m.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })) + '.';
  }

  /* The card, or nothing when the site has no page designs. */
  function panel(site) {
    var list = site && site.choices ? site.choices : [];
    if (!list.length) return '';
    var now = (site.state && site.state.choices) || {};
    var rows = list.map(function (c) {
      var value = now[c.id] || c.fallback;
      var current = optionOf(c, value) || optionOf(c, c.fallback);
      var buttons = (c.options || []).map(function (o) {
        return '<button type="button" data-design="' + esc(c.id) + '" data-value="' + esc(o.value) + '" aria-pressed="' + String(o.value === current.value) + '">' + esc(o.label) + '</button>';
      }).join('');
      return '<li class="sd-row"><div><b>' + esc(c.label) + '</b>'
        + '<span class="detail">On the site now: ' + esc(current.label) + '.' + mark(site, c.id)
        + ' <a href="' + SITE + esc(c.page) + '" target="_blank" rel="noopener noreferrer">Open the page</a></span>'
        + '<details class="sd-more"><summary>What each option is</summary><ul>'
        + (c.options || []).map(function (o) { return '<li><b>' + esc(o.label) + '.</b> ' + esc(o.detail) + '</li>'; }).join('')
        + '</ul></details></div>'
        + '<span class="vis" role="group" aria-label="' + esc(c.label) + '">' + buttons + '</span></li>';
    }).join('');
    return '<div class="panel"><h3>Page designs</h3>'
      + '<p class="hint">Where a page has more than one design, choose the one the site shows. It is saved as you press it and is live within a few seconds.</p>'
      + '<ul class="sd-list">' + rows + '</ul></div>';
  }

  /* One press, one change: both options wait for the answer, and Website is
     drawn again from what the server says is now so. */
  function press(button, site, repaint) {
    var id = button.getAttribute('data-design');
    var value = button.getAttribute('data-value');
    var pair = Array.prototype.slice.call(button.parentNode.querySelectorAll('button'));
    pair.forEach(function (b) { b.disabled = true; });
    var note = A.$('#paneNote');
    A.say(note, 'Saving…');
    A.api('/api/admin/site', { method: 'POST', body: { kind: 'choice', id: id, value: value } }).then(function (data) {
      site.state = data.state;
      repaint('[data-design="' + id + '"][data-value="' + value + '"]');
      A.say(A.$('#paneNote'), 'Saved. Live on the site within a few seconds.', 'good');
    }).catch(function (e) {
      pair.forEach(function (b) { b.disabled = false; });
      A.say(A.$('#paneNote'), (e && e.message) || 'That could not be saved.', 'bad');
    });
  }

  window.PFADesigns = { panel: panel, press: press };
}());
