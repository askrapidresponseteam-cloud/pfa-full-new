/* What the Colony Caregiver Card prints, and the proof that it fits.

   Owner, 24 Oct 2026: "nothing can be clipped. nothing can overlay nothing
   else. text/font size needs to be same for every card. think like a credit
   card/ aadhar card issuance system. it cannot look and feel different for
   diff people- no matter the length of the name or address."

   So the card is printed the way a bank prints a card: every field in one
   font at one size, always. Nothing is shrunk to fit, pressed narrower,
   cut off or allowed to run into the next thing. What varies is not the
   type but the words: a value that is too wide for its line at that size
   is printed in a fixed short form, decided at issue and kept on the card.

     name      as printed on the card ("printName"). A name that fits is
               printed whole. One that does not is offered shortened by a
               fixed rule (initials for the middle names, then for every
               name but the last), and the reviewer confirms or edits it
               before the card is issued, because only a person can say
               which of "R. Muthuramalingam" and "Muthuramalingam R." is
               right. The server will not issue a name that does not fit.
     district  from the site's own list, printed without the old or other
     state     name in brackets ("Mysuru (Mysore)" prints "Mysuru"), and
               the four that are still too wide in a fixed short form.
     ID, date  fixed formats, always the same width.

   "Fits" is measured, not guessed: the widths below are the font's own
   (Arimo, which is drawn to Arial's exact widths and is the face the card
   is drawn in, fonts/arimo-latin-400.woff2), in its units, with its own
   kerning pairs. The browser that draws the card and the server that
   issues it measure with the same numbers, so a name the server accepts is
   a name the card prints, on any device.

   Pure, and shared by the browser and the server. No DOM, no canvas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFACardPrint = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Arimo Regular: advance widths by code point, in units of 2048 per em,
     and the kerning pairs that move a letter (also in those units). Pairs
     with a space are left out: a browser shapes each word on its own and
     never kerns across a space, so neither does this. */
  var UPM = 2048;
  var ADV = {
    32: 569, 33: 569, 34: 727, 35: 1139, 36: 1139, 37: 1821, 38: 1366, 39: 391, 40: 682, 41: 682, 42: 797, 43: 1196,
    44: 569, 45: 682, 46: 569, 47: 569, 48: 1139, 49: 1139, 50: 1139, 51: 1139, 52: 1139, 53: 1139, 54: 1139, 55: 1139,
    56: 1139, 57: 1139, 58: 569, 59: 569, 60: 1196, 61: 1196, 62: 1196, 63: 1139, 64: 2079, 65: 1366, 66: 1366, 67: 1479,
    68: 1479, 69: 1366, 70: 1251, 71: 1593, 72: 1479, 73: 569, 74: 1024, 75: 1366, 76: 1139, 77: 1706, 78: 1479, 79: 1593,
    80: 1366, 81: 1593, 82: 1479, 83: 1366, 84: 1251, 85: 1479, 86: 1366, 87: 1933, 88: 1366, 89: 1366, 90: 1251, 91: 569,
    92: 569, 93: 569, 94: 961, 95: 1139, 96: 682, 97: 1139, 98: 1139, 99: 1024, 100: 1139, 101: 1139, 102: 569, 103: 1139,
    104: 1139, 105: 455, 106: 455, 107: 1024, 108: 455, 109: 1706, 110: 1139, 111: 1139, 112: 1139, 113: 1139, 114: 682, 115: 1024,
    116: 569, 117: 1139, 118: 1024, 119: 1479, 120: 1024, 121: 1024, 122: 1024, 123: 684, 124: 532, 125: 684, 126: 1196, 160: 569,
    161: 682, 162: 1139, 163: 1139, 164: 1139, 165: 1139, 166: 532, 167: 1139, 168: 682, 169: 1509, 170: 758, 171: 1139, 172: 1196,
    173: 682, 174: 1509, 175: 1131, 176: 819, 177: 1124, 178: 682, 179: 682, 180: 682, 181: 1180, 182: 1100, 183: 682, 184: 682,
    185: 682, 186: 748, 187: 1139, 188: 1708, 189: 1708, 190: 1708, 191: 1251, 192: 1366, 193: 1366, 194: 1366, 195: 1366, 196: 1366,
    197: 1366, 198: 2048, 199: 1479, 200: 1366, 201: 1366, 202: 1366, 203: 1366, 204: 569, 205: 569, 206: 569, 207: 569, 208: 1479,
    209: 1479, 210: 1593, 211: 1593, 212: 1593, 213: 1593, 214: 1593, 215: 1196, 216: 1593, 217: 1479, 218: 1479, 219: 1479, 220: 1479,
    221: 1366, 222: 1366, 223: 1251, 224: 1139, 225: 1139, 226: 1139, 227: 1139, 228: 1139, 229: 1139, 230: 1821, 231: 1024, 232: 1139,
    233: 1139, 234: 1139, 235: 1139, 236: 569, 237: 569, 238: 569, 239: 569, 240: 1139, 241: 1139, 242: 1139, 243: 1139, 244: 1139,
    245: 1139, 246: 1139, 247: 1124, 248: 1251, 249: 1139, 250: 1139, 251: 1139, 252: 1139, 253: 1024, 254: 1139, 255: 1024, 305: 569,
    338: 2048, 339: 1933
  };
  var KERN = {
    "11": -152, "AT": -152, "AV": -152, "AW": -76, "AY": -152, "Av": -37, "Aw": -37, "Ay": -37,
    "F,": -227, "F.": -227, "FA": -113, "LT": -152, "LV": -152, "LW": -152, "LY": -152, "Ly": -76,
    "P,": -264, "P.": -264, "PA": -152, "RT": -37, "RV": -37, "RW": -37, "RY": -37, "T,": -227,
    "T-": -113, "T.": -227, "T:": -227, "T;": -227, "TA": -152, "TO": -37, "Ta": -227, "Tc": -227,
    "Te": -227, "Ti": -76, "To": -227, "Tr": -76, "Ts": -227, "Tu": -76, "Tw": -113, "Ty": -113,
    "T\u00ad": -113, "V,": -188, "V-": -113, "V.": -188, "V:": -76, "V;": -76, "VA": -152, "Va": -152,
    "Ve": -113, "Vi": -37, "Vo": -113, "Vr": -76, "Vu": -76, "Vy": -76, "V\u00ad": -113, "W,": -113,
    "W-": -37, "W.": -113, "W:": -37, "W;": -37, "WA": -76, "Wa": -76, "We": -37, "Wo": -37,
    "Wr": -37, "Wu": -37, "Wy": -18, "W\u00ad": -37, "Y,": -264, "Y-": -188, "Y.": -264, "Y:": -113,
    "Y;": -133, "YA": -152, "Ya": -152, "Ye": -188, "Yi": -76, "Yo": -188, "Yp": -152, "Yq": -188,
    "Yu": -113, "Yv": -113, "Y\u00ad": -188, "ff": -37, "r,": -113, "r.": -113, "v,": -152, "v.": -152,
    "w,": -113, "w.": -113, "y,": -152, "y.": -152
  };

  /* The value on each line: 18.06 px of the template's 785 px artboard,
     from x 252.97 to the end of its rule at 473.12. Half a pixel is kept
     back, so anti-aliasing never touches the rule's end. */
  var SIZE = 18.06;
  var ROOM = 473.12 - 252.97;
  var LIMIT = ROOM - 0.5;

  /* Letters a name on the card may carry: the font's own, and the marks a
     name uses. Anything else is not printed (it would come from another
     font, at other widths). */
  var NAME_OK = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]*$/;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /* Every character the font carries. */
  function covered(text) {
    var s = String(text);
    for (var i = 0; i < s.length; i += 1) if (ADV[s.charCodeAt(i)] === undefined) return false;
    return true;
  }

  /* The width of a line, in the template's pixels, at the given size. */
  function width(text, size) {
    var s = String(text);
    var units = 0;
    for (var i = 0; i < s.length; i += 1) {
      var w = ADV[s.charCodeAt(i)];
      units += w === undefined ? UPM : w;            /* an unknown letter counts as a full em */
      if (i > 0) units += KERN[s.charAt(i - 1) + s.charAt(i)] || 0;
    }
    return units * (size || SIZE) / UPM;
  }

  function fits(text) {
    return covered(text) && width(text) <= LIMIT;
  }

  /* ---- the name ----------------------------------------------------------- */

  function initial(word) {
    var first = String(word).replace(/^[^A-Za-zÀ-ɏ]+/, '').charAt(0);
    return first ? first.toUpperCase() + '.' : '';
  }

  /* The name as the card would print it, and how: { text, shortened, fits }.
     The name is taken as given (cased by the caller, as the register keeps
     it). Shortening is offered, never final: issuing needs the reviewer's
     yes. A single word too long for the line cannot be shortened by rule,
     and comes back with fits: false. */
  function suggestName(name) {
    var full = clean(name);
    if (!full) return { text: '', shortened: false, fits: false };
    if (fits(full)) return { text: full, shortened: false, fits: true };
    var words = full.split(' ');
    var tries = [];
    if (words.length > 2) {
      tries.push([words[0]].concat(words.slice(1, -1).map(initial), [words[words.length - 1]]).join(' '));
    }
    if (words.length > 1) {
      tries.push(words.slice(0, -1).map(initial).concat([words[words.length - 1]]).join(' '));
      tries.push([words[0], initial(words[words.length - 1])].join(' '));
    }
    for (var i = 0; i < tries.length; i += 1) {
      if (fits(tries[i])) return { text: tries[i], shortened: true, fits: true };
    }
    return { text: full, shortened: false, fits: false };
  }

  /* Whether a name may go on a card: the reason when it may not. */
  function nameProblem(text) {
    var t = clean(text);
    if (!t) return 'Give the name to print on the card.';
    if (!NAME_OK.test(t)) return 'The name on the card can have letters, spaces, full stops, apostrophes and hyphens only.';
    if (!covered(t)) return 'The name on the card has a letter the card cannot print.';
    if (width(t) > LIMIT) return 'Too long for the card at its fixed size. Shorten it, for example with initials.';
    return '';
  }

  /* ---- the district and the state --------------------------------------- */

  /* The few that stay too wide without their bracket, in a fixed short form
     (the forms in common official use). */
  var PLACE_PRINT = {
    'Sahibzada Ajit Singh Nagar (Mohali)': 'SAS Nagar (Mohali)',
    'North and Middle Andaman': 'North & Middle Andaman',
    'Andaman and Nicobar Islands': 'Andaman and Nicobar',
    'Dadra and Nagar Haveli and Daman and Diu': 'DNH and Daman and Diu'
  };
  /* A bracket that tells two districts apart is kept, as a word. */
  var KEEP_BRACKET = /^(Rural|Urban|City|Suburban)$/i;

  var SMALL = /^(and|of|the|on|in|at)$/;
  /* A place typed all in one case ("udupi", "UDUPI") in its usual case; one
     already cased (as the list spells it) is left exactly as it is. */
  function placeCase(v) {
    if (v !== v.toLowerCase() && v !== v.toUpperCase()) return v;
    return v.toLowerCase().split(' ').map(function (word, i) {
      if (i > 0 && SMALL.test(word)) return word;
      return word.replace(/(^|[(-])([a-z\u00e0-\u024f])/g, function (_, lead, ch) { return lead + ch.toUpperCase(); });
    }).join(' ');
  }

  function placeName(value) {
    var v = placeCase(clean(value));
    if (!v) return '';
    for (var key in PLACE_PRINT) {
      if (Object.prototype.hasOwnProperty.call(PLACE_PRINT, key) && key.toLowerCase() === v.toLowerCase()) return PLACE_PRINT[key];
    }
    return clean(v.replace(/\s*\(([^)]*)\)\s*/g, function (_, inner) {
      return KEEP_BRACKET.test(clean(inner)) ? ' ' + clean(inner) + ' ' : ' ';
    }));
  }

  return {
    SIZE: SIZE,
    ROOM: ROOM,
    LIMIT: LIMIT,
    width: width,
    covered: covered,
    fits: fits,
    suggestName: suggestName,
    nameProblem: nameProblem,
    placeName: placeName,
    PLACE_PRINT: PLACE_PRINT
  };
}));
