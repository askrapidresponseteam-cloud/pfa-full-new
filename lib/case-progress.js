'use strict';

/* The office kept up to date on a case worked in the panel.

   Owner, 16 Nov 2026: "can you ensure that when user replies/works on
   cruelty cases from here- a copy goes to gandhim on what was told? ... idea
   is gandhim should always be aware of the progress and you need to build a
   clean logic for it".

   Before this, the office's inbox had the case when it arrived (the forward,
   lib/submission-forward.js) and every email the person wrote back (the
   relay, lib/inbound-mail.js), but nothing of what PFA's staff did in the
   panel: a reply they sent from there, a status moved, a note, an
   assignment. So now each of those is told to the inbox the case was sent
   to, as it happens:

     reply     what was written to the person, word for word, and that it
               went (only a reply that was delivered: what was told)
     status    from what to what, with the note given
     note      the internal note, word for word (it never goes to the person)
     assign    who it is with now
     remove    taken out of the panel, and restore, put back

   For these kinds only (WATCHED): a cruelty report, and a request to follow
   a case. Each email is a reply in the case's own thread in that inbox (the
   forward's Message-ID in In-Reply-To and References, and the same
   subject), so the case reads top to bottom in one conversation there.
   Reply-To is the person who did it, so answering the update reaches them,
   never the person who wrote in.

   Clean in four ways:
   - one email per thing done, each with its own dedupe key on the outbound
     queue (lib/caregiver-store.js), so a retry or a double click is one
     email, and a slow or failed send is tried again by the email worker;
   - the inbox is the one the case itself goes to (FORWARD.relayInboxes):
     a record of money never reaches the forms inbox this way;
   - the person in that inbox who did it themselves is not told what they
     just did;
   - it never holds up or fails what was done: anything that goes wrong
     here is logged and the action stands. */

const S = require('./submissions');
const FORWARD = require('./submission-forward');
const FLOW = require('./case-flow');
const CONFIRM = require('./confirmations');

const WATCHED = new Set(['PFA-CR', 'PFA-C']);
const TEMPLATE = 'case_progress';
const MAX_TEXT = 4000;

function watched(record) {
  return WATCHED.has(String((record && record.kind) || '').trim().toUpperCase());
}

/* The inboxes this case's updates go to: where it was sent, less whoever
   did this (they know). */
function recipients(record, who) {
  if (!watched(record)) return [];
  const me = String((who && who.email) || '').trim().toLowerCase();
  return FORWARD.relayInboxes(record).filter((a) => a && a !== me);
}

function nameOf(who) {
  const n = String((who && who.name) || '').trim();
  if (n) return n;
  const e = String((who && who.email) || '').trim();
  return e ? e.split('@')[0].replace(/[._-]+/g, ' ') : 'Someone at PFA';
}

/* What goes in the email, from the record and what was done. */
function payloadOf(reference, record, event, who, at, site, id) {
  const d = record || {};
  const contact = S.contactOf(d.fields);
  const kind = d.kind || '';
  const e = event || {};
  const statusNow = e.status || FLOW.currentOf(d);
  return {
    reference,
    eventId: String(id || ''),
    threadId: d.threadId || '',
    kindLabel: d.kindLabel || S.KIND_LABELS[kind] || 'Submission',
    name: contact.name || '',
    email: contact.email || '',
    type: e.type,
    text: String(e.text || '').slice(0, MAX_TEXT),
    from: e.from ? FLOW.labelOf(kind, e.from) : '',
    to: e.to ? FLOW.labelOf(kind, e.to) : '',
    assignee: e.assignee || '',
    delivered: e.delivered !== false,
    statusLabel: FLOW.labelOf(kind, statusNow),
    by: nameOf(who),
    byEmail: String((who && who.email) || ''),
    at,
    siteUrl: site || '',
    caseUrl: require('./weekly-digest').caseLink(reference)
  };
}

/* Tell the office. Never throws; answers what happened to each copy. */
async function tell({ reference, record, event, who, at, id, mail, queue, site, timeoutMs }) {
  try {
    const to = recipients(record, who);
    if (!to.length || !event || !event.type) return [];
    const payload = payloadOf(reference, record, event, who, at, site, id);
    const out = [];
    for (const address of to) {
      out.push(await CONFIRM.send({
        to: address,
        template: TEMPLATE,
        payload,
        dedupeKey: `${TEMPLATE}:${reference}:${id}:${address}`,
        mail,
        queue,
        timeoutMs: timeoutMs || 4000
      }));
    }
    return out;
  } catch (error) {
    console.warn('case progress not told to the office', { reference, message: error && error.message });
    return [];
  }
}

module.exports = { WATCHED, TEMPLATE, watched, recipients, payloadOf, tell };
