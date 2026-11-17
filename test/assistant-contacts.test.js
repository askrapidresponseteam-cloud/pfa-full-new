'use strict';

/* A mobile number or an email typed while the chat asks something else
   (owner, 17 Nov 2026, with the chat asking "Which animal?" again after
   8105250299 was typed: "chat should be smart. when mobile number is
   entered- bot should understand.. can you make it smart"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const FL = require('../assets/assistant-flows.js');

const NOW = Date.parse('2026-11-17T04:30:00Z');
const UDUPI = { done: { state: 'Karnataka', districts: ['Udupi'], places: ['Udupi'] } };

function talk(steps, opts) {
  const s = FL.createSession(Object.assign({ now: () => NOW }, opts || {}));
  let o = s.start();
  const said = [];
  for (const step of steps) {
    if (step && step.done) o = s.done(o.action.id, step.done);
    else if (step && step.tap) o = s.tap(step.tap);
    else o = s.hear(step);
    said.push(o.messages.map((m) => m.text));
  }
  return { s, o, said, last: said[said.length - 1] || [] };
}
const REPORT = ['report cruelty', 'Some men are beating a dog with sticks near the market'];

test('a mobile typed at "Which animal?" is kept, said back, and the question put again', () => {
  const t = talk(REPORT.concat(['8105250299']));
  assert.deepEqual(t.last, ['Thank you, I have your mobile number: 81052 50299.', 'Which animal?']);
  assert.ok(!t.last.includes('Please choose one of these.'));
});

test('the form then never asks for the mobile, and sends the one given', () => {
  const t = talk(REPORT.concat(['+91 81052-50299', 'Dog', 'Happening now', '576101', UDUPI, { tap: 'Udupi' }, 'House 14', 'Car Street', 'not known', '#skip', 'Karthik Dhanya']));
  const asked = t.said.flat();
  assert.ok(!asked.some((x) => /10-digit mobile/.test(x)), 'the mobile question is skipped');
  assert.deepEqual(t.last, ['Your email? The confirmation goes there.']);
  const done = talk(REPORT.concat(['+91 81052-50299', 'Dog', 'Happening now', '576101', UDUPI, { tap: 'Udupi' }, 'House 14', 'Car Street', 'not known', '#skip', 'Karthik Dhanya', 'k@example.com']));
  const list = done.o.messages[0].list || [];
  assert.deepEqual(list.find((row) => row[0] === 'Mobile'), ['Mobile', '8105250299'], 'in the summary before it is sent');
});

test('a choice and a mobile in one message: both are taken', () => {
  const t = talk(REPORT.concat(['dog, my number is 98450 12345']));
  assert.equal(t.last[0], 'Thank you, I have your mobile number: 98450 12345.');
  assert.equal(t.last[1], 'Is it happening now?', 'the animal was heard too');
});

test('an email typed early; an email at the mobile question; then the email is not asked', () => {
  let t = talk(REPORT.concat(['my email is Asha@Example.com']));
  assert.deepEqual(t.last, ['Thank you, I have your email: asha@example.com.', 'Which animal?']);
  t = talk(['I want to volunteer', 'Rescue', '#done', 'Asha Rao', 'asha@example.com']);
  assert.deepEqual(t.last, ['Thank you, I have your email: asha@example.com.', 'Your 10-digit mobile number?']);
  t = talk(['I want to volunteer', 'Rescue', '#done', 'Asha Rao', 'asha@example.com', '9845012345']);
  assert.ok(!t.last.join(' ').includes('Your email?'), 'the email is not asked again');
});

test('the same number again, and a new number, are said as they are', () => {
  let t = talk(REPORT.concat(['8105250299', '8105250299']));
  assert.deepEqual(t.last, ['I already have that number.', 'Which animal?']);
  t = talk(REPORT.concat(['8105250299', '9845012345']));
  assert.deepEqual(t.last, ['I have changed your mobile number to 98450 12345.', 'Which animal?']);
});

test('in Hindi, the same', () => {
  const t = talk(['क्रूरता की रिपोर्ट करनी है', 'बाज़ार के पास कुछ लोग कुत्ते को डंडों से मार रहे हैं', 'मेरा नंबर 8105250299 है']);
  assert.equal(t.last[0], 'धन्यवाद, आपका मोबाइल नंबर मिल गया: 81052 50299।');
});

test('a number typed where a description or a few words are asked stays there: it may be someone else\'s', () => {
  const t = talk(['report cruelty', '9845012345']);
  assert.ok(!t.last.join(' ').includes('I have your mobile number'));
});
