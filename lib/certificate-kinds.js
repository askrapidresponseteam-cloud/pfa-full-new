'use strict';

/* The certificates PFA issues, for the server (owner, 15 Nov 2026: "create
   certificate variants for different purposes, with distinct colour
   options"). The one list is in assets/certificate.js, which draws them, so
   the words on a certificate and what the server checks and emails can
   never drift apart; this reads it from there.

     internship     PFA-INT-   Certificate of Completion, Remote Internship
     volunteer      PFA-VOL-   Certificate of Appreciation, for service
     participation  PFA-PAR-   Certificate of Participation, in a camp or event
     recognition    PFA-REC-   Certificate of Recognition, an award
     donor          PFA-DNR-   Certificate of Appreciation, for a gift

   Each number is the prefix and eight characters at random from the card
   numbers' alphabet. Each certificate keeps the colour it was issued in
   (gold, forest, blue or maroon), its purpose's own unless the panel chose
   another. */

const C = require('../assets/certificate.js').PFACertificate;

const KINDS = C.KINDS;
const COLOURS = C.COLOURS;
const NUMBER = C.NUMBER;

function kindOf(value) { return Object.prototype.hasOwnProperty.call(KINDS, value) ? value : ''; }
function colourOf(value) { return Object.prototype.hasOwnProperty.call(COLOURS, value) ? value : ''; }
function prefixOf(kind) { return KINDS[kindOf(kind) || 'internship'].prefix; }
function kindOfNumber(number) { return C.kindOf({ number }); }
/* "Certificate of Appreciation", and what it is, said in a sentence */
function titleOf(kind) { return KINDS[kindOf(kind) || 'internship'].words.title; }
function nounOf(kind) { return KINDS[kindOf(kind) || 'internship'].noun; }

module.exports = {
  KINDS, COLOURS, NUMBER, KIND_ORDER: C.KIND_ORDER, COLOUR_ORDER: C.COLOUR_ORDER,
  kindOf, colourOf, prefixOf, kindOfNumber, titleOf, nounOf, lineOf: C.lineOf, dayPrinted: C.dayPrinted
};
