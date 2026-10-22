/* GET  /api/admin/people
   POST /api/admin/people  { action: 'set' | 'remove' | 'reset', email, name?, role?, modules? }

   Who may open the panel, and what each of them may open. Super admins only.

   - set     gives an email a role ('super' or 'staff') and, for staff, a list
             of modules. If no Firebase user exists for that email, one is
             created and they are sent a link to set their password.
   - remove  takes the panel away (the account stays; it simply stops being an
             administrator). Their signed-in sessions are ended.
   - reset   sends the set-your-password link again.

   Two things cannot be done, however they are phrased: removing or demoting
   yourself, and leaving the panel with no super admin at all. */

'use strict';

const adminAuth = require('../../admin-auth');
const mail = require('../../caregiver-mail');
const M = require('../../admin-modules');
const audit = require('../../admin-audit');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 20000) raw = raw.slice(0, 20000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function siteUrl(request) {
  const configured = clean(process.env.PUBLIC_SITE_URL, 300);
  try { const u = new URL(configured); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* fall through */ }
  const host = (request.headers || {})['x-forwarded-host'] || (request.headers || {}).host || 'pfa-full-website.vercel.app';
  return `https://${host}`;
}

function person(user, me) {
  const access = M.accessOf(user.customClaims || {});
  return {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
    role: access.role,
    modules: access.role === 'super' ? M.MODULE_KEYS.slice() : access.modules,
    legacy: Boolean(access.legacy),
    disabled: Boolean(user.disabled),
    lastSignInAt: (user.metadata && user.metadata.lastSignInTime) || null,
    createdAt: (user.metadata && user.metadata.creationTime) || null,
    you: Boolean(me && me.uid === user.uid)
  };
}

function createHandler(deps) {
  const { getAuth, deliver, isConfigured } = deps;
  const requireAdmin = deps.requireAdmin || adminAuth.requireAdmin;
  const setAccess = deps.setAccess || adminAuth.setAccess;

  async function everyone(auth, me) {
    const out = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      page.users.forEach((u) => { if (u.customClaims && u.customClaims.admin === true) out.push(person(u, me)); });
      pageToken = page.pageToken;
    } while (pageToken);
    return out.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'super' ? -1 : 1));
  }

  async function inviteLink(auth, email, request) {
    return auth.generatePasswordResetLink(email, { url: `${siteUrl(request)}/admin.html` });
  }

  /* The link always comes back when the email did not certainly go, with
     the reason it did not (owner, 22 Oct 2026, with a screenshot of
     "Email is not set up, so send them this link." on a panel whose email
     was set up, and no link anywhere: "why does it say this. email to go
     from info@ ... which is already in use"). That one sentence was said
     for every failure, a refused send included, and the panel never showed
     the link it spoke of. Now:
       off      this server has no mailbox to send from
       failed   the mailbox refused it; its own words are given
       unknown  the mailbox took it and went quiet: it may have arrived */
  async function sendInvite(auth, email, name, modules, role, request, reason) {
    const link = await inviteLink(auth, email, request);
    if (!isConfigured()) return { sent: false, link, why: 'off' };
    try {
      await deliver({ to: email, template: 'staff_invite', payload: {
        name, link, reason, role,
        modules: role === 'super' ? ['Everything, and People'] : modules.map(M.labelOf),
        adminUrl: `${siteUrl(request)}/admin.html`
      } });
      return { sent: true, link: '' };
    } catch (error) {
      console.error('admin people: the invitation email did not go', { to: email, kind: error && error.kind, message: error && error.message });
      return { sent: false, link, why: error && error.uncertain ? 'unknown' : 'failed', error: clean(error && error.message, 220) };
    }
  }
  function inviteNote(invite, email, what) {
    if (invite.sent) return `${what} sent to ${email} from the PFA mailbox.`;
    if (invite.why === 'off') return `This panel's server has no mailbox to send from, so nothing was emailed. Copy the link below and send it to ${email} yourself.`;
    if (invite.why === 'unknown') return `The mailbox took the email but did not confirm it went (${invite.error || 'no answer'}). It may reach ${email}; if not, send them the link below.`;
    return `The email to ${email} was refused by the mailbox: ${invite.error || 'no reason given'}. Copy the link below and send it to them yourself.`;
  }
  const inviteOut = (invite) => ({ sent: invite.sent, link: invite.link || '', why: invite.why || '', error: invite.error || '' });

  return async function handler(request, response) {
    const me = await requireAdmin(request, response, 'people');
    if (!me) return;

    try {
      const auth = getAuth();

      if (request.method === 'GET') {
        return sendJson(response, 200, { ok: true, people: await everyone(auth, me), modules: M.MODULES, presets: M.PRESETS, mailConfigured: isConfigured() });
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
      }

      const body = await readBody(request);
      const action = clean(body.action, 12);
      const email = clean(body.email, 254).toLowerCase();
      if (!EMAIL.test(email)) return sendJson(response, 400, { code: 'BAD_EMAIL', message: 'Enter a real email address.' });
      const isMe = me.email && email === String(me.email).toLowerCase();

      let user = null;
      try { user = await auth.getUserByEmail(email); } catch (error) { if (!/not-found|no user record/i.test(String(error && (error.code || error.message)))) throw error; }

      if (action === 'set') {
        const role = clean(body.role, 10) === 'super' ? 'super' : 'staff';
        const modules = M.normaliseModules(body.modules);
        const name = clean(body.name, 80);
        if (role === 'staff' && !modules.length) return sendJson(response, 400, { code: 'NO_MODULES', message: 'Choose at least one module, or make them a super admin.' });
        if (isMe && role !== 'super') return sendJson(response, 409, { code: 'SELF', message: 'You cannot take super admin away from yourself. Ask another super admin.' });

        let created = false;
        if (!user) {
          user = await auth.createUser({ email, displayName: name || undefined, emailVerified: false });
          created = true;
        } else if (name && name !== (user.displayName || '')) {
          await auth.updateUser(user.uid, { displayName: name });
        }
        const before = M.accessOf(user.customClaims);
        const access = await setAccess(auth, user.uid, { role, modules });
        /* Taking the panel away was recorded and giving it was not, which is
           the wrong way round: an audit log is read to find out who granted
           somebody access, and it could not answer that. */
        audit.record(me, {
          module: 'people',
          action: created ? 'access-created' : before.role ? 'access-changed' : 'access-granted',
          subject: email,
          detail: `${email} is now ${access.role === 'super' ? 'a super admin' : `staff for ${(access.modules || []).join(', ') || 'no modules'}`}`
            + (before.role ? ` (was ${before.role === 'super' ? 'a super admin' : `staff for ${(before.modules || []).join(', ') || 'no modules'}`})` : '')
        }, request);
        const invite = created ? await sendInvite(auth, email, name, modules, role, request, 'invited') : null;
        return sendJson(response, 200, {
          ok: true, action, created, email, role: access.role, modules: access.modules,
          invite: invite ? inviteOut(invite) : null,
          note: created
            ? `Access given. ${inviteNote(invite, email, 'Invitation')}`
            : `Access updated. ${isMe ? 'Takes effect for you now.' : 'Takes effect for them within a minute.'}`
        });
      }

      if (!user || !(user.customClaims && user.customClaims.admin === true)) {
        return sendJson(response, 404, { code: 'NOT_FOUND', message: 'No administrator has that email.' });
      }

      if (action === 'remove') {
        if (isMe) return sendJson(response, 409, { code: 'SELF', message: 'You cannot remove yourself. Ask another super admin.' });
        const supers = (await everyone(auth, me)).filter((p) => p.role === 'super');
        if (M.accessOf(user.customClaims).role === 'super' && supers.length <= 1) {
          return sendJson(response, 409, { code: 'LAST_SUPER', message: 'That is the only super admin. Make someone else a super admin first.' });
        }
        await setAccess(auth, user.uid, { role: '' });
        await auth.revokeRefreshTokens(user.uid);
        audit.record(me, { module: 'people', action: 'access-removed', subject: email, detail: `${email} no longer has the panel; sessions ended` }, request);
        return sendJson(response, 200, { ok: true, action, email, note: `${email} no longer has the panel.` });
      }

      if (action === 'reset') {
        const invite = await sendInvite(auth, email, user.displayName || '', M.accessOf(user.customClaims).modules, M.accessOf(user.customClaims).role, request, 'reset');
        return sendJson(response, 200, { ok: true, action, email, invite: inviteOut(invite), note: inviteNote(invite, email, 'Password link') });
      }

      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be set, remove or reset.' });
    } catch (error) {
      console.error('admin people failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done right now.' });
    }
  };
}

module.exports = createHandler({
  getAuth() {
    require('../../firebase').getDb();
    return require('firebase-admin/auth').getAuth();
  },
  deliver: mail.deliver,
  isConfigured: mail.isConfigured,
  now: () => Date.now()
});
module.exports._private = { createHandler, person };
