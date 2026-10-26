'use strict';

/* The old site's membership list (owner, 26 Oct 2026: "these are list of
   members who had applied on the old site. keep this as a sep page and DONT
   ADD THEM TO THE CURRENT PANEL. KEEP THIS SEPARATE AND VERY CLEARLY. ENSURE
   NO MEMBERS ARE THERE 2 TIMES. DO AN ENTERPRISE GRADE DEDUPE").

   The workbook has two kinds of sheet, told apart by their header row, not
   by name, so a newer copy with sheets added or renamed still reads:

     the master list   "NAME / NUMBER / EMAIL", ADDRESS, MEMBERSHIP TYPE,
                       DATE, then free notes in any column after
     a state list      "Membership Number", "Name", then notes

   The same person is usually in both, and the name cell is written a dozen
   ways ("Name\nphone\nemail", "Name phone email" on one line, +91 with odd
   spaces, a leading 0, the email first). Every row is read into one shape,
   then the rows are joined into people.

   How rows are joined (union-find), strongest evidence only:
     - the same mobile number, and names that agree;
     - the same email address (case, gmail dots, +tags and obvious domain
       slips ignored), and names that agree;
     - the same membership number on the same list, and names that agree;
     - the same full name, of two words or more, on rows that carry no
       contact details at all and so cannot be told apart any other way.
   "Names that agree": the same words in any order, one name contained in
   the other ("Ravi Kiran S" and "Ravi Kiran"), or a close spelling
   ("Venkatesan Ramaswamy" and "Ramaswami"). Titles (Dr, Ms, Smt, ...)
   and single initials are not counted.

   A contact shared by two names that do not agree (a parent paying for a
   child, three friends on one email) is never joined. It is listed for a
   person to look at, with both rows side by side.

   Government ID numbers (Aadhaar, PAN) written into the sheet are not
   carried over: the panel has no use for them and should not hold them.
   Only the count of what was left out is kept. */

const crypto = require('crypto');
const { readWorkbook, serialDate } = require('./xlsx-read');

const MASTER = 'Master list';

/* ---------- text ---------- */

function tidyText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/\r/g, '');
}
function oneLine(s) { return tidyText(s).replace(/\s+/g, ' ').trim(); }
function listLabel(sheetName) { return oneLine(sheetName); }

/* ---------- government IDs: recognised so they can be left out ---------- */

const PAN = /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g;
const AADHAAR_WORD = /\(?\s*(aadhaa?r|uidai|uid)(\s*(no\.?|number|card))?\s*\)?/gi;

/* ---------- phones ---------- */

/* An Indian mobile as ten digits, or '' when the digits are not one. */
function mobileOf(digits) {
  let d = String(digits || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
function showMobile(d) { return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : d; }

/* ---------- emails ---------- */

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g;
const PROVIDERS = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|rediffmail|rediff|icloud|live|aol|protonmail)(\.?(co\.in|com|in|co\.uk))?/;

function cleanEmail(raw) {
  return String(raw || '').trim().replace(/^[.\-_]+|[.\-_,;]+$/g, '');
}
/* The key two spellings of one mailbox share. For matching only: what is
   shown is what was written. */
function emailKey(raw) {
  const e = cleanEmail(raw).toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return '';
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const p = PROVIDERS.exec(domain);
  if (p) domain = (p[1] === 'googlemail' ? 'gmail' : p[1] === 'rediff' ? 'rediffmail' : p[1]) + '.' + (p[3] || 'com');
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  if (!local || !/\./.test(domain)) return '';
  return local + '@' + domain;
}
/* An address that would bounce as written: no dot in the domain, or
   something after a known provider's .com ("gmail.comh.com", "gmail.cpm"). */
function emailLooksWrong(raw) {
  const e = cleanEmail(raw).toLowerCase();
  const domain = e.slice(e.lastIndexOf('@') + 1);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return true;
  const p = PROVIDERS.exec(domain);
  return Boolean(p) && domain !== (p[1] + '.' + (p[3] || ''));
}

/* ---------- names ---------- */

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'smt', 'shri', 'sri', 'shree', 'prof', 'adv', 'advocate', 'er', 'capt', 'col', 'kum', 'km']);

function nameWords(name) {
  return oneLine(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !TITLES.has(w));
}
function coreWords(name) { return nameWords(name).filter((w) => w.length > 1); }

function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j += 1) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches += 1; break; }
    }
  }
  if (!matches) return 0;
  let t = 0; let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!am[i]) continue;
    while (!bm[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/* Do two written names belong to one person? See the note at the top. */
function namesAgree(x, y) {
  const a = coreWords(x);
  const b = coreWords(y);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  /* every word of the shorter name has a close match in the longer one */
  const used = new Set();
  const each = small.every((w) => {
    let best = -1; let bestScore = 0;
    big.forEach((v, i) => { if (used.has(i)) return; const s = w === v ? 1 : jaroWinkler(w, v); if (s > bestScore) { bestScore = s; best = i; } });
    if (best < 0 || bestScore < (w.length <= 3 ? 1 : 0.9)) return false;
    used.add(best);
    return true;
  });
  if (each) return true;
  /* the same letters with the spaces moved ("Mohan Lal sharma" / "Mohanlal Sharma") */
  return jaroWinkler(a.join(''), b.join('')) >= 0.94 && Math.abs(a.join('').length - b.join('').length) <= 2;
}

/* A display name: written as given, but ALL CAPS and all lower case made readable. */
function displayName(name) {
  const n = oneLine(name).replace(/^["'\s]+|["'\s,.-]+$/g, '');
  if (!n) return '';
  const letters = n.replace(/[^A-Za-z]/g, '');
  if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
    return n.toLowerCase().replace(/(^|[\s.(-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }
  return n;
}

/* ---------- one cell of name, phone and email ---------- */

function readContact(cell) {
  let text = tidyText(cell).replace(/^\s*"+|"+\s*$/g, '');
  const out = { name: '', aka: [], mobiles: [], otherNumbers: [], emails: [], idsLeftOut: 0 };
  const hasAadhaarWord = AADHAAR_WORD.test(text);
  AADHAAR_WORD.lastIndex = 0;
  text = text.replace(EMAIL, (m) => { const e = cleanEmail(m); if (e) out.emails.push(e); return ' \n '; });
  text = text.replace(PAN, () => { out.idsLeftOut += 1; return ' '; });
  text = text.replace(AADHAAR_WORD, ' ');
  text = text.replace(/\+?\d[\d -]{6,18}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    const mobile = mobileOf(digits);
    if (mobile && !(hasAadhaarWord && digits.length === 12)) { out.mobiles.push(mobile); return ' \n '; }
    if (digits.length === 12 || hasAadhaarWord) { out.idsLeftOut += 1; return ' '; }
    if (digits.length >= 8) out.otherNumbers.push(digits);
    return ' ';
  });
  /* "(Rinku)" is another name the person goes by */
  text = text.replace(/\(([^)]*)\)/g, (m, inner) => { const a = oneLine(inner); if (/[a-z]/i.test(a)) out.aka.push(a); return ' '; });
  const lines = text.split('\n').map(oneLine).filter((l) => /[A-Za-z]/.test(l));
  out.name = displayName(lines.join(' '));
  return out;
}

/* ---------- notes ---------- */

function readNote(value, out) {
  if (value === null || value === undefined || value === '') return;
  if (typeof value === 'number') {
    const digits = String(Math.round(value));
    if (digits.length === 12) { out.idsLeftOut += 1; return; }
    const mobile = mobileOf(digits);
    if (mobile) { out.mobiles.push(mobile); return; }
    out.notes.push(digits);
    return;
  }
  let text = oneLine(value);
  if (!text) return;
  text = text.replace(/\bJOINNOW[0-9a-f]{6,}\b/gi, (m) => { out.orders.push(m.toUpperCase().replace(/^JOINNOW/, 'JOINNOW')); return ' '; });
  text = text.replace(PAN, () => { out.idsLeftOut += 1; return ' '; });
  text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, (m) => {
    const mobile = mobileOf(m);
    if (mobile && m.replace(/\D/g, '').length !== 12) { out.mobiles.push(mobile); return ' '; }
    out.idsLeftOut += 1; return ' ';
  });
  const num = /membership\s*(?:id|number|no\.?)\s*[:-]?\s*([A-Z]{1,4}[\s-]*\d{1,6})/i.exec(text);
  if (num) { out.numbersInNotes.push(oneLine(num[1]).toUpperCase().replace(/\s*-\s*/, ' ')); text = text.replace(num[0], ' '); }
  text = oneLine(text);
  if (!text) return;
  if (/^free$/i.test(text)) { out.plans.push('Free'); return; }
  out.notes.push(text);
}

/* ---------- plan and amount ---------- */

function readPlan(value) {
  const written = oneLine(value);
  if (!written) return null;
  const m = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i.exec(written);
  const amount = m ? Number(m[1].replace(/,/g, '')) : null;
  if (/^free$/i.test(written)) return { plan: 'Free', amount: 0 };
  return { plan: amount !== null && /^(INR|Rs\.?|₹)\s*[\d,.]+$/i.test(written) ? 'INR ' + amount.toLocaleString('en-IN') : written, amount };
}

/* ---------- reading the sheets ---------- */

function sheetLayout(rows) {
  for (const r of [...rows.keys()].sort((a, b) => a - b).slice(0, 4)) {
    const cells = rows.get(r);
    const cols = Object.keys(cells);
    const master = cols.find((c) => /name\s*\/\s*number\s*\/\s*email/i.test(String(cells[c])));
    if (master) {
      const find = (re) => cols.find((c) => re.test(String(cells[c])));
      return { kind: 'master', header: r, name: master, address: find(/^\s*address\s*$/i), plan: find(/membership\s*type/i), date: find(/^\s*date\s*$/i) };
    }
    const name = cols.find((c) => /^\s*name\s*$/i.test(String(cells[c])));
    if (name) return { kind: 'list', header: r, name };
  }
  return null;
}

function colIndex(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

function readRows(book) {
  const rows = [];
  const report = { sheets: [], skippedSheets: [], emptyNumbers: 0, idsLeftOut: 0 };
  for (const sheet of book.sheets) {
    const layout = sheetLayout(sheet.rows);
    const label = listLabel(sheet.name);
    if (!layout) { if (sheet.rows.size) report.skippedSheets.push(label); continue; }
    let read = 0;
    for (const r of [...sheet.rows.keys()].sort((a, b) => a - b)) {
      if (r <= layout.header) continue;
      const cells = sheet.rows.get(r);
      const row = {
        sheet: label, list: layout.kind === 'master' ? MASTER : label, row: r,
        name: '', aka: [], mobiles: [], otherNumbers: [], emails: [], notes: [], orders: [], plans: [], amounts: [],
        numbersInNotes: [], number: '', address: '', date: '', idsLeftOut: 0
      };
      const contact = readContact(cells[layout.name]);
      Object.assign(row, { name: contact.name, aka: contact.aka, mobiles: contact.mobiles, otherNumbers: contact.otherNumbers, emails: contact.emails });
      row.idsLeftOut += contact.idsLeftOut;
      const nameCol = colIndex(layout.name);
      if (layout.kind === 'master') {
        if (layout.address) row.address = oneLine(cells[layout.address]);
        if (layout.plan) { const p = readPlan(cells[layout.plan]); if (p) { row.plans.push(p.plan); if (p.amount !== null) row.amounts.push(p.amount); } }
        if (layout.date) {
          const d = cells[layout.date];
          if (typeof d === 'number') row.date = serialDate(d, book.date1904);
          else if (d) row.notes.push('Date as written: ' + oneLine(d));
        }
        const last = Math.max(...[layout.name, layout.address, layout.plan, layout.date].filter(Boolean).map(colIndex));
        Object.keys(cells).filter((c) => colIndex(c) > last).sort((a, b) => colIndex(a) - colIndex(b)).forEach((c) => readNote(cells[c], row));
      } else {
        const numCol = Object.keys(cells).filter((c) => colIndex(c) < nameCol).sort((a, b) => colIndex(b) - colIndex(a))[0];
        const raw = numCol !== undefined ? cells[numCol] : '';
        row.number = typeof raw === 'number' ? String(Math.round(raw)) : oneLine(raw).toUpperCase().replace(/\s*-\s*/, ' ');
        Object.keys(cells).filter((c) => colIndex(c) > nameCol).sort((a, b) => colIndex(a) - colIndex(b)).forEach((c) => readNote(cells[c], row));
      }
      report.idsLeftOut += row.idsLeftOut;
      const hasPerson = row.name || row.mobiles.length || row.emails.length;
      if (!hasPerson) { if (row.number) report.emptyNumbers += 1; continue; }
      read += 1;
      rows.push(row);
    }
    report.sheets.push({ list: layout.kind === 'master' ? MASTER : label, rows: read });
  }
  return { rows, report };
}

/* ---------- joining rows into people ---------- */

function dedupe(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const why = new Map();
  const join = (i, j, reason) => {
    const a = find(i); const b = find(j);
    if (a === b) return;
    parent[b] = a;
    why.set(a, (why.get(a) || new Set()).add(reason));
    for (const r of why.get(b) || []) why.get(a).add(r);
  };
  const review = new Map();
  const flag = (i, j, reason) => {
    const key = [Math.min(i, j), Math.max(i, j)].join(':') + ':' + reason;
    if (!review.has(key)) review.set(key, { a: Math.min(i, j), b: Math.max(i, j), reason });
  };

  const index = new Map();
  const add = (key, i) => { if (!key) return; if (!index.has(key)) index.set(key, []); index.get(key).push(i); };
  rows.forEach((r, i) => {
    r.mobiles.forEach((m) => add('m:' + m, i));
    r.emails.forEach((e) => add('e:' + emailKey(e), i));
    if (r.number) add('n:' + r.list + ':' + r.number, i);
    const contactless = !r.mobiles.length && !r.emails.length;
    const words = coreWords(r.name);
    if (contactless && words.length >= 2) add('x:' + words.join(' '), i);
  });
  const LABEL = { m: 'same mobile', e: 'same email', n: 'same membership number', x: 'same full name, no contact details' };
  const SHARED = { m: 'shares a mobile with a different name', e: 'shares an email with a different name', n: 'shares a membership number with a different name' };
  for (const [key, list] of index) {
    if (list.length < 2) continue;
    const kind = key[0];
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const i = list[x]; const j = list[y];
        if (kind === 'x' || namesAgree(rows[i].name, rows[j].name)) join(i, j, LABEL[kind]);
        else flag(i, j, SHARED[kind]);
      }
    }
  }

  /* gather each person's rows */
  const groups = new Map();
  rows.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });

  const members = [];
  const memberOf = new Map();
  for (const [root, list] of groups) {
    const rs = list.map((i) => rows[i]);
    const m = merge(rs, [...(why.get(root) || [])]);
    /* a joined group whose names do not all agree with each other is kept
       together (the evidence joined it) but marked to be looked at */
    const names = [...new Set(rs.map((r) => r.name).filter(Boolean))];
    m.check = names.some((a, x) => names.slice(x + 1).some((b) => !namesAgree(a, b)));
    list.forEach((i) => memberOf.set(i, m));
    members.push(m);
  }
  const ids = new Set();
  members.forEach((m) => {
    let id = m.id; let n = 2;
    while (ids.has(id)) { id = m.id + '-' + n; n += 1; }
    m.id = id; ids.add(id);
  });
  members.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));

  /* one entry per pair of people, with every reason they were set side by side */
  const byPair = new Map();
  for (const p of review.values()) {
    const ma = memberOf.get(p.a); const mb = memberOf.get(p.b);
    if (ma === mb) continue;
    const [x, y] = ma.name.localeCompare(mb.name) <= 0 ? [ma, mb] : [mb, ma];
    const key = x.id + '|' + y.id;
    if (!byPair.has(key)) byPair.set(key, { reasons: new Set(), people: [x, y].map((m) => ({ id: m.id, name: m.name, mobiles: m.mobiles, emails: m.emails.map((e) => e.email), lists: m.lists, numbers: m.numbers.map((n) => n.number) })) });
    byPair.get(key).reasons.add(p.reason);
  }
  const pairs = [...byPair.values()].map((p) => ({ reasons: [...p.reasons].sort(), people: p.people }))
    .sort((a, b) => a.people[0].name.localeCompare(b.people[0].name));
  return { members, review: pairs };
}

function uniq(list) { return [...new Set(list.filter((x) => x !== '' && x !== null && x !== undefined))]; }

function merge(rs, reasons) {
  /* the fullest spelling of the name, the master list's when it ties */
  const named = rs.filter((r) => r.name);
  const best = named.slice().sort((a, b) => coreWords(b.name).length - coreWords(a.name).length
    || (a.list === MASTER ? -1 : 0) - (b.list === MASTER ? -1 : 0) || b.name.length - a.name.length)[0];
  const name = best ? best.name : '';
  const nameKey = (n) => coreWords(n).join(' ');
  const aka = uniq(rs.flatMap((r) => [r.name, ...r.aka]).filter((n) => n && nameKey(n) !== nameKey(name)));
  const akaUnique = aka.filter((n, i) => aka.findIndex((o) => nameKey(o) === nameKey(n)) === i);

  const mobiles = uniq(rs.flatMap((r) => r.mobiles));
  const emailsByKey = new Map();
  rs.flatMap((r) => r.emails).forEach((e) => {
    const k = emailKey(e) || e.toLowerCase();
    const had = emailsByKey.get(k);
    if (!had || (emailLooksWrong(had) && !emailLooksWrong(e))) emailsByKey.set(k, e);
  });
  const emails = [...emailsByKey.values()].map((e) => ({ email: e, looksWrong: emailLooksWrong(e) }));

  const numbers = [];
  rs.forEach((r) => {
    if (r.number) numbers.push({ list: r.list, number: r.number });
    r.numbersInNotes.forEach((n) => numbers.push({ list: r.list, number: n, fromNote: true }));
  });
  const numbersUnique = numbers.filter((n, i) => numbers.findIndex((o) => o.list === n.list && o.number === n.number) === i);
  const dates = uniq(rs.map((r) => r.date)).sort();
  const sources = rs.map((r) => ({ list: r.list, row: r.row, name: r.name })).sort((a, b) => (a.list === MASTER ? -1 : 0) - (b.list === MASTER ? -1 : 0) || a.list.localeCompare(b.list) || a.row - b.row);
  const keys = uniq([...mobiles.map((m) => 'm:' + m), ...emails.map((e) => 'e:' + (emailKey(e.email) || e.email.toLowerCase())), ...numbersUnique.map((n) => 'n:' + n.list + ':' + n.number)]).sort();
  /* every key the person holds, and their name: two people can share an
     email, never all of it. dedupe() still makes sure no id is used twice. */
  const seed = keys.join('|') + '#' + nameKey(name) + (keys.length ? '' : '#' + sources.map((s) => s.list + ':' + s.row).join(','));
  const id = 'OSM-' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10).toUpperCase();

  return {
    id,
    name,
    aka: akaUnique,
    mobiles: mobiles.map(showMobile),
    otherNumbers: uniq(rs.flatMap((r) => r.otherNumbers)),
    emails,
    addresses: uniq(rs.map((r) => r.address)),
    lists: uniq(rs.map((r) => r.list)).sort((a, b) => (a === MASTER ? -1 : b === MASTER ? 1 : a.localeCompare(b))),
    numbers: numbersUnique,
    plans: uniq(rs.flatMap((r) => r.plans)),
    amounts: uniq(rs.flatMap((r) => r.amounts)),
    joined: dates[0] || '',
    dates,
    orders: uniq(rs.flatMap((r) => r.orders)),
    notes: uniq(rs.flatMap((r) => r.notes)),
    sources,
    rowsJoined: rs.length,
    joinedBecause: reasons.sort(),
    check: false,
    /* the rows themselves, so a person joined by mistake can be taken apart
       by hand (lib/old-members-changes.js) and rebuilt from what was read */
    rows: rs.map(slimRow)
  };
}

const ROW_FIELDS = ['sheet', 'list', 'row', 'name', 'aka', 'mobiles', 'otherNumbers', 'emails', 'notes', 'orders', 'plans', 'amounts', 'numbersInNotes', 'number', 'address', 'date'];
function slimRow(r) {
  const out = {};
  ROW_FIELDS.forEach((k) => { out[k] = Array.isArray(r[k]) ? r[k].slice() : (r[k] === undefined ? '' : r[k]); });
  return out;
}

/* ---------- the whole import ---------- */

function build(buffer) {
  const book = readWorkbook(buffer);
  const { rows, report } = readRows(book);
  if (!rows.length) {
    const e = new Error('No members were found in that workbook. It needs a sheet headed "NAME / NUMBER / EMAIL" or "Membership Number" and "Name".');
    e.code = 'NO_MEMBERS';
    throw e;
  }
  const { members, review } = dedupe(rows);
  const byList = {};
  members.forEach((m) => m.lists.forEach((l) => { byList[l] = (byList[l] || 0) + 1; }));
  const stats = {
    rowsRead: rows.length,
    people: members.length,
    rowsJoined: rows.length - members.length,
    peopleWithDuplicates: members.filter((m) => m.rowsJoined > 1).length,
    toCheck: review.length + members.filter((m) => m.check).length,
    emptyNumbersSkipped: report.emptyNumbers,
    idsLeftOut: report.idsLeftOut,
    sheets: report.sheets,
    skippedSheets: report.skippedSheets,
    byList
  };
  /* Proof that nobody is in the result twice: any mobile, email or list
     number held by two people is only allowed when their names do not
     agree (the pairs listed to check by hand). A shared key between names
     that agree would be a missed duplicate, and the import refuses it. */
  const owners = new Map();
  members.forEach((m) => {
    const keys = [...m.mobiles.map((x) => 'm:' + x.replace(/\s/g, '')), ...m.emails.map((e) => 'e:' + (emailKey(e.email) || e.email.toLowerCase())), ...m.numbers.filter((n) => !n.fromNote).map((n) => 'n:' + n.list + ':' + n.number)];
    uniq(keys).forEach((k) => { if (!owners.has(k)) owners.set(k, []); owners.get(k).push(m); });
  });
  let missed = 0; let shared = 0;
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    shared += 1;
    list.forEach((a, x) => list.slice(x + 1).forEach((b) => { if (namesAgree(a.name, b.name)) missed += 1; }));
  }
  stats.contactsSharedByDifferentPeople = shared;
  stats.missedDuplicates = missed;
  if (missed) {
    const e = new Error('The list could not be made free of duplicates. Nothing was saved.');
    e.code = 'DEDUPE_FAILED';
    throw e;
  }
  return { members, review, stats };
}

module.exports = {
  build, dedupe, readRows, readContact, mergeRows: merge, showMobile, namesAgree, emailKey, emailLooksWrong, mobileOf, displayName, MASTER,
  _private: { jaroWinkler, readNote, readPlan, sheetLayout, coreWords }
};
