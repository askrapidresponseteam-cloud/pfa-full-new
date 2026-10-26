'use strict';

/* Changes made by hand to the old site's members (owner, 26 Oct 2026):
   "there should be option to edit merge etc manually with 2 level
   confirmations and audit history for this separate membership page..
   clear cut audit saying who changed what and why.. unless why is clearly
   called out.. changes cannot happen manually".

   Four changes, each on its own record:
     edit      correct a person's name, mobiles, emails, addresses, plans, notes
     merge     two people who are one: one record keeps its id, the other's
               rows join it
     split     a row joined by mistake is taken out as a person of its own
     resolve   two people listed to check are different people

   Nothing is written over. The list shown is the import, then every change
   replayed in order (lib/routes/admin/old-members.js), so the history is the
   record itself, and every change says who made it, when, what it was
   (before and after) and why. A change without a clear reason is refused
   here, before it can be proposed; the two confirmations are enforced by
   the route. This file holds no database code: it is the rules alone. */

const crypto = require('crypto');
const O = require('./old-members');

const EDITABLE = { name: 'Name', mobiles: 'Mobile', emails: 'Email', addresses: 'Address', plans: 'Plan', notes: 'Notes' };
const MAX_ITEMS = 10;
const LIMITS = { name: 120, addresses: 400, plans: 80, notes: 500, emails: 254 };

class ChangeError extends Error {
  constructor(message, code) { super(message); this.code = code || 'BAD_CHANGE'; }
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* ---------- the reason ---------- */

const EMPTY_REASONS = new Set(['ok', 'okay', 'test', 'testing', 'na', 'n a', 'none', 'nil', 'done', 'change', 'changes', 'changed',
  'update', 'updated', 'updating', 'fix', 'fixed', 'correction', 'corrected', 'edit', 'edited', 'merge', 'merged', 'split',
  'as discussed', 'as per discussion', 'as told', 'as asked', 'same', 'same person', 'duplicate', 'dup', 'yes', 'no', 'required',
  'needed', 'necessary', 'checked', 'verified', 'asdf', 'qwerty', 'abc', 'xyz', 'wrong', 'error', 'mistake', 'data correction']);

/* A reason is a sentence someone else can understand later: at least three
   real words and 15 letters' worth of text, not a placeholder. */
function checkReason(text) {
  const reason = oneLine(text).slice(0, 600);
  const plain = reason.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = plain.split(' ').filter((w) => w.length >= 2);
  const letters = plain.replace(/\s/g, '');
  const most = Math.max(0, ...Object.values([...letters].reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {})));
  if (!reason) return { ok: false, message: 'Say why. A change cannot be made without a reason.' };
  if (reason.length > 500) return { ok: false, message: 'Keep the reason under 500 characters.' };
  if (EMPTY_REASONS.has(plain) || words.length < 3 || letters.length < 15 || (letters.length && most / letters.length > 0.5)) {
    return { ok: false, message: 'Say clearly why, in a full sentence someone else will understand later (for example: "Same mobile and address; she confirmed on the phone she joined twice").' };
  }
  return { ok: true, reason };
}

/* ---------- people ---------- */

function snapshot(m) {
  if (!m) return null;
  return {
    id: m.id, name: m.name, aka: (m.aka || []).slice(), mobiles: (m.mobiles || []).slice(),
    emails: (m.emails || []).map((e) => e.email), addresses: (m.addresses || []).slice(),
    numbers: (m.numbers || []).map((n) => n.number + ' (' + n.list + ')'), plans: (m.plans || []).slice(),
    notes: (m.notes || []).slice(), lists: (m.lists || []).slice(),
    rows: (m.sources || []).map((s) => s.list + ' row ' + s.row)
  };
}

function applyOverrides(m) {
  const o = m.overrides || {};
  Object.keys(o).forEach((k) => {
    if (k === 'emails') m.emails = o.emails.map((e) => ({ email: e, looksWrong: O.emailLooksWrong(e) }));
    else m[k] = Array.isArray(o[k]) ? o[k].slice() : o[k];
  });
  m.edited = Object.keys(o).length > 0;
  return m;
}

function rebuild(rows, keep) {
  const m = O.mergeRows(rows, (keep.joinedBecause || []).slice());
  m.id = keep.id;
  m.overrides = Object.assign({}, keep.overrides || {});
  m.byHand = Boolean(keep.byHand);
  return applyOverrides(m);
}

function splitId(row, taken) {
  let id = 'OSM-' + crypto.createHash('sha256').update('split:' + row.list + ':' + row.row).digest('hex').slice(0, 10).toUpperCase();
  let n = 2;
  const base = id;
  while (taken.has(id)) { id = base + '-' + n; n += 1; }
  return id;
}

/* ---------- state: the import, then changes ---------- */

function startState(members) {
  const map = new Map();
  (members || []).forEach((m) => { const copy = JSON.parse(JSON.stringify(m)); copy.overrides = copy.overrides || {}; map.set(copy.id, copy); });
  return { members: map, resolved: new Set() };
}

const pairKey = (a, b) => [a, b].sort().join('|');

/* Applies one change. Returns { before, after } snapshots, or { skipped }
   when the people it names are not in this list (a newer import). */
function apply(state, change) {
  const get = (id) => state.members.get(id);
  const c = change || {};
  if (c.op === 'edit') {
    const m = get(c.id);
    if (!m) return { skipped: 'That person is not in this copy of the list.' };
    const before = snapshot(m);
    m.overrides = Object.assign({}, m.overrides || {}, c.set || {});
    applyOverrides(m);
    return { before: [before], after: [snapshot(m)], ids: [m.id] };
  }
  if (c.op === 'merge') {
    const keep = get(c.keep); const other = get(c.absorb);
    if (!keep || !other || keep === other) return { skipped: 'One of those people is not in this copy of the list.' };
    const before = [snapshot(keep), snapshot(other)];
    const merged = rebuild((keep.rows || []).concat(other.rows || []), {
      id: keep.id,
      /* the record chosen to stay keeps its name, whichever spelling is longer */
      overrides: Object.assign({}, other.overrides || {}, { name: keep.name }, keep.overrides || {}),
      joinedBecause: [...new Set([...(keep.joinedBecause || []), ...(other.joinedBecause || []), 'joined by hand'])],
      byHand: true
    });
    state.members.delete(other.id);
    state.members.set(keep.id, merged);
    return { before, after: [snapshot(merged)], ids: [keep.id, other.id] };
  }
  if (c.op === 'split') {
    const m = get(c.id);
    if (!m) return { skipped: 'That person is not in this copy of the list.' };
    const at = (m.rows || []).findIndex((r) => r.list === c.list && Number(r.row) === Number(c.row));
    if (at < 0 || m.rows.length < 2) return { skipped: 'That row is not joined to this person in this copy of the list.' };
    const before = [snapshot(m)];
    const out = m.rows[at];
    const rest = m.rows.filter((_, i) => i !== at);
    const kept = rebuild(rest, { id: m.id, overrides: m.overrides, joinedBecause: m.joinedBecause, byHand: m.byHand });
    const id = splitId(out, new Set(state.members.keys()));
    const alone = rebuild([out], { id, overrides: {}, joinedBecause: [], byHand: true });
    state.members.set(kept.id, kept);
    state.members.set(alone.id, alone);
    return { before, after: [snapshot(kept), snapshot(alone)], ids: [kept.id, alone.id] };
  }
  if (c.op === 'resolve') {
    const a = get(c.a); const b = get(c.b);
    if (!a || !b || a === b) return { skipped: 'One of those people is not in this copy of the list.' };
    state.resolved.add(pairKey(a.id, b.id));
    return { before: [snapshot(a), snapshot(b)], after: [snapshot(a), snapshot(b)], ids: [a.id, b.id] };
  }
  return { skipped: 'Unknown change.' };
}

/* ---------- checking a proposed change ---------- */

function listOf(value, field) {
  const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(/\n/);
  const items = [...new Set(raw.map(oneLine).filter(Boolean))];
  if (items.length > MAX_ITEMS) throw new ChangeError(`${EDITABLE[field]}: at most ${MAX_ITEMS}.`);
  items.forEach((v) => { if (v.length > (LIMITS[field] || 200)) throw new ChangeError(`${EDITABLE[field]}: "${v.slice(0, 40)}..." is too long.`); });
  return items;
}

/* Turns what the panel sent into a change, or says what is wrong with it. */
function normalise(state, input) {
  const c = input || {};
  const get = (id, what) => {
    const m = state.members.get(String(id || ''));
    if (!m) throw new ChangeError(`${what || 'That person'} is not in the list. Refresh and try again.`, 'NOT_FOUND');
    return m;
  };
  if (c.op === 'edit') {
    const m = get(c.id);
    const set = {};
    const given = c.set || {};
    Object.keys(given).forEach((field) => {
      if (!EDITABLE[field]) throw new ChangeError(`${field} cannot be changed here.`);
      let value;
      if (field === 'name') {
        value = oneLine(given.name);
        if (!/[A-Za-z]/.test(value) || value.length < 2) throw new ChangeError('Name: write the person\'s name.');
        if (value.length > LIMITS.name) throw new ChangeError('Name: too long.');
      } else if (field === 'mobiles') {
        value = listOf(given.mobiles, field).map((v) => {
          const mobile = O.mobileOf(v);
          if (!mobile) throw new ChangeError(`Mobile: "${v}" is not a 10-digit Indian mobile number.`);
          return O.showMobile(mobile);
        });
        value = [...new Set(value)];
      } else if (field === 'emails') {
        value = listOf(given.emails, field);
        value.forEach((e) => { if (!/^[^\s@]+@[^\s@]+$/.test(e)) throw new ChangeError(`Email: "${e}" is not an email address.`); });
      } else {
        value = listOf(given[field], field);
      }
      const now = field === 'emails' ? (m.emails || []).map((e) => e.email) : m[field];
      if (JSON.stringify(now) !== JSON.stringify(value)) set[field] = value;
    });
    if (!Object.keys(set).length) throw new ChangeError('Nothing is different from what is there now.', 'NO_CHANGE');
    return { op: 'edit', id: m.id, set };
  }
  if (c.op === 'merge') {
    const keep = get(c.keep, 'The person to keep');
    const absorb = get(c.absorb, 'The person to join in');
    if (keep.id === absorb.id) throw new ChangeError('Choose two different people.');
    return { op: 'merge', keep: keep.id, absorb: absorb.id };
  }
  if (c.op === 'split') {
    const m = get(c.id);
    const row = (m.rows || []).find((r) => r.list === c.list && Number(r.row) === Number(c.row));
    if (!row) throw new ChangeError('That row is not part of this person.');
    if (m.rows.length < 2) throw new ChangeError('This person has only one row; there is nothing to take out.');
    return { op: 'split', id: m.id, list: row.list, row: row.row };
  }
  if (c.op === 'resolve') {
    const a = get(c.a); const b = get(c.b);
    if (a.id === b.id) throw new ChangeError('Choose two different people.');
    if (state.resolved.has(pairKey(a.id, b.id))) throw new ChangeError('These two are already marked as different people.', 'NO_CHANGE');
    return { op: 'resolve', a: a.id, b: b.id };
  }
  throw new ChangeError('Choose what to change.');
}

/* Contacts a change would leave on two people: shown before confirming. */
function warnings(state, change, after) {
  const out = [];
  if (change.op !== 'edit') return out;
  const mine = after[0];
  for (const other of state.members.values()) {
    if (other.id === mine.id) continue;
    (mine.mobiles || []).forEach((x) => { if ((other.mobiles || []).includes(x)) out.push(`The mobile ${x} is also on ${other.name}.`); });
    (mine.emails || []).forEach((x) => { const k = O.emailKey(x); if (k && (other.emails || []).some((e) => O.emailKey(e.email) === k)) out.push(`The email ${x} is also on ${other.name}.`); });
  }
  return [...new Set(out)];
}

/* A plain sentence for the history. */
function summary(change, before, after) {
  const b = before || []; const a = after || [];
  if (change.op === 'edit') return `Changed ${Object.keys(change.set).map((f) => EDITABLE[f].toLowerCase()).join(', ')} of ${b[0] ? b[0].name : change.id}`;
  if (change.op === 'merge') return `Joined ${b[1] ? b[1].name : change.absorb} into ${b[0] ? b[0].name : change.keep}, as one person`;
  if (change.op === 'split') return `Took ${change.list} row ${change.row}${a[1] ? ' (' + a[1].name + ')' : ''} out of ${b[0] ? b[0].name : change.id}, as a person of their own`;
  if (change.op === 'resolve') return `Marked ${b[0] ? b[0].name : change.a} and ${b[1] ? b[1].name : change.b} as two different people`;
  return 'Change';
}

/* The list as it stands: the import with every change replayed, in order. */
function replay(members, changes) {
  const state = startState(members);
  const results = [];
  (changes || []).forEach((ch) => {
    const r = apply(state, ch.change || ch);
    results.push({ seq: ch.seq, applied: !r.skipped, skipped: r.skipped || '' });
  });
  return { state, results };
}

function currentReview(review, state) {
  return (review || []).filter((p) => {
    const [a, b] = p.people.map((x) => x.id);
    return state.members.has(a) && state.members.has(b) && !state.resolved.has(pairKey(a, b));
  }).map((p) => Object.assign({}, p, { people: p.people.map((x) => {
    const m = state.members.get(x.id);
    return Object.assign({}, x, { name: m.name, mobiles: m.mobiles, emails: (m.emails || []).map((e) => e.email), lists: m.lists, numbers: (m.numbers || []).map((n) => n.number) });
  }) }));
}

module.exports = { checkReason, normalise, apply, replay, summary, warnings, snapshot, startState, currentReview, ChangeError, EDITABLE, pairKey };
