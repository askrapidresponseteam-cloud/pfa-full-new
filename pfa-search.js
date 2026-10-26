/* People for Animals - site search.
   ------------------------------------------------------------------------
   One script, four jobs:
   1. INDEX: every page, section, action and law a visitor can reach.
      Curated rows live below; a crawled index (search-index.json, built by
      build-index.js) is merged on top when present, so new pages become
      searchable without touching this file.
   2. ENGINE: field-weighted, IDF-scaled ranking with stemming, stop words,
      synonyms, prefix matching, typo tolerance (edit distance via trigram
      candidates), phrase bonuses, coverage bonuses and "did you mean".
   3. OVERLAY: the "What would you like to do today?" layer, with live
      results, query completions, recent searches and full keyboard control.
   4. RESULTS PAGE: search.html, with section facets, counts and in-place
      re-ranking. Fires `pfa:search` / `pfa:search-click` events for analytics.
   Include with: <link rel="stylesheet" href="pfa-search.css">
                 <script src="pfa-search.js" defer></script>
   ------------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ================================================================ INDEX */
  /* t title · s section · y type (action|place|law|page|article)
     u url · d description · k keywords
     q the searches this row is the answer to ("best bets"): when a query is
       one of these, or holds every word of one, the row goes to the top.
       This is how the box answers what people actually type, in their own
       words, rather than what the page happens to be titled.                */
  var CURATED = [
    /* ---- Do something ---- */
    { t: 'Report cruelty', s: 'Do something', y: 'action', u: 'report.html',
      d: 'Tell PFA about an animal being hurt, neglected or abandoned. A named person picks it up, you get a reference, and you can follow it.',
      k: 'report abuse beaten beating hurt neglect abandoned injured emergency rescue complaint cruelty animal dog cat cow street stray poisoning police',
      q: ['report', 'report cruelty', 'cruelty', 'complaint', 'animal abuse', 'dog beaten', 'dog beating', 'beating dog', 'beating animal', 'hitting dog', 'torture', 'abandoned dog', 'neglect'] },
    { t: 'Careers: five openings', s: 'Do something', y: 'action', u: 'careers.html',
      d: 'Zonal Heads for nine Zones, veterinary doctors at the Sanjay Gandhi Animal Care Centre, a Cruelty Response Coordinator, Social Media and Fundraising, and interns. One application, five short screens.',
      k: 'careers jobs job work hiring vacancy vacancies openings zonal head zone coordinator employment recruit apply position salary veterinary doctor para vet internship intern social media fundraising cruelty response coordinator',
      q: ['careers', 'jobs', 'job', 'hiring', 'vacancy', 'work with pfa', 'work at pfa', 'internship', 'intern', 'vet job', 'veterinary job', 'jobs for vets'] },
    { t: 'Ask us anything', s: 'Do something', y: 'action', u: 'ask.html',
      d: 'A question about an animal, a law, a unit, adoption or anything else. A named person answers, and you get a reference.',
      k: 'ask question help contact email call talk someone query enquiry inquiry doubt advice support helpline',
      q: ['ask', 'question', 'ask a question', 'enquiry', 'inquiry', 'advice', 'help'] },
    { t: 'Who to report cruelty to, and which sections', s: 'Laws', y: 'law', u: 'laws.html#a33',
      d: 'Filing with the police yourself: BNS 325 with PCA s.11, why it is cognizable, and what to do if the FIR is refused.',
      k: 'report cruelty police fir section 325 cognizable refuse superintendent magistrate complaint' },
    { t: 'What a good complaint should contain', s: 'Do something', y: 'action', u: 'laws.html#d49',
      d: 'The facts, sections and evidence to put in a cruelty complaint so it cannot be brushed aside.',
      k: 'complaint write draft file fir police letter evidence sections report' },
    { t: 'Police refuse to register an FIR', s: 'Do something', y: 'action', u: 'laws.html#b48',
      d: 'What to do when a station will not take your complaint: BNSS Section 173(4) and 175(3).',
      k: 'fir refuse refused police station magistrate bnss 173 175 complaint',
      q: ['fir refused', 'fir not registered', 'police refuse fir', 'police not helping', 'police refuse'] },
    { t: 'Apply for a colony caregiver card', s: 'Do something', y: 'action', u: 'get-involved.html#caregiver',
      d: 'The application: about you, your colony, a free card with \u20b950 for postage only, and a named person at PFA decides. You get an application number the moment the fee clears.',
      k: 'become a caregiver colony caregiver card apply id identity feeder feeding community dogs colony caregiver application register form abc rules rwa',
      q: ['caregiver card', 'colony caregiver', 'become a caregiver', 'feeder card', 'feeder id', 'feeding card', 'dog feeder id card'] },
    { t: 'Is feeding community dogs legal? Caregiver rights', s: 'Laws', y: 'law', u: 'laws.html#a10',
      d: 'Feeding community dogs is lawful under the ABC Rules 2023. What the law says about caregivers, and the RWA rules.',
      k: 'feeding community dogs legal lawful abc rules 2023 rwa caregiver rights society stop feeding',
      q: ['feeding street dogs', 'feeding stray dogs', 'feeding dogs legal', 'is feeding dogs legal', 'stop feeding', 'neighbour stop feeding', 'feeding law'] },
    { t: 'Can my RWA ban pets or feeding?', s: 'Do something', y: 'action', u: 'laws.html#a11',
      d: 'No. What the ABC Rules 2023 and the courts say about societies that try to stop feeding or keeping pets.',
      k: 'rwa society apartment ban pets feeding stray dogs colony resident welfare' },
    { t: 'Donate', s: 'Do something', y: 'action', u: 'donate.html',
      d: 'Give once or monthly, in rupees or dollars. Rupee donations are tax-deductible under Section 80G.',
      k: 'donate donation give money support fund sponsor monthly 80g tax deductible pay',
      q: ['donate', 'donation', 'give money', 'monthly donation', 'donate monthly', 'support pfa', 'fund', 'sponsor'] },
    /* Owner, 8 Oct 2026: a gift certificate, like the old site's
       make-a-gift page. The footer's "Make a gift" opens the same place. */
    { t: 'Give as a gift', s: 'Do something', y: 'action', u: 'donate.html?gift=1',
      d: 'Give in someone\u2019s name, for a birthday, a wedding, a new baby or in memory. They are posted a Certificate of Appreciation signed by Smt. Maneka Sanjay Gandhi. From \u20b91,000.',
      k: 'gift gifts certificate present tribute memorial honour honor occasion in memory name',
      q: ['gift', 'make a gift', 'give a gift', 'gift certificate', 'donation certificate', 'certificate of appreciation', 'gift in someone name', 'donate in someone name', 'donation in name of', 'in memory', 'in memory of', 'tribute', 'tribute donation', 'memorial donation', 'birthday gift', 'wedding gift', 'anniversary gift', 'present'] },
    { t: 'Your 80G tax receipt', s: 'Do something', y: 'action', u: 'donate.html#fine1',
      d: 'Rupee donations to People for Animals are eligible for tax deduction under Section 80G. The receipt is emailed to you, in your name; add your PAN when you give.',
      k: '80g tax receipt deduction exemption income pan certificate rebate',
      q: ['80g', '80g receipt', 'tax receipt', 'tax exemption', 'tax deduction', 'tax benefit', 'income tax', 'donation receipt', 'receipt'] },
    /* the microsites (owner, 9 Oct 2026) */
    { t: 'Leave a legacy', s: 'Do something', y: 'action', u: 'legacy.html',
      d: 'Remember the animals in your will: the ways a gift in a will can work, the wording to take to your lawyer, and a private way to talk to PFA about it.',
      k: 'legacy will bequest estate lawyer clause residue planned giving remember',
      q: ['legacy', 'leave a legacy', 'will', 'bequest', 'gift in will', 'gift in my will', 'remember in will', 'legacy giving', 'planned giving'] },
    { t: 'CSR partnerships', s: 'Do something', y: 'action', u: 'csr.html',
      d: 'Twelve programmes a company\u2019s CSR can fund under Schedule VII, and a brief PFA replies to with a plan.',
      k: 'csr corporate social responsibility company companies act schedule vii partnership funding business employee volunteering',
      q: ['csr', 'corporate social responsibility', 'csr partnership', 'company partnership', 'corporate partnership', 'csr funding', 'schedule vii',
        'company tie up', 'tie up', 'corporate tie up', 'partner with pfa', 'brand partnership', 'sponsor', 'sponsorship'] },
    { t: 'Plan a campaign', s: 'Do something', y: 'action', u: 'campaign.html',
      d: 'A birthday, a workplace drive, a run or a school collection for the animals: pick a cause and a way to raise for it, and PFA replies on how to run it.',
      k: 'campaign fundraiser fundraising raise money collection drive birthday run challenge awareness',
      q: ['campaign', 'fundraiser', 'fundraising', 'start a fundraiser', 'raise money', 'birthday fundraiser', 'fundraise', 'crowdfunding'] },
    { t: 'PFA Campus: start a society', s: 'Do something', y: 'action', u: 'campus.html',
      d: 'An animal welfare society at your college, university or school, with PFA behind it: the desks a team can run, and registration in a few screens.',
      k: 'campus college university school students society club chapter youth animal welfare society register',
      q: ['campus', 'pfa campus', 'college society', 'college club', 'animal welfare society', 'student society', 'students', 'school club',
        'schools program', 'school programme', 'school program', 'college program', 'awareness in schools', 'university society'] },
    { t: 'Sanjay Gandhi Animal Care Centre', s: 'About', y: 'page', u: 'sgacc.html',
      d: 'PFA\u2019s flagship animal care centre at Raja Garden, New Delhi, since 1980: what happens there, photographs, how to help, and how to find it.',
      k: 'sanjay gandhi animal care centre center sgacc raja garden delhi shelter wards wishlist visit supplies',
      q: ['sgacc', 'sanjay gandhi animal care centre', 'sanjay gandhi animal care center', 'raja garden', 'pfa shelter delhi', 'animal care centre'] },
    { t: 'Privacy policy', s: 'About', y: 'page', u: 'privacy.html',
      d: 'What the website collects, why, who else handles it, how long it is kept, and how to ask for a copy, a correction or erasure.',
      k: 'privacy policy data personal information cookies dpdp protection erase delete consent rights',
      q: ['privacy', 'privacy policy', 'my data', 'personal data', 'delete my data', 'erase my data', 'data protection', 'cookies'] },
    { t: 'Send food to a shelter', s: 'Do something', y: 'action', u: 'donate.html#flowGive',
      d: 'Buy feed at cost for a shelter you pick by state and district, delivered in your name.',
      k: 'food feed shelter donate kibble bulk district village pin',
      q: ['send food', 'food to shelter', 'feed a shelter', 'donate food'] },
    { t: 'Volunteer', s: 'Do something', y: 'action', u: 'get-involved.html#volunteer',
      d: 'One application for all of PFA: read what each area involves, including the Sanjay Gandhi Animal Care Centre, pick the ones that fit your time, and apply. A named person reads every application.',
      k: 'volunteer volunteering help join work weekend student sanjay gandhi animal care centre shelter',
      q: ['volunteer', 'volunteering', 'student volunteer', 'help out', 'volunteer at shelter', 'volunteer in delhi', 'volunteer at sgacc', 'volunteer at animal care centre', 'volunteer with animals'] },
    { t: 'Become a member', s: 'Do something', y: 'action', u: 'get-involved.html#membership',
      d: 'Join People for Animals as a member: a card in your name, and a say in the work near you.',
      k: 'member membership join card sign up subscribe',
      q: ['member', 'membership', 'become a member', 'join', 'join pfa', 'membership card'] },
    /* units.html#apply (22 Oct 2026): the application for a new unit, online,
       with the paper form beside it on the same page. */
    { t: 'Start a PFA unit in your district', s: 'Do something', y: 'action', u: 'units.html#apply',
      d: 'Apply to set up a PFA unit: the application form online, a screen at a time, or the paper form to download and email.',
      k: 'start new unit set up open form application apply approval board district chapter branch undertaking paper pdf download',
      q: ['start a unit', 'new unit', 'set up a unit', 'start pfa unit', 'pfa unit application', 'unit application', 'unit application form', 'start pfa in my district', 'unit form'] },
    { t: 'Send a rescue story to The Wall', s: 'Do something', y: 'action', u: 'wall.html#submit',
      d: 'Submit a video of an animal you helped, long or short form.',
      k: 'submit send upload video story rescue wall reel instagram' },
    /* ---- Places ---- */
    /* Was "Animal hospitals: PFA hospitals, shelters, mobile clinics and
       rescue teams". PFA runs none of those (PFA, 23 Aug 2026); each unit is
       a named person and a number. Searches for a hospital, a vet or an
       ambulance still land here, because calling the nearest unit is what
       PFA itself tells someone with an animal in trouble (ask.html). */
    { t: 'Find a unit near you', s: 'Places', y: 'place', u: 'units.html',
      d: 'PFA\u2019s people in towns and cities across India, by state, each with a name and a number. Call the nearest when an animal near you needs help.',
      k: 'unit units near me nearest local contact phone number call city town state district hospital hospitals clinic vet veterinary doctor treatment ambulance rescue shelter injured sick emergency centre center branch office location ngo',
      q: ['unit', 'units', 'unit near me', 'near me', 'nearest unit', 'pfa near me', 'vet', 'vet near me', 'doctor', 'animal doctor', 'hospital', 'animal hospital', 'hospital near me', 'clinic', 'ambulance', 'animal ambulance', 'rescue', 'animal rescue', 'rescue near me', 'shelter near me', 'ngo near me', 'injured animal', 'injured dog', 'injured cat', 'injured cow', 'sick animal', 'dog hit by car', 'accident dog', 'help animal', 'help dog', 'help injured animal', 'animal in trouble', 'stray dog help'] },
    { t: 'Events near you', s: 'Places', y: 'place', u: 'events.html',
      d: 'Adoption drives, camps, CineKind screenings and shelter open days, searchable by city.',
      k: 'events event camp drive walk talk calendar upcoming city venue date adoption adopt',
      q: ['events', 'event', 'adopt', 'adoption', 'adopt a dog', 'adopt a puppy', 'adopt a cat', 'adoption drive', 'camp'] },

    /* ---- Laws ---- */
    { t: 'Animal laws in India', s: 'Laws', y: 'law', u: 'laws.html',
      d: 'Answers on animal law in India, each citing the section it rests on: dogs, cattle, husbandry, and horses.',
      k: 'law laws legal rights act rules court police fir section ipc bns constitution pca questions',
      q: ['law', 'laws', 'animal law', 'animal laws', 'legal', 'rights', 'animal rights'] },
    { t: 'Laws: dogs', s: 'Laws', y: 'law', u: 'laws.html#part-a',
      d: 'Fifty questions on street dogs, pets, feeding, bites, RWAs and the ABC Rules.',
      k: 'law dog dogs street stray pet bite abc rules feeding' },
    { t: 'Laws: cows and cattle', s: 'Laws', y: 'law', u: 'laws.html#part-b',
      d: 'Fifty questions on cattle, dairies, transport, slaughter and seizure.',
      k: 'law cow cows cattle dairy gaushala transport slaughter seizure bull buffalo' },
    { t: 'Laws: animal husbandry', s: 'Laws', y: 'law', u: 'laws.html#part-c',
      d: 'Fifty questions on farms, poultry, feed, antibiotics and veterinary practice.',
      k: 'law farm poultry chicken hen feed antibiotics husbandry veterinary' },
    { t: 'Laws: horses and working equines', s: 'Laws', y: 'law', u: 'laws.html#part-d',
      d: 'Fifty questions on horses, donkeys, mules, tongas, weddings, racing and rescue.',
      k: 'law horse horses donkey mule equine tonga wedding racing branding' },


    /* ---- Explore ---- */
    { t: 'Newsroom', s: 'Explore', y: 'article', u: 'newsroom.html',
      d: 'Cases, campaigns and what changed this week, with the record of how each one moved.',
      /* `wire` stays in the keywords on purpose: the section was called The
         Wire, and anyone who remembers that should still land here. */
      k: 'news dispatch dispatches wire updates blog stories press campaign latest cases record',
      q: ['news', 'newsroom', 'press', 'press release', 'media', 'latest', 'updates', 'blog', 'cases'] },
    { t: 'The Wall', s: 'Explore', y: 'page', u: 'wall.html',
      d: 'Rescue videos sent in by people across the country, long form and short form.',
      k: 'wall gallery videos photos rescued animals reel' },
    { t: 'CineKind Awards', s: 'Explore', y: 'page', u: 'cinekind.html',
      d: 'The award for cinema that moves a country towards kindness, and its honourees.',
      k: 'cinekind film films movie cinema award awards honourees ceremony',
      q: ['cinekind', 'film award', 'awards', 'cinema', 'movie award'] },
    { t: 'Academy: animal healthcare made legible', s: 'Explore', y: 'page', u: 'academy.html',
      d: 'Ten modules on medicines, antibiotics, vaccines, antivenom, immunoglobulins, first aid and dosages, written for India and cited line by line.',
      k: 'academy learn course lessons module health healthcare medicine medicines medical veterinary animal care guide education training' },
    { t: 'Dog and cat vaccination schedule', s: 'Explore', y: 'article', u: 'academy.html#d2',
      d: 'The Indian schedule for puppies, kittens, adult dogs and cats: distemper, parvo, rabies, leptospirosis, and why one shot is not vaccination.',
      k: 'vaccine vaccines vaccination schedule puppy kitten dog cat rabies parvo distemper lepto shot shots booster wsava',
      q: ['vaccination schedule', 'vaccine schedule', 'puppy vaccination', 'puppy vaccine', 'dog vaccine', 'dog vaccination', 'cat vaccine', 'kitten vaccine'] },
    { t: 'Cattle, buffalo, goat and sheep vaccination schedules', s: 'Explore', y: 'article', u: 'academy.html#d5',
      d: 'FMD, HS, BQ, brucellosis, PPR, goat pox, LSD: the NDDB and ICAR calendars and the national programme.',
      k: 'cattle cow buffalo goat sheep livestock vaccine vaccination fmd hs bq brucellosis ppr lumpy skin lsd nadcp farm dairy schedule' },
    { t: 'Snakebite: first aid and antivenom', s: 'Explore', y: 'article', u: 'academy.html#e4',
      d: 'Keep the animal still and go straight to antivenom. No tourniquet, no cutting, no ice. What Indian polyvalent antivenom neutralises.',
      k: 'snake snakebite bite bitten antivenom asv venom cobra krait viper russell first aid emergency',
      q: ['snake bite', 'snakebite', 'snake bit dog', 'cobra bite', 'antivenom'] },
    { t: 'Dog bite: rabies prophylaxis for the person bitten', s: 'Explore', y: 'article', u: 'academy.html#f2',
      d: 'Wash for fifteen minutes, then immunoglobulin and the vaccine the same day. The national protocol, step by step, for caregivers and volunteers.',
      k: 'rabies bite bitten dog bite prophylaxis pep vaccine immunoglobulin rig scratch wound wash injection anti rabies clinic',
      q: ['dog bite', 'dog bit me', 'bitten by dog', 'rabies injection', 'anti rabies', 'rabies vaccine human', 'cat scratch'] },
    { t: 'Heatstroke in dogs and cattle: cool first, transport second', s: 'Explore', y: 'article', u: 'academy.html#g6',
      d: 'Water over the whole body, airflow, immersion for a young healthy dog; no wet towels, no ice. Stop at 39.4 degrees.',
      k: 'heatstroke heat stroke summer hot panting collapse cooling dog cattle buffalo first aid emergency',
      q: ['heatstroke', 'heat stroke', 'dog panting', 'summer heat', 'heat'] },
    { t: 'First aid for an injured animal', s: 'Explore', y: 'article', u: 'academy.html#part-g',
      d: 'The first hour, before the vet: approaching safely, the sixty-second check, road accidents, bleeding, fractures, heatstroke, poisoning, burns and newborns.',
      k: 'first aid injured injury hurt accident road hit car bleeding wound fracture broken leg emergency sick dying unconscious collapse help what to do',
      q: ['first aid', 'injured', 'injured dog', 'injured animal', 'dog hit by car', 'road accident', 'accident', 'bleeding', 'wound', 'broken leg', 'what to do injured'] },
    { t: 'Found a puppy or kitten on its own', s: 'Explore', y: 'article', u: 'academy.html#g10',
      d: 'Newborns and orphans: warm before you feed, and never plain cow\u2019s milk. What to do in the first hours.',
      k: 'puppy puppies kitten kittens newborn orphan orphaned abandoned found baby mother milk warm feed',
      q: ['found puppy', 'found kitten', 'abandoned puppy', 'abandoned kitten', 'orphan puppy', 'newborn puppy', 'puppy without mother', 'kitten without mother'] },
    { t: 'Poisoning: rat poison, insecticide, chocolate, paracetamol', s: 'Explore', y: 'article', u: 'academy.html#g7',
      d: 'What each poison looks like in an animal and what matters in the first hour. Never induce vomiting with salt.',
      k: 'poison poisoned poisoning rat poison bromadiolone zinc phosphide chocolate xylitol paracetamol ibuprofen insecticide toxic vomiting first aid',
      q: ['dog poisoned', 'poisoned dog', 'cat poisoned', 'poisoning', 'rat poison', 'dog ate poison', 'dog ate chocolate'] },
    { t: 'Check a prescription dose: mg per kg to tablets or mL', s: 'Explore', y: 'page', u: 'academy.html#h4',
      d: 'Enter the weight, the written dose and the strength on the pack; the checker does the arithmetic and flags what cannot be measured.',
      k: 'dose dosage calculator mg kg tablet ml prescription arithmetic check weight strength medicine',
      q: ['dose calculator', 'dosage calculator', 'how much medicine', 'medicine dose', 'mg per kg'] },
    { t: 'Medicines that kill cats and dogs', s: 'Explore', y: 'article', u: 'academy.html#i2',
      d: 'Paracetamol, permethrin, ibuprofen, ivermectin in Collies, Dettol on cats: the contraindications by species, breed, pregnancy and kidney.',
      k: 'paracetamol crocin permethrin ibuprofen diclofenac dettol toxic cat dog kill dangerous medicine never give contraindication safe',
      q: ['paracetamol dog', 'paracetamol cat', 'crocin dog', 'dettol cat', 'human medicine dog', 'medicine for dog'] },
    { t: 'Antibiotics: the rules of a course and milk withdrawal', s: 'Explore', y: 'article', u: 'academy.html#c3',
      d: 'Right diagnosis, drug, dose, interval and duration; culture and sensitivity; the colistin ban; when treated milk may be sold.',
      k: 'antibiotic antibiotics amoxicillin doxycycline enrofloxacin resistance course withdrawal milk colistin tick fever infection' },
    { t: 'What animals know, learn and remember', s: 'Explore', y: 'article', u: 'someone.html#adopt',
      d: 'The research on hens, pigs, cows, goats, sheep and horses, from peer-reviewed studies.',
      k: 'science research cognition intelligence hen pig cow goat sheep horse chicken mind feelings sentience study',
      q: ['sentient', 'sentience', 'are animals sentient', 'are fish sentient', 'animal sentience', 'do animals feel pain', 'animal intelligence', 'do animals have feelings'] },
    { t: 'Test yourself: who would you underestimate?', s: 'Explore', y: 'page', u: 'quiz.html',
      d: 'A two-minute quiz on what farm animals can do.', k: 'quiz test game' },

    { t: 'Track a submission or an order', s: 'Do something', y: 'page', u: 'track.html',
      d: 'Follow a report, a question or an application with the number you were given.',
      k: 'track follow status where is my order application reference number check progress complaint',
      q: ['track', 'status', 'reference number', 'track report', 'track order', 'order status', 'application status',
        'is my application approved', 'application approved', 'my application', 'where is my card', 'card status', 'complaint status',
        'check status', 'track complaint', 'track my complaint', 'track application', 'has my complaint been seen'] },

    { t: 'Policies and achievements: what PFA has changed', s: 'About', y: 'page', u: 'achievements.html',
      d: 'Thirty years of rules rewritten, orders obtained and practices ended, on eight fronts.',
      k: 'achievements record history impact wins what we have done milestones results track record',
      q: ['achievements', 'pfa achievements', 'pfa work', 'our work', 'works', 'pfa works', 'what pfa has done', 'what has pfa done', 'pfa projects', 'projects',
        'pfa campaigns', 'campaigns won', 'track record', 'impact', 'pfa impact', 'pfa policies', 'policy wins'] },

    /* ---- About ---- */
    { t: 'Founder: Maneka Sanjay Gandhi', s: 'About', y: 'page', u: 'founder.html',
      d: 'The person who started People for Animals, and what she set out to build.',
      k: 'founder maneka gandhi history started who',
      q: ['maneka gandhi', 'maneka', 'founder', 'who started pfa'] },
    /* Where PFA is and how to reach it: the footer on every page carries it
       (id="contact"), so the answer is in the row itself. */
    { t: 'Contact People for Animals', s: 'About', y: 'page', u: 'index.html#contact',
      d: '4-T, DCM Building, 16 Barakhamba Road, New Delhi 110001. +91 11 2081 8191 or +91 11 2081 8194. gandhim@exmpls.sansad.in',
      k: 'contact address office head phone number telephone call email mail reach write delhi barakhamba',
      q: ['contact', 'contact us', 'contact pfa', 'phone', 'phone number', 'telephone', 'email', 'email address', 'address', 'head office', 'office address'] }
  ];

  var SECTIONS = ['Do something', 'Places', 'Laws', 'Explore', 'About'];
  var TYPE_BOOST = { action: 1.15, place: 1.1, law: 1.0, page: 1.0, article: 0.95 };

  /* What visitors type → what the index says. A value may name more than
     one word; each is looked for, a little below the word itself.

     Hindi and Hinglish, as people type it in Roman letters (8 Oct 2026):
     "kutta" used to be corrected to "dutta" and land on a unit whose head
     is called Dutta; "gau" became "gap". The animals, the urgent words and
     the everyday ones are here so they mean what they mean.

     A vet, a doctor, a clinic or a hospital means the nearest unit: PFA has
     no hospitals, and calling the unit is what PFA tells people to do. */
  var SYNONYMS = {
    vet: 'unit', vets: 'vet unit', veterinarian: 'vet unit', veterinary: 'vet unit', doctor: 'vet unit',
    clinic: 'vet unit', hospital: 'unit vet infirmary', hospitals: 'unit vet infirmary', treatment: 'vet unit', ambulance: 'unit injured',
    abuse: 'cruelty', abused: 'cruelty', beating: 'cruelty', beaten: 'cruelty', beat: 'cruelty', torture: 'cruelty',
    hurt: 'cruelty', hurting: 'cruelty', poison: 'poisoning cruelty', poisoned: 'poisoning cruelty', kicked: 'cruelty', violence: 'cruelty',
    hitting: 'cruelty', hit: 'cruelty', killing: 'cruelty', killed: 'cruelty', cruel: 'cruelty',
    stray: 'street', strays: 'street', puppies: 'puppy', kittens: 'kitten',
    injury: 'injured', injuries: 'injured', wounded: 'injured wound', accident: 'road injured', bleeding: 'injured wound',
    ill: 'sick', unwell: 'sick', dying: 'sick emergency',
    id: 'card', identity: 'card', feeder: 'caregiver', feeding: 'caregiver feed',
    money: 'donate', give: 'donate', giving: 'donate', payment: 'donate', pay: 'donate', contribute: 'donate', donation: 'donate', donations: 'donate',
    tribute: 'gift', memorial: 'gift memory', present: 'gift', certificate: 'gift', honour: 'gift', honor: 'gift',
    tax: '80g', receipt: '80g',
    adopt: 'adoption', adopting: 'adoption', foster: 'adoption',
    legal: 'law', rights: 'law', act: 'law', police: 'fir', complaint: 'report', report: 'cruelty',
    location: 'units', locations: 'units', branch: 'units', branches: 'units', nearest: 'unit',
    centre: 'units', center: 'units', centres: 'units', centers: 'units', office: 'contact',
    phone: 'contact', number: 'contact', telephone: 'contact', helpline: 'contact unit', call: 'contact',
    film: 'cinekind', films: 'cinekind', movie: 'cinekind', movies: 'cinekind', cinema: 'cinekind',
    award: 'cinekind honour', awards: 'cinekind honour', awardee: 'cinekind honour', winner: 'cinekind honour', winners: 'cinekind honour',
    nominate: 'nomination', nominee: 'nomination', nominees: 'nomination',
    horse: 'equine', horses: 'equine', pony: 'equine horse', ponies: 'equine horse', mule: 'equine', mules: 'equine', donkey: 'equine', donkeys: 'equine', equine: 'horse', equines: 'horse',
    infirmary: 'hospital vet', tv: 'television broadcasting', television: 'broadcasting', channel: 'broadcasting', course: 'curriculum', courses: 'curriculum', du: 'delhi university', '3rs': 'replacement reduction refinement',
    cock: 'animal fights', cockfight: 'animal fights', cockfighting: 'animal fights', rooster: 'animal fights', dhirio: 'bullfight goa',
    charmer: 'wild animals performers wildlife', charmers: 'wild animals performers wildlife', madari: 'wild animals performers wildlife', whip: 'whipping', whips: 'whipping',
    tieup: 'csr partnership', partner: 'partnership', partners: 'partnership', sponsor: 'csr', sentient: 'sentience', feelings: 'sentience',
    merch: 'shop', merchandise: 'shop', apparel: 'shop', clothes: 'shop', clothing: 'shop', wear: 'shop',
    tshirt: 't-shirt shop', tshirts: 't-shirt shop', tee: 't-shirt shop', tees: 't-shirt shop', shirt: 't-shirt shop', shirts: 't-shirt shop',
    designer: 'shop', designers: 'shop',
    book: 'library', books: 'library', document: 'library', documents: 'library', pdf: 'library', pdfs: 'library', handbooks: 'handbook', manual: 'handbook', guide: 'handbook',
    experiment: 'testing laboratory', experiments: 'testing laboratory', lab: 'laboratory testing', labs: 'laboratory testing', vivisection: 'testing laboratory',
    story: 'newsroom', stories: 'newsroom', article: 'newsroom', articles: 'newsroom',
    /* the section's old name still finds the Newsroom */
    news: 'newsroom', update: 'newsroom', updates: 'newsroom', press: 'newsroom', release: 'newsroom', media: 'newsroom', wire: 'newsroom',
    job: 'careers', jobs: 'careers', vacancy: 'careers', hiring: 'careers', intern: 'careers', internship: 'careers',
    member: 'membership', join: 'membership',
    kibble: 'food', treats: 'food', meds: 'medicine', medication: 'medicine', dewormer: 'medicine', leash: 'gear', collar: 'gear',
    vaccinate: 'vaccine', vaccinated: 'vaccine', jab: 'vaccine', antivenin: 'antivenom', firstaid: 'aid',
    overdose: 'dose', dosing: 'dose', tablets: 'tablet', learn: 'academy', lesson: 'academy', lessons: 'academy',
    fireworks: 'firecrackers', firework: 'firecrackers', crackers: 'firecrackers', cracker: 'firecrackers',
    parrot: 'bird', parrots: 'bird', parakeet: 'bird', pigeon: 'bird', pigeons: 'bird', myna: 'bird', crow: 'bird',
    puppy: 'puppy dog', kitten: 'kitten cat', calf: 'calf cow', calves: 'calf cow', cow: 'cattle', cows: 'cattle', ox: 'bullock cattle',
    spay: 'sterilisation sterilised', spayed: 'sterilisation sterilised', neuter: 'sterilisation sterilised', neutered: 'sterilisation sterilised',
    sterilization: 'sterilisation', sterilize: 'sterilisation sterilised', sterilized: 'sterilisation sterilised', sterilise: 'sterilisation sterilised',
    castration: 'castrate sterilisation', appetite: 'sick', vomit: 'vomiting', diarrhoea: 'diarrhea', mangy: 'mange',
    poaching: 'wildlife', poacher: 'wildlife', hunting: 'wildlife', hunter: 'wildlife', ivory: 'elephant wildlife',
    leopard: 'wildlife', tiger: 'wildlife', deer: 'wildlife', wild: 'wildlife', zoo: 'zoo wildlife', zoos: 'zoo wildlife',
    fur: 'skins', wool: 'sheep', vegan: 'sentience farm', vegetarian: 'sentience farm',
    /* Hindi and Hinglish */
    kutta: 'dog', kutte: 'dog', kutton: 'dog', kuttey: 'dog', kuta: 'dog', kute: 'dog', kukur: 'dog',
    billi: 'cat', billiyan: 'cat', billa: 'cat',
    gai: 'cow cattle', gaay: 'cow cattle', gaai: 'cow cattle', gau: 'cow cattle', gou: 'cow cattle', gaumata: 'cow cattle', gomata: 'cow cattle', gauvansh: 'cow cattle', govansh: 'cow cattle',
    goshala: 'gaushala', gowshala: 'gaushala', gaushalas: 'gaushala',
    saand: 'bull', bhains: 'buffalo', bhens: 'buffalo', bakri: 'goat', bakra: 'goat', bhed: 'sheep',
    ghoda: 'horse', ghodi: 'horse', ghora: 'horse', ghode: 'horse', gadha: 'donkey', gadhe: 'donkey', khachar: 'mule', oont: 'camel', unt: 'camel',
    bandar: 'monkey', bander: 'monkey', saanp: 'snake', saap: 'snake', sanp: 'snake', naag: 'snake', haathi: 'elephant', hathi: 'elephant',
    chidiya: 'bird', pakshi: 'bird', panchhi: 'bird', parinda: 'bird', tota: 'bird', kabutar: 'bird',
    murga: 'chicken poultry', murgi: 'chicken poultry', suar: 'pig', suwar: 'pig',
    janwar: 'animal', jaanwar: 'animal', janvar: 'animal', jaanvar: 'animal', pashu: 'animal', jeev: 'animal',
    madad: 'help', sahayata: 'help', bachao: 'help rescue',
    daan: 'donate', chanda: 'donate', upahaar: 'gift', uphaar: 'gift', tohfa: 'gift',
    kanoon: 'law', kanun: 'law', kaanoon: 'law', kaanun: 'law', niyam: 'rules law',
    shikayat: 'complaint report', shikayet: 'complaint report',
    ghayal: 'injured', zakhmi: 'injured', jakhmi: 'injured', chot: 'injured', bimar: 'sick', beemar: 'sick',
    dawai: 'medicine', dawa: 'medicine', dava: 'medicine', teeka: 'vaccine', tika: 'vaccine', tikakaran: 'vaccine',
    khana: 'food feed', khilana: 'feeding feed', pani: 'water',
    maar: 'cruelty', maarna: 'cruelty', maarte: 'cruelty', peet: 'cruelty', peetna: 'cruelty', pitai: 'cruelty', zulm: 'cruelty', atyachar: 'cruelty',
    zeher: 'poisoning', zehar: 'poisoning', jahar: 'poisoning', kaata: 'bite', kata: 'bite', kaat: 'bite', katna: 'bite', pagal: 'rabies',
    awara: 'street', aawara: 'street', raksha: 'protection', suraksha: 'protection', seva: 'care',
    naukri: 'careers', sadasya: 'membership', sadasyata: 'membership', sampark: 'contact'
  };
  var STOP = /^(not|no|dont|don|t|a|an|the|to|of|for|in|on|is|it|i|my|me|do|how|what|who|can|and|or|being|near|with|about|want|need|please|where|when|there|any|some|get|find|show|open|page|pfa|someone|somebody|anyone|anybody|this|that|these|those|does|did|are|was|were|will|would|should|could|if|at|by|from|be|been|have|has|had|we|you|your|our|us|they|them|he|she|his|her|its|am|very|so|just|also|which|kya|kaise|kahan|hai|ko|ka|ki|ke|se|mein|me|par|aur|ya|ek)$/;

  /* Shown before anyone types. */
  var QUICK = ['Report cruelty', 'Find a unit near you', 'Ask us anything', 'Animal laws in India', 'Apply for a colony caregiver card', 'Donate'];
  /* Seed only. Real "most asked" comes from /api/search-popular; this is what
     shows on a cold start, offline, or on a build with no API behind it. */
  var CURATED_FALLBACK = ['Report cruelty', 'Find a unit near you', 'Apply for a colony caregiver card',
                          'Animal laws in India', 'Give as a gift', 'Donate'];

  /* Best bets for crawled rows, by address. The crawl knows what a page
     says; this knows what people type to reach it. Each key must be a row
     of the shipped index (test/search-supreme.test.js checks). */
  var BEST_BETS = {
    'academy.html#b8': ['sick dog', 'sick street dog', 'dog not eating', 'dog weak', 'dog fever', 'dog sick'],
    'academy.html#g9': ['diwali', 'firecrackers', 'fireworks', 'burn', 'burns', 'acid'],
    'academy.html#g12': ['injured bird', 'bird fell', 'baby bird', 'injured pigeon', 'injured monkey', 'wild animal injured', 'bird rescue'],
    'academy.html#g3': ['road accident', 'dog hit by car', 'hit by vehicle', 'broken back'],
    'laws.html#a3': ['killing dogs', 'dog killed', 'kill dog', 'dogs killed', 'killing dogs illegal'],
    'laws.html#a4': ['poisoning dogs', 'neighbour poisoned dog', 'poisoning community dogs', 'poisoned dogs law'],
    'laws.html#a5': ['abc rules', 'abc rules 2023', 'animal birth control', 'abc programme'],
    'laws.html#a7': ['dog relocation', 'relocate dogs', 'dogs removed', 'municipality took dogs', 'dog catchers', 'dogs picked up'],
    'laws.html#a8': ['supreme court', 'supreme court dogs', 'sc judgment', 'supreme court judgment'],
    'laws.html#a12': ['dog barking', 'barking complaint', 'barking dog'],
    'laws.html#a17': ['pet shop licence', 'pet shop license', 'pet shop rules'],
    'laws.html#a18': ['buy puppy', 'puppy online', 'buy dog', 'puppy for sale'],
    'laws.html#a22': ['dog chained', 'chained dog', 'tied dog', 'dog tied'],
    'laws.html#a24': ['train with dog', 'dog on train', 'travel with dog'],
    'laws.html#a27': ['dog bite compensation', 'compensation dog bite'],
    'laws.html#a34': ['dog in car', 'dog locked in car'],
    'laws.html#a36': ['landlord pets', 'landlord dog', 'rent with dog', 'tenant pet', 'tenant dog'],
    'laws.html#a33': ['which section', 'section 11', 'bns 325', 'ipc 428', 'ipc 429', 'file fir'],
    'laws.html#b11': ['cattle smuggling', 'cow smuggling'],
    'laws.html#b44': ['jallikattu', 'bull taming'],
    'laws.html#c46': ['animal sacrifice', 'sacrifice'],
    'laws.html#d7': ['horse wedding', 'wedding horse', 'baraat horse'],
    'achievements.html#rec-047': ['3rs', 'three rs', '3 rs', 'replace reduce refine'],
    'read.html?r=pca-act-1960': ['pca act', 'pca act 1960', 'prevention of cruelty to animals act', 'pca act pdf', 'cruelty act', 'animal cruelty act', 'the act'],
    'careers.html#veterinary-team': ['vet job', 'veterinary job', 'vet doctor job', 'jobs for vets', 'vet vacancy', 'veterinary doctor vacancy'],
    /* pages people reach by what they are for, not what they are titled */
    'lab-animal-rules.html': ['animal testing', 'lab animals', 'laboratory animals', 'testing on animals', 'animal experiments', 'experiments on animals', 'cpcsea', 'lab animal rules', 'draft rules',
      'lab animal testing', 'animal testing rules', 'laboratory animal testing', 'testing on lab animals', 'laboratory animals rules 2026'],
    'shop.html': ['shop', 'merchandise', 'merch', 't-shirt', 'tshirt', 'tshirts', 'designer t-shirts', 'designer tees', 'buy t-shirt', 'tees', 'tee'],
    'library.html': ['library', 'documents', 'handbooks', 'books', 'resources', 'download pdf', 'reports'],
    'quiz.html': ['quiz', 'test yourself', 'test my knowledge'],
    'events.html': ['events', 'event', 'upcoming events', 'events near me'],
    'newsroom.html': ['news', 'newsroom', 'latest news', 'stories', 'press'],
    'wall.html': ['wall', 'the wall', 'videos', 'reels', 'watch']
  };

  /* ================================================================ TEXT */
  /* Words whose plural-looking end is not a plural: "news" is not "new"
     (it matched every unit on a "New C G Road"). */
  var STEM_KEEP = { news: 1, species: 1, series: 1, rabies: 1, diabetes: 1, herpes: 1, scabies: 1, mumps: 1 };
  function stem(w) {
    if (STEM_KEEP[w]) return w;
    /* "whipping" is "whip", "stopping" is "stop"; "killing" stays "kill" */
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3).replace(/([bdgmnprt])\1$/, '$1');
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    /* "boxes", "dishes", "buses" lose "es"; "cages", "horses", "races" only
       their "s", so they meet "cage", "horse" and "race" */
    if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9()-]+/g, ' ').trim().split(/\s+/).map(function (w) {
      /* "(dog)" is "dog"; "11(1)" keeps its brackets, a section number */
      w = w.replace(/^[(-]+/, '').replace(/-+$/, '');
      return w.indexOf('(') < 0 ? w.replace(/\)+$/, '') : w;
    }).filter(Boolean);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ============================================================== ENGINE */
  var INDEX = [], VOCAB = {}, TRIGRAM = {}, DF = {}, N = 0;

  function trigrams(w) { var s = '  ' + w + ' ', out = []; for (var i = 0; i < s.length - 2; i++) out.push(s.substr(i, 3)); return out; }
  function editDistance(a, b) {          /* Damerau-Levenshtein */
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) { d[0][j] = j; }
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      var c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  /* A hyphenated word on the site is found as itself, as its parts and run
     together: "cage-free" by "cage free" and "cagefree", "t-shirt" by
     "tshirt" and "shirt". Applied to what is indexed, so a query stays the
     words that were typed. */
  /* halves that are not words of their own: "voiceless" is not "voice less" */
  var HALF_JUNK = /^(than|then|ever|into|onto|upon|less|ness|ment|ship|ward|wards|ting|ring|ated|able|ible|ally|wise|like|hood)$/;
  function expand(list) {
    var out = [];
    list.forEach(function (w) {
      out.push(w);
      if (w.indexOf('-') < 1) return;
      w.split('-').forEach(function (part) { if (part.length > 1) out.push(stem(part)); });
      out.push(w.replace(/-/g, ''));
    });
    return out;
  }
  /* the words as the site writes them, by stem, so "did you mean" offers
     "careers" and never the stem "career" or "vaccin" */
  var SURFACE = {};
  function noted(w) {
    var st = stem(w), list = SURFACE[st] || (SURFACE[st] = []);
    if (list.length < 4 && list.indexOf(w) < 0) list.push(w);
    return st;
  }
  function surface(st, typed) {
    var list = SURFACE[st];
    if (!list || !list.length) return st;
    return list.slice().sort(function (a, b) { return editDistance(typed, a) - editDistance(typed, b) || a.length - b.length; })[0];
  }
  function build(rows) {
    INDEX = rows; VOCAB = {}; TRIGRAM = {}; DF = {}; N = rows.length; SURFACE = {};
    rows.forEach(function (row, id) {
      row.id = id;
      row.tt = expand(tokens(row.t).map(noted));
      row.kt = expand(tokens(row.k || '').map(noted));
      row.dt = expand(tokens(row.d || '').map(noted));
      /* a unit's street address: findable ("chandkheda"), but it must not
         make every unit a result for "road" or "school" */
      row.at = tokens(row.a || '').map(stem);
      /* every other word the row's text holds (b, from the index builder):
         found, but at the weight of a passing mention (25 Oct 2026: "any
         and all related works should be lookable/findable") */
      row.bt = expand(tokens(row.b || '').map(noted));
      /* best-bet phrases, each kept as its content words, stemmed */
      row.qp = []; row.qx = [];
      (row.q || []).forEach(function (ph) {
        var all = tokens(ph), content = all.filter(function (x) { return !STOP.test(x); }).map(stem);
        if (!content.length) return;
        row.qp.push(content);
        /* as typed, for a phrase that is one word once its little words go:
           "work with pfa" is the jobs page, "pfa work" is not */
        row.qx.push(all.length > 1 && content.length === 1 ? all.join(' ') : '');
      });
      var seen = {};
      [row.tt, row.kt, row.dt, row.at, row.bt].concat(row.qp).forEach(function (list) {
        list.forEach(function (w) {
          if (!seen[w]) { seen[w] = 1; DF[w] = (DF[w] || 0) + 1; }
          if (!VOCAB[w]) {
            VOCAB[w] = 1;
            trigrams(w).forEach(function (g) { (TRIGRAM[g] = TRIGRAM[g] || []).push(w); });
          }
        });
      });
    });
    /* One word on the page, two in the query: "racehorses" is found by "race
       horses", "heatstroke" by "heat stroke". A long title or keyword word
       that is two of the site's own words, each at least four letters and
       each used on more than one row, also answers for its halves, at half
       a title's weight. */
    var named = {};
    rows.forEach(function (row) { row.tt.concat(row.kt).forEach(function (w) { named[w] = (named[w] || 0) + 1; }); });
    var whole = function (w) { return (named[w] > 0 || DF[w] > 2) && !STOP.test(w) && !HALF_JUNK.test(w); };
    rows.forEach(function (row) {
      var parts = [];
      row.tt.concat(row.kt).forEach(function (w) {
        if (w.length < 8 || w.indexOf('-') > -1) return;
        for (var i = 4; i <= w.length - 4; i++) {
          var a = w.slice(0, i), b = w.slice(i), sa = stem(a), sb = stem(b);
          var ha = whole(a) ? a : (whole(sa) ? sa : ''), hb = whole(b) ? b : (whole(sb) ? sb : '');
          if (ha && hb) { parts.push(ha, hb); break; }
        }
      });
      row.ct = parts;
    });
  }
  function idf(w) { return Math.log(1 + N / (1 + (DF[w] || 0))); }

  /* Closest vocabulary word for a typo, or null: of the word as typed and
     its stem, whichever is nearer ("carreers" is "careers", not "carrier"). */
  function correct(w) {
    var a = nearest(w), st = stem(w), b = st !== w ? nearest(st) : null;
    if (a && b) return b.d < a.d ? b.w : a.w;
    return (a || b) ? (a || b).w : null;
  }
  function nearest(w) {
    if (VOCAB[w] || w.length < 3) return null;
    var maxD = w.length >= 6 ? 2 : 1, counts = {};
    trigrams(w).forEach(function (g) { (TRIGRAM[g] || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var best = null, bestD = 99, bestDf = 0, bestRank = -1;
    Object.keys(counts).forEach(function (c) {
      if (counts[c] < 2 || Math.abs(c.length - w.length) > maxD) return;
      /* People rarely mistype the first letter, and a fix that changes it
         is usually a different word: "kutta" is not "dutta", "parrot" is
         not "narrow". Swapped first two letters are still a typo. */
      if (c[0] !== w[0] && !(c[0] === w[1] && c[1] === w[0])) return;
      var d = editDistance(w, c);
      /* Two edits that only shorten the word turn one real word into
         another ("tribute" into "tribe", "release" into "lease"). */
      if (d === 2 && Math.abs(c.length - w.length) > 1) return;
      if (d > maxD) return;
      /* equally near: a dropped letter is the commonest slip, so the word
         that ends as typed, then the longer word, then the commoner one
         ("injurd" is "injured", not "injury") */
      var rank = (c[c.length - 1] === w[w.length - 1] ? 2 : 0) + (c.length > w.length ? 1 : 0);
      if (d < bestD || (d === bestD && (rank > bestRank || (rank === bestRank && (DF[c] || 0) > bestDf)))) {
        best = c; bestD = d; bestDf = DF[c] || 0; bestRank = rank;
      }
    });
    return best ? { w: best, d: bestD } : null;
  }

  /* "reportcruelty", "dogfood": two known words typed as one. */
  function split(w) {
    if (VOCAB[w] || w.length < 6) return null;
    for (var i = 3; i <= w.length - 3; i++) {
      var a = w.slice(0, i), b = w.slice(i);
      if ((VOCAB[a] || VOCAB[stem(a)]) && (VOCAB[b] || VOCAB[stem(b)])) return [a, b];
    }
    return null;
  }

  /* "gau shala", "cine kind", "care giver": one word on this site, typed as
     two. Joined when the joined word is the site's and one of the two is
     not a word of its own here. */
  function joinSplit(list) {
    var known = function (w) { return VOCAB[w] || VOCAB[stem(w)]; };
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i], b = list[i + 1], j = b ? a + b : '';
      if (j.length >= 6 && known(j) && (!known(a) || !known(b))) { out.push(j); i++; continue; }
      out.push(a);
    }
    return out;
  }

  /* Character-level similarity, 0..1, for the last resort. */
  function similarity(a, b) {
    var ga = trigrams(a), gb = {}, hit = 0;
    trigrams(b).forEach(function (g) { gb[g] = (gb[g] || 0) + 1; });
    ga.forEach(function (g) { if (gb[g]) { hit++; gb[g]--; } });
    return ga.length ? (2 * hit) / (ga.length + Object.keys(gb).length + hit) : 0;
  }

  /* When nothing matches even after correction: the closest rows anyway,
     by how much the query looks like each title and its keywords. Never an
     empty screen for a real query. */
  function closest(query, limit) {
    var full = tokens(query).join(' ');
    if (!full) return [];
    var qt = tokens(query), hidden = hiddenNow();
    return INDEX.filter(function (row) { return !hidden || shown(row, hidden); }).map(function (row) {
      var title = row.t.toLowerCase();
      var sc = similarity(full, title) * 3;
      qt.forEach(function (w) {
        var best = 0;
        row.tt.concat(row.kt).forEach(function (v) {
          var d = editDistance(w, v), r = 1 - d / Math.max(w.length, v.length);
          if (r > best) best = r;
        });
        sc += best;
      });
      sc *= TYPE_BOOST[row.y] || 1;
      return { row: row, score: sc };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, limit || 5).map(function (x) { return x.row; });
  }

  /* One query word → the forms we look for, each with a confidence weight. */
  function forms(w0) {
    var out = [], push = function (w, c) { if (w && !out.some(function (o) { return o.w === w; })) out.push({ w: w, c: c }); };
    push(w0, 1); push(stem(w0), 1);
    var st = stem(w0), syn = SYNONYMS[w0] || SYNONYMS[st];
    if (syn) syn.split(' ').forEach(function (sw) { push(sw, 0.85); push(stem(sw), 0.85); });
    if (!VOCAB[w0] && !VOCAB[st] && !syn && !PLACE_WORDS[w0]) {
      var c = correct(w0) || correct(st);
      if (c) push(c, 0.6);
      var parts = split(w0);
      if (parts) parts.forEach(function (pw) { push(pw, 0.7); push(stem(pw), 0.7); });
    }
    return out;
  }
  /* 1 exact, `pre` for a prefix (the word still being typed), 0 none */
  function fieldHit(list, w, pre) {
    var best = 0;
    if (pre === undefined) pre = 0.55;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === w) return 1;
      if (pre && w.length > 2 && list[i].indexOf(w) === 0) best = pre;
    }
    return best;
  }
  /* How much a prefix counts for the query word at i. The last word may be
     half typed, so "careg" finds "caregiver". A word that is already a
     whole word on this site is probably finished: "cat" is about cats, not
     cattle, and "news" is not "newspaper". */
  function prefixWeight(q, i) {
    var known = VOCAB[q[i]] || VOCAB[stem(q[i])];
    if (i === q.length - 1) return known ? 0.1 : 0.55;
    return known ? 0 : 0.4;
  }
  /* ============================================================ PLACES
     Big towns with no unit of their own. Someone in Delhi, Chennai or
     Kolkata who searches their city should be handed the nearest units,
     not a policy from 1998 that mentions Delhi. Units carry where they are
     (g: [lat, lon], from units.html via the index builder); these are the
     towns people search from, to measure from. A town that gets a unit of
     its own is answered by that unit's row, and this list steps aside. */
  var PLACES = {
    'delhi': [28.61, 77.21], 'new delhi': [28.61, 77.21], 'noida': [28.54, 77.39], 'greater noida': [28.47, 77.50],
    'chennai': [13.08, 80.27], 'madras': [13.08, 80.27], 'kolkata': [22.57, 88.36], 'calcutta': [22.57, 88.36], 'howrah': [22.59, 88.31],
    'hyderabad': [17.39, 78.49], 'pune': [18.52, 73.86], 'poona': [18.52, 73.86], 'thane': [19.22, 72.98], 'navi mumbai': [19.03, 73.03],
    'surat': [21.17, 72.83], 'vadodara': [22.31, 73.18], 'baroda': [22.31, 73.18], 'rajkot': [22.30, 70.80], 'gandhinagar': [23.22, 72.65],
    'patna': [25.59, 85.14], 'gaya': [24.79, 85.00], 'muzaffarpur': [26.12, 85.39], 'ranchi': [23.34, 85.31], 'jamshedpur': [22.80, 86.20],
    'dhanbad': [23.80, 86.43], 'raipur': [21.25, 81.63], 'bilaspur': [22.08, 82.15],
    'chandigarh': [30.73, 76.78], 'mohali': [30.70, 76.72], 'panchkula': [30.69, 76.86], 'ludhiana': [30.90, 75.85], 'amritsar': [31.63, 74.87],
    'patiala': [30.34, 76.39], 'bathinda': [30.21, 74.95], 'ambala': [30.38, 76.78], 'panipat': [29.39, 76.97], 'sonipat': [28.99, 77.02],
    'karnal': [29.69, 76.98], 'rohtak': [28.90, 76.61], 'hisar': [29.15, 75.72],
    'srinagar': [34.08, 74.80], 'jammu': [32.73, 74.86], 'leh': [34.15, 77.58],
    'varanasi': [25.32, 82.99], 'banaras': [25.32, 82.99], 'benares': [25.32, 82.99], 'kashi': [25.32, 82.99],
    'prayagraj': [25.44, 81.85], 'allahabad': [25.44, 81.85], 'meerut': [28.98, 77.71], 'mathura': [27.49, 77.67], 'vrindavan': [27.58, 77.70],
    'aligarh': [27.88, 78.08], 'gorakhpur': [26.76, 83.37], 'ayodhya': [26.80, 82.20], 'jhansi': [25.45, 78.57], 'saharanpur': [29.96, 77.55],
    'kochi': [9.93, 76.27], 'cochin': [9.93, 76.27], 'ernakulam': [9.98, 76.28], 'kottayam': [9.59, 76.52], 'alappuzha': [9.50, 76.34],
    'kannur': [11.87, 75.37], 'palakkad': [10.79, 76.65],
    'coimbatore': [11.02, 76.96], 'salem': [11.66, 78.15], 'erode': [11.34, 77.72], 'tirunelveli': [8.71, 77.76], 'vellore': [12.92, 79.13],
    'kanchipuram': [12.83, 79.70], 'thanjavur': [10.79, 79.14], 'ooty': [11.41, 76.70], 'puducherry': [11.94, 79.81], 'pondicherry': [11.94, 79.81],
    'kanyakumari': [8.08, 77.54], 'nagercoil': [8.18, 77.41],
    'visakhapatnam': [17.69, 83.22], 'vizag': [17.69, 83.22], 'vijayawada': [16.51, 80.65], 'guntur': [16.31, 80.44], 'tirupati': [13.63, 79.42],
    'nellore': [14.44, 79.99], 'kurnool': [15.83, 78.04], 'warangal': [17.97, 79.59],
    'mangalore': [12.91, 74.86], 'mangaluru': [12.91, 74.86], 'udupi': [13.34, 74.75], 'belgaum': [15.85, 74.50], 'belagavi': [15.85, 74.50],
    'davangere': [14.46, 75.92], 'shimoga': [13.93, 75.57], 'shivamogga': [13.93, 75.57],
    'panaji': [15.49, 73.83], 'panjim': [15.49, 73.83], 'margao': [15.27, 73.96],
    'gwalior': [26.22, 78.18], 'jabalpur': [23.18, 79.95], 'ujjain': [23.18, 75.78],
    'jodhpur': [26.24, 73.02], 'bikaner': [28.02, 73.31], 'ajmer': [26.45, 74.64], 'pushkar': [26.49, 74.55], 'jaisalmer': [26.92, 70.91],
    'cuttack': [20.46, 85.88], 'puri': [19.81, 85.83], 'rourkela': [22.26, 84.85],
    'gangtok': [27.33, 88.61], 'darjeeling': [27.04, 88.26], 'imphal': [24.82, 93.94], 'agartala': [23.83, 91.29], 'aizawl': [23.73, 92.72],
    'kohima': [25.67, 94.11], 'dimapur': [25.91, 93.73], 'itanagar': [27.08, 93.61], 'dibrugarh': [27.47, 94.91], 'silchar': [24.83, 92.78],
    'port blair': [11.62, 92.73],
    'nainital': [29.38, 79.46], 'rishikesh': [30.09, 78.27], 'mussoorie': [30.46, 78.07], 'haldwani': [29.22, 79.51],
    'dharamshala': [32.22, 76.32], 'manali': [32.24, 77.19], 'solan': [30.91, 77.10],
    'solapur': [17.66, 75.91], 'sangli': [16.85, 74.58], 'satara': [17.69, 74.00], 'jalgaon': [21.00, 75.56], 'akola': [20.70, 77.00],
    'amravati': [20.93, 77.75], 'nanded': [19.15, 77.31]
  };
  var PLACE_WORDS = {};
  Object.keys(PLACES).forEach(function (k) { k.split(' ').forEach(function (w) { PLACE_WORDS[w] = 1; }); });
  /* Words that, next to a town's name, still mean "who can I reach there". */
  var PLACE_INTENT = /^(unit|units|near|nearest|nearby|contact|contacts|phone|number|call|vet|vets|doctor|hospital|hospitals|clinic|clinics|help|helpline|shelter|shelters|ngo|ngos|rescue|ambulance|office|branch|centre|center|people|animal|animals|welfare|dog|dogs|cat|cats|cow|cows|injured|sick|emergency|city|local|around|team|madad|janwar|kutta|ghayal)$/;

  function placeIn(raw) {
    for (var i = 0; i < raw.length; i++) {
      var two = raw[i] + ' ' + (raw[i + 1] || '');
      if (raw[i + 1] && PLACES[two]) return { name: two, at: [i, i + 1], g: PLACES[two] };
      if (PLACES[raw[i]]) return { name: raw[i], at: [i], g: PLACES[raw[i]] };
    }
    return null;
  }
  function km(a, b) {
    var r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function aboutKm(d) { return d < 10 ? 'Under 10 km' : 'About ' + (d < 100 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10) + ' km'; }
  function titleCase(s) { return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  /* The units nearest a town that has none, as copies of their rows that
     say how far, or null when the query is not that kind of question. */
  function nearestFor(raw) {
    var place = placeIn(raw);
    if (!place) return null;
    var own = INDEX.some(function (r) { return r.g && (' ' + r.tt.join(' ') + ' ').indexOf(' ' + place.name + ' ') > -1; });
    if (own) return null;
    var rest = raw.filter(function (w, i) { return place.at.indexOf(i) < 0 && !STOP.test(w); });
    if (!rest.every(function (w) { return PLACE_INTENT.test(w) || PLACE_INTENT.test(stem(w)); })) return null;
    var hidden = hiddenNow();
    var units = INDEX.filter(function (r) { return r.g && (!hidden || shown(r, hidden)); }).map(function (r) { return { row: r, d: km(place.g, r.g) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 3)
      .filter(function (x, i) { return i === 0 || x.d < 250; });
    if (!units.length) return null;
    var name = titleCase(place.name);
    return units.map(function (x) {
      return Object.assign({}, x.row, { d: aboutKm(x.d) + ' from ' + name + '. ' + x.row.d });
    });
  }

  /* A row's best-bet phrases against the query: every word of a phrase
     found among the query's words (as typed, stemmed, a synonym, or a
     corrected typo). The whole query being the phrase beats it being part
     of the query. */
  function phraseBonus(row, termForms, typed) {
    var best = 0;
    row.qp.forEach(function (ph, n) {
      /* one word and its little words: only as typed, or the one word alone */
      if (row.qx[n] && typed !== row.qx[n] && typed !== ph[0] && stem(typed) !== ph[0]) return;
      var used = {};
      var ok = ph.every(function (pw) {
        for (var i = 0; i < termForms.length; i++) {
          if (used[i]) continue;
          if (termForms[i].some(function (f) { return f.w === pw; })) { used[i] = 1; return true; }
        }
        return false;
      });
      if (!ok) return;
      var whole = Object.keys(used).length === termForms.length;
      /* one word is a best bet only when it is the whole query: "complaint"
         means the report form, "dog barking complaint" does not */
      if (!whole && ph.length < 2) return;
      var b = whole ? 120 : 14 + 5 * ph.length;
      if (b > best) best = b;
    });
    return best;
  }

  /* ========================================================== VISIBILITY
     Pages and sections hidden in the panel's Website section are never
     offered here either (owner, 8 Oct 2026). assets/site-visibility.js, at
     the top of every page, knows what is hidden: a row is left out when its
     address is a hidden page, a hidden section, or anything inside one. Which
     ids sit inside which section is the `anchors` of assets/site-modules.json
     (laws.html#a5 is inside #part-a), fetched only once a section is actually
     hidden; until it arrives, a row naming the section itself is still left
     out. */
  var ANCHORS = null, anchorsAsked = false, pageReady = false;
  function hiddenNow() {
    var V = window.PFA_VISIBILITY;
    var s = V && V.state ? V.state() : null;
    return s && (s.pages.length || s.modules.length) ? s : null;
  }
  function shown(row, hidden) {
    var s = hidden === undefined ? hiddenNow() : hidden;
    return !s || !window.PFA_VISIBILITY.blocked(row.u, s, ANCHORS);
  }
  function loadAnchors(after) {
    var s = hiddenNow();
    if (anchorsAsked || !s || !s.modules.length || typeof fetch !== 'function') { if (after) after(); return; }
    anchorsAsked = true;
    fetch('assets/site-modules.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (reg) { if (reg && reg.anchors) ANCHORS = reg.anchors; })
      .catch(function () { /* the sections themselves are still left out */ })
      .then(function () { if (after) after(); });
  }

  /* Returns {rows, corrected} - corrected is the query with typos fixed, or null. */
  function search(query, opts) {
    opts = opts || {};
    var hidden = hiddenNow();
    var raw = tokens(query), q = joinSplit(raw.filter(function (w) { return !STOP.test(w); }));
    if (!q.length) q = raw;
    if (!q.length) return { rows: [], corrected: null };
    var full = String(query).toLowerCase().trim();
    var termForms = q.map(forms), corrected = null;
    var pre = q.map(function (w, i) { return prefixWeight(q, i); });
    /* The whole query found in a title counts at word edges only, and at
       the end only when the last word may still be half typed: "cat" is
       not the start of "Cattle, buffalo...". */
    var lastWord = raw[raw.length - 1], openEnd = !(VOCAB[lastWord] || VOCAB[stem(lastWord)] || STOP.test(lastWord));
    var fullRe = new RegExp('(^|[^a-z0-9])' + full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (openEnd ? '' : '(?![a-z0-9])'));

    var scored = [];
    INDEX.forEach(function (row) {
      if (opts.section && row.s !== opts.section) return;
      if (hidden && !shown(row, hidden)) return;
      var score = 0, matched = 0;
      termForms.forEach(function (fs, ti) {
        var best = 0, p = pre[ti];
        fs.forEach(function (f) {
          var s = (fieldHit(row.tt, f.w, p) * 8 + fieldHit(row.kt, f.w, p) * 4 + fieldHit(row.dt, f.w, p) * 1.5 +
                   (row.at.length ? fieldHit(row.at, f.w, 0) * 0.6 : 0) +
                   (row.bt.length ? fieldHit(row.bt, f.w, 0) * 0.9 : 0) +
                   (row.ct.length ? fieldHit(row.ct, f.w, 0) * 4 : 0)) * f.c * idf(f.w);
          if (s > best) best = s;
        });
        if (best) matched++;
        score += best;
      });
      var bet = row.qp && row.qp.length ? phraseBonus(row, termForms, raw.join(' ')) : 0;
      if (!matched && !bet) return;
      if (!bet && q.length > 2 && matched < Math.ceil(q.length / 2)) return;
      score *= Math.pow(matched / q.length, 2) * 1.5 + 0.25;              /* coverage */
      var tl = row.t.toLowerCase();
      var at = tl === full ? 0 : tl.search(fullRe);
      if (tl === full) score += 30; else if (at === 0) score += 14; else if (at > 0) score += 7;
      else if (fullRe.test((row.d || '').toLowerCase())) score += 3;   /* phrase */
      score += bet;   /* best bet */
      score *= TYPE_BOOST[row.y] || 1;
      scored.push({ row: row, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.row.t.localeCompare(b.row.t); });
    /* When the top answer is strong, what scores under a tenth of it is a
       stray word match ("make a gift" was followed by "Helped consumers
       make informed choices"), not a result. */
    if (scored.length && scored[0].score >= 30) {
      var floor = scored[0].score * 0.1;
      scored = scored.filter(function (x) { return x.score >= floor; });
    }

    /* Did you mean: rebuild the query with corrections where a word was unknown. */
    var fixed = raw.map(function (w) {
      if (VOCAB[w] || VOCAB[stem(w)] || STOP.test(w) || SYNONYMS[w] || SYNONYMS[stem(w)] || PLACE_WORDS[w]) return w;
      var parts = split(w); if (parts) return parts.join(' ');
      var c = correct(w);
      return c ? surface(c, w) : w;
    });
    if (fixed.join(' ') !== raw.join(' ')) corrected = fixed.join(' ');

    var rows = scored.map(function (x) { return x.row; });
    /* "units in delhi", "chennai", "vet near kolkata": the nearest units
       first, each saying how far, then everything else. */
    var near = (!opts.section || opts.section === 'Places') ? nearestFor(raw) : null;
    if (near) {
      var front = {}; near.forEach(function (r) { front[r.id] = 1; });
      rows = near.concat(rows.filter(function (r) { return !front[r.id]; }));
      if (corrected && raw.every(function (w) { return VOCAB[w] || VOCAB[stem(w)] || STOP.test(w) || SYNONYMS[w] || PLACE_WORDS[w] || PLACE_INTENT.test(w); })) corrected = null;
    }
    rows = rows.slice(0, opts.limit || 100);
    var via = null;
    if (!rows.length && !opts.noFallback) {
      var alt = corrected ? search(corrected, { limit: opts.limit, section: opts.section, noFallback: true }).rows : [];
      if (alt.length) { rows = alt; via = 'corrected'; }
      else { rows = closest(query, Math.min(opts.limit || 6, 6)).filter(function (r) { return !opts.section || r.s === opts.section; }); if (rows.length) via = 'closest'; }
    }
    var out = { rows: rows, corrected: corrected, via: via };
    if (opts.explain) out.scores = scored.slice(0, 12).map(function (x) { return [Math.round(x.score * 10) / 10, x.row.t]; });
    return out;
  }

  /* Query completions: titles and popular phrases that continue what was typed. */
  function complete(query, limit) {
    var qn = String(query).toLowerCase().trim(); if (!qn) return [];
    var hidden = hiddenNow();
    var phrases = INDEX.filter(function (r) { return !hidden || shown(r, hidden); }).map(function (r) { return r.t; }).concat(
      ['report cruelty', 'report a dog being beaten', 'unit near me', 'injured dog', 'dog bite', 'colony caregiver card',
       'street dog rights', 'feeding street dogs', 'how to file an FIR', 'make a gift', 'gift certificate', 'donate monthly',
       '80G receipt', 'adoption drives', 'volunteer near me', 'first aid']);
    var out = [], seen = {};
    phrases.forEach(function (p) {
      var pl = p.toLowerCase();
      if (pl !== qn && (pl.indexOf(qn) === 0 || pl.split(' ').some(function (w) { return w.indexOf(qn) === 0 && qn.length > 2; })) && !seen[pl]) { seen[pl] = 1; out.push(p); }
    });
    return out.slice(0, limit || 5);
  }

  /* Recent searches (this browser only). */
  var RECENT_KEY = 'pfa-recent-searches';
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function remember(q) {
    q = q.trim(); if (!q) return;
    try { var r = recent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); r.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6))); } catch (e) {}
  }
  function forget() { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} }

  function emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

  /* ================================================================ HTML */
  function mark(text, query) {
    var words = tokens(query).filter(function (w) { return w.length > 1 && !STOP.test(w); });
    words = words.concat(words.map(stem)).filter(function (w, i, a) { return a.indexOf(w) === i; });
    if (!words.length) return esc(text);
    var re = new RegExp('\\b(' + words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'ig');
    return esc(text).replace(re, '<mark>$1</mark>');
  }
  function byTitle(t) { return INDEX.filter(function (r) { return r.t === t; })[0]; }

  /* ======================================================== MOST ASKED
     What visitors actually open, not a hand-written guess.

     Clicks are posted to /api/search-popular as a bare destination path; the
     query text never leaves the browser. The endpoint returns paths and
     counts only, and every path is resolved back to a row of THIS index
     before it is shown, so a path the site does not have is dropped rather
     than rendered. CURATED_FALLBACK covers the cold start, an offline visitor
     and any deployment without the API.                                     */
  var POPULAR_ENDPOINT = '/api/search-popular';
  var POPULAR_SHOWN = 6;        // how many rows the visitor sees
  var POPULAR_MIN_HITS = 8;     // below this the sample is too thin to be "most asked"
  var POPULAR_CACHE_KEY = 'pfa:popular:v1';
  var POPULAR_TTL = 6 * 60 * 60 * 1000;
  var liveHits = null;          // [{u, c}] once loaded

  function popularNormalise(u) {
    return String(u || '').trim().toLowerCase();
  }
  /* Index lookup by url, built lazily and only once. */
  var urlMap = null;
  function byUrl(u) {
    if (!urlMap) {
      urlMap = {};
      INDEX.forEach(function (r) {
        var key = popularNormalise(r.u);
        if (key && !urlMap[key]) urlMap[key] = r;
      });
    }
    return urlMap[popularNormalise(u)];
  }

  function readPopularCache() {
    try {
      var raw = sessionStorage.getItem(POPULAR_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      if (Date.now() - (parsed.at || 0) > POPULAR_TTL) return null;
      return parsed.items;
    } catch (_) { return null; }
  }
  function writePopularCache(items) {
    try { sessionStorage.setItem(POPULAR_CACHE_KEY, JSON.stringify({ at: Date.now(), items: items })); } catch (_) {}
  }

  /* Resolve counts to index rows. Unknown paths are dropped, which is what
     keeps anything written to the counter off the page. */
  function popularRows(limit) {
    var want = limit || POPULAR_SHOWN;
    var rows = [], seen = {};
    var total = (liveHits || []).reduce(function (sum, h) { return sum + (h.c || 0); }, 0);
    if (liveHits && total >= POPULAR_MIN_HITS) {
      liveHits.forEach(function (hit) {
        if (rows.length >= want) return;
        var row = byUrl(hit.u);
        if (!row || seen[row.t] || !shown(row)) return;
        seen[row.t] = 1;
        rows.push(row);
      });
    }
    /* Top up from the curated list so the panel is never half empty while the
       real counts are still building. */
    CURATED_FALLBACK.forEach(function (t) {
      if (rows.length >= want) return;
      var row = byTitle(t);
      if (!row || seen[row.t] || !shown(row)) return;
      seen[row.t] = 1;
      rows.push(row);
    });
    return rows;
  }

  function loadPopular(after) {
    var cached = readPopularCache();
    if (cached) { liveHits = cached; if (after) after(); return; }
    if (typeof fetch !== 'function') { if (after) after(); return; }
    fetch(POPULAR_ENDPOINT, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        liveHits = data.items.filter(function (row) { return row && row.u && row.c > 0; });
        writePopularCache(liveHits);
        if (after) after();
      })
      .catch(function () { /* offline or not deployed: the curated list stands */ });
  }

  /* Fire and forget. keepalive lets the request outlive the navigation the
     visitor just started, so counting never delays the page they asked for. */
  function recordOpen(url) {
    var u = popularNormalise(url);
    if (!u || !byUrl(u)) return;              // only paths this index knows
    /* Rows like `events.html?q=Bengaluru` are real, but the query is free text
       and must not be stored. Count the page instead: the interest in events
       is recorded, the city the visitor typed is not. */
    u = u.split('?')[0];
    if (!u || !byUrl(u)) return;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(POPULAR_ENDPOINT, new Blob([JSON.stringify({ u: u })], { type: 'application/json' }));
        return;
      }
      fetch(POPULAR_ENDPOINT, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: u })
      }).catch(function () {});
    } catch (_) {}
  }

  function rowHtml(row, query, i) {
    return '<li role="option" id="pfa-opt-' + i + '" aria-selected="false" data-id="' + row.id + '">' +
      '<a href="' + esc(row.u) + '" tabindex="-1">' +
        '<span class="pfa-s-title">' + mark(row.t, query) + '</span>' +
        '<span class="pfa-s-desc">' + mark(row.d || '', query) + '</span>' +
      '</a></li>';
  }

  /* ============================================================= OVERLAY */
  var overlay, input, list, chips, label, active = -1, opener = null;
  function buildOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'pfa-search';
    overlay.setAttribute('data-cursor', 'dark');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search People for Animals');
    overlay.hidden = true;
    overlay.innerHTML =
      '<button type="button" class="pfa-search__close pfa-close" data-search-close aria-label="Close search">Close</button>' +
      '<form class="pfa-search__form" action="search.html" method="get" role="search">' +
        '<label for="pfa-q" class="pfa-search__ask">What would you like to do today?</label>' +
        '<div class="pfa-search__field">' +
          '<input id="pfa-q" name="q" type="search" autocomplete="off" spellcheck="false" ' +
            'placeholder="Report cruelty, a unit near you, laws, a gift…" ' +
            'role="combobox" aria-expanded="false" aria-controls="pfa-results" aria-autocomplete="list">' +
          /* drawn, not typed: a font's arrow sits on its baseline, below the
             middle of its square (23 Oct 2026) */
          '<button type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
        '</div>' +
        '<ul class="pfa-search__chips" data-chips aria-label="Suggestions"></ul>' +
        '<p class="pfa-search__hint" aria-hidden="true">Enter opens the top result · ↑ ↓ to move · Tab completes · Esc closes</p>' +
      '</form>' +
      '<nav class="pfa-search__quick" aria-label="Quick actions"><p class="pfa-search__label">Or go straight to</p><ul>' +
        QUICK.map(function (t) { var r = byTitle(t); return r && shown(r) ? '<li><a href="' + esc(r.u) + '" data-id="' + r.id + '">' + esc(r.t) + '</a></li>' : ''; }).join('') +
      '</ul></nav>' +
      '<div class="pfa-search__body">' +
        '<p class="pfa-search__label" id="pfa-results-label"></p>' +
        '<ul id="pfa-results" class="pfa-search__list" role="listbox" aria-labelledby="pfa-results-label"></ul>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('#pfa-q');
    list = overlay.querySelector('#pfa-results');
    chips = overlay.querySelector('[data-chips]');
    label = overlay.querySelector('#pfa-results-label');

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', onKey);
    overlay.querySelector('form').addEventListener('submit', function (e) {
      var q = input.value.trim();
      if (!q) { e.preventDefault(); return; }
      remember(q);
      var pick = active > -1 ? list.children[active] : (list.children[0] && list.dataset.mode === 'results' ? list.children[0] : null);
      if (pick) { e.preventDefault(); go(pick, q); return; }
      if (pushed) { e.preventDefault(); to('search.html?q=' + encodeURIComponent(q)); }
    });
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-search-close]')) { close(); return; }
      var chip = e.target.closest('[data-fill]');
      if (chip) { e.preventDefault(); input.value = chip.getAttribute('data-fill'); render(input.value); input.focus(); return; }
      if (e.target.closest('[data-forget]')) { e.preventDefault(); forget(); render(''); return; }
      var quick = e.target.closest('.pfa-search__quick a');
      if (quick) { emit('pfa:search-click', { query: input.value, title: quick.textContent, url: quick.getAttribute('href'), surface: 'quick' }); recordOpen(quick.getAttribute('href')); leave(e, quick); return; }
      var li = e.target.closest('#pfa-results li');
      if (li) { e.preventDefault(); remember(input.value); go(li, input.value); return; }
      var a = e.target.closest('a[href]');
      if (a) leave(e, a);
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('li'); if (!li) return;
      setActive(Array.prototype.indexOf.call(list.children, li));
    });
    return overlay;
  }
  function go(li, q) {
    var row = INDEX[+li.getAttribute('data-id')];
    emit('pfa:search-click', { query: q, title: row.t, url: row.u, position: Array.prototype.indexOf.call(list.children, li) + 1 });
    recordOpen(row.u);
    to(row.u);
  }
  /* Back closes the search, as a phone's Back closes a screen in an app
     (22 Oct 2026): opening it adds a step to the history, Back takes it
     away, and leaving for a result replaces that step, so Back from the
     result comes to this page, not to this page with search open. */
  var pushed = false;
  function to(url) {
    if (pushed && history.state && history.state.pfaSearch) { pushed = false; location.replace(url); }
    else location.href = url;
  }
  function leave(e, a) {
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    to(a.href);
  }
  window.addEventListener('popstate', function () { if (overlay && !overlay.hidden) close(true); });
  function render(q) {
    q = q.trim();
    var rows, mode = 'results';
    chips.innerHTML = '';
    /* on a phone the quick links give way to the results once typing starts */
    overlay.classList.toggle('has-query', !!q);
    if (!q) {
      var rec = recent();
      rows = popularRows(POPULAR_SHOWN);
      label.innerHTML = 'Most asked';
      if (rec.length) {
        chips.innerHTML = '<li class="pfa-search__chiplabel">Recent</li>' + rec.map(function (r) {
          return '<li><a href="search.html?q=' + encodeURIComponent(r) + '" data-fill="' + esc(r) + '">' + esc(r) + '</a></li>';
        }).join('') + '<li><button type="button" data-forget>Clear</button></li>';
      }
      mode = 'popular';
    } else {
      var res = search(q, { limit: 8 });
      rows = res.rows;
      var comps = complete(q, 5);
      if (comps.length) chips.innerHTML = comps.map(function (c) {
        return '<li><a href="search.html?q=' + encodeURIComponent(c) + '" data-fill="' + esc(c) + '">' + mark(c, q) + '</a></li>';
      }).join('');
      var seeAll = ' <a href="search.html?q=' + encodeURIComponent(q) + '">See all results →</a>';
      if (res.via === 'corrected') {
        label.innerHTML = 'Showing results for <a href="#" data-fill="' + esc(res.corrected) + '">' + esc(res.corrected) + '</a>. No pages match “' + esc(q) + '”.';
      } else if (res.via === 'closest') {
        label.innerHTML = 'No exact match for “' + esc(q) + '”. The closest:';
        /* a guess is shown, not opened: Enter goes to the results page */
        mode = 'closest';
      } else if (rows.length) {
        label.innerHTML = esc(rows.length === 1 ? 'One result' : 'Top ' + rows.length) + seeAll;
        if (res.corrected) label.innerHTML += ' <span class="pfa-search__dym">Did you mean <a href="#" data-fill="' + esc(res.corrected) + '">' + esc(res.corrected) + '</a>?</span>';
      }
      if (!rows.length) {
        label.innerHTML = 'Nothing matched “' + esc(q) + '”. Check the spelling or start from one of these.';
        rows = popularRows(4); mode = 'popular';
      }
      emit('pfa:search', { query: q, results: res.rows.length, corrected: res.corrected, surface: 'overlay' });
    }
    list.dataset.mode = mode;
    list.innerHTML = rows.map(function (r, i) { return rowHtml(r, mode === 'results' ? q : '', i); }).join('');
    input.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
    setActive(-1);
  }
  function setActive(i) {
    var items = list.children;
    if (active > -1 && items[active]) items[active].setAttribute('aria-selected', 'false');
    active = i;
    if (i > -1 && items[i]) {
      items[i].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', items[i].id);
      items[i].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function onKey(e) {
    var n = list.children.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(n ? (active + 1) % n : -1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(n ? (active - 1 + n) % n : -1); }
    else if (e.key === 'Tab' && !e.shiftKey) {
      var first = chips.querySelector('[data-fill]');
      if (first && input.value.trim()) { e.preventDefault(); input.value = first.getAttribute('data-fill'); render(input.value); }
    }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function open(from) {
    buildOverlay();
    opener = from || document.activeElement;
    var top = 0;
    Array.prototype.forEach.call(document.querySelectorAll('header, .announce, .pfa-ann'), function (el) {
      if (el.closest('.pfa-search')) return;
      var cs = getComputedStyle(el); if (cs.display === 'none' || cs.position !== 'fixed') return;
      top = Math.max(top, el.getBoundingClientRect().bottom);
    });
    overlay.style.top = Math.max(0, Math.round(top)) + 'px';
    var was = !overlay.hidden;
    overlay.hidden = false;
    document.documentElement.classList.add('pfa-search-open');
    render(input.value);
    if (!liveHits) loadPopular(function () { if (overlay && !overlay.hidden && !input.value.trim()) render(''); });
    /* Focused now, inside the tap that opened it: an iPhone raises the
       keyboard only for a field focused in the tap itself, and a focus one
       frame later left the box with no keyboard, to be tapped again. */
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    input.select();
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    if (!was && !(history.state && history.state.pfaSearch) && history.pushState) {
      try { history.pushState({ pfaSearch: 1 }, ''); pushed = true; } catch (_) { pushed = false; }
    }
  }
  function close(fromHistory) {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    document.documentElement.classList.remove('pfa-search-open');
    if (pushed) {
      pushed = false;
      if (fromHistory !== true && history.state && history.state.pfaSearch) history.back();
    }
    if (opener && opener.focus) opener.focus();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open-search]');
    if (!t) return;
    e.preventDefault(); open(t);
  });
  document.addEventListener('keydown', function (e) {
    var el = document.activeElement, tag = el && el.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); return; }
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('input#q:not([data-search-input])')) { e.preventDefault(); open(); return; }
    if (e.key === 'Escape') close();
  });

  /* ======================================================== RESULTS PAGE */
  function renderPage(root) {
    var params = new URLSearchParams(location.search);
    var q = (params.get('q') || '').trim(), section = params.get('in') || '';
    var field = root.querySelector('[data-search-input]');
    var heading = root.querySelector('[data-search-heading]');
    var count = root.querySelector('[data-search-count]');
    var facets = root.querySelector('[data-search-facets]');
    var out = root.querySelector('[data-search-results]');
    var note = root.querySelector('[data-search-note]');
    if (field && field.value !== q) field.value = q;
    document.title = (q ? '“' + q + '” · ' : '') + 'Search · People for Animals';
    note.innerHTML = ''; facets.innerHTML = '';

    if (!q) {
      heading.textContent = 'What would you like to do today?';
      heading.classList.add('is-prompt');
      count.textContent = 'Most asked';
      /* A short ranked list, not the whole index grouped into every section. */
      out.innerHTML = popularListHtml(popularRows(POPULAR_SHOWN));
      if (!liveHits) loadPopular(function () { out.innerHTML = popularListHtml(popularRows(POPULAR_SHOWN)); });
      return;
    }
    var all = search(q), shown = q, res = all;
    if (all.via === 'corrected') {
      shown = all.corrected;
      note.innerHTML = 'Showing results for <strong>' + esc(all.corrected) + '</strong>. No pages match “' + esc(q) + '”.';
    } else if (all.via === 'closest') {
      note.innerHTML = 'No page matches “' + esc(q) + '” exactly. These are the closest.';
    } else if (all.corrected) {
      note.innerHTML = 'Did you mean <a href="search.html?q=' + encodeURIComponent(all.corrected) + '">' + esc(all.corrected) + '</a>?';
    }
    heading.textContent = q;
    heading.classList.remove('is-prompt');
    emit('pfa:search', { query: q, results: res.rows.length, corrected: all.corrected, section: section, surface: 'page' });

    if (!res.rows.length) {
      count.textContent = 'Nothing matched';
      out.innerHTML =
        '<div class="pfa-sr-empty">' +
          '<p>No page on this site matches “' + esc(q) + '”. Check the spelling, try a shorter word, or start from one of these.</p>' +
          '<ul class="pfa-sr-chips">' + popularRows(POPULAR_SHOWN).map(function (r) { return '<li><a href="' + esc(r.u) + '">' + esc(r.t) + '</a></li>'; }).join('') + '</ul>' +
          (shown({ u: 'laws.html#a33' }) ? '<p class="pfa-sr-fallback">If it is urgent, <a href="laws.html#a33">see who to report to</a>.</p>' : '') +
        '</div>';
      return;
    }
    /* facets with counts */
    var counts = {}; res.rows.forEach(function (r) { counts[r.s] = (counts[r.s] || 0) + 1; });
    var base = 'search.html?q=' + encodeURIComponent(q);
    facets.innerHTML = '<li><a href="' + base + '"' + (!section ? ' aria-current="true"' : '') + '>All <span>' + res.rows.length + '</span></a></li>' +
      SECTIONS.concat(Object.keys(counts).filter(function (s) { return SECTIONS.indexOf(s) < 0; })).filter(function (s) { return counts[s]; }).map(function (s) {
        return '<li><a href="' + base + '&in=' + encodeURIComponent(s) + '"' + (section === s ? ' aria-current="true"' : '') + '>' + esc(s) + ' <span>' + counts[s] + '</span></a></li>';
      }).join('');
    var rows = section ? res.rows.filter(function (r) { return r.s === section; }) : res.rows;
    count.textContent = (rows.length === 1 ? 'One result' : rows.length + ' results') + (section ? ' in ' + section : '') + ' for';
    out.innerHTML = groupHtml(rows, shown);
  }
  /* Idle state on search.html: one short ranked list. The grouped layout is
     for actual results, where the section headings earn their space. */
  function popularListHtml(rows) {
    if (!rows.length) return '';
    return '<ol class="pfa-sr-popular">' + rows.map(function (r) {
      return '<li><a href="' + esc(r.u) + '" data-id="' + r.id + '">' +
        '<span class="pfa-sr-title">' + esc(r.t) + '</span>' +
        (r.d ? '<span class="pfa-sr-desc">' + esc(r.d) + '</span>' : '') +
      '</a></li>';
    }).join('') + '</ol>';
  }
  function groupHtml(rows, q) {
    var groups = {};
    /* The group holding the best answer comes first, then the group of the
       next best, and so on: "pfa work" opens on PFA's work, not on the jobs
       page because "Do something" is listed first. */
    var order = [];
    rows.forEach(function (r) {
      if (!groups[r.s]) { groups[r.s] = []; order.push(r.s); }
      groups[r.s].push(r);
    });
    return order.map(function (s) {
      var gid = 'g-' + s.replace(/\W/g, '');
      return '<section class="pfa-sr-group" aria-labelledby="' + gid + '">' +
        '<h2 id="' + gid + '">' + esc(s) + '</h2>' +
        '<ol>' + groups[s].map(function (r) {
          return '<li><a href="' + esc(r.u) + '" data-id="' + r.id + '">' +
            '<span class="pfa-sr-title">' + mark(r.t, q) + '</span>' +
            '<span class="pfa-sr-url">' + esc(r.p ? r.p : r.u.replace(/\.html/, '').replace(/#/, ' › ')) + '</span>' +
            '<span class="pfa-sr-desc">' + mark(r.d || '', q) + '</span>' +
          '</a></li>';
        }).join('') + '</ol></section>';
    }).join('');
  }
  function initPage(root) {
    renderPage(root);
    var field = root.querySelector('[data-search-input]');
    if (field) {
      var t;
      field.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          var q = field.value.trim();
          history.replaceState(null, '', q ? 'search.html?q=' + encodeURIComponent(q) : 'search.html');
          renderPage(root);
        }, 120);
      });
      root.querySelector('form').addEventListener('submit', function () { remember(field.value); });
    }
    root.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-id]'); if (!a) return;
      var row = INDEX[+a.getAttribute('data-id')];
      emit('pfa:search-click', { query: field ? field.value : '', title: row.t, url: row.u, surface: 'page' });
    });
    window.addEventListener('popstate', function () { renderPage(root); });
  }

  /* =============================================================== BOOT */
  build(CURATED);

  /* Merge the crawled index if the site ships one (see build-index.js). It is
     optional and may fail; curated rows win on duplicate URLs, so hand-written
     copy is never overwritten. */
  /* The panel and the API are never search results. search-index.json is built
     by a crawler that is not in this repo, and it had walked into admin.html:
     four rows, one of them quoting the signed-in panel's own headings back at
     a stranger. Cleaning the file fixed today; this line is what stops the next
     crawl putting them back. Mirrors PRIVATE in scripts/build-search-index.js.
     Applied to everything merged in, so nothing can bypass it. */
  var PRIVATE = /^\/?(admin\b|api\/)/i;
  function isPrivate(u) { return PRIVATE.test(String(u == null ? '' : u).trim()); }

  function mergeCrawl(done) {
    function take(result) {
      /* The builder ships { pages, rows }: pages for tests and the sitemap,
         rows in this file's own shape - every public page, every anchored
         heading, every unit - so the engine searches the site, not just the
         curated shortlist. A bare array is still accepted for old files. */
      var extra = result && Array.isArray(result.rows) ? result.rows
        : (Array.isArray(result) ? result : []);
      /* Curated rows win on the same address, and on the same title on the
         same page: the crawl's "Volunteer" at get-involved.html#top is the
         curated "Volunteer" twice. */
      var have = {}, named = {}, merged = false;
      var page = function (u) { return String(u).split(/[?#]/)[0]; };
      CURATED.forEach(function (r) { have[r.u] = r; named[page(r.u) + '|' + r.t.toLowerCase()] = 1; });
      /* the curated row keeps its words; what the page itself says comes
         along as its body, so it is found by that too */
      extra.forEach(function (r) {
        var mine = r && r.u && have[r.u];
        if (mine && mine !== 1 && !isPrivate(r.u)) {
          /* the heading the page gives it is as good as a keyword: "Not a
             flock. Individuals." finds the curated row at someone.html#adopt */
          if (r.t && String(r.t).toLowerCase() !== mine.t.toLowerCase()) mine.k = [mine.k, r.t].filter(Boolean).join(' ');
          mine.b = [mine.b, r.d, r.b, r.k].filter(Boolean).join(' ');
          merged = true;
        }
      });
      var add = extra.filter(function (r) {
        return r && r.t && r.u && !have[r.u] && !named[page(r.u) + '|' + String(r.t).toLowerCase()] && !isPrivate(r.u);
      });
      add.forEach(function (r) { if (BEST_BETS[r.u] && !r.q) r.q = BEST_BETS[r.u]; });
      if (add.length || merged) build(CURATED.concat(add));
      done();
    }
    /* A page opened from the disk (file://) cannot fetch; the builder writes
       search-index.js for exactly that, and a script tag can load it. */
    function fromScript() {
      if (window.__PFA_SEARCH_INDEX) { take(window.__PFA_SEARCH_INDEX); return; }
      if (!(location && location.protocol === 'file:') || !document.createElement) { done(); return; }
      var tag = document.createElement('script');
      tag.src = 'search-index.js';
      tag.onload = function () { take(window.__PFA_SEARCH_INDEX); };
      tag.onerror = function () { done(); };
      (document.head || document.body).appendChild(tag);
    }
    if (window.__PFA_SEARCH_INDEX || !window.fetch) { fromScript(); return; }
    fetch('search-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (result) { if (result) take(result); else fromScript(); })
      .catch(done);
  }
  /* Hand a ?q= from the site search to a page that has its own filter box
     (laws, events), so a result can land on the page already narrowed. */
  function handoff() {
    var box = document.querySelector('input#q:not([data-search-input]), input#uq'); if (!box) return;
    var q = new URLSearchParams(location.search).get('q'); if (!q) return;
    box.value = q; box.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () { box.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 150);
  }
  function ready() {
    handoff();
    var waiting = 2;
    function go() {
      waiting -= 1;
      if (waiting) return;
      var root = document.querySelector('[data-search-page]');
      if (root) initPage(root);
      pageReady = true;
      if (overlay && !overlay.hidden) render(input.value);
    }
    mergeCrawl(go);
    loadAnchors(go);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

  /* The panel changed what is hidden while this page was open
     (assets/chrome.js says so): answer again with the new state. */
  window.addEventListener('pfa:visibility', function () {
    loadAnchors(function () {
      var root = document.querySelector('[data-search-page]');
      if (root && pageReady) renderPage(root);
      if (overlay && !overlay.hidden) render(input.value);
    });
  });

  window.PFASearch = { search: search, complete: complete, open: open, close: close, index: function () { return INDEX; } };
})();
