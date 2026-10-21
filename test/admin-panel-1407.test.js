'use strict';

/* The panel catches up with the server (8 Oct 2026).

   The server learnt, in this release, to say which moves a case may make
   (case.moves), to keep earlier closes and undelivered emails on a case, to
   file automatic replies and delivery reports, to list every email that has
   not gone and send one again, to set aside a reply it cannot file, and to
   ask CCAvenue about a payment it never heard back on. These check that the
   panel shows each of those, and says only what the server said.

   Most of it is the real admin.html script running in jsdom: the page is
   loaded as it ships, signed in through a stubbed fetch (Google's token
   endpoint and /api/**), and driven by clicks. The answers the stub gives
   are built from the server's own code where it can build them (the case
   view and its moves come from lib/routes/admin/case.js and
   lib/case-flow.js), and in the shapes the routes write where it cannot. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const script = HTML.slice(HTML.indexOf('<script>\n/* The panel.'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FLOW = require('../lib/case-flow');
const { caseView } = require('../lib/routes/admin/case.js')._private;

/* One function's source, by name, its braces counted. */
function grab(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start > -1, `admin.html has no function ${name}`);
  let depth = 0;
  for (let i = script.indexOf('{', start); i < script.length; i += 1) {
    if (script[i] === '{') depth += 1;
    if (script[i] === '}') { depth -= 1; if (!depth) return script.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

/* ---- the panel, running ------------------------------------------------- */

const windows = [];
test.after(() => windows.forEach((w) => { try { w.close(); } catch (_) { /* gone */ } }));

const settle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
};

/* `answers(url, method, body)` returns { status, body } or a body (200), or
   undefined for the default. Every /api call is kept in `calls`. */
async function panel(answers, who) {
  const calls = [];
  const problems = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => problems.push(String(e && e.message)));
  const admin = who || { uid: 'u1', email: 'karthik@pfa.test', name: 'Karthik', role: 'super', modules: [] };
  const defaults = (url) => {
    if (url.includes('type=session')) return { ok: true, admin };
    if (url.includes('/api/admin/metrics')) return { ok: true, cards: { submissionsWaiting: 0 }, byKind: {} };
    if (url.includes('/api/admin/mail-check')) return { ok: true, state: 'ok', configured: true, via: 'smtp', from: 'People for Animals <info@peopleforanimalsindia.org>', inboxes: ['gandhim@exmpls.sansad.in'], recent: [], missed: [], failing: [], sentCopies: { on: false } };
    if (url.includes('/api/inbound-mail')) return { ok: true, configured: false };
    if (url.includes('/api/admin/staff')) return { ok: true, staff: [] };
    if (url.includes('/api/admin/payments-pending')) return { ok: true, days: 14, olderThanMinutes: 30, statusCheck: { inr: true, usd: true }, pending: [], photoPending: [] };
    return { ok: true, rows: [] };
  };
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://pfa.test/admin.html', virtualConsole: vc,
    beforeParse(w) {
      w.confirm = () => true;
      w.fetch = (url, opts) => {
        const u = String(url);
        const method = (opts && opts.method) || 'GET';
        const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
        if (/identitytoolkit|securetoken/.test(u)) {
          return reply(200, { idToken: 'id-token', refreshToken: 'refresh', expiresIn: '3600', id_token: 'id-token', refresh_token: 'refresh', expires_in: '3600' });
        }
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({ url: u, method, body });
        let out = answers ? answers(u, method, body) : undefined;
        if (out === undefined) out = defaults(u);
        if (out && out.status && out.body) return reply(out.status, out.body);
        return reply(200, out);
      };
    }
  });
  const w = dom.window;
  windows.push(w);
  const $ = (s) => w.document.querySelector(s);
  $('#who').value = admin.email;
  $('#pass').value = 'secret';
  $('#signinGo').click();
  await settle();
  assert.equal($('#app').hidden, false, `the panel opened (${$('#signinSay').textContent})`);
  const open = async (reference) => {
    w.document.body.insertAdjacentHTML('beforeend', `<button type="button" data-open-case="${reference}">open</button>`);
    w.document.querySelector(`[data-open-case="${reference}"]:last-of-type`).click();
    await settle();
  };
  const tab = async (name) => { $(`.tab[data-tab="${name}"]`).click(); await settle(); };
  const text = (s) => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');
  return { w, $, calls, problems, open, tab, text };
}

/* ---- a case, as the server would send it --------------------------------- */

const AT = (day, hh, mm) => `2026-10-0${day}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00.000Z`;
const BOUNCED = '<PFA-C-2026-00042.t1abc.reply.1@peopleforanimalsindia.org>';

/* A cruelty report: handled, reopened by the person's reply, with an
   earlier close, a reply that bounced, an out-of-office in between, and
   more messages than the server sends. */
function reopenedCase() {
  const data = {
    reference: 'PFA-C-2026-00042', kind: 'PFA-C', kindLabel: 'Cruelty report', status: 'new', page: 'report.html',
    createdAt: AT(6, 9), receivedAtMs: Date.parse(AT(6, 9)), threadId: 't1abc', attachments: 0,
    fields: { name: 'Asha Rao', email: 'asha@example.in', details: 'A dog tied in the sun all day.' },
    closes: [{ status: 'handled', by: 'karthik@pfa.test', at: AT(7, 10), note: 'Called the owner; the dog is indoors now.' }],
    mailProblems: [{ at: AT(7, 11), to: 'asha@example.in', reason: '550 5.1.1 The mailbox is full', messageId: BOUNCED, part: 'reply.1', report: '<r1@mx.example.in>' }],
    history: [
      { status: 'new', at: AT(6, 9) },
      { status: 'in-progress', at: AT(6, 10), by: 'karthik@pfa.test' },
      { status: 'in-progress', event: 'reply', direction: 'out', at: AT(6, 10), by: 'karthik@pfa.test', n: 1 },
      { status: 'in-progress', event: 'reply', direction: 'in', party: 'sender', at: AT(6, 11), by: 'asha@example.in' },
      { status: 'handled', at: AT(7, 10), by: 'karthik@pfa.test' },
      { status: 'handled', event: 'bounce', to: 'asha@example.in', messageId: BOUNCED, at: AT(7, 11), by: 'MAILER-DAEMON@mx.example.in' },
      { status: 'handled', event: 'auto-reply', direction: 'in', party: 'sender', at: AT(7, 12), by: 'asha@example.in' },
      { status: 'handled', event: 'reply', direction: 'in', party: 'sender', at: AT(8, 8), by: 'asha@example.in' },
      { status: 'new', event: 'reopen', reason: 'sender-replied', at: AT(8, 8), by: 'asha@example.in' },
      { status: 'new', event: 'label-fixed', at: AT(8, 9), by: 'karthik@pfa.test' }
    ]
  };
  const messages = [
    { id: 'm1', seq: 1, type: 'reply', direction: 'out', party: 'staff', to: 'asha@example.in', text: 'We are on it.', by: 'karthik@pfa.test', at: AT(6, 10), delivered: true },
    /* two notes in one millisecond, given out of order: seq decides */
    { id: 'm3', seq: 30, type: 'note', text: 'Second note.', by: 'karthik@pfa.test', at: AT(6, 12) },
    { id: 'm2', seq: 20, type: 'note', text: 'First note.', by: 'karthik@pfa.test', at: AT(6, 12) },
    { id: 'm4', seq: 40, type: 'note', event: 'bounce', party: 'site', from: 'MAILER-DAEMON@mx.example.in', text: 'The email to asha@example.in was not delivered: 550 5.1.1 The mailbox is full', by: 'Mail system', at: AT(7, 11), recordedAt: AT(7, 11), bounced: BOUNCED, to: 'asha@example.in' },
    { id: 'm5', seq: 50, type: 'reply', direction: 'in', party: 'sender', from: 'asha@example.in', fromName: 'Asha Rao', text: 'I am away until Monday.', at: AT(7, 12), recordedAt: AT(7, 12), auto: 'Auto-Submitted: auto-replied',
      files: [{ n: 1, filename: 'signature-logo.png', contentType: 'image/png', size: 2048, stored: false, why: 'automatic reply' }] },
    /* written before `at` meant the recording time: its own Date header said
       5 Oct, but PFA recorded it on 8 Oct, after the bounce */
    { id: 'm6', seq: 60, type: 'reply', direction: 'in', party: 'sender', from: 'asha@example.in', fromName: 'Asha Rao', text: 'The dog is tied up again.', at: AT(5, 7), recordedAt: AT(8, 8),
      files: [{ n: 1, filename: 'video.mp4', contentType: 'video/mp4', size: 30000000, stored: false, why: 'larger than 10 MB' }] }
  ];
  return caseView(data.reference, data, messages, { olderNotShown: 3 });
}

function applicationCase(extra) {
  const data = Object.assign({
    reference: 'PFA-CG-2026-00005', kind: 'PFA-CG', kindLabel: 'Colony caregiver card application', status: 'new', page: 'get-involved.html',
    createdAt: AT(8, 4), receivedAtMs: Date.parse(AT(8, 4)), threadId: 't5', attachments: 0,
    fields: { name: 'Ravi Kumar', mobile: '9876543210', email: 'ravi@example.in', address: 'Lane 3, near the temple 576101', city: 'Udupi' },
    history: [{ status: 'new', at: AT(8, 4) }]
  }, extra || {});
  return caseView(data.reference, data, [], {});
}

/* ---- 1. the case drawer ---------------------------------------------------- */

test('Move to is built from case.moves: the legal next states, a closed case offering only "Reopen: ..."', async () => {
  const handled = caseView('PFA-Q-2026-00010', { kind: 'PFA-Q', kindLabel: 'Help desk query', status: 'handled', fields: { name: 'Meera' }, createdAt: AT(7, 9) }, [], {});
  const review = applicationCase({ status: 'under-review' });
  const p = await panel((url) => {
    if (url.includes('reference=PFA-Q-2026-00010')) return { ok: true, case: handled, mailConfigured: true };
    if (url.includes('reference=PFA-CG-2026-00005')) return { ok: true, case: review, mailConfigured: true };
    return undefined;
  });
  const options = () => [...p.w.document.querySelectorAll('#caseStatus option')].map((o) => [o.value, o.textContent]);

  await p.open('PFA-Q-2026-00010');
  assert.deepEqual(options(), [['', 'Move to…'], ['new', 'Reopen: Waiting'], ['in-progress', 'Reopen: In progress']],
    'a handled case offers its two reopens and nothing the server would refuse');
  assert.match(p.text('#caseKind'), /Help desk query · Handled/, 'the current state by its label');
  assert.match(p.text('#caseBody'), /Status\s*Handled/);

  await p.open('PFA-CG-2026-00005');
  assert.deepEqual(options(), [['', 'Move to…'], ['new', 'Submitted'], ['verified', 'Verified'], ['rejected', 'Not issued']],
    'an application moves between its own stages, never to "Card issued" by a status change');
  assert.match(p.text('#caseKind'), /Under review/);
  assert.deepEqual(review.moves.map((m) => m.status), ['new', 'verified', 'rejected'], 'which is what lib/case-flow.js says');

  /* a move sends the chosen key, as before */
  const select = p.$('#caseStatus');
  select.value = 'verified';
  select.dispatchEvent(new p.w.Event('change'));
  await settle();
  const posted = p.calls.filter((c) => c.method === 'POST' && c.url === '/api/admin/case').pop();
  assert.deepEqual(posted.body, { reference: 'PFA-CG-2026-00005', action: 'status', status: 'verified' });
  assert.deepEqual(p.problems, []);
});

test('with no case.moves (an older server) the list is today’s four generic states', () => {
  const ctx = { $: () => select, esc: (v) => String(v), STATUS_WORDS: { new: 'Waiting', 'in-progress': 'In progress', handled: 'Handled', spam: 'Spam' }, readable: (k) => k, Array };
  const select = { innerHTML: '', value: 'x' };
  const vm = require('node:vm');
  vm.createContext(ctx);
  vm.runInContext(`var FIXED_MOVES = [{ status: 'new' }, { status: 'in-progress' }, { status: 'handled' }, { status: 'spam' }];\n${grab('paintMoves')}`, ctx);
  ctx.paintMoves({ reference: 'PFA-C-2026-00001' });
  assert.equal(select.innerHTML, '<option value="">Move to…</option><option value="new">Waiting</option><option value="in-progress">In progress</option><option value="handled">Handled</option><option value="spam">Spam</option>');
  ctx.paintMoves({ moves: [] });
  assert.match(select.innerHTML, /No other state from here/);
  assert.match(script, /var FIXED_MOVES = \[\{ status: 'new' \}, \{ status: 'in-progress' \}, \{ status: 'handled' \}, \{ status: 'spam' \}\];/);
});

test('the conversation reads reopen, bounce and automatic replies plainly, in the order PFA recorded them', async () => {
  const view = reopenedCase();
  const p = await panel((url) => (url.includes('/api/admin/case?') ? { ok: true, case: view, mailConfigured: true } : undefined));
  await p.open('PFA-C-2026-00042');
  const body = p.$('#caseBody');
  const lines = [...body.querySelectorAll('.thread .msg .who')].map((n) => n.textContent.replace(/\s+/g, ' ').replace(/ · .*$/, '').trim());

  assert.ok(lines.includes('Reopened: the person wrote back, now Waiting'), lines.join('\n'));
  assert.ok(lines.includes('Email not delivered to asha@example.in'), 'the bounce reads as what it is');
  assert.equal(lines.filter((l) => /Email not delivered/.test(l)).length, 1, 'once: the history row stands back for its message');
  assert.ok(!lines.some((l) => /^Note by Mail system/.test(l)), 'a delivery report is not anybody’s note');
  assert.ok(lines.includes('Asha Rao wrote back (automatic reply)'), 'an out-of-office is marked as one');
  assert.ok(!lines.some((l) => /Auto reply/i.test(l)), 'and its history row is not drawn a second time');
  assert.ok(lines.includes('Label fixed by karthik@pfa.test'), 'an event the panel does not know is named');
  assert.ok(!lines.some((l) => /Moved to new|Moved to Waiting/.test(l)), 'and never read as a move to new');
  assert.ok(lines.includes('Moved to Handled by karthik@pfa.test'), 'a move reads by its label');
  assert.ok(lines.includes('The person wrote back from asha@example.in'),
    'a reply older than the messages shown is read by its party, from history');
  assert.equal(lines.filter((l) => /^Asha Rao wrote back$/.test(l)).length, 1, 'a reply that is shown is not doubled by its history row');

  /* the order: by recordedAt (else at), then seq */
  const at = (s) => lines.findIndex((l) => l.startsWith(s));
  assert.ok(at('Note by karthik@pfa.test') > -1);
  const notes = [...body.querySelectorAll('.thread .msg')].filter((n) => /Note by/.test(n.textContent)).map((n) => n.querySelector('p:not(.who)').textContent);
  assert.deepEqual(notes, ['First note.', 'Second note.'], 'seq decides within one millisecond');
  assert.ok(at('Email not delivered') < lines.lastIndexOf('Asha Rao wrote back'), 'a reply PFA recorded on 8 Oct sits after the 7 Oct bounce, whatever its Date header said');

  /* files not kept say why */
  assert.match(body.textContent, /signature-logo\.png \(not kept: automatic reply\)/);
  assert.match(body.textContent, /video\.mp4 \(not kept: larger than 10 MB\)/);
  assert.doesNotMatch(body.innerHTML, /too large to keep/);

  /* older messages not shown, said above the conversation */
  assert.equal(body.querySelector('.thread .warn').textContent, view.olderNote);
  assert.match(view.olderNote, /3 older messages are not/);
  assert.ok(body.querySelector('.thread .warn').compareDocumentPosition(body.querySelector('.thread .msg')) & p.w.Node.DOCUMENT_POSITION_FOLLOWING);

  /* earlier closes and emails that did not arrive */
  const facts = [...body.querySelectorAll('.facts li')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(facts.some((f) => /^Handled by karthik@pfa\.test, .*Called the owner; the dog is indoors now\.$/.test(f)), facts.join('\n'));
  assert.ok(facts.some((f) => /^Not delivered Reply from staff to asha@example\.in, .*550 5\.1\.1 The mailbox is full$/.test(f)), facts.join('\n'));
  assert.deepEqual(p.problems, []);
});

test('the conversation reads the event names the server writes', () => {
  const inbound = read('lib/inbound-mail.js');
  assert.match(inbound, /event: 'auto-reply'/, 'the automatic reply row the panel skips');
  assert.match(inbound, /event: 'reopen', reason: 'sender-replied'/);
  assert.match(inbound, /event: 'bounce'/);
  assert.match(inbound, /why: 'automatic reply'/);
  assert.match(read('lib/case-flow.js'), /event: 'reopen', reason: 'staff'/);
  const conv = grab('conversation');
  for (const [field, why] of [["h.event === 'auto-reply'", 'auto-reply rows'], ["h.event === 'bounce'", 'bounce rows'], ["h.event === 'reopen'", 'reopen rows'],
    ["h.reason === 'sender-replied'", 'the reason'], ['m.auto', 'automatic replies'], ['f.why', 'why a file was not kept'], ['m.recordedAt || m.at', 'the order'], ['a.seq - b.seq', 'seq']]) {
    assert.ok(conv.includes(field), `conversation() reads ${why} (${field})`);
  }
  const view = read('lib/routes/admin/case.js');
  for (const key of ['moves:', 'statusLabel:', 'closes:', 'mailProblems:', 'olderNote:', 'olderNotShown:']) assert.ok(view.includes(key), `the case view carries ${key}`);
});

test('Approve is held while it is in flight and the drawer is drawn from the case in the answer', async () => {
  const before = applicationCase();
  const after = applicationCase({ status: 'approved', cardId: 'PFA-CCT-4K2M8QRT', handledAt: AT(8, 6), history: [{ status: 'new', at: AT(8, 4) }, { status: 'approved', at: AT(8, 6), by: 'karthik@pfa.test' }] });
  let release;
  const p = await panel((url, method) => {
    if (url.startsWith('/api/admin/case?')) return { ok: true, case: before, mailConfigured: true };
    if (url === '/api/admin/case' && method === 'POST') return new Promise((r) => { release = r; }).then(() => ({ ok: true, action: 'approve', cardId: 'PFA-CCT-4K2M8QRT', status: 'approved', statusLabel: 'Card issued', emailed: true, case: after, mailConfigured: true }));
    return undefined;
  });
  /* the stub can answer later: a promise of the body */
  await p.open('PFA-CG-2026-00005');
  assert.equal(p.$('#caseDecide').hidden, false, 'an open application offers the decision');
  p.$('#caseApprove').click();
  await settle();
  assert.equal(p.$('#caseApprove').disabled, true, 'held while the card is being issued');
  p.$('#caseApprove').click();
  await settle();
  assert.equal(p.calls.filter((c) => c.method === 'POST' && c.body && c.body.action === 'approve').length, 1, 'a second press asks nothing');
  const gets = p.calls.filter((c) => c.url.startsWith('/api/admin/case?')).length;
  release();
  await settle();
  assert.equal(p.$('#caseApprove').disabled, false);
  assert.equal(p.calls.filter((c) => c.url.startsWith('/api/admin/case?')).length, gets, 'drawn from the answer, not read again');
  assert.match(p.text('#caseKind'), /Card issued/);
  assert.equal(p.$('#caseDecide').hidden, true, 'an issued card is not offered again');
  assert.equal(p.text('#caseSay'), 'Card PFA-CCT-4K2M8QRT issued and the holder emailed.');
  assert.ok([...p.w.document.querySelectorAll('#caseStatus option')].some((o) => o.textContent === 'Reopen: Submitted'), 'its moves are the issued card’s');
});

test('a closed application hides Approve, since the server refuses it until reopened', async () => {
  const p = await panel((url) => (url.startsWith('/api/admin/case?') ? { ok: true, case: applicationCase({ status: 'rejected' }) } : undefined));
  await p.open('PFA-CG-2026-00005');
  assert.equal(p.$('#caseDecide').hidden, true);
});

test('a paid application waiting for its photograph says so and can attach it again', async () => {
  const order = 'PFA-CGA-ZX98YW76';
  let stillPending = true;
  const p = await panel((url, method, body) => {
    if (url.startsWith('/api/admin/case?')) return { ok: true, case: applicationCase(stillPending ? {} : { attachments: 1 }), mailConfigured: true };
    if (url === '/api/admin/payments-pending' && method === 'GET') {
      return { ok: true, days: 14, olderThanMinutes: 30, statusCheck: { inr: true, usd: true }, pending: [], photoPending: stillPending ? [{ reference: 'PFA-CG-2026-00005', orderId: order, createdAt: AT(8, 4) }] : [] };
    }
    if (url === '/api/admin/payments-pending' && method === 'POST') { stillPending = false; return { ok: true, orderId: body.orderId, reference: 'PFA-CG-2026-00005', receipt: 'sent' }; }
    if (url.startsWith('/api/admin/attachment')) return { ok: true, n: 1, data: 'AAAA', contentType: 'image/jpeg' };
    return undefined;
  });
  await p.open('PFA-CG-2026-00005');
  assert.match(p.text('#casePhoto'), /Photograph not attached yet/);
  const button = p.$('#casePhoto [data-refile]');
  assert.ok(button, 'with a button');
  assert.equal(button.textContent, 'Attach the photograph again');
  button.click();
  await settle();
  const posted = p.calls.find((c) => c.method === 'POST' && c.url === '/api/admin/payments-pending');
  assert.deepEqual(posted.body, { action: 'refile', orderId: order }, 'the record’s own payment order id');
  assert.equal(p.text('#caseSay'), 'The photograph is attached to PFA-CG-2026-00005 now.');
  assert.equal(p.$('#casePhoto').hidden, true, 'the badge is gone once it is attached');
  assert.match(read('lib/routes/payment/response.js'), /payment: \{\s*orderId,/, 'the order id lives under payment.orderId');
  assert.match(read('lib/routes/admin/payments-pending.js'), /orderId: cleanText\(r\.payment && r\.payment\.orderId, 80\)/, 'which the list reads');
});

test('a photograph that went missing is said, with what to do', async () => {
  const p = await panel((url) => (url.startsWith('/api/admin/case?') ? { ok: true, case: Object.assign(applicationCase(), { photoMissing: true }) } : undefined));
  await p.open('PFA-CG-2026-00005');
  assert.match(p.text('#casePhoto'), /Photograph missing/);
  assert.match(p.text('#casePhoto'), /Ask the applicant to send it again by replying\./);
  assert.equal(p.$('#casePhoto [data-refile]'), null, 'nothing to attach again');
});

/* ---- 2. replies ------------------------------------------------------------ */

test('Replies shows the reading’s problem line and the emails set aside', async () => {
  const problem = 'One email could not be filed after 5 tries and was set aside. The latest: <p1@mail.example.in>: Could not be read: Unexpected end of input. Look for it in the mailbox and add what it says to the case by hand.';
  const p = await panel((url) => {
    if (url === '/api/inbound-mail') {
      return { ok: true, configured: true, mailbox: 'info@peopleforanimalsindia.org', captureOff: false, lastRunAt: AT(8, 6), lastError: '',
        lastResult: { fetched: 3, filed: 2, unmatched: 1, duplicates: 0, autoReplies: 1, bounces: 0, problems: 1 }, lastUid: 99,
        waiting: [{ uid: 101, messageId: '<w1@mail.example.in>', stage: 'file', error: 'Deadline exceeded', count: 2, firstAt: AT(8, 5), lastAt: AT(8, 6) }],
        parked: [{ uid: 97, messageId: '<p1@mail.example.in>', stage: 'parse', error: 'Could not be read: Unexpected end of input', count: 5, firstAt: AT(7, 5), lastAt: AT(8, 5), parkedAt: AT(8, 5) }],
        problem };
    }
    return undefined;
  });
  const box = p.text('#replies');
  assert.ok(box.includes(problem), 'the server’s own problem line');
  assert.match(box, /2 filed on a submission \(one an automatic reply\)/);
  assert.match(box, /One email could not be filed on the last reading and will be read again on the next \(<w1@mail\.example\.in>: Deadline exceeded, 2 tries\)/);
  const row = [...p.w.document.querySelectorAll('#replies tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent));
  assert.equal(row.length, 1);
  assert.equal(row[0][0], '<p1@mail.example.in>');
  assert.equal(row[0][1], 'Could not be read: Unexpected end of input');
  assert.equal(row[0][2], '5');
  const status = read('lib/inbound-mail.js');
  assert.match(status, /parked: \(Array\.isArray\(s\.parked\) \? s\.parked : \[\]\)\.slice\(-10\),\s*problem: problemLine\(s\.parked, Date\.now\(\)\)/);
});

/* ---- 3. the mail check ----------------------------------------------------- */

const LOGIN_PROBLEM = 'GoDaddy did not accept the mailbox and password. Check PFA_SMTP_USER and PFA_SMTP_PASS in Vercel, and in the mailbox’s settings turn on third-party email access. Then deploy again.';
function mailCheck(extra) {
  return Object.assign({
    ok: true, state: 'login-failing', configured: true, via: 'smtp', from: 'People for Animals <info@peopleforanimalsindia.org>', fromDomain: 'peopleforanimalsindia.org',
    inboxes: ['gandhim@exmpls.sansad.in'], recentError: '', missed: [], failingError: '', host: 'vercel', settingsHelp: 'In Vercel, Settings',
    recent: [{ id: 'f9', reference: 'PFA-Q-2026-00007', to: 'gandhim@exmpls.sansad.in', status: 'sent', attempts: 1, problem: '', detail: '', at: AT(8, 1) }],
    failing: [
      { id: 'em_1', template: 'submission_received', what: 'Confirmation to the sender', reference: 'PFA-C-2026-00042', to: 'asha@example.in', status: 'retry', attempts: 3, kind: 'config', login: true, uncertain: false, bounced: false,
        problem: LOGIN_PROBLEM, detail: '535 5.7.8 Error: authentication failed', at: AT(8, 7), retryAt: AT(8, 7, 30), canResend: true },
      { id: 'em_2', template: 'submission_forward', what: 'Copy to PFA’s inbox', reference: 'PFA-Q-2026-00008', to: 'gandhim@exmpls.sansad.in', status: 'sending', attempts: 1, kind: 'unknown', login: false, uncertain: true, bounced: false,
        problem: 'The mail server had not answered when the site stopped waiting, so this email may already have arrived.', detail: 'outcome not known', at: AT(8, 6), retryAt: AT(8, 9), canResend: false },
      { id: 'em_3', template: 'submission_reply', what: 'Reply from staff', reference: 'PFA-C-2026-00042', to: 'asha@example.in', status: 'failed', attempts: 1, kind: 'recipient', login: false, uncertain: false, bounced: true,
        problem: 'The mail provider refused the email.', detail: 'Not delivered: 550 5.1.1 The mailbox is full', at: AT(8, 5), retryAt: null, canResend: true }
    ],
    login: { failing: true, since: AT(8, 6), waiting: 1, problem: LOGIN_PROBLEM },
    sentCopies: { on: true, waiting: 0, parked: 2, lastError: '[TOOBIG] Message too large', parkedIds: ['<a@x>', '<b@x>'] }
  }, extra || {});
}

test('the mail check leads with the state: a refused login is said once, plainly, with the server’s words', async () => {
  const p = await panel((url, method) => (url === '/api/admin/mail-check' && method === 'GET' ? mailCheck() : undefined));
  const first = p.$('#mailbox .state');
  assert.equal(first.getAttribute('data-tone'), 'bad');
  assert.match(first.textContent, /^The mailbox is refusing the site’s login\./);
  assert.ok(first.textContent.includes(LOGIN_PROBLEM), 'm.login.problem, as the server words it');
  assert.match(first.textContent, /One email has been refused this way since/);
  assert.match(p.text('#mailbox'), /2 emails were sent, but their copies are not in the Sent folder: the mailbox refused each five times, so they are no longer tried\. Last answer: \[TOOBIG\] Message too large\./);

  const some = await panel((url, method) => (url === '/api/admin/mail-check' && method === 'GET' ? mailCheck({ state: 'some-failed', login: { failing: false } }) : undefined));
  assert.match(some.$('#mailbox .state').textContent, /^3 emails have not gone\. Each is listed below with the reason, and can be sent again from here\./);

  const off = await panel((url, method) => (url === '/api/admin/mail-check' && method === 'GET' ? mailCheck({ state: 'not-configured', configured: false, failing: [], login: { failing: false } }) : undefined));
  assert.match(off.$('#mailbox .state').textContent, /^No email can leave the site\./);
  assert.equal(off.$('#mailResend'), null);
});

test('every email that has not gone is listed with what happened, and each can be sent again on its own', async () => {
  let resent = null;
  const p = await panel((url, method, body) => {
    if (url === '/api/admin/mail-check' && method === 'GET') return resent ? mailCheck({ failing: [], state: 'ok', login: { failing: false } }) : mailCheck();
    if (url === '/api/admin/mail-check' && method === 'POST') { resent = body; return { ok: true, tried: 1, sent: 1, skipped: 0, skippedIds: [], stoppedFor: '', problems: [] }; }
    return undefined;
  });
  const rows = [...p.w.document.querySelectorAll('#mailbox tbody tr')].filter((tr) => tr.querySelector('[data-mail-resend], .note'));
  assert.equal(rows.length, 3);
  const [login, unsure, bounced] = rows.map((tr) => tr.textContent.replace(/\s+/g, ' '));
  assert.match(login, /Confirmation to the sender ?PFA-C-2026-00042/);
  assert.match(login, /Retrying/);
  assert.match(login, /3 attempts, next try due/);
  assert.match(unsure, /Sending now/, 'a row another request is sending');
  assert.match(unsure, /may have arrived/);
  assert.match(unsure, /Being sent now/, 'and no Send again for it');
  assert.match(bounced, /Not delivered/, 'a bounced email was sent, so it is not called "Not sent"');
  assert.doesNotMatch(bounced, /Not sent/);
  assert.equal(p.w.document.querySelectorAll('#mailbox [data-mail-resend]').length, 2, 'Send again only where the server would take it');
  assert.equal(p.text('#mailResend'), 'Send the emails that did not go');

  p.$('#mailbox [data-mail-resend="em_3"]').click();
  await settle();
  assert.deepEqual(resent, { action: 'resend', id: 'em_3' }, 'one row, by its id');
  assert.equal(p.text('#mailSay'), 'One email went.', 'said under the section drawn again');
  assert.equal(p.$('#mailResend'), null, 'nothing left to send again');
});

test('after a resend: what went, what was left alone, the stop at a refused login, and what did not go', async () => {
  const p = await panel((url, method) => {
    if (url === '/api/admin/mail-check' && method === 'GET') return mailCheck();
    if (url === '/api/admin/mail-check' && method === 'POST') {
      return { ok: false, tried: 2, sent: 1, skipped: 1, skippedIds: ['em_3'], stoppedFor: 'login',
        problems: [{ id: 'em_1', reference: 'PFA-C-2026-00042', what: 'Confirmation to the sender', problem: LOGIN_PROBLEM, detail: '535' }] };
    }
    return undefined;
  });
  p.$('#mailResend').click();
  await settle();
  const posted = p.calls.filter((c) => c.method === 'POST' && c.url === '/api/admin/mail-check').pop();
  assert.deepEqual(posted.body, { action: 'resend' }, 'every row the server would send again');
  const said = p.text('#mailSay');
  assert.match(said, /^One email went\./);
  assert.match(said, /The mailbox refused the login, so the rest were not tried\./);
  assert.match(said, /One was not sent from here: not tried after the refusal, already sent, or being sent right now\./);
  assert.match(said, /Did not go: Confirmation to the sender \(PFA-C-2026-00042\): GoDaddy did not accept/);
  assert.equal(p.$('#mailSay').getAttribute('data-tone'), 'bad');
});

test('the mail check reads the fields the route sends', () => {
  const route = read('lib/routes/admin/mail-check.js');
  for (const key of ['state,', 'failing,', 'login,', 'sentCopies,', 'canResend:', 'uncertain:', 'bounced:', 'retryAt:', 'what:', 'stoppedFor,', 'skipped: skipped.length']) {
    assert.ok(route.includes(key), `mail-check.js sends ${key}`);
  }
  assert.match(route, /body\.action === 'resend'/);
  assert.match(route, /body\.id \|\| Array\.isArray\(body\.ids\)/, 'one row by id');
  assert.match(read('lib/sent-copy.js'), /on: true, waiting: snap\.size, parked: parked\.size/);
  assert.match(script, /sending: 'Sending now'/, 'the status words carry sending');
  assert.match(grab('resendMail'), /\{ action: 'resend', id: id \}/);
});

/* ---- 4. pending payments --------------------------------------------------- */

function pendingList(extra) {
  return Object.assign({
    ok: true, days: 14, olderThanMinutes: 30, statusCheck: { inr: true, usd: false },
    pending: [
      { orderId: 'PFA-DON-AB12CD34', type: 'donate', status: 'initiated', amount: 1000, currency: 'INR', startedAt: AT(8, 3), minutesWaiting: 190, name: 'Meera Nair', email: 'meera@example.in' },
      { orderId: 'PFA-DON-US55AA11', type: 'donate', status: 'pending', amount: 50, currency: 'USD', startedAt: AT(6, 3), minutesWaiting: 3000, name: 'Jo Lee', email: 'jo@example.com' },
      { orderId: 'PFA-SHP-QW12ER34', type: 'shop', status: 'initiated', amount: 2650, currency: 'INR', startedAt: AT(8, 2), minutesWaiting: 250, name: 'Ravi', email: '' }
    ],
    photoPending: [{ reference: 'PFA-CG-2026-00005', orderId: 'PFA-CGA-ZX98YW76', createdAt: AT(8, 4) }]
  }, extra || {});
}

test('Payments: the unfinished ones sit under the register in plain words, folded, and can be checked', async () => {
  /* owner, 21 Oct 2026: "this dashboard is super complex for a non tech savvy person" */
  const p = await panel((url, method, body) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList();
    if (url === '/api/admin/payments-pending' && method === 'POST' && body.action === 'check') {
      return { ok: true, orderId: body.orderId, ccavenue: 'Successful', applied: true, status: 'success', reference: 'PFA-DON-2026-00011', receipt: 'sent' };
    }
    return undefined;
  });
  await p.tab('payments');
  const pane = p.$('[data-pane="payments"]');
  assert.ok(pane.querySelector('#payRows').compareDocumentPosition(p.$('#payPending')) & 4, 'under the register, not above it');
  assert.equal(p.text('#payPending h3'), 'Not finished');
  const note = p.text('#payPending .note');
  assert.equal(note, '3 payments were started but not completed. If one was in fact paid, it moves up by itself within ten minutes. Nothing to do here.');
  assert.doesNotMatch(p.text('#payPending'), /not set up|server|CCAVENUE_|Firebase|Vercel/, 'no technical warning');
  const list = p.$('#payPending details.pend__list');
  assert.ok(list && !list.open, 'the list is folded until asked for');
  assert.equal(list.querySelector('summary').textContent, 'Show all 3');
  const rows = [...list.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Donation/);
  assert.match(rows[0].textContent, /PFA-DON-AB12CD34/);
  const check = (id) => p.$(`#payPending [data-pay-check="${id}"]`);
  assert.equal(check('PFA-DON-US55AA11'), null, 'no button where this server cannot ask, rather than a greyed one');
  assert.ok(check('PFA-SHP-QW12ER34'), 'a shop order is in rupees');
  assert.equal(check('PFA-DON-AB12CD34').textContent, 'Check now');

  check('PFA-DON-AB12CD34').click();
  await settle();
  const posted = p.calls.find((c) => c.method === 'POST' && c.url === '/api/admin/payments-pending');
  assert.deepEqual(posted.body, { action: 'check', orderId: 'PFA-DON-AB12CD34' });
  assert.equal(p.text('[data-answer="PFA-DON-AB12CD34"]'), 'Paid, PFA-DON-2026-00011. Moved to the list above with its receipt.');
  assert.equal(check('PFA-DON-AB12CD34').disabled, true, 'settled: not asked again');

  const q = await panel((url, method, body) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList();
    if (method === 'POST') return { ok: true, orderId: body.orderId, ccavenue: 'Awaited', applied: false, status: 'initiated', message: 'CCAvenue reports "Awaited" for this order. Nothing was changed.' };
    return undefined;
  });
  await q.tab('payments');
  q.$('#payPending [data-pay-check="PFA-SHP-QW12ER34"]').click();
  await settle();
  assert.equal(q.text('[data-answer="PFA-SHP-QW12ER34"]'), 'Still not finished on CCAvenue (Awaited). Nothing changed.');
  assert.equal(q.$('#payPending [data-pay-check="PFA-SHP-QW12ER34"]').disabled, false, 'free to ask again later');
});

test('a server that cannot ask CCAvenue shows no buttons and no warning, and says the site checks once a day', async () => {
  const p = await panel((url, method) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList({ statusCheck: { inr: false, usd: false } });
    return undefined;
  });
  await p.tab('payments');
  assert.equal(p.$('#payPending [data-pay-check]'), null);
  assert.match(p.text('#payPending .note'), /moves up by itself within a day\./);
  assert.doesNotMatch(p.text('#payPending'), /not set up|server|CCAVENUE_/);

  /* the GET said yes but the server answers NOT_CONFIGURED: the buttons go */
  const q = await panel((url, method) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList({ statusCheck: { inr: true, usd: true } });
    if (method === 'POST') return { status: 503, body: { code: 'NOT_CONFIGURED', message: 'The CCAvenue status check is not configured on this server (no access code). Nothing was changed.' } };
    return undefined;
  });
  await q.tab('payments');
  q.$('#payPending [data-pay-check="PFA-DON-AB12CD34"]').click();
  await settle();
  assert.equal(q.text('[data-answer="PFA-DON-AB12CD34"]'), 'Checking by hand is not available here. The site checks these by itself once a day.');
  assert.ok([...q.w.document.querySelectorAll('#payPending [data-pay-check]')].every((b) => b.hidden));
});

test('nothing unfinished and nothing missing: the block is not there at all', async () => {
  const p = await panel((url, method) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList({ pending: [], photoPending: [] });
    return undefined;
  });
  await p.tab('payments');
  assert.equal(p.$('#payPending .panel'), null);
  assert.equal(p.text('#payPending'), '');
});

test('a paid application waiting for its photograph is listed with Attach the photograph again', async () => {
  let left = true;
  const p = await panel((url, method, body) => {
    if (url === '/api/admin/payments-pending' && method === 'GET') return pendingList({ pending: [], photoPending: left ? pendingList().photoPending : [] });
    if (method === 'POST' && body.action === 'refile') { left = false; return { ok: true, orderId: body.orderId, reference: 'PFA-CG-2026-00005', receipt: 'sent' }; }
    return undefined;
  });
  await p.tab('payments');
  assert.equal(p.text('#payPending h3'), 'Paid, photograph missing');
  const button = p.$('#payPending [data-refile]');
  assert.equal(button.textContent, 'Attach the photograph again');
  assert.ok(p.$('#payPending [data-open-case="PFA-CG-2026-00005"]'), 'the application opens from its row');
  button.click();
  await settle();
  const posted = p.calls.find((c) => c.method === 'POST' && c.url === '/api/admin/payments-pending');
  assert.deepEqual(posted.body, { action: 'refile', orderId: 'PFA-CGA-ZX98YW76' });
  assert.equal(p.text('#pendSay'), 'The photograph is attached to PFA-CG-2026-00005 now.', 'said even though the block itself is gone');
  assert.equal(p.$('#payPending [data-refile]'), null);
});

test('the pending payments block calls the route that is mounted, with the actions it takes', () => {
  assert.match(read('api/index.js'), /'admin\/payments-pending'/);
  const route = read('lib/routes/admin/payments-pending.js');
  assert.match(route, /requireAdmin\(request, response, 'payments'\)/);
  assert.match(route, /\['check', 'refile'\]\.includes\(action\)/);
  for (const key of ['statusCheck:', 'pending,', 'photoPending', 'minutesWaiting:', "code: 'NOT_CONFIGURED'", 'ccavenue: said, applied: false', 'applied: true']) {
    assert.ok(route.includes(key), `payments-pending.js says ${key}`);
  }
  assert.match(grab('checkPayment'), /body: \{ action: 'check', orderId: orderId \}/);
  assert.match(grab('refilePhoto'), /body: \{ action: 'refile', orderId: orderId \}/);
  assert.match(grab('checkPayment'), /e\.code === 'NOT_CONFIGURED'/);
  assert.match(grab('api'), /failed\.code = data\.code/, 'api() keeps the server’s code on an error');
});

test('a shop payment line carries needsAttention, its note, and settledAfter when the ledger has them', () => {
  const vm = require('node:vm');
  const ctx = { esc: (v) => String(v == null ? '' : v), money: (a) => `Rs ${a}`, when: () => 'today', String, Number };
  vm.createContext(ctx);
  vm.runInContext(grab('payRow'), ctx);
  const line = ctx.payRow({ orderId: 'PFA-SHP-QW12ER34', type: 'shop', amount: 2650, status: 'success', needsAttention: true, settledAfter: 'cancelled',
    attentionNote: 'Paid after the order was cancelled, and the stock it had given back was sold meanwhile. Short: 1 of 38__XL. Check before dispatching: source the piece or refund the shopper.' }, false);
  assert.match(line, /<span class="flag" data-s="failed">Needs attention<\/span>/);
  assert.match(line, /Short: 1 of 38__XL/);
  const quiet = ctx.payRow({ orderId: 'PFA-SHP-QW12ER35', type: 'shop', amount: 100, status: 'success', settledAfter: 'failed', needsAttention: false }, false);
  assert.match(quiet, /Settled after the order was failed\./);
  assert.doesNotMatch(quiet, /Needs attention/);
  assert.doesNotMatch(ctx.payRow({ orderId: 'PFA-DON-1', amount: 5, status: 'success' }, false), /Needs attention|Settled after/);
  assert.match(read('lib/shop-backend.js'), /settledAfter: order\.settledAfter, needsAttention: Boolean\(order\.needsAttention\), attentionNote: order\.attentionNote/);
});

/* ---- 5. register rows ------------------------------------------------------ */

test('register rows show the status label the server sends, not the raw key', async () => {
  const row = (reference, kind, status) => ({ id: reference, reference, kind, kindLabel: kind, status, statusLabel: FLOW.labelOf(kind, status), createdAt: AT(8, 4), attachments: 0, fields: { name: 'Ravi' } });
  const p = await panel((url) => {
    if (url.includes('type=submissions')) return { ok: true, rows: [row('PFA-CG-2026-00005', 'PFA-CG', 'approved'), row('PFA-V-2026-00002', 'PFA-V', 'rejected'), row('PFA-C-2026-00001', 'PFA-C', 'in-progress')] };
    return undefined;
  });
  await p.tab('submissions');
  const flags = [...p.w.document.querySelectorAll('#subRows .flag[data-s]')].map((f) => [f.getAttribute('data-s'), f.textContent]);
  assert.deepEqual(flags, [['approved', 'Card issued'], ['rejected', 'Not taken forward'], ['in-progress', 'In progress']]);
  await p.tab('volunteers');
  assert.equal(p.$('#volRows .flag').textContent, 'Card issued', 'Volunteers reads the same label');
  assert.match(read('lib/routes/admin/records.js'), /statusLabel: FLOW\.labelOf\(data\.kind \|\| '', data\.status \|\| 'new'\)/);
});

/* ---- house rules ------------------------------------------------------------ */

test('no long dashes in the panel or in this test', () => {
  for (const file of ['admin.html', 'test/admin-panel-1407.test.js']) {
    const text = read(file);
    const long = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
    assert.ok(!long.some((d) => text.includes(d)), `${file} carries an en or em dash`);
  }
});

/* ---- plain by default (owner, 21 Oct 2026: "dont show long stories ...
   show these only when one clicks on i or +.. it should be usable by any
   and all from age 5-80") ------------------------------------------------ */

test('every explanation is folded behind an (i), the email story included, and one press shows it', async () => {
  const p = await panel((url, method) => (url === '/api/admin/mail-check' && method === 'GET'
    ? mailCheck({ state: 'ok', failing: [], login: { failing: false }, paymentInboxes: ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'], sentCopies: { on: true, waiting: 0, parked: 0 } }) : undefined));
  await settle();
  const story = [...p.w.document.querySelectorAll('#mailbox .hint')].find((h) => /A copy of every form goes to/.test(h.textContent));
  assert.ok(story, 'the routing story is still there, for whoever asks');
  assert.ok(story.classList.contains('is-folded'), 'but folded');
  const i = p.$('#mailbox h2 .info');
  assert.ok(i, 'an (i) beside the heading');
  assert.equal(i.textContent, 'i');
  assert.equal(i.getAttribute('aria-expanded'), 'false');
  assert.equal(p.text('#mailbox .state'), 'Emails are going out.', 'the eye gets one line');
  i.click();
  assert.equal(story.classList.contains('is-folded'), false);
  assert.equal(i.getAttribute('aria-expanded'), 'true');
  i.click();
  assert.ok(story.classList.contains('is-folded'));
  assert.ok(p.$('#mailbox details.fold'), 'recent emails fold under a +');
  assert.equal(p.$('#mailbox details.fold').open, false);
  /* a hint drawn later (another tab) is folded too */
  await p.tab('people');
  const later = p.$('[data-pane="people"] .hint');
  assert.ok(later && later.classList.contains('is-folded'));
  assert.ok(p.$('#pplAdd') && !p.$('#pplAdd').open, 'Add a person is folded under a +');
  assert.ok(p.$('#auFold') && !p.$('#auFold').open, 'and so is the history');
});

test('Overview says what is new in plain words, with one button to it and one money tile', async () => {
  const p = await panel((url) => (url.includes('/api/admin/metrics')
    ? { ok: true, cards: { submissionsWaiting: 3, submissionsTotal: 9, submissionsLast7: 4, paymentsPaid: 2, caregivers: 1 }, revenue30d: { inr: 2000 }, payments: { byType: { donate: { inr: 2000, count: 2 } } }, byKind: { 'PFA-V': { waiting: 1 } }, caregivers: { unprinted: 1 } }
    : undefined));
  await settle();
  assert.match(p.text('.lead'), /3 new forms to look at/);
  const open = p.$('.lead [data-go="submissions"]');
  assert.equal(open.textContent, 'Open them');
  const tiles = [...p.w.document.querySelectorAll('.grid .cell')];
  assert.equal(tiles.filter((t) => /in 30 days/.test(t.textContent)).length, 1, 'one money tile, not two');
  assert.ok(tiles.every((t) => t.tagName === 'BUTTON' && t.getAttribute('data-go')), 'every tile opens its page');
  assert.equal(p.$('.spark'), null, 'no little charts to decode');
  open.click();
  await settle();
  assert.equal(p.$('.tab[data-tab="submissions"]').getAttribute('aria-current'), 'page');
});

test('the search box says so when it forgives a spelling', async () => {
  const p = await panel((url) => (url.includes('/api/admin/search')
    ? { ok: true, q: 'karthk', near: true, more: false, results: [{ type: 'case', id: 'PFA-V-2026-00011', title: 'PFA-V-2026-00011', line: 'Volunteer application from Karthik Dhanya', status: 'Waiting', at: 0 }] }
    : undefined));
  p.$('#gq').value = 'karthk';
  p.$('#gq').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  await settle();
  assert.match(p.text('#gres'), /No exact match for .karthk.\. Showing close spellings\./);
  assert.match(p.text('#gres'), /Karthik Dhanya/);
});
