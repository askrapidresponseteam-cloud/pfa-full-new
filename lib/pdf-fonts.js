'use strict';

/* The fonts the site's PDFs are set in, and text split into runs by script
   (moved here from lib/cruelty-report.js on 20 Nov 2026, so the letters
   use the same: lib/letters.js).

   Noto Sans for Latin (and its extended set for the rupee sign and the
   rest), and a Noto for each Indian script, so a name written in Hindi or
   Kannada prints as written. All under the SIL Open Font License
   (report-fonts/OFL.txt). */

const fs = require('fs');
const path = require('path');

/* Each font is named here in full, so the bundlers (Vercel's file tracing,
   scripts/build-firebase.js) carry it with the code. */
const FONT_FILES = {
  latin: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-400.woff')),
  latinBold: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-700.woff')),
  /* Liberation Sans, the same widths as Arial, for the letters (owner, 20 Nov
     2026: "letter font to be arial"; Arial itself may not be shipped) */
  arial: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'liberation-sans-400.ttf')),
  arialBold: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'liberation-sans-700.ttf')),
  latinExt: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-latin-ext-400.woff')),
  devanagari: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-devanagari-400.woff')),
  bengali: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-bengali-400.woff')),
  gurmukhi: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-gurmukhi-400.woff')),
  gujarati: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-gujarati-400.woff')),
  oriya: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-oriya-400.woff')),
  tamil: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-tamil-400.woff')),
  telugu: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-telugu-400.woff')),
  kannada: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-kannada-400.woff')),
  malayalam: () => fs.readFileSync(path.join(__dirname, 'report-fonts', 'noto-sans-malayalam-400.woff'))
};
const SCRIPTS = [
  { key: 'devanagari', from: 0x0900, to: 0x097f }, { key: 'devanagari', from: 0xa8e0, to: 0xa8ff },
  { key: 'bengali', from: 0x0980, to: 0x09ff },
  { key: 'gurmukhi', from: 0x0a00, to: 0x0a7f },
  { key: 'gujarati', from: 0x0a80, to: 0x0aff },
  { key: 'oriya', from: 0x0b00, to: 0x0b7f },
  { key: 'tamil', from: 0x0b80, to: 0x0bff },
  { key: 'telugu', from: 0x0c00, to: 0x0c7f },
  { key: 'kannada', from: 0x0c80, to: 0x0cff },
  { key: 'malayalam', from: 0x0d00, to: 0x0d7f }
];

let fonts = null;
function loadFonts() {
  if (fonts) return fonts;
  const fontkit = require('fontkit');
  fonts = {};
  for (const key of Object.keys(FONT_FILES)) {
    const bytes = FONT_FILES[key]();
    fonts[key] = { bytes, font: fontkit.create(bytes) };
  }
  return fonts;
}

const has = (key, cp) => { try { return Boolean(fonts[key].font.hasGlyphForCodePoint(cp)); } catch (_) { return false; } };
const scriptOf = (cp) => (SCRIPTS.find((s) => cp >= s.from && cp <= s.to) || {}).key || '';

/* A string split into runs, each in the one font that draws it: an Indian
   script in its own Noto, the rest in Noto Sans. A space, a joiner or a
   mark the current font has stays in the run (so a Hindi sentence is one
   run); a character no font has (an emoji) is left out. */
function runsOf(text, bold, family) {
  /* family: the fonts for Latin, { regular, bold } (Noto Sans when not said) */
  const base = family ? (bold ? family.bold : family.regular) : (bold ? 'latinBold' : 'latin');
  const out = [];
  let cur = null;
  let dropped = false;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    /* a left-out character leaves one space, not two */
    if (dropped && /[^\S\n]/.test(ch) && cur && /[^\S\n]$/.test(cur.text)) continue;
    dropped = false;
    let key = scriptOf(cp);
    if (!key) {
      if (ch === '\n') key = cur ? cur.key : base;
      else if (cur && cur.key !== base && cur.key !== 'latinExt' && (/\s/.test(ch) || cp === 0x200c || cp === 0x200d) && has(cur.key, cp)) key = cur.key;
      else if (has(base, cp)) key = base;
      else if (has('latinExt', cp)) key = 'latinExt';
      else if (/\s/.test(ch)) { key = base; }
      else { dropped = true; continue; }
    }
    if (cur && cur.key === key) cur.text += ch;
    else { cur = { key, text: ch }; out.push(cur); }
  }
  return out;
}


module.exports = { FONT_FILES, SCRIPTS, loadFonts, has, scriptOf, runsOf };
