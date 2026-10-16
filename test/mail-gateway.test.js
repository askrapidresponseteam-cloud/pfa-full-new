'use strict';

/* Where a reply to a forwarded submission is addressed, and why it is not the
   person who wrote in.

   Owner, 13 Oct 2026: "when i submit an application on website, it gets sent
   to gandhim through info@.. and when she replies- it comes through gandhim to
   sender. copy in info.. but if I reply to gandhim without reply all.. things
   will go missing. is there a solution for this"

   There was no way to make Reply All reliable, because it asked every person
   on every message to keep a recipient they had not added and had no reason to
   keep. So the forwarded submission stopped naming the person. A reply is
   addressed to the site alone, filed against the submission, and carried on to
   the person as info@; their answer is addressed to the site too. Every leg
   passes through one mailbox because there is no other path.

   test/email-thread.test.js drives the whole conversation end to end. These
   are the pieces underneath it: which address is chosen, and that a second
   address never creeps back in. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function withEnv(vars, fn) {
  const had = {};
  for (const [k, v] of Object.entries(vars)) {
    had[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  /* the module reads the environment on every call, but it is loaded fresh so
     a stale capture address cannot leak between tests */
  delete require.cache[require.resolve('../lib/caregiver-mail.js')];
  const mail = require('../lib/caregiver-mail.js');
  try { return fn(mail); } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[require.resolve('../lib/caregiver-mail.js')];
  }
}

const MAILBOX = 'info@peopleforanimalsindia.org';

test('with no pattern set, replies are addressed to the mailbox the site reads', () => {
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_REPLY_ADDRESS_PATTERN: undefined, PFA_CAPTURE_REPLIES: undefined }, (mail) => {
    assert.equal(mail.gatewayAddress('PFA-CGA-BYMS7SAP'), MAILBOX);
    assert.equal(mail.gatewayAddress(''), MAILBOX, 'and with no reference either');
  });
});

test('a per-application address is used when the domain has a catch-all', () => {
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_REPLY_ADDRESS_PATTERN: 'app-{reference}@peopleforanimalsindia.org' }, (mail) => {
    assert.equal(mail.gatewayAddress('PFA-CGA-BYMS7SAP'), 'app-pfa-cga-byms7sap@peopleforanimalsindia.org');
  });
});

test('a pattern falls back to the mailbox rather than making a broken address', () => {
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_REPLY_ADDRESS_PATTERN: 'app-{reference}@peopleforanimalsindia.org' }, (mail) => {
    assert.equal(mail.gatewayAddress(''), MAILBOX, 'no reference, so no per-application address to make');
    assert.equal(mail.gatewayAddress('   '), MAILBOX);
  });
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_REPLY_ADDRESS_PATTERN: 'not-an-address' }, (mail) => {
    assert.equal(mail.gatewayAddress('PFA-CGA-BYMS7SAP'), MAILBOX, 'a pattern naming no address is ignored');
  });
});

test('a reference cannot inject a second address or a header', () => {
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_REPLY_ADDRESS_PATTERN: 'app-{reference}@peopleforanimalsindia.org' }, (mail) => {
    for (const nasty of ['a@b.com,c', 'a\r\nBcc: x@y.com', 'a;b', 'a<b>']) {
      const made = mail.gatewayAddress(nasty);
      assert.ok(!/[\r\n,;<>]/.test(made), `${JSON.stringify(nasty)} produced ${JSON.stringify(made)}`);
    }
  });
});

test('with no mailbox being read, the old behaviour stands', () => {
  /* Addressing replies to a mailbox nobody collects would send them nowhere,
     which is worse than the problem being fixed. */
  withEnv({ PFA_IMAP_USER: undefined, PFA_SMTP_USER: undefined }, (mail) => {
    assert.equal(mail.gatewayAddress('PFA-CGA-BYMS7SAP'), '');
  });
  withEnv({ PFA_IMAP_USER: MAILBOX, PFA_CAPTURE_REPLIES: 'off' }, (mail) => {
    assert.equal(mail.gatewayAddress('PFA-CGA-BYMS7SAP'), '', 'switched off is switched off');
  });
});

test('the forwarded submission no longer names the person in Reply-To', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'caregiver-mail.js'), 'utf8');
  const block = src.slice(src.indexOf('submission_forward(payload)'), src.indexOf('submission_followup(payload)'));
  assert.match(block, /gateway: true/, 'it asks for the gateway');
  assert.match(src, /if \(gateway && gatewayAt\) \{\s*replyList\.push\(gatewayAt\);/,
    'and the gateway address is used alone, never with a second address after it');
});

test('the answer carried to the person is sent as the site, and answered to the site', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'caregiver-mail.js'), 'utf8');
  const block = src.slice(src.indexOf('submission_answer(payload)'), src.indexOf('inbox_test(payload)'));
  assert.match(block, /gateway: true/, 'their answer must come back to the site, not to a personal mailbox');
  assert.match(block, /threadHeaders\(p, `answer\.\$\{Number\(p\.n\) \|\| 1\}`, 'confirm'\)/,
    'it threads onto the confirmation the person already holds, so it lands in their existing conversation');
});

test('a staff reply is carried on, an automatic reply is not', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'inbound-mail.js'), 'utf8');
  assert.match(src, /const wantsAnswer = party === 'staff' && !auto && Boolean\(o\.mail\);/,
    "an out of office must be filed and go no further");
  assert.match(src, /dedupeKey: `submission_answer:\$\{reference\}:\$\{id\}`/,
    'reading the same email twice must not send it to the person twice');
});

test('carrying the reply on can never lose the reply', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'inbound-mail.js'), 'utf8');
  const block = src.slice(src.indexOf('async function answer('), src.indexOf('/* Files one message.'));
  assert.match(block, /\.catch\(\(error\) => \{/, 'a mail failure is caught');
  assert.match(block, /state: 'unsent'/, 'and recorded as unsent rather than thrown');
  assert.ok(!/throw /.test(block), 'the message is already filed by this point; nothing here may undo that');
});
