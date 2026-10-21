/* The theatre: one player, two pages.
 *
 * Lifted out of wall.html, where it was written, so the founder page can use
 * the same player instead of a second one that resembles it. Two players that
 * merely resemble each other drift the moment either is touched, and this one
 * carries a cursor rule, a dvh fix, safe-area insets and a filmstrip that
 * each took a pass to get right on a phone.
 *
 * The move was mechanical: no rule and no line was redesigned on the way. The
 * wall's 38 tests in test/wall-theatre.test.js run against this file now, and
 * they are the evidence that it is the same player rather than a rewrite
 * wearing its name.
 *
 * The seam turned out to be nine names rather than a thousand lines:
 *   films, progKey   what to play, and where to remember a position
 *   onProgress       the page repaints its own tiles when one is saved
 *   say, live        the page's toast and its live region
 *   th, video, zone  DOM this module now owns, built from its own markup
 *   muted            player state that always belonged in here
 * and clock and toggle, which a page calls back through the returned api.
 *
 *   PFA_THEATRE.mount({ films: [...], progKey: 'pfa:wall:progress' })
 *
 * A film is { wall, title, yt | vimeo | src, poster, by, ratio }. Every
 * control works for all three sources, which is the rule the bar is built on:
 * a control that cannot act on the film in front of it does not belong on the
 * screen. That is why a frame nothing can drive, an Instagram or Facebook
 * embed, is not a film this player takes.
 */
(function () {
  'use strict';

  var MARKUP = '<div class="theatre" id="theatre" data-cursor="light" role="dialog" aria-modal="true" aria-label="Theatre" hidden>\n  <div class="th-top">\n    <div class="l">\n      <span class="num" id="thClock">00:00:00</span>\n      <button type="button" class="sound" id="thSound" aria-label="Sound" aria-pressed="false">Sound:<b id="thOff" class="on">Off</b><b id="thOn">On</b></button>\n      <button type="button" class="sound fit" id="thFit" aria-label="Frame" aria-pressed="false">Frame:<b id="thFitNative" class="on">Native</b><b id="thFitFill">Fill</b></button>\n    </div>\n    <div class="mark" id="thMark"></div>\n    <div class="r">\n      <button type="button" class="close pfa-close" id="thClose">Close</button>\n    </div>\n  </div>\n  <div class="th-stage" id="thStage">\n    <video id="thVideo" playsinline muted preload="auto"></video>\n    <div class="th-shield" id="thShield" aria-hidden="true" hidden></div>\n    <div class="th-spin" id="thSpin" role="status" aria-label="Loading" hidden></div>\n    <div class="th-mid" id="thMid" role="group" aria-label="Play controls"><button type="button" id="thMidBack" aria-label="Back ten seconds"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/><text x="8.6" y="15.2" font-size="6.5" font-weight="700" font-family="sans-serif">10</text></svg></button><button type="button" id="thMidPlay" aria-label="Play"><svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg></button><button type="button" id="thMidFwd" aria-label="Forward ten seconds"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"/><text x="8.6" y="15.2" font-size="6.5" font-weight="700" font-family="sans-serif">10</text></svg></button></div>\n    <div class="th-flash num" id="thFlash" hidden></div>\n    <div class="th-card" id="thCard" hidden>\n      <div>\n        <p class="eyebrow" id="thCardEyebrow"></p>\n        <h3 id="thCardTitle"></h3>\n        <p id="thCardText"></p>\n        <div class="acts" id="thCardActs"></div>\n      </div>\n    </div>\n    <div class="th-help" id="thHelp" hidden>\n      <div>\n        <p class="eyebrow">Keyboard</p>\n        <dl>\n          <dt><kbd>Space</kbd> <kbd>K</kbd></dt><dd>Play or pause</dd>\n          <dt><kbd>←</kbd> <kbd>→</kbd> <kbd>J</kbd> <kbd>L</kbd></dt><dd>Back or forward ten seconds</dd>\n          <dt><kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> <kbd>P</kbd> <kbd>N</kbd></dt><dd>Previous or next film</dd>\n          <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Volume</dd>\n          <dt><kbd>M</kbd></dt><dd>Mute</dd>\n          <dt><kbd>0</kbd>-<kbd>9</kbd></dt><dd>Jump to that tenth of the film</dd>\n          <dt><kbd>&lt;</kbd> <kbd>&gt;</kbd></dt><dd>Slower or faster</dd>\n          <dt><kbd>F</kbd></dt><dd>Full screen</dd>\n          <dt><kbd>A</kbd></dt><dd>Autoplay on or off</dd>\n          <dt><kbd>Z</kbd></dt><dd>Native or filled frame</dd>\n          <dt><kbd>?</kbd></dt><dd>This list</dd>\n          <dt><kbd>Esc</kbd></dt><dd>Close</dd>\n        </dl>\n        <button type="button" class="pfa-close" id="thHelpClose">Close</button>\n      </div>\n    </div>\n    <div class="th-caption"><span class="t"><em class="num" id="thIdx">01</em><span id="thTitle"></span></span></div>\n  </div>\n  <div class="th-bottom" id="thBottom">\n  <div class="th-controls" id="thControls" role="group" aria-label="Player controls">\n    <div class="th-seek" id="thSeekWrap">\n      <i class="th-seek__buf" id="thBuf"></i><i class="th-seek__fill" id="thFill"></i><i class="th-seek__knob" id="thKnob"></i>\n      <input type="range" id="thSeek" min="0" max="1000" value="0" step="1" aria-label="Seek" aria-valuetext="00:00:00">\n      <span class="th-seek__tip num" id="thTip" hidden></span>\n    </div>\n    <div class="th-row">\n      <div class="l">\n        <button type="button" id="thPrev" title="Previous film (Shift+←)" aria-label="Previous film"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>\n        <button type="button" id="thPlay" title="Play (K)" aria-label="Play"><svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg></button>\n        <button type="button" id="thNext" title="Next film (Shift+→)" aria-label="Next film"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg></button>\n        <button type="button" id="thBack" title="Back 10 seconds (J)" aria-label="Back ten seconds"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/><text x="8.6" y="15.2" font-size="6.5" font-weight="700" font-family="sans-serif">10</text></svg></button>\n        <button type="button" id="thFwd" title="Forward 10 seconds (L)" aria-label="Forward ten seconds"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"/><text x="8.6" y="15.2" font-size="6.5" font-weight="700" font-family="sans-serif">10</text></svg></button>\n        <span class="th-time num"><span id="thT">00:00:00</span><span class="sep">/</span><span id="thD">00:00:00</span></span>\n      </div>\n      <div class="r">\n        <button type="button" id="thAuto" title="Autoplay the next film (A)" aria-pressed="true">Autoplay</button>\n        <div class="th-menu" id="thRate">\n          <button type="button" id="thRateBtn" title="Playback speed" aria-haspopup="menu" aria-expanded="false"><span class="num" id="thRateNow">1×</span></button>\n          <div class="th-menu__list" id="thRateMenu" role="menu" hidden></div>\n        </div>\n        <button type="button" id="thShare" title="Copy a link to this moment">Copy link</button>\n        <button type="button" id="thHelpBtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>\n        <button type="button" id="thFull" title="Full screen (F)" aria-label="Full screen" aria-pressed="false"><svg class="i-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg><svg class="i-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4v6H4V8h4V4zm4 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z"/></svg></button>\n      </div>\n    </div>\n  </div>\n  <div class="th-strip" id="thStrip" aria-label="All films"></div>\n  <div class="th-rule" id="thRule"><svg id="thRuleSvg" aria-hidden="true"></svg></div>\n  <div class="th-foot">\n    <div class="l" id="thFootLinks"></div>\n    <div class="r" id="thFootCredit"></div>\n  </div>\n  </div>\n  <div class="th-toast" id="thToast" hidden></div>\n  <div class="sr" id="thLive" aria-live="polite"></div>\n</div>';

  function mount(opts) {
    opts = opts || {};
    var WALL = opts.films || [];
    /* What this player is called on the page it is mounted on. It was the
       wall's, so it named The Wall in four places; on a second page that is
       wrong, and confusing besides, since The Wall is a section of this site
       in its own right. The wall passes nothing and keeps its name; any
       other page says what it is. */
    var NAME = opts.name || 'The Wall';
    var CREDIT = opts.credit || 'People for Animals \u00b7 Community film wall';
    var FOOT = opts.foot || [
      { href: '#longform', text: 'Long form' },
      { href: '#shortform', text: 'Short form' },
      { href: '#submit', text: 'Share a video' }
    ];
    var PROG_KEY = opts.progKey || 'pfa:theatre:progress';
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var $ = function (q) { return document.querySelector(q); };

    /* The markup comes with the module. A page carrying its own copy would be
       free to let it drift from the code that drives it, which is the whole
       failure this file exists to end. */
    if (!document.getElementById('theatre')) {
      var holder = document.createElement('div');
      holder.innerHTML = MARKUP;
      while (holder.firstChild) document.body.appendChild(holder.firstChild);
    }

    /* Filled after injection rather than baked into the markup, so both pages
       share one string of HTML and differ only in what they call it. */
    (function named(){
      var mark = document.getElementById('thMark');
      if (mark) mark.textContent = NAME;
      var credit = document.getElementById('thFootCredit');
      if (credit) credit.textContent = CREDIT;
      var links = document.getElementById('thFootLinks');
      if (links) links.innerHTML = FOOT.map(function (l) {
        return '<a href="' + l.href + '" data-theatre-close>' + l.text + '</a>';
      }).join('');
    }());

    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    var tc = function(sec){ sec = Math.max(0, Math.floor(sec || 0)); return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60); };
    var SKIP = 10;                                 /* seconds, for the skip buttons and keys */
    var RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
    var NEXT_IN = 5;                               /* seconds on the "up next" card */

    /* ---- remembered positions: continue watching ----
       Keyed by the source, not the index, so re-ordering the wall never
       resumes the wrong film. A position inside the first few seconds or the
       last few is not worth keeping. */
    function keyOf(it){ return it.yt ? 'yt:' + it.yt : it.vimeo ? 'vimeo:' + it.vimeo : 'src:' + (it.src || ''); }
    function readProg(){ try { var p = JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; } }
    function writeProg(p){ try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (e) {} }
    function saveProg(it, t, d){
      if (!it) return;
      var p = readProg(), k = keyOf(it);
      if (!(d > 0) || t < 5 || t > d - 8) delete p[k]; else p[k] = { t: Math.floor(t), d: Math.floor(d), at: Date.now() };
      writeProg(p);
      onProgress();
    }
    function savedFor(it){ var p = readProg()[keyOf(it)]; return p && p.t > 0 ? p : null; }

    function thumb(item){
      if (item.poster) return '<img src="' + item.poster + '" alt="" loading="lazy">';
      if (item.yt) return '<img src="https://i.ytimg.com/vi/' + item.yt + '/hqdefault.jpg" alt="" loading="lazy">';
      if (item.src) return '<video src="' + item.src + '#t=1" muted playsinline preload="metadata"></video>';
      return '';
    }
    function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }


    var th = $('#theatre'); if (!th || !WALL.length) return;
    var video = $('#thVideo'), stage = $('#thStage'), strip = $('#thStrip'), rule = $('#thRuleSvg');
    var muted = true, volume = 1, rate = 1, autoplay = true, cur = -1, iframe = null, wasOpen = false, lastFocus = null, loadSeq = 0;
    var LIST = WALL, WHICH = 'long';
    try { autoplay = localStorage.getItem('pfa:wall:autoplay') !== 'off'; } catch (e) {}
    /* Number(null) is 0, so an unset key must not be read as "silence". */
    try {
      var v0raw = localStorage.getItem('pfa:wall:volume');
      if (v0raw !== null){ var v0 = Number(v0raw); if (v0 >= 0 && v0 <= 1) volume = v0; }
    } catch (e) {}

    function live(msg){ var l = $('#thLive'); if (l){ l.textContent = ''; setTimeout(function(){ l.textContent = msg; }, 20); } }
    /* The theatre's own toast, inside the dialog. It used to borrow the
       page's #toast, which sits at z-index 75 under the theatre's 90 and, in
       full screen, outside the one element the browser renders - so
       "Started with sound off. Tap Sound to turn it on", the resume notice
       and "Link copied" were all painted where nobody could see them, and
       the academy page has no #toast at all. */
    var toastT = null;
    function say(msg, ms){
      var t = $('#thToast') || $('#toast'); if (!t) return;
      t.textContent = msg; t.hidden = false; t.classList.add('show');
      clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove('show'); }, ms || 2200);
    }

    /* each wall has its own theatre: the long form pieces, or the short ones */
    function setList(which){
      WHICH = which;
      LIST = WALL.filter(function(it){ return it.wall === which; });
      if (!LIST.length) LIST = WALL;
      th.classList.toggle('is-short', which === 'short');
      th.classList.toggle('is-long', which !== 'short');
      strip.innerHTML = LIST.map(function(it, i){
        return '<button type="button" data-go="' + i + '" aria-label="' + esc(it.title) + '">' + thumb(it) + '<span class="num">' + pad(i + 1) + '</span></button>';
      }).join('');
    }
    setList('long');

    /* the clock, top left, in the visitor's zone */
    var zone = (function(){ try { return new Date().toLocaleTimeString('en', {timeZoneName:'short'}).split(' ').pop(); } catch(e){ return ''; } })();
    setInterval(function(){ if (!wasOpen) return; var d = new Date(); $('#thClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + (zone ? ' ' + zone : ''); }, 500);

    /* ---- the player behind the controls ----
       `yt` is the handle on an embedded player - YouTube or Vimeo - once its
       API has answered: ready, the player object, and the time and duration
       it last reported, so clock() can read them without waiting on a
       promise. Null while a file is on the stage. */
    var yt = null;
    var P = {
      ext: function(){ return yt && yt.ready ? yt : null; },
      isFile: function(){ return !iframe; },
      playing: function(){
        var e = P.ext(); if (e) return !!e.playing;
        if (iframe) return false;
        return !video.paused && !video.ended;
      },
      play: function(){
        var e = P.ext();
        if (e){ try { e.kind === 'vimeo' ? e.player.play().catch(function(){}) : e.player.playVideo(); } catch (err) {} return; }
        if (iframe) return;
        var p = video.play(); if (p && p.catch) p.catch(function(){ paintPlay(); });
      },
      pause: function(){
        var e = P.ext();
        if (e){ try { e.kind === 'vimeo' ? e.player.pause().catch(function(){}) : e.player.pauseVideo(); } catch (err) {} return; }
        if (iframe) return;
        video.pause();
      },
      seek: function(t){
        var c = clock(); if (!c.known) return;
        t = Math.max(0, Math.min(c.d, t));
        var e = P.ext();
        if (e){ e.t = t; try { e.kind === 'vimeo' ? e.player.setCurrentTime(t).catch(function(){}) : e.player.seekTo(t, true); } catch (err) {} tick(); return; }
        if (iframe) return;
        try { video.currentTime = t; } catch (err) {}
        tick();
      },
      setRate: function(r){
        rate = r;
        var e = P.ext();
        if (e){ try { var out = e.player.setPlaybackRate(r); if (out && out.catch) out.catch(function(){ say('This film cannot change speed.'); }); } catch (err) {} }
        else if (!iframe) video.playbackRate = r;
        $('#thRateNow').textContent = String(r).replace(/\.0$/, '') + '\u00d7';
        Array.prototype.forEach.call($('#thRateMenu').children, function(b){ b.setAttribute('aria-checked', String(Number(b.getAttribute('data-rate')) === r)); });
      },
      setMute: function(on){
        muted = on; video.muted = on;
        var e = P.ext();
        if (e){ try { if (e.kind === 'vimeo') e.player.setVolume(on ? 0 : volume).catch(function(){}); else if (on) e.player.mute(); else { e.player.unMute(); e.player.setVolume(Math.round(volume * 100)); } } catch (err) {} }
        else if (iframe) load(cur, { keepTime: true, nativeControls: !!iframe._keepNative });   /* an embed the API could not reach: reload with the flag */
      },
      setVolume: function(v){
        volume = Math.max(0, Math.min(1, v));
        video.volume = volume;
        try { localStorage.setItem('pfa:wall:volume', String(volume)); } catch (e) {}
        var e = P.ext();
        if (e){ try { if (e.kind === 'vimeo') e.player.setVolume(muted ? 0 : volume).catch(function(){}); else e.player.setVolume(Math.round(volume * 100)); } catch (err) {} }
        if (volume > 0 && muted) setSound(true); else if (volume === 0 && !muted) setSound(false);
      }
    };

    /* One volume control on the whole screen: the Sound Off/On toggle in the
       top bar, where it always was. M is its key, the up and down arrows
       trim the level, and a driven YouTube embed opens bare below so its own
       volume never sits beside this one. */
    function setSound(on){
      P.setMute(!on);
      $('#thOff').classList.toggle('on', !on); $('#thOn').classList.toggle('on', on);
      $('#thSound').setAttribute('aria-pressed', String(on));
      live(on ? 'Sound on' : 'Sound off');
    }
    function paintPlay(){
      var on = P.playing();
      var b = $('#thPlay'); b.classList.toggle('is-playing', on); b.setAttribute('aria-label', on ? 'Pause' : 'Play'); b.title = (on ? 'Pause' : 'Play') + ' (K)';
      th.classList.toggle('is-playing', on);
      sync();
      if (typeof navigator !== 'undefined' && navigator.mediaSession) try { navigator.mediaSession.playbackState = on ? 'playing' : 'paused'; } catch (e) {}
    }

    /* The ruler is the programme: one segment per film, in the order of the
       strip above it, each divided into eighths of that film's running time.
       The white line is where you are; the film's number gains its length once
       the player has said what it is, and the time rides on the line. Pressing
       anywhere on it goes to that moment of that film. The same for a file the
       site plays and for an embedded film: the player APIs report time for
       those, so this is no longer a strip that only moves for one of them. */
    function ruleLabel(i){
      var it = LIST[i];
      return pad(i + 1) + (it && it.dur ? ' \u00b7 ' + tc(it.dur).replace(/^00:/, '') : '');
    }
    function drawRule(){
      var w = rule.clientWidth || 800, h = 56, n = LIST.length, seg = w / n;
      var out = '';
      for (var i = 0; i < n; i++){
        var x = i * seg;
        out += '<text id="thLab' + i + '" x="' + (x + 2) + '" y="12">' + ruleLabel(i) + '</text>';
        out += '<line x1="' + x + '" y1="20" x2="' + x + '" y2="' + h + '"/>';
        for (var k = 1; k < 8; k++){ var xx = x + seg * k / 8; out += '<line x1="' + xx + '" y1="' + (k === 4 ? 36 : 44) + '" x2="' + xx + '" y2="' + h + '"/>'; }
      }
      out += '<line class="played" id="thPlayed" x1="0" y1="' + h + '" x2="0" y2="' + h + '"/>';
      out += '<line class="head" id="thHead" x1="0" y1="16" x2="0" y2="' + h + '"/>';
      rule.innerHTML = out;
    }

    /* One clock for whichever source is on the stage. */
    function clock(){
      if (yt && yt.ready){
        /* YouTube answers synchronously, so it is asked; Vimeo answers in
           promises, so its last report is used. */
        var yd = Number(yt.d) || 0, yt_ = Number(yt.t) || 0;
        if (yt.kind !== 'vimeo' && yt.player && typeof yt.player.getDuration === 'function'){
          try { yd = Number(yt.player.getDuration()) || yd; yt_ = Number(yt.player.getCurrentTime()) || 0; } catch (e) {}
        }
        return { d: yd, t: yt_, known: yd > 0 };
      }
      if (iframe) return { d: 0, t: 0, known: false };
      return { d: video.duration || 0, t: video.currentTime || 0, known: (video.duration || 0) > 0 };
    }

    /* How much of a file is buffered ahead of the head, as a fraction. An
       embed does not say. */
    function bufferedTo(){
      if (iframe || !video.buffered || !video.buffered.length || !(video.duration > 0)) return 0;
      var t = video.currentTime || 0, end = 0;
      for (var i = 0; i < video.buffered.length; i++){
        if (video.buffered.start(i) <= t + 0.5 && video.buffered.end(i) > end) end = video.buffered.end(i);
      }
      return Math.min(1, end / video.duration);
    }

    var dragging = false;
    function tick(){
      var c = clock(), d = c.d, t = c.t, p = d ? t / d : 0;
      /* Each figure once: the time readout in the controls row is the one
         place the clock is written, and the seek bar is the one drawing of
         progress within the film. The ruler's line carries position across
         the whole programme; it repeats no numbers. A film with no duration
         yet - not loaded, unreachable, or an embed whose player has not
         answered - has nothing to say and nothing to seek: the readout is
         away and the bar is still and disabled. */
      $('#thT').textContent = tc(t);
      $('#thD').textContent = tc(d);
      $('#thT').parentNode.hidden = !c.known;
      /* While the person is dragging the bar, it is theirs; the film's own
         time does not pull it back. */
      var seek = $('#thSeek');
      if (!dragging){
        seek.value = Math.round(p * 1000);
        seek.setAttribute('aria-valuetext', tc(t) + ' of ' + tc(d));
        $('#thFill').style.width = (p * 100) + '%';
        $('#thKnob').style.left = (p * 100) + '%';
      }
      $('#thBuf').style.width = (bufferedTo() * 100) + '%';
      seek.disabled = !c.known;
      if (c.known && LIST[cur] && !LIST[cur].dur){
        LIST[cur].dur = d;
        var lab = $('#thLab' + cur); if (lab) lab.textContent = ruleLabel(cur);
      }
      var w = rule.clientWidth || 800, seg = w / LIST.length, x = cur * seg + seg * p;
      var head = $('#thHead'), played = $('#thPlayed');
      if (head){ head.setAttribute('x1', x); head.setAttribute('x2', x); }
      if (played){ played.setAttribute('x1', cur * seg); played.setAttribute('x2', x); }
      if (typeof setPositionState === 'function') setPositionState(c);
    }

    /* YouTube's player API, for the films that are YouTube embeds. Without it
       an embed is a black box: no time, no duration, no way to seek, no word
       when it ends. With it the ruler, the readouts and autoplay-to-next work
       for a YouTube film exactly as for a file. Loaded once, on first need;
       if the script is blocked the film still plays as a plain embed. */
    var ytApi = null, vimeoApi = null;
    /* YouTube chooses a quality tier when the player initialises, from the
       frame's measured size and its first read of the connection. Neither can
       be set: setPlaybackQuality became a no-op in 2019 and the vq parameter
       went with it. What can be done is give it no reason to choose low. The
       size is seen to by sharpen(), below; a cold TCP and TLS handshake in
       front of the very first bytes is the other reason, seen to here.

       Done here rather than in the page head on purpose. This section promises
       that nothing third-party is contacted until a visitor shows interest,
       and a preconnect is a real connection to Google. loadYtApi is already
       the moment intent is shown: it runs on hover over a film and on open. */
    function warmYouTube(){
      if (warmYouTube.done) return;
      warmYouTube.done = true;
      ['https://www.youtube.com', 'https://i.ytimg.com', 'https://www.google.com'].forEach(function (host) {
        var l = document.createElement('link');
        l.rel = 'preconnect'; l.href = host; l.crossOrigin = '';
        document.head.appendChild(l);
      });
    }

    function loadYtApi(){
      warmYouTube();
      if (window.YT && window.YT.Player) return Promise.resolve(true);
      if (ytApi) return ytApi;
      ytApi = new Promise(function(resolve){
        var prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function(){ if (prev) try { prev(); } catch (e) {} resolve(!!(window.YT && window.YT.Player)); };
        var sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.async = true;
        sc.onerror = function(){ resolve(false); };
        document.head.appendChild(sc);
        setTimeout(function(){ resolve(!!(window.YT && window.YT.Player)); }, 8000);
      });
      return ytApi;
    }
    function attachYt(frame, filmIndex){
      loadYtApi().then(function(ok){
        if (!ok || frame !== iframe || filmIndex !== cur) return;
        var handle = { kind: 'youtube', ready: false, player: null, t: 0, d: 0, playing: false };
        handle.player = new window.YT.Player(frame, {
          events: {
            onReady: function(){
              if (frame !== iframe) return;
              /* The API lost the race: this embed opened with YouTube's own
                 controls, and driving it now would stand this page's bar and
                 buttons beside YouTube's - two of everything. Reopen the same
                 film bare at the same moment instead; from here on, and for
                 every film after, one set of controls is on the screen. */
              if (!frame._bare && !frame._keepNative && LIST[cur] && LIST[cur].yt){
                var t = 0;
                try { t = Math.floor(Number(handle.player.getCurrentTime()) || 0); } catch (e) {}
                load(cur, t > 0 ? { startAt: t } : {});
                return;
              }
              handle.ready = true;
              /* A bare embed is fully this page's: the shield takes the
                 clicks, so the film pauses and plays like a file and the
                 pointer never leaves the page. */
              if (frame._bare) $('#thShield').hidden = false;
              try { if (muted) handle.player.mute(); else { handle.player.unMute(); handle.player.setVolume(Math.round(volume * 100)); } } catch (e) {}
              try { if (rate !== 1) handle.player.setPlaybackRate(rate); } catch (e) {}
              poll(); paintPlay(); tick();
            },
            onStateChange: function(e){
              if (frame !== iframe) return;
              var S = window.YT.PlayerState;
              handle.playing = e.data === S.PLAYING;
              $('#thSpin').hidden = e.data !== S.BUFFERING;
              if (e.data === S.ENDED) onEnded();
              else paintPlay();
              poll(); tick();
            },
            onError: function(){ if (frame === iframe) showError(); }
          }
        });
        function poll(){
          try { handle.d = Number(handle.player.getDuration()) || 0; handle.t = Number(handle.player.getCurrentTime()) || 0; } catch (e) {}
        }
        handle.poll = poll;
        yt = handle;
      });
    }
    /* Vimeo's player API, so a Vimeo film is not the one kind that cannot be
       seeked, timed or followed by the next. Same shape of handle as YouTube. */
    function loadVimeoApi(){
      if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(true);
      if (vimeoApi) return vimeoApi;
      vimeoApi = new Promise(function(resolve){
        var sc = document.createElement('script'); sc.src = 'https://player.vimeo.com/api/player.js'; sc.async = true;
        sc.onload = function(){ resolve(!!(window.Vimeo && window.Vimeo.Player)); };
        sc.onerror = function(){ resolve(false); };
        document.head.appendChild(sc);
        setTimeout(function(){ resolve(!!(window.Vimeo && window.Vimeo.Player)); }, 8000);
      });
      return vimeoApi;
    }
    function attachVimeo(frame, filmIndex){
      loadVimeoApi().then(function(ok){
        if (!ok || frame !== iframe || filmIndex !== cur) return;
        var handle = { kind: 'vimeo', ready: false, player: null, t: 0, d: 0, playing: false };
        var pl;
        try { pl = new window.Vimeo.Player(frame); } catch (e) { return; }
        handle.player = pl;
        var mine = function(){ return frame === iframe; };
        pl.on('loaded', function(){ if (!mine()) return; handle.ready = true; pl.getDuration().then(function(d){ handle.d = Number(d) || 0; tick(); }).catch(function(){}); pl.setVolume(muted ? 0 : volume).catch(function(){}); if (rate !== 1) pl.setPlaybackRate(rate).catch(function(){}); paintPlay(); tick(); });
        pl.on('timeupdate', function(e){ if (!mine()) return; handle.ready = true; handle.t = Number(e.seconds) || 0; handle.d = Number(e.duration) || handle.d; tick(); });
        pl.on('play', function(){ if (!mine()) return; handle.playing = true; $('#thSpin').hidden = true; paintPlay(); });
        pl.on('pause', function(){ if (!mine()) return; handle.playing = false; paintPlay(); });
        pl.on('bufferstart', function(){ if (mine()) $('#thSpin').hidden = false; });
        pl.on('bufferend', function(){ if (mine()) $('#thSpin').hidden = true; });
        pl.on('ended', function(){ if (mine()) onEnded(); });
        pl.on('error', function(){ if (mine()) showError(); });
        yt = handle;
      });
    }
    setInterval(function(){
      if (!wasOpen || !yt || !yt.ready) return;
      if (yt.poll) yt.poll();
      tick();
      if (yt.playing && LIST[cur]) saveProgThrottled(yt.t, yt.d);
    }, 250);

    var lastSaved = 0;
    function saveProgThrottled(t, d){
      var now = Date.now();
      if (now - lastSaved < 4000) return;
      lastSaved = now; saveProg(LIST[cur], t, d);
    }

    /* ---- cards over the stage: up next, the end, an error ---- */
    var nextTimer = null, nextLeft = 0;
    function card(o){
      var box = $('#thCard');
      clearInterval(nextTimer);
      if (!o){ box.hidden = true; paintPlay(); return; }
      $('#thCardEyebrow').textContent = o.eyebrow || '';
      $('#thCardTitle').textContent = o.title || '';
      $('#thCardText').textContent = o.text || '';
      var acts = $('#thCardActs'); acts.innerHTML = '';
      (o.actions || []).forEach(function(a){
        var b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; if (a.primary) b.className = 'primary';
        b.addEventListener('click', function(){ card(null); a.run(); });
        acts.appendChild(b);
      });
      box.hidden = false; sync();
      var first = acts.querySelector('button'); if (first) first.focus();
      paintPlay();
    }
    function onEnded(){
      if (yt) yt.playing = false;
      saveProg(LIST[cur], 0, 0);          /* finished: nothing to resume */
      paintPlay();
      var next = LIST[(cur + 1) % LIST.length];
      if (autoplay && LIST.length > 1){
        nextLeft = NEXT_IN;
        var text = function(){ return 'Playing in ' + nextLeft + ' second' + (nextLeft === 1 ? '' : 's') + '.'; };
        card({ eyebrow: 'Up next \u00b7 ' + pad(((cur + 1) % LIST.length) + 1), title: next.title, text: text(), actions: [
          { label: 'Play now', primary: true, run: function(){ load(cur + 1); } },
          { label: 'Cancel', run: function(){ live('Autoplay cancelled'); } },
          { label: 'Replay', run: function(){ load(cur, { startAt: 0 }); } }
        ] });
        nextTimer = setInterval(function(){
          nextLeft -= 1;
          $('#thCardText').textContent = text();
          if (nextLeft <= 0){ card(null); load(cur + 1); }
        }, 1000);
        live('Up next: ' + next.title);
      } else {
        card({ eyebrow: 'The end', title: LIST[cur].title, text: LIST.length > 1 ? 'Autoplay is off.' : '', actions: [
          { label: 'Replay', primary: true, run: function(){ load(cur, { startAt: 0 }); } }
        ].concat(LIST.length > 1 ? [{ label: 'Next film', run: function(){ load(cur + 1); } }] : []) });
      }
    }
    function showError(){
      $('#thSpin').hidden = true;
      if (yt) yt.playing = false;
      live('This film could not be loaded');
      card({ eyebrow: 'Not available', title: 'This film could not be loaded.', text: 'The link may have moved, or the connection dropped. Nothing else on the wall is affected.', actions: [
        { label: 'Try again', primary: true, run: function(){ load(cur, { keepTime: true }); } }
      ].concat(LIST.length > 1 ? [{ label: 'Next film', run: function(){ load(cur + 1); } }] : []) });
    }

    /* A short mark in the middle of the stage: the seek that just happened,
       the speed, the volume. Gone on its own. */
    var flashT = null;
    function flash(text, side){
      var f = $('#thFlash'); f.textContent = text; f.setAttribute('data-side', side || 'centre'); f.hidden = false;
      clearTimeout(flashT); flashT = setTimeout(function(){ f.hidden = true; }, 800);
    }
    function skip(delta){
      var c = clock(); if (!c.known) return;
      P.seek(c.t + delta);
      flash((delta < 0 ? '\u2212' : '+') + Math.abs(delta) + 's', delta < 0 ? 'left' : 'right');
      live((delta < 0 ? 'Back ' : 'Forward ') + Math.abs(delta) + ' seconds');
    }

    /* The address of the film on the stage, and of the moment on it, so a
       link can be copied and a link can be opened. #theatre-long?f=3&t=95 is
       film 3 of the long wall at 1:35. Written with replaceState: changing
       film must not leave a history entry per film behind the Back button. */
    function writeHash(){
      try { history.replaceState(null, '', location.pathname + location.search + '#theatre-' + WHICH + '?f=' + (cur + 1)); } catch (e) {}
    }
    function parseHash(h){
      var m = /^#theatre(?:-(long|short))?(?:\?(.*))?$/.exec(h || '');
      if (!m) return null;
      var q = {}; (m[2] || '').split('&').forEach(function(kv){ var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
      return { which: m[1] || 'long', f: Math.max(0, (parseInt(q.f, 10) || 1) - 1), t: Math.max(0, Math.floor(Number(q.t) || 0)) };
    }
    function shareLink(){
      var c = clock();
      return location.origin + location.pathname + '#theatre-' + WHICH + '?f=' + (cur + 1) + (c.known && c.t > 3 ? '&t=' + Math.floor(c.t) : '');
    }

    /* Lock-screen and hardware keys: the film's name where the phone shows
       what is playing, and the buttons there drive this player. */
    function setMediaSession(it){
      if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title: it.title, artist: it.credit || 'The Wall', album: 'People for Animals \u00b7 The Wall',
          artwork: it.poster ? [{ src: it.poster }] : it.yt ? [{ src: 'https://i.ytimg.com/vi/' + it.yt + '/hqdefault.jpg' }] : [] });
        var set = function(a, fn){ try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) {} };
        set('play', function(){ P.play(); }); set('pause', function(){ P.pause(); });
        set('previoustrack', function(){ load(cur - 1); }); set('nexttrack', function(){ load(cur + 1); });
        set('seekbackward', function(d){ skip(-((d && d.seekOffset) || SKIP)); }); set('seekforward', function(d){ skip((d && d.seekOffset) || SKIP); });
        set('seekto', function(d){ if (d && typeof d.seekTime === 'number') P.seek(d.seekTime); });
      } catch (e) {}
    }
    function setPositionState(c){
      if (typeof navigator === 'undefined' || !navigator.mediaSession || !navigator.mediaSession.setPositionState || !c.known) return;
      try { navigator.mediaSession.setPositionState({ duration: c.d, position: Math.min(c.t, c.d), playbackRate: rate }); } catch (e) {}
    }

    function load(i, opts){
      opts = opts || {};
      i = (i + LIST.length) % LIST.length;
      var it = LIST[i];
      var t = opts.keepTime && i === cur ? clock().t : (typeof opts.startAt === 'number' ? opts.startAt : -1);
      if (cur !== i && cur >= 0 && LIST[cur]) { var was = clock(); if (was.known) saveProg(LIST[cur], was.t, was.d); }
      cur = i;
      yt = null;
      card(null);
      $('#thSpin').hidden = true;
      $('#thShield').hidden = true;
      if (iframe){ iframe.remove(); iframe = null; }
      $('#thIdx').textContent = pad(i + 1);
      $('#thTitle').textContent = it.title + (it.credit ? ' | ' + it.credit : '');
      Array.prototype.forEach.call(strip.children, function(b, k){ b.classList.toggle('is-now', k === i); });
      var now = strip.children[i]; if (now && now.scrollIntoView) try { now.scrollIntoView({block:'nearest', inline:'center'}); } catch (e) {}
      writeHash();
      setMediaSession(it);

      /* Where to start: the moment asked for, or where this person left off. */
      var saved = t < 0 ? savedFor(it) : null;
      var startAt = t >= 0 ? t : saved ? saved.t : Number(it.start) || 0;
      if (saved && t < 0) say('Resuming from ' + tc(saved.t).replace(/^00:/, ''));

      if (it.src){
        video.hidden = false; video.src = it.src; if (it.poster) video.poster = it.poster; else video.removeAttribute('poster');
        video.classList.toggle('contain', !!it.fit);
        video.muted = muted; video.volume = volume; video.playbackRate = rate;
        video.load();
        $('#thSpin').hidden = false;                 /* until it can play, or fails */
        /* The deferred seek is tied to this load. On a slow connection a
           second Next can land before the first film has metadata; the
           listener left behind then fired on the next film's metadata and
           seeked it to the previous film's saved position. */
        var mine = ++loadSeq;
        var applyStart = function(){ if (mine !== loadSeq) return; if (startAt > 0) try { video.currentTime = startAt; } catch (e) {} };
        if (video.readyState >= 1) applyStart(); else video.addEventListener('loadedmetadata', applyStart, { once: true });
        /* iOS and Android refuse play() on a file that is not muted until the
           visitor has asked for sound on this page. A returning visitor
           carries Sound: On from last time, so the promise was rejected, the
           catch painted a pause icon over a still frame, and the spinner sat
           there: the film simply never started, which is most of what "does
           not work on phones" was. Retry muted, and say so, so the Sound
           control is the obvious next tap rather than a mystery. */
        var p = video.play();
        if (p && p.then) p.then(paintPlay).catch(function(err){
          /* Only the refusal this was written for. play() also rejects with
             AbortError whenever the load() above interrupts it, which is
             routine and has nothing to do with sound; treating that as a
             blocked autoplay would mute films nobody asked to mute. */
          if (!err || err.name !== 'NotAllowedError'){ paintPlay(); return; }
          if (video.muted){ paintPlay(); return; }
          video.muted = true;
          var again = video.play();
          if (again && again.then) again.then(function(){
            setSound(false); paintPlay(); say('Started with sound off. Tap Sound to turn it on.');
          }).catch(function(){ video.muted = muted; paintPlay(); });
          else { setSound(false); paintPlay(); }
        });
      } else {
        video.pause(); video.removeAttribute('src'); video.hidden = true;
        iframe = document.createElement('iframe');
        iframe.allow = 'autoplay; fullscreen; picture-in-picture'; iframe.setAttribute('allowfullscreen', '');
        iframe.title = it.title;
        /* start: the ?t= a shared link carries, or the remembered position,
           or the film's own start. Whole seconds only. */
        var at = Math.max(0, Math.floor(startAt || 0));
        var origin = '';
        try { origin = /^https?:$/.test(location.protocol) ? '&origin=' + encodeURIComponent(location.origin) : ''; } catch (e) {}
        /* A YouTube embed is opened bare (controls=0) when its API is already
           here to drive it, so this page's controls are the only controls on
           the screen: no second volume, no second bar. When the API script
           has not arrived (first open, or blocked), the embed keeps its own
           controls, because a bare embed nobody can drive is a locked door.
           fs=0 always: full screen is this page's button. */
        /* nativeControls is only ever set by the full screen button, on a
           browser that refused every element it was offered. It is not a
           capability guess made at build time: that was v1.37's mistake, and
           because the reopen below only knows "not bare means the API lost
           the race", a standing guess made every rebuild fire another. This
           flag says the frame is non-bare deliberately, and is set once, by a
           press. */
        var keepNative = !!opts.nativeControls;
        var driven = !keepNative && !!(window.YT && window.YT.Player);
        iframe._keepNative = keepNative;
        iframe._bare = it.yt ? driven : false;
        if (iframe._bare) iframe.className = 'bare';
        iframe.src = it.yt ? 'https://www.youtube.com/embed/' + it.yt + '?autoplay=1&mute=' + (muted ? 1 : 0) + '&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&fs=' + (keepNative ? 1 : 0) + '&iv_load_policy=3' + (driven ? '&controls=0&disablekb=1' : '') + origin + (at ? '&start=' + at : '')
                   : 'https://player.vimeo.com/video/' + it.vimeo + '?autoplay=1&muted=' + (muted ? 1 : 0) + '&dnt=1&api=1' + (at ? '#t=' + at + 's' : '');
        stage.insertBefore(iframe, stage.firstChild);
        /* Until the player answers, the readouts are hidden by tick(): an
           embed that has not reported a duration has nothing to show. */
        if (it.yt) attachYt(iframe, i); else if (it.vimeo) attachVimeo(iframe, i);
      }
      paintPlay();
      sharpen();
      tick();
      live('Now playing: ' + it.title);
    }

    /* ---- picture quality ----
       Owner, 10 Oct 2026, of a Quality control that sent people to YouTube's
       own settings: "Don't tell users to use YouTube's quality settings,
       since the player isn't presented as YouTube. Add a quality selector
       here if supported; otherwise, omit it and automatically use the
       highest available YouTube quality."

       A selector is not supported. Since 24 Oct 2019 YouTube's player API
       has no quality to set (setPlaybackQuality does nothing, a suggested
       quality is ignored, getAvailableQualityLevels answers nothing), so a
       menu here would change nothing, and there is none. YouTube picks the
       quality itself, from the size its player is drawn at and from the
       connection. So a film this page drives is drawn at the size it would
       have full screen on this screen, at least 1080 lines and at most 4K,
       and a transform shrinks it to the stage: the size YouTube measures is
       the drawn one, and it picks the highest tier for it that the film has.
       YouTube still steps down when the connection cannot keep up, so the
       film never stalls for its pixels, and a browser set to save data is
       left to YouTube's own choice. Only a bare frame is drawn large: one
       showing YouTube's controls would have them shrunk with it. A film
       served from this site is one file, at the one quality it has. */
    var SHARP_MIN = 1080, SHARP_MAX = 2160;
    function sharpen(){
      var f = iframe;
      if (!f) return;
      var k = 1;
      try {
        var save = navigator.connection && navigator.connection.saveData;
        var sw = stage.clientWidth, sh = stage.clientHeight;
        if (f._bare && !save && sw > 0 && sh > 0){
          var dpr = window.devicePixelRatio || 1;
          /* the film's short side now, in the stage: a long film is 16:9,
             native or filled; a short one is 9:16 inside a frame the size
             of the stage */
          var now;
          if (th.classList.contains('is-short')) now = Math.min(sw, sh * 9 / 16);
          else now = (filled ? Math.max(sw, sh * 16 / 9) : Math.min(sw, sh * 16 / 9)) * 9 / 16;
          /* and full screen, turned the way the film is: the same sum for
             both, the screen's short side or 9/16 of its long one */
          var sc = window.screen || {}, a = Math.max(sc.width || 0, sc.height || 0), b = Math.min(sc.width || 0, sc.height || 0);
          var full = Math.min(b, a * 9 / 16) * dpr;
          var want = Math.min(SHARP_MAX, Math.max(SHARP_MIN, full || 0));
          k = Math.min(4, Math.max(1, want / (now * dpr)));
        }
      } catch (e) { k = 1; }
      k = Math.round(k * 1000) / 1000;
      f.style.setProperty('--th-k', String(k));
      f.style.setProperty('--th-s', String(Math.round(100000 / k) / 100000));
    }

    /* ---- the chrome: top bar, and the bottom block of strip, ruler and
       controls ----
       Where the pointer is decides. Over the film - anywhere off the control
       surfaces - the whole chrome steps away at once and the film has the
       screen; brought down to the strip and controls, or up to the clock and
       Close, it returns. No waiting on a timer either way. The chrome also
       stays while the film is paused, while a card, the menu or the help
       sheet is up, while a control holds focus, and for a moment after any
       key. A tap on a touch screen brings it back rather than pausing. */
    var bottom = $('#thBottom'), top = document.querySelector('.th-top');
    var pointerZone = true, keysUntil = 0, syncT = null;
    function bottomH(){ return bottom.offsetHeight; }
    function chromeNeeded(){
      if (!wasOpen) return true;
      if (!P.playing()) return true;
      if (!$('#thCard').hidden || !$('#thHelp').hidden || !$('#thRateMenu').hidden) return true;
      /* Focus pins the chrome only when it is a keyboard's focus. open()
         stands focus on Close for the keyboard hand; counting that focus
         unconditionally meant a mouse hand could hover the film all night
         and the chrome never stepped away. :focus-visible tells the two
         apart; where it cannot be asked, the pointer decides and the
         keyboard hand is still covered by the moment after any key. */
      var focused = document.activeElement, kbd = false;
      try { kbd = !!(focused && focused.matches && focused.matches(':focus-visible')); } catch (e) { kbd = false; }
      if (kbd && (bottom.contains(focused) || top.contains(focused))) return true;
      if (Date.now() < keysUntil) return true;
      return pointerZone;
    }
    /* On a touch screen the bottom block never steps away (theatre.css keeps
       it in place under hover:none, so the controls are always reachable);
       only the top bar does. The caption is offset by the block's height,
       and setting that to zero while the block was still standing put the
       caption underneath the controls on every phone. */
    var touchOnly = false;
    try { touchOnly = !!(window.matchMedia && window.matchMedia('(hover:none)').matches); } catch (e) {}
    function setBottom(on){
      bottom.classList.toggle('away', !on);
      top.classList.toggle('away', !on);
      th.classList.toggle('is-idle', !on);
      th.style.setProperty('--th-bottom', (on || touchOnly) ? bottomH() + 'px' : '0px');
    }
    function sync(){ setBottom(chromeNeeded()); armRest(); }
    /* While the film has the screen and the hand is still, the pointer rests
       too - the way every theatre hides it - and the smallest movement wakes
       it. It never rests while the chrome is up: a visible control row with
       an invisible pointer is a trap. */
    var restT = null;
    function restCursor(on){ if (window.PFA_CHROME && PFA_CHROME.restCursor) PFA_CHROME.restCursor(on); }
    function armRest(){
      clearTimeout(restT); restCursor(false);
      if (wasOpen && !chromeNeeded()) restT = setTimeout(function(){ restCursor(true); }, 2400);
    }
    function wake(){
      keysUntil = Date.now() + 2500;
      sync();
      clearTimeout(syncT); syncT = setTimeout(sync, 2600);
    }
    function inChromeZone(e){
      var r = th.getBoundingClientRect();
      if (e.clientY <= r.top + Math.max(top.offsetHeight, 72) + 16) return true;
      if (e.clientY >= r.bottom - Math.max(bottomH(), 160) - 24) return true;
      var t = e.target;
      return !!(t && t.closest && (t.closest('.th-bottom') || t.closest('.th-top')));
    }
    function setScrub(on){
      bottom.classList.toggle('is-scrub', on);
      th.classList.toggle('is-scrub', on);
    }
    th.addEventListener('pointermove', function(e){
      if (e.pointerType === 'touch') return;
      var zone = inChromeZone(e);
      /* Off the control surfaces the scrub state has no meaning, and letting
         it linger would animate the pushed items back under a block that is
         itself hiding. Cleared first, silently, under the fading block. */
      if (!zone) setScrub(false);
      if (zone !== pointerZone){ pointerZone = zone; sync(); }
      else armRest();
    });
    th.addEventListener('pointerleave', function(e){ if (e.pointerType === 'touch') return; pointerZone = false; sync(); });
    bottom.addEventListener('focusin', function(){ setScrub(false); sync(); });
    bottom.addEventListener('focusout', function(){ setTimeout(sync, 10); });

    /* ---- phone mode ----
       Owner, 21 Oct 2026: "VIDEOS DONT PLAY PERFECTLY ON MOBILE SCREENS. YOU
       NEED TO MAKE THE MOBILE VIDEO PLAYING EXPERIENCE PERFECTLY LIKE
       NETFLIX". On a touch phone the desktop layout stacked the clock, two
       text toggles, the controls, a film strip, the ruler and the page's
       links around the film, which was left a band of the screen, and the
       controls never stepped away. Now (theatre.css, .is-phone) the film has
       the whole screen and everything floats over it: Close and the title on
       top, Sound beside them, the big back, play and forward in the middle,
       the scrubber with the time, Next and Full screen at the bottom. A tap
       brings them, three seconds of playing puts them away, a pause keeps
       them, a swipe down the film closes it. A wide screen is untouched. */
    var phoneQ = null;
    try { phoneQ = window.matchMedia ? window.matchMedia('(hover:none) and (pointer:coarse)') : null; } catch (e) { phoneQ = null; }
    function phone(){ return !!(phoneQ && phoneQ.matches); }
    function paintPhone(){ th.classList.toggle('is-phone', phone()); th.classList.toggle('is-single', LIST.length < 2); if (wasOpen) sync(); }
    paintPhone();
    if (phoneQ){ if (phoneQ.addEventListener) phoneQ.addEventListener('change', paintPhone); else if (phoneQ.addListener) phoneQ.addListener(paintPhone); }
    var hideT = null;
    function restSoon(){
      clearTimeout(hideT);
      if (!phone()) return;
      hideT = setTimeout(function(){ if (wasOpen && P.playing()){ pointerZone = false; sync(); } }, 3000);
    }
    $('#thMidBack').addEventListener('click', function(){ skip(-SKIP); restSoon(); });
    $('#thMidFwd').addEventListener('click', function(){ skip(SKIP); restSoon(); });
    $('#thMidPlay').addEventListener('click', function(){ toggle(); restSoon(); });
    bottom.addEventListener('pointerdown', function(){ if (phone()) clearTimeout(hideT); });
    bottom.addEventListener('pointerup', function(){ restSoon(); });
    video.addEventListener('playing', function(){ restSoon(); });
    var downX = null, downY = null;
    stage.addEventListener('pointerdown', function(e){ if (e.pointerType === 'touch'){ downX = e.clientX; downY = e.clientY; } });

    /* Touch: one tap shows or puts away the chrome; a double tap in the
       middle pauses or plays; a double tap on the left or right third skips
       ten seconds. Play and pause also live on the buttons a tap reveals. */
    var lastTap = 0, tapT = null, touchedAt = 0;
    stage.addEventListener('pointerup', function(e){
      if (e.pointerType !== 'touch') return;
      touchedAt = Date.now();
      /* a swipe down the film, on a phone, closes it */
      if (phone() && downY !== null && e.clientY - downY > 90 && Math.abs(e.clientX - downX) < 70){ downY = null; close(); return; }
      downY = null;
      if (!onFilm(e.target) && !(iframe && e.target === iframe)) return;
      var now = Date.now(), r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (now - lastTap < 320){
        clearTimeout(tapT); lastTap = 0;
        if (x < 0.33) skip(-SKIP); else if (x > 0.67) skip(SKIP); else toggle();
        return;
      }
      lastTap = now;
      clearTimeout(tapT);
      tapT = setTimeout(function(){
        pointerZone = bottom.classList.contains('away');
        sync();
        if (pointerZone) restSoon();
      }, 330);
    });

    /* The API script is warmed the moment a hand moves toward a tile, so by
       the time the theatre opens, even the first embed can open bare. A
       visitor who never goes near the wall never loads it. */
    function warmOnce(e){
      if (!e.target.closest || !e.target.closest('[data-play],[data-theatre-open],[data-go]')) return;
      loadYtApi();
      document.removeEventListener('pointerover', warmOnce);
      document.removeEventListener('focusin', warmOnce);
    }
    document.addEventListener('pointerover', warmOnce);
    document.addEventListener('focusin', warmOnce);

    function open(i, which, startAt){
      lastFocus = document.activeElement;
      loadYtApi();                    /* and again here: a deep link skips the hover */
      setList(which || 'long');
      th.hidden = false; th.classList.add('open'); document.body.classList.add('theatre-lock'); wasOpen = true;
      /* Read the stage before building anything into it. The theatre went from
         display:none to visible one line ago, and an embed created before the
         browser has laid that out is an embed YouTube measures at nothing,
         which is the size it picks the lowest tier for. Reading offsetHeight
         forces the layout now, so the frame is born full size. */
      void $('#thStage').offsetHeight;
      drawRule(); paintAuto(); paintPhone();
      /* A film opened by a tap on a phone starts with sound, as a phone's own
         player does; a phone that refuses is caught by load(), which starts
         it muted and says so. The one exception is a YouTube film on an
         iPhone, which will not start at all unmuted: it starts muted, with
         the Sound control showing. */
      if (phone() && muted){
        var film = LIST[i || 0] || {};
        var ios = /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (film.src || !ios){
          muted = false; video.muted = false;
          $('#thOff').classList.remove('on'); $('#thOn').classList.add('on'); $('#thSound').setAttribute('aria-pressed', 'true');
        }
      }
      load(i || 0, typeof startAt === 'number' && startAt > 0 ? { startAt: startAt } : {});
      pointerZone = true; sync();
      if (window.PFA_CHROME && PFA_CHROME.recolourCursor) PFA_CHROME.recolourCursor();
      $('#thClose').focus();
    }
    function close(){
      var was = clock(); if (was.known && LIST[cur]) saveProg(LIST[cur], was.t, was.d);
      card(null); $('#thHelp').hidden = true;
      if (isFull()) try { fullscreen(); } catch (e) {}
      setScrub(false);
      clearTimeout(restT); restCursor(false);
      th.classList.remove('open'); th.hidden = true; document.body.classList.remove('theatre-lock'); wasOpen = false;
      video.pause(); if (iframe){ iframe.remove(); iframe = null; } yt = null;
      if (/^#theatre/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      if (window.PFA_CHROME && PFA_CHROME.recolourCursor) PFA_CHROME.recolourCursor();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function toggle(){
      if (iframe && !P.ext()) return;
      if (P.playing()) P.pause(); else P.play();
    }
    function paintAuto(){ var b = $('#thAuto'); b.setAttribute('aria-pressed', String(autoplay)); b.textContent = 'Autoplay' + (autoplay ? '' : ' off'); }
    function setAuto(on){ autoplay = on; try { localStorage.setItem('pfa:wall:autoplay', on ? 'on' : 'off'); } catch (e) {} paintAuto(); live(on ? 'Autoplay on' : 'Autoplay off'); }

    /* ---- full screen ----
       Two different things wear the same name. Everywhere except an iPhone,
       an element can be made full screen, so the theatre goes whole and this
       page's own controls come with it. An iPhone has no element full screen
       at all: Element.requestFullscreen and its webkit spelling are both
       absent, and the only full screen iOS has is a video file's own, which
       hands the film to the system player. iPad has both.

       The old code treated the iPhone path as a third fallback and never
       arrived: it reported entry through `fullscreenchange`, which the system
       player does not fire, so the button stayed unpressed, `fsElement()`
       stayed null, and a second tap tried to enter again rather than leave.
       Escape and Close read the same null and left the film full screen
       behind a shut theatre. Hence a capability test up front and two honest
       paths, each reporting through its own events. */
    function fsElement(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
    /* The system player, which is not in the document and so is not an
       element the document can name. */
    function iosFull(){ return !!(video && video.webkitDisplayingFullscreen); }
    function isFull(){ return !!fsElement() || iosFull(); }

    /* A 16:9 film on a phone held upright is a letterbox two fingers tall, so
       full screen turns the phone. Shorts are left alone: they are vertical,
       and turning the screen would be turning it the wrong way. Guarded to
       the last line, because most browsers refuse this and the refusal must
       not become the thing the visitor notices. */
    function orient(lock){
      var o = screen && screen.orientation; if (!o) return;
      try {
        if (!lock){ if (o.unlock) o.unlock(); return; }
        if (th.classList.contains('is-short') || !o.lock) return;
        var out = o.lock('landscape');
        if (out && out.catch) out.catch(function(){});
      } catch (e) {}
    }

    function fullscreen(){
      if (fsElement()){
        var out = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen ? document.webkitExitFullscreen() : null;
        if (out && out.catch) out.catch(function(){});
        orient(false);
        return;
      }
      if (iosFull()){ try { video.webkitExitFullscreen(); } catch (e) {} return; }

      /* One chain for every device. v1.37 put a capability branch in front of
         this on the belief that an iPhone has no element full screen. That
         was true for years and stopped being true in Safari 17.2, which
         shipped it to iPhone in 2023 and had it working on ordinary elements
         by 17.4. The branch sent current iPhones down a path built for old
         ones: embeds kept YouTube's controls, so Fill had no bare iframe to
         resize and did nothing, and this button declined to act and pointed
         at a control inside the embed instead. Both are gone. The webkit
         spelling and the file fallback below still carry an iPhone old enough
         to need them. */
      /* Ask an element for full screen and answer with a promise either
         way. The standard call returns one; the webkit spelling returns
         nothing at all and reports through webkitfullscreenchange or
         webkitfullscreenerror. The chain used to read that nothing as a
         refusal and go straight on to the next step, so on a Safari old
         enough to have only the prefixed call every step fired in turn -
         theatre, then document, then the video element - and the film
         ended up in the native player with this page's controls gone. */
      function ask(el, f){
        if (!f) return null;
        var out = f.call(el, { navigationUI: 'hide' });
        if (out && out.then) return out;
        return new Promise(function(resolve, reject){
          var done = false, timer = null;
          function off(){ ['fullscreenchange', 'webkitfullscreenchange'].forEach(function(n){ document.removeEventListener(n, ok); }); ['fullscreenerror', 'webkitfullscreenerror'].forEach(function(n){ document.removeEventListener(n, bad); }); clearTimeout(timer); }
          function ok(){ if (done) return; done = true; off(); resolve(); }
          function bad(){ if (done) return; done = true; off(); reject(); }
          ['fullscreenchange', 'webkitfullscreenchange'].forEach(function(n){ document.addEventListener(n, ok); });
          ['fullscreenerror', 'webkitfullscreenerror'].forEach(function(n){ document.addEventListener(n, bad); });
          timer = setTimeout(function(){ if (fsElement()) ok(); else bad(); }, 700);
        });
      }
      var steps = [
        function(){ return ask(th, th.requestFullscreen || th.webkitRequestFullscreen); },
        function(){ var d = document.documentElement; return ask(d, d.requestFullscreen || d.webkitRequestFullscreen); },
        /* iOS refuses a div and the document, but it has always allowed a
           <video>, first through webkitEnterFullscreen and now through the
           standard call on the element. Neither was in this chain: it asked
           for the theatre, then the page, then gave up. */
        function(){ if (iframe || !video) return null; return ask(video, video.requestFullscreen || video.webkitRequestFullscreen); },
        function(){ return !iframe && enterIosFullscreen() ? Promise.resolve() : null; },
        /* An embed is a cross-origin frame, and on a browser that will not
           make an element full screen there is no call that can reach inside
           it. What can be done is hand the film back to YouTube's own player,
           which has a full screen control that works, at the same second the
           film had reached. One press, one reload, and the control is there.
           Only from here: the embed is bare by default so Fill keeps working,
           and this is the one path that gives that up, in exchange for the
           full screen the visitor just asked for. */
        function(){
          if (!iframe || !LIST[cur] || !LIST[cur].yt) return null;
          var t = 0; try { t = Math.floor(Number(clock().t) || 0); } catch (e) {}
          load(cur, { startAt: t, nativeControls: true });
          say('Full screen is in the player here. Tap its own control.');
          return Promise.resolve();
        }
      ];
      (function attempt(k){
        if (k >= steps.length){ say('Full screen is not available here.'); return; }
        var out;
        try { out = steps[k](); } catch (e) { out = null; }
        if (out === null || out === undefined || out === false){ attempt(k + 1); return; }
        if (out.then) out.then(function(){ orient(true); }, function(){ attempt(k + 1); });
        else orient(true);
      })(0);
    }

    /* webkitEnterFullscreen throws InvalidStateError before the file has
       metadata, which is exactly where a fast tap lands. One deferred retry:
       iOS still honours the call on the loadedmetadata that the same gesture
       started, and a film that never loads is already saying so elsewhere. */
    function enterIosFullscreen(){
      if (iframe || !video || !video.webkitEnterFullscreen) return false;
      try { video.webkitEnterFullscreen(); orient(true); return true; } catch (e) {}
      video.addEventListener('loadedmetadata', function(){
        try { video.webkitEnterFullscreen(); orient(true); } catch (e2) {}
      }, { once: true });
      return true;
    }

    function onFsChange(){
      var on = isFull();
      $('#thFull').setAttribute('aria-pressed', String(on)); $('#thFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      if (!on) orient(false);
      sharpen(); drawRule(); tick();
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    /* The system player's own pair. Without these the button never changes
       state on an iPhone and nothing knows the film came back. */
    video.addEventListener('webkitbeginfullscreen', onFsChange);
    video.addEventListener('webkitendfullscreen', onFsChange);

    /* ---- rates menu ---- */
    var menu = $('#thRateMenu');
    menu.innerHTML = RATES.map(function(r){ return '<button type="button" role="menuitemradio" data-rate="' + r + '" aria-checked="' + (r === 1) + '">' + String(r) + '\u00d7</button>'; }).join('');
    function menuOpen(on){ menu.hidden = !on; $('#thRateBtn').setAttribute('aria-expanded', String(on)); if (on){ var c = menu.querySelector('[aria-checked="true"]') || menu.firstChild; if (c) c.focus(); } }
    $('#thRateBtn').addEventListener('click', function(){ menuOpen(menu.hidden); });
    menu.addEventListener('click', function(e){ var b = e.target.closest('[data-rate]'); if (!b) return; P.setRate(Number(b.getAttribute('data-rate'))); menuOpen(false); $('#thRateBtn').focus(); flash($('#thRateNow').textContent); });
    document.addEventListener('click', function(e){ if (!menu.hidden && !e.target.closest('#thRate')) menuOpen(false); });
    function stepRate(dir){ var i = RATES.indexOf(rate); i = Math.max(0, Math.min(RATES.length - 1, i + dir)); P.setRate(RATES[i]); flash($('#thRateNow').textContent); }

    /* ---- the controls ---- */
    document.addEventListener('click', function(e){
      var t = e.target.closest('[data-play]'); if (t){ var n = +t.getAttribute('data-play'), w = WALL[n].wall; open(WALL.filter(function(it){ return it.wall === w; }).indexOf(WALL[n]), w); return; }
      var o = e.target.closest('[data-theatre-open]'); if (o){ e.preventDefault(); open(0, o.getAttribute('data-theatre-open') || 'long'); return; }
      var g = e.target.closest('[data-go]'); if (g){ load(+g.getAttribute('data-go')); return; }
      var c = e.target.closest('[data-theatre-close]'); if (c){ close(); return; }
    });
    $('#thClose').addEventListener('click', close);
    $('#thSound').addEventListener('click', function(){ setSound(muted); });

    /* Native frame or filled frame. Native is the default: the whole picture,
       letterboxed where the screen is not 16:9. Fill crops to cover, the old
       behaviour, for anyone who prefers no bars. Remembered across visits. */
    var FRAME_KEY = 'pfa:theatre:frame';
    var filled = false;
    try { filled = localStorage.getItem(FRAME_KEY) === 'fill'; } catch (e) {}
    function setFrame(fill){
      filled = Boolean(fill);
      th.classList.toggle('is-fill', filled);
      $('#thFitNative').classList.toggle('on', !filled);
      $('#thFitFill').classList.toggle('on', filled);
      $('#thFit').setAttribute('aria-pressed', String(filled));
      try { localStorage.setItem(FRAME_KEY, filled ? 'fill' : 'native'); } catch (e) {}
      sharpen();
    }
    setFrame(filled);
    $('#thFit').addEventListener('click', function(){ setFrame(!filled); flash(filled ? 'Filled frame' : 'Native frame'); });
    $('#thPlay').addEventListener('click', toggle);
    $('#thPrev').addEventListener('click', function(){ load(cur - 1); });
    $('#thNext').addEventListener('click', function(){ load(cur + 1); });
    $('#thBack').addEventListener('click', function(){ skip(-SKIP); });
    $('#thFwd').addEventListener('click', function(){ skip(SKIP); });
    $('#thAuto').addEventListener('click', function(){ setAuto(!autoplay); });
    $('#thFull').addEventListener('click', fullscreen);
    $('#thHelpBtn').addEventListener('click', function(){ $('#thHelp').hidden = false; $('#thHelpClose').focus(); });
    $('#thHelpClose').addEventListener('click', function(){ $('#thHelp').hidden = true; $('#thHelpBtn').focus(); });
    /* The toast says it too, but the toast appears at the other end of the
       screen from the button that was pressed, and on a long film the eye is
       on the film. The button answers where the finger is, then goes back to
       being an instruction. Width is pinned while it says Copied so the row
       beside it does not shuffle sideways and back. */
    var shareT = null;
    function shareSaid(word){
      var b = $('#thShare');
      if (word === 'Copied'){
        b.style.minWidth = b.getBoundingClientRect().width + 'px';
        b.classList.add('is-done');
      } else {
        b.style.minWidth = ''; b.classList.remove('is-done');
      }
      b.textContent = word;
    }
    $('#thShare').addEventListener('click', function(){
      var url = shareLink();
      var done = function(){
        say('Link copied'); live('Link copied');
        shareSaid('Copied');
        clearTimeout(shareT);
        shareT = setTimeout(function(){ shareSaid('Copy link'); }, 2000);
      };
      var fallback = function(){ try { window.prompt('Copy this link', url); } catch (e) {} };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
    });
    var seekBar = $('#thSeek'), seekWrap = $('#thSeekWrap');
    function seekPreview(frac){
      $('#thFill').style.width = (frac * 100) + '%'; $('#thKnob').style.left = (frac * 100) + '%';
      seekBar.setAttribute('aria-valuetext', tc(frac * clock().d));
    }
    seekBar.addEventListener('input', function(){ dragging = true; seekWrap.classList.add('is-drag'); seekPreview(Number(seekBar.value) / 1000); });
    seekBar.addEventListener('change', function(){ dragging = false; seekWrap.classList.remove('is-drag'); P.seek(Number(seekBar.value) / 1000 * clock().d); });
    /* Arrow keys on the bar are the bar's, not the page's: a nudge on it moves
       one thousandth, which for a long film is a second or two. */
    seekBar.addEventListener('keydown', function(e){
      var c = clock(); if (!c.known) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ e.preventDefault(); e.stopPropagation(); skip(e.key === 'ArrowLeft' ? -SKIP : SKIP); }
      if (e.key === 'Home'){ e.preventDefault(); e.stopPropagation(); P.seek(0); }
      if (e.key === 'End'){ e.preventDefault(); e.stopPropagation(); P.seek(c.d); }
    });
    seekWrap.addEventListener('pointermove', function(e){
      var c = clock(), tip = $('#thTip'); if (!c.known || e.pointerType === 'touch'){ tip.hidden = true; return; }
      var r = seekWrap.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      tip.textContent = tc(f * c.d); tip.style.left = (f * 100) + '%'; tip.hidden = false;
      setScrub(true);
    });
    seekWrap.addEventListener('pointerleave', function(){ $('#thTip').hidden = true; setScrub(false); });

    function onFilm(t){ return t === video || t === stage || t === $('#thShield'); }
    stage.addEventListener('click', function(e){
      if (Date.now() - touchedAt < 600) return;   /* a touch: handled above */
      if (onFilm(e.target)) toggle();
    });
    stage.addEventListener('dblclick', function(e){ if (onFilm(e.target)) fullscreen(); });
    $('#thRule').addEventListener('click', function(e){
      var r = rule.getBoundingClientRect(), f = (e.clientX - r.left) / r.width * LIST.length, i = Math.floor(f);
      if (i !== cur){ load(i, { startAt: 0 }); return; }
      var c = clock();
      if (!c.known) return;
      P.seek((f - i) * c.d);
    });

    video.addEventListener('play', function(){ $('#thSpin').hidden = true; paintPlay(); });
    video.addEventListener('playing', function(){ $('#thSpin').hidden = true; paintPlay(); });
    video.addEventListener('pause', function(){ paintPlay(); if (!video.ended && video.duration) saveProg(LIST[cur], video.currentTime, video.duration); });
    video.addEventListener('waiting', function(){ if (!iframe) $('#thSpin').hidden = false; });
    video.addEventListener('stalled', function(){ if (!iframe && !video.paused) $('#thSpin').hidden = false; });
    video.addEventListener('canplay', function(){ $('#thSpin').hidden = true; });
    video.addEventListener('timeupdate', function(){ tick(); if (!video.paused && video.duration) saveProgThrottled(video.currentTime, video.duration); });
    video.addEventListener('progress', tick);
    video.addEventListener('loadedmetadata', tick);
    video.addEventListener('durationchange', tick);
    video.addEventListener('volumechange', function(){ if (!iframe && video.muted !== muted){ setSound(!video.muted); } });
    video.addEventListener('ratechange', function(){ if (!iframe && video.playbackRate !== rate && video.playbackRate > 0){ rate = video.playbackRate; $('#thRateNow').textContent = String(rate) + '\u00d7'; } });
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', function(){ if (!iframe && video.getAttribute('src')) showError(); });
    window.addEventListener('resize', function(){ if (wasOpen){ sharpen(); drawRule(); tick(); sync(); } });
    window.addEventListener('pagehide', function(){ if (wasOpen){ var c = clock(); if (c.known && LIST[cur]) saveProg(LIST[cur], c.t, c.d); } });

    /* Tab stays inside the theatre while it is open: it is a dialog, and the
       page under it is not there to be reached. */
    function focusables(){
      return Array.prototype.filter.call(th.querySelectorAll('button,a[href],input,[tabindex]:not([tabindex="-1"])'), function(el){
        return !el.disabled && !el.hidden && el.offsetParent !== null && !el.closest('[hidden]');
      });
    }
    document.addEventListener('keydown', function(e){
      if (!wasOpen) return;
      var tgt = e.target && e.target.closest ? e.target : document.body;
      var inField = /^(input|textarea|select)$/i.test(tgt.tagName || '') && tgt.type !== 'range';
      if (e.key === 'Tab'){
        var list = focusables(); if (!list.length) return;
        var i = list.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)){ e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === list.length - 1)){ e.preventDefault(); list[0].focus(); }
        return;
      }
      if (e.key === 'Escape'){
        if (!$('#thHelp').hidden){ $('#thHelp').hidden = true; $('#thHelpBtn').focus(); return; }
        if (!menu.hidden){ menuOpen(false); return; }
        if (isFull()){ fullscreen(); return; }
        close(); return;
      }
      if (inField) return;
      var k = e.key, lower = k.toLowerCase();
      if (k === ' ' || lower === 'k'){ if (tgt.closest('button,a') && k === ' ') return; e.preventDefault(); toggle(); }
      else if (k === 'ArrowRight' || lower === 'l'){ e.preventDefault(); if (e.shiftKey) load(cur + 1); else skip(SKIP); }
      else if (k === 'ArrowLeft' || lower === 'j'){ e.preventDefault(); if (e.shiftKey) load(cur - 1); else skip(-SKIP); }
      else if (lower === 'n'){ load(cur + 1); }
      else if (lower === 'p'){ load(cur - 1); }
      else if (k === 'ArrowUp'){ e.preventDefault(); P.setVolume(volume + 0.1); flash('Volume ' + Math.round(volume * 100) + '%'); }
      else if (k === 'ArrowDown'){ e.preventDefault(); P.setVolume(volume - 0.1); flash('Volume ' + Math.round(volume * 100) + '%'); }
      else if (lower === 'm'){ setSound(muted); flash(muted ? 'Sound off' : 'Sound on'); }
      else if (lower === 'f'){ fullscreen(); }
      else if (lower === 'a'){ setAuto(!autoplay); flash(autoplay ? 'Autoplay on' : 'Autoplay off'); }
      else if (lower === 'z'){ setFrame(!filled); flash(filled ? 'Filled frame' : 'Native frame'); }
      else if (k === '?'){ $('#thHelp').hidden = !$('#thHelp').hidden; if (!$('#thHelp').hidden) $('#thHelpClose').focus(); }
      else if (k === '>' || k === '.'){ stepRate(1); }
      else if (k === '<' || k === ','){ stepRate(-1); }
      else if (/^[0-9]$/.test(k)){ var c = clock(); if (c.known){ P.seek(c.d * Number(k) / 10); flash(k + '0%'); } }
      else if (k === 'Home'){ P.seek(0); }
      else if (k === 'End'){ var ce = clock(); if (ce.known) P.seek(ce.d); }
      wake();
    });

    /* Both hashes are named in full. #theatre-long used to be matched only by
       the /^#theatre/ fallback, so nothing in the file said the word out loud
       and the link audit reported the two links pointing at it as dead. The
       fallback stays for a bare #theatre. A link can also name the film and
       the moment: #theatre-long?f=3&t=95. */
    var deep = parseHash(location.hash);
    if (location.hash === '#theatre-short') open(0, 'short');
    else if (location.hash === '#theatre-long') open(0, 'long');
    else if (deep) open(deep.f, deep.which, deep.t);
    else if (/^#theatre/.test(location.hash)) open(0, 'long');
    window.addEventListener('hashchange', function(){
      var d = parseHash(location.hash);
      if (d && !wasOpen) open(d.f, d.which, d.t);
    });

    /* For the tests, and for anything else on the page that wants to drive
       the theatre rather than click through it. */
    window.PFA_THEATRE = { open: open, close: close, load: load, toggle: toggle, skip: skip, player: P, clock: clock, parseHash: parseHash, shareLink: shareLink, list: function(){ return LIST; }, current: function(){ return cur; }, isOpen: function(){ return wasOpen; }, autoplay: function(){ return autoplay; }, saved: savedFor, keyOf: keyOf, progress: readProg };
    /* The line above replaces the global outright, so mount is put back on
       it: a second page mounting its own theatre must still find the door. */
    window.PFA_THEATRE.mount = mount;
    return window.PFA_THEATRE;
  }

  window.PFA_THEATRE = window.PFA_THEATRE || {};
  window.PFA_THEATRE.mount = mount;
}());
