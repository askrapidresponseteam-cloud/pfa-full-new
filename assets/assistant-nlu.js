/* People for Animals - the assistant's understanding, in English, Hindi and
   Hinglish (Hindi typed in English letters).
   ------------------------------------------------------------------------
   Owner, 15 Nov 2026: "can you build an assistant ... understand query in
   hindi, english etc ... this should not cost to operate pls. like it
   should not depend on any API". Chosen the same day: the zero-cost guided
   assistant, English, Hindi and Hinglish at launch.

   Nothing here is sent anywhere. It runs in the visitor's browser (and in
   the tests, in Node): what someone wants (intentOf), and the details in
   what they wrote (entities: a mobile, an email, a PIN code, an amount, a
   date, a reference, a name, yes or no, an animal, how urgent). Each word
   is matched as typed, by its start (so "maara", "maarte" and "मारा" all
   find "maar"), and, for longer English words, with one typo allowed.
   ------------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFA_ASSIST_NLU = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEVA_DIGITS = '०१२३४५६७८९';

  /* lower case, Devanagari digits as 0-9, the nukta and zero-width marks gone */
  function normalise(text) {
    var s = String(text == null ? '' : text);
    try { s = s.normalize('NFC'); } catch (_) { /* old browser */ }
    s = s.replace(/[०-९]/g, function (d) { return String(DEVA_DIGITS.indexOf(d)); });
    s = s.replace(/[​-‍﻿़]/g, '');
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function tokens(text) {
    return normalise(text).split(/[^a-z0-9ऀ-ॿ@.]+/).map(function (t) { return t.replace(/^\.+|\.+$/g, ''); }).filter(Boolean);
  }

  /* ---- which language to answer in ----------------------------------- */

  var HINGLISH = ['hai', 'hain', 'ke', 'ki', 'ko', 'se', 'mein', 'nahi', 'nahin', 'nhi', 'mera', 'meri', 'mere', 'mujhe', 'muje', 'mujhko', 'kya', 'kyaa', 'kaise', 'kese', 'kaisa', 'kahan', 'kaha', 'chahiye', 'chahta', 'chahti', 'karna', 'karni', 'karo', 'karein', 'kijiye', 'karwana', 'aur', 'bhi', 'yahan', 'wahan', 'kuch', 'bahut', 'raha', 'rahe', 'rahi', 'gaya', 'gayi', 'hua', 'hui', 'tha', 'thi', 'haan', 'accha', 'acha', 'theek', 'thik', 'paisa', 'paise', 'daan', 'madad', 'kutta', 'kutte', 'kutiya', 'billi', 'gaay', 'janwar', 'jaanwar', 'maar', 'maara', 'mara', 'peet', 'ghayal', 'apna', 'apni', 'aap', 'aapka', 'hum', 'humein', 'tum', 'abhi', 'naam', 'batao', 'bataiye', 'kab', 'kaun', 'kyun', 'koi', 'liye', 'sakta', 'sakti', 'sakte', 'hoga', 'hogi', 'wala', 'wali', 'dena', 'lena', 'jaana', 'dekho', 'shikayat', 'jankari', 'jaankari', 'sahayata', 'chanda', 'raseed', 'rasid', 'ji', 'kripya', 'dhanyavad', 'shukriya', 'namaste', 'pass', 'paas', 'najdik', 'nazdeek'];
  var HINGLISH_SET = {};
  HINGLISH.forEach(function (w) { HINGLISH_SET[w] = 1; });

  /* 'hi' for Devanagari or Hinglish, 'en' for English, '' when it cannot tell
     (a number, an email, "ok") so the conversation keeps its language */
  function languageOf(text) {
    var s = String(text || '');
    if (/[ऀ-ॿ]/.test(s)) return 'hi';
    var t = tokens(s).filter(function (w) { return /^[a-z]+$/.test(w); });
    if (!t.length) return '';
    var hits = t.filter(function (w) { return HINGLISH_SET[w]; }).length;
    if (hits >= 2 || (hits === 1 && t.length <= 3 && !/^(ji|hai|aur)$/.test(t.filter(function (w) { return HINGLISH_SET[w]; })[0]))) return 'hi';
    return t.length >= 2 || /^(hi|hello|hey|thanks|yes|no|help)$/.test(t[0]) ? 'en' : '';
  }

  /* ---- matching a word against a keyword ------------------------------- */

  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /* a word matches a keyword as typed, by its start (keywords of 3 or more
     letters; 4 or more in English, so "car" is not "care"), or, for English
     words of 5 or more letters, with one letter wrong */
  function wordHits(word, key) {
    if (word === key) return true;
    var deva = /[ऀ-ॿ]/.test(key);
    if (deva) return key.length >= 2 && word.indexOf(key) === 0;
    if (key.length >= 4 && word.indexOf(key) === 0 && word.length - key.length <= 5) return true;
    if (key.length >= 5 && word.length >= 5 && editDistance(word, key) <= 1) return true;
    return false;
  }

  /* how many of a list's keywords a text holds; a phrase (with a space) is
     looked for whole in the text */
  function countHits(text, words, list) {
    var n = 0;
    var flat = ' ' + words.join(' ') + ' ';
    list.forEach(function (k) {
      if (k.indexOf(' ') > -1) { if (flat.indexOf(' ' + k + ' ') > -1 || text.indexOf(k) > -1) n += 1.5; return; }
      for (var i = 0; i < words.length; i++) if (wordHits(words[i], k)) { n += 1; return; }
    });
    return n;
  }

  /* ---- what someone wants ---------------------------------------------- */

  /* Each offering, with the words people use for it. Order matters only
     for a tie: the earlier wins. */
  var INTENTS = [
    { id: 'report', w: ['cruelty', 'cruel', 'abuse', 'abused', 'abusing', 'beat', 'beating', 'beaten', 'kill', 'killed', 'killing', 'poison', 'poisoned', 'torture', 'tortured', 'attack', 'attacked', 'stone', 'stones', 'stoning', 'chained', 'starving', 'starved', 'complaint', 'complain', 'report', 'harass', 'hitting', 'kicked', 'kicking', 'burnt', 'burned', 'maar', 'maara', 'mara', 'marte', 'peet', 'pitai', 'pita', 'zeher', 'zehar', 'jeher', 'jahar', 'shikayat', 'atyachar', 'zulm', 'julm', 'bandh', 'tadpa',
      'क्रूर', 'मार', 'पीट', 'ज़हर', 'जहर', 'शिकायत', 'अत्याचार', 'जुल्म', 'हत्या', 'बांध', 'रिपोर्ट'],
      p: ['report cruelty', 'someone is beating', 'is beating', 'ko maar', 'maar rahe', 'maar raha', 'peet rahe', 'मार रहे', 'मार रहा', 'पीट रहे', 'को मार'] },
    { id: 'nearby', w: ['near', 'nearest', 'nearby', 'unit', 'units', 'vet', 'vets', 'hospital', 'clinic', 'ambulance', 'injured', 'injury', 'accident', 'bleeding', 'sick', 'emergency', 'helpline', 'paas', 'najdik', 'nazdeek', 'aspatal', 'doctor', 'ghayal', 'bimar', 'beemar', 'hadsa', 'chot', 'khoon',
      'पास', 'नजदीक', 'नज़दीक', 'अस्पताल', 'डॉक्टर', 'घायल', 'बीमार', 'हादसा', 'चोट', 'एम्बुलेंस'],
      p: ['near me', 'help near', 'pfa unit', 'mere paas', 'mere area'] },
    { id: 'donate', w: ['donate', 'donation', 'donating', 'contribute', 'contribution', 'fund', 'funds', 'sponsor', 'daan', 'chanda', 'paisa', 'paise', 'rupees', 'rupaye', 'support', '80g',
      'दान', 'चंदा', 'सहयोग'],
      p: ['give money', 'paisa dena', 'paise dena', 'daan karna'] },
    { id: 'member', w: ['member', 'membership', 'members', 'sadasya', 'sadasyata', 'सदस्य', 'मेंबर'], p: ['join pfa', 'become a member', 'member banna'] },
    { id: 'volunteer', w: ['volunteer', 'volunteering', 'volunteers', 'swayamsevak', 'sewa', 'seva', 'स्वयंसेवक', 'वॉलंटियर', 'सेवा'], p: ['help out', 'give my time'] },
    { id: 'internship', w: ['intern', 'internship', 'interns', 'इंटर्न'], p: [] },
    { id: 'caregiver', w: ['caregiver', 'feeder', 'feeders', 'colony', 'khilana', 'khilata', 'khilati', 'खिला', 'फीडर'], p: ['caregiver card', 'feeding card', 'feed dogs', 'feed street'] },
    { id: 'track', w: ['track', 'status', 'tracking', 'progress', 'update', 'स्थिति', 'स्टेटस'], p: ['where is my', 'kya hua', 'kahan tak', 'my application', 'my report', 'follow a report', 'follow my report', 'follow up', 'follow an application', 'report i sent', 'report you sent', 'report sent'] },
    { id: 'receipt', w: ['receipt', 'receipts', 'invoice', 'rasid', 'raseed', 'रसीद'], p: ['tax receipt', '80g receipt'] },
    { id: 'adopt', w: ['adopt', 'adoption', 'adopting', 'god', 'apnana', 'गोद', 'अपना'], p: ['god lena', 'ghar dena'] },
    /* the events PFA holds, not inviting PFA to one (22 Nov 2026: "upcoming events") */
    { id: 'eventsList', w: [], p: ['upcoming events', 'upcoming event', 'next event', 'events calendar', 'pfa events', 'events near me', 'any events', 'what events', 'event list', 'events list', 'list of events', 'events this month'] },
    { id: 'event', w: ['camp', 'camps', 'drive', 'event', 'events', 'session', 'talk', 'sterilisation', 'sterilization', 'vaccination', 'shivir', 'शिविर'], p: ['adoption drive', 'school session', 'vaccination camp', 'request an event', 'organise an event', 'organize an event', 'host an event', 'event in my area'] },
    { id: 'sgacc', w: ['sgacc', 'supplies'], p: ['sanjay gandhi', 'animal care centre', 'care centre', 'care center'] },
    { id: 'csr', w: ['csr', 'corporate', 'company'], p: ['our company', 'partner with', 'partnership with', 'become a partner', 'want to partner', 'collaborate with', 'tie up with'] },
    { id: 'legacy', w: ['legacy', 'bequest', 'will', 'vasiyat', 'wasiyat', 'वसीयत'], p: ['in my will'] },
    { id: 'campaign', w: ['campaign', 'fundraiser', 'fundraising', 'abhiyan', 'अभियान'], p: ['birthday fundraiser'] },
    { id: 'campus', w: ['campus', 'society', 'chapter', 'college', 'university'], p: ['student society'] },
    { id: 'privacy', w: ['privacy', 'erase', 'gdpr'], p: ['my data', 'delete my', 'remove my data'] },
    { id: 'cinekind', w: ['cinekind', 'nominate', 'nomination', 'award', 'awards'], p: [] },
    { id: 'wall', w: ['wall', 'film', 'films', 'video', 'videos', 'reel', 'reels', 'documentary', 'वीडियो', 'फ़िल्म', 'फिल्म'], p: ['the wall', 'share a film', 'share my film', 'share a video', 'my video'] },
    { id: 'proof', w: ['proof', 'saboot', 'sabut', 'सबूत'], p: ['submit proof', 'task proof', 'internship task', 'task done', 'submit my task', 'send proof'] },
    { id: 'verify', w: ['verify', 'verification', 'genuine', 'fake', 'asli', 'nakli', 'असली', 'नकली', 'सत्यापन'], p: ['check certificate', 'check a certificate', 'check this certificate', 'check a card', 'check this card', 'is this card', 'is this certificate', 'certificate real', 'certificate is real', 'card is real', 'card real'] },
    { id: 'jobs', w: ['job', 'jobs', 'career', 'careers', 'vacancy', 'vacancies', 'hiring', 'naukri', 'salary', 'नौकरी'], p: [] },
    { id: 'shop', w: ['shop', 'buy', 'purchase', 'tshirt', 'tshirts', 't-shirt', 't-shirts', 'shirt', 'shirts', 'merch', 'merchandise', 'store', 'kharid', 'khareed', 'खरीद', 'दुकान'], p: [] },
    { id: 'newunit', w: [], p: ['new unit', 'start a unit', 'open a unit', 'unit kholna', 'own unit', 'new pfa unit', 'start a new unit', 'open a new unit', 'start a pfa unit', 'open a pfa unit', 'set up a unit', 'set up a pfa unit', 'unit in my city', 'unit in my town', 'unit in my district'] },
    { id: 'mednote', w: [], p: ['share a care guide', 'send a care guide', 'write a care guide', 'submit a care guide', 'share a guide', 'submit your guide', 'submit my guide', 'share a note', 'care guide', 'share my article', 'write an article'] },
    { id: 'podcast', w: ['podcast', 'podcasts', 'पॉडकास्ट'], p: [] },
    /* the pages that are read (16 Nov 2026: every visible feature) */
    { id: 'guides', w: ['diabetes', 'insulin', 'मधुमेह'], p: ['care guide', 'care guides', 'health guide', 'pet health', 'medical information', 'health article', 'pet care article', 'sugar in dogs'] },
    { id: 'newsroom', w: ['newsroom', 'news'], p: ['latest news', 'news from pfa', 'pfa cases', 'cases pfa'] },
    { id: 'achievements', w: ['achievements', 'achievement', 'achieved', 'achieve', 'accomplishments', 'uplabdhi', 'उपलब्धि'], p: ['what has pfa done', 'what pfa has done', 'pfa policies', 'policies and achievements'] },
    { id: 'library', w: ['library', 'handbook', 'handbooks', 'manuals', 'pustakalay', 'पुस्तकालय'], p: ['resources library', 'policy brief', 'training manual'] },
    { id: 'academy', w: ['academy', 'antibiotic', 'antibiotics', 'antivenom', 'prescription'], p: ['first aid', 'pratham upchar', 'प्राथमिक उपचार', 'animal medicine'] },
    { id: 'behaviour', w: ['behaviour', 'behavior', 'barking', 'aggression', 'aggressive', 'scratching', 'scratches', 'chewing', 'chews', 'digging', 'howling', 'whining', 'spraying', 'litter', 'vyavhar', 'व्यवहार'], p: ['why does my dog', 'why does my cat', 'dog keeps', 'cat keeps', 'new dog', 'new cat', 'second dog', 'another dog', 'new puppy', 'new kitten', 'stop my puppy', 'stop my dog', 'stop my cat', 'separation anxiety'] },
    { id: 'someone', w: [], p: ['someone not something', 'animals we eat', 'farm animals feel', 'do hens feel', 'do pigs feel', 'do cows feel'] },
    { id: 'fireworks', w: ['fireworks', 'firework', 'crackers', 'cracker', 'patakhe', 'pataka', 'पटाखे', 'पटाखा'], p: ['diwali dog', 'diwali animals'] },
    { id: 'quiz', w: [], p: ['test yourself', 'animal quiz', 'take a quiz', 'farm animal quiz', 'quiz on farm animals'] },
    { id: 'gifts', w: ['gifts', 'upahar', 'उपहार', 'deepawali', 'christmas'], p: ['seasonal gifts', 'seasonal gift', 'diwali gift', 'gift for someone', 'a gift for'] },
    /* Partners in giving (27 Nov 2026): the donors and what their gifts do */
    { id: 'partners', w: ['donors', 'sponsors', 'funders', 'rosies'], p: ['partners in giving', 'pfa partners', 'your partners', 'our donors', 'your donors', 'who donated', 'who funds pfa', 'who funded', 'rosie s heroes', 'rosies heroes', 'donor partnership', 'khamgaon ambulance'] },
    { id: 'founder', w: ['founder'], p: ['about maneka', 'about the founder', 'the founder page'] },
    { id: 'picks', w: [], p: ['maneka picks', 'manekas picks', 'films she recommends', 'books she recommends', 'film recommendation', 'book recommendation'] },
    { id: 'lawpage', w: [], p: ['what the law says', 'animal law page', 'laws page'] },
    { id: 'unitlist', w: [], p: ['all units', 'list of units', 'pfa units', 'units list', 'every unit'] },
    { id: 'law', w: ['law', 'laws', 'legal', 'section', 'rights', 'act', 'court', 'kanoon', 'kanun', 'dhara', 'कानून', 'धारा'], p: [] },
    /* asking PFA itself, by email (the help desk), not the site */
    { id: 'desk', w: ['helpdesk'], p: ['i have a question', 'question for pfa', 'ask pfa', 'help desk', 'write to pfa', 'contact pfa', 'talk to pfa'] },
    { id: 'question', w: ['question', 'query', 'ask', 'sawal', 'puchna', 'poochna', 'jankari', 'jaankari', 'सवाल', 'प्रश्न', 'जानकारी'], p: ['how do i', 'how to', 'what is', 'kaise kare'] },
    { id: 'greet', w: ['hi', 'hello', 'hey', 'namaste', 'namaskar', 'hii', 'helo', 'नमस्ते', 'नमस्कार'], p: ['good morning', 'good evening'] },
    { id: 'thanks', w: ['thanks', 'thank', 'thanku', 'thx', 'dhanyavad', 'dhanyawad', 'shukriya', 'धन्यवाद', 'शुक्रिया'], p: [] }
  ];

  /* The words that mean "the conversation, not the task": go back to the
     start, stop, step back. Checked before anything else. */
  var COMMANDS = {
    menu: ['menu', 'start over', 'start again', 'begin again', 'restart', 'home', 'main menu', 'go home', 'shuru', 'मेनू', 'शुरू'],
    cancel: ['cancel', 'cancel this', 'cancel it', 'stop', 'stop this', 'quit', 'exit', 'leave it', 'forget it', 'never mind', 'nevermind', 'rehne do', 'chhodo', 'chodo', 'band karo', 'radd', 'रद्द', 'छोड़ो', 'रहने दो'],
    back: ['back', 'go back', 'previous', 'peeche', 'pichhe', 'पीछे'],
    skip: ['skip', 'none', 'no thanks', 'not now', 'later', 'baad mein', 'chhod do', 'nahi chahiye', 'kuch nahi', 'pata nahi', 'pta nahi', 'malum nahi', 'maloom nahi', 'dont know', "don't know", 'do not know', 'no idea', 'not known', 'unknown', 'पता नहीं', 'नहीं पता', 'मालूम नहीं', 'छोड़ दो', 'कुछ नहीं']
  };

  function commandOf(text) {
    var s = normalise(text).replace(/[.!?]+$/, '');
    var keys = Object.keys(COMMANDS);
    for (var i = 0; i < keys.length; i++) {
      if (COMMANDS[keys[i]].some(function (c) { return s === c; })) return keys[i];
    }
    return '';
  }

  /* The offerings a text is about, best first: [{ id, score }]. A greeting
     or thanks alongside a task gives way to the task. */
  function intentOf(text) {
    var s = normalise(text);
    var words = tokens(s);
    if (!words.length) return [];
    var out = INTENTS.map(function (it) {
      return { id: it.id, score: countHits(s, words, it.w) + countHits(s, words, it.p || []) };
    }).filter(function (x) { return x.score > 0; });
    var tasks = out.filter(function (x) { return x.id !== 'greet' && x.id !== 'thanks'; });
    if (tasks.length) out = tasks;
    /* "how do I adopt" is about adopting: a general question gives way to any task */
    var named = out.filter(function (x) { return x.id !== 'question'; });
    if (named.length) out = named;
    /* a reference number is about following it, unless the words say otherwise */
    if (referenceOf(text) && !out.some(function (x) { return x.id === 'receipt'; })) out.push({ id: 'track', score: 1.5 });
    /* a receipt for a donation is about the receipt; the status of a report
       is about following it */
    var has = function (id) { return out.some(function (x) { return x.id === id; }); };
    out.forEach(function (x) {
      if (x.id === 'receipt' && (has('donate') || has('member'))) x.score += 1;
      if (x.id === 'track' && out.length > 1) x.score += 1;
      /* checking a card or certificate is about checking it, whatever it is */
      if (x.id === 'verify' && out.length > 1) x.score += 2;
      /* a company asking how to help is the CSR page, not a donation */
      if (x.id === 'csr' && (has('donate') || has('volunteer'))) x.score += 1;
      /* the events PFA holds, said in so many words, are not an invitation */
      if (x.id === 'eventsList') x.score += 2;
      /* starting a unit is not looking for one */
      if (x.id === 'newunit') x.score += 2;
      /* writing to PFA is not a search of the site */
      if (x.id === 'desk' && has('question')) x.score += 1;
      /* proof of an internship task is not a new application */
      if (x.id === 'proof' && has('internship')) x.score += 3;
      /* a certificate or card number is checked, not tracked */
      if (x.id === 'track' && /PFA[\s-]*(INT|VOL|PAR|REC|DNR|CCT|MBR)[\s-]*[A-Z0-9]{8}/i.test(text)) x.score = 0;
    });
    if (/PFA[\s-]*(INT|VOL|PAR|REC|DNR|CCT|MBR)[\s-]*[A-Z0-9]{8}/i.test(text) && !has('verify')) out.push({ id: 'verify', score: 2 });
    out = out.filter(function (x) { return x.score > 0; });
    /* "injured" with "beaten" is cruelty; "injured" alone is help near me */
    out.sort(function (a, b) { return b.score - a.score || INTENTS.findIndex(function (i) { return i.id === a.id; }) - INTENTS.findIndex(function (i) { return i.id === b.id; }); });
    var seen = {};
    return out.filter(function (x) { if (seen[x.id]) return false; seen[x.id] = 1; return true; });
  }

  /* ---- the details in what someone wrote ------------------------------ */

  function emailOf(text) {
    var m = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.exec(String(text || ''));
    return m ? m[0].toLowerCase().replace(/\.+$/, '') : '';
  }

  /* ten digits starting 6 to 9, with +91, 91 or 0 before them allowed, and
     spaces or dashes between the digits */
  function mobileOf(text) {
    var s = normalise(text).replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, ' ');
    var re = /(?:\+?91[\s\-]?|\b0)?([6-9](?:[\s\-]?\d){9})(?!\d)/g;
    var m;
    while ((m = re.exec(s))) {
      var d = m[1].replace(/\D/g, '');
      var before = s.slice(0, m.index).replace(/[\s\-]+$/, '');
      if (/\d$/.test(before) && !/(?:\+?91|\b0)$/.test(before)) continue;
      if (d.length === 10) return d;
    }
    return '';
  }

  /* six digits, the first not 0, a space allowed after the third; never
     the digits of a mobile number */
  function pinOf(text) {
    var s = normalise(text);
    var mob = mobileOf(s);
    var flat = s.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, ' ');
    var re = /(^|[^\d])([1-9]\d{2}\s?\d{3})(?!\d)/g;
    var m;
    while ((m = re.exec(flat))) {
      var p = m[2].replace(/\s/g, '');
      if (mob && mob.indexOf(p) > -1) continue;
      return p;
    }
    return '';
  }

  /* PFA's own numbers: PFA-CR-2026-00012, PFA-DON-AB12CD34 */
  function referenceOf(text) {
    var m = /\bPFA[\s\-]?([A-Z]{1,4})[\s\-]?(\d{4})[\s\-]?(\d{3,6})\b/i.exec(String(text || ''));
    if (m) return ('PFA-' + m[1] + '-' + m[2] + '-' + m[3]).toUpperCase();
    var o = /\bPFA[\s\-]?(DON|MEM|CGA|CG|SHP|SND)[\s\-]?([A-Z0-9]{8})\b/i.exec(String(text || ''));
    return o ? ('PFA-' + o[1] + '-' + o[2]).toUpperCase() : '';
  }

  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50, hundred: 100,
    ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10, bees: 20, pachas: 50, pachaas: 50,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'दस': 10, 'बीस': 20, 'पचास': 50
  };
  var MULTIPLIERS = {
    k: 1000, thousand: 1000, hazar: 1000, hazaar: 1000, hajar: 1000, hajaar: 1000, 'हज़ार': 1000, 'हजार': 1000,
    lakh: 100000, lac: 100000, lakhs: 100000, 'लाख': 100000,
    hundred: 100, sau: 100, 'सौ': 100
  };

  /* an amount in rupees: "1000", "Rs 1,500", "₹2500", "5k", "5 hazaar",
     "ek hazaar", "1 lakh". `loose`: a bare number counts (when an amount
     is what was asked) */
  function amountOf(text, loose) {
    var s = normalise(text).replace(/(\d),(?=\d)/g, '$1');
    var cur = /(?:₹|rs\.?|inr|rupees?|rupaye|rupay|rupiya|rupiye|रुपये|रुपए)/;
    var t = s.split(/\s+/);
    for (var i = 0; i < t.length; i++) {
      var w = t[i].replace(/^(?:₹|rs\.?)/, '');
      var n = /^\d+(?:\.\d{1,2})?$/.test(w) ? Number(w) : /^\d+k$/.test(w) ? Number(w.slice(0, -1)) * 1000 : (NUMBER_WORDS[w] || null);
      if (n == null) continue;
      var next = t[i + 1] || '';
      if (MULTIPLIERS[next]) { n *= MULTIPLIERS[next]; next = t[i + 2] || ''; }
      var around = (t[i - 1] || '') + ' ' + t[i] + ' ' + next;
      if (loose || cur.test(around) || /\d+k$/.test(w) || MULTIPLIERS[t[i + 1] || '']) {
        if (/^\d{10}$/.test(w) || /^[1-9]\d{5}$/.test(w) && !cur.test(around) && !loose) continue;
        if (n > 0) return Math.round(n * 100) / 100;
      }
    }
    return null;
  }

  var MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    'जनवरी': 1, 'फरवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8, 'सितंबर': 9, 'अक्टूबर': 10, 'नवंबर': 11, 'दिसंबर': 12 };

  function isoDate(y, m, d) {
    if (y < 100) y += y > 30 ? 1900 : 2000;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  /* a date, as 2004-05-14: 14/05/2004, 14-5-2004, 2004-05-14, 14 May 2004, May 14 2004, 14 मई 2004 */
  function dateOf(text) {
    var s = normalise(text);
    var m = /\b(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})\b/.exec(s);
    if (m) return isoDate(+m[1], +m[2], +m[3]);
    m = /\b(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})\b/.exec(s);
    if (m) return isoDate(+m[3], +m[2], +m[1]);
    var w = s.replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1').split(/\s+/);
    for (var i = 0; i < w.length; i++) {
      var mo = MONTHS[w[i]];
      if (!mo) continue;
      var d1 = +w[i - 1], y1 = +w[i + 1], d2 = +w[i + 1], y2 = +w[i + 2];
      if (d1 >= 1 && d1 <= 31 && y1 >= 1900) return isoDate(y1, mo, d1);
      if (d2 >= 1 && d2 <= 31 && y2 >= 1900) return isoDate(y2, mo, d2);
    }
    return '';
  }

  function ageOn(iso, nowMs) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var now = new Date((nowMs || Date.now()) + 330 * 60000);
    var age = now.getUTCFullYear() - +m[1];
    if (now.getUTCMonth() + 1 < +m[2] || (now.getUTCMonth() + 1 === +m[2] && now.getUTCDate() < +m[3])) age -= 1;
    return age;
  }

  /* "my name is Asha Rao", "mera naam Asha hai", "मेरा नाम आशा है", "this is Asha".
     `whole`: the text is the answer to "your name?", so take it as it is */
  function nameOf(text, whole) {
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    var m = /(?:my name is|my name's|name is|this is|i am|i'm|mera naam|mera nam|meraa naam|naam hai|naam|मेरा नाम|नाम)\s*[:\-]?\s*([^\d,.@!?\n]{2,60}?)(?:\s+(?:hai|h|है)\b|[,.!?]|\s+and\b|\s+aur\b|\s+\d|$)/i.exec(raw);
    var name = m ? m[1] : (whole ? raw.replace(/^(?:it'?s|ji|i am|i'm)\s+/i, '') : '');
    name = name.replace(/\s+(?:hai|h|है|ji|here)$/i, '').replace(/[^\p{L}\p{M}\s.'\-]/gu, '').trim();
    if (!name || name.length < 2 || name.split(' ').length > 5) return '';
    if (!whole && /^(free|fine|ok|okay|here|interested|a volunteer|volunteer|looking|not|from)\b/i.test(name)) return '';
    return name.replace(/(^|\s)(\p{Ll})/gu, function (_, s, c) { return s + c.toUpperCase(); });
  }

  var YES = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'okk', 'correct', 'right', 'confirm', 'confirmed', 'send', 'send it', 'go ahead', 'proceed', 'done', 'agree', 'i agree', 'accept', 'haan', 'han', 'haa', 'ha', 'hanji', 'ji', 'ji haan', 'theek', 'thik', 'theek hai', 'thik hai', 'sahi', 'sahi hai', 'bilkul', 'bhejo', 'bhej do', 'kar do', 'chalo', 'manzoor', 'हाँ', 'हां', 'जी', 'जी हाँ', 'ठीक', 'ठीक है', 'सही', 'बिल्कुल', 'भेजो', 'भेज दो', 'हा', 'हाँ जी'];
  var NO = ['no', 'n', 'nope', 'nah', 'not', 'wrong', 'incorrect', 'not yet', 'nahi', 'nahin', 'nhi', 'na', 'mat', 'galat', 'abhi nahi', 'नहीं', 'नही', 'ना', 'मत', 'गलत'];

  /* true, false, or null when it is neither */
  function yesNoOf(text) {
    var s = normalise(text).replace(/[.!]+$/, '');
    if (YES.indexOf(s) > -1) return true;
    if (NO.indexOf(s) > -1) return false;
    var first = s.split(' ')[0];
    if (/^(yes|yeah|yep|haan|han|hanji|हाँ|हां|जी)$/.test(first)) return true;
    if (/^(no|nope|nahi|nahin|नहीं)$/.test(first)) return false;
    return null;
  }

  var ANIMALS = [
    ['Dog', ['dog', 'dogs', 'puppy', 'puppies', 'pup', 'pups', 'kutta', 'kutte', 'kutti', 'kutiya', 'kuttiya', 'pilla', 'pille', 'bitch', 'कुत्त', 'पिल्ल']],
    ['Cat', ['cat', 'cats', 'kitten', 'kittens', 'billi', 'billa', 'bille', 'बिल्ल']],
    ['Cow or buffalo', ['cow', 'cows', 'bull', 'bulls', 'ox', 'calf', 'calves', 'buffalo', 'buffaloes', 'cattle', 'gaay', 'gai', 'gau', 'gaye', 'bail', 'saand', 'sand', 'bhains', 'bhens', 'bachhda', 'bachda', 'गाय', 'बैल', 'सांड', 'भैंस', 'बछड़']],
    ['Horse or donkey', ['horse', 'horses', 'donkey', 'donkeys', 'mule', 'mules', 'pony', 'ghoda', 'ghodi', 'gadha', 'gadhe', 'khachar', 'घोड', 'गध', 'खच्चर']],
    ['Bird', ['bird', 'birds', 'pigeon', 'pigeons', 'parrot', 'parrots', 'crow', 'eagle', 'kite', 'owl', 'peacock', 'sparrow', 'hen', 'chicken', 'chidiya', 'chidia', 'kabutar', 'tota', 'kauwa', 'mor', 'murgi', 'murga', 'ullu', 'पक्षी', 'चिड़िया', 'चिडिया', 'कबूतर', 'तोत', 'मोर', 'मुर्ग']],
    ['Monkey', ['monkey', 'monkeys', 'langur', 'bandar', 'bander', 'बंदर']],
    ['Goat or sheep', ['goat', 'goats', 'sheep', 'lamb', 'bakri', 'bakra', 'bhed', 'bhedh', 'बकर', 'भेड़', 'भेड']]
  ];

  /* the animal a text is about, as the cruelty form names it, or '' */
  function animalOf(text) {
    var words = tokens(text);
    for (var i = 0; i < ANIMALS.length; i++) {
      var list = ANIMALS[i][1];
      for (var j = 0; j < words.length; j++) {
        for (var k = 0; k < list.length; k++) {
          var key = list[k];
          if (words[j] === key || (/[ऀ-ॿ]/.test(key) ? words[j].indexOf(key) === 0 : key.length >= 4 && words[j].indexOf(key) === 0 && words[j].length - key.length <= 2)) return ANIMALS[i][0];
        }
      }
    }
    return '';
  }

  /* is it happening now, does it keep happening, or did it happen: as the
     cruelty form names them, or '' */
  function urgencyOf(text) {
    var s = normalise(text);
    if (/\b(right now|happening now|now|abhi|is waqt|isi waqt|currently|ho raha|ho rahi|ho rahe|kar raha|kar rahe|kar rahi|maar rahe|maar raha|peet rahe|is beating|are beating|is hitting|are hitting)\b/.test(s) || /अभी|हो रह|रहे हैं|रहा है/.test(s)) return 'Happening now';
    if (/\b(every day|everyday|daily|again and again|keeps|regularly|often|ongoing|roz|rozana|har din|baar baar|lagatar)\b/.test(s) || /रोज़|रोज|हर दिन|बार बार|लगातार/.test(s)) return 'Ongoing';
    if (/\b(yesterday|last week|last month|ago|happened|was beaten|were beaten|killed|died|kal|pichhle|pichle|hua tha|maara tha|mar diya|maar diya)\b/.test(s) || /पिछले|हुआ था|मार दिया/.test(s)) return 'Past';
    return '';
  }

  /* one of a list of choices, from its number ("2"), its words in English
     or Hindi, or a few words for it; '' when none fits */
  function choiceOf(text, options) {
    var s = normalise(text).replace(/[.!?]+$/, '');
    if (!s) return '';
    var n = /^(\d{1,2})$/.exec(s);
    if (n && options[+n[1] - 1]) return options[+n[1] - 1].value;
    var words = tokens(s);
    var best = { value: '', score: 0 };
    options.forEach(function (o) {
      var names = [o.value, o.en, o.hi].concat(o.syn || []).filter(Boolean).map(normalise);
      var score = 0;
      names.forEach(function (name) {
        if (s === name) score = Math.max(score, 10);
        else if (name.length > 3 && (s.indexOf(name) > -1 || name.indexOf(s) === 0 && s.length >= 3)) score = Math.max(score, 5);
      });
      if (!score) score = countHits(s, words, (o.syn || []).map(normalise).concat(tokens(o.en || o.value).filter(function (w) { return w.length >= 4; })));
      if (score > best.score) best = { value: o.value, score: score };
    });
    return best.score >= 1 ? best.value : '';
  }

  /* everything a free message carries, at once */
  function entitiesOf(text) {
    return {
      email: emailOf(text), mobile: mobileOf(text), pin: pinOf(text), reference: referenceOf(text),
      amount: amountOf(text, false), date: dateOf(text), name: nameOf(text, false),
      animal: animalOf(text), urgency: urgencyOf(text)
    };
  }

  /* Hindi and Hinglish words the site search knows in English, so a
     question in Hindi still finds the right page */
  var TO_ENGLISH = {
    kutta: 'dog', kutte: 'dogs', kutiya: 'dog', billi: 'cat', gaay: 'cow', gai: 'cow', bandar: 'monkey', chidiya: 'bird', kabutar: 'pigeon', ghoda: 'horse', gadha: 'donkey', bakri: 'goat',
    ghayal: 'injured', bimar: 'sick', beemar: 'sick', aspatal: 'hospital', kanoon: 'law', kanun: 'law', dhara: 'section', daan: 'donate', chanda: 'donate', sadasya: 'member', god: 'adopt',
    khana: 'feeding', khilana: 'feeding', khilane: 'feeding', zeher: 'poison', jahar: 'poison', maar: 'cruelty', shikayat: 'complaint', patakhe: 'fireworks', pataka: 'fireworks', diwali: 'fireworks',
    tika: 'vaccine', teeka: 'vaccine', rabies: 'rabies', kaata: 'bite', kata: 'bite', kaat: 'bite', nasbandi: 'sterilisation', khoon: 'bleeding', chot: 'injury',
    'कुत्ता': 'dog', 'कुत्ते': 'dogs', 'बिल्ली': 'cat', 'गाय': 'cow', 'बंदर': 'monkey', 'घायल': 'injured', 'बीमार': 'sick', 'अस्पताल': 'hospital', 'कानून': 'law', 'दान': 'donate', 'ज़हर': 'poison', 'जहर': 'poison', 'काटा': 'bite', 'टीका': 'vaccine', 'नसबंदी': 'sterilisation', 'पटाखे': 'fireworks', 'खाना': 'feeding'
  };
  function searchText(text) {
    return tokens(text).map(function (w) { return TO_ENGLISH[w] || w; }).filter(function (w) { return !HINGLISH_SET[w] || TO_ENGLISH[w]; }).join(' ');
  }

  /* Asking for a person, not the assistant (owner, 16 Nov 2026: "if one
     asks for a person"): "talk to a human", "kisi se baat karni hai",
     "live chat". A single word ("human", "agent") counts only in a short
     message that asks for nothing else, so "someone is beating a dog" or
     "a person hit my dog" is never read as wanting a person. */
  var PERSON_PHRASES = ['talk to a person', 'talk to person', 'talk to someone', 'talk to somebody', 'talk to a human', 'talk to human', 'talk to a real', 'talk with someone', 'talk with a person',
    'speak to a person', 'speak to someone', 'speak to somebody', 'speak to a human', 'speak with someone', 'speak with a person', 'chat with someone', 'chat with a person', 'chat with a human',
    'real person', 'real human', 'actual person', 'human being', 'live chat', 'live agent', 'live person', 'customer care', 'customer support', 'customer service', 'someone from pfa', 'somebody from pfa', 'person from pfa',
    'connect me to', 'connect me with', 'transfer me', 'kisi se baat', 'kisi insaan', 'kisi insan', 'insaan se baat', 'insan se baat', 'aadmi se baat', 'admi se baat', 'vyakti se baat', 'staff se baat',
    'किसी से बात', 'इंसान से बात', 'व्यक्ति से बात', 'किसी व्यक्ति', 'लाइव चैट'];
  var PERSON_WORDS = ['human', 'agent', 'representative', 'executive', 'operator', 'person', 'insaan', 'insan', 'इंसान', 'व्यक्ति'];
  function personOf(text) {
    var s = normalise(text).replace(/[.!?]+$/, '');
    var words = tokens(s);
    if (!words.length) return false;
    var flat = ' ' + words.join(' ') + ' ';
    if (PERSON_PHRASES.some(function (k) { return flat.indexOf(' ' + k + ' ') > -1 || s.indexOf(k) > -1; })) return true;
    if (words.length > 4) return false;
    if (!words.some(function (w) { return PERSON_WORDS.indexOf(w) > -1; })) return false;
    return !intentOf(text).some(function (x) { return x.id !== 'question' && x.id !== 'greet' && x.id !== 'thanks'; });
  }

  return {
    normalise: normalise, tokens: tokens, languageOf: languageOf, intentOf: intentOf, commandOf: commandOf, personOf: personOf,
    emailOf: emailOf, mobileOf: mobileOf, pinOf: pinOf, referenceOf: referenceOf, amountOf: amountOf, dateOf: dateOf, ageOn: ageOn,
    nameOf: nameOf, yesNoOf: yesNoOf, animalOf: animalOf, urgencyOf: urgencyOf, choiceOf: choiceOf, entitiesOf: entitiesOf,
    searchText: searchText, editDistance: editDistance, countHits: countHits, INTENTS: INTENTS
  };
}));
