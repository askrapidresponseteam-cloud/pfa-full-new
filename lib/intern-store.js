'use strict';

/* The internship portal's records (lib/internship.js says what they are for).

   intern_batches/{batchId}        a batch: its start Monday and its plan
   interns/{internId}              an intern: who, which batch, the key's hash,
                                   lockout counts, electives, referral counts
   intern_codes/{code}             a referral code, once (create-only)
   intern_onboard/{sha(token)}     an onboarding link, until used or expired
   intern_sessions/{sha(token)}    a signed-in browser, until it ends
   intern_work/{internId}__{task}  one task's proof, review and history
   intern_files/{fileId}           one uploaded file (bytes in Storage)
   intern_usage/all                files and bytes kept, for the limits
   intern_reminders/{batch}__w{n}  the end-of-week reminder's log

   Nothing here deletes: a session ends with endedAt, an onboarding link
   with usedAt or a newer one, a file is emptied with file-store drop(). */

const crypto = require('crypto');
const I = require('./internship');

const DEFAULT_SITE = 'https://peopleforanimalsindia.org';
function publicSite() {
  try { const u = new URL(String(process.env.PFA_PUBLIC_SITE_URL || '').trim()); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* default */ }
  return DEFAULT_SITE;
}
function dashboardUrl() { return `${publicSite()}/intern.html`; }
function onboardUrl(token) { return `${publicSite()}/intern.html#onboard=${encodeURIComponent(token)}`; }

const nowIso = (ms) => new Date(ms == null ? Date.now() : ms).toISOString();
const workId = (internId, taskKey) => `${internId}__${taskKey}`;

function fail(code, message, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status || 400;
  return e;
}

/* ---- mail, sent now when it can be, queued otherwise -------------------- */

/* scrub: once the email has gone, the queued copy's link is blanked, so the
   only place a live onboarding link is kept is the intern's inbox */
async function scrubLink(emailId) {
  try {
    await require('./firebase').getDb().collection('caregiverEmails').doc(emailId).set({ payload: { link: '' }, linkScrubbedAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    console.warn('internship mail: link not scrubbed from the queue', error && error.message);
  }
}

async function mailNow({ template, to, payload, dedupeKey, mail, queue, scrub }) {
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  try {
    const configured = sender.isConfigured();
    const queued = await store.queueEmail({ template, to, payload, dedupeKey, claim: configured ? 'internship' : undefined });
    if (!queued.created) return { sent: queued.status === 'sent', queued: true, emailId: queued.emailId };
    if (!configured) return { sent: false, queued: true, emailId: queued.emailId };
    try {
      const done = await sender.deliver({ to, template, payload });
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: done.providerId });
      if (scrub) await scrubLink(queued.emailId);
      return { sent: true, queued: true, emailId: queued.emailId };
    } catch (error) {
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
      return { sent: false, queued: true, emailId: queued.emailId, error: I.clean(error && error.message, 200) };
    }
  } catch (error) {
    console.warn('internship mail not queued', template, error && error.message);
    return { sent: false, queued: false, error: I.clean(error && error.message, 200) };
  }
}

/* ---- batches ------------------------------------------------------------ */

async function getBatch(db, batchId) {
  const snap = await db.collection('intern_batches').doc(String(batchId || '')).get();
  return snap.exists ? Object.assign({ batchId: snap.id }, snap.data()) : null;
}

async function listBatches(db) {
  const snap = await db.collection('intern_batches').get();
  return (snap.docs || []).map((d) => Object.assign({ batchId: d.id }, d.data())).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
}

async function saveBatch(db, input, by, nowMs = Date.now()) {
  const name = I.clean(input.name, 80);
  const start = I.clean(input.startDate, 10);
  const startMs = I.dayStart(start);
  if (!name) throw fail('BAD_BATCH', 'Give the batch a name.');
  if (!Number.isFinite(startMs) || I.istDay(startMs).dow !== 1) throw fail('BAD_BATCH', 'A batch starts on a Monday.');
  const plan = I.cleanPlan(input.plan || input);
  const status = input.status === 'closed' ? 'closed' : 'open';
  let batchId = I.clean(input.batchId, 40);
  if (batchId) {
    const ref = db.collection('intern_batches').doc(batchId);
    const snap = await ref.get();
    if (!snap.exists) throw fail('NO_BATCH', 'That batch is not on record.', 404);
    await ref.set(Object.assign({ name, startDate: start, status, updatedAt: nowIso(nowMs), updatedBy: by }, plan), { merge: true });
  } else {
    const base = `B-${start}`;
    batchId = base;
    for (let n = 2; (await db.collection('intern_batches').doc(batchId).get()).exists; n += 1) batchId = `${base}-${n}`;
    await db.collection('intern_batches').doc(batchId).create(Object.assign({ batchId, name, startDate: start, status, createdAt: nowIso(nowMs), createdBy: by }, plan));
  }
  return getBatch(db, batchId);
}

/* ---- interns ------------------------------------------------------------ */

async function getIntern(db, internId) {
  if (!I.INTERN_ID.test(String(internId || ''))) return null;
  const snap = await db.collection('interns').doc(internId).get();
  return snap.exists ? Object.assign({ internId: snap.id }, snap.data()) : null;
}

async function listInterns(db, batchId) {
  const q = batchId ? db.collection('interns').where('batchId', '==', batchId) : db.collection('interns');
  const snap = await q.get();
  return (snap.docs || []).map((d) => Object.assign({ internId: d.id }, d.data()));
}

/* A new onboarding link for an intern: the old one, if any, stops working. */
async function newOnboarding(db, internId, nowMs) {
  const token = I.newToken();
  const hash = I.sha(token);
  const expiresAt = nowIso(nowMs + I.LIMITS.onboardDays * I.DAY);
  await db.collection('intern_onboard').doc(hash).create({ internId, createdAt: nowIso(nowMs), expiresAt });
  return { token, hash, expiresAt };
}

/* Approve (owner, 5 Nov 2026): the intern is made, active at once, with the
   email, mobile and date of birth they sign in with, and emailed that the
   internship has started. Nobody signs in before this. */
/* The batch an approval goes into when the admin names none (owner, 7 Nov
   2026: an application waiting in the panel has to be approvable in one
   click, so the person can sign in with their three details): the newest
   open batch that has not ended, else a new one, named for its month, that
   starts on the coming Monday (today, on a Monday) with the standard plan. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
async function batchForApproval(db, by, nowMs = Date.now()) {
  const live = (await listBatches(db)).find((b) => b.status !== 'closed' && I.currentWeek(b, nowMs) <= (b.weeks || []).length);
  if (live) return live;
  const today = I.istDay(nowMs);
  const startMs = I.dayStart(I.ymdOf(nowMs)) + ((8 - today.dow) % 7) * I.DAY;
  const start = I.istDay(startMs);
  return saveBatch(db, Object.assign({ name: `${MONTH_NAMES[start.m - 1]} ${start.y}`, startDate: I.ymdOf(startMs), status: 'open' }, I.defaultPlan()), by, nowMs);
}

async function issueIntern(db, input, by, nowMs = Date.now(), deps = {}) {
  const name = require('../assets/field-rules.js').nameCase(I.clean(input.name, 120));
  const email = I.emailOf(input.email);
  const mobile = I.mobileOf(input.mobile);
  const dob = I.dobOf(input.dob, nowMs);
  if (!name) throw fail('BAD_INTERN', 'Add the intern\'s name.');
  if (!email) throw fail('BAD_INTERN', 'Add the intern\'s email.');
  if (!mobile) throw fail('BAD_INTERN', 'Add the intern\'s 10-digit mobile number: they sign in with it.');
  if (!dob) throw fail('BAD_INTERN', 'Add the intern\'s date of birth: they sign in with it.');
  if (I.clean(input.batchId, 40) && !(await getBatch(db, input.batchId))) throw fail('NO_BATCH', 'That batch is not on record. Choose another, or leave it empty to use the open one.');
  const applicationRef = I.clean(input.applicationRef, 40).toUpperCase();
  if (applicationRef) {
    const dup = await db.collection('interns').where('applicationRef', '==', applicationRef).get();
    if ((dup.docs || []).some((d) => (d.data() || {}).status !== 'revoked')) throw fail('ALREADY_ISSUED', `${applicationRef} is already approved.`, 409);
  }
  /* one place per email: the email is what finds them at sign-in */
  const same = await db.collection('interns').where('email', '==', email).get();
  const holder = (same.docs || []).map((d) => Object.assign({ internId: d.id }, d.data())).find((d) => d.status !== 'revoked' && d.status !== 'reserving');
  if (holder) throw fail('ALREADY_ISSUED', `${email} is already an intern (${holder.internId}). Withdraw that one first, or use another email.`, 409);
  const batch = I.clean(input.batchId, 40) ? await getBatch(db, input.batchId) : await batchForApproval(db, by, nowMs);
  /* an ID and a referral code nobody has, each claimed with create() */
  let internId = '';
  for (let i = 0; i < 6 && !internId; i += 1) {
    const id = I.newInternId();
    try { await db.collection('interns').doc(id).create({ internId: id, status: 'reserving', createdAt: nowIso(nowMs) }); internId = id; } catch (_) { /* taken; another */ }
  }
  let referralCode = '';
  for (let i = 0; i < 6 && !referralCode; i += 1) {
    const code = I.newReferralCode();
    try { await db.collection('intern_codes').doc(code).create({ code, internId, createdAt: nowIso(nowMs) }); referralCode = code; } catch (_) { /* taken; another */ }
  }
  if (!internId || !referralCode) throw fail('NOT_ISSUED', 'An ID could not be made just now. Try again.', 503);
  const intern = {
    internId, name, email, batchId: batch.batchId, applicationRef, referralCode,
    /* they sign in with these three; the mobile hash is the self-referral check */
    mobile, dob,
    mobileHash: I.mobileHash(mobile),
    status: 'active', keyHash: '', keyVersion: 1, fails: 0, lockCount: 0, lockedUntil: '',
    onboardHash: '', onboardExpiresAt: '',
    electives: [], referral: null,
    createdAt: nowIso(nowMs), createdBy: by, approvedAt: nowIso(nowMs), approvedBy: by,
    log: [{ at: nowIso(nowMs), by, what: 'approved' }]
  };
  await db.collection('interns').doc(internId).set(intern);
  /* the code is registered with the RRT, so its link works at once; if the
     RRT cannot be reached it is registered on the next refresh */
  try { await require('./rrt-referrals').register(db, intern, deps); } catch (_) { /* retried later */ }
  const mailed = await mailNow({
    template: 'intern_start', to: email, dedupeKey: `${internId}:start`,
    payload: { name, batchName: batch.name, startDate: batch.startDate, internId, mobileEnd: mobile.slice(-4), link: dashboardUrl(), siteUrl: publicSite() },
    mail: deps.mail, queue: deps.queue
  });
  return { intern, mailed };
}

/* The sign-in details, corrected by PFA (a typing slip in the application,
   a new email or number, or an intern from before 5 Nov 2026 who had only
   an access key). Every session ends; the intern signs in with the new
   three. */
async function setDetails(db, internId, input, by, nowMs = Date.now()) {
  const intern = await getIntern(db, internId);
  if (!intern || intern.status === 'reserving') throw fail('NO_INTERN', 'That intern is not on record.', 404);
  if (intern.status === 'revoked') throw fail('REVOKED', 'Access for this intern was withdrawn.', 409);
  const email = I.emailOf(input.email);
  const mobile = I.mobileOf(input.mobile);
  const dob = I.dobOf(input.dob, nowMs);
  if (!email) throw fail('BAD_DETAILS', 'Add a valid email.');
  if (!mobile) throw fail('BAD_DETAILS', 'Add a 10-digit Indian mobile number.');
  if (!dob) throw fail('BAD_DETAILS', 'Add the date of birth.');
  if (email !== intern.email) {
    const same = await db.collection('interns').where('email', '==', email).get();
    const holder = (same.docs || []).find((d) => d.id !== intern.internId && !['revoked', 'reserving'].includes((d.data() || {}).status));
    if (holder) throw fail('TAKEN', `${email} is already used by ${holder.id}.`, 409);
  }
  const what = [email !== intern.email ? 'email' : '', mobile !== I.mobileOf(intern.mobile) ? 'mobile' : '', dob !== intern.dob ? 'date of birth' : ''].filter(Boolean);
  await db.collection('interns').doc(intern.internId).set({
    email, mobile, dob, mobileHash: I.mobileHash(mobile), status: 'active', onboardHash: '',
    keyVersion: (Number(intern.keyVersion) || 0) + 1, fails: 0, lockCount: 0, lockedUntil: '',
    log: (intern.log || []).slice(-40).concat([{ at: nowIso(nowMs), by, what: 'sign-in details', note: what.length ? `changed: ${what.join(', ')}` : 'set again' }])
  }, { merge: true });
  return { internId: intern.internId, changed: what };
}

async function revoke(db, internId, reason, by, nowMs = Date.now()) {
  const ref = db.collection('interns').doc(internId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NO_INTERN', 'That intern is not on record.', 404);
    const d = snap.data() || {};
    tx.set(ref, {
      status: 'revoked', keyVersion: (Number(d.keyVersion) || 0) + 1, onboardHash: '', revokedAt: nowIso(nowMs), revokedBy: by,
      log: (d.log || []).slice(-40).concat([{ at: nowIso(nowMs), by, what: 'revoked', note: I.clean(reason, 200) }])
    }, { merge: true });
    return true;
  });
}

/* A new key, after PFA has checked who is asking: the old key and every
   session stop at once; a new onboarding link is emailed. */
async function regenerate(db, internId, verifiedHow, by, nowMs = Date.now(), deps = {}) {
  const how = I.clean(verifiedHow, 300);
  if (how.length < 8) throw fail('NOT_VERIFIED', 'Say how you verified the intern (a call to the number they applied with, a video call, in person).');
  const intern = await getIntern(db, internId);
  if (!intern) throw fail('NO_INTERN', 'That intern is not on record.', 404);
  const onboarding = await newOnboarding(db, internId, nowMs);
  await db.collection('interns').doc(internId).set({
    status: 'invited', keyHash: '', keyVersion: (Number(intern.keyVersion) || 0) + 1, fails: 0, lockCount: 0, lockedUntil: '',
    onboardHash: onboarding.hash, onboardExpiresAt: onboarding.expiresAt,
    log: (intern.log || []).slice(-40).concat([{ at: nowIso(nowMs), by, what: 'new key', note: how }])
  }, { merge: true });
  const batch = await getBatch(db, intern.batchId);
  const mailed = await mailNow({
    template: 'intern_welcome', to: intern.email, dedupeKey: `${internId}:${onboarding.hash.slice(0, 12)}`,
    payload: { name: intern.name, batchName: (batch && batch.name) || '', startDate: (batch && batch.startDate) || '', link: onboardUrl(onboarding.token), expiresAt: onboarding.expiresAt, again: true, siteUrl: publicSite() },
    mail: deps.mail, queue: deps.queue, scrub: true
  });
  return { onboardUrl: onboardUrl(onboarding.token), mailed };
}

/* ---- onboarding: the key, shown once ------------------------------------ */

async function onboard(db, token, nowMs = Date.now()) {
  const raw = String(token || '');
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(raw)) throw fail('BAD_LINK', 'This link is not complete. Open it from the email again.', 400);
  const hash = I.sha(raw);
  const key = I.newKey();
  const keyHash = I.hashKey(key);
  const linkRef = db.collection('intern_onboard').doc(hash);
  const result = await db.runTransaction(async (tx) => {
    const link = await tx.get(linkRef);
    if (!link.exists) throw fail('BAD_LINK', 'This link is not one PFA sent, or it has been replaced by a newer one.', 404);
    const l = link.data() || {};
    if (l.usedAt) throw fail('USED_LINK', 'This link has been used. Sign in with your Intern ID and access key. Lost the key? Ask PFA for a new one.', 410);
    if (Date.parse(l.expiresAt) < nowMs) throw fail('OLD_LINK', 'This link has expired. Ask PFA for a new one.', 410);
    const ref = db.collection('interns').doc(l.internId);
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (!d || d.status === 'revoked' || d.onboardHash !== hash) throw fail('BAD_LINK', 'This link has been replaced by a newer one, or access was withdrawn.', 410);
    const keyVersion = (Number(d.keyVersion) || 0) + 1;
    tx.set(linkRef, { usedAt: nowIso(nowMs) }, { merge: true });
    tx.set(ref, {
      status: 'active', keyHash, keyVersion, keySetAt: nowIso(nowMs), onboardHash: '', fails: 0, lockCount: 0, lockedUntil: '',
      log: (d.log || []).slice(-40).concat([{ at: nowIso(nowMs), by: 'intern', what: 'key set' }])
    }, { merge: true });
    return { internId: l.internId, keyVersion };
  });
  const session = await startSession(db, result.internId, result.keyVersion, nowMs);
  return { internId: result.internId, key, session };
}

/* ---- signing in --------------------------------------------------------- */

async function signIn(db, internId, key, nowMs = Date.now()) {
  const id = I.internIdOf(internId);
  const k = I.keyOf(key);
  const ref = I.INTERN_ID.test(id) ? db.collection('interns').doc(id) : null;
  const snap = ref ? await ref.get() : null;
  const d = snap && snap.exists ? snap.data() || {} : null;
  if (d && d.lockedUntil && Date.parse(d.lockedUntil) > nowMs) {
    I.keyMatches('', ''); // the same time spent as a check
    throw fail('LOCKED', `Too many wrong keys. Try again after ${new Date(d.lockedUntil).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}, India time.`, 429);
  }
  const ok = Boolean(d) && d.status === 'active' && I.keyMatches(k, d.keyHash);
  if (!d) { I.keyMatches(k, ''); throw fail('NO_MATCH', 'That Intern ID and key do not match.', 401); }
  if (!ok) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const x = s.data() || {};
      const fails = (Number(x.fails) || 0) + 1;
      const patch = { fails, lastFailAt: nowIso(nowMs) };
      if (fails >= I.LOCK.after) {
        /* each lock doubles the next, until a day passes without one */
        const fresh = x.lockedUntil && nowMs - Date.parse(x.lockedUntil) > I.DAY;
        const lockCount = (fresh ? 0 : Number(x.lockCount) || 0) + 1;
        patch.lockCount = lockCount;
        patch.fails = 0;
        patch.lockedUntil = nowIso(nowMs + Math.min(I.LOCK.baseMs * 2 ** (lockCount - 1), I.LOCK.maxMs));
      }
      tx.set(ref, patch, { merge: true });
    });
    if (d.status === 'revoked') throw fail('REVOKED', 'Access for this Intern ID has been withdrawn. Write to PFA if this is a mistake.', 403);
    if (d.status === 'invited') throw fail('NOT_SET', 'This Intern ID has no key yet. Open the link PFA emailed you to get it.', 401);
    throw fail('NO_MATCH', 'That Intern ID and key do not match.', 401);
  }
  await ref.set({ fails: 0, lastSignInAt: nowIso(nowMs) }, { merge: true });
  return startSession(db, id, Number(d.keyVersion) || 0, nowMs);
}

/* A wrong try, counted on the intern: five in a row rest the sign-in,
   each rest doubling, until a day passes without one. */
async function countMiss(db, ref, nowMs) {
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const x = s.data() || {};
    const fails = (Number(x.fails) || 0) + 1;
    const patch = { fails, lastFailAt: nowIso(nowMs) };
    if (fails >= I.LOCK.after) {
      const fresh = x.lockedUntil && nowMs - Date.parse(x.lockedUntil) > I.DAY;
      const lockCount = (fresh ? 0 : Number(x.lockCount) || 0) + 1;
      patch.lockCount = lockCount;
      patch.fails = 0;
      patch.lockedUntil = nowIso(nowMs + Math.min(I.LOCK.baseMs * 2 ** (lockCount - 1), I.LOCK.maxMs));
    }
    tx.set(ref, patch, { merge: true });
  });
}

/* Sign in with the email, mobile and date of birth (owner, 5 Nov 2026: "no
   otp. just the right combi should allow the person inside"). The email
   finds the intern; the mobile and the date of birth must both match. The
   answer never says which of the three was wrong. */
const NO_MATCH_SAY = 'These details do not match an approved intern. Use the email, mobile number and date of birth you applied with. Applied but not approved yet? You can sign in once PFA emails you that your internship has started.';
async function signInWith(db, input, nowMs = Date.now()) {
  const email = I.emailOf(input && input.email);
  const mobile = I.mobileOf(input && input.mobile);
  const dob = I.dobOf(input && input.dob, nowMs);
  if (!email || !mobile || !dob) throw fail('INCOMPLETE', 'Fill in all three: your email, your 10-digit mobile number and your date of birth.', 400);
  const snap = await db.collection('interns').where('email', '==', email).get();
  const all = (snap.docs || []).map((d) => ({ ref: d.ref || db.collection('interns').doc(d.id), d: Object.assign({ internId: d.id }, d.data()) }))
    .filter((x) => x.d.status !== 'reserving');
  const live = all.filter((x) => x.d.status !== 'revoked');
  const locked = live.find((x) => x.d.lockedUntil && Date.parse(x.d.lockedUntil) > nowMs);
  if (locked) {
    throw fail('LOCKED', `Too many tries that did not match. Try again after ${new Date(locked.d.lockedUntil).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}, India time.`, 429);
  }
  const fits = (x) => I.same(I.mobileOf(x.d.mobile), mobile) && I.same(x.d.dob, dob);
  const hit = live.find((x) => x.d.status === 'active' && fits(x));
  if (!hit) {
    for (const x of live) await countMiss(db, x.ref, nowMs);
    if (!live.length && all.some(fits)) throw fail('REVOKED', 'Access for this internship was withdrawn. Write to PFA if this is a mistake.', 403);
    throw fail('NO_MATCH', NO_MATCH_SAY, 401);
  }
  await hit.ref.set({ fails: 0, lastSignInAt: nowIso(nowMs) }, { merge: true });
  return startSession(db, hit.d.internId, Number(hit.d.keyVersion) || 0, nowMs);
}

async function startSession(db, internId, keyVersion, nowMs) {
  const token = I.newToken();
  const expiresAt = nowIso(nowMs + I.LIMITS.sessionDays * I.DAY);
  await db.collection('intern_sessions').doc(I.sha(token)).create({ internId, keyVersion, createdAt: nowIso(nowMs), expiresAt, endedAt: '' });
  return { token, expiresAt, maxAge: I.LIMITS.sessionDays * 86400 };
}

/* The intern behind a session token, or null. */
async function whoIs(db, token, nowMs = Date.now()) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(String(token || ''))) return null;
  const snap = await db.collection('intern_sessions').doc(I.sha(token)).get();
  if (!snap.exists) return null;
  const s = snap.data() || {};
  if (s.endedAt || Date.parse(s.expiresAt) < nowMs) return null;
  const intern = await getIntern(db, s.internId);
  if (!intern || intern.status !== 'active' || Number(intern.keyVersion) !== Number(s.keyVersion)) return null;
  return intern;
}

async function endSession(db, token, nowMs = Date.now()) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(String(token || ''))) return;
  const ref = db.collection('intern_sessions').doc(I.sha(token));
  const snap = await ref.get();
  if (snap.exists) await ref.set({ endedAt: nowIso(nowMs) }, { merge: true });
}

/* ---- electives ---------------------------------------------------------- */

async function chooseElectives(db, intern, batch, keys, nowMs = Date.now()) {
  const want = Array.from(new Set((Array.isArray(keys) ? keys : []).map((k) => String(k))));
  const electives = (batch.tasks || []).filter((t) => t.kind === 'elective').map((t) => t.key);
  const n = Number(batch.electivesRequired) || 0;
  if (want.length !== n || want.some((k) => !electives.includes(k))) throw fail('BAD_CHOICE', `Choose ${n} of the electives.`);
  /* one already sent for cannot be dropped */
  const works = await listWorks(db, intern.internId);
  const started = works.filter((w) => electives.includes(w.taskKey)).map((w) => w.taskKey);
  const dropped = started.filter((k) => !want.includes(k));
  if (dropped.length) throw fail('BAD_CHOICE', 'An elective you have sent proof for stays chosen.');
  await db.collection('interns').doc(intern.internId).set({ electives: want, electivesAt: nowIso(nowMs) }, { merge: true });
  return want;
}

/* ---- files -------------------------------------------------------------- */

async function usage(db) {
  const snap = await db.collection('intern_usage').doc('all').get();
  const d = snap.exists ? snap.data() || {} : {};
  return { files: Number(d.files) || 0, bytes: Number(d.bytes) || 0, submissions: Number(d.submissions) || 0, refused: Number(d.refused) || 0, updatedAt: d.updatedAt || '' };
}

async function count(db, patch, nowMs) {
  const ref = db.collection('intern_usage').doc('all');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : {};
    const next = { updatedAt: nowIso(nowMs) };
    for (const [k, v] of Object.entries(patch)) next[k] = (Number(d[k]) || 0) + v;
    tx.set(ref, next, { merge: true });
  });
}

async function saveFile(db, intern, { taskKey, name, type, data }, nowMs = Date.now(), deps = {}) {
  const bytes = Buffer.from(String(data || ''), 'base64');
  if (!bytes.length) throw fail('NO_FILE', 'Choose a file.');
  if (bytes.length > I.LIMITS.fileBytes) throw fail('TOO_LARGE', `A file can be up to ${Math.round(I.LIMITS.fileBytes / 1048576)} MB. Send a larger one as a link (Google Drive, YouTube).`, 413);
  const t = I.fileTypeOf(type, bytes);
  if (!t) throw fail('BAD_TYPE', 'Send a photograph (JPG, PNG, WebP) or a PDF. Anything else, as a link.', 415);
  const u = await usage(db);
  if (u.bytes + bytes.length > I.LIMITS.bytesInAll) {
    await count(db, { refused: 1 }, nowMs);
    throw fail('FULL', 'The portal has no room for files just now. Send it as a link; PFA has been told.', 507);
  }
  const mine = await db.collection('intern_files').where('internId', '==', intern.internId).get();
  const kept = (mine.docs || []).map((d) => d.data() || {}).filter((f) => !f.droppedAt && !f.unused);
  if (kept.length >= I.LIMITS.filesPerIntern || kept.reduce((s, f) => s + (Number(f.size) || 0), 0) + bytes.length > I.LIMITS.bytesPerIntern) {
    throw fail('YOUR_LIMIT', 'You have sent as many files as the portal keeps for one intern. Send the rest as links.', 413);
  }
  const fileId = `${intern.internId}-${crypto.randomBytes(6).toString('hex')}`;
  const store = deps.fileStore || require('./file-store');
  const where = await store.put(`interns/${intern.internId}/${fileId}`, bytes, t);
  if (where.bytes && bytes.length > I.LIMITS.firestoreFileBytes) {
    await count(db, { refused: 1 }, nowMs);
    throw fail('NO_STORAGE', 'Files over 900 KB need PFA\'s file storage, which is not on yet. Send this one as a link (Google Drive, YouTube).', 507);
  }
  const record = Object.assign({
    fileId, internId: intern.internId, batchId: intern.batchId, taskKey: I.clean(taskKey, 24),
    name: I.clean(name, 120) || `file.${I.TYPES[t]}`, type: t, size: bytes.length, createdAt: nowIso(nowMs), unused: true
  }, where);
  await db.collection('intern_files').doc(fileId).create(record);
  await count(db, { files: 1, bytes: bytes.length }, nowMs);
  return { id: fileId, name: record.name, type: t, size: bytes.length };
}

async function readFile(db, fileId, internId) {
  const snap = await db.collection('intern_files').doc(String(fileId || '')).get();
  if (!snap.exists) return null;
  const f = snap.data() || {};
  if (internId && f.internId !== internId) return null;
  const bytes = await require('./file-store').read(f);
  return bytes ? { name: f.name, type: f.type, bytes } : null;
}

/* ---- work --------------------------------------------------------------- */

async function listWorks(db, internId) {
  const snap = await db.collection('intern_work').where('internId', '==', internId).get();
  return (snap.docs || []).map((d) => d.data() || {});
}

async function submitWork(db, intern, batch, input, nowMs = Date.now()) {
  const task = (batch.tasks || []).find((t) => t.key === String(input.taskKey || ''));
  if (!task) throw fail('NO_TASK', 'Choose the task.');
  if (task.kind === 'elective' && !(intern.electives || []).includes(task.key)) throw fail('NOT_CHOSEN', 'Choose this elective first.');
  if (require('./intern-quiz').isQuizTask(task)) throw fail('QUIZ', 'This task is passed by the quiz. Take it from your dashboard.', 409);
  /* shelter work: the place first (lib/intern-shelters.js), and the hours with the proof */
  const SH = require('./intern-shelters');
  let hours = null;
  if (SH.isShelterTask(task)) {
    const blocked = await SH.proofBlocked(db, intern.internId);
    if (blocked) throw fail('NO_PLACE', blocked, 409);
    hours = Math.round(Number(input.hours) * 2) / 2;
    if (!(hours >= 1 && hours <= 500)) throw fail('NO_HOURS', 'Type how many hours you did there.');
  }
  if (I.currentWeek(batch, nowMs) < 1) throw fail('NOT_STARTED', `Your internship starts on ${I.dayLabel(I.dayStart(batch.startDate))}.`);
  const links = I.cleanLinks(input.links);
  if (links.error) throw fail('BAD_LINK', links.error);
  const note = I.cleanBlock(input.note, I.LIMITS.noteChars);
  const fileIds = Array.from(new Set((Array.isArray(input.files) ? input.files : []).map(String))).slice(0, I.LIMITS.filesPerTask + 1);
  if (fileIds.length > I.LIMITS.filesPerTask) throw fail('TOO_MANY', `Up to ${I.LIMITS.filesPerTask} files for one task.`);
  const files = [];
  for (const id of fileIds) {
    const snap = await db.collection('intern_files').doc(id).get();
    const f = snap.exists ? snap.data() || {} : null;
    if (!f || f.internId !== intern.internId) throw fail('BAD_FILE', 'A file in this proof is not one you sent.');
    files.push({ id, name: f.name, type: f.type, size: f.size });
  }
  if (!links.links.length && !files.length && !(task.auto && note)) throw fail('NO_PROOF', 'Add a link or a file as proof.');
  const ref = db.collection('intern_work').doc(workId(intern.internId, task.key));
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const w = snap.exists ? snap.data() || {} : null;
    if (w && w.state === 'accepted') throw fail('DONE', 'This task has been accepted. Nothing more is needed.', 409);
    if (w && w.state === 'submitted') {
      /* still waiting: the proof can be added to, not reviewed twice */
    }
    const round = w ? (w.state === 'revise' ? (Number(w.round) || 1) + 1 : Number(w.round) || 1) : 1;
    const record = {
      internId: intern.internId, batchId: batch.batchId, taskKey: task.key, state: 'submitted', round,
      links: links.links, note, files, submittedAt: nowIso(nowMs), late: nowMs > I.weekBounds(batch, I.dueWeekOf(task)).due,
      ...(hours != null ? { hours } : {}),
      history: ((w && w.history) || []).slice(-30).concat([{ at: nowIso(nowMs), by: 'intern', state: 'submitted', note: w && w.state === 'revise' ? `Revision ${round}` : '' }])
    };
    if (w) { record.score = w.score != null ? w.score : null; record.feedback = w.feedback || ''; }
    tx.set(ref, record, { merge: true });
    return record;
  });
  for (const f of files) await db.collection('intern_files').doc(f.id).set({ unused: false, taskKey: task.key }, { merge: true });
  await count(db, { submissions: 1 }, nowMs);
  return out;
}

async function review(db, { internId, taskKey, decision, score, feedback }, by, nowMs = Date.now(), deps = {}) {
  const ref = db.collection('intern_work').doc(workId(internId, taskKey));
  const say = I.cleanBlock(feedback, 1500);
  const s = score === '' || score == null ? null : Math.round(Number(score) * 2) / 2;
  if (decision !== 'accept' && decision !== 'revise') throw fail('BAD_DECISION', 'Accept it, or ask for a revision.');
  if (decision === 'accept' && (s == null || !(s >= 0 && s <= 10))) throw fail('BAD_SCORE', 'Give a score from 0 to 10.');
  if (decision === 'revise' && say.length < 5) throw fail('NO_FEEDBACK', 'Say what needs to change.');
  const state = decision === 'accept' ? 'accepted' : 'revise';
  const w = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NO_WORK', 'Nothing has been sent for this task.', 404);
    const d = snap.data() || {};
    const patch = {
      state, score: s, feedback: say, reviewedAt: nowIso(nowMs), reviewedBy: by,
      history: (d.history || []).slice(-30).concat([{ at: nowIso(nowMs), by, state, note: say, score: s }])
    };
    tx.set(ref, patch, { merge: true });
    return Object.assign({}, d, patch);
  });
  const intern = await getIntern(db, internId);
  const batch = intern ? await getBatch(db, intern.batchId) : null;
  const task = batch ? (batch.tasks || []).find((t) => t.key === taskKey) : null;
  if (intern && intern.email) {
    await mailNow({
      template: 'intern_feedback', to: intern.email, dedupeKey: `${internId}:${taskKey}:${w.history.length}`,
      payload: { name: intern.name, task: (task && task.title) || taskKey, state, score: s, feedback: say, link: dashboardUrl(), siteUrl: publicSite() },
      mail: deps.mail, queue: deps.queue
    });
  }
  return w;
}

async function reviewQueue(db) {
  const snap = await db.collection('intern_work').where('state', '==', 'submitted').get();
  return (snap.docs || []).map((d) => d.data() || {}).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
}

/* ---- retention ---------------------------------------------------------- */

/* Files of a batch that ended more than retentionDays ago are emptied
   (never deleted); the work records stay. A few at a time, each run. */
async function sweep(db, nowMs = Date.now(), limit = 20) {
  const batches = await listBatches(db);
  let emptied = 0;
  for (const b of batches) {
    const ends = I.weekBounds(b, (b.weeks || []).length || 8).to;
    if (nowMs < ends + I.LIMITS.retentionDays * I.DAY) continue;
    const snap = await db.collection('intern_files').where('batchId', '==', b.batchId).get();
    for (const doc of snap.docs || []) {
      const f = doc.data() || {};
      if (f.droppedAt) continue;
      await doc.ref.set(await require('./file-store').drop(f, nowIso(nowMs)), { merge: true });
      await count(db, { files: -1, bytes: -(Number(f.size) || 0) }, nowMs);
      emptied += 1;
      if (emptied >= limit) return emptied;
    }
  }
  return emptied;
}

module.exports = {
  signInWith, setDetails, NO_MATCH_SAY,
  publicSite, dashboardUrl, onboardUrl, mailNow, fail, workId,
  getBatch, listBatches, saveBatch, batchForApproval, getIntern, listInterns, issueIntern, revoke, regenerate,
  onboard, signIn, whoIs, endSession, chooseElectives, usage, saveFile, readFile,
  listWorks, submitWork, review, reviewQueue, sweep
};
