/* What the Colony Caregiver Card prints, and the proof that it fits.

   Owner, 24 Oct 2026: "nothing can be clipped. nothing can overlay nothing
   else. text/font size needs to be same for every card. think like a credit
   card/ aadhar card issuance system. it cannot look and feel different for
   diff people- no matter the length of the name or address."

   So the card is printed the way a bank prints a card: every field in one
   font at one size, always. Nothing is shrunk to fit, pressed narrower,
   cut off, wrapped onto a second line or allowed to run into the next
   thing. What varies is not the type but the words: a value that is too
   wide for its line at that size is printed in a fixed short form, decided
   at issue and kept on the card.

     name      as printed on the card ("printName"). A name that fits is
               printed whole. One that does not is offered shortened by a
               fixed rule (initials for the middle names, then for every
               name but the last), and the reviewer confirms or edits it
               before the card is issued, because only a person can say
               which of "R. Muthuramalingam" and "Muthuramalingam R." is
               right. The server will not issue a name that does not fit.
     district  from the site's own list, printed without the old or other
     state     name in brackets ("Mysuru (Mysore)" prints "Mysuru"), and
               the few that are still too wide in a fixed short form.
     ID, date  fixed formats, always the same width.

   "Fits" is measured, not guessed. The card is the owner's Classical White
   template (24 Oct 2026, PFA_Caregiver_Classical_White.html), set in
   Absans Regular (fonts/absans-card.woff2: the template's own font, cut to
   the characters a card prints, with its kerning and without its
   f-ligatures, so a width can be added up letter by letter). The widths
   below are that font's own, in its units, with its own kerning pairs; the
   browser that draws the card and the server that issues it measure with
   the same numbers, so a name the server accepts is a name the card
   prints, on any device. Checked against Chromium's own layout of the
   template's font: the same to a hundredth of a pixel at 100 px.

   Units: the card is laid out in tenths of a millimetre (856 x 540 for
   85.6 x 54 mm, ISO/IEC 7810 ID-1), so every number here is in 0.1 mm.

   Pure, and shared by the browser and the server. No DOM, no canvas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFACardPrint = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* The characters a value on the card may carry: plain letters and digits,
     the space, and . , ' - / & ( ) :. A name with an accent prints without
     it (as a bank card does), a place is printed as the site's list spells
     it, and nothing else is ever drawn from another font at other widths. */
  var PRINTABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,\'-/&():';

  /* Absans Regular: advance widths by code point, in units of 1000 per em. */
  var UPM = 1000;
  var ADV = {
    32: 200, 38: 760, 39: 265, 40: 499, 41: 499, 44: 294, 45: 473, 46: 276, 47: 480, 48: 668, 49: 305, 50: 630,
    51: 626, 52: 618, 53: 659, 54: 633, 55: 556, 56: 600, 57: 633, 58: 276, 65: 758, 66: 694, 67: 776, 68: 716,
    69: 618, 70: 583, 71: 816, 72: 755, 73: 245, 74: 630, 75: 688, 76: 568, 77: 819, 78: 745, 79: 828, 80: 664,
    81: 828, 82: 734, 83: 670, 84: 665, 85: 695, 86: 718, 87: 948, 88: 764, 89: 688, 90: 616, 97: 560, 98: 634,
    99: 569, 100: 634, 101: 594, 102: 453, 103: 615, 104: 559, 105: 220, 106: 222, 107: 527, 108: 222, 109: 870, 110: 558,
    111: 604, 112: 633, 113: 633, 114: 455, 115: 500, 116: 422, 117: 558, 118: 537, 119: 697, 120: 557, 121: 537, 122: 469
  };

  /* Its kerning, for every pair of those characters that the font moves:
     the left letter, then each distance with the letters it applies to on
     the right (in font units; negative pulls the pair together). No pair
     with a space: a browser shapes each word on its own and never kerns
     across a space, so neither does this. */
  var KERN_BY_LEFT = {
    '&': { '-75': 'Y', '-71': ')', '-68': 'T', '-46': 'VW', '-39': '-', '-29': 'J', '-28': 'S', '-27': 'U', '-24': 't', '-21': 'v', '-20': 'CGOQf', '-15': 'cdeoq', '-12': 'BDEFHIKLMNPR', '-11': 'w', '-9': 's', '-7': 'agu', '-4': 'bhkly', '-3': 'Zijmnpr', '-2': 'X' },
    '\'': { '-132': '.,', '-106': '/', '-87': 'J', '-86': 'A', '-73': '&', '-66': '-', '-64': 'g', '-53': '4', '-49': 'cdeoq', '-47': 's', '-42': 'Samnpr', '-41': ')', '-40': '5', '-37': 'u', '-36': '06CGOQ', '-35': '28', '-34': '\'', '-32': '(BDEFHIKLMNPRz', '-31': '3', '-30': 'Ut', '-29': '9bhklx', '-28': 'ij', '-27': 'f', '-25': 'w', '-24': '7XZ', '-21': '1', '-20': 'vy', '-19': ':', '-15': 'VW', '-14': 'T', '-11': 'Y' },
    '(': { '-174': '-', '-107': '4', '-98': 'v', '-94': 'cdeoq', '-92': 'J', '-87': 'u', '-86': 's', '-83': 'aw', '-79': '&CGOQt', '-74': 'mnr', '-71': '06z', '-70': 'x', '-69': '(A', '-67': 'S', '-66': '2', '-54': '.9', '-51': ':38', '-50': '5', '-48': 'f1', '-42': '\'', '-40': 'U', '-33': 'BDEFHIKLMNPR', '-31': '7', '-27': 'TVWgi', '-25': 'Z', '-24': 'Y', '-23': 'X', '-22': 'pbhkl', '-8': 'y', '48': ')' },
    ')': { '-69': ')', '-51': 'T', '-47': 'Y', '-40': '/', '-36': '7', '-34': '\'', '-22': 'VW', '-17': 'X', '-11': '-', '-9': 'Z', '-8': 'A', '-5': 'J', '-3': ',', '-2': '15t', '2': 'U', '8': 'bhijklmnpr', '9': 'vy', '10': 'cdeoqw', '14': '06', '15': '3', '16': 's', '19': '9', '21': 'u', '22': '8', '24': 'a', '32': '(' },
    ',': { '-132': '\'', '-38': '-1', '-24': '7', '-17': '06', '-16': '5', '-9': '4', '-5': ')', '4': '3' },
    '-': { '-174': ')', '-101': 'T', '-94': 'Y', '-77': '7', '-68': '/', '-66': '\'X', '-63': 'V', '-59': 'W', '-55': 'x', '-53': 'Z', '-52': '1', '-49': 'z', '-47': 'ft', '-46': ',', '-44': '2', '-41': 'A', '-38': '.', '-37': 'g', '-36': '5', '-33': '9', '-32': 'BDEFHIKLMNPRvy', '-30': 'Us', '-28': 'abhijklmnpr', '-27': 'S', '-26': 'w', '-25': 'J', '-22': '3', '-21': '-u', '-19': 'CGOQ', '-18': '06', '-12': '8cdeoq', '-11': '(', '-9': '4' },
    '.': { '-132': '\'', '-103': 'Y', '-93': 'T', '-74': 'VW', '-54': ')', '-49': 'v', '-40': 't', '-38': '-1', '-35': 'f', '-24': '7w', '-23': 'CGOQ', '-20': 'U', '-17': '06', '-16': '5', '-10': '/', '-9': '4', '-2': 'BDEFHIKLMNPR', '2': 'z', '4': '3', '6': 'g', '7': 'Z', '16': 'Xx', '18': ':', '22': 'A' },
    '/': { '-144': '/', '-98': 'A', '-95': ',', '-89': '.', '-85': 'J', '-82': 'g', '-75': '-', '-71': '4', '-69': 'cdeoq', '-66': 's', '-58': 'a', '-46': 'mnpr', '-44': 'S', '-43': 'CGOQ', '-42': 'z', '-40': '(u', '-39': '026', '-37': 'x', '-36': '8t', '-35': '5', '-34': '3', '-33': '9f', '-31': 'vwy', '-26': '\'BDEFHIKLMNPR', '-25': 'U', '-22': '1', '-16': 'ij', '-12': 'X', '-10': '7Z', '-5': 'VWbhkl', '-4': 'T' },
    '0': { '-71': ')', '-66': '/', '-41': '7', '-36': '\'', '-34': 'Y', '-31': 'T', '-30': 'A', '-26': ',VWX', '-20': 'Z', '-18': '-', '-17': '.', '-16': 'g', '-11': '25', '-10': 'tx', '-9': 'z', '-8': 'J', '-5': 'f', '4': '6CGOQ', '5': '03', '7': 'u', '10': '4', '14': '8', '15': '(' },
    '1': { '-38': '/', '-33': ')', '-32': '\'-', '-30': 't', '-24': 'f', '-21': '&', '-16': ',J', '-15': 'g', '-12': '7', '-10': '5', '-9': 'cdemnopqr', '-7': 'v', '-6': 'su', '-5': 'bhkly', '-4': '4CGOQ', '-2': '.SVWw', '2': '9X', '5': '3UZ', '8': '8' },
    '2': { '-59': ')', '-54': '4', '-50': '-', '-36': '\'/', '-34': 'J', '-31': '&', '-28': 'cdeoq', '-24': '57', '-22': 'Ygt', '-21': 's', '-20': 'SVW', '-19': 'U', '-17': 'u', '-16': 'CGOQa', '-14': 'T', '-13': '06', '-12': 'v', '-11': 'fmnpr', '-3': ',bhijklw', '-2': '(', '8': '1' },
    '3': { '-69': ')', '-52': '/', '-46': '\'', '-40': '7', '-34': 'Y', '-33': 'VW', '-32': 't', '-31': 'T', '-29': '-', '-28': 'Xf', '-24': 'Ag', '-23': '5', '-20': 'Z', '-19': 'vxy', '-18': ',z', '-14': 'cdemnopqr', '-13': '2s', '-12': 'CGOQSa', '-11': '1w', '-8': 'bhijkl', '-6': '.JUu', '-5': 'BDEFHIKLMNPR', '-4': '06' },
    '4': { '-67': '\'', '-65': ')', '-54': 'T', '-50': 'Y', '-43': '7', '-41': 'VW', '-40': 'Xx', '-39': '/', '-35': 't', '-32': 'z', '-30': 'f', '-25': '1Z', '-17': 'y', '-16': 'gv', '-12': 's', '-8': 'w', '-5': '2bhkl', '-4': ',ijmnpr', '-2': 'a', '11': 'cdeoq', '13': '(', '14': 'BDEFHIKLMNPRU', '22': '3', '23': 'CGOQ', '30': '06', '49': '8', '63': '4' },
    '5': { '-52': '/', '-44': ')', '-39': '\'', '-35': 't', '-30': 'fx', '-27': '2z', '-24': 'Av', '-23': '1y', '-22': '5', '-20': '-', '-18': '7', '-17': ',Xg', '-16': 'w', '-15': 'mnpr', '-8': 'cdeoq', '-7': 'CGOQ', '-6': '9su', '-5': 'BDEFHIKLMNPRS', '-4': '06.TVW', '-3': ':Ua', '-2': 'JYbhkl', '6': '8', '12': '4' },
    '6': { '-54': ')', '-45': '/', '-30': '\'', '-18': 't', '-15': 'A', '-14': '-', '-13': 'x', '-6': ',', '-4': '7', '-2': '5', '8': '(', '14': '9', '20': '3', '25': '48' },
    '7': { '-112': 'J', '-110': '/', '-98': 'A', '-97': 'g', '-95': ',', '-90': '.', '-77': 's', '-75': 'cdeoq', '-73': 'a', '-71': '4-', '-55': 'mnpr', '-52': 'z', '-49': '&', '-48': 'u', '-44': 'x', '-42': 'CGOQ', '-37': 't', '-34': 'w', '-33': '06', '-32': '(fvy', '-31': '5)', '-30': 'S', '-23': '\'', '-21': '2', '-18': 'bhkl', '-15': '8:', '-14': '9', '-13': 'BDEFHIKLMNPR', '-12': '3', '-9': 'U', '-5': 'ij', '4': '1', '15': 'Y', '18': 'Z', '21': '7VW', '35': 'T' },
    '8': { '-52': ')', '-42': '/', '-36': '\'', '-25': '7', '-14': 't-', '-3': '5', '4': '2', '9': '6', '10': '1', '11': '0', '19': '(', '20': '9', '23': '4', '26': '3', '30': '8' },
    '9': { '-71': ')', '-66': '/', '-41': '7', '-36': '\'', '-34': 'Y', '-31': 'T', '-30': 'A', '-26': ',VWX', '-20': 'Z', '-18': '-', '-17': '.', '-16': 'g', '-11': '25', '-10': 'tx', '-9': 'z', '-8': 'J', '-5': 'f', '4': '06CGOQ', '5': '3', '7': 'u', '8': '4', '14': '8', '15': '(' },
    ':': { '-51': ')', '-27': 'Y', '-22': 'T', '-19': '\'', '-8': 'V', '-7': 'W', '7': '3', '22': 'A', '27': 'v' },
    'A': { '-101': 'Y', '-96': 'T', '-86': '\'', '-80': 'VW', '-69': ')', '-51': 'v', '-50': 't', '-41': '-', '-39': '1f', '-37': 'CGOQ', '-35': 'y', '-34': 'U', '-33': '5', '-29': '06w', '-25': '7', '-21': '/cdeoq', '-20': '&', '-19': '4', '-18': 'u', '-17': 'S', '-12': 'J', '-10': 'as', '-8': '(bhkl', '-7': 'ijmnpr', '5': 'x', '10': ',', '14': 'X', '21': 'Z', '22': '.:', '24': 'A' },
    'B': { '-70': ')', '-56': '/', '-48': '\'', '-43': '7', '-38': 'Y', '-36': 'VW', '-35': 'Tt', '-33': 'X', '-29': 'f', '-28': '-', '-27': '5A', '-25': 'gx', '-23': 'Z', '-22': '&z', '-20': ',', '-19': 'vy', '-18': '2mnpr', '-16': 'a', '-15': '1', '-14': 'CGOQcdeoq', '-13': 'Ssw', '-12': 'bhkl', '-11': '06BDEFHIKLMNPRUij', '-10': 'u', '-8': '.', '-7': ':J', '-4': '(' },
    'C': { '-68': ')', '-46': '/', '-30': '\'', '-28': '-', '-24': '7', '-23': 'Y', '-18': 'g', '-17': 'Xt', '-16': '&', '-15': '5', '-13': 'A', '-11': 'f', '-10': 'mnpr', '-9': 'VWz', '-8': 'sx', '-6': ',Tacdeoq', '-2': 'vy', '6': '(', '7': '06', '10': '9', '16': '1', '18': '8', '22': '3' },
    'D': { '-79': ')', '-70': '/', '-50': '7', '-49': 'Y', '-41': 'T', '-39': 'A', '-37': '\'X', '-33': ',VW', '-30': 'Z', '-23': '.', '-21': '2g', '-20': '&', '-19': '-', '-17': 'x', '-16': '5', '-15': 'z', '-14': 'J', '-10': 't', '-9': 'S', '-6': 'f', '-5': 'e', '-4': 'BDEFHIKLMNPR', '-3': 'bcdhijklmnopqr', '-2': 'Us', '3': '06', '6': '4' },
    'E': { '-31': '-/', '-29': '\'', '-27': '&J', '-26': ')t', '-25': 'v', '-23': '4S', '-20': 'u', '-19': '5cdeoq', '-16': 'f', '-14': 'w', '-13': 'U', '-12': 'sy', '-11': 'a', '-10': '2g', '-8': 'mnpr', '-7': '(', '-4': '06CGOQ', '-2': 'z', '6': 'A', '8': 'ij', '9': 'VW', '15': '7', '28': 'X', '35': 'T', '40': 'Z' },
    'F': { '-77': ',', '-75': '.', '-70': '/', '-53': 'J', '-52': 'A', '-46': 'g', '-28': 'x', '-26': ')', '-24': '&', '-22': 'mnprz', '-21': '-', '-19': 's', '-16': 't', '-13': 'Scdeoqu', '-12': '\'', '-10': '2', '-7': 'a', '-3': 'vy', '-2': 'w', '5': '8BDEFHIKLMNPR', '10': 'U', '13': '9ij', '21': 'CGOQ', '22': '06', '40': 'Y', '43': 'VW', '50': '7Z', '70': 'T' },
    'G': { '-75': ')', '-43': '\'', '-42': 'Y', '-41': '7', '-38': '/', '-35': 'T', '-34': 'VW', '-32': '-t', '-28': 'f', '-23': '&', '-22': '5', '-17': ',J', '-16': 'S', '-15': 'gmnpr', '-14': 'CGOQcdeoq', '-13': 'Zv', '-12': 's', '-11': 'z', '-10': 'U', '-9': 'x', '-8': 'y', '-7': 'ij', '-6': '06Xbhklu', '-5': '14a', '-4': 'w', '-2': '.BDEFHIKLMNPR' },
    'H': { '-38': '/', '-33': ')', '-32': '\'-', '-30': 't', '-24': 'f', '-21': '&', '-16': ',J', '-14': 'g', '-12': '7', '-10': '5cdeoq', '-9': 'mnpr', '-7': 'v', '-6': 'su', '-5': 'bhkly', '-4': '4CGOQ', '-2': '.Sw', '2': 'X', '5': 'UZ' },
    'I': { '-38': '/', '-33': ')', '-32': '\'-', '-30': 't', '-24': 'f', '-21': '&', '-16': ',J', '-14': 'g', '-12': '7', '-10': '5cdeoq', '-9': 'mnpr', '-7': 'v', '-6': 'su', '-5': 'bhkly', '-4': '4CGOQ', '-2': '.Sw', '2': 'X', '5': 'UZ' },
    'J': { '-68': '/', '-40': ')', '-34': 'A', '-31': ',', '-30': '\'-', '-28': 't', '-24': '&g', '-20': 'xz', '-19': '.f', '-18': 'J', '-13': 'Xcdemnopqr', '-12': '2s', '-10': '5', '-9': '7', '-7': 'Z', '-5': 'Sa', '-3': '4bhklu', '-2': 'CGOQvwy', '2': '(1', '5': 'BDEFHIKLMNPRT', '10': 'U' },
    'K': { '-54': '-', '-51': 'v', '-48': 't', '-41': '4', '-38': 'CGOQ', '-35': 'w', '-34': 'cdeoq', '-31': 'f', '-29': '06', '-26': '&\'', '-25': 'ys', '-23': 'u)', '-21': 'S', '-19': '/', '-17': 'J', '-15': 'U', '-14': '15a', '-13': '(', '-10': 'mnpr', '12': 'x', '13': ',', '17': 'ij', '25': '.:', '26': 'A', '37': 'X', '40': 'Z' },
    'L': { '-132': '\'', '-128': 'Y', '-118': 'T', '-108': 'V', '-98': 'W', '-86': '4', '-83': 'v', '-70': ')', '-69': '-', '-67': 't', '-56': 'f', '-52': 'w', '-48': 'y', '-43': 'CGOQ', '-38': '1', '-34': 'U', '-32': '06cdeoq', '-30': '5', '-24': '7u', '-23': '(', '-22': '&', '-20': 'bhkl', '-19': '/ijmnpr', '-14': 'a', '-13': 's', '-8': 'S', '-3': 'J', '-2': 'g', '2': 'Xx', '9': ',', '14': '2', '22': '.:', '28': 'A', '32': 'Z' },
    'M': { '-38': '/', '-33': ')', '-32': '\'-', '-30': 't', '-24': 'f', '-21': '&', '-16': ',J', '-14': 'g', '-12': '7', '-10': '5cdeoq', '-9': 'mnpr', '-7': 'v', '-6': 'su', '-5': 'bhkly', '-4': '4CGOQ', '-2': '.Sw', '2': 'X', '5': '3UZ' },
    'N': { '-38': '/', '-33': ')', '-32': '\'-', '-30': 't', '-24': 'f', '-21': '&', '-16': ',J', '-14': 'g', '-12': '7', '-10': '5cdeoq', '-9': 'mnpr', '-7': 'v', '-6': 'su', '-5': 'bhkly', '-4': '4CGOQ', '-2': '.Sw', '2': 'X', '5': 'UZ' },
    'O': { '-79': ')', '-70': '/', '-50': '7', '-49': 'Y', '-41': 'T', '-39': 'A', '-37': '\'X', '-33': ',VW', '-30': 'Z', '-23': '.', '-21': 'g', '-20': '&', '-19': '2-', '-17': 'x', '-16': '5', '-15': 'z', '-14': 'J', '-10': 't', '-9': 'S', '-6': 'f', '-4': 'BDEFHIKLMNPR', '-3': 'bcdehijklmnopqr', '-2': 'Us', '3': '06', '6': '4' },
    'P': { '-91': ',', '-89': '/', '-88': '.', '-86': 'J', '-85': 'A', '-58': ')', '-57': 'g', '-42': '-', '-40': '&', '-38': '4', '-35': 'cdeoq', '-30': 's', '-28': '5', '-27': 'a', '-26': 'Xmnpr', '-24': '\'', '-19': 'u', '-16': 'S', '-15': 'z', '-14': 'bhijkl', '-13': 'BDEFHIKLMNPR', '-10': 'Ut', '-7': '(Z', '-6': '7', '-5': 'fx', '-3': 'VWY', '-2': '06CGOQ', '6': ':', '15': '9', '34': '1' },
    'Q': { '-49': 'Y', '-41': 'T', '-39': ')', '-36': '\'', '-34': '7', '-33': 'V', '-32': 'W', '-29': '/', '-20': '&', '-18': '-', '-17': 'g', '-16': '5', '-14': 'J', '-10': 't', '-8': 'S', '-6': 'z', '-5': ',Zf', '-3': 'cdeoq', '-2': 'U', '3': '06', '6': '4', '13': '(', '20': 'y' },
    'R': { '-68': ')', '-50': '-', '-47': 'J', '-45': '\'', '-38': '&t', '-37': '4', '-36': '/', '-35': '7cdeoq', '-33': '5VW', '-32': 'Y', '-31': 'fg', '-30': 's', '-29': 'T', '-28': 'v', '-27': 'a', '-25': 'CGOQ', '-24': 'Uw', '-22': 'S', '-21': '06u', '-18': '(mnpr', '-17': 'bhkly', '-15': 'ij', '-14': '2', '-13': 'BDEFHIKLMNPRz', '-10': ',1', '-6': 'Z', '-2': '.x' },
    'S': { '-69': ')', '-47': '/', '-41': '\'', '-34': '7', '-32': 'Y', '-28': 'T', '-27': 'VW', '-25': 't', '-24': 'X', '-20': '-f', '-18': '5', '-16': 'g', '-15': '&Z', '-14': 'A', '-13': 'z', '-12': 'x', '-11': 'av', '-10': 'y', '-8': 'mnpr', '-7': 'cdeoqs', '-6': ',', '-3': 'CGOQij', '-2': '1SUbhklw', '10': '4', '11': '3', '14': '8' },
    'T': { '-141': 'J', '-120': 'mnpr', '-112': 'u,', '-111': 'g', '-108': 'a', '-107': 'cdeoq', '-106': '-', '-105': 'sv', '-103': 'yz/4', '-102': 'A', '-100': 'w', '-99': '.', '-95': 'x', '-66': 't', '-60': 'f', '-51': '(', '-48': '&', '-41': 'CGOQ', '-34': '06', '-27': ')S', '-22': ':', '-20': 'bhkl', '-19': '5', '-15': '2', '-14': '\'', '-7': 'ij', '5': 'U', '20': 'Y', '31': 'VW', '45': '7Z', '65': 'T' },
    'U': { '-68': '/', '-40': ')', '-34': 'A', '-31': ',', '-30': '\'-', '-28': 't', '-24': '&g', '-20': 'xz', '-19': '.f', '-18': 'J', '-13': 'Xcdemnopqr', '-12': '2s', '-10': '5', '-9': '7', '-7': 'Z', '-5': 'Sa', '-3': '4bhklu', '-2': 'CGOQvwy', '2': '(1', '5': 'BDEFHIKLMNPRT', '10': 'U' },
    'V': { '-110': '/', '-94': 'J', '-84': ',A', '-79': '.', '-78': 'g', '-65': '4cdeoq', '-63': '-', '-62': 's', '-59': 'a', '-50': 'mnpr', '-46': 'z', '-45': '&', '-43': 'u', '-38': 'x', '-33': 'CGOQ', '-32': 't', '-30': 'S', '-29': '06', '-27': ')', '-26': 'w', '-25': 'vy', '-24': '(', '-23': 'f', '-20': '25', '-13': '8', '-12': '\'', '-11': '3', '-8': ':', '-4': 'bhkl', '9': '1', '18': '7', '21': 'Z', '27': 'VW', '31': 'T', '33': 'Y' },
    'W': { '-105': '/', '-86': 'J', '-80': 'A', '-79': ',', '-74': '.g', '-62': '4', '-61': 'cdeoq', '-59': '-', '-55': 's', '-52': 'a', '-48': '&', '-47': 'mnpr', '-45': 'z', '-39': 'u', '-37': 'x', '-32': 'CGOQ', '-31': 't', '-28': 'S', '-27': ')', '-26': '06', '-24': 'vy', '-22': '5fw', '-21': '2(', '-15': '\'', '-12': '3', '-7': ':', '-6': 'bhkl', '-2': 'BDEFHIKLMNPR', '9': '1', '17': '7', '19': 'Z', '22': 'VW', '28': 'Y', '30': 'T' },
    'X': { '-66': '-', '-57': '4', '-53': 'v', '-44': 'cdeoqt', '-37': 'CGOQw', '-32': 'us', '-29': '&f', '-28': '06', '-27': 'a', '-26': 'J', '-25': 'S', '-24': '\'5', '-23': ')', '-22': '/y', '-21': 'mnpr', '-17': '(', '-15': '1', '-13': 'U', '-2': 'g', '2': 'BDEFHIKLMNPR', '3': 'Y', '6': 'bhkl', '13': 'A', '16': '.:', '19': 'ij', '38': 'X', '42': 'Z' },
    'Y': { '-143': 'J', '-114': ',', '-111': 'g', '-106': '/cdeoq', '-102': '.', '-101': 'A', '-100': 'as', '-98': '4', '-94': '-', '-87': 'mnpr', '-80': 'u', '-72': 'z', '-66': 'x', '-61': 'w', '-55': 'vy', '-54': 't', '-49': 'CGOQ', '-47': '(', '-45': '&', '-40': 'f', '-39': '06', '-29': 'S', '-27': ':', '-24': '2)', '-18': '9', '-17': '5', '-11': '\'', '-9': 'bhkl', '2': '7', '3': 'X', '12': 'Z', '20': 'T', '28': 'VW', '37': 'Y' },
    'Z': { '-71': '4', '-70': '-', '-44': 'cdeoq', '-34': 'v', '-33': 't', '-29': 'CGOQ', '-28': '/', '-25': ')au', '-24': '&sw', '-23': '\'', '-22': 'f', '-21': '06', '-20': 'J', '-18': 'mnpr', '-17': '5', '-16': 'y', '-15': 'g', '-13': 'S', '-11': '(', '-9': 'U', '5': 'BDEFHIKLMNPR', '6': 'bhkl', '7': '.', '8': '3:', '13': 'Y', '17': 'ij', '18': 'A', '20': 'VW', '21': '7', '34': 'X', '35': 'T', '50': 'Z' },
    'a': { '-110': 'Y', '-109': 'T', '-72': 'VW', '-70': ')', '-59': '\'', '-46': '7', '-35': 't', '-33': '-', '-32': '5', '-31': 'J', '-30': '1', '-27': 'v', '-26': 'U', '-25': 'S', '-24': 'f', '-23': '/', '-21': '&4CGOQ', '-16': '2', '-15': '306', '-13': 'y', '-10': 'cdeoq', '-9': 'w', '-6': 's', '-5': 'BDEFHIKLMNPR', '-3': 'g', '-2': 'Z', '3': 'A', '15': '.:' },
    'b': { '-107': 'Y', '-100': 'T', '-94': ')', '-73': '7', '-61': 'VW', '-50': '\'', '-45': '/', '-43': 'X', '-29': 'Z', '-27': '1', '-23': '2t', '-21': 'A', '-18': 'x', '-17': 'f', '-16': '5z', '-14': 'v', '-13': '-U', '-12': '&', '-11': 'y', '-9': 'BDEFHIJKLMNPRS', '-7': ',', '-5': 'g', '-3': 'CGOQ', '5': 'a', '10': '(' },
    'c': { '-105': 'T', '-95': 'Y', '-88': ')', '-64': '7', '-53': 'VW', '-38': '\'/', '-32': '-X', '-26': '1', '-22': '5', '-21': '4J', '-20': 'Z', '-19': '&', '-17': 't', '-15': '2SU', '-13': 'A', '-12': 'f', '-9': 'CGOQ', '-7': 'g', '-6': 'BDEFHIKLMNPR', '-5': 'v', '-2': '06wy', '2': '(' },
    'd': { '-35': '/', '-30': '\'', '-28': '-', '-23': 'Jt', '-22': ')7', '-20': 'T', '-17': '&', '-16': 'f', '-15': '5', '-13': '1', '-11': '4', '-10': ',', '-9': 'Yg', '-8': 'A', '-5': 'BDEFHIKLMNPR', '-4': 'VW', '-3': 'CGOQSU', '2': 'i', '6': 'XZ', '8': '(', '11': '3' },
    'e': { '-111': 'T', '-108': 'Y', '-91': ')', '-73': '7', '-60': 'VW', '-49': '\'', '-42': '/', '-35': 'X', '-34': '1', '-27': 't', '-25': 'Z', '-22': '25f', '-17': 'A', '-16': 'vx', '-15': 'zSy', '-14': 'J', '-12': '&-U', '-9': 'g', '-8': 'BDEFHIKLMNPRw', '-7': ',CGOQ', '-6': '06', '9': '(' },
    'f': { '-116': 'J', '-85': ',', '-80': './', '-71': 'A', '-55': 'g', '-53': '-', '-52': '4', '-34': 'cdeoq', '-32': '&', '-24': 's', '-19': 'amnpr', '-10': 'Su', '7': '1w', '9': 'BDEFHIKLMNPR', '12': 'v', '13': 'y', '14': 'U', '22': ':', '32': '7Z', '34': 'X', '52': 'TVW', '66': 'Y' },
    'g': { '-38': '-', '-36': '4', '-33': 'J', '-27': 't', '-25': '\'', '-24': '&', '-23': 'Y', '-20': ')', '-19': '5v', '-18': 'f', '-16': 'VWcdeoq', '-14': 'CGOQ', '-11': 'U', '-9': '06w', '-8': 's', '-7': 'a', '-6': 'Smnru', '-5': 'bhkl', '-4': '/', '-3': 'pT', '-2': '1', '16': '.', '17': ':', '18': 'Z' },
    'h': { '-105': 'T', '-102': 'Y', '-73': ')', '-54': '7', '-53': 'VW', '-47': '\'', '-30': '/', '-27': '1', '-23': 't', '-21': '-', '-18': 'f', '-17': '5', '-13': 'JX', '-12': '2&v', '-10': 'SU', '-7': 'Z', '-6': 'y', '-5': 'BDEFHIKLMNPR', '-2': 'CGOQg', '2': 'u', '5': 's', '8': 'a', '19': '(' },
    'i': { '-35': '/', '-28': '\'-', '-27': ')', '-23': 'J', '-22': 't', '-15': '&f', '-14': '5', '-10': '4', '-9': ',g', '-7': 'AT', '-5': '7', '-3': 'S', '-2': '1CGOQ', '2': 'bhijkl', '8': '(', '16': 'Z', '19': 'X' },
    'j': { '-28': '\'-', '-23': 'J', '-22': 't', '-16': '/', '-15': '&f', '-14': '5', '-10': '4', '-9': 'g', '-7': 'AT', '-5': '7', '-3': 'S', '-2': ',1CGOQ', '2': 'bhijkl', '8': '(', '16': 'Z', '19': 'X' },
    'k': { '-76': 'T', '-68': ')', '-61': 'Y', '-51': '-', '-39': '4', '-32': 'VW', '-26': '\'', '-24': 'J', '-21': '7', '-19': '&', '-17': '5', '-15': '/', '-13': 'cdeoq', '-9': 'U', '-7': 'CGOQ', '-2': '06', '2': 'Z', '5': 'w', '12': 'bhklvy', '13': '(ijmnpr', '14': '2', '20': ',', '22': 'X', '25': 'A', '31': '.', '33': ':', '41': 'z', '48': 'x' },
    'l': { '-35': '/', '-30': '\'', '-28': '-', '-23': 'Jt', '-22': ')7', '-20': 'T', '-17': '&', '-16': 'f', '-15': '5', '-13': '1', '-11': '4', '-10': ',', '-9': 'Yg', '-8': 'A', '-5': 'BDEFHIKLMNPR', '-4': 'VW', '-3': 'CGOQSU', '2': 'i', '6': 'XZ', '8': '(', '11': '3' },
    'm': { '-105': 'T', '-102': 'Y', '-73': ')', '-54': '7', '-53': 'VW', '-47': '\'', '-30': '/', '-27': '1', '-23': 't', '-21': '-', '-17': '5', '-16': 'f', '-13': 'JX', '-12': '2&v', '-10': 'SU', '-7': 'Z', '-6': 'y', '-5': 'BDEFHIKLMNPR', '-2': 'CGOQg', '2': 'u', '6': 's', '9': 'a', '19': '(' },
    'n': { '-105': 'T', '-102': 'Y', '-73': ')', '-54': '7', '-53': 'VW', '-47': '\'', '-30': '/', '-27': '1', '-23': 't', '-21': '-', '-18': 'f', '-17': '5', '-13': '2JX', '-12': '&v', '-10': 'SU', '-7': 'Z', '-6': 'y', '-5': 'BDEFHIKLMNPR', '-2': 'CGOQg', '2': 'u', '5': 's', '8': 'a', '19': '(' },
    'o': { '-107': 'Y', '-100': 'T', '-94': ')', '-73': '7', '-61': 'VW', '-50': '\'', '-45': '/', '-43': 'X', '-29': 'Z', '-27': '1', '-24': '2', '-23': 't', '-21': 'A', '-18': 'x', '-17': 'f', '-16': '5z', '-14': 'v', '-13': '-U', '-12': '&', '-11': 'y', '-9': 'BDEFHIJKLMNPRS', '-7': ',', '-5': 'g', '-3': 'CGOQ', '5': 'a', '10': '(' },
    'p': { '-107': 'Y', '-100': 'T', '-94': ')', '-73': '7', '-61': 'VW', '-50': '\'', '-45': '/', '-43': 'X', '-29': 'Z', '-27': '1', '-23': '2t', '-21': 'A', '-18': 'x', '-17': 'f', '-16': '5z', '-14': 'v', '-13': '-U', '-12': '&', '-11': 'y', '-9': 'BDEFHIJKLMNPRS', '-7': ',', '-5': 'g', '-3': 'CGOQ', '5': 'a', '10': '(' },
    'q': { '-112': 'T', '-87': 'Y', '-51': '7', '-47': 'VW', '-44': '\'', '-28': '-', '-27': '1', '-23': 'J', '-22': ')t', '-21': 'X', '-19': '5', '-17': '&Z', '-15': 'f', '-13': 'SU', '-10': '4', '-9': 'BDEFHIKLMNPRg', '-7': 'A', '-4': '/', '-3': 'CGOQ', '2': 'p', '8': '(' },
    'r': { '-145': ')', '-92': 'X', '-90': 'Z', '-88': '7', '-84': 'T', '-80': 'J', '-74': 'Y', '-71': ',/', '-67': '.', '-62': 'A', '-38': 'VW', '-36': 'g', '-34': '2', '-29': '3\'', '-27': '&S', '-24': '4', '-23': '-', '-22': '5', '-18': 'x', '-13': '1', '-11': 'eos', '-10': 'cdq', '-9': 'BDEFHIKLMNPR', '-4': 'Uz', '-2': 'abhijklmnprt', '2': '(', '25': ':' },
    's': { '-102': 'Y', '-100': 'T', '-85': ')', '-66': '7', '-55': 'VW', '-46': '\'', '-39': '/', '-26': '-', '-25': 'X', '-24': '1', '-21': 't', '-16': 'f', '-15': '5', '-14': 'Z', '-13': '2&', '-12': 'vy', '-10': 'U', '-9': 'A', '-7': 'g', '-6': 'JS', '-5': 'BDEFHIKLMNPR', '-4': 'xz', '5': 'u', '16': '(' },
    't': { '-83': 'T', '-74': ')', '-57': 'Y', '-37': '-', '-36': '7', '-33': 'VW', '-29': '\'', '-28': '/', '-25': '4', '-17': 'J', '-14': 'U', '-12': '5', '-8': '&', '-3': 'cdeoq', '-2': '06CGOQ', '4': 'a', '5': 'vy', '6': 'bhkls', '7': 'ijmnpr', '10': '(', '15': '.', '19': ':', '20': '3', '21': 'z', '30': 'x' },
    'u': { '-112': 'T', '-87': 'Y', '-74': ')', '-51': '7', '-47': 'VW', '-44': '\'', '-35': '/', '-28': '-', '-27': '1', '-23': 'J', '-22': 't', '-21': 'X', '-19': '5', '-17': '&Z', '-15': 'f', '-13': 'SU', '-10': '4', '-9': ',BDEFHIKLMNPRg', '-7': 'A', '-3': 'CGOQ', '8': '(' },
    'v': { '-98': ')T', '-85': '7', '-84': '/', '-57': 'J', '-55': 'YZ', '-54': ',', '-53': 'X', '-52': 'A', '-49': '.', '-32': '&-g', '-25': '4', '-24': 'VW', '-21': '5', '-20': '\'', '-15': 'S', '-14': 'cdeoq', '-13': 's', '-9': 'a', '-8': '2', '-7': 'BDEFHIKLMNPR', '-2': 'U', '2': 'x', '5': 'f', '9': '(', '13': 'w', '22': 'vy', '27': ':' },
    'w': { '-92': 'T', '-83': ')', '-64': '/', '-62': '7', '-61': 'Y', '-38': 'Z', '-37': 'X', '-35': ',J', '-30': 'A', '-26': '\'-', '-24': '.', '-22': '&VW', '-16': '5g', '-12': '4', '-3': 'BDEFHIKLMNPRS', '-2': 'U', '9': 'u', '10': '(', '13': 'vy', '18': 'w', '22': ':' },
    'x': { '-87': 'T', '-70': ')', '-66': 'Y', '-55': '-', '-47': '4', '-38': 'J', '-37': 'VW', '-32': '7', '-29': '\'', '-28': '&', '-27': '5', '-22': '/', '-21': 'U', '-17': 'CGOQcdeoq', '-16': 'S', '-11': '06', '-4': 'st', '-3': '1', '-2': 'ag', '2': 'vy', '5': 'A', '16': '.', '22': ':z', '42': 'x' },
    'y': { '-98': 'T', '-90': ')', '-85': '7', '-84': '/', '-57': 'J', '-55': 'YZ', '-54': ',', '-53': 'X', '-52': 'A', '-49': '.', '-32': '&-g', '-25': '4', '-24': 'VW', '-21': '5', '-20': '\'', '-15': 'S', '-14': 'cdeoq', '-13': 's', '-9': 'a', '-7': 'BDEFHIKLMNPR', '-2': 'U', '2': 'x', '5': 'f', '9': '(', '13': 'w', '22': 'vy', '27': ':' },
    'z': { '-96': 'T', '-72': 'Y', '-71': ')', '-44': '-7', '-42': '4VW', '-41': 'J', '-33': '\'', '-30': '5', '-29': '/', '-25': '&', '-22': 'S', '-18': 'U', '-16': 'cdeoq', '-11': 'CGOQ', '-10': 'g', '-9': '1t', '-8': '06', '-5': 's', '2': '.', '9': 'z', '10': ':', '22': 'x' }
  };
  var KERN = {};
  Object.keys(KERN_BY_LEFT).forEach(function (left) {
    var groups = KERN_BY_LEFT[left];
    Object.keys(groups).forEach(function (value) {
      var rights = groups[value];
      for (var i = 0; i < rights.length; i += 1) KERN[left + rights.charAt(i)] = Number(value);
    });
  });

  /* The value on each line: 25.34 (2.534 mm, the template's 7.2 pt), from the
     value column's left edge at 24.25 mm to its right edge at 53.90 mm,
     29.65 mm in all. A value that would need more is never wrapped onto a
     second line, where it would run into the row below: it is printed in
     its short form. Half a tenth of a millimetre is kept back. */
  var SIZE = 25.3407;
  var ROOM = 296.516;
  var LIMIT = ROOM - 0.5;

  /* Letters a name on the card may carry. */
  var NAME_OK = /^[A-Za-z][A-Za-z .'-]*$/;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /* Accents off, the way a bank card prints a name: "José" prints "Jose". */
  function plain(text) {
    var s = String(text == null ? '' : text);
    return typeof s.normalize === 'function' ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  }

  /* Every character is one the card prints. */
  function covered(text) {
    var s = String(text);
    for (var i = 0; i < s.length; i += 1) if (PRINTABLE.indexOf(s.charAt(i)) === -1) return false;
    return true;
  }

  /* The width of a line, in tenths of a millimetre, at the given size. */
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
    var first = String(word).replace(/^[^A-Za-z]+/, '').charAt(0);
    return first ? first.toUpperCase() + '.' : '';
  }

  /* The name as the card would print it, and how: { text, shortened, fits }.
     The name is taken as given (cased by the caller, as the register keeps
     it). Shortening is offered, never final: issuing needs the reviewer's
     yes. A single word too long for the line cannot be shortened by rule,
     and comes back with fits: false. */
  function suggestName(name) {
    var given = clean(name);
    /* accents off; anything else a card cannot print is left for a person */
    var full = clean(plain(given));
    if (!full) return { text: '', shortened: false, fits: false };
    /* a name that had to change at all (an accent taken off) is offered for
       the reviewer to confirm, like a shortened one */
    if (fits(full)) return { text: full, shortened: full !== given, fits: true };
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
    if (!NAME_OK.test(t)) return 'The name on the card can have letters A to Z, spaces, full stops, apostrophes and hyphens only.';
    if (!covered(t)) return 'The name on the card has a letter the card cannot print.';
    if (width(t) > LIMIT) return 'Too long for the card at its fixed size. Shorten it, for example with initials.';
    return '';
  }

  /* ---- the district and the state --------------------------------------- */

  /* The few that stay too wide without their bracket, in a fixed short form
     (the forms in common official use, or the first names as initials). */
  var PLACE_PRINT = {
    'Sahibzada Ajit Singh Nagar (Mohali)': 'SAS Nagar (Mohali)',
    'North and Middle Andaman': 'N. & M. Andaman',
    'South Salmara-Mankachar': 'S. Salmara-Mankachar',
    'Jayashankar Bhoopalpally': 'J. Bhoopalpally',
    'Komaram Bheem Asifabad': 'K. B. Asifabad',
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
    PRINTABLE: PRINTABLE,
    plain: plain,
    width: width,
    covered: covered,
    fits: fits,
    suggestName: suggestName,
    nameProblem: nameProblem,
    placeName: placeName,
    PLACE_PRINT: PLACE_PRINT
  };
}));
