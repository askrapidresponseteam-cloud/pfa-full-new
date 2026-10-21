/* The reel box on a phone, made a proper vertical player.
 *
 * Owner, 21 Oct 2026: "VIDEOS DONT PLAY PERFECTLY ON MOBILE SCREENS. YOU NEED
 * TO MAKE THE MOBILE VIDEO PLAYING EXPERIENCE PERFECTLY LIKE NETFLIX". The
 * founder page and CineKind open a reel in the same box (#rbox), with the
 * browser's own small controls over a pale page that showed through. On a
 * touch phone this takes over the reel the page has just built in the box:
 *   - black, edge to edge (assets/theatre.css, under .rbox.is-reel-phone);
 *   - it starts with sound and loops, with no browser controls;
 *   - a tap pauses or plays, and says which, in the middle;
 *   - a thin bar at the bottom shows where it is, and can be dragged;
 *   - Sound on or off sits top right;
 *   - a swipe up is the next reel, a swipe down the one before, and a swipe
 *     down on the first closes the box.
 * A wide screen keeps the box as it was. A reel the page plays in an
 * embedded frame (a founder reel with no copy on this site) is left to its
 * frame: nothing outside a frame can drive what is inside it.
 *
 *   PFA_REELS.wire({ box, frame, step: function (delta) { return true; }, close: fn })
 *
 * step(+1) or step(-1) opens the next or previous reel and returns false when
 * there is none.
 */
(function () {
  'use strict';
  function phone() {
    try { return !!(window.matchMedia && window.matchMedia('(hover:none) and (pointer:coarse)').matches); } catch (e) { return false; }
  }

  function wire(o) {
    var box = o && o.box, frame = o && o.frame;
    if (!box || !frame) return null;
    var step = typeof o.step === 'function' ? o.step : function () { return false; };
    var close = typeof o.close === 'function' ? o.close : function () {};
    var soundOn = true;
    var ui = null, video = null, iconT = null;

    function paintSound() {
      if (!ui) return;
      var b = ui.querySelector('.rv-sound');
      b.setAttribute('aria-pressed', String(soundOn));
      b.textContent = soundOn ? 'Sound on' : 'Sound off';
    }
    function icon(playing) {
      if (!ui) return;
      var i = ui.querySelector('.rv-icon');
      i.className = 'rv-icon ' + (playing ? 'is-play' : 'is-pause') + ' show';
      clearTimeout(iconT);
      iconT = setTimeout(function () { i.classList.remove('show'); }, 650);
    }
    function start(v) {
      v.muted = !soundOn;
      var p = v.play && v.play();
      if (p && p.catch) p.catch(function (err) {
        /* a phone that will not start a reel with sound: start it muted, and
           the Sound button says so */
        if (err && err.name === 'NotAllowedError' && !v.muted) {
          soundOn = false; v.muted = true; paintSound();
          var again = v.play(); if (again && again.catch) again.catch(function () {});
        }
      });
    }

    function take(v) {
      if (!phone() || v === video) return;
      video = v;
      box.classList.add('is-reel-phone');
      v.removeAttribute('controls'); v.controls = false;
      v.loop = true; v.setAttribute('playsinline', '');
      if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
      ui = document.createElement('div');
      ui.className = 'rv-ui';
      ui.innerHTML = '<button type="button" class="rv-sound" aria-pressed="true">Sound on</button>'
        + '<span class="rv-icon" aria-hidden="true"></span>'
        + '<div class="rv-prog" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>';
      frame.appendChild(ui);
      paintSound();
      var fill = ui.querySelector('.rv-prog i'), bar = ui.querySelector('.rv-prog');
      v.addEventListener('timeupdate', function () {
        if (!v.duration) return;
        var f = Math.max(0, Math.min(1, v.currentTime / v.duration));
        fill.style.width = (f * 100) + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      });
      ui.querySelector('.rv-sound').addEventListener('click', function (e) {
        e.stopPropagation();
        soundOn = !soundOn; v.muted = !soundOn; paintSound();
        if (soundOn && v.paused) start(v);
      });
      function seekTo(clientX) {
        var r = bar.getBoundingClientRect();
        if (!v.duration || !r.width) return;
        v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * v.duration;
      }
      var dragging = false;
      bar.addEventListener('pointerdown', function (e) { dragging = true; e.stopPropagation(); seekTo(e.clientX); });
      bar.addEventListener('pointermove', function (e) { if (dragging) seekTo(e.clientX); });
      bar.addEventListener('pointerup', function (e) { dragging = false; e.stopPropagation(); });
      start(v);
    }

    /* a tap pauses or plays; a swipe moves between reels */
    var downX = null, downY = null, downT = 0;
    box.addEventListener('pointerdown', function (e) {
      if (!box.classList.contains('is-reel-phone') || e.pointerType !== 'touch') return;
      downX = e.clientX; downY = e.clientY; downT = Date.now();
    });
    box.addEventListener('pointerup', function (e) {
      if (downY === null || !video) return;
      var dx = e.clientX - downX, dy = e.clientY - downY, quick = Date.now() - downT < 600;
      downY = null;
      if (e.target.closest && (e.target.closest('.rv-sound') || e.target.closest('.rv-prog') || e.target.closest('button'))) return;
      if (quick && Math.abs(dy) > 70 && Math.abs(dx) < 80) {
        if (dy < 0) step(1);
        else if (!step(-1)) close();
        return;
      }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        if (video.paused) { start(video); icon(true); } else { video.pause(); icon(false); }
      }
    });

    /* the page builds a fresh video for each reel; take each one as it lands */
    var watch = new MutationObserver(function () {
      var v = frame.querySelector('video');
      if (v) take(v);
      else { video = null; box.classList.remove('is-reel-phone'); if (ui && ui.parentNode) ui.parentNode.removeChild(ui); ui = null; }
    });
    watch.observe(frame, { childList: true });
    var now = frame.querySelector('video'); if (now) take(now);
    return { phone: phone };
  }

  window.PFA_REELS = { wire: wire };
})();
