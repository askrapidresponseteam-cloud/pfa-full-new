/* Field rules: one definition, used by the browser and by the API.

   Two copies of a validation rule always drift, and the day they drift is the
   day the form accepts something the database rejects (or worse, the other way
   round). So this file is loaded as a plain script in the page and required by
   the serverless routes, and there is exactly one definition of what a valid
   Indian mobile number is.

   Three things live here for every kind of field:

     filter(value)     what may be typed at all. Applied on every keystroke in
                       the browser, so a digit never lands in a name field and
                       a letter never lands in a PIN field.
     normalise(value)  the stored form. Names and addresses come out in Title
                       Case, mobiles as ten bare digits, emails in lowercase.
                       This runs on both sides, so a record looks the same
                       whether it was typed, pasted, fetched from the Location
                       button, or posted straight at the API.
     check(value)      the verdict on a normalised value: null when fine, a
                       plain-English message when not.

   A deliberate restraint: these rules check *form*, not plausibility. A number
   that is structurally a valid Indian mobile is accepted even if it looks
   unusual, because the cost of turning away a real person reporting an injured
   animal is far higher than the cost of one junk row an admin can delete. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFA_RULES = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- character classes ------------------------------------------------ */

  var hasUnicodeClasses = (function () {
    try { new RegExp('\\p{L}', 'u'); return true; } catch (e) { return false; }
  }());

  /* Letters from any script, so Devanagari, Tamil, Bangla and the rest are
     first-class, not tolerated. The fallback covers Latin plus the Indic
     blocks for the few engines without Unicode property escapes. */
  var L = hasUnicodeClasses ? '\\p{L}\\p{M}' : 'A-Za-z\\u00C0-\\u024F\\u0900-\\u0DFF';
  var U = hasUnicodeClasses ? 'u' : '';

  function re(source, flags) { return new RegExp(source, (flags || '') + U); }

  var LETTER = re('[' + L + ']');
  var TWO_LETTERS = re('[' + L + ']{2}');
  var WORD = re('[' + L + '0-9]+', 'g');

  /* ---- normalisers ------------------------------------------------------ */

  function squash(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /* Collapse spaces and tabs but keep line breaks: addresses print on cards. */
  function squashLines(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line, index, all) { return line || (index > 0 && all[index - 1]); })
      .join('\n')
      .trim();
  }

  /* Honorifics are always written Mr, Dr, Smt: never left in whatever case
     the keyboard happened to be in. */
  var HONORIFIC_SRC = 'mr|mrs|ms|dr|smt|shri|sri|km|adv|prof|er|ca|capt|col|maj|lt|gen|rev|sr|jr';
  var HONORIFIC = new RegExp('^(' + HONORIFIC_SRC + ')$', 'i');
  var ORDINAL = /^\d+(st|nd|rd|th)$/i;
  /* Initialisms that appear in Indian addresses and are wrong in any case
     but capitals, however they were typed: "mg road" is MG Road. */
  var INITIALISM = /^(mg|nh|sh|jp|bt|mp|kr|vv|hsr|bda|bbmp|dlf|hal|itpl|rmv|sbi|pfa|hbr|jnu|iit|aiims|ncr|cr|rt|gt|ss|gst)$/i;

  function capitalise(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  /* Title Case for a person's name or a postal address.

     "rAJESH kumAR" -> "Rajesh Kumar", "12b, mg road, o'connor st" ->
     "12B, MG Road, O'Connor St". The rules, in order:
       - a token with digits keeps its digits and capitalises its letters,
         so flat 12b becomes 12B, except ordinals (2nd) which stay lowercase
       - a short token already typed in capitals (MG, NH, SBI, PFA) is an
         initialism and is left alone, unless it is an honorific
       - everything else: first letter up, the rest down
     Tokens are split on anything that is not a letter or digit, so hyphens,
     apostrophes, slashes and commas are kept exactly where they were. */
  /* The little words of an address, written small inside it: "Near the
     Metro", "Bank of Baroda", "Daman and Diu". Each comma-separated part
     still starts with a capital. Not "a" ("Block A") and not "by" ("By Lane
     3" in Guwahati). */
  var SMALL = /^(the|of|and|to|in|on|at|for|from|with|or)$/i;
  function startsPart(all, at) {
    var before = all.slice(0, at).replace(/\s+$/, '');
    return !before || /[,\n(:;]$/.test(before);
  }
  function titleCase(value, mode) {
    var isName = mode === 'name';
    var text = String(value == null ? '' : value);
    /* An address typed in capitals throughout (owner, 25 Oct 2026: the
       location "captured perfectly") says nothing about which short words
       are initialisms: "NEAR THE METRO, NEW DELHI" is Near the Metro, New
       Delhi, not "Near THE Metro, NEW Delhi". The known initialisms (MG, DLF,
       NH) stay capitals. */
    var shouting = !isName && /[A-Z]/.test(text) && !/[a-z]/.test(text);
    return text.replace(WORD, function (word, at, all) {
      if (/\d/.test(word)) return ORDINAL.test(word) ? word.toLowerCase() : word.toUpperCase();
      if (HONORIFIC.test(word)) return capitalise(word);
      /* In a person's name every word is a word: RAO is Rao, DAS is Das.
         In an address a short run of capitals is an initialism. */
      if (isName) return capitalise(word);
      if (INITIALISM.test(word)) return word.toUpperCase();
      if (SMALL.test(word) && !startsPart(all, at)) return word.toLowerCase();
      if (!shouting && word.length <= 3 && word === word.toUpperCase() && word !== word.toLowerCase()) return word;
      return capitalise(word);
    });
  }

  /* A full stop in a person's name is an abbreviation mark and nothing else.
     It has earned its place after an initial (K. Srinivasan, A.R. Rahman, and
     the Southern habit of putting the initial last, Srinivasan K.) and after a
     recognised honorific (Dr. Rajesh). After an ordinary word it is a typo:
     "Rajesh Kumar." is not a name, and it used to be accepted here and printed
     on the card exactly as typed. Hyphens and apostrophes are held to the same
     standard: they join two letters (Jean-Luc, O'Connor) and mean nothing
     dangling at either end.

     Rather than test the string and hope, this pulls the name apart into runs
     of letters and runs of marks, then decides for each gap what, if anything,
     belongs there and rebuilds the name from that. Anything the rules cannot
     account for is simply not written back, so no stray mark survives by
     accident. */
  var NAME_PIECE = re('[' + L + ']+|[^' + L + ']+', 'g');

  function tidyName(value) {
    var pieces = squash(value).match(NAME_PIECE) || [];
    var out = '';
    var previous = '';
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (LETTER.test(piece)) { out += piece; previous = piece; continue; }

      /* A digit or a bracket is not a mark this rule knows how to place, and
         quietly dropping it would turn "Karthik Dhanya11" into a valid name.
         Anything unrecognised is written through untouched so that check()
         sees it and says so. */
      var stray = piece.replace(re("[\\s.'\\-]", 'g'), '');
      if (stray) { out += stray; previous = stray; continue; }
      if (!previous) continue;               /* marks before any letter: drop */

      var next = pieces[i + 1] || '';
      var join = '';
      if (piece.indexOf('.') > -1) {
        /* The stop stays only if the run before it is an initial or an
           honorific. Everywhere else it becomes the gap it should have been. */
        if (previous.length === 1 || HONORIFIC.test(previous)) join = '.';
      } else if (piece.indexOf('-') > -1) join = '-';
      else if (piece.indexOf("'") > -1) join = "'";

      if (!next) { out += (join === '.' ? '.' : ''); break; }
      if (join === '-' || join === "'") { out += join; continue; }
      /* Initials close up against each other (A.R.) but stand off a word that
         follows (A.R. Rahman, Dr. Rajesh, M.G. Ramachandran). */
      var tight = join === '.' && previous.length === 1 &&
        LETTER.test(next) && !TWO_LETTERS.test(next);
      out += join + (tight ? '' : ' ');
    }
    return squash(out);
  }

  var nameCase = function (v) { return titleCase(tidyName(v), 'name'); };

  /* Place names had the same hole and no guard against repeats at all, so
     "Bengaluru..." and "Ab&&&(((" both passed. Marks are collapsed and then
     dropped from the ends, with the exception of a closing bracket that has an
     opening one to answer to (Jammu (J&K)). */
  function tidyPlace(value) {
    var s = squash(value).replace(/([,.'&()-])\1+/g, '$1');
    var before;
    do {
      before = s;
      s = s.replace(re("^[ ,.'&()\\-]+"), '').replace(re("[ ,.'&(\\-]+$"), '');
      if (s.charAt(s.length - 1) === ')' && s.indexOf('(') < 0) s = s.slice(0, -1);
    } while (s !== before);
    return squash(s);
  }

  /* +91 98765 43210, 0091-98765-43210, 098765 43210 and 9876543210 are the
     same number written five ways. Store one of them.

     The country code comes off first, then the trunk 0, so a number written
     with both, +91-098765-43210 or 0091 098765 43210, is the same ten digits
     too (8 Oct 2026: it was left at thirteen and told its own sender that
     their mobile did not match). Only a number longer than ten digits is
     touched, so a ten-digit mobile that happens to start 91 is kept whole.
     Plain ES5, because the browser loads this file as it is. */
  function normaliseMobile(value) {
    var digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
    if (digits.length > 10) {
      if (digits.length >= 14 && digits.indexOf('0091') === 0) digits = digits.slice(4);
      else if (digits.length >= 13 && digits.indexOf('091') === 0) digits = digits.slice(3);
      else if (digits.length >= 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
      if (digits.length === 11 && digits.charAt(0) === '0') digits = digits.slice(1);
    }
    return digits;
  }

  function normaliseEmail(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '').toLowerCase();
  }

  function normaliseRef(value) {
    return squash(value).toUpperCase().replace(/\s/g, '');
  }

  function digitsOnly(value) {
    return String(value == null ? '' : value).replace(/[^\d]/g, '');
  }

  function stripMarkup(value) {
    return String(value == null ? '' : value).replace(/[<>{}\\|^~`]/g, '');
  }

  /* ---- primitives -------------------------------------------------------- */

  /* Indian mobile numbers are ten digits and begin 6, 7, 8 or 9. Landlines and
     service numbers are not mobiles and are rejected here on purpose. */
  var MOBILE = /^[6-9]\d{9}$/;

  /* A person's name: letters, then letters with the punctuation that really
     occurs in names. No digits, ever. */
  var NAME_CHARS = re('[^' + L + " .'\\-]", 'g');

  /* A name is words separated by single spaces, where a word is one of:
       a word proper   Rajesh, Jean-Luc, O'Connor  (marks sit between letters)
       initials        K.  A.R.
       an honorific    Dr.  Smt.
     Nothing else is a word, so a trailing stop, a floating stop and a dangling
     hyphen all fail here rather than being carried through to the card. */
  var NAME_WORD = '[' + L + ']+(?:[\'\\-][' + L + ']+)*';
  var NAME_INITIALS = '(?:[' + L + ']\\.)+';
  var NAME_TOKEN = '(?:' + NAME_INITIALS + '|(?:' + HONORIFIC_SRC + ')\\.|' + NAME_WORD + ')';
  var NAME_OK = re('^' + NAME_TOKEN + '(?: ' + NAME_TOKEN + ')*$', 'i');

  /* Initials and honorifics are not a name on their own: "A.R." and "Dr." need
     something to abbreviate. At least one word has to be a real word. */
  function hasRealWord(value) {
    var tokens = String(value).split(' ');
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].indexOf('.') > -1) continue;
      if (HONORIFIC.test(tokens[i])) continue;
      if (TWO_LETTERS.test(tokens[i])) return true;
    }
    return false;
  }

  function looksLikeName(value) {
    return NAME_OK.test(value) && hasRealWord(value);
  }

  /* A town, district or state: like a name, but ampersands and brackets do
     occur (Dadra & Nagar Haveli). A comma occurs too, because several fields
     ask for more than one - careers.html's is labelled "City and State you are
     based in" and shows "Lucknow, Uttar Pradesh" as the example. The comma was
     not in this set, so an applicant who typed what the page asked for was
     refused, in the browser by having it silently deleted and at the API with
     "Use letters only". Still no digits. */
  var PLACE_OK = re('^[' + L + '][' + L + " ,.'&()\\-]*$");
  var PLACE_CHARS = re('[^' + L + " ,.'&()\\-]", 'g');

  /* A street address: letters and digits with the punctuation that appears
     in one. Must contain letters, so "12345678" is not an address. */
  var ADDRESS_CHARS = re('[^' + L + "0-9 \\n,.'/#&()\\-]", 'g');

  /* A link pasted into a place or an address is kept exactly as pasted
     (24 Oct 2026: a Google Maps link reached gandhim's inbox as
     "Https//Maps.App.Goo.Gl/1XIQJUQVCKSLHJYK8GSTIC", its colon filtered
     out and every letter recased, and opened nothing). Only the words
     around it are tidied, and while a link is in the box nothing is
     filtered out of it as it is typed. */
  var HAS_LINK = /https?:|www\.|goo\.gl|maps\./i;
  var LINK_RUN = /(https?:\/\/\S+|(?:www\.|maps\.app\.goo\.gl\/|goo\.gl\/)\S+)/gi;
  function aroundLinks(value, tidy) {
    var text = String(value == null ? '' : value);
    if (!HAS_LINK.test(text)) return tidy(text);
    var out = '';
    var last = 0;
    var m;
    LINK_RUN.lastIndex = 0;
    while ((m = LINK_RUN.exec(text))) {
      out += tidyKeepingEdges(text.slice(last, m.index), tidy) + m[0];
      last = m.index + m[0].length;
    }
    return (out + tidyKeepingEdges(text.slice(last), tidy)).replace(/[ \t]{2,}/g, ' ').trim();
  }
  function tidyKeepingEdges(part, tidy) {
    if (!part.trim()) return part ? ' ' : '';
    return (/^\s/.test(part) ? ' ' : '') + tidy(part) + (/\s$/.test(part) ? ' ' : '');
  }

  /* Deliberately stricter than the browser's type=email, which accepts
     "a@b". Requires a dotted domain and forbids the doubled dots and edge
     dots that are almost always typos. */
  var EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
  function looksLikeEmail(value) {
    if (!EMAIL.test(value)) return false;
    if (value.indexOf('..') > -1) return false;
    if (value.length > 254) return false;
    return value.split('@')[0].length <= 64;
  }

  /* Indian PIN codes are six digits and never start with zero. */
  var PIN = /^[1-9]\d{5}$/;

  /* The identifier families the site issues. */
  var CARD_ID = /^PFA-CCT-[A-Z0-9]{8}$/;
  var MEMBER_ID = /^PFA-MBR-[A-Z0-9]{8}$/;

  /* ---- the rules --------------------------------------------------------- */

  /* Each rule:
       filter(value)    -> what is allowed to remain in the box while typing
       normalise(value) -> stored form
       max              -> hard length cap, also written to maxlength
       check(value)     -> message|null, on the normalised value, non-empty only.
     Emptiness is handled by `required` at the call site, so an optional field
     left blank is valid but an optional field filled badly is not. */
  var rules = {
    personName: {
      filter: function (v) { return String(v == null ? '' : v).replace(NAME_CHARS, ''); },
      normalise: nameCase,
      max: 80,
      check: function (v) {
        if (/\d/.test(v)) return 'A name cannot contain numbers.';
        if (v.length < 2) return 'Enter the full name.';
        if (v.length > 80) return 'Keep the name under 80 characters.';
        if (!NAME_OK.test(v)) return 'Use letters, with spaces, hyphens, apostrophes, or a full stop after an initial.';
        if (!hasRealWord(v)) return 'Enter the full name, not only initials.';
        return null;
      }
    },
    orgName: {
      filter: stripMarkup,
      normalise: squash,
      max: 120,
      check: function (v) {
        if (v.length < 2) return 'Enter the organisation name.';
        if (v.length > 120) return 'Keep the organisation name under 120 characters.';
        if (!LETTER.test(v)) return 'An organisation name needs at least one letter.';
        return null;
      }
    },
    mobile: {
      /* Typed one key at a time, "+91 98765 43210" passes through eleven and
         twelve digit states; the country code is dropped as soon as it makes
         the number too long, so the box never fills up with the prefix. */
      filter: function (v) {
        var digits = digitsOnly(v);
        while (digits.length > 10 && digits.charAt(0) === '0') digits = digits.slice(1);
        if (digits.length > 10 && digits.indexOf('91') === 0) digits = digits.slice(2);
        return digits.slice(0, 10);
      },
      normalise: normaliseMobile,
      max: 10,
      check: function (v) {
        if (!/^\d+$/.test(v)) return 'Use digits only, for example 9876543210.';
        if (v.length !== 10) return 'An Indian mobile number is 10 digits.';
        if (!MOBILE.test(v)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
        return null;
      }
    },
    email: {
      filter: function (v) { return String(v == null ? '' : v).replace(/\s/g, ''); },
      normalise: normaliseEmail,
      max: 254,
      check: function (v) {
        if (v.indexOf('@') < 0) return 'An email address needs an @ sign.';
        if (!looksLikeEmail(v)) return 'Check this email address, for example name@example.com.';
        return null;
      }
    },
    /* "Your email or mobile" fields accept either, and normalise whichever
       they were given. */
    contact: {
      filter: function (v) { return String(v == null ? '' : v).replace(/\s/g, ''); },
      normalise: function (v) {
        var s = squash(v);
        if (s.indexOf('@') > -1) return normaliseEmail(s);
        var m = normaliseMobile(s);
        return /^\d{10}$/.test(m) ? m : s;
      },
      max: 254,
      check: function (v) {
        if (v.indexOf('@') > -1) return looksLikeEmail(v) ? null : 'Check this email address, for example name@example.com.';
        if (/^[\d+\-() ]+$/.test(v)) return MOBILE.test(normaliseMobile(v)) ? null : 'An Indian mobile number is 10 digits, starting 6, 7, 8 or 9.';
        return 'Enter an email address or a 10-digit mobile number.';
      }
    },
    pin: {
      filter: function (v) { return digitsOnly(v).slice(0, 6); },
      normalise: digitsOnly,
      max: 6,
      check: function (v) {
        if (!/^\d+$/.test(v)) return 'A PIN code is digits only.';
        if (v.length !== 6) return 'A PIN code is 6 digits.';
        if (!PIN.test(v)) return 'A PIN code does not start with 0.';
        return null;
      }
    },
    otp: {
      filter: function (v) { return digitsOnly(v).slice(0, 6); },
      normalise: digitsOnly,
      max: 6,
      check: function (v) {
        return /^\d{6}$/.test(v) ? null : 'The code is 6 digits.';
      }
    },
    /* A town, district or state. Title Case, letters only. */
    place: {
      filter: function (v) { return String(v == null ? '' : v).replace(PLACE_CHARS, ''); },
      normalise: function (v) { return titleCase(tidyPlace(v)); },
      max: 60,
      check: function (v) {
        if (/\d/.test(v)) return 'A place name cannot contain numbers.';
        if (v.length < 2) return 'Enter at least two characters.';
        if (v.length > 60) return 'Keep this under 60 characters.';
        if (/[.'&-]{2}/.test(v)) return 'Check the punctuation in this place name.';
        if (!PLACE_OK.test(v)) return 'Use letters only, with spaces, hyphens or apostrophes.';
        return null;
      }
    },
    /* The door a courier knocks on (owner, 29 Oct 2026: "for all orders like
       ecom ones and card dispatches ask for proper mailing address including
       their house number"): a house or flat number, a house name, or both,
       with the building. "12", "Flat 4B, Sai Residency" and "Krishna Nilaya"
       are all a door; it must hold a letter or a digit. */
    house: {
      filter: function (v) { return String(v == null ? '' : v).replace(ADDRESS_CHARS, ''); },
      normalise: function (v) { return titleCase(squash(v)); },
      max: 80,
      check: function (v) {
        if (!/[0-9]/.test(v) && !LETTER.test(v)) return 'Add the house or flat number, or the house name.';
        if (v.length > 80) return 'Keep this under 80 characters.';
        return null;
      }
    },
    /* A locality or landmark ("Sector 12, near the temple"): letters and
       digits, Title Case. */
    locality: {
      filter: function (v) { v = String(v == null ? '' : v); return HAS_LINK.test(v) ? v : v.replace(ADDRESS_CHARS, ''); },
      normalise: function (v) { return aroundLinks(v, function (t) { return titleCase(squash(t)); }); },
      max: 120,
      check: function (v) {
        if (v.length < 2) return 'Enter at least two characters.';
        if (v.length > 120) return 'Keep this under 120 characters.';
        if (!LETTER.test(v)) return 'Add the name of the place, not just a number.';
        return null;
      }
    },
    address: {
      filter: function (v) { v = String(v == null ? '' : v); return HAS_LINK.test(v) ? v : v.replace(ADDRESS_CHARS, ''); },
      normalise: function (v) { return aroundLinks(v, function (t) { return titleCase(squashLines(t)); }); },
      max: 220,
      check: function (v) {
        if (v.replace(/\s/g, '').length < 8) return 'Enter the full address: house or building, street and area.';
        if (v.length > 220) return 'Keep the address under 220 characters.';
        if (!TWO_LETTERS.test(v)) return 'An address needs a street or locality name, not just numbers.';
        return null;
      }
    },
    amount: {
      filter: function (v) { return digitsOnly(v).slice(0, 9); },
      normalise: digitsOnly,
      max: 9,
      check: function (v) {
        var n = Number(v);
        if (!v || isNaN(n)) return 'Enter an amount in rupees.';
        if (n < 1) return 'Enter at least 1 rupee.';
        if (n > 10000000) return 'For a donation above 1 crore, please contact the office directly.';
        return null;
      }
    },
    reference: {
      filter: function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9-]/g, ''); },
      normalise: normaliseRef,
      max: 40,
      check: function (v) {
        if (v.length < 4) return 'Check the reference number.';
        if (!/^[A-Z0-9-]+$/.test(v)) return 'A reference is letters, numbers and hyphens.';
        return null;
      }
    },
    cardId: {
      filter: function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16); },
      normalise: normaliseRef,
      max: 16,
      check: function (v) {
        return CARD_ID.test(v) ? null : 'Check the card number, for example PFA-CCT-4K7M2QX9.';
      }
    },
    memberId: {
      filter: function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16); },
      normalise: normaliseRef,
      max: 16,
      check: function (v) {
        return MEMBER_ID.test(v) ? null : 'Check the Patron number, for example PFA-MBR-4K7M2QX9.';
      }
    },
    /* A PAN, for a donation receipt: five letters, four digits, a letter.
       donate.html checked this shape in the page and the API did not check it
       at all, so the one place it mattered - what gets printed on an 80G
       receipt - was guarded only by the browser. */
    pan: {
      filter: function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); },
      normalise: function (v) { return squash(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); },
      max: 10,
      check: function (v) {
        return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'A PAN is five letters, four digits and a letter, like ABCDE1234F.';
      }
    },
    handle: {
      filter: function (v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20); },
      normalise: function (v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20); },
      max: 20,
      check: function (v) {
        if (v.length < 3) return 'A handle is at least 3 characters.';
        if (!/^[a-z]/.test(v)) return 'A handle starts with a letter.';
        return null;
      }
    },
    shortText: {
      filter: stripMarkup,
      normalise: squash,
      max: 200,
      check: function (v) {
        if (v.length < 3) return 'Add a little more detail.';
        if (v.length > 200) return 'Keep this under 200 characters.';
        if (!LETTER.test(v)) return 'Use words here, not just numbers or symbols.';
        return null;
      }
    },
    /* A short free-text line that may legitimately be a number with a unit
       ("12 kg", "Rs 5 lakh"). */
    shortValue: {
      filter: stripMarkup,
      normalise: squash,
      max: 80,
      check: function (v) {
        return v.length > 80 ? 'Keep this under 80 characters.' : null;
      }
    },
    bio: {
      filter: stripMarkup,
      normalise: squash,
      max: 240,
      check: function (v) {
        return v.length > 240 ? 'Keep this under 240 characters.' : null;
      }
    },
    longText: {
      filter: stripMarkup,
      normalise: function (v) { return String(v == null ? '' : v).replace(/[ \t]+/g, ' ').trim(); },
      max: 2000,
      check: function (v) {
        if (v.length < 10) return 'Please write a little more so this can be acted on.';
        if (v.length > 2000) return 'Keep this under 2000 characters.';
        if (!LETTER.test(v)) return 'Use words here, not just numbers or symbols.';
        return null;
      }
    },
    /* A link someone pastes: a public post on the wall, a portfolio in a job
       application. Only http(s) is a link here. Anything else - a javascript:
       or data: scheme, a bare word - is refused, on the server as well as in
       the browser, so what reaches the panel can be opened as a link. */
    url: {
      filter: function (v) { return String(v == null ? '' : v).replace(/\s/g, ''); },
      normalise: function (v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ''); },
      max: 2000,
      check: function (v) {
        if (v.length > 2000) return 'Keep the link under 2000 characters.';
        var m = /^(https?):\/\/([^/?#]+)/i.exec(v);
        if (!m) return 'Paste the full link, starting with https://.';
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(m[2].replace(/^[^@]*@/, ''))) return 'Check the link: the site name does not look right.';
        return null;
      }
    },
    /* Free text with no minimum: a note at the end of a form, an answer to an
       application question, an aside. longText demands ten characters because
       a rescue report that short is not a report; "Yes, twice." is a whole
       answer to "have you done this before" and refusing it would be absurd. */
    note: {
      filter: stripMarkup,
      normalise: squashLines,
      max: 2000,
      check: function (v) {
        if (v.length > 2000) return 'Keep this under 2000 characters.';
        if (!LETTER.test(v)) return 'Use words here, not just numbers or symbols.';
        return null;
      }
    },
    /* A small count someone estimates: how many animals they feed. Digits
       only, and bounded, so "abcd" and 99999999 are both refused. */
    count: {
      filter: function (v) { return digitsOnly(v).slice(0, 4); },
      normalise: digitsOnly,
      max: 4,
      check: function (v) {
        if (!/^\d+$/.test(v)) return 'Use digits only, for example 12.';
        if (Number(v) > 9999) return 'Enter a number below 10000.';
        return null;
      }
    },
    /* A value chosen from a list rather than typed. The list itself is not
       here: it belongs to the form, and is passed to checkField as `options`
       so the browser and the API judge a choice against the same set. */
    choice: {
      filter: function (v) { return v; },
      normalise: squash,
      max: 80,
      check: function () { return null; }
    }
  };

  /* ---- which rule applies to which field --------------------------------- */

  /* Keyed by the field's name attribute, or its id when it has no name. Every
     data-entry control on the site should be findable here; a field that is
     not is only checked for length. */
  var byName = {
    /* people */
    name: 'personName', recipient: 'personName', fullName: 'personName',
    contactName: 'personName', nominee: 'personName',
    ctName: 'personName', ctRecipient: 'personName', lcRecipient: 'personName',
    patronName: 'personName', feedName: 'personName', gtlName: 'personName',
    pName: 'personName', eName: 'personName',
    playerName: 'personName', certPlayerName: 'personName',

    /* organisations */
    company: 'orgName', organisation: 'orgName', organization: 'orgName',

    /* phones */
    mobile: 'mobile', phone: 'mobile', whatsapp: 'mobile', altMobile: 'mobile',
    ctMobile: 'mobile', lcMobile: 'mobile', patronMobile: 'mobile',
    feedMobile: 'mobile', gtlMobile: 'mobile',

    /* email */
    email: 'email', ctEmail: 'email', patronEmail: 'email', feedEmail: 'email',
    gtlEmail: 'email', adminEmail: 'email',
    contact: 'contact',

    /* postal codes */
    pin: 'pin', pincode: 'pin', zip: 'pin',
    ctPin: 'pin', ctDeliveryPin: 'pin', lcDeliveryPin: 'pin',
    patronPin: 'pin', checkoutPin: 'pin',

    /* places: letters only */
    city: 'place', district: 'place', state: 'place',
    ctDistrict: 'place', ctState: 'place', patronDistrict: 'place',
    patronState: 'place', checkoutCity: 'place', checkoutState: 'place',
    feedDistrict: 'place', gtlCity: 'place', pCity: 'place', eCity: 'place',
    pState: 'place', eState: 'place', country: 'place',

    /* places that may carry a number */
    place: 'locality', locality: 'locality', area: 'locality',
    feedLocality: 'locality', caseLocation: 'locality',
    /* a postal address in parts: the door, then the street, then a landmark */
    house: 'house', giftHouse: 'house', street: 'locality', giftStreet: 'locality',
    landmark: 'locality', giftLandmark: 'locality', colony: 'locality',

    /* links */
    url: 'url', link: 'url', website: 'url', portfolio: 'url', video: 'url', videoUrl: 'url',

    /* street addresses */
    address: 'address', address1: 'address', address2: 'address',
    ctAddress: 'address', ctDeliveryAddress: 'address', lcDeliveryAddress: 'address',
    patronAddress: 'address', checkoutAddress1: 'address', checkoutAddress2: 'address',

    amount: 'amount', donationAmount: 'amount', patronAmount: 'amount',

    /* identifiers */
    cardId: 'cardId', lcCardId: 'cardId',
    memberId: 'memberId', patron: 'memberId', mId: 'memberId',
    trackId: 'reference', followRef: 'reference', verifyId: 'reference',
    reference: 'reference', clientRef: 'reference',
    mCode: 'otp', code: 'otp',
    handle: 'handle', pHandle: 'handle', eHandle: 'handle',

    /* short text */
    summary: 'shortText', title: 'shortText', problem: 'shortText',
    role: 'shortText', pRole: 'shortText', eRole: 'shortText',
    interest: 'longText',
    weight: 'shortValue', budget: 'shortValue',

    /* long text */
    details: 'longText', story: 'longText', question: 'longText',
    message: 'longText', description: 'longText', reason: 'longText',
    why: 'longText', gtlWhy: 'longText',
    bio: 'bio', pBio: 'bio', eBio: 'bio',

    /* The emergency handover form: written under pressure, so these accept a
       fragment ("10 minutes ago") rather than demanding a sentence. */
    caseEvent: 'shortText', caseTime: 'shortValue',

    /* ---- the rest of what the public forms actually post ----------------
       Every key below was read off the pages themselves. A key that is not
       in this map reaches the API checked for length and nothing else, which
       is how a cruelty report's own account of what happened, the place it
       happened and the person it names all used to arrive unexamined. */

    /* report.html */
    what: 'longText', location: 'locality', accused: 'shortValue', when: 'shortValue',
    /* get-involved.html, events.html, wall.html */
    notes: 'note', animals: 'count',
    /* careers.html: the application's own answers */
    background: 'note', unit: 'shortValue', zone: 'shortValue', roleId: 'shortValue',
    timeToApply: 'shortValue',
    'Q1 Poisoning and FIR refusal': 'note',
    'Q2 First ninety days': 'note',

    /* Chosen from a list, never typed. The allowed set travels with the
       check: see lib/submission-fields.js for the server's copy and the test
       that holds it to what the pages offer. */
    animal: 'choice', urgency: 'choice', topic: 'choice', wall: 'choice',
    travel: 'choice', pfaMember: 'choice', type: 'choice',

    /* ---- controls the pages identify by id rather than by name ----------
       get-involved.html and events.html prefix theirs, the caregiver card
       uses co*, and every follow-up box is fRef/fContact. Without
       these the browser had no rule to apply to a volunteer's name, an event
       town or a delivery PIN, so nothing was filtered as it was typed. */
    volName: 'personName', volCity: 'place', volWhen: 'shortValue', volNotes: 'note',
    evName: 'personName', evCity: 'place', evPlace: 'locality', evNotes: 'note',
    coName: 'personName', coCity: 'place', coPin: 'pin',
    fRef: 'reference', fContact: 'contact',
    cId: 'cardId',

    /* wall.html's note, and donate.html's own boxes */
    note: 'note', pan: 'pan',
    other: 'amount', usdOther: 'amount',
    fDist: 'place', fVill: 'locality', fPin: 'pin',

    /* donate.html's gift: who the certificate is for and where it is posted.
       The same rules the server applies in lib/payment.js parseDonation(). */
    giftTo: 'personName', giftAddress: 'address', giftPin: 'pin', giftEmail: 'email'
  };

  function ruleFor(fieldName, type) {
    var key = byName[fieldName];
    if (key) return rules[key];
    if (type === 'email') return rules.email;
    if (type === 'tel') return rules.mobile;
    if (type === 'select-one' || type === 'select') return rules.choice;
    return null;
  }

  function ruleName(fieldName, type) {
    if (byName[fieldName]) return byName[fieldName];
    if (type === 'email') return 'email';
    if (type === 'tel') return 'mobile';
    return null;
  }

  /* Validate one value. Returns null when fine, a message when not.
     `required` is handled here so both sides agree on what "empty" means. */
  function checkField(fieldName, rawValue, opts) {
    opts = opts || {};
    var rule = ruleFor(fieldName, opts.type);
    var value = rule ? rule.normalise(rawValue) : squash(rawValue);
    if (!value) {
      /* "nine eight seven" in a mobile field normalises to nothing. That is a
         malformed entry, not an empty one, and saying "this is needed" to
         someone who just typed something is the kind of message that makes
         people give up on a form. Judge what they actually typed. */
      var typed = squash(rawValue);
      if (typed && rule) return rule.check(typed) || 'Check this entry.';
      if (typed) return null;
      return opts.required ? (opts.emptyMessage || 'This is needed.') : null;
    }
    /* A value chosen from a list is judged against the list, not against a
       rule for typed text: "Cow or buffalo" is a perfectly good answer and no
       place-name rule would have it. Anything outside the list is refused,
       which is what stops a bypassed form posting its own options. */
    if (opts.options && opts.options.length) {
      for (var i = 0; i < opts.options.length; i++) {
        if (String(opts.options[i]) === String(value)) return null;
      }
      return opts.optionMessage || 'Choose one of the options offered.';
    }
    if (!rule) {
      return String(value).length > 2000 ? 'Keep this under 2000 characters.' : null;
    }
    return rule.check(value);
  }

  function normaliseField(fieldName, rawValue, type) {
    var rule = ruleFor(fieldName, type);
    return rule ? rule.normalise(rawValue) : squash(rawValue);
  }

  /* What the keystroke filter leaves in the box. */
  function filterField(fieldName, rawValue, type) {
    var rule = ruleFor(fieldName, type);
    if (!rule) return rawValue;
    var out = rule.filter(rawValue);
    return rule.max && out.length > rule.max ? out.slice(0, rule.max) : out;
  }

  /* Server-side helper: take a body and a list of [field, options] pairs and
     return either {ok:true, values} with every value normalised, or
     {ok:false, field, message} for the first problem. The API routes use this
     so none of them carries its own copy of a rule. */
  function parseFields(body, spec) {
    var values = {};
    for (var i = 0; i < spec.length; i++) {
      var field = spec[i][0];
      var opts = spec[i][1] || {};
      var raw = body ? body[opts.from || field] : '';
      var message = checkField(field, raw, opts);
      if (message) return { ok: false, field: field, message: message };
      values[field] = normaliseField(field, raw, opts.type);
    }
    return { ok: true, values: values };
  }

  return {
    rules: rules,
    byName: byName,
    ruleFor: ruleFor,
    ruleName: ruleName,
    checkField: checkField,
    normaliseField: normaliseField,
    filterField: filterField,
    parseFields: parseFields,
    titleCase: titleCase,
    nameCase: nameCase,
    squash: squash,
    squashLines: squashLines,
    normaliseMobile: normaliseMobile,
    normaliseEmail: normaliseEmail,
    isMobile: function (v) { return MOBILE.test(normaliseMobile(v)); },
    isEmail: function (v) { return looksLikeEmail(normaliseEmail(v)); },
    isPin: function (v) { return PIN.test(digitsOnly(v)); },
    isName: function (v) { return !/\d/.test(squash(v)) && looksLikeName(squash(v)); },
    isCardId: function (v) { return CARD_ID.test(normaliseRef(v)); },
    isMemberId: function (v) { return MEMBER_ID.test(normaliseRef(v)); }
  };
}));
