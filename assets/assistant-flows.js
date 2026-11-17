/* People for Animals - the assistant's conversations.
   ------------------------------------------------------------------------
   Owner, 15 Nov 2026: "build an assistant. enterprise grade- it should allow
   to do anything and everything on the site, lodge cases, apply for
   volunteer. anything and every offering. including donate ... understand
   query in hindi, english etc..summarise, confirm, get receipt etc if one
   provides the valid credentials ... should not depend on any API".

   Every offering is a short list of questions (FLOWS), each asked once, in
   English or Hindi (T), with what was already said taken from the first
   message (a mobile, a PIN, the animal, the amount). Before anything is
   sent, the answers are summarised and confirmed; any one can be changed.
   Then the same server the forms use takes it, with the same checks: a
   form is filed through /api/pfa-submissions; a donation or membership
   opens CCAvenue's own page exactly as the site's buttons do (card details
   are never typed here); a status, a receipt and the nearest unit are
   looked up only with the details that prove whose they are.

   This file is the logic only, with no page in it: session.hear(text)
   answers with what to say and, when something must be fetched or sent,
   an action the page carries out (assets/assistant.js) and reports back
   through session.done(). The tests drive it the same way.
   ------------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./assistant-nlu.js'));
  else root.PFA_ASSIST_FLOWS = factory(root.PFA_ASSIST_NLU);
}(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  /* ---- words ------------------------------------------------------------ */

  var T = {
    hello: { en: 'Hello. I can do anything on the PFA site with you: report cruelty, find help near you, donate, volunteer, become a member, follow an application, get a receipt and more. What would you like to do? You can type in English or Hindi.', hi: 'नमस्ते। मैं PFA की वेबसाइट का हर काम आपके साथ कर सकता हूँ: क्रूरता की रिपोर्ट, पास में मदद, दान, स्वयंसेवा, सदस्यता, आवेदन की स्थिति, रसीद और बहुत कुछ। आप क्या करना चाहेंगे? आप हिंदी या अंग्रेज़ी में लिख सकते हैं।' },
    menuAgain: { en: 'What else can I do for you?', hi: 'मैं आपके लिए और क्या कर सकता हूँ?' },
    menuChip: { en: 'Something else', hi: 'कुछ और' },
    mailSent: { en: 'A confirmation has been emailed to {to}. Not in your inbox? Look in spam.', hi: 'पुष्टि {to} पर ईमेल कर दी गई है। इनबॉक्स में न दिखे तो स्पैम देखें।' },
    mailQueued: { en: 'The confirmation email to {to} is on its way; it can take a few minutes.', hi: '{to} पर पुष्टि का ईमेल भेजा जा रहा है; इसमें कुछ मिनट लग सकते हैं।' },
    mailUnsent: { en: 'No email could be sent to {to} just now, so keep the number above.', hi: 'अभी {to} पर ईमेल नहीं जा सका, इसलिए ऊपर का नंबर संभाल कर रखें।' },
    more: { en: 'More', hi: 'और' },
    moreSay: { en: 'Here is everything else:', hi: 'बाकी सब यहाँ है:' },
    notSure: { en: 'I did not quite follow. Choose one of these, or say it another way.', hi: 'मैं ठीक से समझ नहीं पाया। इनमें से चुनें, या दूसरे शब्दों में लिखें।' },
    found: { en: 'This is what I found on the PFA site:', hi: 'PFA की वेबसाइट पर यह मिला:' },
    nothingFound: { en: 'I could not find that on the site.', hi: 'वेबसाइट पर यह नहीं मिला।' },
    askDesk: { en: 'Ask PFA\'s help desk', hi: 'PFA हेल्प डेस्क से पूछें' },
    /* a person at PFA, live, only while someone in the panel is available
       (owner, 16 Nov 2026); otherwise the help desk, by email */
    liveChip: { en: 'Chat with someone at PFA', hi: 'PFA में किसी से चैट करें' },
    liveConnecting: { en: 'Connecting you to someone at PFA. They will reply here, so keep this window open.', hi: 'आपको PFA में किसी से जोड़ रहे हैं। वे यहीं जवाब देंगे, इसलिए यह विंडो खुली रखें।' },
    liveNoOne: { en: 'No one from PFA is on the chat right now. Send your question to the help desk and PFA will reply by email.', hi: 'अभी PFA से कोई चैट पर नहीं है। अपना सवाल हेल्प डेस्क को भेजें, PFA ईमेल से जवाब देगा।' },
    liveSendQuery: { en: 'Send a question', hi: 'सवाल भेजें' },
    liveJoined: { en: '{name} from PFA has joined.', hi: 'PFA से {name} जुड़ गए हैं।' },
    liveSlow: { en: 'No one has picked this up yet. You can keep waiting, or send your question to the help desk and PFA will reply by email.', hi: 'अभी तक किसी ने जवाब नहीं दिया है। आप इंतज़ार कर सकते हैं, या अपना सवाल हेल्प डेस्क को भेजें, PFA ईमेल से जवाब देगा।' },
    liveKeepWaiting: { en: 'Keep waiting', hi: 'इंतज़ार करें' },
    endChat: { en: 'End chat', hi: 'चैट समाप्त करें' },
    liveStillWaiting: { en: 'Still waiting for someone at PFA.', hi: 'PFA में किसी का इंतज़ार कर रहे हैं।' },
    liveGone: { en: '{name} has gone offline. Your messages are kept, and {name} will answer here when back. Or send your question to the help desk and PFA will reply by email.', hi: '{name} अभी ऑफ़लाइन हैं। आपके संदेश सुरक्षित हैं, और लौटने पर {name} यहीं जवाब देंगे। या अपना सवाल हेल्प डेस्क को भेजें, PFA ईमेल से जवाब देगा।' },
    liveBack: { en: '{name} is back online.', hi: '{name} फिर से ऑनलाइन हैं।' },
    liveTookOver: { en: '{name} from PFA is answering now.', hi: 'अब PFA से {name} जवाब दे रहे हैं।' },
    liveEnded: { en: '{name} has ended the chat. Thank you for writing to PFA.', hi: '{name} ने चैट समाप्त कर दी। PFA को लिखने के लिए धन्यवाद।' },
    liveClosed: { en: 'This chat has ended.', hi: 'यह चैट समाप्त हो गई है।' },
    liveYouEnded: { en: 'Chat ended. Thank you for writing to PFA.', hi: 'चैट समाप्त। PFA को लिखने के लिए धन्यवाद।' },
    liveNotSent: { en: 'That message did not go through. Send it again.', hi: 'यह संदेश नहीं गया। फिर से भेजें।' },
    nothingLive: { en: 'The site does not say. Someone at PFA is on the chat now and can answer.', hi: 'वेबसाइट पर यह नहीं है। PFA में कोई अभी चैट पर है और जवाब दे सकता है।' },
    thanks: { en: 'Glad to help.', hi: 'मदद करके खुशी हुई।' },
    cancelled: { en: 'Stopped. Nothing was sent.', hi: 'रोक दिया। कुछ नहीं भेजा गया।' },
    skipWord: { en: 'Skip', hi: 'छोड़ें' },
    yes: { en: 'Yes', hi: 'हाँ' },
    no: { en: 'No', hi: 'नहीं' },
    done: { en: 'Done', hi: 'हो गया' },
    optional: { en: '(you can skip this)', hi: '(इसे छोड़ सकते हैं)' },
    checkTitle: { en: 'Please check before it is sent:', hi: 'भेजने से पहले जाँच लें:' },
    send: { en: 'Send it', hi: 'भेजें' },
    change: { en: 'Change something', hi: 'कुछ बदलें' },
    cancel: { en: 'Cancel', hi: 'रद्द करें' },
    whichChange: { en: 'What would you like to change?', hi: 'आप क्या बदलना चाहेंगे?' },
    sending: { en: 'Sending it now.', hi: 'अभी भेज रहा हूँ।' },
    sent: { en: 'Sent. Your number is {ref}. Keep it to follow this.', hi: 'भेज दिया गया। आपका नंबर {ref} है। इसे संभाल कर रखें।' },
    notSent: { en: 'It was not sent: {why}', hi: 'यह नहीं भेजा गया: {why}' },
    fixThis: { en: 'Let us fix that.', hi: 'इसे ठीक करते हैं।' },
    tryLater: { en: 'It could not be sent just now. Please try again in a minute.', hi: 'अभी नहीं भेजा जा सका। एक मिनट बाद फिर कोशिश करें।' },
    follow: { en: 'Follow it', hi: 'स्थिति देखें' },
    switchTo: { en: 'Leave this and {what}?', hi: 'इसे छोड़कर {what}?' },
    keepGoing: { en: 'Carry on here', hi: 'यहीं जारी रखें' },
    payNow: { en: 'Accept and pay {amount} on CCAvenue', hi: 'मानें और CCAvenue पर {amount} चुकाएँ' },
    payMonthly: { en: 'Accept and pay {amount} a month on CCAvenue', hi: 'मानें और CCAvenue पर हर महीने {amount} दें' },
    paying: { en: 'Opening CCAvenue\'s secure payment page. You pay there; PFA never sees your card or UPI details. Your receipt comes by email.', hi: 'CCAvenue का सुरक्षित भुगतान पेज खुल रहा है। भुगतान वहीं होगा; PFA आपके कार्ड या UPI की जानकारी कभी नहीं देखता। रसीद ईमेल पर आएगी।' },
    urgent: { en: 'If the animal is in danger right now, call 112 as well, and the nearest PFA unit.', hi: 'अगर जानवर अभी खतरे में है, तो 112 पर भी कॉल करें, और पास की PFA यूनिट को भी।' },
    langSet: { en: 'I will reply in English.', hi: 'अब मैं हिंदी में जवाब दूँगा।' },
    readGuide: { en: 'Read the guide', hi: 'गाइड पढ़ें' },
    readTerms: { en: 'Read the terms', hi: 'शर्तें पढ़ें' },
    tooYoung: { en: 'The internship is for people aged 16 and over, so it cannot be applied for yet.', hi: 'इंटर्नशिप 16 साल और उससे बड़े लोगों के लिए है, इसलिए अभी आवेदन नहीं हो सकता।' },
    startedIntern: { en: 'Your internship has started. The start link is in your email too. Sign in with your email, mobile number and date of birth.', hi: 'आपकी इंटर्नशिप शुरू हो गई है। शुरुआत का लिंक आपके ईमेल पर भी है। अपने ईमेल, मोबाइल नंबर और जन्मतिथि से साइन इन करें।' },
    startIntern: { en: 'Start my internship', hi: 'इंटर्नशिप शुरू करें' },
    looking: { en: 'Looking it up.', hi: 'देख रहा हूँ।' },
    pinIs: { en: 'PIN {pin} is in {district}, {state}.', hi: 'PIN {pin} {district}, {state} में है।' },
    pinUnknown: { en: 'I could not look that PIN code up just now, so I will ask for the state and district.', hi: 'अभी यह PIN नहीं मिल पाया, इसलिए राज्य और ज़िला पूछूँगा।' },
    pinBad: { en: 'That is not a PIN code in India. Please check the six digits.', hi: 'यह भारत का PIN कोड नहीं है। कृपया छह अंक जाँचें।' },
    pickDistrict: { en: 'Which district?', hi: 'कौन सा ज़िला?' },
    status: { en: '{ref}, {kind}: {status}. {next}', hi: '{ref}, {kind}: {status}। {next}' },
    statusWhen: { en: 'Last updated {when}.', hi: 'आखिरी बदलाव {when}।' },
    noMatch: { en: 'Nothing matches that number with that email or mobile. Please check both.', hi: 'उस नंबर और ईमेल या मोबाइल से कुछ नहीं मिला। कृपया दोनों जाँचें।' },
    receiptSent: { en: 'If those details match a payment, its receipt has just been emailed to the address on it. Please check your inbox and spam folder in a few minutes.', hi: 'अगर ये जानकारी किसी भुगतान से मिलती है, तो उसकी रसीद अभी उसी पर दिए ईमेल पते पर भेज दी गई है। कुछ मिनट में अपना इनबॉक्स और स्पैम फ़ोल्डर देखें।' },
    unitsNear: { en: 'PFA units near {place}:', hi: '{place} के पास PFA यूनिट:' },
    allUnits: { en: 'See every unit', hi: 'सभी यूनिट देखें' },
    noUnits: { en: 'There is no PFA unit listed near there yet. PFA\'s head office in New Delhi can help: +91 11 2081 8191. Every unit, with its phone, is on the units page.', hi: 'वहाँ पास में अभी कोई PFA यूनिट नहीं है। नई दिल्ली में PFA का मुख्य कार्यालय मदद कर सकता है: +91 11 2081 8191। हर यूनिट, फ़ोन नंबर के साथ, यूनिट पेज पर है।' },
    callHq: { en: 'Call the head office', hi: 'मुख्य कार्यालय को कॉल करें' },
    openPage: { en: 'Open it', hi: 'खोलें' },
    certGood: { en: 'Genuine. PFA issued internship certificate {no} to {name} on {issued}, for {from} to {to}.', hi: 'असली। PFA ने इंटर्नशिप प्रमाणपत्र {no} {name} को {issued} को दिया था, {from} से {to} तक के लिए।' },
    seeCard: { en: 'See the card', hi: 'कार्ड देखें' },
    memberGood: { en: '{name} holds a genuine PFA membership card, {no}, valid {until}.', hi: '{name} के पास असली PFA सदस्यता कार्ड {no} है, {until}।' },
    memberOld: { en: '{name} holds PFA membership card {no}, but it is no longer valid.', hi: '{name} के पास PFA सदस्यता कार्ड {no} है, पर यह अब मान्य नहीं है।' },
    certOther: { en: 'Genuine. PFA issued {no}, a {title}, to {name} on {issued}, for {about}.', hi: 'असली। PFA ने {no} ({title}) {name} को {issued} को दिया था, {about} के लिए।' },
    certWithdrawn: { en: 'PFA issued certificate {no} to {name}, but withdrew it on {on}. It is no longer valid.', hi: 'PFA ने प्रमाणपत्र {no} {name} को दिया था, पर {on} को वापस ले लिया। यह अब मान्य नहीं है।' },
    cardGood: { en: '{name} holds a genuine colony caregiver card, {no}, valid until {until}.', hi: '{name} के पास असली कॉलोनी केयरगिवर कार्ड {no} है, {until} तक मान्य।' },
    cardOld: { en: '{name} holds colony caregiver card {no}, but it expired on {until}.', hi: '{name} के पास कॉलोनी केयरगिवर कार्ड {no} है, पर यह {until} को समाप्त हो गया।' },
    verifyNone: { en: 'PFA has no certificate or card with that number. Check it against the one you were shown.', hi: 'इस नंबर का कोई प्रमाणपत्र या कार्ड PFA के पास नहीं है। दिखाए गए नंबर से मिलाकर देखें।' },
    verifyPage: { en: 'Open the check', hi: 'जाँच खोलें' }
  };

  function t(key, lang, vars) {
    var s = (T[key] && (T[key][lang] || T[key].en)) || key;
    Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function L(o, lang) { return o ? (o[lang] || o.en || '') : ''; }

  /* ---- choices, in the words the server keeps -------------------------- */

  var O = {
    animal: [
      { value: 'Dog', hi: 'कुत्ता' }, { value: 'Cat', hi: 'बिल्ली' }, { value: 'Cow or buffalo', hi: 'गाय या भैंस' }, { value: 'Horse or donkey', hi: 'घोड़ा या गधा' },
      { value: 'Bird', hi: 'पक्षी' }, { value: 'Monkey', hi: 'बंदर' }, { value: 'Goat or sheep', hi: 'बकरी या भेड़' }, { value: 'Other', hi: 'कोई और' }],
    urgency: [
      { value: 'Happening now', hi: 'अभी हो रहा है', syn: ['now', 'abhi'] }, { value: 'Ongoing', hi: 'बार बार होता है', syn: ['again', 'daily', 'roz'] }, { value: 'Past', hi: 'हो चुका है', syn: ['already', 'happened', 'ho chuka'] }],
    topic: [
      { value: 'An animal I found or feed', hi: 'जो जानवर मुझे मिला या जिसे खिलाता हूँ' }, { value: 'Adoption', hi: 'गोद लेना' }, { value: 'Animal law', hi: 'पशु कानून' },
      { value: 'A PFA unit or hospital', hi: 'PFA यूनिट या अस्पताल' }, { value: 'Colony caregiver card', hi: 'कॉलोनी केयरगिवर कार्ड' }, { value: 'Volunteering', hi: 'स्वयंसेवा' },
      { value: 'A donation or receipt', hi: 'दान या रसीद' }, { value: 'The shop or an order', hi: 'दुकान या ऑर्डर' }, { value: 'Working with PFA', hi: 'PFA के साथ काम' }, { value: 'Something else', hi: 'कुछ और' }],
    areas: [
      { value: 'Head Office', hi: 'मुख्य कार्यालय' }, { value: 'Shelters', hi: 'शेल्टर' }, { value: 'Hospitals', hi: 'अस्पताल' }, { value: 'Rescue Operations', hi: 'रेस्क्यू' },
      { value: 'Laws', hi: 'कानूनी काम' }, { value: 'Sanjay Gandhi Animal Care Centre', hi: 'संजय गांधी एनिमल केयर सेंटर', syn: ['sgacc', 'care centre', 'delhi'] }],
    eventTitle: [
      { value: 'An adoption drive', hi: 'गोद लेने का अभियान' }, { value: 'A sterilisation or vaccination camp', hi: 'नसबंदी या टीकाकरण शिविर' }, { value: 'A CineKind screening', hi: 'सिनेकाइंड स्क्रीनिंग' },
      { value: 'A talk or a school session', hi: 'भाषण या स्कूल सत्र' }, { value: 'Something else', hi: 'कुछ और' }],
    sgOffer: [{ value: 'Supplies for the animals', hi: 'जानवरों के लिए सामान' }, { value: 'A visit with a group', hi: 'समूह के साथ आना' }],
    ckCategory: [
      { value: 'A film or documentary', hi: 'फ़िल्म या डॉक्यूमेंट्री' }, { value: 'A director or filmmaker', hi: 'निर्देशक या फ़िल्मकार' }, { value: 'An actor or public figure', hi: 'अभिनेता या जानी-मानी हस्ती' },
      { value: 'A journalist or photographer', hi: 'पत्रकार या फ़ोटोग्राफ़र' }, { value: 'A caregiver or rescue worker', hi: 'देखभाल करने वाले या रेस्क्यू कर्मी' }, { value: 'Something else', hi: 'कुछ और' }],
    legInterest: [
      { value: 'A share of what I leave', hi: 'जो छोड़ूँ उसका हिस्सा' }, { value: 'A sum of money', hi: 'एक रकम' }, { value: 'Property or another asset', hi: 'संपत्ति या कोई और चीज़' },
      { value: 'A gift in memory of someone', hi: 'किसी की याद में दान' }, { value: 'I am only exploring', hi: 'अभी बस जानना चाहता हूँ' }],
    contactBy: [{ value: 'Email', hi: 'ईमेल' }, { value: 'Phone', hi: 'फ़ोन' }],
    prvRequest: [
      { value: 'A copy of what PFA holds about me', hi: 'PFA के पास मेरी जानकारी की कॉपी' }, { value: 'A correction', hi: 'सुधार' }, { value: 'Erase what I sent', hi: 'मेरी भेजी जानकारी मिटाएँ' },
      { value: 'Withdraw my consent', hi: 'अपनी सहमति वापस लें' }, { value: 'A question about this policy', hi: 'इस नीति के बारे में सवाल' }],
    cmpCause: [
      { value: 'Cows in need', hi: 'ज़रूरतमंद गायें' }, { value: 'Community dogs', hi: 'मोहल्ले के कुत्ते' }, { value: 'Injured and sick animals', hi: 'घायल और बीमार जानवर' },
      { value: 'Feeding drives', hi: 'खाना खिलाने के अभियान' }, { value: 'The Sanjay Gandhi Animal Care Centre', hi: 'संजय गांधी एनिमल केयर सेंटर' }, { value: 'Where it is needed most', hi: 'जहाँ सबसे ज़्यादा ज़रूरत हो' }],
    cmpFormat: [
      { value: 'A birthday or celebration', hi: 'जन्मदिन या उत्सव' }, { value: 'A workplace drive', hi: 'दफ़्तर में अभियान' }, { value: 'A school or college drive', hi: 'स्कूल या कॉलेज में अभियान' },
      { value: 'A run, walk or sports challenge', hi: 'दौड़, वॉक या खेल चुनौती' }, { value: 'A collection of supplies', hi: 'सामान इकट्ठा करना' }, { value: 'An awareness event', hi: 'जागरूकता कार्यक्रम' }],
    faculty: [{ value: 'Yes', hi: 'हाँ' }, { value: 'Not yet', hi: 'अभी नहीं' }],
    cause: [
      { value: 'Where it is needed most', hi: 'जहाँ सबसे ज़्यादा ज़रूरत हो' }, { value: 'Hospitals', hi: 'अस्पताल' }, { value: 'Rescue', hi: 'रेस्क्यू' },
      { value: 'Legal work', hi: 'कानूनी काम' }, { value: 'Learning', hi: 'शिक्षा' }],
    tier: [
      { value: 'student', en: 'Student, ₹500', hi: 'विद्यार्थी, ₹500', amount: 500 }, { value: 'silver', en: 'Silver, ₹1,000', hi: 'सिल्वर, ₹1,000', amount: 1000 },
      { value: 'golden', en: 'Golden, ₹2,500', hi: 'गोल्डन, ₹2,500', amount: 2500 }, { value: 'platinum', en: 'Platinum, ₹5,000', hi: 'प्लैटिनम, ₹5,000', amount: 5000 },
      { value: 'lifetime', en: 'Lifetime, ₹10,000', hi: 'आजीवन, ₹10,000', amount: 10000 }],
    amount: [{ value: '500', en: '₹500' }, { value: '1000', en: '₹1,000' }, { value: '2500', en: '₹2,500' }, { value: '5000', en: '₹5,000' }],
    wall: [
      { value: 'Long form, over three minutes', en: 'Long, over three minutes', hi: 'लंबी, तीन मिनट से ज़्यादा', syn: ['long', 'lamba', 'lambi', 'लंबी', 'documentary'] },
      { value: 'Short form, under a minute', en: 'Short, under a minute', hi: 'छोटी, एक मिनट से कम', syn: ['short', 'reel', 'reels', 'chhota', 'chhoti', 'छोटी', 'रील'] }],
    task: ['Learn the law', 'Map your district', 'Bring 50 people onto the RRT', 'Two films for The Wall', 'Shelter work', 'An RTI to the municipality', 'One CineKind nomination', 'Your own story with animals'].map(function (v) { return { value: v }; }),
    often: [
      { value: 'once', en: 'Once', hi: 'एक बार', syn: ['once', 'one time', 'ek baar', 'ek bar'] },
      { value: 'monthly', en: 'Every month', hi: 'हर महीने', syn: ['monthly', 'every month', 'each month', 'har mahine', 'har mahina', 'mahina', 'masik', 'हर महीने', 'मासिक'] }]
  };

  /* ---- the questions ---------------------------------------------------- */

  /* type: name, mobile, email, text, long, choice, multi, date, yesno, amount,
     photos, consent, address (the whole address, in its own steps) */
  var F = {
    name: { type: 'name', label: { en: 'Name', hi: 'नाम' }, ask: { en: 'What is your full name?', hi: 'आपका पूरा नाम क्या है?' } },
    mobile: { type: 'mobile', label: { en: 'Mobile', hi: 'मोबाइल' }, ask: { en: 'Your 10-digit mobile number?', hi: 'आपका 10 अंकों का मोबाइल नंबर?' } },
    mobileOpt: { type: 'mobile', key: 'mobile', optional: true, label: { en: 'Mobile', hi: 'मोबाइल' }, ask: { en: 'A mobile number, if you would like a call back?', hi: 'अगर आप चाहें कि PFA फ़ोन करे, तो मोबाइल नंबर?' } },
    email: { type: 'email', label: { en: 'Email', hi: 'ईमेल' }, ask: { en: 'Your email? The confirmation goes there.', hi: 'आपका ईमेल? पुष्टि वहीं जाएगी।' } },
    address: { type: 'address', label: { en: 'Address', hi: 'पता' }, ask: { en: 'Your 6-digit PIN code?', hi: 'आपका 6 अंकों का PIN कोड?' } },
    where: { type: 'address', key: 'address', label: { en: 'Where it is', hi: 'कहाँ' }, ask: { en: 'Where is it happening? Start with the 6-digit PIN code of that place.', hi: 'यह कहाँ हो रहा है? उस जगह के 6 अंकों के PIN कोड से शुरू करें।' } },
    /* cruelty */
    what: { type: 'long', min: 10, label: { en: 'What is happening', hi: 'क्या हो रहा है' }, ask: { en: 'Tell me what is happening, in a few words.', hi: 'थोड़े शब्दों में बताइए कि क्या हो रहा है।' } },
    animal: { type: 'choice', options: O.animal, label: { en: 'Animal', hi: 'जानवर' }, ask: { en: 'Which animal?', hi: 'कौन सा जानवर?' } },
    urgency: { type: 'choice', options: O.urgency, label: { en: 'Is it still going on?', hi: 'क्या अभी भी हो रहा है?' }, ask: { en: 'Is it happening now?', hi: 'क्या यह अभी हो रहा है?' } },
    accused: { type: 'text', optional: true, label: { en: 'Who is doing it', hi: 'कौन कर रहा है' }, ask: { en: 'Do you know who is doing it? A name or a description helps.', hi: 'क्या आप जानते हैं कि यह कौन कर रहा है? नाम या पहचान से मदद मिलती है।' } },
    photos: { type: 'photos', optional: true, label: { en: 'Photographs', hi: 'फ़ोटो' }, ask: { en: 'Photographs help a lot. Attach up to 3 with the clip button, or skip.', hi: 'फ़ोटो से बहुत मदद मिलती है। क्लिप बटन से 3 तक फ़ोटो जोड़ें, या छोड़ दें।' } },
    /* help desk */
    question: { type: 'long', min: 10, label: { en: 'Your question', hi: 'आपका सवाल' }, ask: { en: 'What would you like to ask PFA?', hi: 'आप PFA से क्या पूछना चाहेंगे?' } },
    topic: { type: 'choice', options: O.topic, label: { en: 'Topic', hi: 'विषय' }, ask: { en: 'Which is it closest to?', hi: 'यह किससे सबसे ज़्यादा मिलता है?' } },
    /* volunteer */
    areas: { type: 'multi', options: O.areas, label: { en: 'Areas', hi: 'क्षेत्र' }, ask: { en: 'Where would you like to help? Choose one or more, then Done.', hi: 'आप कहाँ मदद करना चाहेंगे? एक या ज़्यादा चुनें, फिर "हो गया"।' } },
    when: { type: 'text', optional: true, label: { en: 'When you are free', hi: 'कब खाली हैं' }, ask: { en: 'When are you free? Weekends, evenings, a few hours a week.', hi: 'आप कब खाली हैं? सप्ताहांत, शाम, या हफ़्ते में कुछ घंटे?' } },
    notes: { type: 'long', min: 2, optional: true, label: { en: 'Anything else', hi: 'और कुछ' }, ask: { en: 'Anything else PFA should know? Experience with animals, languages.', hi: 'PFA को और कुछ जानना चाहिए? जानवरों के साथ अनुभव, भाषाएँ।' } },
    /* internship */
    dob: { type: 'date', label: { en: 'Date of birth', hi: 'जन्मतिथि' }, ask: { en: 'Your date of birth? For example 14/05/2004. You will sign in with it.', hi: 'आपकी जन्मतिथि? जैसे 14/05/2004। आप इसी से साइन इन करेंगे।' } },
    parent: { type: 'yesno', must: true, label: { en: 'A parent or guardian agrees', hi: 'माता-पिता या अभिभावक सहमत हैं' }, ask: { en: 'You are 16 or 17, so a parent or guardian needs to agree. Has a parent or guardian read about the internship and agreed?', hi: 'आपकी उम्र 16 या 17 है, इसलिए माता-पिता या अभिभावक की सहमति ज़रूरी है। क्या उन्होंने इंटर्नशिप के बारे में पढ़कर सहमति दी है?' } },
    why: { type: 'long', min: 20, label: { en: 'Why', hi: 'क्यों' }, ask: { en: 'Why do you want to do the internship? A few lines: what you already do for animals, and what you hope to do.', hi: 'आप इंटर्नशिप क्यों करना चाहते हैं? कुछ पंक्तियाँ: आप जानवरों के लिए क्या करते हैं, और क्या करना चाहते हैं।' } },
    work: { type: 'text', optional: true, label: { en: 'College or work', hi: 'कॉलेज या काम' }, ask: { en: 'Your college or work?', hi: 'आपका कॉलेज या काम?' } },
    guide: { type: 'yesno', must: true, link: 'intern-guide.html', label: { en: 'Read the two-page guide', hi: 'दो पेज की गाइड पढ़ी' }, ask: { en: 'Please read the two-page guide first (about five minutes): how you sign in, what each week asks and how you send your work. Have you read and understood it?', hi: 'पहले दो पेज की गाइड पढ़ें (लगभग पाँच मिनट): साइन इन कैसे करें, हर हफ़्ते क्या करना है और काम कैसे भेजें। क्या आपने इसे पढ़कर समझ लिया?' } },
    /* the smaller forms */
    eventTitle: { type: 'choice', key: 'title', options: O.eventTitle, label: { en: 'Asking for', hi: 'क्या चाहिए' }, ask: { en: 'What would you like PFA to come for?', hi: 'आप PFA को किस लिए बुलाना चाहते हैं?' } },
    eventNotes: { type: 'long', min: 2, key: 'notes', optional: true, label: { en: 'Details', hi: 'जानकारी' }, ask: { en: 'Where and when, and roughly how many people?', hi: 'कहाँ और कब, और लगभग कितने लोग?' } },
    offer: { type: 'choice', options: O.sgOffer, label: { en: 'How you would help', hi: 'आप कैसे मदद करेंगे' }, ask: { en: 'How would you like to help the Sanjay Gandhi Animal Care Centre?', hi: 'आप संजय गांधी एनिमल केयर सेंटर की कैसे मदद करना चाहेंगे?' } },
    sgNotes: { type: 'long', min: 2, key: 'notes', optional: true, label: { en: 'Details', hi: 'जानकारी' }, ask: { en: 'Anything the centre should know? What you would bring, or when you would come.', hi: 'सेंटर को और कुछ जानना चाहिए? आप क्या लाएँगे या कब आएँगे।' } },
    nominee: { type: 'text', label: { en: 'Nominating', hi: 'किसे नामांकित कर रहे हैं' }, ask: { en: 'Who or what are you nominating for CineKind?', hi: 'आप सिनेकाइंड के लिए किसे या किस चीज़ को नामांकित कर रहे हैं?' } },
    category: { type: 'choice', options: O.ckCategory, label: { en: 'Category', hi: 'श्रेणी' }, ask: { en: 'Which category?', hi: 'कौन सी श्रेणी?' } },
    ckWhy: { type: 'long', min: 10, key: 'why', label: { en: 'Why', hi: 'क्यों' }, ask: { en: 'Why should they be honoured?', hi: 'उन्हें सम्मान क्यों मिलना चाहिए?' } },
    interest: { type: 'choice', options: O.legInterest, label: { en: 'Thinking of', hi: 'क्या सोच रहे हैं' }, ask: { en: 'What are you thinking of leaving to PFA?', hi: 'आप PFA के लिए क्या छोड़ने के बारे में सोच रहे हैं?' } },
    contactBy: { type: 'choice', options: O.contactBy, label: { en: 'Reach me by', hi: 'संपर्क का तरीका' }, ask: { en: 'How should PFA reach you, in confidence?', hi: 'PFA आपसे गोपनीय रूप से कैसे संपर्क करे?' } },
    request: { type: 'choice', options: O.prvRequest, label: { en: 'Request', hi: 'अनुरोध' }, ask: { en: 'What are you asking for?', hi: 'आप क्या माँग रहे हैं?' } },
    prvNotes: { type: 'long', min: 2, key: 'details', optional: true, label: { en: 'Details', hi: 'जानकारी' }, ask: { en: 'Anything that helps PFA find it: what you sent, and roughly when.', hi: 'कुछ भी जिससे PFA को ढूँढने में मदद मिले: आपने क्या भेजा था, और लगभग कब।' } },
    cmpCause: { type: 'choice', key: 'cause', options: O.cmpCause, label: { en: 'For', hi: 'किसके लिए' }, ask: { en: 'Which cause is your campaign for?', hi: 'आपका अभियान किस काम के लिए है?' } },
    cmpFormat: { type: 'choice', key: 'format', options: O.cmpFormat, label: { en: 'Kind of campaign', hi: 'अभियान का प्रकार' }, ask: { en: 'What kind of campaign?', hi: 'किस तरह का अभियान?' } },
    cmpTitle: { type: 'text', key: 'title', label: { en: 'Campaign name', hi: 'अभियान का नाम' }, ask: { en: 'What would you like to call it?', hi: 'आप इसे क्या नाम देना चाहेंगे?' } },
    company: { type: 'text', label: { en: 'Company', hi: 'कंपनी' }, ask: { en: 'Your company\'s name?', hi: 'आपकी कंपनी का नाम?' } },
    focus: { type: 'text', label: { en: 'Areas to fund', hi: 'किन कामों के लिए' }, ask: { en: 'Which work would your company like to fund? Rescue, hospitals, shelters, feeding, education...', hi: 'आपकी कंपनी किस काम में पैसा लगाना चाहेगी? रेस्क्यू, अस्पताल, शेल्टर, खाना, शिक्षा...' } },
    college: { type: 'text', label: { en: 'College', hi: 'कॉलेज' }, ask: { en: 'Which college or university?', hi: 'कौन सा कॉलेज या विश्वविद्यालय?' } },
    desks: { type: 'text', label: { en: 'Desks', hi: 'डेस्क' }, ask: { en: 'Which desks will your team run? Rescue, adoption, awareness, legal...', hi: 'आपकी टीम कौन सी डेस्क चलाएगी? रेस्क्यू, गोद लेना, जागरूकता, कानूनी...' } },
    faculty: { type: 'choice', options: O.faculty, label: { en: 'A faculty member agreed', hi: 'शिक्षक सहमत' }, ask: { en: 'Has a faculty member agreed to supervise?', hi: 'क्या किसी शिक्षक ने देखरेख करने की सहमति दी है?' } },
    /* paying */
    amount: { type: 'amount', options: O.amount, label: { en: 'Amount', hi: 'राशि' }, ask: { en: 'How much would you like to give? Choose or type an amount in rupees.', hi: 'आप कितना देना चाहेंगे? चुनें या रुपयों में राशि लिखें।' } },
    often: { type: 'choice', key: 'frequency', options: O.often, label: { en: 'How often', hi: 'कितनी बार' }, ask: { en: 'Once, or the same amount every month? A monthly donation is approved once on CCAvenue\'s page, and replying to the receipt email stops it any time.', hi: 'एक बार, या हर महीने यही राशि? मासिक दान CCAvenue के पेज पर एक बार मंज़ूर होता है, और रसीद वाले ईमेल का जवाब देकर इसे कभी भी रोक सकते हैं।' } },
    cause: { type: 'choice', options: O.cause, label: { en: 'For', hi: 'किसके लिए' }, ask: { en: 'Where should it go?', hi: 'यह कहाँ लगे?' } },
    tier: { type: 'choice', options: O.tier, label: { en: 'Membership', hi: 'सदस्यता' }, ask: { en: 'Which membership? Each has its own card and kit.', hi: 'कौन सी सदस्यता? हर एक का अपना कार्ड और किट है।' } },
    donateTerms: { type: 'consent', key: 'terms', link: 'donate.html', agree: { en: 'Paying confirms these details are yours and that you accept the donation and receipt terms. Donations to PFA are eligible for tax deduction under Section 80G; the receipt follows by email, and a PAN or Aadhaar for it can be given after paying.', hi: 'भुगतान करने का अर्थ है कि ये जानकारी आपकी है और आप दान और रसीद की शर्तें मानते हैं। PFA को दान पर धारा 80G के तहत कर छूट मिलती है; रसीद ईमेल पर आएगी, और उसके लिए PAN या आधार भुगतान के बाद दे सकते हैं।' }, label: { en: 'Terms', hi: 'शर्तें' }, ask: { en: 'Do you confirm these details are yours, and accept the donation and receipt terms? Donations to PFA are eligible for tax deduction under Section 80G; the receipt follows by email, and a PAN or Aadhaar for it can be given after paying.', hi: 'क्या आप पुष्टि करते हैं कि ये जानकारी आपकी है, और दान और रसीद की शर्तें मानते हैं? PFA को दान पर धारा 80G के तहत कर छूट मिलती है; रसीद ईमेल पर आएगी, और उसके लिए PAN या आधार भुगतान के बाद दे सकते हैं।' } },
    memberTerms: { type: 'consent', key: 'terms', link: 'get-involved.html#membership', agree: { en: 'Paying confirms these details are yours, that you accept the membership terms, and that PFA may contact you as a member. Your card and kit come by courier in 20 to 25 days.', hi: 'भुगतान करने का अर्थ है कि ये जानकारी आपकी है, आप सदस्यता की शर्तें मानते हैं, और PFA आपसे सदस्य के रूप में संपर्क कर सकता है। आपका कार्ड और किट 20 से 25 दिन में कूरियर से आएगा।' }, label: { en: 'Terms', hi: 'शर्तें' }, ask: { en: 'Do you accept the membership terms, and that PFA may contact you as a member? Your card and kit come by courier in 20 to 25 days.', hi: 'क्या आप सदस्यता की शर्तें मानते हैं, और कि PFA आपसे सदस्य के रूप में संपर्क कर सकता है? आपका कार्ड और किट 20 से 25 दिन में कूरियर से आएगा।' } },
    /* The Wall, and an intern's proof */
    wallUrl: { type: 'url', key: 'url', hosts: ['instagram.com', 'facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'vimeo.com'], label: { en: 'Link', hi: 'लिंक' }, ask: { en: 'Paste the link to the public post: Instagram, Facebook, YouTube or Vimeo.', hi: 'सार्वजनिक पोस्ट का लिंक डालें: Instagram, Facebook, YouTube या Vimeo।' } },
    wall: { type: 'choice', options: O.wall, label: { en: 'Which wall', hi: 'कौन सी वॉल' }, ask: { en: 'Is it long, over three minutes, or short, under a minute?', hi: 'यह लंबी है, तीन मिनट से ज़्यादा, या छोटी, एक मिनट से कम?' } },
    creditName: { type: 'name', key: 'name', label: { en: 'Credit to', hi: 'श्रेय' }, ask: { en: 'The name to credit on The Wall?', hi: 'वॉल पर किसका नाम दिया जाए?' } },
    application: { type: 'reference', key: 'application', label: { en: 'Application number', hi: 'आवेदन नंबर' }, ask: { en: 'The number you were given when you applied for the internship? It reads like PFA-VI-2026-00012.', hi: 'इंटर्नशिप के आवेदन पर मिला नंबर? जैसे PFA-VI-2026-00012।' } },
    task: { type: 'choice', options: O.task, label: { en: 'Task', hi: 'काम' }, ask: { en: 'Which task is this proof for?', hi: 'यह किस काम का सबूत है?' } },
    proofWhat: { type: 'long', min: 10, key: 'what', label: { en: 'What you did', hi: 'आपने क्या किया' }, ask: { en: 'What did you do? A few lines.', hi: 'आपने क्या किया? कुछ पंक्तियाँ।' } },
    links: { type: 'url', key: 'links', many: true, label: { en: 'Links to the proof', hi: 'सबूत के लिंक' }, ask: { en: 'The links to the proof: a Drive folder, a post, a document. Paste one or more.', hi: 'सबूत के लिंक: Drive फ़ोल्डर, पोस्ट, दस्तावेज़। एक या ज़्यादा डालें।' } },
    certno: { type: 'certno', label: { en: 'Number', hi: 'नंबर' }, ask: { en: 'The number on the certificate or card? It reads like PFA-INT-AB2CD3EF, PFA-VOL-AB2CD3EF or PFA-CCT-AB2CD3EF.', hi: 'प्रमाणपत्र या कार्ड पर लिखा नंबर? जैसे PFA-INT-AB2CD3EF या PFA-CCT-AB2CD3EF।' } },
    /* looking things up */
    reference: { type: 'reference', label: { en: 'Number', hi: 'नंबर' }, ask: { en: 'What is the number you were given? It reads like PFA-CR-2026-00012.', hi: 'आपको कौन सा नंबर मिला था? जैसे PFA-CR-2026-00012।' } },
    contact: { type: 'contact', label: { en: 'Email or mobile', hi: 'ईमेल या मोबाइल' }, ask: { en: 'The email or mobile you gave with it?', hi: 'उसके साथ दिया गया ईमेल या मोबाइल?' } },
    place: { type: 'place', label: { en: 'Where', hi: 'कहाँ' }, ask: { en: 'Where are you? A 6-digit PIN code or your town.', hi: 'आप कहाँ हैं? 6 अंकों का PIN कोड या आपका शहर।' } }
  };

  /* ---- the offerings ------------------------------------------------------ */

  var FLOWS = {
    report: { kind: 'PFA-CR', title: { en: 'Report cruelty', hi: 'क्रूरता की रिपोर्ट करें' }, intro: { en: 'I will take your report to PFA now. A few questions.', hi: 'मैं आपकी रिपोर्ट अभी PFA तक पहुँचाऊँगा। कुछ सवाल।' }, urgent: true,
      fields: ['what', 'animal', 'urgency', 'where', 'accused', 'photos', 'name', 'mobile', 'email'] },
    helpdesk: { kind: 'PFA-Q', title: { en: 'Ask a question', hi: 'सवाल पूछें' }, intro: { en: 'PFA\'s help desk answers by email. A few questions.', hi: 'PFA की हेल्प डेस्क ईमेल से जवाब देती है। कुछ सवाल।' },
      fields: ['question', 'topic', 'name', 'email', 'mobileOpt', 'address'] },
    volunteer: { kind: 'PFA-V', title: { en: 'Volunteer', hi: 'स्वयंसेवा करें' }, intro: { en: 'Thank you for wanting to help. A few questions for your application.', hi: 'मदद करना चाहने के लिए धन्यवाद। आपके आवेदन के लिए कुछ सवाल।' },
      fields: ['areas', 'name', 'mobile', 'email', 'address', 'when', 'notes'] },
    internship: { kind: 'PFA-VI', title: { en: 'Remote internship', hi: 'रिमोट इंटर्नशिप' }, intro: { en: 'The eight-week remote internship starts as soon as you apply. A few questions.', hi: 'आठ हफ़्ते की रिमोट इंटर्नशिप आवेदन करते ही शुरू हो जाती है। कुछ सवाल।' },
      fields: ['name', 'dob', 'parent', 'mobile', 'email', 'address', 'why', 'work', 'guide'] },
    event: { kind: 'PFA-EV', title: { en: 'Invite PFA to an event or camp', hi: 'PFA को कार्यक्रम या शिविर में बुलाएँ' }, fields: ['eventTitle', 'eventNotes', 'name', 'mobile', 'email', 'address'] },
    sgacc: { kind: 'PFA-SG', title: { en: 'Help the Animal Care Centre', hi: 'एनिमल केयर सेंटर की मदद' }, fields: ['offer', 'sgNotes', 'name', 'mobile', 'email', 'address'] },
    cinekind: { kind: 'PFA-CK', title: { en: 'Nominate for CineKind', hi: 'सिनेकाइंड के लिए नामांकन' }, fields: ['nominee', 'category', 'ckWhy', 'name', 'email', 'mobileOpt', 'address'] },
    legacy: { kind: 'PFA-LEG', title: { en: 'A gift in your will', hi: 'वसीयत में दान' }, fields: ['interest', 'contactBy', 'name', 'email', 'mobileOpt', 'address'] },
    privacy: { kind: 'PFA-PRV', title: { en: 'Your data with PFA', hi: 'PFA के पास आपकी जानकारी' }, fields: ['request', 'prvNotes', 'name', 'email', 'address'] },
    campaign: { kind: 'PFA-CMP', title: { en: 'Plan a campaign', hi: 'अभियान की योजना' }, fields: ['cmpCause', 'cmpFormat', 'cmpTitle', 'name', 'mobile', 'email', 'address'] },
    csr: { kind: 'PFA-CSR', title: { en: 'Partner as a company', hi: 'कंपनी के रूप में साझेदारी' }, fields: ['company', 'focus', 'name', 'email', 'mobile', 'address'] },
    campus: { kind: 'PFA-CAM', title: { en: 'Start a campus society', hi: 'कैंपस सोसाइटी शुरू करें' }, fields: ['college', 'desks', 'faculty', 'name', 'mobile', 'email', 'address'] },
    donate: { pay: 'donate', title: { en: 'Donate', hi: 'दान करें' }, intro: { en: 'Thank you. A few details for your receipt, then CCAvenue\'s secure page for the payment.', hi: 'धन्यवाद। रसीद के लिए कुछ जानकारी, फिर भुगतान के लिए CCAvenue का सुरक्षित पेज।' },
      fields: ['amount', 'often', 'cause', 'name', 'mobile', 'email', 'address', 'donateTerms'] },
    member: { pay: 'membership', title: { en: 'Become a member', hi: 'सदस्य बनें' }, intro: { en: 'A few details for your card and kit, then CCAvenue\'s secure page for the payment.', hi: 'कार्ड और किट के लिए कुछ जानकारी, फिर भुगतान के लिए CCAvenue का सुरक्षित पेज।' },
      fields: ['tier', 'name', 'mobile', 'email', 'address', 'memberTerms'] },
    wallstory: { kind: 'PFA-S', title: { en: 'Share a film for The Wall', hi: 'द वॉल के लिए फ़िल्म भेजें' }, intro: { en: 'The Wall shows films about animals, made by anyone. An editor looks at each one.', hi: 'द वॉल पर जानवरों के बारे में कोई भी फ़िल्म भेज सकता है। हर फ़िल्म एक संपादक देखते हैं।' },
      fields: ['wallUrl', 'wall', 'creditName', 'email', 'address'] },
    proof: { kind: 'PFA-VP', title: { en: 'Send internship proof', hi: 'इंटर्नशिप का सबूत भेजें' }, intro: { en: 'For an internship task you have done. A few questions.', hi: 'इंटर्नशिप का जो काम आपने किया है, उसके लिए। कुछ सवाल।' },
      fields: ['application', 'task', 'proofWhat', 'links', 'name', 'email', 'address'] },
    verify: { look: 'verify', title: { en: 'Check a certificate or card', hi: 'प्रमाणपत्र या कार्ड जाँचें' }, intro: { en: 'Anyone can check whether a PFA internship certificate or colony caregiver card is genuine.', hi: 'कोई भी जाँच सकता है कि PFA का इंटर्नशिप प्रमाणपत्र या कॉलोनी केयरगिवर कार्ड असली है या नहीं।' }, fields: ['certno'] },
    track: { look: 'track', title: { en: 'Follow an application or report', hi: 'आवेदन या रिपोर्ट की स्थिति' }, fields: ['reference', 'contact'] },
    receipt: { look: 'receipt', title: { en: 'Get a receipt', hi: 'रसीद पाएँ' }, intro: { en: 'I will send the receipt again to the email on the payment. It carries the link for the 80G tax receipt too. To find it, I need the email and mobile you paid with.', hi: 'मैं रसीद उसी ईमेल पर दोबारा भेजूँगा जो भुगतान पर दिया था। उसी में 80G कर रसीद का लिंक भी है। ढूँढने के लिए भुगतान वाला ईमेल और मोबाइल चाहिए।' }, fields: ['email', 'mobile'] },
    nearby: { look: 'nearby', title: { en: 'Find help near me', hi: 'पास में मदद' }, fields: ['place'] }
  };

  /* Offerings finished on their own page, because of what they ask for
     (documents, a role's own questions, seven board members) */
  var PAGES = {
    caregiver: { href: 'get-involved.html#caregiver', title: { en: 'Colony caregiver card', hi: 'कॉलोनी केयरगिवर कार्ड' }, say: { en: 'The colony caregiver card is for people who feed and care for community animals. The application asks for your ID and photographs, so it is done on its own page, step by step.', hi: 'कॉलोनी केयरगिवर कार्ड उन लोगों के लिए है जो मोहल्ले के जानवरों को खिलाते और देखभाल करते हैं। आवेदन में पहचान पत्र और फ़ोटो लगते हैं, इसलिए यह अपने पेज पर कदम दर कदम होता है।' } },
    jobs: { href: 'careers.html', title: { en: 'Jobs at PFA', hi: 'PFA में नौकरी' }, say: { en: 'Each role at PFA has its own questions, so applications are on the careers page.', hi: 'PFA में हर पद के अपने सवाल हैं, इसलिए आवेदन करियर पेज पर होते हैं।' } },
    shop: { href: 'shop.html', title: { en: 'The PFA shop', hi: 'PFA की दुकान' }, say: { en: 'Everything in the shop supports the animals. For an order you have placed, reply to its confirmation email, or ask me a question for the help desk.', hi: 'दुकान की हर चीज़ से जानवरों की मदद होती है। दिए गए ऑर्डर के लिए उसके पुष्टि ईमेल का जवाब दें, या हेल्प डेस्क के लिए मुझसे सवाल पूछें।' } },
    newunit: { href: 'units.html#apply', title: { en: 'Start a PFA unit', hi: 'नई PFA यूनिट' }, say: { en: 'A new unit needs seven board members and their papers, so it is applied for on the units page.', hi: 'नई यूनिट के लिए सात बोर्ड सदस्य और उनके कागज़ चाहिए, इसलिए आवेदन यूनिट पेज पर होता है।' } },
    mednote: { href: 'pet-health.html#share', title: { en: 'Submit your care guide', hi: 'अपनी देखभाल गाइड भेजें' }, say: { en: 'A care guide is one problem you have seen an animal through: an illness or injury, first aid, feeding, recovery or old age, told for the next person facing it. It can come with a PDF, a cover and photographs, so it is sent from its own page. PFA reads every one before it goes up.', hi: 'देखभाल गाइड किसी एक समस्या के बारे में होती है जिससे आपने किसी जानवर को उबारा हो: बीमारी या चोट, प्राथमिक उपचार, खाना, ठीक होना या बुढ़ापा, अगले व्यक्ति के लिए लिखा हुआ। इसके साथ PDF, कवर और फ़ोटो लग सकते हैं, इसलिए यह अपने पेज से भेजी जाती है। ऊपर लगाने से पहले PFA हर गाइड पढ़ता है।' } },
    /* every page in the site's menu that is read rather than filled in
       (owner, 16 Nov 2026: "ensure chatbot know about each and every
       feature of the main site"), each in the page's own words */
    guides: { href: 'pet-health.html', title: { en: 'Care Guides', hi: 'देखभाल गाइड' }, say: { en: 'Care Guides are plain guides to animal health, shared by pet parents, caregivers, vets and doctors, and read by PFA before they go up. Read them on the page, or download them.', hi: 'देखभाल गाइड पशु स्वास्थ्य पर सरल गाइड हैं, जिन्हें पालतू जानवरों के मालिक, देखभाल करने वाले, पशु चिकित्सक और डॉक्टर साझा करते हैं, और PFA उन्हें पहले पढ़ता है। पेज पर पढ़ें या डाउनलोड करें।' } },
    newsroom: { href: 'newsroom.html', title: { en: 'Newsroom and cases', hi: 'न्यूज़रूम और केस' }, say: { en: 'News and updates from People for Animals, with the cases PFA is working on.', hi: 'People for Animals की ख़बरें और अपडेट, और वे केस जिन पर PFA काम कर रहा है।' } },
    achievements: { href: 'achievements.html', title: { en: 'Policies and achievements', hi: 'नीतियाँ और उपलब्धियाँ' }, say: { en: 'Thirty years of changes People for Animals has made to India\'s animal law and to the systems that run it.', hi: 'भारत के पशु कानून और उसे चलाने वाली व्यवस्थाओं में People for Animals के तीस साल के बदलाव।' } },
    library: { href: 'library.html', title: { en: 'Resources library', hi: 'संसाधन पुस्तकालय' }, say: { en: 'Handbooks, laws, training manuals and policy briefs on animal welfare in India. Read any of them on the site, or download the original.', hi: 'भारत में पशु कल्याण पर पुस्तिकाएँ, कानून, प्रशिक्षण मैनुअल और नीति दस्तावेज़। साइट पर पढ़ें या मूल फ़ाइल डाउनलोड करें।' } },
    academy: { href: 'academy.html', title: { en: 'Academy: animal first aid', hi: 'अकादमी: पशु प्राथमिक उपचार' }, say: { en: 'Animal medicine and first aid, for India: how medicines and vaccines work, how to read a prescription and a dose, and first aid that helps. Fourteen modules, every claim cited.', hi: 'भारत के लिए पशु दवा और प्राथमिक उपचार: दवाएँ और टीके कैसे काम करते हैं, पर्चा और खुराक कैसे पढ़ें, और सही प्राथमिक उपचार। चौदह मॉड्यूल।' } },
    behaviour: { href: 'behaviour.html', title: { en: 'Behaviour, A to Z', hi: 'व्यवहार, A से Z' }, say: { en: 'Why dogs and cats do what they do, and what helps: 75 topics on rescue dogs and cats, puppies and kittens, fear, aggression, soiling, barking and old age.', hi: 'कुत्ते और बिल्लियाँ ऐसा क्यों करते हैं, और क्या मदद करता है: डर, आक्रामकता, भौंकना, बुढ़ापा और ऐसे 75 विषय।' } },
    someone: { href: 'someone.html', title: { en: 'Someone, not something', hi: 'कोई, कुछ नहीं' }, say: { en: 'What the science says about the animals we eat: memory, self-control, play and feeling in hens, pigs, cows and goats, with every claim sourced.', hi: 'जिन जानवरों को हम खाते हैं उनके बारे में विज्ञान क्या कहता है: मुर्गियों, सुअरों, गायों और बकरियों में याददाश्त, खेल और भावनाएँ।' } },
    fireworks: { href: 'fireworks.html', title: { en: 'Fireworks and animals', hi: 'पटाखे और जानवर' }, say: { en: 'Crackers terrify dogs, cats, birds and cattle. How to keep animals safe before, during and after Diwali, weddings and New Year, and what Indian law allows.', hi: 'पटाखों से कुत्ते, बिल्लियाँ, पक्षी और मवेशी डरते हैं। दिवाली, शादियों और नए साल पर जानवरों को सुरक्षित कैसे रखें, और कानून क्या कहता है।' } },
    quiz: { href: 'quiz.html', title: { en: 'Test yourself', hi: 'ख़ुद को परखें' }, say: { en: 'A six-question quiz on what farm animals can do, every answer drawn from published research. Download a certificate at the end.', hi: 'खेत के जानवर क्या कर सकते हैं, इस पर छह सवालों की क्विज़। अंत में प्रमाणपत्र डाउनलोड करें।' } },
    gifts: { href: 'gifts.html', title: { en: 'Seasonal gifts', hi: 'त्योहार के उपहार' }, say: { en: 'Gifts for Deepawali, Christmas, New Year and every occasion: PFA\'s designer T-shirts, a donation in someone\'s name, a membership. Every gift helps animals.', hi: 'दीपावली, क्रिसमस, नए साल और हर मौके के उपहार: PFA की डिज़ाइनर टी-शर्ट, किसी के नाम दान, सदस्यता। हर उपहार जानवरों की मदद करता है।' } },
    founder: { href: 'founder.html', title: { en: 'The founder', hi: 'संस्थापक' }, say: { en: 'Maneka Sanjay Gandhi founded People for Animals and built it into India\'s largest animal welfare organisation.', hi: 'मेनका संजय गांधी ने People for Animals की स्थापना की और इसे भारत का सबसे बड़ा पशु कल्याण संगठन बनाया।' } },
    picks: { href: 'manekas-picks.html', title: { en: 'Maneka\'s Picks', hi: 'मेनका की पसंद' }, say: { en: 'Three films and three books about the lives we share with animals, chosen by Smt. Maneka Sanjay Gandhi.', hi: 'जानवरों के साथ हमारे जीवन पर तीन फ़िल्में और तीन किताबें, श्रीमती मेनका संजय गांधी की चुनी हुई।' } },
    lawpage: { href: 'laws.html', title: { en: 'What the law says', hi: 'कानून क्या कहता है' }, say: { en: 'How to file an animal cruelty complaint or FIR in India, what the law says after a dog bite, and plain answers on community dogs, cattle, pets and working animals.', hi: 'भारत में पशु क्रूरता की शिकायत या FIR कैसे करें, कुत्ते के काटने के बाद कानून क्या कहता है, और गली के कुत्तों, मवेशियों, पालतू और काम करने वाले जानवरों पर सीधे जवाब।' } },
    unitlist: { href: 'units.html', title: { en: 'Units: find help near you', hi: 'यूनिट: पास में मदद' }, say: { en: 'People for Animals has units in some eighty cities across India: animal rescue, shelters, hospitals and animal ambulances, each with its phone number, email and address.', hi: 'People for Animals की यूनिट भारत के लगभग अस्सी शहरों में हैं: बचाव, आश्रय, अस्पताल और एम्बुलेंस, हर एक का फ़ोन, ईमेल और पता।' } },
    podcast: { href: 'events.html#podcast', title: { en: 'A podcast with Maneka Gandhi', hi: 'मेनका गांधी के साथ पॉडकास्ट' }, say: { en: 'There are three a year, each on animal welfare and the concerns animals face, planned at least 60 days ahead and approved by the PFA team. The application asks for one paragraph in your own words, so it is on the events page.', hi: 'साल में तीन होते हैं, हर एक पशु कल्याण और जानवरों की समस्याओं पर, कम से कम 60 दिन पहले तय, और PFA टीम की मंज़ूरी से। आवेदन में अपने शब्दों में एक पैराग्राफ़ लिखना होता है, इसलिए यह इवेंट पेज पर है।' } },
    interndash: { href: 'intern.html', title: { en: 'Intern dashboard', hi: 'इंटर्न डैशबोर्ड' }, say: { en: 'Interns sign in to the dashboard with their email, mobile and date of birth.', hi: 'इंटर्न अपने ईमेल, मोबाइल और जन्मतिथि से डैशबोर्ड में साइन इन करते हैं।' } }
  };

  /* what the menu offers, first the main ones, then More */
  var MENU = ['report', 'nearby', 'donate', 'volunteer', 'member', 'track'];
  var MORE = ['receipt', 'internship', 'proof', 'helpdesk', 'adopt', 'caregiver', 'wallstory', 'event', 'sgacc', 'cinekind', 'campaign', 'legacy', 'csr', 'campus', 'verify', 'privacy', 'jobs', 'shop', 'newunit', 'guides', 'mednote', 'podcast'];
  var INFO = {
    adopt: { title: { en: 'Adopt an animal', hi: 'जानवर गोद लें' }, q: 'adopt adoption', topic: 'Adoption' },
    law: { title: { en: 'Animal law', hi: 'पशु कानून' }, q: 'law', topic: 'Animal law' }
  };
  /* ---- straight answers ----------------------------------------------------
     Owner, 15 Nov 2026: "questions like maneka gandhi email id should give a
     simple and straight answer.. instead of tons of links. be really smart".
     A question about a fact the site states (an email, a phone number, an
     address, who founded PFA, the 80G deduction, what membership costs, the
     internship's terms) is answered in one line, with the one link that does
     it (write, call, open), never a list of pages. Each answer is as the
     site publishes it: the footer's registered office, the care centre's
     page, the internship and membership pages. A fact is matched when the
     question holds a word from each of its groups; `over` names the
     offerings a question about it may come before ("is my donation 80G?"
     is a question, not a donation).

     The rule (owner, 15 Nov 2026: "always answer from site database. not
     google or anywhere else. that is 100% the rule"): every answer here is
     the site's own words and figures, and nothing is ever looked up
     anywhere else. test/assistant.test.js checks that each email, phone
     number, PIN code and rupee figure below is printed on the site's own
     pages, so an answer cannot say what the site does not. A question with
     no answer here goes to the site's own search index, then to PFA's help
     desk; never to the web. */
  var OFFICE_EMAIL = 'gandhim@exmpls.sansad.in';
  var FACTS = [
    { id: 'emailManeka', need: [['email', 'mail', 'e-mail', 'ईमेल', 'मेल'], ['maneka', 'menka', 'gandhi', 'chairperson', 'chairman', 'madam', 'founder', 'मेनका', 'गांधी']],
      say: { en: 'You can write to Smt. Maneka Sanjay Gandhi at PFA\'s office: ' + OFFICE_EMAIL, hi: 'श्रीमती मेनका संजय गांधी को PFA के कार्यालय के ईमेल पर लिखें: ' + OFFICE_EMAIL },
      links: [{ en: 'Write an email', hi: 'ईमेल लिखें', href: 'mailto:' + OFFICE_EMAIL }] },
    { id: 'email', need: [['email', 'mail', 'e-mail', 'ईमेल', 'मेल']],
      say: { en: 'PFA\'s email is ' + OFFICE_EMAIL + '.', hi: 'PFA का ईमेल है: ' + OFFICE_EMAIL },
      links: [{ en: 'Write an email', hi: 'ईमेल लिखें', href: 'mailto:' + OFFICE_EMAIL }] },
    { id: 'sgacc', over: ['sgacc', 'nearby'], need: [['sanjay', 'sgacc', 'care centre', 'care center', 'raja garden'], ['address', 'where', 'located', 'location', 'phone', 'number', 'contact', 'call', 'timing', 'timings', 'hours', 'open', 'kahan', 'kaha', 'पता', 'कहाँ', 'फोन', 'नंबर']],
      say: { en: 'The Sanjay Gandhi Animal Care Centre is at Raja Garden, New Delhi 110027, near Shivaji College (Metro: Rajouri Garden). The wards and out-patients are open 24 hours. Call +91 95608 02425 or +91 88823 25407.', hi: 'संजय गांधी एनिमल केयर सेंटर राजा गार्डन, नई दिल्ली 110027 में है, शिवाजी कॉलेज के पास (मेट्रो: राजौरी गार्डन)। वार्ड और ओपीडी 24 घंटे खुले हैं। कॉल करें: +91 95608 02425 या +91 88823 25407।' },
      links: [{ en: 'Call +91 95608 02425', hi: 'कॉल करें: +91 95608 02425', href: 'tel:+919560802425' }, { en: 'Directions and more', hi: 'रास्ता और जानकारी', href: 'sgacc.html' }] },
    { id: 'phone', need: [['phone', 'number', 'call', 'contact', 'telephone', 'landline', 'फोन', 'नंबर', 'संपर्क'], ['pfa', 'office', 'head', 'headquarters', 'maneka', 'gandhi', 'delhi', 'your', 'you', 'people for animals', 'कार्यालय', 'मेनका']],
      say: { en: 'PFA\'s head office in Delhi: +91 11 2081 8191 or +91 11 2081 8194. If an animal is in danger right now, call 112 and your nearest PFA unit.', hi: 'PFA का दिल्ली मुख्यालय: +91 11 2081 8191 या +91 11 2081 8194। अगर कोई जानवर अभी खतरे में है, तो 112 और पास की PFA यूनिट को कॉल करें।' },
      links: [{ en: 'Call +91 11 2081 8191', hi: 'कॉल करें: +91 11 2081 8191', href: 'tel:+911120818191' }], chip: 'nearby' },
    { id: 'address', need: [['address', 'office', 'located', 'location', 'headquarters', 'where', 'kahan', 'kaha', 'पता', 'कहाँ'], ['pfa', 'office', 'head', 'headquarters', 'registered', 'maneka', 'gandhi', 'people for animals', 'your', 'कार्यालय']],
      say: { en: 'PFA\'s registered office: 4-T, DCM Building, 16 Barakhamba Road, New Delhi 110001.', hi: 'PFA का पंजीकृत कार्यालय: 4-T, DCM बिल्डिंग, 16 बाराखंभा रोड, नई दिल्ली 110001।' },
      chip: 'nearby' },
    { id: 'founder', need: [['founder', 'founded', 'started', 'start', 'chairperson', 'chairman', 'head', 'runs', 'who', 'sansthapak', 'संस्थापक', 'अध्यक्ष', 'कौन'], ['pfa', 'people for animals', 'maneka', 'gandhi', 'मेनका', 'organisation', 'organization', 'ngo']],
      say: { en: 'People for Animals was founded by Smt. Maneka Sanjay Gandhi, who is its chairperson.', hi: 'पीपल फॉर एनिमल्स की स्थापना श्रीमती मेनका संजय गांधी ने की, और वे इसकी अध्यक्ष हैं।' },
      links: [{ en: 'About her', hi: 'उनके बारे में', href: 'founder.html' }], over: ['founder'] },
    { id: 'tax', over: ['donate'], need: [['80g', 'tax', 'exemption', 'exempt', 'deduction', 'deductible', 'income', 'टैक्स', 'कर']],
      say: { en: 'Yes. Donations to PFA are eligible for tax deduction under Section 80G. Your receipt comes by email, with a link to add your PAN or Aadhaar for the 80G receipt.', hi: 'हाँ। PFA को दान पर धारा 80G के तहत कर छूट मिलती है। रसीद ईमेल पर आती है, उसी में 80G रसीद के लिए PAN या आधार देने का लिंक होता है।' },
      chip: 'donate' },
    { id: 'memberFee', over: ['member'], need: [['fee', 'fees', 'cost', 'costs', 'price', 'charge', 'charges', 'how much', 'kitna', 'kitne', 'paisa', 'शुल्क', 'कितना', 'फीस'], ['member', 'membership', 'sadasya', 'सदस्य', 'सदस्यता']],
      say: { en: 'Membership: Student ₹500, Silver ₹1,000, Golden ₹2,500, Platinum ₹5,000, Lifetime ₹10,000. Each has its own card and kit.', hi: 'सदस्यता: विद्यार्थी ₹500, सिल्वर ₹1,000, गोल्डन ₹2,500, प्लैटिनम ₹5,000, आजीवन ₹10,000। हर एक का अपना कार्ड और किट है।' },
      chip: 'member' },
    { id: 'internTerms', over: ['internship'], need: [['fee', 'fees', 'cost', 'free', 'paid', 'stipend', 'salary', 'duration', 'long', 'weeks', 'age', 'eligible', 'eligibility', 'hours', 'kitna', 'kitne', 'शुल्क', 'कितना', 'उम्र'], ['intern', 'internship', 'इंटर्न']],
      say: { en: 'The remote internship is free to join and unpaid: 8 weeks, one task a week, 6 to 8 hours a week. Anyone in India aged 18 or over can apply; at 16 or 17, with a parent\'s consent.', hi: 'रिमोट इंटर्नशिप मुफ़्त है और इसमें भुगतान नहीं मिलता: 8 हफ़्ते, हर हफ़्ते एक काम, हफ़्ते में 6 से 8 घंटे। भारत में 18 या उससे ज़्यादा उम्र का कोई भी आवेदन कर सकता है; 16 या 17 की उम्र में माता-पिता की सहमति से।' },
      chip: 'internship' },
    { id: 'social', need: [['instagram', 'facebook', 'twitter', 'youtube', 'social', 'insta']],
      say: { en: 'PFA is on Instagram (@pfa.official), Facebook (people4animals), X (@pfaindia) and YouTube (@peopleforanimals9047).', hi: 'PFA इंस्टाग्राम (@pfa.official), फेसबुक (people4animals), X (@pfaindia) और यूट्यूब (@peopleforanimals9047) पर है।' } }
  ];
  /* a question, said as one: "kya", "where is", "?" */
  var ASKING = /\?|\b(what|whats|who|whom|where|when|how|which|is|are|can|does|do|kya|kaun|kahan|kaha|kab|kaise|kitna|kitne)\b|क्या|कौन|कहाँ|कब|कैसे|कितना/i;
  /* the fact a question asks, or null; `top` is the offering it reads as */
  function factOf(text, top) {
    var s = N.normalise(text);
    var words = N.tokens(s);
    if (!words.length || words.length > 16) return null;
    /* someone giving their own email or number is answering, not asking */
    if (N.emailOf(text) || N.mobileOf(text)) return null;
    for (var i = 0; i < FACTS.length; i++) {
      var f = FACTS[i];
      if (!f.need.every(function (group) { return N.countHits(s, words, group) > 0; })) continue;
      if (!top || top === 'question' || top === 'greet' || top === 'thanks') return f;
      /* a fact with a word of what is asked (an address, a fee) is asked even
         without a question word: "care centre address" */
      if ((f.over || []).indexOf(top) > -1 && (ASKING.test(text) || f.need.length > 1)) return f;
    }
    return null;
  }

  var INTENT_TO = { report: 'report', nearby: 'nearby', donate: 'donate', member: 'member', volunteer: 'volunteer', internship: 'internship', caregiver: 'caregiver', track: 'track', receipt: 'receipt',
    adopt: 'adopt', event: 'event', sgacc: 'sgacc', csr: 'csr', legacy: 'legacy', campaign: 'campaign', campus: 'campus', privacy: 'privacy', cinekind: 'cinekind', wall: 'wallstory', proof: 'proof', verify: 'verify', jobs: 'jobs', shop: 'shop', newunit: 'newunit', mednote: 'mednote', podcast: 'podcast', guides: 'guides', desk: 'helpdesk', newsroom: 'newsroom', achievements: 'achievements', library: 'library', academy: 'academy', behaviour: 'behaviour', someone: 'someone', fireworks: 'fireworks', quiz: 'quiz', gifts: 'gifts', founder: 'founder', picks: 'picks', lawpage: 'lawpage', unitlist: 'unitlist', law: 'law', question: 'helpdesk' };

  function titleOf(id, lang) {
    var f = FLOWS[id] || PAGES[id] || INFO[id];
    return f ? L(f.title, lang) : id;
  }
  function chip(id, lang) { return { label: titleOf(id, lang), value: '#' + id }; }

  /* ---- a session ------------------------------------------------------------ */

  function createSession(opts) {
    var o = opts || {};
    var now = o.now || function () { return Date.now(); };
    var S = o.state ? JSON.parse(JSON.stringify(o.state)) : { lang: o.lang === 'hi' ? 'hi' : 'en', flow: '', step: 0, data: {}, phase: 'menu', addr: null, editing: false, pending: null, offer: '' };
    var photos = [];
    /* monthly giving, while the panel has it on (donate#monthly) */
    function monthlyOn() { try { return typeof o.monthly === 'function' ? Boolean(o.monthly()) : Boolean(o.monthly); } catch (_) { return false; } }
    /* someone in the panel is available for a live chat (the page asks
       /api/live-chat and answers here) */
    function liveOn() { try { return typeof o.live === 'function' ? Boolean(o.live()) : Boolean(o.live); } catch (_) { return false; } }

    function lang() { return S.lang; }
    function out(messages, extra) {
      return Object.assign({ lang: S.lang, messages: messages, action: null, input: inputNow() }, extra || {});
    }
    function msg(text, more) { return Object.assign({ text: text }, more || {}); }
    function inputNow() {
      if (S.phase === 'ask') {
        var f = fieldNow();
        if (f && f.type === 'photos') return { type: 'photo' };
        if (f && f.type === 'long') return { type: 'long' };
      }
      return { type: 'text' };
    }

    /* ---- the menu ---- */
    function menu(first) {
      S.flow = ''; S.phase = 'menu'; S.step = 0; S.data = {}; S.addr = null; S.editing = false; S.pending = null; S.photosAsked = false; photos = [];
      var chips = MENU.map(function (id) { return chip(id, lang()); }).concat([{ label: t('more', lang()), value: '#more' }]);
      return out([msg(t(first ? 'hello' : 'menuAgain', lang()), { chips: chips })]);
    }
    function more() {
      var chips = MORE.map(function (id) { return chip(id, lang()); });
      if (liveOn()) chips.unshift({ label: t('liveChip', lang()), value: '#live' });
      return out([msg(t('moreSay', lang()), { chips: chips })]);
    }

    /* ---- a person at PFA, live ---- */
    function noOne() {
      S.phase = 'menu'; S.flow = ''; S.live = null;
      return out([msg(t('liveNoOne', lang()), { links: [{ label: lang() === 'hi' ? 'कॉल करें: +91 11 2081 8191' : 'Call +91 11 2081 8191', href: 'tel:+911120818191' }], chips: [{ label: t('liveSendQuery', lang()), value: '#desk' }, { label: t('menuChip', lang()), value: '#menu' }] })]);
    }
    /* the question goes as the first message: the one the site could not
       answer, or what they just wrote */
    function startLive(first) {
      if (!liveOn()) return noOne();
      var own = cleanLong(S.deskQuestion || first || '');
      var text = own || (lang() === 'hi' ? 'मैं PFA में किसी से बात करना चाहता/चाहती हूँ।' : 'I would like to talk to someone at PFA.');
      S.flow = ''; S.phase = 'live'; S.step = 0; S.data = {}; S.addr = null; S.editing = false;
      /* `said` is what they wrote themselves, for the help desk if it comes to that */
      S.live = { state: 'starting', since: now(), seq: 0, said: own ? [own] : [], slowSaid: false, staff: '', away: false };
      var cid0 = cidOf();
      return out([msg(t('liveConnecting', lang()))], { cid: first && !S.deskQuestion ? cid0 : '', action: { id: newId('live'), type: 'live-start', text: text, cid: cid0 } });
    }
    function liveEnd(lead) {
      var l = S.live || {};
      S.live = null; S.phase = 'menu'; S.flow = '';
      var o2 = out([msg(lead || t('liveYouEnded', lang()), { chips: [{ label: t('menuChip', lang()), value: '#menu' }] })]);
      if (l.id) o2.action = { id: newId('live'), type: 'live-end', chat: l.id, token: l.token };
      return o2;
    }
    function hearLive(s, cmd) {
      var l = S.live || {};
      if (s === '#endlive' || cmd === 'cancel' || cmd === 'menu') return liveEnd();
      if (s === '#wait') { l.slowSaid = true; return out([msg(t('liveStillWaiting', lang()))]); }
      if (s === '#desk') {
        /* to the help desk instead: everything they wrote, and the chat ends */
        var q = (l.said || []).join('\n');
        var end = l.id ? { id: newId('live'), type: 'live-end', chat: l.id, token: l.token } : null;
        S.live = null; S.phase = 'menu';
        S.deskQuestion = q; S.deskTopic = '';
        var o3 = begin('helpdesk', q);
        if (end && !o3.action) o3.action = end;
        return o3;
      }
      if (s.charAt(0) === '#') return out([]);
      l.said = (l.said || []).concat([cleanLong(s)]).slice(-8);
      var cid = cidOf();
      return out([], { cid: cid, action: { id: newId('live'), type: 'live-send', text: s, cid: cid } });
    }
    /* each message's own id: a send tried twice is one message */
    function cidOf() { return 'v' + now().toString(36) + Math.random().toString(36).slice(2, 8); }
    /* what the page heard from the chat: started, refused, or news */
    function liveNews(ev) {
      var e = ev || {};
      var l = S.live;
      if (!l || S.phase !== 'live') return out([]);
      if (e.type === 'started') { l.id = e.id; l.token = e.token; l.state = 'waiting'; l.seq = Number(e.seq) || l.seq; return out([]); }
      if (e.type === 'refused') return noOne();
      if (e.type === 'failed') return out([msg(t('liveNotSent', lang()))]);
      if (e.type !== 'news') return out([]);
      var lines = [];
      if (e.status !== 'waiting' && l.state === 'waiting' && e.staff) { l.state = 'open'; l.staff = e.staff; l.away = false; lines.push(msg(t('liveJoined', lang(), { name: e.staff }))); }
      /* someone else took it over */
      else if (e.status === 'open' && l.state === 'open' && e.staff && l.staff && e.staff !== l.staff) { l.staff = e.staff; l.away = false; lines.push(msg(t('liveTookOver', lang(), { name: e.staff }))); }
      (e.messages || []).forEach(function (m) {
        if (m.n <= l.seq) return;
        if (m.from === 'staff') lines.push(msg(m.text, { from: m.name || 'PFA' }));
      });
      l.seq = Math.max(l.seq, Number(e.seq) || 0);
      /* the person answering went offline, or came back: said at once */
      if (e.status === 'open' && l.state === 'open' && l.staff && e.status !== 'closed') {
        if (e.staffOnline === false && !l.away) { l.away = true; lines.push(msg(t('liveGone', lang(), { name: l.staff }), { chips: [{ label: t('liveSendQuery', lang()), value: '#desk' }, { label: t('endChat', lang()), value: '#endlive' }] })); }
        else if (e.staffOnline === true && l.away) { l.away = false; lines.push(msg(t('liveBack', lang(), { name: l.staff }))); }
      }
      if (e.status === 'closed') {
        if (e.closedBy === 'visitor') { S.live = null; S.phase = 'menu'; return out(lines); }
        var ended = liveEnd(e.closedBy === 'staff' && l.staff ? t('liveEnded', lang(), { name: l.staff }) : t('liveClosed', lang()));
        ended.action = null;
        ended.messages = lines.concat(ended.messages);
        return ended;
      }
      if (l.state === 'waiting' && !l.slowSaid && (e.online === false || now() - l.since > 3 * 60000)) {
        l.slowSaid = true;
        lines.push(msg(t('liveSlow', lang()), { chips: [{ label: t('liveKeepWaiting', lang()), value: '#wait' }, { label: t('liveSendQuery', lang()), value: '#desk' }] }));
      }
      return out(lines);
    }

    /* ---- starting something ---- */
    function begin(id, firstText) {
      if (PAGES[id]) {
        var p = PAGES[id];
        return out([msg(L(p.say, lang()), { links: [{ label: L(p.title, lang()), href: p.href }], chips: [{ label: t('menuChip', lang()), value: '#menu' }] })]);
      }
      if (INFO[id]) {
        S.deskQuestion = firstText || ''; S.deskTopic = INFO[id].topic;
        S.phase = 'menu';
        return out([msg(t('looking', lang()))], { action: { id: newId('search'), type: 'search', q: N.searchText(firstText || INFO[id].q) || INFO[id].q, topic: INFO[id].topic, question: firstText || '' } });
      }
      var f = FLOWS[id];
      if (!f) return menu(false);
      S.flow = id; S.step = 0; S.phase = 'ask'; S.editing = false; S.addr = null; S.photosAsked = false; photos = [];
      if (id !== 'helpdesk' || !firstText) S.data = {};
      if (id === 'helpdesk' && firstText) S.data = { question: cleanLong(firstText) };
      if (firstText) prefill(firstText);
      var lead = [];
      if (f.intro) lead.push(msg(L(f.intro, lang())));
      if (f.urgent && (S.data.urgency === 'Happening now' || !S.data.urgency)) lead.push(msg(t('urgent', lang())));
      return ask(lead);
    }

    /* what the first message already said */
    function prefill(text) {
      var e = N.entitiesOf(text);
      var fields = FLOWS[S.flow].fields.map(function (k) { return keyOf(k); });
      var has = function (k) { return fields.indexOf(k) > -1; };
      if (e.mobile && has('mobile')) S.data.mobile = e.mobile;
      if (e.email && has('email')) S.data.email = e.email;
      if (e.name && has('name')) S.data.name = e.name;
      if (e.reference && has('reference')) S.data.reference = e.reference;
      if (e.reference && has('application') && /^PFA-VI-/i.test(e.reference)) S.data.application = e.reference;
      if (e.email && has('contact')) S.data.contact = e.email;
      else if (e.mobile && has('contact')) S.data.contact = e.mobile;
      if (e.pin && has('place')) S.data.place = e.pin;
      if (e.pin && has('address')) S.addr = { pin: e.pin, step: 'pinLookup' };
      if (S.flow === 'report') {
        if (e.animal) S.data.animal = e.animal;
        if (e.urgency) S.data.urgency = e.urgency;
        /* the account, without the number or email that came with it */
        var told = String(text).replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, ' ')
          .replace(/(?:\+?91[\s\-]?|\b0)?[6-9](?:[\s\-]?\d){9}(?!\d)/g, ' ')
          .replace(/\b(?:my (?:mobile|phone)?\s*(?:number|no\.?)\s*(?:is)?|mera (?:mobile |phone )?(?:number|no)|mob(?:ile)?|ph(?:one)?)\s*[:\-]?\s*(?=[,.\s]|$)/gi, ' ')
          .replace(/\s*[,;]\s*(?=[,;]|$)/g, '').replace(/\s+/g, ' ').replace(/[\s,;]+$/, '').trim();
        if (N.tokens(told).length >= 5) S.data.what = cleanLong(told);
      }
      if (S.flow === 'donate') {
        var a = N.amountOf(text, true);
        if (a && a >= 1 && String(Math.round(a)) !== e.pin && String(a).length < 9) S.data.amount = String(a);
        var cause = N.choiceOf(text, O.cause.filter(function (x) { return x.value !== 'Where it is needed most'; }));
        if (cause) S.data.cause = cause;
        if (monthlyOn()) { var often = N.choiceOf(text, O.often.filter(function (x) { return x.value === 'monthly'; })); if (often) S.data.frequency = often; }
      }
      if (S.flow === 'wallstory') {
        var wl = linksIn(text);
        if (wl.length) S.data.url = wl[0];
      }
      if (S.flow === 'verify') {
        var vn = certOf(text);
        if (vn) S.data.certno = vn;
      }
      if (S.flow === 'member') {
        var tier = N.choiceOf(text, O.tier.map(function (x) { return Object.assign({}, x, { syn: [x.value] }); }));
        if (tier) S.data.tier = tier;
      }
      if (S.flow === 'volunteer') {
        var area = N.choiceOf(text, O.areas);
        if (area) S.data.areas = [area];
      }
    }

    /* ---- asking ---- */
    function keyOf(fid) { return (F[fid] && F[fid].key) || fid; }
    function fieldIds() {
      /* the terms are not a question of their own: they sit under the
         summary, so they are agreed to with the details in view */
      var list = FLOWS[S.flow].fields.filter(function (x) { return F[x].type !== 'consent'; });
      /* the parent's agreement only for 16 and 17 */
      if (S.flow === 'donate' && !monthlyOn()) list = list.filter(function (x) { return x !== 'often'; });
      if (S.flow === 'internship') {
        var age = N.ageOn(S.data.dob, now());
        if (!(age === 16 || age === 17)) list = list.filter(function (x) { return x !== 'parent'; });
      }
      /* a mobile becomes needed when someone asks to be phoned */
      if (S.flow === 'legacy' && S.data.contactBy === 'Phone') list = list.map(function (x) { return x === 'mobileOpt' ? 'mobile' : x; });
      return list;
    }
    function fieldNow() { var id = fieldIds()[S.step]; return id ? Object.assign({ id: id }, F[id]) : null; }
    function answered(fid) {
      var f = F[fid];
      var k = keyOf(fid);
      if (f.type === 'address') return Boolean(S.data.pincode && S.data.address && S.data.city && S.data.state);
      if (f.type === 'photos') return S.photosAsked;
      if (f.optional) return Object.prototype.hasOwnProperty.call(S.data, k);
      var v = S.data[k];
      return Array.isArray(v) ? v.length > 0 : v != null && String(v) !== '';
    }

    /* the next question not yet answered; the summary once all are */
    function ask(lead) {
      var ids = fieldIds();
      if (S.editing) return summary(lead);
      while (S.step < ids.length && answered(ids[S.step])) S.step += 1;
      if (S.step >= ids.length) return summary(lead);
      S.phase = 'ask';
      var f = Object.assign({ id: ids[S.step] }, F[ids[S.step]]);
      if (f.type === 'address') return askAddress(lead || []);
      return out((lead || []).concat([question(f)]));
    }
    function question(f) {
      var m = msg(L(f.ask, lang()) + (f.optional && f.type !== 'photos' ? ' ' + t('optional', lang()) : ''));
      var chips = [];
      if (f.type === 'choice' || f.type === 'amount') chips = f.options.map(function (op) { return { label: L(op, lang()) || op.value, value: op.value }; });
      if (f.type === 'multi') {
        var picked = S.data[keyOf(f.id)] || [];
        chips = f.options.map(function (op) { return { label: L(op, lang()) || op.value, value: op.value, on: picked.indexOf(op.value) > -1 }; }).concat([{ label: t('done', lang()), value: '#done' }]);
      }
      if (f.type === 'yesno' || f.type === 'consent') chips = [{ label: t('yes', lang()), value: 'yes' }, { label: t('no', lang()), value: 'no' }];
      if (f.optional) chips.push({ label: t('skipWord', lang()), value: '#skip' });
      if (chips.length) m.chips = chips;
      if (f.link) m.links = [{ label: f.id === 'donateTerms' ? (lang() === 'hi' ? 'दान का पेज' : 'The donation page') : f.type === 'consent' ? t('readTerms', lang()) : t('readGuide', lang()), href: f.link }];
      if (f.type === 'photos') m.attach = true;
      return m;
    }

    /* ---- the address, in its own steps: PIN, then the place it names,
       the town, the house and the street ---- */
    function askAddress(lead) {
      var A = S.addr || (S.addr = { step: 'pin' });
      var f = fieldNow();
      if (A.step === 'pin') return out(lead.concat([msg(L(f.ask, lang()))]));
      if (A.step === 'pinLookup') { A.step = 'waiting'; return out(lead.concat([msg(t('looking', lang()))]), { action: { id: newId('pin'), type: 'pin', pin: A.pin } }); }
      if (A.step === 'state') return out(lead.concat([msg(lang() === 'hi' ? 'कौन सा राज्य?' : 'Which state?')]));
      if (A.step === 'district') {
        var d = A.districts || [];
        return out(lead.concat([msg(t('pickDistrict', lang()), d.length ? { chips: d.slice(0, 8).map(function (x) { return { label: x, value: x }; }) } : {})]));
      }
      if (A.step === 'city') {
        var places = [A.district].concat(A.places || []).filter(Boolean).filter(function (x, i, all) { return all.indexOf(x) === i; }).slice(0, 5);
        var ask = lang() === 'hi' ? 'आपका शहर, कस्बा या गाँव?' : 'Which town, city or village?';
        if (S.flow === 'report' && f.id === 'where') ask = lang() === 'hi' ? 'किस शहर, कस्बे या गाँव में?' : 'In which town, city or village?';
        return out(lead.concat([msg(ask, places.length ? { chips: places.map(function (x) { return { label: x, value: x }; }) } : {})]));
      }
      if (A.step === 'house') {
        var h = S.flow === 'report' && f.id === 'where'
          ? (lang() === 'hi' ? 'सही जगह: मकान या दुकान का नंबर, या कोई पहचान वाली जगह?' : 'The exact spot: a house or shop number, or a landmark?')
          : (lang() === 'hi' ? 'मकान, फ़्लैट या बिल्डिंग का नंबर?' : 'Your house, flat or building number?');
        return out(lead.concat([msg(h)]));
      }
      if (A.step === 'street') return out(lead.concat([msg(lang() === 'hi' ? 'गली और इलाके का नाम?' : 'The street and area?')]));
      return out(lead);
    }
    function hearAddress(text) {
      var A = S.addr || (S.addr = { step: 'pin' });
      var s = String(text || '').trim();
      if (A.step === 'pin' || A.step === 'waiting') {
        var pin = N.pinOf(s);
        if (!pin) return out([msg(lang() === 'hi' ? 'PIN कोड 6 अंकों का होता है, जैसे 110001।' : 'A PIN code is 6 digits, like 110001.')]);
        A.pin = pin; A.step = 'pinLookup';
        return askAddress([]);
      }
      if (A.step === 'state') { A.state = s.replace(/\s+/g, ' '); A.step = 'district'; return askAddress([]); }
      if (A.step === 'district') {
        var list = A.districts || [];
        var hit = list.length ? N.choiceOf(s, list.map(function (x) { return { value: x }; })) : '';
        A.district = hit || s.replace(/\s+/g, ' ');
        A.step = 'city'; return askAddress([]);
      }
      if (A.step === 'city') {
        if (s.length < 2) return askAddress([]);
        A.city = s.replace(/\s+/g, ' ');
        /* the town put right after the server named it: the house and street stand */
        if (A.house && A.street) return finishAddress();
        A.step = 'house'; return askAddress([]);
      }
      if (A.step === 'house') {
        if (s.length < 1) return askAddress([]);
        A.house = s;
        A.step = 'street'; return askAddress([]);
      }
      if (A.step === 'street') {
        if (!/\p{L}.*\p{L}/u.test(s)) return out([msg(lang() === 'hi' ? 'गली या इलाके का नाम लिखें, सिर्फ़ अंक नहीं।' : 'Please give the street or area by name, not just numbers.')]);
        A.street = s;
        return finishAddress();
      }
      return askAddress([]);
    }
    function finishAddress() {
      var A = S.addr;
      var line = [A.house, A.street].filter(Boolean).join(', ');
      Object.assign(S.data, { pincode: A.pin, state: A.state || '', district: A.district || '', city: A.city || '', address: line, house: A.house, street: A.street });
      S.addr = null;
      S.step += 1;
      return ask([]);
    }
    function addressDone(result) {
      var A = S.addr || (S.addr = {});
      if (result && result.bad) { A.step = 'pin'; return askAddressWith(t('pinBad', lang())); }
      if (result && result.state) {
        A.state = result.state;
        A.districts = result.districts || [];
        A.places = result.places || [];
        if (A.districts.length === 1) { A.district = A.districts[0]; A.step = 'city'; return askAddress([msg(t('pinIs', lang(), { pin: A.pin, district: A.district, state: A.state }))]); }
        A.step = A.districts.length ? 'district' : 'city';
        return askAddress([msg((lang() === 'hi' ? 'PIN {pin} ' + A.state + ' में है।' : 'PIN {pin} is in ' + A.state + '.').replace('{pin}', A.pin))]);
      }
      A.step = 'state';
      return askAddress([msg(t('pinUnknown', lang()))]);
    }
    function askAddressWith(text) { return out([msg(text), msg(L(fieldNow().ask, lang()))]); }

    /* ---- a word in passing, while a question waits (owner, 15 Nov 2026:
       "how is it that the bot doesnt even understand ok..it should give
       sensible and approp response") ----
       "ok", "sure", "thanks" or "hello" is not the answer to a question
       that wants a number, a name or a few words: it is heard as what it
       is and the question is put again, kindly, in a line. "I don't have
       it" to a number gets where to find it and what else can be done. A
       question that wants yes or no, or one of its choices, still takes
       "ok" as its answer. */
    var ACK = /^(ok|okay|okk|okey|k|kk|sure|yes|yeah|yep|yup|fine|alright|all right|cool|hmm+|got it|right|haan|han|ha|haa|ji|hanji|theek|thik|theek hai|thik hai|accha|acha|achha|हाँ|हां|जी|ठीक|ठीक है|अच्छा)$/;
    var THANKS = /^(thanks|thank you|thank u|thanku|thx|ty|dhanyavad|dhanyawad|shukriya|धन्यवाद|शुक्रिया)( (so much|a lot|ji))?$/;
    var HELLO = /^(hi|hii|hello|hey|namaste|namaskar|नमस्ते|नमस्कार)$/;
    var LOST = /^(no|nope|nahi|nahin|na|no number|i (don'?t|do not|dont) have( it| one| the number)?|(don'?t|dont|do not) have( it| one| the number)?|(i )?lost( it)?|(i )?forgot( it)?|(i )?(don'?t|dont|do not) know|no idea|not sure|pata nahi|pta nahi|nahi pata|nahi hai|mere paas nahi( hai)?|नहीं|नहीं है|पता नहीं|नहीं पता|मेरे पास नहीं है)$/;
    function aside(text, f) {
      if (/^(yesno|consent|choice|multi|photos|address)$/.test(f.type) || (S.addr && S.addr.step !== 'pin')) return null;
      var n = N.normalise(text).replace(/[.!?,]+$/, '').replace(/\s+/g, ' ').trim();
      var hi = lang() === 'hi';
      var numberAsked = f.type === 'reference' || f.type === 'certno';
      if (numberAsked && LOST.test(n)) {
        var where = f.type === 'reference'
          ? (hi ? 'कोई बात नहीं। यह नंबर उस ईमेल में है जो PFA ने आपको भेजते समय भेजा था। न मिले, तो आप PFA की हेल्प डेस्क से पूछ सकते हैं।' : 'That is all right. The number is in the email PFA sent you when you sent it in. If you cannot find it, you can ask PFA\'s help desk instead.')
          : (hi ? 'कोई बात नहीं। नंबर प्रमाणपत्र या कार्ड पर छपा है, और उस ईमेल में है जिसके साथ वह आया था।' : 'That is all right. The number is printed on the certificate or card, and in the email it came with.');
        var chips = f.type === 'reference' ? [{ label: titleOf('helpdesk', lang()), value: '#helpdesk' }, { label: t('menuChip', lang()), value: '#menu' }] : [{ label: t('menuChip', lang()), value: '#menu' }];
        return out([msg(where, { chips: chips })]);
      }
      var lead = THANKS.test(n) ? (hi ? 'आपका स्वागत है।' : 'You are welcome.')
        : HELLO.test(n) ? (hi ? 'नमस्ते।' : 'Hello.')
        : ACK.test(n) ? (hi ? 'ठीक है।' : 'Sure.') : '';
      if (!lead) return null;
      if (f.type === 'reference') return out([msg(lead + ' ' + (hi ? 'जब तैयार हों, नंबर लिखें। यह उस ईमेल में है जो PFA ने भेजा था, जैसे PFA-CR-2026-00012।' : 'Type the number when you have it. It is in the email PFA sent you, and reads like PFA-CR-2026-00012.'))]);
      if (f.type === 'certno') return out([msg(lead + ' ' + (hi ? 'जब तैयार हों, नंबर लिखें, जैसे PFA-INT-AB2CD3EF या PFA-CCT-AB2CD3EF।' : 'Type the number when you have it. It reads like PFA-INT-AB2CD3EF or PFA-CCT-AB2CD3EF.'))]);
      return out([msg(lead), question(f)]);
    }

    /* ---- hearing an answer to the question asked ---- */
    function hearField(text) {
      var f = fieldNow();
      if (!f) return ask([]);
      var k = keyOf(f.id);
      var s = String(text || '').trim();
      if (f.type === 'address') return hearAddress(s);
      var bad = function (en, hi) { return out([msg(lang() === 'hi' ? hi : en)].concat(f.type === 'choice' || f.type === 'yesno' || f.type === 'consent' || f.type === 'multi' || f.type === 'amount' ? [question(f)] : [])); };
      switch (f.type) {
        case 'name': {
          var n = N.nameOf(s, true);
          if (!n || n.replace(/\s/g, '').length < 2) return bad('Please give your full name, in letters.', 'कृपया अपना पूरा नाम अक्षरों में लिखें।');
          S.data[k] = n; break;
        }
        case 'mobile': {
          var m = N.mobileOf(s);
          if (!m) return bad('That does not look like a 10-digit Indian mobile number.', 'यह 10 अंकों का भारतीय मोबाइल नंबर नहीं लगता।');
          S.data[k] = m; break;
        }
        case 'email': {
          var e = N.emailOf(s);
          if (!e) return bad('That does not look like an email address. It reads like name@example.com.', 'यह ईमेल पता नहीं लगता। जैसे name@example.com।');
          S.data[k] = e; break;
        }
        case 'text': {
          if (s.length < 2) return bad('A few words, please.', 'कृपया कुछ शब्द लिखें।');
          S.data[k] = s.slice(0, 300); break;
        }
        case 'long': {
          if (s.length < (f.min || 2)) return bad('A little more, please: a sentence or two.', 'थोड़ा और लिखें: एक या दो वाक्य।');
          S.data[k] = cleanLong(s); break;
        }
        case 'choice': {
          var c = N.choiceOf(s, f.options);
          if (!c) return bad('Please choose one of these.', 'कृपया इनमें से एक चुनें।');
          S.data[k] = c; break;
        }
        case 'multi': {
          var list = S.data[k] || [];
          if (s === '#done' || N.yesNoOf(s) === true || /^(done|that'?s all|bas|ho gaya|हो गया|बस)$/i.test(N.normalise(s))) {
            if (!list.length) return bad('Choose at least one.', 'कम से कम एक चुनें।');
            break;
          }
          var hits = f.options.filter(function (op) { return N.choiceOf(s, [op]); }).map(function (op) { return op.value; });
          if (!hits.length) { var one = N.choiceOf(s, f.options); if (one) hits = [one]; }
          if (!hits.length) return bad('Please choose from these.', 'कृपया इनमें से चुनें।');
          hits.forEach(function (h) { var i = list.indexOf(h); if (i > -1 && hits.length === 1) list.splice(i, 1); else if (i < 0) list.push(h); });
          S.data[k] = list;
          return out([question(f)]);
        }
        case 'date': {
          var d = N.dateOf(s);
          if (!d) return bad('Please give the date like 14/05/2004.', 'कृपया तारीख ऐसे लिखें: 14/05/2004।');
          var age = N.ageOn(d, now());
          if (age == null || age < 0 || age > 100) return bad('Please check the date.', 'कृपया तारीख जाँचें।');
          if (S.flow === 'internship' && age < 16) { S.flow = ''; S.phase = 'menu'; return out([msg(t('tooYoung', lang()), { chips: [{ label: t('menuChip', lang()), value: '#menu' }] })]); }
          S.data[k] = d; break;
        }
        case 'yesno': case 'consent': {
          var y = N.yesNoOf(s);
          if (y === null) return bad('Yes or no?', 'हाँ या नहीं?');
          if (!y && (f.must || f.type === 'consent')) {
            if (f.id === 'parent') { S.flow = ''; S.phase = 'menu'; return out([msg(lang() === 'hi' ? 'माता-पिता या अभिभावक की सहमति के बाद फिर से आवेदन करें।' : 'Please apply once a parent or guardian has agreed.', { chips: [{ label: t('menuChip', lang()), value: '#menu' }] })]); }
            return out([msg(f.type === 'consent' ? (lang() === 'hi' ? 'शर्तें माने बिना भुगतान शुरू नहीं हो सकता। पढ़कर बताएँ।' : 'The payment cannot start without the terms. Read them and tell me.') : (lang() === 'hi' ? 'पढ़ने के बाद बताएँ।' : 'Tell me once you have read it.')), question(f)]);
          }
          S.data[k] = f.type === 'consent' ? 'yes' : y ? 'Yes' : 'No'; break;
        }
        case 'amount': {
          var a = N.amountOf(s, true);
          if (!a || a < 1 || a > 10000000) return bad('Please give an amount in rupees, like 1000.', 'कृपया रुपयों में राशि लिखें, जैसे 1000।');
          S.data[k] = String(a); break;
        }
        case 'photos': {
          S.photosAsked = true; break;
        }
        case 'reference': {
          var r = N.referenceOf(s);
          if (!r) return bad('That does not look like a PFA number. It reads like PFA-CR-2026-00012.', 'यह PFA नंबर नहीं लगता। जैसे PFA-CR-2026-00012।');
          S.data[k] = r; break;
        }
        case 'contact': {
          var ce = N.emailOf(s) || N.mobileOf(s);
          if (!ce) return bad('Please give the email or the 10-digit mobile you gave with it.', 'कृपया उसके साथ दिया गया ईमेल या 10 अंकों का मोबाइल लिखें।');
          S.data[k] = ce; break;
        }
        case 'url': {
          var urls = linksIn(s);
          if (f.hosts) urls = urls.filter(function (u) { return f.hosts.some(function (h) { return hostOf(u) === h || hostOf(u).slice(-(h.length + 1)) === '.' + h; }); });
          if (!urls.length) return bad(f.hosts ? 'Please paste the full link to a public post on Instagram, Facebook, YouTube or Vimeo. It starts with https://' : 'Please paste the full link. It starts with https://', f.hosts ? 'कृपया Instagram, Facebook, YouTube या Vimeo की सार्वजनिक पोस्ट का पूरा लिंक डालें। यह https:// से शुरू होता है।' : 'कृपया पूरा लिंक डालें। यह https:// से शुरू होता है।');
          S.data[k] = f.many ? urls.slice(0, 10).join('\n') : urls[0]; break;
        }
        case 'certno': {
          var cn = certOf(s);
          if (!cn) return bad('That does not look like a PFA certificate or card number. They read like PFA-INT-AB2CD3EF or PFA-CCT-AB2CD3EF.', 'यह PFA प्रमाणपत्र या कार्ड नंबर नहीं लगता। जैसे PFA-INT-AB2CD3EF या PFA-CCT-AB2CD3EF।');
          S.data[k] = cn; break;
        }
        case 'place': {
          if (s.length < 3) return bad('A PIN code or the name of your town, please.', 'कृपया PIN कोड या अपने शहर का नाम लिखें।');
          S.data[k] = N.pinOf(s) || s; break;
        }
      }
      S.step += 1;
      return ask([]);
    }

    /* links in what was typed: the full https:// address, or a bare one like
       instagram.com/p/xyz, which is given its https:// */
    function linksIn(text) {
      var found = String(text || '').match(/(?:https?:\/\/|www\.|\b(?:[a-z0-9-]+\.)+(?:com|be|watch|org|in|net|co|me|ly|gl|app|io)\/)[^\s<>"',]*/gi) || [];
      return found.map(function (u) { u = u.replace(/[).;:!?]+$/, ''); return /^https?:\/\//i.test(u) ? u : 'https://' + u; })
        .filter(function (u, i, all) { return all.indexOf(u) === i && hostOf(u).indexOf('.') > 0; });
    }
    function hostOf(u) { var m = /^https?:\/\/([^\/?#:]+)/i.exec(u); return m ? m[1].toLowerCase().replace(/^www\.|^m\./, '') : ''; }
    /* PFA-INT-XXXXXXXX (an internship certificate; PFA-VOL-, PFA-PAR-, PFA-REC-
       and PFA-DNR- the other purposes, 15 Nov 2026) or PFA-CCT-XXXXXXXX (a
       colony caregiver card) */
    function certOf(text) {
      var m = /PFA[\s-]*(INT|VOL|PAR|REC|DNR|CCT|MBR)[\s-]*([A-Z0-9]{8})\b/i.exec(String(text || ''));
      return m ? 'PFA-' + m[1].toUpperCase() + '-' + m[2].toUpperCase() : '';
    }

    /* ---- the summary, and changing one answer ---- */
    function shown(fid) {
      var f = F[fid];
      var k = keyOf(fid);
      if (f.type === 'address') return [S.data.address, S.data.city, S.data.district, S.data.state, S.data.pincode].filter(Boolean).filter(function (x, i, all) { return all.indexOf(x) === i; }).join(', ');
      if (f.type === 'photos') return photos.length ? (lang() === 'hi' ? photos.length + ' फ़ोटो' : photos.length + ' attached') : (lang() === 'hi' ? 'नहीं' : 'None');
      var v = S.data[k];
      if (v == null || v === '') return lang() === 'hi' ? 'नहीं दिया' : 'Not given';
      if (Array.isArray(v)) return v.map(function (x) { return optionLabel(f, x); }).join(', ');
      if (f.type === 'choice' || f.type === 'amount') return optionLabel(f, v);
      if (f.type === 'consent') return lang() === 'hi' ? 'माना' : 'Accepted';
      if (f.type === 'yesno') return v === 'Yes' ? t('yes', lang()) : t('no', lang());
      if (f.type === 'date') return v.split('-').reverse().join('/');
      return String(v);
    }
    function optionLabel(f, v) {
      var op = (f.options || []).filter(function (x) { return x.value === v; })[0];
      if (f.type === 'amount' || f.id === 'amount') return '₹' + Number(v).toLocaleString('en-IN');
      return op ? (L(op, lang()) || op.value) : String(v);
    }
    function summary(lead) {
      S.phase = 'summary'; S.editing = false;
      var flow = FLOWS[S.flow];
      if (flow.look) return lookUp();
      var rows = fieldIds().filter(function (id) { return F[id].type !== 'consent'; }).map(function (id) { return [L(F[id].label, lang()), shown(id)]; });
      var go = flow.pay ? t(S.flow === 'donate' && S.data.frequency === 'monthly' && monthlyOn() ? 'payMonthly' : 'payNow', lang(), { amount: '₹' + Number(payAmount()).toLocaleString('en-IN') }) : t('send', lang());
      var chips = [{ label: go, value: '#send' }, { label: t('change', lang()), value: '#change' }, { label: t('cancel', lang()), value: '#cancel' }];
      var terms = flow.fields.map(function (id) { return F[id]; }).filter(function (f) { return f.type === 'consent'; })[0];
      if (!terms) return out((lead || []).concat([msg(t('checkTitle', lang()) + ' ' + L(flow.title, lang()), { list: rows, chips: chips })]));
      /* the details first, then what paying agrees to, then the button */
      return out((lead || []).concat([
        msg(t('checkTitle', lang()) + ' ' + L(flow.title, lang()), { list: rows }),
        msg(L(terms.agree, lang()), { links: [{ label: terms.link === 'donate.html' ? (lang() === 'hi' ? 'दान का पेज' : 'The donation page') : t('readTerms', lang()), href: terms.link }], chips: chips })
      ]));
    }
    function payAmount() {
      if (S.flow === 'member') { var tier = O.tier.filter(function (x) { return x.value === S.data.tier; })[0]; return tier ? tier.amount : 0; }
      return Number(S.data.amount || 0);
    }
    function changeMenu() {
      S.phase = 'change';
      var chips = fieldIds().filter(function (id) { return F[id].type !== 'consent'; }).map(function (id) { return { label: L(F[id].label, lang()), value: '@' + id }; });
      return out([msg(t('whichChange', lang()), { chips: chips })]);
    }
    function changeField(id) {
      var ids = fieldIds();
      var i = ids.indexOf(id);
      if (i < 0) return summary([]);
      var f = F[id];
      var k = keyOf(id);
      if (f.type === 'address') { ['pincode', 'state', 'district', 'city', 'address', 'house', 'street'].forEach(function (x) { delete S.data[x]; }); S.addr = { step: 'pin' }; }
      else if (f.type === 'photos') { S.photosAsked = false; photos = []; }
      else delete S.data[k];
      S.step = i; S.phase = 'ask';
      var lead = [];
      var out1 = ask(lead);
      S.editing = true;
      return out1;
    }

    /* ---- sending and looking up ---- */
    var counter = 0;
    function newId(type) { counter += 1; S.pending = 'a' + now() + '-' + counter; S.pendingType = type || ''; return S.pending; }

    function dataFor() {
      var d = {};
      var flow = FLOWS[S.flow];
      fieldIds().forEach(function (id) {
        var f = F[id];
        var k = keyOf(id);
        if (f.type === 'address' || f.type === 'photos' || f.type === 'consent') return;
        if (S.data[k] != null && S.data[k] !== '') d[k] = S.data[k];
      });
      ['address', 'pincode', 'city', 'state', 'district'].forEach(function (x) { if (S.data[x]) d[x] = S.data[x]; });
      if (S.flow === 'volunteer') {
        d.title = 'Volunteer: ' + (S.data.areas || []).join(', ');
        delete d.areas;
        d.notes = (S.data.when ? 'Free: ' + S.data.when + '. ' : '') + (S.data.notes || '');
        delete d.when;
      }
      if (S.flow === 'internship') {
        d.age = String(N.ageOn(S.data.dob, now()) || '');
        d.guide = 'Read and understood';
        d.parent = d.parent === 'Yes' ? 'Yes' : '';
      }
      d.via = 'Assistant';
      return { kind: flow.kind, data: d };
    }

    function send() {
      var flow = FLOWS[S.flow];
      S.phase = 'waiting';
      if (flow.pay) {
        var fields = { type: flow.pay, currency: 'inr', name: S.data.name, mobile: S.data.mobile, email: S.data.email,
          address: S.data.address, house: S.data.house, street: S.data.street, pincode: S.data.pincode, city: S.data.city, state: S.data.state, district: S.data.district, terms: 'yes' };
        if (flow.pay === 'donate') {
          fields.amount = String(Number(S.data.amount)); fields.cause = S.data.cause;
          fields.frequency = S.data.frequency === 'monthly' && monthlyOn() ? 'monthly' : 'once';
        }
        if (flow.pay === 'membership') fields.tier = S.data.tier;
        return out([msg(t('paying', lang()))], { action: { id: newId('pay'), type: 'pay', fields: fields } });
      }
      var x = dataFor();
      return out([msg(t('sending', lang()))], { action: { id: newId('submit'), type: 'submit', kind: x.kind, data: x.data, photos: photos.slice() } });
    }

    function lookUp() {
      var flow = FLOWS[S.flow];
      S.phase = 'waiting';
      if (flow.look === 'track') return out([msg(t('looking', lang()))], { action: { id: newId('track'), type: 'track', reference: S.data.reference, contact: S.data.contact } });
      if (flow.look === 'receipt') return out([msg(t('looking', lang()))], { action: { id: newId('receipt'), type: 'receipt', email: S.data.email, mobile: S.data.mobile } });
      if (flow.look === 'verify') return out([msg(t('looking', lang()))], { action: { id: newId('verify'), type: 'verify', number: S.data.certno } });
      return out([msg(t('looking', lang()))], { action: { id: newId('nearby'), type: 'nearby', place: S.data.place } });
    }

    /* the page reports back */
    function done(id, result) {
      if (!S.pending || id !== S.pending) return out([]);
      var type = S.pendingType;
      S.pending = null; S.pendingType = '';
      var r = result || {};
      if (type === 'pin') return addressDone(r);
      if (type === 'search') return searchDone(r);
      var flow = FLOWS[S.flow] || {};
      var after = [{ label: t('menuChip', lang()), value: '#menu' }];
      if (flow.look === 'track') {
        S.phase = 'menu';
        if (!r.ok) return out([msg(r.message || t('noMatch', lang()), { chips: [{ label: titleOf('track', lang()), value: '#track' }].concat(after) })]);
        var when = r.updatedAt ? ' ' + t('statusWhen', lang(), { when: dayOf(r.updatedAt) }) : '';
        return out([msg(t('status', lang(), { ref: r.reference, kind: r.kindLabel || '', status: r.statusLabel || '', next: r.next || '' }) + when, { links: [{ label: t('follow', lang()), href: 'track.html#ref=' + encodeURIComponent(r.reference) }], chips: after })]);
      }
      if (flow.look === 'receipt') {
        S.phase = 'menu';
        return out([msg(r.ok ? t('receiptSent', lang()) : (r.message || t('tryLater', lang())), { chips: after })]);
      }
      if (flow.look === 'verify') {
        S.phase = 'menu';
        var no = S.data.certno || r.number || r.cardId || '';
        var cert = /^PFA-(INT|VOL|PAR|REC|DNR)-/.test(no);
        var check = cert ? [{ label: t('verifyPage', lang()), href: 'verify-certificate.html?n=' + encodeURIComponent(no) }] : [];
        if (r.found && cert) return out([msg(r.withdrawn ? t('certWithdrawn', lang(), { no: no, name: r.name, on: dayOf(r.withdrawnOn) })
          : /^PFA-INT-/.test(no) ? t('certGood', lang(), { no: no, name: r.name, issued: dayOf(r.issuedOn), from: dayOf(r.startDate), to: dayOf(r.endDate) })
          : t('certOther', lang(), { no: no, name: r.name, issued: dayOf(r.issuedOn), title: String(r.title || '').toLowerCase(), about: r.about || r.line || '' }), { links: check, chips: after })]);
        if (r.found && r.kind === 'member') return out([msg(t(r.valid ? 'memberGood' : 'memberOld', lang(), { no: r.number || no, name: r.name, until: lang() === 'hi' ? (r.lifetime ? 'आजीवन मान्य' : dayOf(r.validUntil) + ' तक मान्य') : (r.lifetime ? 'for life' : 'until ' + dayOf(r.validUntil)) }), { links: r.url ? [{ label: t('seeCard', lang()), href: 'card.html?id=' + encodeURIComponent(no) }] : [], chips: after })]);
        if (r.found) return out([msg(t(r.valid ? 'cardGood' : 'cardOld', lang(), { no: no, name: r.name, until: dayOf(r.validUntil) }), { links: r.url ? [{ label: t('seeCard', lang()), href: 'card.html?id=' + encodeURIComponent(no) }] : [], chips: after })]);
        return out([msg(r.notFound ? t('verifyNone', lang()) : (r.message || t('tryLater', lang())), { chips: [chip('verify', lang())].concat(after) })]);
      }
      if (flow.look === 'nearby') {
        S.phase = 'menu';
        var units = r.units || [];
        if (!units.length) return out([msg(t('noUnits', lang()), { links: [{ label: t('callHq', lang()), href: 'tel:+911120818191' }, { label: t('allUnits', lang()), href: 'units.html' }], chips: [chip('report', lang())].concat(after) })]);
        return out([msg(t('unitsNear', lang(), { place: r.place || S.data.place }), { list: units.map(function (u) { return [u.title, u.detail || '']; }), links: units.map(function (u) { return u.phone ? { label: (lang() === 'hi' ? 'कॉल करें: ' : 'Call ') + u.title, href: 'tel:' + String(u.phone).split('(')[0].replace(/[^\d+]/g, '') } : null; }).filter(Boolean).concat([{ label: t('allUnits', lang()), href: 'units.html' }]), chips: [chip('report', lang())].concat(after) }), msg(t('urgent', lang()))]);
      }
      /* a form sent */
      if (r.ok && r.reference) {
        var flowId = S.flow;
        S.phase = 'menu'; S.flow = '';
        var lines = [msg(t('sent', lang(), { ref: r.reference }), { links: [{ label: t('follow', lang()), href: 'track.html#ref=' + encodeURIComponent(r.reference) }] })];
        var mailKey = { sent: 'mailSent', queued: 'mailQueued', unsent: 'mailUnsent' }[r.mail];
        if (mailKey && r.to) lines.push(msg(t(mailKey, lang(), { to: r.to })));
        if (flowId === 'internship' && r.started) lines.push(msg(t('startedIntern', lang()), { links: [{ label: t('startIntern', lang()), href: 'intern.html' }] }));
        if (flowId === 'report') lines.push(msg(t('urgent', lang()), { chips: [chip('nearby', lang())].concat(after) }));
        else lines[lines.length - 1].chips = after;
        photos = [];
        return out(lines);
      }
      /* refused: back to the answer the server named */
      if (r.fields && r.fields.length) return fixFrom(r.fields);
      S.phase = 'summary';
      return out([msg(r.message ? t('notSent', lang(), { why: r.message }) : t('tryLater', lang()), { chips: [{ label: t('send', lang()), value: '#send' }, { label: t('change', lang()), value: '#change' }, { label: t('cancel', lang()), value: '#cancel' }] })]);
    }

    /* the server named a field: ask that one again, then back to the summary */
    function fixFrom(fields) {
      var first = fields[0] || {};
      var ADDR = { address: 'house', pincode: 'pin', city: 'city', state: 'pin', district: 'pin' };
      var ids = fieldIds();
      var id = '';
      if (ADDR[first.field]) {
        id = ids.filter(function (x) { return F[x].type === 'address'; })[0];
        var stepWas = ADDR[first.field];
        var had = Object.assign({}, S.data);
        if (stepWas === 'house') ['address', 'house', 'street'].forEach(function (x) { delete S.data[x]; });
        else ['pincode', 'state', 'district', 'city', 'address', 'house', 'street'].forEach(function (x) { delete S.data[x]; });
        S.addr = stepWas === 'house'
          ? { step: 'house', pin: had.pincode, state: had.state, district: had.district, city: had.city }
          : stepWas === 'city' ? { step: 'city', pin: had.pincode, state: had.state, district: had.district, house: had.house, street: had.street } : { step: 'pin' };
      } else {
        id = ids.filter(function (x) { return keyOf(x) === first.field; })[0] || '';
        if (first.field === 'title' && S.flow === 'volunteer') id = 'areas';
        if (id) delete S.data[keyOf(id)];
      }
      var lead = [msg(t('notSent', lang(), { why: first.message || '' }) + ' ' + t('fixThis', lang()))];
      if (!id) { S.phase = 'summary'; return summary(lead); }
      S.step = ids.indexOf(id); S.phase = 'ask'; S.editing = false;
      var o = ask(lead);
      S.editing = true;
      return o;
    }

    /* the one page that answers it, in a line, and the way to it; not a
       list of pages (owner, 15 Nov 2026: "instead of tons of links") */
    function searchDone(r) {
      var best = (r.rows || [])[0];
      var chips = [];
      /* not answered well enough? a person, if one is on; else the help desk */
      var live = liveOn();
      chips.push(live ? { label: t('liveChip', lang()), value: '#live' } : { label: t('askDesk', lang()), value: '#desk' });
      chips.push({ label: t('menuChip', lang()), value: '#menu' });
      /* the site's own sentence that answers it, word for word, and its page */
      var p = r.passage;
      var then = S.afterSearch;
      S.afterSearch = '';
      if (!(p && p.text && p.url) && then) return begin(then, S.deskQuestion || '');
      if (p && p.text && p.url) return out([msg(p.text, { links: [{ label: (lang() === 'hi' ? 'पूरा पढ़ें: ' : 'Read more: ') + p.title, href: String(p.url).replace(/^\//, '') }], chips: chips })]);
      if (!best) return out([msg(t(live ? 'nothingLive' : 'nothingFound', lang()), { chips: chips })]);
      return out([msg(best.desc || best.title, { links: [{ label: best.title, href: best.url }], chips: chips })]);
    }
    function answer(f) {
      S.phase = 'menu'; S.flow = '';
      var chips = (f.chip ? [chip(f.chip, lang())] : []).concat([{ label: t('menuChip', lang()), value: '#menu' }]);
      return out([msg(L(f.say, lang()), { links: (f.links || []).map(function (k) { return { label: L(k, lang()), href: k.href }; }), chips: chips })]);
    }

    /* ---- one message in ---- */
    function hear(text, tapped) {
      var raw = String(text == null ? '' : text);
      var s = raw.trim();
      if (!s) return out([]);
      /* the language follows what the person types, unless they chose it;
         a button they tap carries no language of its own */
      var lg = tapped ? '' : N.languageOf(s);
      /* an answer that is a name, a number, an email or an address says
         nothing about the language; a sentence does */
      if (lg && S.phase === 'ask') {
        var fa = fieldNow();
        var said = /[\u0900-\u097F]/.test(s) || N.tokens(s).length >= 3;
        if (!fa || !/^(long|choice|yesno|consent|multi)$/.test(fa.type) || !said || (S.addr && S.addr.step !== 'pin')) lg = '';
      }
      if (lg && !S.langChosen && s.charAt(0) !== '#' && s.charAt(0) !== '@') S.lang = lg;

      /* a live chat: everything typed goes to the person at PFA */
      if (S.phase === 'live') return hearLive(s, N.commandOf(s));
      if (s === '#live') return startLive('');
      /* asking for a person, from anywhere: a live chat if someone is on,
         else the help desk (owner, 16 Nov 2026) */
      if (!tapped && N.personOf(s)) { if (S.phase !== 'menu') { S.deskQuestion = ''; } return liveOn() ? startLive(s) : noOne(); }

      /* the page's own buttons */
      if (s === '#menu') return menu(false);
      if (s === '#more') return more();
      if (s === '#cancel') { var was = S.phase !== 'menu'; var c1 = menu(false); if (was) c1.messages.unshift(msg(t('cancelled', lang()))); return c1; }
      if (s === '#change' && S.phase === 'summary') return changeMenu();
      if (s === '#send' && S.phase === 'summary') return send();
      if (s.charAt(0) === '@' && S.phase === 'change') return changeField(s.slice(1));
      if (s === '#desk') {
        var q = S.deskQuestion || '';
        var topic = S.deskTopic || '';
        var o1 = begin('helpdesk', q);
        if (topic) { S.data.topic = topic; o1 = ask([]); o1.messages.unshift(msg(L(FLOWS.helpdesk.intro, lang()))); }
        return o1;
      }
      if (s === '#switch' && S.offerSwitch) { var to = S.offerSwitch; S.offerSwitch = ''; return begin(to, S.switchText || ''); }
      if (s === '#stay') { S.offerSwitch = ''; return ask([]); }
      if (s.charAt(0) === '#' && s.length > 1 && s !== '#skip' && s !== '#done' && s !== '#send' && s !== '#change') return begin(s.slice(1), '');

      var cmd = N.commandOf(s);
      if (cmd === 'menu') return menu(false);
      if (cmd === 'cancel') { var busy = S.phase !== 'menu'; var c2 = menu(false); if (busy) c2.messages.unshift(msg(t('cancelled', lang()))); return c2; }

      if (S.phase === 'ask') {
        var f = fieldNow();
        if (s === '#skip' || cmd === 'skip') {
          if (f && f.optional) { if (f.type === 'photos') S.photosAsked = true; else S.data[keyOf(f.id)] = ''; S.step += 1; return ask([]); }
        }
        if (cmd === 'back' && S.step > 0 && !(S.addr && S.addr.step !== 'pin')) { S.step -= 1; var prev = fieldIds()[S.step]; changeField(prev); S.editing = false; return ask([]); }
        /* a clear wish for something else, while a short answer was asked
           for: offer to switch rather than read it as the answer */
        if (!tapped && f && /^(choice|yesno|consent|amount|date|mobile|email|reference|contact|multi)$/.test(f.type) && N.tokens(s).length >= 3) {
          var want = N.intentOf(s)[0];
          var wantFlow = want && want.score >= 2 && INTENT_TO[want.id];
          if (wantFlow && wantFlow !== S.flow) {
            S.offerSwitch = wantFlow; S.switchText = s;
            return out([msg(t('switchTo', lang(), { what: titleOf(wantFlow, lang()).toLowerCase() }), { chips: [{ label: titleOf(wantFlow, lang()), value: '#switch' }, { label: t('keepGoing', lang()), value: '#stay' }] })]);
          }
        }
        if (!tapped && f) { var said2 = aside(s, f); if (said2) return said2; }
        return hearField(s);
      }
      if (S.phase === 'summary') {
        var yn = N.yesNoOf(s);
        if (yn === true) return send();
        if (yn === false) return changeMenu();
        return summary([]);
      }
      if (S.phase === 'change') {
        var pickChange = fieldIds().filter(function (id) { return N.choiceOf(s, [{ value: id, en: L(F[id].label, 'en'), hi: L(F[id].label, 'hi') }]); })[0];
        if (pickChange) return changeField(pickChange);
        return changeMenu();
      }
      if (S.phase === 'waiting') return out([msg(t('looking', lang()))]);

      /* free text at the menu: what do they want? */
      var intents = N.intentOf(s);
      var top = intents[0];
      /* a question with a straight answer gets it, in one line */
      var fact = factOf(s, top && top.id);
      if (fact) return answer(fact);
      /* only a number, an email or a PIN: nothing to search for */
      var bare = N.normalise(s).replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g, '').replace(/[\d\s+\-]/g, '');
      if (!top && bare.length < 3) return out([msg(t('notSure', lang()), { chips: MENU.map(function (id) { return chip(id, lang()); }).concat([{ label: t('more', lang()), value: '#more' }]) })]);
      if (!top) { S.deskQuestion = s; S.deskTopic = ''; return out([msg(t('looking', lang()))], { action: { id: newId('search'), type: 'search', q: N.searchText(s), question: s } }); }
      if (top.id === 'greet') return menu(true);
      if (top.id === 'thanks') { var th = menu(false); th.messages.unshift(msg(t('thanks', lang()))); return th; }
      /* a question: the site first, the help desk if that does not answer it */
      if (top.id === 'question') { S.deskQuestion = s; S.deskTopic = ''; return out([msg(t('looking', lang()))], { action: { id: newId('search'), type: 'search', q: N.searchText(s), question: s } }); }
      var go = INTENT_TO[top.id];
      /* a question about something, not a wish to do it ("is it legal to
         feed street dogs"): the site's own answer first, and the page for
         it only if the site has no paragraph that answers it */
      if (go && PAGES[go] && !FLOWS[go] && /^(is|are|can|could|should|does|do|did|what|why|how|when|where|who|which|will|would)\b|\?\s*$/i.test(N.normalise(s))) {
        S.deskQuestion = s; S.deskTopic = ''; S.afterSearch = go;
        return out([msg(t('looking', lang()))], { action: { id: newId('search'), type: 'search', q: N.searchText(s), question: s } });
      }
      /* close calls between two: ask which */
      if (intents[1] && intents[1].score === top.score && INTENT_TO[intents[1].id] && intents[1].id !== 'nearby' && top.id !== 'report') {
        return out([msg(t('notSure', lang()), { chips: [chip(go, lang()), chip(INTENT_TO[intents[1].id], lang())] })]);
      }
      if (go) return begin(go, s);
      return out([msg(t('notSure', lang()), { chips: MENU.map(function (id) { return chip(id, lang()); }) })]);
    }

    /* photographs chosen in the page, already shrunk to data URLs */
    function addPhotos(list) {
      photos = photos.concat(list || []).slice(0, 3);
      S.photosAsked = true;
      var f = fieldNow();
      var lead = [msg(lang() === 'hi' ? photos.length + ' फ़ोटो जुड़ गई।' : photos.length + (photos.length === 1 ? ' photograph added.' : ' photographs added.'))];
      if (f && f.type === 'photos') { S.step += 1; return ask(lead); }
      return out(lead);
    }

    function setLang(l) {
      S.lang = l === 'hi' ? 'hi' : 'en';
      S.langChosen = true;
      return S.phase === 'menu' ? menu(false) : S.phase === 'ask' ? ask([msg(t('langSet', S.lang))]) : S.phase === 'summary' ? summary([]) : out([msg(t('langSet', S.lang))]);
    }

    return {
      start: function () { return menu(true); },
      live: liveNews,
      hear: function (text) { return hear(text, false); },
      tap: function (value) { return hear(value, true); },
      done: done,
      addPhotos: addPhotos,
      setLang: setLang,
      state: function () { return JSON.parse(JSON.stringify(S)); },
      photoCount: function () { return photos.length; }
    };
  }

  function cleanLong(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 1200); }
  function dayOf(iso) {
    var ms = Date.parse(iso || '');
    if (!Number.isFinite(ms)) return '';
    var d = new Date(ms + 330 * 60000);
    return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /* The PFA units nearest a place (assets/assistant-units.js): those in its
     district or town first, then the rest of its state, nearest to the first
     of those first. `place` is what the PIN lookup answered ({ state,
     district, city, near, areas }) or a town typed ({ text }). */
  function unitsNear(units, place) {
    var key = function (x) { return String(x || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z]+/g, ' ').trim(); };
    var p = place || {};
    var names = [p.district, p.city].concat(p.near || [], p.areas || [], p.districts || []).map(key).filter(Boolean);
    var typed = key(p.text);
    var list = (units || []).slice();
    var hit = function (u) {
      var c = key(u.c);
      return names.some(function (n) { return n === c || n.indexOf(c) === 0 || c.indexOf(n) === 0; }) || (typed && (typed.indexOf(c) > -1 || c.indexOf(typed) === 0));
    };
    var inState = p.state ? list.filter(function (u) { return key(u.s) === key(p.state); }) : typed ? list.filter(function (u) { return typed.indexOf(key(u.s)) > -1 || hit(u); }) : [];
    var near = inState.filter(hit);
    var anchor = near[0];
    var km = function (a, b) {
      var r = Math.PI / 180, dLa = (b.la - a.la) * r, dLo = (b.lo - a.lo) * r;
      var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
      return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };
    var rest = inState.filter(function (u) { return near.indexOf(u) < 0; });
    if (anchor) rest.sort(function (a, b) { return km(anchor, a) - km(anchor, b); });
    return near.concat(rest).slice(0, 3).map(function (u) {
      return { title: 'PFA ' + u.c, url: u.u, detail: [u.p, (u.t || [])[0]].filter(Boolean).join(', '), phone: (u.t || [])[0] || '' };
    });
  }

  /* ---- an answer in the site's own words (owner, 16 Nov 2026, of answering
     open questions by searching the site's own pages: "yes") ----
     The sentence on the site that answers the question best, word for word,
     with the page it is on. Nothing is written or guessed: the answer is a
     sentence the site already publishes, or nothing. docs is what the site's
     search index holds ([{ title, url, text }]); a sentence must carry most
     of what the question is about, by weight (rarer words count for more),
     and at least two of its words, or one when only one is asked about. */
  var STOP = ' a an the is are was were be been am do does did i me my we our you your he she it they them this that these those to of for in on at by with from as or and but if so not no can could will would should may might must shall what which who whom whose when where why how there here about into over under than then also just only any all some more most very much many such own same tell know want need please pfa people animal animals india safe ok okay good bad best way ways help get give take make use used using one ';
  function stemOf(w) {
    w = String(w || '').toLowerCase();
    if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  /* the same idea in the words the site uses */
  var SAME = {
    street: 'community', stray: 'community', strays: 'community', indie: 'community', indies: 'community',
    feeding: 'feed', fed: 'feed', feeder: 'feed', feeders: 'feed',
    killing: 'kill', killed: 'kill', kills: 'kill', murder: 'kill',
    punishment: 'punish', penalty: 'punish', penalties: 'punish', jail: 'punish', fine: 'punish', fines: 'punish',
    bitten: 'bite', bit: 'bite', biting: 'bite', bites: 'bite',
    founded: 'founder', founding: 'founder',
    scared: 'fear', afraid: 'fear', frightened: 'fear', anxious: 'fear', anxiety: 'fear', fearful: 'fear', terrified: 'fear', panic: 'fear', panicking: 'fear', phobia: 'fear',
    puppy: 'dog', puppies: 'dog', pup: 'dog', pups: 'dog', kitten: 'cat', kittens: 'cat',
    crackers: 'firework', firecrackers: 'firework', diwali: 'firework',
    vet: 'veterinar', vets: 'veterinar', veterinary: 'veterinar', veterinarian: 'veterinar', doctor: 'veterinar',
    rwa: 'resident', society: 'resident', apartment: 'resident', housing: 'resident',
    hurt: 'injur', injured: 'injur', injury: 'injur', injuries: 'injur', wounded: 'injur',
    donation: 'donat', donations: 'donat', donate: 'donat', donating: 'donat', donor: 'donat',
    '80g': 'tax', exemption: 'tax', deduction: 'tax'
  };
  var SPLIT = { snakebite: ['snake', 'bite'], dogbite: ['dog', 'bite'], firstaid: ['first', 'aid'] };
  function wordsOf(text) {
    var out = [];
    (String(text || '').toLowerCase().replace(/[\u2019']s\b/g, '').match(/[a-z0-9\u0900-\u097f]+/g) || []).forEach(function (w) {
      (SPLIT[w] || [w]).forEach(function (x) {
        if (x.length < 2 || STOP.indexOf(' ' + x + ' ') > -1) return;
        out.push(SAME[x] || stemOf(x));
      });
    });
    return out;
  }
  /* what the site is about: a question with none of these is not one the
     site's words can answer (the weather, a minister, a match score) */
  var TOPIC = /^(dog|cat|cow|bull|buffalo|calf|puppy|pupp|kitten|bird|pigeon|parrot|crow|monkey|horse|donkey|goat|sheep|pig|camel|elephant|snake|wildlife|pet|community|feed|kill|punish|cruelty|cruel|abuse|rescue|shelter|hospital|clinic|veterinar|medicine|vaccin|rabie|antibiotic|antivenom|first|aid|bite|injur|sterilis|steriliz|abc|neuter|spay|adopt|adoption|foster|law|legal|court|fir|police|complaint|report|resident|lift|founder|maneka|gandhi|member|membership|card|caregiver|colony|intern|internship|volunteer|donat|tax|receipt|certificate|fear|firework|behaviour|behavior|train|leash|unit|centre|center|sgacc|academy|quiz|shop|event|campaign|csr|legacy|cinekind|wall|privacy|career|job)$/;
  function onTopic(terms) { return terms.some(function (w) { return TOPIC.test(w); }); }
  /* an animal named in the question must be in the answer */
  var KINDS = /^(dog|cat|cow|bull|buffalo|calf|bird|pigeon|parrot|crow|monkey|horse|donkey|goat|sheep|pig|camel|elephant|snake)$/;
  /* a paragraph cut at a sentence once it is long, so the reply stays short;
     the page has the rest */
  function shortOf(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 360) return t;
    var parts = t.replace(/([.!?])\s+(?=[A-Z0-9\u20b9"'(])/g, '$1\u0001').split('\u0001');
    var out = '';
    for (var i = 0; i < parts.length; i += 1) { if (out && (out + ' ' + parts[i]).length > 360) break; out = out ? out + ' ' + parts[i] : parts[i]; }
    return out.length > 420 ? out.slice(0, out.lastIndexOf(' ', 400)) + '\u2026' : out;
  }
  var passageCache = { docs: null, items: null, df: null };
  /* docs: [{ title, url, heading, text }], the site's paragraphs
     (assets/assistant-answers.json, scripts/build-answer-index.js) */
  function passageOf(question, docs) {
    var terms = wordsOf(question).filter(function (w, i, all) { return all.indexOf(w) === i; });
    if (!terms.length || !docs || !docs.length || !onTopic(terms)) return null;
    if (passageCache.docs !== docs) {
      var df = {};
      var items = docs.map(function (d) {
        var w = wordsOf(d.text);
        var h = wordsOf(d.heading);
        w.concat(h).filter(function (x, i, all) { return all.indexOf(x) === i; }).forEach(function (x) { df[x] = (df[x] || 0) + 1; });
        return { d: d, w: w, h: h };
      });
      passageCache = { docs: docs, items: items, df: df };
    }
    var n = passageCache.items.length || 1;
    var idf = function (w) { return Math.log(1 + n / (1 + (passageCache.df[w] || 0))); };
    var total = terms.reduce(function (a, w) { return a + idf(w); }, 0);
    var need = Math.min(2, terms.length);
    var best = null;
    passageCache.items.forEach(function (it) {
      var inText = terms.filter(function (w) { return it.w.indexOf(w) > -1; });
      var inHead = terms.filter(function (w) { return it.h.indexOf(w) > -1; });
      var hit = terms.filter(function (w) { return inText.indexOf(w) > -1 || inHead.indexOf(w) > -1; });
      if (hit.length < need || !inText.length && !inHead.length) return;
      var cover = hit.reduce(function (a, w) { return a + idf(w); }, 0) / total;
      /* the words of the question in the paragraph itself, unless it answers
         the question its heading asks */
      var asked = /\?\s*$/.test(it.d.heading || '');
      var textCover = inText.reduce(function (a, w) { return a + idf(w); }, 0) / total;
      if (!asked && textCover < 0.75) return;
      var named = terms.filter(function (w) { return KINDS.test(w); });
      var general = it.w.indexOf('pet') > -1 || it.h.indexOf('pet') > -1 || it.w.indexOf('community') > -1 || it.h.indexOf('community') > -1;
      if (named.length && !named.some(function (w) { return hit.indexOf(w) > -1; }) && !(general && named.some(function (w) { return /^(dog|cat)$/.test(w); }))) return;
      var score = cover * 10 + (asked ? 3 : 0)
        + inText.reduce(function (a, w) { return a + idf(w); }, 0) * 0.3
        + inHead.reduce(function (a, w) { return a + idf(w); }, 0) * 0.5
        - it.d.text.length / 3000;
      if (!best || score > best.score) best = { score: score, it: it, cover: cover };
    });
    if (!best || best.cover < 0.75) return null;
    var d = best.it.d;
    return { text: shortOf(d.text), heading: d.heading || '', title: String(d.title || '').replace(/\s*\|\s*People for Animals\s*$/i, ''), url: d.url };
  }

  return { createSession: createSession, unitsNear: unitsNear, passageOf: passageOf, FACTS: FACTS, factOf: factOf, FLOWS: FLOWS, FIELDS: F, OPTIONS: O, PAGES: PAGES, MENU: MENU, MORE: MORE, T: T };
}));
