/* Making sure a card never prints a hole.

   ---- the problem ---------------------------------------------------------

   Both renderers read their values straight off whatever they were handed and
   drew them. Most fields had a fallback; several did not. "Valid till " with
   nothing after it, an issue stamp that was the empty string, a Registered
   Address label with white space under it, a QR plate with no code in it - all
   of these were reachable, and all of them print.

   ---- what "never blank" can and cannot mean ------------------------------

   It is worth being exact, because there are two different things here and
   only one of them is solvable by code.

   Some fields are DERIVABLE. A validity date is the issue date plus a year; an
   issue stamp is the issue date in another format; the QR payload is built
   from the card number. When these are missing they should be computed, not
   papered over, and the card is then correct rather than merely non-empty.

   Some fields are NOT derivable. No amount of logic invents a person's name or
   their street. For those, "never blank" can only mean "never visually empty":
   the card shows a placeholder in the ghost colour, so the layout holds and a
   preview reads as a preview.

   Which is why this returns `missing` as well as the values. A placeholder is
   the right answer on a card nobody has paid for yet, and the wrong answer on
   an issued one - a Patron card printed with the words "Address line" on the
   back is worse than one that was never printed. Callers that issue cards are
   expected to look at `missing` and refuse; callers that draw previews are
   expected to ignore it. The renderers cannot tell the difference, so they do
   not try - they just draw what they are given, which is never empty.

   Pure, and shared by the browser and the tests. No DOM, no canvas. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFACardFields = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function clean(value) {
    return String(value === null || value === undefined ? '' : value).trim().replace(/\s+/g, ' ');
  }

  /* Accepts what the card actually carries - "Aug 2026", "22 August 2026" - as
     well as anything Date understands. Returns null rather than an Invalid
     Date, so callers cannot accidentally format NaN. */
  function parseWhen(value) {
    var text = clean(value);
    if (!text) return null;

    var monthYear = /^([A-Za-z]{3,})\s+(\d{4})$/.exec(text);
    if (monthYear) {
      var index = MONTHS.indexOf(monthYear[1].slice(0, 3).toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }));
      if (index > -1) return new Date(Number(monthYear[2]), index, 1);
    }
    var parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function monthYear(date) {
    return MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function plusYear(date) {
    var out = new Date(date.getTime());
    out.setFullYear(out.getFullYear() + 1);
    return out;
  }

  function stamp(date) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(date.getDate()) + pad(date.getMonth() + 1) + date.getFullYear();
  }

  /* ---- the Patron card --------------------------------------------------- */

  var PATRON_VERIFY = 'https://peopleforanimalsindia.org/api/verify-card?id=';
  var PATRON_SPECIMEN = 'PFA-MBR-SPECIMEN';

  function patron(raw, now) {
    var data = raw || {};
    var today = now || new Date();
    var missing = [];
    var ghost = {};

    var id = clean(data.id);
    if (!id) missing.push('id');

    var name = clean(data.name);
    if (!name) { name = 'Your Name'; missing.push('name'); ghost.name = true; }

    /* Dates: derive rather than placeholder. Either one gives the other, and
       if neither is present the card is being previewed, so today stands in -
       which is what it would say the moment it is bought. */
    var since = parseWhen(data.since);
    var valid = parseWhen(data.valid);
    if (!since && !valid) { since = today; valid = plusYear(today); missing.push('since', 'valid'); }
    else if (!since) { since = new Date(valid.getTime()); since.setFullYear(since.getFullYear() - 1); missing.push('since'); }
    else if (!valid) { valid = plusYear(since); missing.push('valid'); }

    var lines = (data.addressLines || [])
      .map(function (line) { return clean(line && line.text !== undefined ? line.text : line); })
      .filter(Boolean)
      .slice(0, 3);
    if (!lines.length) {
      lines = ['Address line', 'District, PIN', 'State'];
      missing.push('address');
      ghost.address = true;
    }

    if (!clean(data.photo)) { missing.push('photo'); ghost.photo = true; }

    return {
      id: id,
      idText: id || 'PFA-MBR-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
      serial: id ? id.replace(/^PFA-MBR-/, '').slice(-4).toUpperCase() : '\u2022\u2022\u2022\u2022',
      name: name,
      since: monthYear(since),
      valid: monthYear(valid),
      stamp: stamp(since),
      standing: clean(data.standing) || 'Patron',
      addressLines: lines,
      qr: PATRON_VERIFY + encodeURIComponent(id || PATRON_SPECIMEN),
      qrCaption: id ? 'Scan to verify' : 'Specimen',
      ghost: ghost,
      missing: missing,
      issuable: missing.length === 0
    };
  }

  /* ---- the Colony caregiver card ------------------------------------------------ */

  var CAREGIVER_CARD = 'https://peopleforanimalsindia.org/caregiver-card.html?id=';
  var CAREGIVER_SPECIMEN = 'PFA-CCT-SPECIMEN';

  function caregiver(raw, now) {
    var data = raw || {};
    var today = now || new Date();
    var missing = [];
    var ghost = {};

    var cardId = clean(data.cardId);
    if (!cardId) missing.push('cardId');

    var name = clean(data.name);
    if (!name) { name = 'Your Name'; missing.push('name'); ghost.name = true; }

    var address = clean(data.address ? String(data.address).replace(/\s*\n\s*/g, '\n') : '');
    var addressLines = address ? String(data.address).split('\n').map(clean).filter(Boolean) : [];
    if (!addressLines.length) {
      addressLines = ['Address line', 'District, PIN'];
      missing.push('address');
      ghost.address = true;
    }

    var mobile = clean(data.mobile);
    var email = clean(data.email);
    var contact = [mobile, email].filter(Boolean);
    if (!contact.length) {
      /* A colony caregiver card with no way to reach the caregiver defeats the point
         of carrying one, so this is always reported - but the section still
         has to occupy its space or the layout below it moves. */
      contact = ['Contact number'];
      missing.push('contact');
      ghost.contact = true;
    }

    var issued = parseWhen(data.issuedOn) || today;
    if (!clean(data.issuedOn)) missing.push('issuedOn');

    var year = clean(data.year) || String(issued.getFullYear());
    /* The district and state the card prints under its own labels (the
       face the chairperson approved, 24 Oct 2026: name, ID number, district,
       state, issued on). Not derivable, so a preview shows "Not given". */
    var district = clean(data.district);
    if (!district) { district = 'Not given'; missing.push('district'); ghost.district = true; }
    var state = clean(data.state);
    if (!state) { state = 'Not given'; missing.push('state'); ghost.state = true; }
    var two = function (n) { return (n < 10 ? '0' : '') + n; };

    return {
      cardId: cardId,
      idText: cardId ? 'ID \u00B7 ' + cardId.replace(/^PFA-CCT-/, '') : 'ID \u00B7 \u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
      district: district,
      state: state,
      /* as the card prints it: 24/10/2026 */
      issuedShort: two(issued.getDate()) + '/' + two(issued.getMonth() + 1) + '/' + issued.getFullYear(),
      name: name,
      year: year,
      addressLines: addressLines.slice(0, 4),
      address: addressLines.slice(0, 4).join('\n'),
      contactLines: contact,
      mobile: contact[0],
      email: contact[1] || '',
      issuedOn: issued.getDate() + ' ' + [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ][issued.getMonth()] + ' ' + issued.getFullYear(),
      role: clean(data.role) || 'Colony caregiver',
      /* Never empty: an unissued card carries a specimen code rather than a
         blank plate under a caption telling someone to scan it. It resolves to
         the same page and gets the honest answer for a card that does not
         exist. */
      qr: clean(data.qr) || CAREGIVER_CARD + encodeURIComponent(cardId || CAREGIVER_SPECIMEN),
      qrCaption: cardId ? 'Scan to view' : 'Specimen',
      ghost: ghost,
      missing: missing,
      issuable: missing.length === 0
    };
  }

  return {
    patron: patron,
    caregiver: caregiver,
    parseWhen: parseWhen,
    monthYear: monthYear,
    stamp: stamp
  };
}));
