'use strict';
/* Partners in giving: what a donor gave, and what it is doing, shown so it
   stands out (owner, 27 Nov 2026, of the ambulance Rosie's Heroes gave PFA
   Khamgaon: "what is the best way to share the donors givings. it has to
   look amazing and stand out"; Maneka Sanjay Gandhi the same week: "put it
   on the site and thank that California team ... They are waiting to see how
   this turns out before they send the next tranche").

   One partnership is one donor's gift to one place: who gave, who leads
   them, what it bought, where it works, the photographs, and a timeline that
   keeps growing (a line, a photograph and the animals it helped, week by
   week). The animals helped add up to the count at the top of the page.

   The amount given is shown only while showAmount is on (owner: "The amount
   can be shown or hidden using a toggle in the admin panel ... no amount
   hidden message or empty space"). When it is off the amount never leaves
   the server: publicList() drops it, so no page can show it by mistake.

   Written in the panel (Partners in giving, lib/routes/admin/partners.js),
   shown on partners.html (assets/partners.js), read from /api/partners.
   Long dashes become plain hyphens; amounts are written without separators. */

const crypto = require('crypto');
const U = require('./site-updates');

const COLLECTION = 'partners';
const SEED_FLAG = 'partnersSeed';
const CURRENCIES = { INR: '₹', USD: 'US$', GBP: '£', EUR: '€' };
const MAX = { line: 160, short: 80, text: 1200, people: 12, photos: 12, timeline: 200 };
const LOCAL = /^media\/partners\/[a-z0-9-]+\/[\w.-]+\.(webp|jpg|jpeg|png)$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const one = (v, n) => U.clean(v, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
const text = (v, n) => U.clean(v, n);
const dayOf = (v) => {
  const s = String(v || '').trim();
  if (!DAY.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? '' : s;
};
const photoOk = (src) => LOCAL.test(String(src || '')) || U.isOurFile(src);

/* The first partnership, from the email of 26 Nov 2026 and Rosie's Heroes'
   own pages (rosiesheroes.org, the team page): put in once, then the
   panel's to change. */
const ROSIES = {
  id: 'rosies-heroes',
  status: 'published',
  order: 1,
  donor: 'Rosie’s Heroes',
  donorLine: 'A volunteer-run US charity (501(c)(3)) in Livermore, California, working with rescues in India for street dogs',
  link: 'https://rosiesheroes.org',
  logo: 'media/partners/rosies-heroes/logo.webp',
  people: [
    'Priyanka Rao, President',
    'Archana Ramamoorthy, Treasurer',
    'Sonia Dong, Secretary'
  ],
  unit: 'PFA Khamgaon',
  place: 'Khamgaon, Maharashtra',
  headline: 'Hope on wheels for the animals of Khamgaon',
  gift: 'An electric animal rescue ambulance',
  giftName: 'Twix’s Hope on Wheels',
  story: 'Rosie’s Heroes funded an electric rescue ambulance for PFA Khamgaon in Maharashtra. Painted as Twix’s Hope on Wheels, it carries injured and sick street animals from wherever they are found to treatment and care.',
  thanks: 'Thank you, Priyanka Rao, Archana Ramamoorthy, Sonia Dong and every volunteer of Rosie’s Heroes in California. Because of you, an animal hurt on a Khamgaon street no longer waits for help to find it.',
  amount: '',
  currency: 'USD',
  showAmount: false,
  givenOn: '2026-11-25',
  countLabel: 'animals carried to care',
  photos: [
    { src: 'media/partners/rosies-heroes/hope-on-wheels.webp', alt: 'Twix’s Hope on Wheels, PFA Khamgaon’s new animal rescue ambulance' },
    { src: 'media/partners/rosies-heroes/arrived.webp', alt: 'The ambulance on the day it arrived at PFA Khamgaon' },
    { src: 'media/partners/rosies-heroes/doors.webp', alt: 'The ambulance’s back doors, with the PFA Khamgaon and Rosie’s Heroes signs' },
    { src: 'media/partners/rosies-heroes/front.webp', alt: 'The ambulance from the front, a puppy beside it' }
  ],
  timeline: [
    { id: 't-arrived', date: '2026-11-25', title: 'Hope on Wheels arrives in Khamgaon', text: 'The electric ambulance reached PFA Khamgaon, ready to carry injured and sick animals to treatment.', photo: 'media/partners/rosies-heroes/arrived.webp', photoAlt: 'The ambulance on the day it arrived', count: 0 },
    { id: 't-inauguration', date: '2026-11-29', title: 'Inauguration and puja', text: 'With officers of the Animal Husbandry Department invited to see it set out.', photo: '', photoAlt: '', count: 0 }
  ]
};

function newId() { return 't-' + crypto.randomBytes(4).toString('hex'); }
function slugOf(v) { return String(v || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }

function cleanEntry(e) {
  const x = e || {};
  const date = dayOf(x.date);
  if (!date) return { ok: false, message: 'Give the day it happened.' };
  const title = one(x.title, MAX.short);
  if (title.length < 3) return { ok: false, message: 'Say in a few words what happened.' };
  const photo = x.photo && photoOk(x.photo) ? String(x.photo) : '';
  if (x.photo && !photo) return { ok: false, message: 'Upload the picture again.' };
  const count = Math.max(0, Math.min(100000, Math.floor(Number(x.count) || 0)));
  return { ok: true, entry: { id: /^t-[a-z0-9-]{2,30}$/.test(String(x.id || '')) ? String(x.id) : newId(), date, title, text: text(x.text, 600), photo, photoAlt: photo ? one(x.photoAlt, 160) : '', count } };
}

/* A partnership as the panel sends it, checked; or { ok: false, message }. */
function check(body) {
  const b = body || {};
  const donor = one(b.donor, MAX.short);
  if (donor.length < 2) return { ok: false, message: 'Give the donor’s name.' };
  const id = SLUG.test(String(b.id || '')) ? String(b.id) : slugOf(donor);
  if (!SLUG.test(id)) return { ok: false, message: 'Give the donor’s name in letters.' };
  const headline = one(b.headline, 100);
  if (headline.length < 6) return { ok: false, message: 'Give the page a headline.' };
  const amount = String(b.amount == null ? '' : b.amount).replace(/[,\s]/g, '').trim();
  if (amount && !/^\d{1,10}(\.\d{1,2})?$/.test(amount)) return { ok: false, message: 'Write the amount as a number, like 2664.92.' };
  const currency = CURRENCIES[b.currency] ? b.currency : 'INR';
  const photos = (Array.isArray(b.photos) ? b.photos : []).filter((p) => p && photoOk(p.src)).slice(0, MAX.photos).map((p) => ({ src: String(p.src), alt: one(p.alt, 160) }));
  if (!photos.length) return { ok: false, message: 'Add at least one photograph: it opens the page.' };
  const timeline = [];
  for (const e of (Array.isArray(b.timeline) ? b.timeline : []).slice(0, MAX.timeline)) {
    const r = cleanEntry(e);
    if (!r.ok) return r;
    timeline.push(r.entry);
  }
  let link = '';
  if (b.link) {
    try { const u = new URL(String(b.link).trim()); if (u.protocol === 'https:') link = u.href.slice(0, 300); } catch (_) { /* below */ }
    if (!link) return { ok: false, message: 'The donor’s website must start with https://.' };
  }
  return {
    ok: true,
    partner: {
      id, donor, headline, link,
      status: b.status === 'draft' ? 'draft' : 'published',
      order: Math.max(0, Math.min(999, Math.floor(Number(b.order) || 1))),
      donorLine: one(b.donorLine, MAX.line),
      logo: b.logo && photoOk(b.logo) ? String(b.logo) : '',
      people: (Array.isArray(b.people) ? b.people : String(b.people || '').split('\n')).map((p) => one(p, 80)).filter(Boolean).slice(0, MAX.people),
      unit: one(b.unit, MAX.short), place: one(b.place, MAX.short),
      gift: one(b.gift, MAX.line), giftName: one(b.giftName, MAX.short),
      story: text(b.story, MAX.text), thanks: text(b.thanks, MAX.text),
      amount, currency, showAmount: Boolean(b.showAmount) && Boolean(amount),
      givenOn: dayOf(b.givenOn),
      countLabel: one(b.countLabel, 60) || 'animals helped',
      photos,
      timeline: timeline.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
    }
  };
}

async function seed(db) {
  const flag = db.collection('siteMeta').doc(SEED_FLAG);
  const seen = await flag.get();
  if (seen.exists) return;
  const ref = db.collection(COLLECTION).doc(ROSIES.id);
  if (!(await ref.get()).exists) await ref.set(Object.assign({}, ROSIES, { createdAt: new Date().toISOString(), updatedBy: 'site' }));
  await flag.set({ at: new Date().toISOString() });
}

async function all(db) {
  await seed(db);
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => p.status !== 'removed')
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(b.givenOn || '').localeCompare(String(a.givenOn || '')));
}

async function save(db, by, body, nowMs) {
  const r = check(body);
  if (!r.ok) return r;
  const p = r.partner;
  const ref = db.collection(COLLECTION).doc(p.id);
  const was = await ref.get();
  await ref.set(Object.assign({}, p, { updatedAt: new Date(nowMs).toISOString(), updatedBy: by }, was.exists ? {} : { createdAt: new Date(nowMs).toISOString() }));
  return { ok: true, id: p.id, donor: p.donor, status: p.status };
}

async function remove(db, by, id, nowMs) {
  if (!SLUG.test(String(id || ''))) return { ok: false, message: 'Which partnership?' };
  const ref = db.collection(COLLECTION).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: 'That partnership is not on file.' };
  await ref.set({ status: 'removed', removedAt: new Date(nowMs).toISOString(), removedBy: by }, { merge: true });
  return { ok: true, id: String(id), donor: snap.data().donor };
}

/* What a visitor may see: published only, the amount only while it is to
   be shown, the count of animals helped added up, nothing about who in the
   office wrote it. */
function publicOf(p) {
  const out = {
    id: p.id, donor: p.donor, donorLine: p.donorLine || '', link: p.link || '', logo: p.logo || '',
    people: p.people || [], unit: p.unit || '', place: p.place || '', headline: p.headline,
    gift: p.gift || '', giftName: p.giftName || '', story: p.story || '', thanks: p.thanks || '',
    givenOn: p.givenOn || '', countLabel: p.countLabel || 'animals helped',
    photos: p.photos || [],
    timeline: (p.timeline || []).map((e) => ({ id: e.id, date: e.date, title: e.title, text: e.text || '', photo: e.photo || '', photoAlt: e.photoAlt || '', count: e.count || 0 })),
    helped: (p.timeline || []).reduce((n, e) => n + (Number(e.count) || 0), 0)
  };
  if (p.showAmount && p.amount) out.given = (CURRENCIES[p.currency] || '') + String(p.amount);
  return out;
}
async function publicList(db) {
  return (await all(db)).filter((p) => p.status === 'published').map(publicOf);
}

module.exports = { COLLECTION, CURRENCIES, ROSIES, check, cleanEntry, all, save, remove, publicOf, publicList, slugOf, _seed: seed };
