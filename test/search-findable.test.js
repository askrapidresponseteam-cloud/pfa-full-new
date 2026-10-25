'use strict';

/* Everything on the site, findable.

   Owner, 25 Oct 2026: "ensure the search is truly google grade. any and all
   related works should be lookable/findable..".

   Held here, against the shipped engine and the shipped index:
     1. every row the index holds (a page, a section, a law, a document, a
        story, an honour, a design, a role, a record of PFA's work) comes
        back in the top three when its own title is searched;
     2. close to four hundred searches in the words people actually type,
        including the site's own words in other forms, typos, Hinglish and
        half-typed words, each find what they are after in the top three;
     3. the things that live only as items on a page (library documents,
        CineKind honours, shop designs, careers roles, membership tiers,
        event kinds) each have a row of their own, read from the pages
        themselves, so a new one is held to this without editing the test;
     4. the mechanisms that made the misses: a word that only appears deep
        in a page's text is still found; "cages" meets "cage" and "horses"
        meets "horse"; "racehorses" is found by "race horses"; typos fix to
        the nearer word; a one-word best bet made of little words ("work
        with pfa") is not handed every query that has that word in it.

   A query passes when one of the top three results starts with an address
   it accepts. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./_dom-shim.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let loaded = null;
function engine() {
  if (loaded) return loaded;
  const indexJson = read('search-index.json');
  const doc = createDocument('<html><body></body></html>');
  const win = {
    document: doc,
    location: { search: '', hash: '', pathname: '/index.html', href: 'https://x/' },
    navigator: {}, history: { replaceState() {}, pushState() {} },
    sessionStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    localStorage: null,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1,
    console, JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    Promise, Map, Set, URL, URLSearchParams,
    fetch: (u) => Promise.resolve({ ok: String(u) === 'search-index.json', json: () => Promise.resolve(JSON.parse(indexJson)) })
  };
  win.window = win; win.self = win; win.globalThis = win; doc.defaultView = win;
  vm.runInContext(read('pfa-search.js'), vm.createContext(win), { filename: 'pfa-search.js' });
  loaded = new Promise((resolve) => { setImmediate(() => setImmediate(() => resolve(win.PFASearch))); });
  return loaded;
}

const top3 = (S, q) => S.search(q, { limit: 5 }).rows.slice(0, 3);
const rows = () => JSON.parse(read('search-index.json')).rows;

const QUERIES = [
  /* What people type to reach a document, a story, a page */
  ['prevention of cruelty to animals act 1960', ['read.html?r=', 'library.html']],
  ['pca act', ['library.html', 'laws.html', 'read.html?r=pca-act-1960']],
  ['abc module', ['read.html?r=', 'library.html', 'read.html?r=revised-abc-module']],
  ['animal birth control module', ['read.html?r=', 'library.html']], ['handbook for urban local bodies', ['read.html?r=', 'library.html']],
  ['municipal animal law handbook', ['read.html?r=', 'library.html', 'read.html?r=animal-law-handbook-ulb']],
  ['delhi police handbook', ['read.html?r=', 'library.html']], ['police handbook animal laws', ['read.html?r=', 'library.html']],
  ['handbook for veterinary officers', ['read.html?r=', 'library.html']], ['cage free', ['read.html?r=', 'library.html', 'achievements.html']],
  ['cage-free eggs', ['read.html?r=', 'library.html']], ['pig farm practices', ['read.html?r=', 'library.html']],
  ['piggery handbook', ['read.html?r=', 'library.html', 'read.html?r=piggery-handbook-uttarakhand', 'read.html?r=hidden-costs-piggery']],
  ['gaushala', ['read.html?r=', 'library.html', 'achievements.html#rec-016', 'laws.html']], ['shvaan pashu', ['read.html?r=', 'library.html']],
  ['veterinary infrastructure standards', ['read.html?r=', 'library.html']], ['scc policy brief', ['read.html?r=', 'library.html']],
  ['hidden costs of piggery', ['read.html?r=', 'library.html']], ['lucknow abc training', ['read.html?r=', 'library.html']],
  ['gadhimai', ['newsroom.html', 'achievements.html#rec-011']], ['gadhimai sacrifice', 'newsroom.html'],
  ['roofed turtle chandigarh', 'newsroom.html'], ['kite string birds', 'newsroom.html'],
  ['manja injured birds', ['newsroom.html', 'academy.html', 'laws.html']], ['donkeys dehradun', 'newsroom.html'],
  ['pig housing rishikesh', 'newsroom.html'], ['wild animals rescued bengaluru', 'newsroom.html'], ['vip visit', 'newsroom.html'],
  ['case 001', 'newsroom.html'], ['cinekind second edition', ['newsroom.html', 'cinekind.html']],
  ['john abraham', ['cinekind.html', 'cinekind.html#h26-04']], ['raveena tandon', ['cinekind.html', 'cinekind.html#h26-05']],
  ['anant ambani', ['cinekind.html', 'cinekind.html#h26-01']], ['riteish genelia', 'cinekind.html'], ['wamiqa gabbi', 'cinekind.html'],
  ['kalyan varma', ['cinekind.html', 'cinekind.html#h26-07']], ['nikhar juneja', 'cinekind.html'],
  ['cinekind 2025 kolkata', ['cinekind.html', 'events.html', 'events.html#event-001']], ['cinekind nominations', 'cinekind.html'],
  ['film awards for animals', 'cinekind.html'], ['nominate a film', 'cinekind.html'], ['sabyasachi', ['shop.html', 'shop.html#sabyasachi']],
  ['masaba', ['shop.html', 'shop.html#masaba-gupta']], ['raw mango', ['shop.html', 'shop.html#raw-mango']],
  ['jj valaya', ['shop.html', 'shop.html#jj-valaya']], ['tshirt', 'shop.html'], ['t-shirt', 'shop.html'], ['merchandise', 'shop.html'],
  ['designer tees', 'shop.html'], ['adoption drive', ['events.html', 'events.html#request']], ['vaccination camp', ['events.html', 'academy.html']],
  ['open day', ['events.html', 'events.html#request']], ['events near me', 'events.html'], ['volunteer', 'get-involved.html'],
  ['membership', 'get-involved.html'], ['lifetime membership', 'get-involved.html'], ['platinum member', 'get-involved.html'],
  ['student membership', ['get-involved.html', 'get-involved.html#membership']], ['membership fee', 'get-involved.html'],
  ['colony caregiver card', ['get-involved.html', 'caregiver-card.html']], ['feeder id card', 'get-involved.html'],
  ['card for feeding street dogs', 'get-involved.html'], ['jobs', 'careers.html'], ['vacancies', 'careers.html'],
  ['veterinarian job', 'careers.html'], ['work at pfa', 'careers.html'], ['internship', 'careers.html'], ['donate', 'donate.html'],
  ['80g', 'donate.html'], ['tax exemption donation', 'donate.html'], ['donate in dollars', 'donate.html'], ['gift a donation', 'donate.html'],
  ['monthly donation', 'donate.html'], ['corporate partnership', 'csr.html'], ['csr', 'csr.html'], ['will bequest', 'legacy.html'],
  ['leave money in my will', 'legacy.html'], ['birthday fundraiser', 'campaign.html'], ['start a fundraiser', 'campaign.html'],
  ['dog bite law', 'laws.html'], ['can my society stop me feeding dogs', 'laws.html'], ['punishment for animal cruelty', 'laws.html'],
  ['killing stray dogs', 'laws.html'], ['abc rules 2023', ['laws.html', 'read.html?r=', 'library.html']], ['bns 325', 'laws.html'],
  ['ipc 428', 'laws.html'], ['pet shop rules', ['laws.html', 'achievements.html']], ['cow slaughter', ['laws.html', 'achievements.html']],
  ['bird trade', ['laws.html', 'achievements.html']], ['can landlord ban pets', 'laws.html'], ['relocating street dogs', 'laws.html'],
  ['first aid for dogs', 'academy.html'], ['tick fever', 'academy.html'], ['parvo', 'academy.html'], ['rabies vaccine', 'academy.html'],
  ['snake bite dog', 'academy.html'], ['heat stroke dog', 'academy.html'], ['injured bird', ['academy.html', 'report.html', 'units.html']],
  ['pfa bangalore', 'units.html?q=Bangalore'], ['unit in delhi', 'units.html'], ['hyderabad', 'units.html'],
  ['animal hospital mumbai', 'units.html'], ['sanjay gandhi animal care centre', 'sgacc.html'], ['raja garden', 'sgacc.html'],
  ['animal hospital delhi', ['sgacc.html', 'units.html']], ['report cruelty', 'report.html'],
  ['complaint against neighbour hitting dog', 'report.html'], ['file fir for animal cruelty', ['report.html', 'laws.html']],
  ['track my complaint', 'track.html'], ['application status', 'track.html'], ['contact pfa', ['ask.html', 'units.html']],
  ['phone number', ['ask.html', 'units.html']], ['maneka gandhi', 'founder.html'], ['founder', 'founder.html'],
  ['achievements', 'achievements.html'], ['policies', 'achievements.html'], ['campus society', 'campus.html'], ['college club', 'campus.html'],
  ['quiz', 'quiz.html'], ['test my knowledge', 'quiz.html'], ['lab animal testing', 'lab-animal-rules.html'], ['privacy policy', 'privacy.html'],
  ['the wall', 'wall.html'], ['videos', 'wall.html'], ['volunter', 'get-involved.html'], ['membrship', 'get-involved.html'],
  ['donat', 'donate.html'], ['gadimai', 'newsroom.html'], ['sabyasachhi', 'shop.html'], ['cinekind awards', 'cinekind.html'],
  ['cine kind', 'cinekind.html'], ['tee shirt', 'shop.html'], ['kutta', ['report.html', 'units.html', 'academy.html', 'laws.html']],
  ['gau shala', ['read.html?r=', 'library.html']], ['maneka', 'founder.html'],
  /* Harder: the words people use, not the site's */
  ['feather bank', 'newsroom.html'], ['sashastra seema bal', ['newsroom.html', 'achievements.html']], ['pashulok', 'newsroom.html'],
  ['schedule i turtle', 'newsroom.html'], ['paresh maity', 'cinekind.html'], ['cinekind trophy', 'cinekind.html'],
  ['world animal day', ['cinekind.html', 'events.html']], ['the leela mumbai', 'cinekind.html'],
  ['happy home sanctuary', ['achievements.html', 'newsroom.html', 'units.html']], ['zonal head', ['careers.html', 'careers.html#zonal-head']],
  ['14 ashoka road', ['careers.html', 'ask.html']], ['80g certificate', 'donate.html'], ['jallikattu', ['laws.html', 'achievements.html']],
  ['circus animals', ['achievements.html', 'laws.html']], ['frog dissection', ['achievements.html', 'laws.html']],
  ['maggots in wound', 'academy.html'], ['dehydration dog', 'academy.html'], ['broken leg dog', 'academy.html'],
  ['monkey menace', ['laws.html', 'achievements.html', 'report.html']], ['film federation of india', ['cinekind.html', 'newsroom.html']],
  ['kooran film', ['cinekind.html', 'newsroom.html']], ['maa ka doodh', 'cinekind.html'],
  ['rupali ganguly', ['cinekind.html', 'cinekind.html#h25-03']], ['sankranti birds', ['newsroom.html', 'academy.html']],
  ['fur trade', ['achievements.html', 'laws.html']], ['leather', ['achievements.html', 'laws.html']],
  ['foie gras', ['achievements.html', 'achievements.html#rec-053']], ['tonga horse', 'laws.html'],
  ['elephant in temple', ['laws.html', 'achievements.html']], ['zoo', ['laws.html', 'achievements.html', 'academy.html']],
  ['diwali crackers dog', 'academy.html'], ['anti rabies vaccine', 'academy.html'], ['deworming puppies', 'academy.html'],
  ['ticks on dog', 'academy.html'], ['mange', 'academy.html'], ['can dogs eat chocolate', 'academy.html'], ['grapes toxic', 'academy.html'],
  ['onion poisoning dog', 'academy.html'], ['dog in lift', 'laws.html'], ['rwa fine for feeding dogs', 'laws.html'],
  ['neighbour complains about barking', 'laws.html'], ['cattle on road', ['laws.html', 'academy.html', 'report.html']],
  ['who started pfa', 'founder.html'], ['when was pfa founded', ['founder.html', 'achievements.html']],
  ['pfa head office address', ['ask.html', 'units.html', 'careers.html']], ['pfa email', ['ask.html', 'units.html']],
  ['how do i become a member', 'get-involved.html'], ['how much is membership', 'get-involved.html'], ['can i get a tax receipt', 'donate.html'],
  ['donate from usa', 'donate.html'], ['donate in memory of my dog', 'donate.html'],
  ['what is the colony caregiver card', ['get-involved.html', 'caregiver-card.html']],
  ['check a caregiver card', ['caregiver-card.html', 'get-involved.html']], ['is my application approved', 'track.html'],
  ['where is my card', ['track.html', 'caregiver-card.html']], ['street dog bit my child', ['laws.html', 'academy.html']],
  ['dog bite first aid', 'academy.html'], ['cat stuck in tree', ['academy.html', 'units.html', 'ask.html', 'report.html']],
  ['puppy found abandoned', ['academy.html', 'report.html', 'laws.html']], ['kitten care', 'academy.html'],
  ['old dog care', ['academy.html', 'sgacc.html']], ['cow eating plastic', ['academy.html', 'laws.html', 'achievements.html']],
  ['camel', ['achievements.html', 'laws.html', 'achievements.html#rec-003']], ['donkey', ['laws.html', 'newsroom.html', 'achievements.html']],
  ['pig farming', ['newsroom.html', 'read.html?r=', 'library.html', 'achievements.html']],
  ['poultry', ['achievements.html', 'laws.html', 'read.html?r=']], ['bird cages', ['laws.html', 'achievements.html']],
  ['parrot in cage illegal', 'laws.html'], ['selling birds', ['laws.html', 'achievements.html']],
  ['kutta ghayal', ['report.html', 'units.html', 'academy.html']], ['gaay ko maar raha', ['report.html', 'laws.html']],
  ['billi bimar', 'academy.html'], ['janwar ka hospital', ['units.html', 'sgacc.html']], ['kanoon kutte', 'laws.html'], ['naukri', 'careers.html'],
  ['volunteering in delhi', ['get-involved.html', 'units.html']], ['volunteer for animal shelter', ['get-involved.html', 'sgacc.html']],
  ['visit the shelter', ['sgacc.html', 'units.html']], ['adopt a dog delhi', ['sgacc.html', 'units.html', 'events.html']], ['sgacc', 'sgacc.html'],
  ['csr partnership 80g', ['csr.html', 'donate.html']], ['company tie up', 'csr.html'], ['schools program', ['campus.html', 'events.html']],
  ['students club', 'campus.html'], ['write to government lab animals', 'lab-animal-rules.html'], ['object to draft rules', 'lab-animal-rules.html'],
  ['someone not something', 'someone.html'], ['animal sentience', ['someone.html', 'quiz.html']],
  ['are fish sentient', ['someone.html', 'quiz.html', 'academy.html']], ['privacy', 'privacy.html'], ['data protection', 'privacy.html'],
  ['cookies', 'privacy.html'], ['sabyasachi tshirt price', 'shop.html'], ['logo t shirt', 'shop.html'], ['charcoal tee', 'shop.html'],
  /* PFA's work: every record in the achievements, asked for in plain words */
  ['cosmetics tested on animals', 'achievements.html#rec-001'], ['makeup animal testing ban', 'achievements.html#rec-001'],
  ['shark fin', 'achievements.html#rec-002'], ['camels rajasthan', 'achievements.html#rec-003'],
  ['frog dissection school', ['achievements.html#rec-004', 'achievements.html#rec-069']],
  ['dissection', ['achievements.html#rec-004', 'achievements.html#rec-069']],
  ['kedarnath mules', ['achievements.html#rec-006', 'achievements.html#rec-028', 'achievements.html#rec-045']],
  ['char dham ponies', 'achievements.html#rec-006'], ['animals in floods', ['achievements.html#rec-007', 'achievements.html#rec-045']],
  ['disaster rescue animals', 'achievements.html#rec-007'], ['nepal animal sacrifice', 'achievements.html#rec-011'],
  ['animal sacrifice', ['achievements.html#rec-011', 'achievements.html#rec-071']],
  ['dog breeders rules', ['achievements.html#rec-012', 'laws.html#a16']], ['pet shop', 'achievements.html#rec-015'],
  ['pet shops rules', 'achievements.html#rec-015'], ['cattle market rules', ['achievements.html#rec-013', 'laws.html#b18']],
  ['pig farm', ['achievements.html#rec-018', 'achievements.html#rec-019', 'achievements.html#rec-086']],
  ['pigs', ['achievements.html#rec-019', 'achievements.html#rec-018', 'achievements.html#rec-085', 'achievements.html#rec-086', 'achievements.html#rec-084']],
  ['indiamart crates', 'achievements.html#rec-020'],
  ['cage free eggs', ['achievements.html#rec-024', 'achievements.html#rec-092', 'achievements.html#rec-093', 'achievements.html#rec-023']],
  ['battery cages', ['achievements.html#rec-024', 'achievements.html#rec-092', 'achievements.html#rec-023', 'laws.html']],
  ['yamuna dairies', 'achievements.html#rec-025'], ['oxytocin injection cows', ['achievements.html#rec-026', 'laws.html#b14', 'academy.html#b7']],
  ['oxytocin', 'achievements.html#rec-026'], ['icar', 'achievements.html#rec-027'], ['horse hospital rudraprayag', 'achievements.html#rec-028'],
  ['sanctuary', ['achievements.html#rec-029', 'sgacc.html']], ['abc training centre', 'achievements.html#rec-031'],
  ['sonepur mela', 'achievements.html#rec-033'], ['sonpur', 'achievements.html#rec-033'], ['travelling zoo', 'achievements.html#rec-034'],
  ['bullfight goa', 'achievements.html#rec-035'], ['dhirio', 'achievements.html#rec-035'],
  ['animals in movies', ['achievements.html#rec-037', 'achievements.html#rec-036', 'cinekind.html', 'laws.html']],
  ['film shooting animals noc', ['achievements.html#rec-037', 'achievements.html#rec-036', 'laws.html']],
  ['circus', ['achievements.html#rec-038', 'achievements.html#rec-039']],
  ['circus elephants', ['achievements.html#rec-038', 'achievements.html#rec-039', 'achievements.html#rec-070']],
  ['juhu beach camels', 'achievements.html#rec-040'], ['horse racing whip', ['achievements.html#rec-041', 'laws.html#d15']],
  ['race horses', 'achievements.html#rec-041'], ['bullock cart race', 'achievements.html#rec-042'],
  ['police cruelty case help', ['achievements.html#rec-043', 'achievements.html#rec-048', 'report.html', 'laws.html']],
  ['animal transport trucks', ['achievements.html#rec-044', 'laws.html']],
  ['overloaded truck cattle', ['achievements.html#rec-044', 'laws.html', 'report.html']], ['3rs testing', 'achievements.html#rec-047'],
  ['three rs', 'achievements.html#rec-047'], ['police training', 'achievements.html#rec-048'], ['judges training', 'achievements.html#rec-049'],
  ['ahimsa fellowship', 'achievements.html#rec-050'], ['fellowship', 'achievements.html#rec-050'], ['army dogs', 'achievements.html#rec-054'],
  ['retired army horses', 'achievements.html#rec-054'], ['meat on the hoof', 'achievements.html#rec-055'],
  ['imported dogs breeding', 'achievements.html#rec-056'], ['seal leather', 'achievements.html#rec-058'],
  ['wildlife skins import', 'achievements.html#rec-057'], ['air gun', 'achievements.html#rec-059'], ['airgun licence', 'achievements.html#rec-059'],
  ['cruelty on tv', 'achievements.html#rec-060'], ['silver vark', 'achievements.html#rec-061'], ['silver leaf', 'achievements.html#rec-061'],
  ['varq', 'achievements.html#rec-061'], ['slaughterhouse subsidy', 'achievements.html#rec-062'],
  ['household products testing', 'achievements.html#rec-063'], ['schedule y', 'achievements.html#rec-064'],
  ['pesticide testing', 'achievements.html#rec-065'], ['nalsar', 'achievements.html#rec-066'],
  ['animal law course', ['achievements.html#rec-066', 'achievements.html#rec-067', 'achievements.html#rec-103']],
  ['vet curriculum', 'achievements.html#rec-068'], ['captive elephants', 'achievements.html#rec-070'],
  ['elephant', ['achievements.html#rec-070', 'laws.html']], ['horse rescue dehradun', 'achievements.html#rec-072'],
  ['ncrb animal crimes', 'achievements.html#rec-073'], ['crime data', 'achievements.html#rec-073'],
  ['be kind to animals', 'achievements.html#rec-074'], ['shipping csr', 'achievements.html#rec-075'],
  ['piggery pollution', 'achievements.html#rec-077'], ['compensation seized animals', 'achievements.html#rec-083'],
  ['pig welfare alliance', 'achievements.html#rec-085'], ['dairy handbook', 'achievements.html#rec-088'],
  ['milk quality', 'achievements.html#rec-089'], ['fish farming', 'achievements.html#rec-097'], ['farmed fish', 'achievements.html#rec-097'],
  ['leather free school shoes', 'achievements.html#rec-098'], ['school uniforms goa', 'achievements.html#rec-098'],
  ['humane slaughter', 'achievements.html#rec-099'], ['delhi university animal law', 'achievements.html#rec-103'],
  ['du animal law', 'achievements.html#rec-103'], ['what has pfa done', 'achievements.html'], ['pfa achievements', 'achievements.html'],
  ['pfa work', ['achievements.html', 'units.html']], ['pfa campaigns', ['achievements.html', 'campaign.html', 'newsroom.html']],
  ['maneka gandhi work', ['founder.html', 'achievements.html']], ['who is maneka gandhi', 'founder.html'], ['raja garden shelter', 'sgacc.html'],
  ['delhi shelter', ['sgacc.html', 'units.html']], ['kite string', ['laws.html', 'achievements.html', 'newsroom.html']],
  ['manja', ['laws.html', 'achievements.html', 'newsroom.html', 'academy.html']], ['monkey', ['laws.html', 'achievements.html', 'report.html']],
  ['snake charmer', ['laws.html', 'achievements.html']], ['parrot in cage', ['laws.html', 'report.html']],
  ['bird seller', ['laws.html', 'report.html', 'achievements.html']], ['donkeys', ['achievements.html', 'laws.html', 'report.html']],
  ['cock fight', ['laws.html', 'achievements.html']], ['crackers diwali animals', ['laws.html', 'academy.html', 'newsroom.html']],
  /* Documents, stories, honours, designers, roles; typos, Hinglish and half-typed words */
  ['prevention of cruelty act pdf', 'read.html?r=pca-act-1960'], ['1960 act', ['read.html?r=pca-act-1960', 'laws.html']],
  ['handbook for police', ['read.html?r=law-enforcement-handbook', 'read.html?r=delhi-police-handbook']],
  ['vet officers handbook', 'read.html?r=veterinary-officers-handbook'], ['blue book lucknow', 'read.html?r=abc-blue-book-lucknow'],
  ['delhi police', 'read.html?r=delhi-police-handbook'], ['ey report cage free', 'read.html?r=ey-cage-free'],
  ['kanha gaushala', 'read.html?r=kanha-gaushala-up'], ['shvaan', 'read.html?r=shvaan-pashu'],
  ['veterinary infrastructure', 'read.html?r=veterinary-infrastructure-standards'], ['policy brief', 'read.html?r=scc-policy-brief'],
  ['bengaluru wildlife rescue', 'newsroom.html'], ['turtle chandigarh', 'newsroom.html'], ['roofed turtle', 'newsroom.html'],
  ['gadhimai animals homes', ['newsroom.html', 'achievements.html#rec-011']], ['vip visit dogs removed', 'newsroom.html#case-001'],
  ['riteish', 'cinekind.html#h26-08'], ['genelia', 'cinekind.html#h26-08'], ['pooja bhatt', 'cinekind.html#h25-07'],
  ['mohit chauhan', 'cinekind.html#h25-10'], ['wamiqa', 'cinekind.html#h26-06'],
  ['cinekind mumbai', ['events.html#event-002', 'cinekind.html', 'newsroom.html']], ['valaya', 'shop.html#jj-valaya'],
  ['gaurav gupta tshirt', ['shop.html#gaurav-gupta', 'shop.html#gaurav-gupta-charcoal']], ['logo tee', 'shop.html#pfa-logo-tee'],
  ['vet doctor job', 'careers.html#veterinary-team'], ['social media job', 'careers.html#social-media-fundraising'],
  ['cruelty response coordinator', 'careers.html#cruelty-response-coordinator'], ['lifetime member', 'get-involved.html#membership'],
  ['platinum', 'get-involved.html#membership'], ['talk at school', ['events.html#request', 'campus.html']],
  ['camp', ['events.html#request', 'events.html']], ['vaccinaton', 'academy.html'], ['rabis', 'academy.html'], ['antivenum', 'academy.html'],
  ['adpot a dog', 'events.html'], ['crulety', 'report.html'], ['acheivements', 'achievements.html'], ['carreers', 'careers.html'],
  ['librery', 'library.html'], ['sanctury', ['achievements.html#rec-029', 'sgacc.html']], ['cinekid', 'cinekind.html'],
  ['maneka gandi', 'founder.html'], ['ambulence', ['units.html', 'report.html']], ['injurd dog', ['academy.html', 'report.html', 'units.html']],
  ['kutta ghayal hai', ['academy.html', 'report.html', 'units.html']], ['gaay', ['laws.html', 'achievements.html']],
  ['janwar par atyachar', 'report.html'], ['kutte ko khana', ['laws.html', 'get-involved.html']], ['caregi', 'get-involved.html#caregiver'],
  ['volunt', 'get-involved.html'], ['memb', 'get-involved.html#membership'], ['repor', 'report.html'], ['academ', 'academy.html'],
  ['founde', 'founder.html']
];

test('every row in the index is found by its own title, in the top three', async () => {
  const S = await engine();
  const missed = [];
  const seen = new Set();
  for (const r of rows()) {
    if (r.y === 'place') continue;   /* units: held by search-google-grade */
    const key = r.t.toLowerCase();
    if (seen.has(key + '|' + r.u)) continue;
    seen.add(key + '|' + r.u);
    const top = top3(S, r.t);
    if (!top.some((x) => x.u === r.u || x.t.toLowerCase() === key)) missed.push(`${r.t} (${r.u}) -> ${top.map((x) => x.u).join(', ')}`);
  }
  assert.ok(seen.size > 500, `${seen.size} rows checked`);
  assert.deepEqual(missed, [], 'rows their own title cannot find:\n  ' + missed.join('\n  '));
});

test('what people type finds what they are after, in the top three', async () => {
  const S = await engine();
  const missed = [];
  for (const [q, want] of QUERIES) {
    const top = top3(S, q).map((r) => r.u);
    if (![].concat(want).some((w) => top.some((u) => u === w || u.startsWith(w)))) missed.push(`${q} -> ${top.join(', ') || '(nothing)'} (wanted ${[].concat(want).join(' or ')})`);
  }
  assert.ok(QUERIES.length > 380);
  assert.deepEqual(missed, [], 'searches that missed:\n  ' + missed.join('\n  '));
});

test('every document, honour, design, role, tier and event kind has a row of its own', () => {
  const have = new Set(rows().map((r) => r.u));
  const titles = new Set(rows().map((r) => r.t));
  const missing = [];
  const need = (u, what) => { if (!have.has(u)) missing.push(`${what}: ${u}`); };
  const docs = [...new Set([...read('library.html').matchAll(/href="(read\.html\?r=[^"#]+)"/g)].map((m) => m[1]))];
  assert.ok(docs.length >= 16, `${docs.length} library documents`);
  docs.forEach((u) => need(u, 'library document'));
  const honours = [...read('cinekind.html').matchAll(/<li [^>]*id="(h\d\d-\d+)"/g)].map((m) => m[1]);
  assert.ok(honours.length >= 21, `${honours.length} CineKind honours`);
  honours.forEach((id) => need(`cinekind.html#${id}`, 'CineKind honour'));
  const designs = [...read('shop.html').matchAll(/<article class="item" id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(designs.length >= 15, `${designs.length} shop designs`);
  designs.forEach((id) => need(`shop.html#${id}`, 'shop design'));
  for (const id of ['zonal-head', 'veterinary-team', 'cruelty-response-coordinator', 'social-media-fundraising', 'internship']) {
    assert.match(read('careers.html'), new RegExp(`id="${id}"`));
    need(`careers.html#${id}`, 'careers role');
  }
  for (const tier of ['Student', 'Silver', 'Golden', 'Platinum', 'Lifetime']) {
    if (!titles.has(`${tier} membership`)) missing.push(`membership tier: ${tier}`);
  }
  for (const kind of ['an adoption drive', 'a camp', 'an open day', 'a talk', 'a CineKind screening']) {
    if (!titles.has(`Ask for ${kind}`)) missing.push(`event kind: ${kind}`);
  }
  const records = [...read('achievements.html').matchAll(/<article[^>]*id="(rec-\d+)"/g)].map((m) => m[1]);
  assert.ok(records.length >= 100, `${records.length} records of PFA's work`);
  records.forEach((id) => need(`achievements.html#${id}`, 'record'));
  assert.deepEqual(missing, [], 'items with no row of their own:\n  ' + missing.join('\n  '));
});

test('a page\'s description is whole: an apostrophe does not cut it short', () => {
  const short = [];
  for (const r of rows().filter((x) => x.y === 'page')) {
    const html = read(r.u.split(/[?#]/)[0]);
    const tag = /<meta\s+name="description"\s+content=("([^"]*)"|'([^']*)')/i.exec(html);
    if (!tag) continue;
    const full = (tag[2] ?? tag[3]).replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
    if (full.length > 40 && !full.startsWith(String(r.d || '').replace(/…$/, '').slice(0, 60))) short.push(`${r.u}: "${String(r.d).slice(0, 50)}"`);
  }
  assert.deepEqual(short, [], 'descriptions cut short:\n  ' + short.join('\n  '));
});

test('the ways a word was missed, each closed', async () => {
  const S = await engine();
  const first3 = (q) => top3(S, q).map((r) => r.u);
  /* a word only in the body of a page or section */
  assert.ok(first3('cockfighting').some((u) => u.startsWith('laws.html') || u.startsWith('careers.html')));
  /* plurals in "-es" that are only "-s": "cages", "horses" */
  assert.ok(first3('parrot in cage').includes('laws.html#c35'), 'Is keeping Indian birds in cages legal?');
  assert.ok(first3('horse transport').some((u) => u.startsWith('laws.html#d')));
  /* a doubled letter before "-ing": "whipping" is "whip" */
  assert.ok(first3('whip racehorse').includes('laws.html#d15'));
  /* one word on the page, two in the query */
  assert.ok(first3('race horses whipping').includes('laws.html#d15'));
  assert.ok(first3('heat stroke dog').some((u) => u.startsWith('academy.html')));
  /* typos fix to the nearer word, and to the word as typed when equally near */
  assert.equal(S.search('carreers').corrected, 'careers');
  assert.equal(S.search('injurd dog').corrected, 'injured dog');
  assert.equal(first3('carreers')[0], 'careers.html');
  /* "work with pfa" is the jobs page; "pfa work" is PFA's work */
  assert.equal(first3('work with pfa')[0], 'careers.html');
  assert.equal(first3('pfa work')[0], 'achievements.html');
  /* a heading the page gives a curated row still finds it */
  assert.ok(first3('Not a flock. Individuals.').includes('someone.html#adopt'));
});
