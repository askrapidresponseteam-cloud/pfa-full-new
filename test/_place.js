'use strict';

/* An address every form now sends (owner, 24 Oct 2026: "filling in the
   address in mandatory. and it should be in the right format. and pincode
   has to be valid"). The five fields of the block assets/address.js puts on
   every form page, filled the way a person would: a house and street, a PIN
   that is in the state, the town, and a state and district from the list.
   Fixtures that stand for a real submission spread this in. */
const PLACE = Object.freeze({
  address: 'House 14, Barakhamba Road, Connaught Place',
  pincode: '110001',
  city: 'New Delhi',
  state: 'Delhi',
  district: 'New Delhi'
});

/* the same, for a fixture that says it is somewhere else */
const KOLKATA = Object.freeze({
  address: 'Flat 4B, 12 Park Street',
  pincode: '700016',
  city: 'Kolkata',
  state: 'West Bengal',
  district: 'Kolkata'
});

const placed = (fields, where) => Object.assign({}, fields, where || PLACE);

module.exports = { PLACE, KOLKATA, placed };
