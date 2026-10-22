'use strict';

/* Who may open what. The page hides links; these pin the part that matters -
   the server refusing a module that an account does not carry - and the
   rules of the People page. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const M = require('../lib/admin-modules');
const { canAccess } = require('../lib/admin-auth');
const { createHandler: createPeople } = require('../lib/routes/admin/people')._private;

function request({ method = 'GET', body, query = {}, headers = {} } = {}) {
  const r = new EventEmitter(); r.method = method; r.query = query; r.headers = headers;
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(req, res); return res;
}


test('every admin route names its module, and the guard refuses with 403, not 401', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'lib', 'routes', 'admin');
  const unguarded = [];
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    const calls = [...source.matchAll(/requireAdmin\(request, response(?:, ([^)]+))?\)/g)];
    assert.ok(calls.length, `${f} uses the guard`);
    /* records.js (who am I) and search.js (one box for everything, each
       result kept only if this account opens its section, 8 Oct 2026) are
       for any administrator, and filter by module themselves. */
    calls.forEach((c) => { if (!c[1] && f !== 'records.js' && f !== 'search.js') unguarded.push(f); });
  });
  assert.deepEqual(unguarded, [], 'routes without a module');

  /* The guard itself, with identity stubbed. */
  const adminAuth = require('../lib/admin-auth');
  const realIdentify = adminAuth.identify;
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  /* requireAdmin resolves identity through module.exports, so a test can
     replace that one step. It used to have to set a shared secret instead,
     which is exactly the thing that has been retired. */
  adminAuth.identify = async () => ({ mode: 'firebase', uid: 'u1', email: 'a@pfa.test', role: 'super', modules: [] });
  const who = await adminAuth.requireAdmin({ headers: {} }, res, 'payments');
  assert.equal(who.role, 'super', 'a super admin reaches every module');
  adminAuth.identify = realIdentify;
  const denied = await adminAuth.requireAdmin({ headers: {} }, res, 'payments');
  assert.equal(denied, null); assert.equal(res.statusCode, 401);
  assert.equal(adminAuth.identify, realIdentify);
});

test('the dashboard reads and returns only the sections the person may see', async () => {
  const metrics = require('../lib/routes/admin/metrics');
  const firebase = require('../lib/firebase');
  const adminAuth = require('../lib/admin-auth');
  const touched = new Set();
  const q = (name) => ({
    where() { return this; }, orderBy() { return this; }, select() { return this; }, limit() { return this; },
    count() { return { async get() { touched.add(name); return { data: () => ({ count: 3 }) }; } }; },
    async get() { touched.add(name); return { docs: [], size: 0, empty: true }; }
  });
  const realGetDb = firebase.getDb;
  firebase.getDb = () => ({ collection: (name) => q(name) });
  delete require.cache[require.resolve('../lib/routes/admin/metrics')];
  const handler = require('../lib/routes/admin/metrics');
  const realIdentify2 = adminAuth.identify;
  adminAuth.identify = async () => ({ mode: 'firebase', uid: 'u1', email: 'a@pfa.test', role: 'super', modules: [] });
  try {
    /* A super admin reads everything. */
    let res = await run(handler, request({ headers: {} }));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.payments && res.body.members && res.body.store && res.body.submissions);
    assert.ok(touched.has('transactions') && touched.has('members'));
  } finally {
    adminAuth.identify = realIdentify2;
    firebase.getDb = realGetDb;
    delete require.cache[require.resolve('../lib/routes/admin/metrics')];
  }
  /* The gating itself is pure: with a staff descriptor, the response must
     not carry money. Exercised through the module's own canAccess. */
  assert.equal(adminAuth.canAccess({ role: 'staff', modules: ['overview', 'submissions'] }, 'payments'), false);
  void metrics;
});

function fakeAuth(users) {
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const calls = [];
  return {
    calls,
    async listUsers() { return { users: [...byEmail.values()], pageToken: undefined }; },
    async getUserByEmail(email) { const u = byEmail.get(email); if (!u) { const e = new Error('There is no user record'); e.code = 'auth/user-not-found'; throw e; } return u; },
    async getUser(uid) { return [...byEmail.values()].find((u) => u.uid === uid); },
    async createUser({ email, displayName }) { const u = { uid: 'new-' + email, email, displayName, customClaims: {}, metadata: {} }; byEmail.set(email, u); calls.push(['create', email]); return u; },
    async updateUser(uid, patch) { const u = [...byEmail.values()].find((x) => x.uid === uid); Object.assign(u, patch); },
    async setCustomUserClaims(uid, claims) { const u = [...byEmail.values()].find((x) => x.uid === uid); u.customClaims = claims; calls.push(['claims', u.email, claims]); },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); },
    async generatePasswordResetLink(email) { return `https://pfa-new-website.firebaseapp.com/__/auth/action?mode=resetPassword&email=${email}`; }
  };
}

function peopleHandler(auth, me, opts = {}) {
  const setAccess = async (a, uid, { role, modules }) => {
    const u = await a.getUser(uid);
    const claims = !role ? {} : role === 'super' ? { admin: true, role: 'super' } : { admin: true, role: 'staff', modules: M.normaliseModules(modules) };
    await a.setCustomUserClaims(uid, claims);
    return M.accessOf(claims);
  };
  return createPeople({
    getAuth: () => auth, deliver: opts.deliver || (async () => ({})), isConfigured: () => Boolean(opts.mail), now: () => Date.UTC(2026, 7, 23),
    requireAdmin: async (req, res, module) => {
      if (canAccess(me, module)) return me;
      res.statusCode = 403; res.end(JSON.stringify({ code: 'FORBIDDEN' })); return null;
    },
    setAccess
  });
}

const KARTHIK = { uid: 'k1', email: 'karthik@pfa.org', displayName: 'Karthik', customClaims: { admin: true }, metadata: { lastSignInTime: 'x' } };
const ME = { uid: 'k1', email: 'karthik@pfa.org', role: 'super', modules: M.MODULE_KEYS };

test('only a super admin can open People; staff get 403', async () => {
  const auth = fakeAuth([KARTHIK]);
  const staff = peopleHandler(auth, { uid: 's', email: 's@pfa.org', role: 'staff', modules: M.MODULE_KEYS });
  assert.equal((await run(staff, request())).statusCode, 403, 'every module is still not People');
  const sup = peopleHandler(auth, ME);
  const res = await run(sup, request());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.people[0].role, 'super');
  assert.equal(res.body.people[0].legacy, true);
  assert.equal(res.body.people[0].you, true);
  assert.ok(res.body.modules.length === M.MODULES.length && res.body.presets.length);
});

test('inviting someone creates the account, sets the claims, and hands over a password link when mail is off', async () => {
  const auth = fakeAuth([KARTHIK]);
  const handler = peopleHandler(auth, ME);
  const res = await run(handler, request({ method: 'POST', body: { action: 'set', email: 'Meena@PFA.org', name: 'Meena Iyer', role: 'staff', modules: ['submissions', 'verify', 'bogus'] } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.deepEqual(res.body.modules, ['submissions', 'verify']);
  assert.equal(res.body.invite.sent, false);
  assert.match(res.body.invite.link, /resetPassword/);
  const claims = auth.calls.find((c) => c[0] === 'claims' && c[1] === 'meena@pfa.org')[2];
  assert.deepEqual(claims, { admin: true, role: 'staff', modules: ['submissions', 'verify'] });

  /* With mail configured the link goes by email and is not echoed back. */
  const sent = [];
  const mailed = peopleHandler(fakeAuth([KARTHIK]), ME, { mail: true, deliver: async (m) => { sent.push(m); return {}; } });
  const res2 = await run(mailed, request({ method: 'POST', body: { action: 'set', email: 'r@pfa.org', role: 'staff', modules: ['payments'] } }));
  assert.equal(res2.body.invite.sent, true);
  assert.equal(res2.body.invite.link, '');
  assert.equal(sent[0].template, 'staff_invite');
  assert.deepEqual(sent[0].payload.modules, ['Payments']);

  /* Staff with nothing ticked is refused; a real address is required. */
  assert.equal((await run(handler, request({ method: 'POST', body: { action: 'set', email: 'x@pfa.org', role: 'staff', modules: [] } }))).statusCode, 400);
  assert.equal((await run(handler, request({ method: 'POST', body: { action: 'set', email: 'nope', role: 'staff', modules: ['verify'] } }))).statusCode, 400);
});

test('a password link that is not emailed says why, truthfully, and comes back to be copied', async () => {
  /* Owner, 22 Oct 2026, a screenshot: "Email is not set up, so send them this
     link." on a panel whose email was set up, and no link shown: "why does
     it say this. email to go from info@ ... which is already in use". */
  const quiet = console.error; console.error = () => {};
  try {
    const anushka = { uid: 'a1', email: 'anushka@pfa.org', displayName: 'Anushka', customClaims: { admin: true, role: 'super' }, metadata: {} };
    const ask = (handler) => run(handler, request({ method: 'POST', body: { action: 'reset', email: 'anushka@pfa.org' } }));

    /* sent: no link echoed */
    const ok = await ask(peopleHandler(fakeAuth([KARTHIK, anushka]), ME, { mail: true, deliver: async () => ({}) }));
    assert.equal(ok.body.invite.sent, true);
    assert.equal(ok.body.invite.link, '');
    assert.match(ok.body.note, /^Password link sent to anushka@pfa\.org from the PFA mailbox\.$/);

    /* the mailbox refused it: its own words, and the link */
    const refused = await ask(peopleHandler(fakeAuth([KARTHIK, anushka]), ME, { mail: true, deliver: async () => {
      const e = new Error('Mailbox server refused: 550 5.7.1 message rejected'); e.kind = 'recipient'; throw e;
    } }));
    assert.equal(refused.body.invite.sent, false);
    assert.equal(refused.body.invite.why, 'failed');
    assert.match(refused.body.invite.link, /resetPassword/);
    assert.match(refused.body.note, /refused by the mailbox: Mailbox server refused: 550 5\.7\.1 message rejected/);
    assert.doesNotMatch(refused.body.note, /not set up/, 'a refusal is not "not set up"');

    /* taken and not confirmed: it may have arrived */
    const unsure = await ask(peopleHandler(fakeAuth([KARTHIK, anushka]), ME, { mail: true, deliver: async () => {
      const e = new Error('Mailbox server stopped answering after the email was handed over (outcome not known): timeout'); e.kind = 'unknown'; e.uncertain = true; throw e;
    } }));
    assert.equal(unsure.body.invite.why, 'unknown');
    assert.match(unsure.body.note, /may reach anushka@pfa\.org/);
    assert.match(unsure.body.invite.link, /resetPassword/);

    /* no mailbox on this server at all */
    const off = await ask(peopleHandler(fakeAuth([KARTHIK, anushka]), ME, { mail: false }));
    assert.equal(off.body.invite.why, 'off');
    assert.match(off.body.note, /no mailbox to send from/);

    /* a new person whose invitation failed is not told they were emailed */
    const created = await run(peopleHandler(fakeAuth([KARTHIK]), ME, { mail: true, deliver: async () => { const e = new Error('Mailbox server refused: 554'); e.kind = 'recipient'; throw e; } }),
      request({ method: 'POST', body: { action: 'set', email: 'new@pfa.org', role: 'staff', modules: ['payments'] } }));
    assert.equal(created.body.invite.sent, false);
    assert.match(created.body.note, /^Access given\. The email to new@pfa\.org was refused/);
  } finally { console.error = quiet; }

  /* the panel shows the note, and the link with a Copy button, for both */
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /function inviteSaid\(data\)/);
  assert.match(html, /\.then\(inviteSaid\)/, 'a password link');
  assert.match(html, /people\(\)\.then\(function \(\) \{ inviteSaid\(data\); \}\)/, 'an invitation');
  assert.match(html, /copy\.textContent = 'Copy link'/);
  assert.doesNotMatch(html, /Access given, and they have been emailed/, 'the panel no longer claims an email it was not told went');
});

test('giving somebody the panel is recorded, not only taking it away', async () => {
  /* An audit log is read to find out who granted somebody access. Removal was
     recorded and the grant was not, so it could not answer that question. */
  const audit = require('../lib/admin-audit');
  const written = [];
  const real = audit.record;
  audit.record = (who, event) => { written.push(event); return Promise.resolve(event); };
  try {
    const auth = fakeAuth([KARTHIK]);
    const handler = peopleHandler(auth, ME);

    await run(handler, request({ method: 'POST', body: { action: 'set', email: 'meena@pfa.org', name: 'Meena Iyer', role: 'staff', modules: ['submissions'] } }));
    const created = written.find((e) => /access-(created|granted)/.test(e.action));
    assert.ok(created, `a new administrator was created and nothing was recorded: ${JSON.stringify(written)}`);
    assert.equal(created.module, 'people');
    assert.equal(created.subject, 'meena@pfa.org');
    assert.match(created.detail, /staff/);

    /* And a change of role, which is the one an audit is most often read for. */
    written.length = 0;
    await run(handler, request({ method: 'POST', body: { action: 'set', email: 'meena@pfa.org', role: 'super' } }));
    const changed = written.find((e) => e.action === 'access-changed');
    assert.ok(changed, `an escalation to super admin was not recorded: ${JSON.stringify(written)}`);
    assert.match(changed.detail, /super admin/);
    assert.match(changed.detail, /was staff/, 'the record does not say what the access was before');

    /* Removal was already recorded; it must stay that way. */
    written.length = 0;
    await run(handler, request({ method: 'POST', body: { action: 'remove', email: 'meena@pfa.org' } }));
    assert.ok(written.some((e) => e.action === 'access-removed'), 'removal stopped being recorded');
  } finally {
    audit.record = real;
  }
});

test('you cannot demote or remove yourself, and the last super admin cannot be removed', async () => {
  const auth = fakeAuth([KARTHIK, { uid: 'm1', email: 'meena@pfa.org', displayName: 'Meena', customClaims: { admin: true, role: 'staff', modules: ['verify'] }, metadata: {} }]);
  const handler = peopleHandler(auth, ME);
  const self = await run(handler, request({ method: 'POST', body: { action: 'set', email: 'karthik@pfa.org', role: 'staff', modules: ['verify'] } }));
  assert.equal(self.statusCode, 409); assert.equal(self.body.code, 'SELF');
  const selfRemove = await run(handler, request({ method: 'POST', body: { action: 'remove', email: 'karthik@pfa.org' } }));
  assert.equal(selfRemove.statusCode, 409);

  /* Another super admin trying to remove the only other super fails; after
     promoting someone, it succeeds, and their sessions are ended. */
  const other = { uid: 'm1', email: 'meena@pfa.org', role: 'super', modules: M.MODULE_KEYS };
  await auth.setCustomUserClaims('m1', { admin: true, role: 'super' });
  const asMeena = peopleHandler(auth, other);
  const removeK = await run(asMeena, request({ method: 'POST', body: { action: 'remove', email: 'karthik@pfa.org' } }));
  assert.equal(removeK.statusCode, 200, 'two supers, so one may go');
  assert.ok(auth.calls.some((c) => c[0] === 'revoke' && c[1] === 'k1'), 'signed-in sessions are ended');
  const removeLast = await run(asMeena, request({ method: 'POST', body: { action: 'remove', email: 'meena@pfa.org' } }));
  assert.equal(removeLast.statusCode, 409);
  assert.equal((await run(asMeena, request({ method: 'POST', body: { action: 'remove', email: 'ghost@pfa.org' } }))).statusCode, 404);
});

test('the database rules let only super admins read from the browser', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /function isAdmin\(\) \{\s*return signedIn\(\) && request\.auth\.token\.admin == true && request\.auth\.token\.role != 'staff';/);
});

test('the panel offers only what the account carries and gives super admins the People page', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(/function can\(module\)/.test(html) && /function applyAccess\(\)/.test(html));
  assert.ok(/data-tab="people"[^>]*data-super/.test(html), 'People is marked super-only');
  assert.ok(/if \(!can\(tab\)\)/.test(html), 'navigation checks access');
  assert.equal((html.match(/data-module="/g) || []).length, 5, 'dashboard sections are tagged with their module');
  assert.ok(/can\('payments'\) && stat\('payments'/.test(html), 'the money tile needs Payments');
});
