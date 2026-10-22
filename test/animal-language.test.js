'use strict';

/* How the site speaks about animals (owner, 5 Oct 2026): as sentient beings
   whose safety, welfare and humane treatment stay central, with facts kept
   as facts. The full rules are in CONTRIBUTING.md. This
   holds the phrasing that must never come back into what a visitor reads. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['admin.html', 'submission-collage.html'].includes(f));

/* What a visitor reads: the page without its scripts, styles and markup. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&rsquo;|&#39;/g, '’').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const NEVER = [
  [/blanket cull/i, 'blanket culling is not raised as an option'],
  [/\bstray (dog|dogs|cattle|animal|animals)\b/i, 'say "community dogs" or "abandoned cattle" (rule 9)'],
  [/\bmenace\b/i, 'animals are never a menace'],
  [/\b(dogs?|animals?|cattle|cows?|monkeys?) (is|are) (a )?(nuisance|threat|problem)/i, 'animals are never a nuisance, threat or problem'],
  [/re-?released? there/i, 'say what humane outcome the animal gets, not that it is not returned (rule 6)'],
  [/public health problem, not a patient/i, 'an animal is always a patient'],
  [/dangerously aggressive/i, 'state the legal ground without stigmatising the animal'],
  [/remov(e|al of) (stray|community|street) (dogs|animals)/i, 'use safe placement, care or relocation where lawful (rule 4)']
];

test('no page uses anti-animal framing', () => {
  const found = [];
  for (const page of pages) {
    const text = visible(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    for (const [re, why] of NEVER) {
      const m = re.exec(text);
      if (m) found.push(`${page}: "${text.slice(Math.max(0, m.index - 40), m.index + 60).trim()}" (${why})`);
    }
  }
  assert.deepEqual(found, [], `\n  ${found.join('\n  ')}`);
});

test('the data the pages are built from holds to the same', () => {
  const found = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.endsWith('.json'))) {
    const text = fs.readFileSync(path.join(ROOT, 'data', file), 'utf8');
    for (const [re, why] of NEVER) if (re.test(text)) found.push(`data/${file}: ${re} (${why})`);
  }
  assert.deepEqual(found, []);
});
