'use strict';

/* The People directory (owner, 10 Nov 2026: "for admin create a people's
   directory section. state, district, name, address, phone number. ensure
   no duplicates. category- members, caregivers etc.. whatever applicable").

   One line per person, from everything the website has filed about people
   (lib/submissions.js): members, colony caregivers, volunteers, interns and
   those who applied for the internship, job applicants, donors, shop
   customers, and those who applied to start a unit. Each line carries every
   way PFA knows the person (a member who also volunteers is one line, both
   categories on it), the address as last given, and the state and district.

   Who is the same person
     Two records are one person when they share a mobile or an email AND the
     names agree (the same name, or one inside the other: "Asha" and "Asha
     Rao"). A family sharing one phone, a husband and a wife both members, is
     two people: they stay two lines, each marked as sharing that number with
     the other, rather than one of them disappearing into the other.

   Where the state and district come from
     What the person chose on the form. A donation or a shop order keeps the
     address as one line, and older forms asked for less: there the state and
     district are read from the PIN code (lib/pin-directory.js, India
     Post's directory), when the PIN names one of each.

   Left out
     The site's testing (lib/test-data.js), and anything rejected, withdrawn,
     revoked, removed or marked as spam. The old website's members are kept
     apart in the panel (owner, 26 Oct 2026) and are not read here. */

const TEST = require('./test-data');
const PINS = require('./pin-directory');
const nameCase = require('../assets/field-rules.js').nameCase;

/* category key, the submission kind it is read from, its word in the panel */
const CATEGORIES = [
  { key: 'member', kind: 'PFA-MEM', label: 'Member' },
  { key: 'caregiver', kind: 'PFA-CG', label: 'Colony caregiver' },
  { key: 'volunteer', kind: 'PFA-V', label: 'Volunteer' },
  { key: 'intern', kind: 'PFA-VI', label: 'Intern', when: (status) => status === 'approved' },
  { key: 'internapplicant', kind: 'PFA-VI', label: 'Internship applicant', when: (status) => status !== 'approved' },
  { key: 'jobapplicant', kind: 'PFA-J', label: 'Job applicant' },
  { key: 'donor', kind: 'PFA-DON', label: 'Donor' },
  { key: 'customer', kind: 'PFA-SHP', label: 'Shop customer' },
  { key: 'unitapplicant', kind: 'PFA-U', label: 'Unit applicant' }
];
const KINDS = [...new Set(CATEGORIES.map((c) => c.kind))];
const LEFT_OUT = new Set(['rejected', 'withdrawn', 'revoked', 'removed', 'spam']);

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

function mobileOf(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
function emailOf(v) {
  const e = clean(v, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}
/* the letters of a name, for comparing; titles left out */
function nameKey(v) {
  return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(dr|mr|mrs|ms|miss|shri|smt|sri|kumari)\b\.?/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
/* "Asha Rao" and "Asha" agree; "Asha Rao" and "Ravi Rao" do not. A record
   with no name agrees with anyone. */
function namesAgree(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return true;
  if (x === y) return true;
  const xs = x.split(' ');
  const ys = y.split(' ');
  const [short, long] = xs.length <= ys.length ? [xs, ys] : [ys, xs];
  return short.every((w) => long.includes(w)) || (x.replace(/ /g, '') === y.replace(/ /g, ''));
}

function millis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

/* One filed record, as a person: or null when it is not one to list. */
function entryOf(id, d) {
  if (!d || TEST.isTest(d) || LEFT_OUT.has(String(d.status || ''))) return null;
  const status = String(d.status || 'new');
  const cat = CATEGORIES.find((c) => c.kind === d.kind && (!c.when || c.when(status)));
  if (!cat) return null;
  const f = d.fields || {};
  const name = nameCase(clean(f.name, 100));
  const mobile = mobileOf(f.mobile || f.phone || f.tel || f.contact);
  const email = emailOf(f.email);
  if (!name && !mobile && !email) return null;
  const parts = [clean(f.address, 300) || [f.house, f.street].map((x) => clean(x, 150)).filter(Boolean).join(', '), clean(f.floor, 40), clean(f.colony, 120)].filter(Boolean);
  let address = parts.join(', ');
  /* a shop order's address starts with who it is going to */
  const head = address.split(',')[0];
  if (name && address.includes(',') && nameKey(head) === nameKey(name)) address = address.slice(head.length + 1).trim();
  const city = clean(f.city, 80);
  let pin = clean(f.pin || f.pincode || f.zip, 10).replace(/\D/g, '');
  if (!/^[1-9]\d{5}$/.test(pin)) {
    const m = /(?:^|\D)([1-9]\d{5})(?!\d)\s*$/.exec(address);
    pin = m ? m[1] : '';
  }
  let state = clean(f.state, 60);
  let district = clean(f.district, 60);
  let fromPin = false;
  if ((!state || !district) && pin) {
    const p = PINS.find(pin);
    if (p) {
      if (!state && p.state) { state = p.state; fromPin = true; }
      if (!district && p.district) { district = p.district; fromPin = true; }
    }
  }
  /* the town in the line once, when the form kept it apart */
  if (city && address && !nameKey(address).includes(nameKey(city))) address = `${address}, ${city}`;
  else if (city && !address) address = city;
  if (pin && address && !address.includes(pin)) address = `${address} ${pin}`;
  /* "..., Udupi, 576101" and "..., Udupi 576101" read the same */
  address = address.replace(/,\s*([1-9]\d{5})$/, ' $1');
  return {
    id,
    category: cat.key,
    label: cat.label,
    status,
    name,
    mobile,
    altMobile: mobileOf(f.altMobile),
    email,
    address: clean(address, 400),
    city, district: district.replace(/\s*\([^)]*\)/g, '').trim(), state, pin,
    fromPin,
    at: Number(d.receivedAtMs) || millis(d.createdAt)
  };
}

/* The records as people: one line each, no one twice, no one lost. */
function merge(entries) {
  const list = entries.filter(Boolean).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const people = [];
  const byMobile = new Map();
  const byEmail = new Map();
  const shares = [];
  for (const e of list) {
    const candidates = [];
    if (e.mobile) for (const p of byMobile.get(e.mobile) || []) candidates.push(p);
    if (e.email) for (const p of byEmail.get(e.email) || []) if (!candidates.includes(p)) candidates.push(p);
    let person = candidates.find((p) => namesAgree(p.name, e.name)) || null;
    if (!person) {
      person = { records: [], name: '', mobile: '', mobiles: [], email: '', emails: [], address: '', city: '', district: '', state: '', pin: '', fromPin: false, first: e.at, last: e.at };
      people.push(person);
      if (candidates.length) shares.push([person, candidates]);
    }
    person.records.push(e);
    /* the latest of each, the name the fullest given */
    if (e.name && (!person.name || nameKey(e.name).length >= nameKey(person.name).length)) person.name = e.name;
    for (const m of [e.mobile, e.altMobile]) {
      if (m && !person.mobiles.includes(m)) {
        person.mobiles.push(m);
        const at = byMobile.get(m) || [];
        if (!at.includes(person)) { at.push(person); byMobile.set(m, at); }
      }
    }
    if (e.mobile) person.mobile = e.mobile;
    if (e.email) {
      person.email = e.email;
      if (!person.emails.includes(e.email)) person.emails.push(e.email);
      const at = byEmail.get(e.email) || [];
      if (!at.includes(person)) { at.push(person); byEmail.set(e.email, at); }
    }
    if (e.address || e.state) {
      Object.assign(person, { address: e.address || person.address, city: e.city || person.city, district: e.district || person.district, state: e.state || person.state, pin: e.pin || person.pin, fromPin: e.fromPin });
    }
    person.first = Math.min(person.first, e.at || person.first);
    person.last = Math.max(person.last, e.at);
  }
  for (const [p, others] of shares) {
    p.sharesWith = others.map((o) => o.name).filter(Boolean);
    for (const o of others) o.sharesWith = [...new Set((o.sharesWith || []).concat(p.name ? [p.name] : []))];
  }
  return people.map((p, i) => {
    const cats = [];
    for (const c of CATEGORIES) if (p.records.some((r) => r.category === c.key)) cats.push(c.key);
    return {
      id: `P${String(i + 1).padStart(5, '0')}`,
      name: p.name,
      mobile: p.mobile || p.mobiles[0] || '',
      otherMobiles: p.mobiles.filter((m) => m !== (p.mobile || p.mobiles[0])),
      email: p.email,
      otherEmails: p.emails.filter((m) => m !== p.email),
      address: p.address,
      district: p.district,
      state: p.state,
      pin: p.pin,
      placeFromPin: Boolean(p.fromPin),
      categories: cats,
      records: p.records.map((r) => ({ id: r.id, category: r.category, label: r.label, status: r.status, at: r.at })).reverse(),
      sharesWith: p.sharesWith || [],
      first: p.first,
      last: p.last
    };
  }).sort((a, b) => (a.state || '￿').localeCompare(b.state || '￿') || (a.district || '￿').localeCompare(b.district || '￿') || a.name.localeCompare(b.name));
}

async function read(db) {
  const snaps = await Promise.all(KINDS.map((kind) => db.collection('submissions').where('kind', '==', kind).get()));
  const entries = [];
  snaps.forEach((snap) => (snap.docs || []).forEach((doc) => entries.push(entryOf(doc.id, doc.data()))));
  return merge(entries);
}

/* ---- the CSV ------------------------------------------------------------ */

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
function csvOf(people) {
  const head = ['State', 'District', 'Name', 'Address', 'PIN code', 'Phone number', 'Other phones', 'Email', 'Category', 'Records'];
  const lines = [head.map(csvCell).join(',')];
  for (const p of people) {
    lines.push([p.state, p.district, p.name, p.address, p.pin, p.mobile, p.otherMobiles.join(' '), p.email, p.categories.map((c) => LABEL[c]).join(', '), p.records.map((r) => r.id).join(' ')].map(csvCell).join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

module.exports = { CATEGORIES, KINDS, LEFT_OUT, entryOf, merge, read, csvOf, namesAgree, mobileOf, nameKey };
