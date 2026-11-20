#!/usr/bin/env node
'use strict';

/* Hands the RRT's invite-link key to the panel's server (owner, 19 Nov 2026:
   "where is the unique link").

   The RRT's deploy (rrt-platform deploy.sh) makes the key once and saves it to
   ~/Desktop/Keys and Secrets/rrt-pfa-referral.secret. This sets the same value
   as the Firebase secret PFA_RRT_REFERRAL_SECRET when it is not already that,
   so the panel registers each intern's code with the RRT and reads back its
   counts every six hours (lib/rrt-referrals.js). Run by scripts/ship.sh before
   scripts/firebase-secrets.js. Never prints the key.

   No file: says so and changes nothing. The CLI unreachable: the same. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT = 'pfa-new-website';
const NAME = 'PFA_RRT_REFERRAL_SECRET';
const FILE = process.env.PFA_RRT_KEY_FILE || path.join(os.homedir(), 'Desktop', 'Keys and Secrets', 'rrt-pfa-referral.secret');

function cli(args, input) {
  const opts = { encoding: 'utf8', input };
  const direct = spawnSync('firebase', args, opts);
  if (!direct.error) return direct;
  return spawnSync('npx', ['--yes', 'firebase-tools'].concat(args), opts);
}

function main() {
  let key = '';
  try { key = fs.readFileSync(FILE, 'utf8').trim(); } catch (_) {
    console.log(`  RRT invite counts: no key at ${FILE} yet. Deploy the RRT backend first (bash deploy.sh backend); its deploy saves it there.`);
    return 0;
  }
  if (key.length < 16) { console.log('  RRT invite counts: the key file is too short; nothing changed.'); return 0; }
  const now = cli(['functions:secrets:access', NAME, '--project', PROJECT]);
  if (now && now.status === 0 && String(now.stdout || '').trim() === key) {
    console.log('  RRT invite counts: the panel has the RRT key.');
    return 0;
  }
  const set = cli(['functions:secrets:set', NAME, '--project', PROJECT, '--data-file', '-', '--force'], key);
  if (set && set.status === 0) { console.log('  RRT invite counts: the RRT key is now set on the panel.'); return 0; }
  console.log('  RRT invite counts: the key could not be set just now; counts stay off until the next deploy.');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, FILE };
