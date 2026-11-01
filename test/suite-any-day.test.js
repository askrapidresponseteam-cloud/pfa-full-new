'use strict';

/* The suite must give the same answer on any day of the year. The email
   worker also runs dated jobs (the Monday digest, the monthly payments
   report), and on their days each adds an email to whatever a test counts.
   The deploy on 2 Nov 2026 (a Monday) stopped on six mail tests for that
   reason alone. The worker honours an off switch for each, and the test
   preload turns both off. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the worker skips the scheduled digest and payments report when they are switched off', () => {
  const src = read('lib/routes/caregiver/email-worker.js');
  assert.match(src, /PFA_WEEKLY_DIGEST[\s\S]*off \? \{ state: 'not-due' \} : await require\('\.\.\/\.\.\/weekly-digest'\)\.run\(/);
  assert.match(src, /PFA_FINANCE_REPORT[\s\S]*off \? \{ state: 'not-due' \} : await FIN\.run\(/);
});

test('the test preload switches both dated jobs off', () => {
  assert.equal(process.env.PFA_WEEKLY_DIGEST, 'off');
  assert.equal(process.env.PFA_FINANCE_REPORT, 'off');
});
