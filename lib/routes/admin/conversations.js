'use strict';

/* GET  /api/admin/conversations            the emails to info@ that are not
                                            about a submission, newest first
                                            (?state=open|closed|all)
   GET  /api/admin/conversations?id=MC-...  one of them, every message in it
   POST /api/admin/conversations            { action: 'answer', id, text }
                                            { action: 'close' | 'reopen', id }

   Owner, 28 Nov 2026: "ensure every revert/reply of email is properly sent
   and received from info@ for all queries and responses.. back and forth".
   A reply to a card being posted, to an intern's start link, to a letter, or
   a new email someone wrote to info@, is kept here (lib/mail-conversations.js)
   and answered from here: the answer goes from info@, threaded under what it
   answers, and their next reply comes back to the same conversation.

   Needs the Submissions section, as the rest of the panel's email does.
   Every answer is written to the audit log. Nothing is ever deleted. */

const { requireAdmin } = require('../../admin-auth');
const { getDb } = require('../../firebase');
const CONV = require('../../mail-conversations');
const NOTIFY = require('../../membership-notify');
const mail = require('../../caregiver-mail');
const MT = require('../../mail-thread');
const audit = require('../../admin-audit');
const { canAccess } = require('../../admin-modules');

/* An answer to an email about money (a receipt, a payment) is seen only by
   those who may see payments (owner: money records go to the payments
   inboxes only) */
function seesMoney(who) {
  try { return who.role === 'super' || canAccess(who, 'payments'); } catch (_) { return who.role === 'super'; }
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => { raw += c; if (raw.length > 40000) raw = raw.slice(0, 40000); });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function queryOf(request) {
  if (request.query) return request.query;
  try { return Object.fromEntries(new URL(request.url, 'http://x').searchParams); } catch (_) { return {}; }
}

/* what the panel shows of a message: never raw HTML */
function shown(m) {
  return {
    id: m.id, direction: m.direction, party: m.party, from: m.from, fromName: m.fromName || '', to: m.to || [], subject: m.subject || '',
    text: m.text || '', fullText: m.fullText && m.fullText !== m.text ? m.fullText : '', at: m.at, auto: m.auto || '',
    attachments: m.attachments || [], by: m.by || null, state: m.state || '', relay: m.relay || null
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const who = await requireAdmin(request, response, 'submissions');
  if (!who) return undefined;
  try {
    const db = getDb();
    if (request.method === 'GET') {
      const q = queryOf(request);
      if (q.id) {
        const c = await CONV.get(db, q.id);
        if (c && c.answers && c.answers.money && !seesMoney(who)) return sendJson(response, 404, { code: 'NO_CONVERSATION', message: 'That conversation is not here. Refresh the page.' });
        if (!c) return sendJson(response, 404, { code: 'NO_CONVERSATION', message: 'That conversation is not here. Refresh the page.' });
        return sendJson(response, 200, {
          ok: true, mailOn: mail.isConfigured(),
          conversation: { id: c.id, subject: c.subject, person: c.person, state: c.state, needsAnswer: Boolean(c.needsAnswer), answers: c.answers || null, createdAt: c.createdAt, updatedAt: c.updatedAt },
          messages: (c.messages || []).map(shown)
        });
      }
      const money = seesMoney(who);
      const [list, counts] = await Promise.all([CONV.list(db, { state: q.state, money }), CONV.counts(db, { money })]);
      return sendJson(response, 200, { ok: true, mailOn: mail.isConfigured(), counts, conversations: list.slice(0, 200) });
    }
    const body = await readBody(request);
    const id = String(body.id || '');
    if (!seesMoney(who)) {
      const c = await CONV.get(db, id);
      if (c && c.answers && c.answers.money) return sendJson(response, 404, { code: 'NO_CONVERSATION', message: 'That conversation is not here. Refresh the page.' });
    }
    if (body.action === 'close' || body.action === 'reopen') {
      const out = await CONV.setState(db, id, body.action === 'close' ? 'closed' : 'open', { email: who.email || '', name: who.name || '' });
      if (!out.ok) return sendJson(response, out.status, { code: out.code, message: out.message });
      await audit.record(who, { module: 'submissions', action: `conversation-${body.action}`, subject: id, detail: '' }, request);
      return sendJson(response, 200, out);
    }
    if (body.action === 'answer') {
      const by = { email: who.email || '', name: who.name || '' };
      const out = await CONV.answer(db, {
        conversation: id, text: body.text, by, domain: MT.domainOf(mail.sender()), siteUrl: NOTIFY.publicSite ? NOTIFY.publicSite() : '',
        send: ({ template, to, payload, dedupeKey }) => NOTIFY.send({ template, to, payload, dedupeKey, claimBy: 'panel' })
      });
      if (!out.ok) return sendJson(response, out.status, { code: out.code, message: out.message });
      await audit.record(who, { module: 'submissions', action: 'conversation-answer', subject: id, detail: `to ${out.to}, ${out.state}` }, request);
      const said = out.state === 'sent' ? `Sent to ${out.to} from info@.` : out.state === 'queued' ? `Kept and queued for ${out.to}; it goes as soon as email can leave the site.` : `Kept here, but not sent to ${out.to}. Try again shortly.`;
      return sendJson(response, 200, Object.assign({ message: said }, out));
    }
    return sendJson(response, 422, { code: 'BAD_ACTION', message: 'Answer, close or reopen.' });
  } catch (error) {
    console.error('conversations', error && error.message);
    return sendJson(response, 500, { code: 'FAILED', message: 'That could not be done just now. Try again.' });
  }
};
