#!/usr/bin/env node
'use strict';

/* Settings handed to a deploy on its own command line, put into Firebase's
   Secret Manager on the way (owner, 25 Nov 2026: "i cant do it in parts..
   give me 1 zip and 1 cmd").

     PFA_SET_CCAVENUE_MERCHANT_ID=10880 ./DEPLOY.command

   Every variable named PFA_SET_<NAME>, where <NAME> is one of the secrets the
   function mounts (scripts/firebase-secrets.js KNOWN), is stored as the
   secret <NAME> before the function is deployed, so this same deploy mounts
   it. Only names are printed, never a value. Anything else named PFA_SET_ is
   ignored with a note. Never stops a release: a setting that could not be
   stored is said plainly, and the check at the end of the deploy lists it. */

const { spawnSync } = require('child_process');
const { KNOWN } = require('./firebase-secrets.js');

const PROJECT = 'pfa-new-website';

function setOne(name, value) {
  const args = ['functions:secrets:set', name, '--project', PROJECT, '--data-file=-', '--non-interactive'];
  let r = spawnSync('firebase', args, { input: value, encoding: 'utf8' });
  if (r.error) r = spawnSync('npx', ['--yes', 'firebase-tools'].concat(args), { input: value, encoding: 'utf8' });
  return r.status === 0;
}

function main(env) {
  const wanted = Object.keys(env).filter((k) => k.startsWith('PFA_SET_')).sort();
  if (!wanted.length) return 0;
  for (const k of wanted) {
    const name = k.slice('PFA_SET_'.length);
    const value = String(env[k] || '').trim();
    if (!KNOWN.includes(name)) { console.log(`  ${k}: ${name} is not a setting the site reads; left alone`); continue; }
    if (!value) { console.log(`  ${k}: empty; left alone`); continue; }
    console.log(setOne(name, value) ? `  ${name}: stored in Firebase` : `  ${name}: could not be stored (run \`firebase login\`?); the check at the end will list it`);
  }
  return 0;
}

module.exports = { main };
if (require.main === module) process.exit(main(process.env));
