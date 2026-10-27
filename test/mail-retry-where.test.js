'use strict';

/* Emails that failed on a wrong password (owner's panel, 8 Oct 2026: two
   emails from 4:36 pm still "Retrying, next try due 04:38 pm" at 9 pm, and
   the panel told him to mend the password on Firebase when they had failed
   on the website, on Vercel).

   - The ten-minute job on Firebase now sends emails waiting for another
     try, so "next try" is when it happens, not the next 3am.
   - A refused login waits longer each time (15 minutes, doubling, at most
     six hours), so a wrong password is not tried every ten minutes.
   - The row says which server the attempt was made from, and the panel
     names that server, and says to press Send again once it is mended. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_review-recheck-harness');

const store = require('../lib/caregiver-store');

let W;
test.beforeEach(() => { W = H.fresh({ latency: 0 }); });
test.afterEach(() => { W.restore(); });

test('after a refused login the worker leaves the mailbox alone, longer each time, an hour at most, until a login works', async () => {
  const min = 60 * 1000;
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => store.configRetryMs(n) / min), [15, 30, 60, 60, 60]);
  const worker = require('../lib/routes/caregiver/email-worker');
  const cron = { authorization: 'Bearer cron-secret' };
  W.smtp.fail = () => Object.assign(new Error('Invalid login: 535 Authentication Failed'), { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' });
  for (const k of ['a', 'b', 'c']) await store.queueEmail({ template: 'inbox_test', to: `${k}@example.com`, dedupeKey: k, payload: {} });
  const realNow = Date.now;
  let t = realNow() + 10 * min;
  Date.now = () => t;
  try {
    const first = await H.call(worker, { token: null, headers: cron });
    assert.equal(first.json.stoppedFor, 'login');
    assert.equal(W.smtp.calls, 1, 'one login tried, the rest wait');
    t += 10 * min;
    const gated = await H.call(worker, { token: null, headers: cron });
    assert.ok(gated.json.waitingForLogin, 'ten minutes later the mailbox is left alone');
    assert.equal(W.smtp.calls, 1);
    t += 6 * min;
    await H.call(worker, { token: null, headers: cron });
    assert.equal(W.smtp.calls, 2, 'tried again after fifteen minutes');
    W.smtp.fail = null;
    const forced = await H.call(worker, { token: null, headers: cron, query: { force: '1' } });
    assert.equal(forced.json.sent, 2, 'the password mended, a run by hand sends what is due');
    assert.equal((await store.loginGate()).closed, false, 'and the gate is open again');
    t += 16 * min;
    const next = await H.call(worker, { token: null, headers: cron });
    assert.equal(next.json.sent, 1, 'the one tried a moment ago goes on the next run');
    assert.equal(W.smtp.sent.length, 3);
  } finally { Date.now = realNow; }
});

test('the row says where it failed, and the panel names that server', async () => {
  process.env.VERCEL = '1';
  const queued = await store.queueEmail({ template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', dedupeKey: 'k1', payload: { reference: 'PFA-Q-2026-00001' }, claim: 'immediate' });
  const login = Object.assign(new Error('Invalid login: 535 Authentication Failed'), { code: 'EAUTH', kind: 'config' });
  await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error: login });
  delete process.env.VERCEL;
  const row = W.db.dump()[`caregiverEmails/${queued.emailId}`];
  assert.equal(row.lastErrorOn, 'vercel');
  assert.equal(row.status, 'retry');
  const { failingEmails } = require('../lib/routes/admin/mail-check')._private;
  process.env.K_SERVICE = 'api';      // the panel runs on Firebase
  try {
    const listed = (await failingEmails(W.db)).find((r) => r.id === queued.emailId);
    assert.match(listed.problem, /in Vercel, where the website runs/);
    assert.doesNotMatch(listed.problem, /on Firebase/);
    assert.match(listed.problem, /press Send again/);
  } finally { delete process.env.K_SERVICE; }
});

test('the ten-minute job on Firebase sends waiting emails and brings the search up to date', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  /* since 27 Oct 2026 the ten-minute job is caregiverEmailWorker; the
     reading of replies has the two-minute schedule to itself */
  const job = src.slice(src.indexOf('exports.caregiverEmailWorker'), src.indexOf('exports.inboundMailCheck'));
  assert.match(job, /every 10 minutes/);
  assert.match(job, /routes\/caregiver\/email-worker\.js/);
  assert.match(job, /admin-search\.js/);
  assert.match(job, /timeoutSeconds: 300/);
});
