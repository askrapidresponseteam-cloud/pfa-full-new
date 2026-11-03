/* The internship quiz, in the intern portal (intern.html; the server side is
   lib/intern-quiz.js). One question at a time, answers final once confirmed,
   the clock kept by the server. intern.html calls PFAQuiz.init() with its
   own helpers, and PFAQuiz.card() for the law task's card. */
(function (root) {
  'use strict';
  var H = null;
  var box = null;
  var st = { attempt: null, picked: '', tick: 0, endsAt: 0, busy: false, quiz: null, wrongOnly: false };
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];

  function esc(v) { return H.esc(v); }
  function api(body) {
    return H.api('/api/intern/quiz', body ? { method: 'POST', body: body } : undefined);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function clock(s) {
    var v = Math.max(0, Math.floor(s));
    return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
  }
  function stopClock() { if (st.tick) clearInterval(st.tick); st.tick = 0; }
  function guard(on) { root.onbeforeunload = on ? function () { return 'Your quiz clock keeps running.'; } : null; }
  function sayIn(text, bad) {
    var s = box.querySelector('[data-qz-say]');
    if (s) { s.textContent = text || ''; s.setAttribute('data-state', bad ? 'bad' : ''); }
  }

  /* ---- the card on the law task ------------------------------------------ */

  function lines(q) {
    return (q.attempts || []).map(function (a) {
      return '<li><span>Attempt ' + a.n + ', ' + esc(H.when(a.finishedAt)) + '</span><b>' + a.percent + '%' + (a.pass ? ' · pass' : '') + '</b></li>';
    }).join('');
  }

  function card(q) {
    if (!q) return '';
    var out = '<div class="qzc">';
    out += '<div class="qzc__facts"><span><b>' + q.count + '</b> questions</span><span><b>' + q.minutes + '</b> minutes</span><span><b>' + q.passMark + '%</b> to pass</span></div>';
    if (q.passed && q.best) {
      out += '<p class="qzc__now">You passed with <b>' + q.best.percent + '%</b>. ' + q.best.byLevel.map(function (l) { return l.label + ' ' + l.right + '/' + l.of; }).join(' · ') + '.</p>';
      out += '<button class="btn btn--light" type="button" data-qz="review">See the answers</button>';
    } else if (q.open) {
      out += '<p class="qzc__now">Attempt ' + q.open.n + ' is open: ' + q.open.answered + ' of ' + q.count + ' answered. Your time runs out at ' + esc(H.when(q.open.deadline).replace(/^.*?,\s*/, '')) + '.</p>';
      out += '<button class="btn" type="button" data-qz="resume">Carry on</button>';
    } else if (q.canStart) {
      out += '<button class="btn" type="button" data-qz="intro">' + (q.attempts.length ? 'Start attempt ' + (q.attempts.length + 1) + ' of ' + q.maxAttempts : 'Take the quiz') + '</button>';
    } else if (q.nextAt) {
      out += '<p class="qzc__now">Your best so far is ' + q.best.percent + '%. Attempt ' + (q.attempts.length + 1) + ' opens ' + esc(H.when(q.nextAt)) + '.</p>';
    } else if (q.left <= 0) {
      out += '<p class="qzc__now">All ' + q.maxAttempts + ' attempts are used; your best was ' + (q.best ? q.best.percent : 0) + '%. PFA will review it and write to you.</p>';
      out += '<button class="btn btn--light" type="button" data-qz="review">See the answers</button>';
    }
    if (q.attempts && q.attempts.length) out += '<ul class="qzc__past">' + lines(q) + '</ul>';
    /* seven practice questions, never in the quiz (assets/law-quiz-sample.js) */
    if (!q.passed && root.PFALawSample) out += '<div data-law-sample-host><button class="btn btn--light" type="button" data-law-sample>Try 7 practice questions first</button></div>';
    out += '<details class="fold"><summary>How the quiz works</summary><ul>'
      + '<li>Ten common incidents, three questions on each: ' + q.sections.map(function (s) { return s.count + ' ' + s.label.toLowerCase() + ' (' + plural(s.points, 'mark', 'marks') + ' each)'; }).join(', ') + ', all mixed together.</li>'
      + '<li>One question at a time, five choices, one best answer. Once you confirm an answer it is final: there is no going back.</li>'
      + '<li>The ' + q.minutes + ' minutes run from when you start, even if you close the page. Unanswered questions count as wrong.</li>'
      + '<li>' + q.maxAttempts + ' attempts, at least a day apart; your best counts. Pass with ' + q.passMark + '% and this task is done.</li>'
      + '<li>The answers, with the reasons, open once you pass or have used every attempt.</li></ul></details>';
    return out + '</div>';
  }

  /* ---- the quiz screen ------------------------------------------------------ */

  function frame(html) {
    H.view('#ipQuiz');
    var t = document.getElementById('ipTitle');
    if (t) t.textContent = 'The quiz.';
    box.innerHTML = html + (html.indexOf('data-qz-say') === -1 ? '<p class="say" data-qz-say role="status" aria-live="polite"></p>' : '');
    try { box.scrollIntoView({ block: 'start' }); } catch (_) {}
  }

  function intro() {
    var q = H.data().quiz;
    stopClock(); guard(false);
    frame('<div class="qz__intro"><p class="tile__h">The quiz' + (q.attempts.length ? ', attempt ' + (q.attempts.length + 1) + ' of ' + q.maxAttempts : '') + '</p>'
      + '<h2 class="qz__h">' + q.count + ' questions. ' + q.minutes + ' minutes.</h2>'
      + '<p class="qz__p">Three questions on each of ten incidents you will meet, mixed: ' + q.sections.map(function (s) { return s.count + ' ' + s.label.toLowerCase() + ' (' + plural(s.points, 'mark', 'marks') + ')'; }).join(', ') + '. Two minutes a question.</p>'
      + '<ol class="qz__rules">'
      + (q.incidents || []).map(function (x, i) { return '<li><b>' + (i + 1) + '. ' + esc(x.label) + '</b><span>' + plural(x.count, 'question', 'questions') + '</span></li>'; }).join('')
      + '</ol>'
      + '<p class="qz__p">Answer each question, then confirm it. A confirmed answer is final. The clock starts when you press Start and keeps running if you leave. Find a quiet ' + q.minutes + ' minutes before you begin.</p>'
      + '<div class="qz__acts"><button class="btn" type="button" data-qz="start">Start the ' + q.minutes + ' minutes</button><button class="linkish" type="button" data-qz="back">Not now</button></div></div>');
  }

  function begin(body) {
    if (st.busy) return;
    st.busy = true;
    sayIn('Opening the quiz...');
    api(body).then(function (r) {
      st.busy = false;
      if (r.attempt && r.attempt.state === 'open') return show(r.attempt);
      if (r.quiz) return result(r.quiz);
      back();
    }).catch(function (err) { st.busy = false; sayIn(err.message, true); });
  }

  function show(a) {
    st.attempt = a;
    st.picked = '';
    st.endsAt = Date.now() + a.secondsLeft * 1000;
    guard(true);
    if (!a.question) return finishing();
    var q = a.question;
    var sec = q.section;
    var pct = Math.round(((q.index - 1) / q.total) * 100);
    /* all thirty in one mixed run: where you are, one square a question */
    var cells = '';
    for (var i = 1; i <= q.total; i += 1) cells += '<i data-s="' + (i < q.index ? 'done' : i === q.index ? 'now' : '') + '"></i>';
    var map = '<aside class="qz__map" aria-label="Where you are"><p class="tile__h">Where you are</p><div class="qz__mapsec"><span>' + plural(q.total, 'question', 'questions') + '</span><div>' + cells + '</div></div>'
      + '<p class="qz__mapnote">' + plural(a.answered, 'answer', 'answers') + ' saved. Marks: easy 1, medium 2, hard 3.</p></aside>';
    frame('<div class="qz__wrap"><div class="qz__main"><div class="qz__top"><span class="qz__sec">' + esc(sec.incident || '') + ' · ' + esc(sec.label) + '</span><span class="qz__n">Question ' + q.index + ' of ' + q.total + '</span><span class="qz__clock" data-qz-clock aria-label="Time left">' + clock(a.secondsLeft) + '</span></div>'
      + '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>'
      + '<p class="qz__q" id="qzQ">' + esc(q.text) + '</p>'
      + (q.dataSufficiency ? '<p class="qz__hint">Data sufficiency: decide whether the statements give enough to answer, not what the answer is.</p>' : '')
      + '<div class="qz__opts" role="radiogroup" aria-labelledby="qzQ">' + q.choices.map(function (c) {
        return '<button type="button" role="radio" aria-checked="false" data-qz="pick" data-k="' + c.key + '"><b>' + c.key + '</b><span>' + esc(c.text) + '</span></button>';
      }).join('') + '</div>'
      + '<div class="qz__acts"><button class="btn" type="button" data-qz="confirm" disabled>Confirm answer</button><button class="linkish" type="button" data-qz="leave">Leave for now</button></div>'
      + '<p class="say" data-qz-say role="status" aria-live="polite"></p></div>' + map + '</div>');
    stopClock();
    st.tick = setInterval(function () {
      var left = (st.endsAt - Date.now()) / 1000;
      var c = box.querySelector('[data-qz-clock]');
      if (c) { c.textContent = clock(left); c.setAttribute('data-low', left < 300 ? '1' : ''); }
      if (left <= 0) { stopClock(); timeUp(); }
    }, 1000);
  }

  function pick(k) {
    if (!st.attempt || st.busy) return;
    st.picked = k;
    Array.prototype.forEach.call(box.querySelectorAll('[data-qz="pick"]'), function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-k') === k)); });
    var go = box.querySelector('[data-qz="confirm"]');
    if (go) go.disabled = false;
  }

  function confirm() {
    var a = st.attempt;
    if (!a || !a.question || !st.picked || st.busy) return;
    st.busy = true;
    var go = box.querySelector('[data-qz="confirm"]');
    if (go) { go.disabled = true; go.textContent = 'Saving...'; }
    api({ action: 'answer', attemptId: a.attemptId, qid: a.question.qid, choice: st.picked }).then(function (r) {
      st.busy = false;
      if (r.attempt.state === 'open') return show(r.attempt);
      stopClock(); guard(false);
      result(r.quiz, r.attempt.timeUp);
    }).catch(function (err) {
      st.busy = false;
      if (go) { go.disabled = false; go.textContent = 'Confirm answer'; }
      sayIn(err.message + (err.status === 409 ? '' : ' Your answer was not saved; confirm it again.'), true);
      if (err.status === 401) { stopClock(); guard(false); H.reload(); }
    });
  }

  function finishing() {
    stopClock();
    frame('<p class="qz__p">Marking your answers...</p>');
    poll(0);
  }
  function timeUp() {
    frame('<h2 class="qz__h">Time is up.</h2><p class="qz__p">Marking what you answered. This takes about half a minute.</p>');
    setTimeout(function () { poll(0); }, 22000);
  }
  function poll(n) {
    api().then(function (r) {
      if (r.attempt && r.attempt.state === 'open' && n < 5) return setTimeout(function () { poll(n + 1); }, 5000);
      guard(false);
      result(r.quiz, true);
    }).catch(function (err) { sayIn(err.message, true); });
  }

  /* ---- the marks ------------------------------------------------------------ */

  function bars(list) {
    return list.map(function (l) {
      var p = l.of ? Math.round((l.right / l.of) * 100) : 0;
      return '<div class="qz__row"><span>' + esc(l.label) + '</span><div class="bar" aria-hidden="true"><i style="width:' + p + '%"></i></div><b>' + l.right + '/' + l.of + '</b></div>';
    }).join('');
  }

  function result(q, timedOut) {
    stopClock(); guard(false);
    st.attempt = null;
    st.quiz = q;
    H.refresh(q);
    var a = q && q.attempts && q.attempts[q.attempts.length - 1];
    if (!a) return back();
    var verdict = a.pass ? 'A pass. Week 1\'s task is done.' : 'Below the pass mark of ' + q.passMark + '%.'
      + (q.left > 0 ? ' You have ' + plural(q.left, 'more attempt', 'more attempts') + (q.nextAt ? ', from ' + esc(H.when(q.nextAt)) : '') + '.' : ' PFA will review your best attempt.');
    frame('<p class="tile__h">Attempt ' + a.n + (a.timedOut || timedOut ? ' · time ran out' : '') + '</p>'
      + '<div class="count"><b>' + a.percent + '%</b><span class="tile__p">' + a.points + ' of ' + a.max + ' marks · ' + a.answered + ' of ' + q.count + ' answered</span></div>'
      + '<p class="qz__verdict" data-pass="' + (a.pass ? '1' : '') + '">' + verdict + '</p>'
      + '<div class="qz__rows">' + bars(a.byLevel) + '</div>'
      + '<details class="fold"><summary>By topic</summary><div class="qz__rows">' + bars(a.byTopic) + '</div></details>'
      + '<div class="qz__acts">' + (q.review ? '<button class="btn" type="button" data-qz="review">See the answers</button>' : '') + '<button class="' + (q.review ? 'linkish' : 'btn') + '" type="button" data-qz="back">Back to my dashboard</button></div>');
  }

  /* ---- the answers ------------------------------------------------------------ */

  function review() {
    var q = st.quiz || H.data().quiz;
    if (!q || !q.review) return back();
    st.quiz = q;
    var list = q.review.filter(function (x) { return !st.wrongOnly || !x.right; });
    var wrong = q.review.filter(function (x) { return !x.right; }).length;
    frame('<p class="tile__h">Your best attempt, ' + q.best.percent + '%</p><h2 class="qz__h">The answers.</h2>'
      + (wrong ? '<label class="qz__only"><input type="checkbox" data-qz="only"' + (st.wrongOnly ? ' checked' : '') + '> Only the ' + wrong + ' I got wrong</label>' : '<p class="qz__p">You got every question right.</p>')
      + '<div class="qz__rev">' + list.map(function (x) {
        return '<details class="task"><summary><span class="task__t"><b>' + x.index + '. ' + esc(x.text.split('\n')[0]) + '</b><span>' + esc(x.level) + ' · ' + esc(x.topic) + '</span></span><span class="pill" data-s="' + (x.right ? 'accepted' : 'revise') + '">' + (x.right ? 'Right' : 'Wrong') + '</span></summary>'
          + '<div class="task__body">' + (x.text.indexOf('\n') !== -1 ? '<p class="qz__q">' + esc(x.text) + '</p>' : '')
          + '<ul class="qz__ans">' + x.choices.map(function (c) {
            var tag = c.right ? 'The answer' : c.chosen ? 'Your answer' : '';
            return '<li data-right="' + (c.right ? '1' : '') + '" data-chosen="' + (c.chosen ? '1' : '') + '"><b>' + c.key + '</b><span><span class="qz__t">' + esc(c.text) + '</span>' + (tag ? ' <em>' + tag + (c.right && c.chosen ? ', and yours' : '') + '</em>' : '')
              + (c.why ? '<small class="qz__whyo"><i>' + (c.right ? 'Why it is right:' : 'Why it is wrong:') + '</i> ' + esc(c.why) + '</small>' : '') + '</span></li>';
          }).join('') + '</ul><p class="task__ask"><b>In short:</b> ' + esc(x.why) + '</p>'
          + (x.risk ? '<p class="task__ask qz__risk"><b>What can go wrong:</b> ' + esc(x.risk) + '</p>' : '') + '</div></details>';
      }).join('') + '</div>'
      + '<div class="qz__acts"><button class="btn" type="button" data-qz="back">Back to my dashboard</button></div>');
  }

  function back() {
    stopClock(); guard(false);
    st.attempt = null;
    H.reload();
  }

  /* ---- clicks and keys ------------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-qz]');
    if (!b || !H) return;
    var what = b.getAttribute('data-qz');
    if (what === 'only') return;
    if (what === 'intro') intro();
    else if (what === 'start') begin({ action: 'start' });
    else if (what === 'resume') { frame('<p class="qz__p">Opening the quiz...</p>'); begin(null); }
    else if (what === 'pick') pick(b.getAttribute('data-k'));
    else if (what === 'confirm') confirm();
    else if (what === 'review') review();
    else if (what === 'back') back();
    else if (what === 'leave') {
      if (b.getAttribute('data-sure') === '1') return back();
      b.setAttribute('data-sure', '1');
      b.textContent = 'Leave: the clock keeps running';
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-qz') === 'only') { st.wrongOnly = e.target.checked; review(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!st.attempt || !box || box.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var k = String(e.key || '').toUpperCase();
    var n = LETTERS.indexOf(k) !== -1 ? k : (/^[1-5]$/.test(k) ? LETTERS[Number(k) - 1] : '');
    if (n) { e.preventDefault(); pick(n); } else if (e.key === 'Enter' && st.picked) { e.preventDefault(); confirm(); }
  });

  root.PFAQuiz = {
    /* host: { api, esc, when, view, reload, data, refresh } from intern.html */
    init: function (host) { H = host; box = document.getElementById('ipQuiz'); },
    card: card
  };
})(window);
