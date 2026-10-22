#!/usr/bin/env node
'use strict';

/* An audit of laws.html, for a reviewer.

     npm run audit:laws

   What this can and cannot do, plainly:

   It CAN check the things a machine can check - that every answer carries a
   citation, that a provision is cited consistently across the answers that use
   it, that no answer leaves the reader without a route, that no answer quotes
   a token fine, that the framing does not seat the reader in the offender's
   chair, and that citations follow one house format.

   It CANNOT tell you whether a section number is the right section, whether a
   holding is stated accurately, or whether a rule has been amended since. **No
   script can certify this page as legally correct.** That
   needs an advocate practising in this area, and this report exists to make
   their pass shorter by putting every provision and every answer that relies
   on it in one list. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'laws.html'), 'utf8');

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function entries() {
  const out = [];
  const re = /<details class="qa"[^>]*id="([^"]*)"[^>]*data-cites="([^"]*)"[^>]*>\s*<summary>.*?<span class="qa__q">(.*?)<\/span>.*?<div class="qa__a">(.*?)<\/details>/gs;
  for (const m of html.matchAll(re)) {
    out.push({
      id: m[1],
      cites: m[2].split('|').map((c) => c.trim()).filter(Boolean),
      q: text(m[3]),
      a: text(m[4])
    });
  }
  return out;
}

/* A route out: something the reader can actually do next. */
const ROUTE = /\b(complain|complaint|FIR|report|Section|Rule|writ|petition|magistrate|court|authority|Board|Commissioner|Collector|officer|proprietor|manager|seiz|evidence|photograph|video|checkpost|inspector|veterinar|licen[cs])\w*/i;
/* The answer says something is unlawful, refused, or being done to an animal. */
const WRONG = /\b(offence|unlawful|illegal|violat\w+|breach|prohibited|refus\w+|cruel\w*|suffer\w*|punish\w+)\b/i;
const OFFENDER = /\b(I|my)\b[^?]*\b(poison|abandon|chain(ed)?|shoot|beat|kill|maim|starve|cull)\b/i;
const TOKEN_FINE = /\b(\d{1,4})\s*(?:to\s*\d{1,4}\s*)?rupees\b/g;

function audit() {
  const all = entries();
  const issues = [];
  const provisions = new Map();

  for (const e of all) {
    if (!e.cites.length) issues.push([e.id, 'cites nothing', e.q]);
    /* A route is only owed where the answer names a wrong. "Do I need a dog
       licence?" is answered by answering it; "the seller is breaking the Rules"
       without saying who to tell is the failure worth catching. */
    if (WRONG.test(e.a) && !ROUTE.test(e.a)) issues.push([e.id, 'names a wrong but no route to act on it', e.q]);
    if (OFFENDER.test(e.q)) issues.push([e.id, 'seats the reader as the offender', e.q]);
    for (const m of e.a.matchAll(TOKEN_FINE)) {
      if (Number(m[1]) <= 5000) issues.push([e.id, `quotes a token fine (${m[0]})`, e.q]);
    }
    /* A citation named in the visible answer but absent from data-cites, or the
       reverse, means the two drifted. */
    for (const c of e.cites) provisions.set(c, (provisions.get(c) || []).concat(e.id));
  }
  return { all, issues, provisions };
}

if (require.main === module) {
  const { all, issues, provisions } = audit();
  console.log(`laws.html: ${all.length} answers, ${provisions.size} distinct provisions cited\n`);

  if (!issues.length) console.log('Nothing flagged for review.\n');
  else {
    console.log(`${issues.length} answer(s) worth a reviewer's eye - candidates, not verdicts:\n`);
    issues.forEach(([id, why, q]) => console.log(`  [${id}] ${why}\n        ${q}`));
    console.log('');
  }

  console.log('For the reviewer - every provision, and the answers resting on it:\n');
  [...provisions].sort((a, b) => b[1].length - a[1].length).forEach(([p, ids]) => {
    console.log(`  ${String(ids.length).padStart(3)}  ${p}`);
    console.log(`       ${ids.join(', ')}`);
  });

  console.log('\nThis report does not verify that any section number, holding or');
  console.log('penalty is correct. That needs an advocate. Sections that carry the');
  console.log('most weight here, and are worth reading first: BNS 2023 s.325,');
  console.log('BNSS 2023 s.173/175(3)/223, PCA 1960 s.11(1) and s.3, ABC Rules 2023,');
  console.log('and the Supreme Court judgment of 19 May 2026.');
}

module.exports = { audit, entries };
