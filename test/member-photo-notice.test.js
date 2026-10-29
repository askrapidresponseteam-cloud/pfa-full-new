/* Owner, 29 Oct 2026: "when people upload the photo, can you ensure it
   appears here. and admin gets a notification."
   - every panel user who can approve cards is emailed, not only the forms inbox
   - the panel shows a notice on every page with Review now, and the
     Membership cards page brings itself up to date when a photograph arrives */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = require('../lib/routes/admin/membership');
const NOTIFY = require('../lib/membership-notify');
const P = ADMIN._private;
const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

test('approvers: super admins, full admins and Membership staff; never the disabled or the rest', () => {
  const got = P.approverEmails([
    { email: 'Super@PFA.test', customClaims: { admin: true, role: 'super' } },
    { email: 'old@pfa.test', customClaims: { admin: true } },
    { email: 'cards@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['membership', 'shop'] } },
    { email: 'shop@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['shop'] } },
    { email: 'gone@pfa.test', disabled: true, customClaims: { admin: true, role: 'super' } },
    { email: 'member@pfa.test', customClaims: {} },
    { customClaims: { admin: true, role: 'super' } }
  ]);
  assert.deepEqual(got, ['super@pfa.test', 'old@pfa.test', 'cards@pfa.test']);
});

test('the office notice goes to the forms inbox and every approver, once each', async (t) => {
  const sent = [];
  const realSend = NOTIFY.send;
  NOTIFY.send = async (letter) => { sent.push(letter); return { ok: true }; };
  P.setListUsers(async () => [
    { email: 'cards@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['membership'] } },
    { email: 'gandhim@exmpls.sansad.in', customClaims: { admin: true, role: 'super' } }
  ]);
  t.after(() => { NOTIFY.send = realSend; P.setListUsers(null); });
  await P.tellOffice({ reference: 'PFA-MEM-1', name: 'Nishad Shally', tierLabel: 'Annual', receivedAt: '2026-10-29T10:00:00.000Z' });
  const to = sent.map((l) => l.to).sort();
  assert.deepEqual(to, ['cards@pfa.test', 'gandhim@exmpls.sansad.in']);
  assert.ok(sent.every((l) => l.template === 'member_photo_staff' && l.payload.name === 'Nishad Shally'));
  assert.equal(new Set(sent.map((l) => l.dedupeKey)).size, sent.length, 'each recipient has its own dedupe key');
});

test('a failed or slow account listing still tells the forms inbox', async (t) => {
  const sent = [];
  const realSend = NOTIFY.send;
  NOTIFY.send = async (letter) => { sent.push(letter); return { ok: true }; };
  P.setListUsers(async () => { throw new Error('no credentials'); });
  t.after(() => { NOTIFY.send = realSend; P.setListUsers(null); });
  await P.tellOffice({ reference: 'PFA-MEM-2', name: 'A', tierLabel: 'Annual', receivedAt: '2026-10-29T10:00:00.000Z' });
  assert.deepEqual(sent.map((l) => l.to), ['gandhim@exmpls.sansad.in']);
});

test('the panel: a notice on every page with Review now, and a quiet refresh', () => {
  assert.match(html, /<div class="pnote" id="photoNote"[^>]*hidden>/);
  assert.match(html, /id="photoNoteGo">Review now</);
  assert.match(html, /\.pnote\{/);
  assert.match(html, /\.pnote\[hidden\]\{display:none\}/);
  assert.match(html, /function photoWatch\(\)/);
  assert.match(html, /api\('\/api\/admin\/membership\?queue=review'\)/);
  assert.match(html, /sent their photograph for the membership card/);
  assert.match(html, /mqView = 'review';[\s\S]{0,120}show\('membership'\)/, 'Review now opens To approve');
  assert.match(html, /function membershipQuiet\(\)/);
  assert.match(html, /photoTimer = setInterval\(photoWatch, 60000\)/, 'looks every minute');
  assert.match(html, /n > photoSeen && current === 'membership'\) membershipQuiet\(\)/, 'the open page updates when a photograph arrives');
  assert.ok(!/[–—]/.test(html.slice(html.indexOf('function photoWatch'), html.indexOf('function replyWatch'))), 'no dashes');
});
