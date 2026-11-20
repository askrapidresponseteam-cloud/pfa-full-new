/* Overview and Payments keep themselves current (owner, 20 Nov 2026: "in 1
   it says 340. in another 229 ... everything needs to be realtime and
   perfectly calcuated").

   Both money figures now come from the one sum (lib/routes/admin/records.js
   paidAllTime). This keeps what is on screen current: every 30 seconds
   while the panel is in view, and at once when the tab or window comes back,
   Overview is read again, and so is Payments when it is at its top with
   nothing being typed, so a list someone is reading never jumps. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || !A.refresh) return;
  var EVERY_MS = 30 * 1000;
  var last = 0;

  function shown(name) {
    var p = document.querySelector('[data-pane="' + name + '"]');
    return !!(p && !p.hidden && p.offsetParent !== null);
  }
  function quiet() {
    var el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
    if (document.querySelector('dialog[open]')) return false;
    return (window.scrollY || 0) < 200;
  }
  function tick(force) {
    var app = document.getElementById('app');
    if (!app || app.hidden || document.hidden) return;
    if (!force && Date.now() - last < EVERY_MS - 500) return;
    var live = shown('overview') || (shown('payments') && quiet());
    if (!live) return;
    last = Date.now();
    try { A.refresh(); } catch (e) { /* the next tick tries again */ }
  }
  setInterval(function () { tick(false); }, EVERY_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(true); });
  window.addEventListener('focus', function () { tick(true); });
})();
