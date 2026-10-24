/* India's states and their districts: one definition, used by the browser and
   by the API.

   Two copies of a geography always drift, and the day they drift is the day a
   donor picks a district the server then refuses. So this file is the only
   place either side reads it from, the way assets/field-rules.js is the only
   place a field rule lives.

   Why it exists at all: the donate page's food order and the ask page's
   question both need to know where the person is, and PFA acts on that. A
   food order is matched to a volunteer serving the area named on it, and a
   question is pointed at the nearest unit. Both were free text, so Punjab
   with Udupi under it was accepted, and neither can be acted on.

   The data is 725 districts across all 36 states and union territories, from
   sab99r/Indian-States-And-Districts, corrected for what that source
   predates: Ladakh separated from Jammu and Kashmir in 2019, so Leh and
   Kargil moved out of one and into the other; Dadra and Nagar Haveli merged
   with Daman and Diu in 2020; Andaman and Nicobar was missing outright; and
   the union territory names carried suffixes the state lists do not use.

   Pipe-joined rather than arrays: at this count the brackets and quotes cost
   more than the names, and every reader splits once.

   Districts are created often in India. When one is missing, add it here and
   nowhere else. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFA_INDIA = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DISTRICTS = {'Andaman and Nicobar Islands':'Nicobar|North and Middle Andaman|South Andaman','Andhra Pradesh':'Anantapur|Chittoor|East Godavari|Guntur|Krishna|Kurnool|Nellore|Prakasam|Srikakulam|Visakhapatnam|Vizianagaram|West Godavari|YSR Kadapa','Arunachal Pradesh':'Anjaw|Changlang|Dibang Valley|East Kameng|East Siang|Kra Daadi|Kurung Kumey|Lohit|Longding|Lower Dibang Valley|Lower Siang|Lower Subansiri|Namsai|Papum Pare|Siang|Tawang|Tirap|Upper Siang|Upper Subansiri|West Kameng|West Siang','Assam':'Baksa|Barpeta|Biswanath|Bongaigaon|Cachar|Charaideo|Chirang|Darrang|Dhemaji|Dhubri|Dibrugarh|Dima Hasao|Goalpara|Golaghat|Hailakandi|Hojai|Jorhat|Kamrup|Kamrup Metropolitan|Karbi Anglong|Karimganj|Kokrajhar|Lakhimpur|Majuli|Morigaon|Nagaon|Nalbari|Sivasagar|Sonitpur|South Salmara-Mankachar|Tinsukia|Udalguri|West Karbi Anglong','Bihar':'Araria|Arwal|Aurangabad|Banka|Begusarai|Bhagalpur|Bhojpur|Buxar|Darbhanga|East Champaran (Motihari)|Gaya|Gopalganj|Jamui|Jehanabad|Kaimur (Bhabua)|Katihar|Khagaria|Kishanganj|Lakhisarai|Madhepura|Madhubani|Munger (Monghyr)|Muzaffarpur|Nalanda|Nawada|Patna|Purnia (Purnea)|Rohtas|Saharsa|Samastipur|Saran|Sheikhpura|Sheohar|Sitamarhi|Siwan|Supaul|Vaishali|West Champaran','Chandigarh':'Chandigarh','Chhattisgarh':'Balod|Baloda Bazar|Balrampur|Bastar|Bemetara|Bijapur|Bilaspur|Dantewada (South Bastar)|Dhamtari|Durg|Gariyaband|Janjgir-Champa|Jashpur|Kabirdham (Kawardha)|Kanker (North Bastar)|Kondagaon|Korba|Korea (Koriya)|Mahasamund|Mungeli|Narayanpur|Raigarh|Raipur|Rajnandgaon|Sukma|Surajpur|Surguja','Dadra and Nagar Haveli and Daman and Diu':'Dadra and Nagar Haveli|Daman|Diu','Delhi':'Central Delhi|East Delhi|New Delhi|North Delhi|North East Delhi|North West Delhi|Shahdara|South Delhi|South East Delhi|South West Delhi|West Delhi','Goa':'North Goa|South Goa','Gujarat':'Ahmedabad|Amreli|Anand|Aravalli|Banaskantha (Palanpur)|Bharuch|Bhavnagar|Botad|Chhota Udepur|Dahod|Dangs (Ahwa)|Devbhoomi Dwarka|Gandhinagar|Gir Somnath|Jamnagar|Junagadh|Kachchh|Kheda (Nadiad)|Mahisagar|Mehsana|Morbi|Narmada (Rajpipla)|Navsari|Panchmahal (Godhra)|Patan|Porbandar|Rajkot|Sabarkantha (Himmatnagar)|Surat|Surendranagar|Tapi (Vyara)|Vadodara|Valsad','Haryana':'Ambala|Bhiwani|Charkhi Dadri|Faridabad|Fatehabad|Gurgaon|Hisar|Jhajjar|Jind|Kaithal|Karnal|Kurukshetra|Mahendragarh|Mewat|Palwal|Panchkula|Panipat|Rewari|Rohtak|Sirsa|Sonipat|Yamunanagar','Himachal Pradesh':'Bilaspur|Chamba|Hamirpur|Kangra|Kinnaur|Kullu|Lahaul and Spiti|Mandi|Shimla|Sirmaur (Sirmour)|Solan|Una','Jammu and Kashmir':'Anantnag|Bandipore|Baramulla|Budgam|Doda|Ganderbal|Jammu|Kathua|Kishtwar|Kulgam|Kupwara|Poonch|Pulwama|Rajouri|Ramban|Reasi|Samba|Shopian|Srinagar|Udhampur','Jharkhand':'Bokaro|Chatra|Deoghar|Dhanbad|Dumka|East Singhbhum|Garhwa|Giridih|Godda|Gumla|Hazaribag|Jamtara|Khunti|Koderma|Latehar|Lohardaga|Pakur|Palamu|Ramgarh|Ranchi|Sahibganj|Seraikela-Kharsawan|Simdega|West Singhbhum','Karnataka':'Bagalkot|Ballari (Bellary)|Belagavi (Belgaum)|Bengaluru (Bangalore) Rural|Bengaluru (Bangalore) Urban|Bidar|Chamarajanagar|Chikballapur|Chikkamagaluru (Chikmagalur)|Chitradurga|Dakshina Kannada|Davangere|Dharwad|Gadag|Hassan|Haveri|Kalaburagi (Gulbarga)|Kodagu|Kolar|Koppal|Mandya|Mysuru (Mysore)|Raichur|Ramanagara|Shivamogga (Shimoga)|Tumakuru (Tumkur)|Udupi|Uttara Kannada (Karwar)|Vijayapura (Bijapur)|Yadgir','Kerala':'Alappuzha|Ernakulam|Idukki|Kannur|Kasaragod|Kollam|Kottayam|Kozhikode|Malappuram|Palakkad|Pathanamthitta|Thiruvananthapuram|Thrissur|Wayanad','Ladakh':'Kargil|Leh','Lakshadweep':'Agatti|Amini|Androth|Bithra|Chethlath|Kadmath|Kalpeni|Kavaratti|Kilthan|Minicoy','Madhya Pradesh':'Agar Malwa|Alirajpur|Anuppur|Ashoknagar|Balaghat|Barwani|Betul|Bhind|Bhopal|Burhanpur|Chhatarpur|Chhindwara|Damoh|Datia|Dewas|Dhar|Dindori|Guna|Gwalior|Harda|Hoshangabad|Indore|Jabalpur|Jhabua|Katni|Khandwa|Khargone|Mandla|Mandsaur|Morena|Narsinghpur|Neemuch|Panna|Raisen|Rajgarh|Ratlam|Rewa|Sagar|Satna|Sehore|Seoni|Shahdol|Shajapur|Sheopur|Shivpuri|Sidhi|Singrauli|Tikamgarh|Ujjain|Umaria|Vidisha','Maharashtra':'Ahmednagar|Akola|Amravati|Aurangabad|Beed|Bhandara|Buldhana|Chandrapur|Dhule|Gadchiroli|Gondia|Hingoli|Jalgaon|Jalna|Kolhapur|Latur|Mumbai City|Mumbai Suburban|Nagpur|Nanded|Nandurbar|Nashik|Osmanabad|Palghar|Parbhani|Pune|Raigad|Ratnagiri|Sangli|Satara|Sindhudurg|Solapur|Thane|Wardha|Washim|Yavatmal','Manipur':'Bishnupur|Chandel|Churachandpur|Imphal East|Imphal West|Jiribam|Kakching|Kamjong|Kangpokpi|Noney|Pherzawl|Senapati|Tamenglong|Tengnoupal|Thoubal|Ukhrul','Meghalaya':'East Garo Hills|East Jaintia Hills|East Khasi Hills|North Garo Hills|Ri Bhoi|South Garo Hills|South West Garo Hills|South West Khasi Hills|West Garo Hills|West Jaintia Hills|West Khasi Hills','Mizoram':'Aizawl|Champhai|Kolasib|Lawngtlai|Lunglei|Mamit|Saiha|Serchhip','Nagaland':'Dimapur|Kiphire|Kohima|Longleng|Mokokchung|Mon|Peren|Phek|Tuensang|Wokha|Zunheboto','Odisha':'Angul|Balangir|Balasore|Bargarh|Bhadrak|Boudh|Cuttack|Deogarh|Dhenkanal|Gajapati|Ganjam|Jagatsinghapur|Jajpur|Jharsuguda|Kalahandi|Kandhamal|Kendrapara|Kendujhar (Keonjhar)|Khordha|Koraput|Malkangiri|Mayurbhanj|Nabarangpur|Nayagarh|Nuapada|Puri|Rayagada|Sambalpur|Sonepur|Sundargarh','Puducherry':'Karaikal|Mahe|Pondicherry|Yanam','Punjab':'Amritsar|Barnala|Bathinda|Faridkot|Fatehgarh Sahib|Fazilka|Ferozepur|Gurdaspur|Hoshiarpur|Jalandhar|Kapurthala|Ludhiana|Mansa|Moga|Muktsar|Nawanshahr (Shahid Bhagat Singh Nagar)|Pathankot|Patiala|Rupnagar|Sahibzada Ajit Singh Nagar (Mohali)|Sangrur|Tarn Taran','Rajasthan':'Ajmer|Alwar|Banswara|Baran|Barmer|Bharatpur|Bhilwara|Bikaner|Bundi|Chittorgarh|Churu|Dausa|Dholpur|Dungarpur|Hanumangarh|Jaipur|Jaisalmer|Jalore|Jhalawar|Jhunjhunu|Jodhpur|Karauli|Kota|Nagaur|Pali|Pratapgarh|Rajsamand|Sawai Madhopur|Sikar|Sirohi|Sri Ganganagar|Tonk|Udaipur','Sikkim':'East Sikkim|North Sikkim|South Sikkim|West Sikkim','Tamil Nadu':'Ariyalur|Chennai|Coimbatore|Cuddalore|Dharmapuri|Dindigul|Erode|Kanchipuram|Kanyakumari|Karur|Krishnagiri|Madurai|Nagapattinam|Namakkal|Nilgiris|Perambalur|Pudukkottai|Ramanathapuram|Salem|Sivaganga|Thanjavur|Theni|Thoothukudi (Tuticorin)|Tiruchirappalli|Tirunelveli|Tiruppur|Tiruvallur|Tiruvannamalai|Tiruvarur|Vellore|Viluppuram|Virudhunagar','Telangana':'Adilabad|Bhadradri Kothagudem|Hyderabad|Jagtial|Jangaon|Jayashankar Bhoopalpally|Jogulamba Gadwal|Kamareddy|Karimnagar|Khammam|Komaram Bheem Asifabad|Mahabubabad|Mahabubnagar|Mancherial|Medak|Medchal|Nagarkurnool|Nalgonda|Nirmal|Nizamabad|Peddapalli|Rajanna Sircilla|Rangareddy|Sangareddy|Siddipet|Suryapet|Vikarabad|Wanaparthy|Warangal (Rural)|Warangal (Urban)|Yadadri Bhuvanagiri','Tripura':'Dhalai|Gomati|Khowai|North Tripura|Sepahijala|South Tripura|Unakoti|West Tripura','Uttar Pradesh':'Agra|Aligarh|Allahabad|Ambedkar Nagar|Amethi (Chatrapati Sahuji Mahraj Nagar)|Amroha (J.P. Nagar)|Auraiya|Azamgarh|Baghpat|Bahraich|Ballia|Balrampur|Banda|Barabanki|Bareilly|Basti|Bhadohi|Bijnor|Budaun|Bulandshahr|Chandauli|Chitrakoot|Deoria|Etah|Etawah|Faizabad|Farrukhabad|Fatehpur|Firozabad|Gautam Buddha Nagar|Ghaziabad|Ghazipur|Gonda|Gorakhpur|Hamirpur|Hapur (Panchsheel Nagar)|Hardoi|Hathras|Jalaun|Jaunpur|Jhansi|Kannauj|Kanpur Dehat|Kanpur Nagar|Kanshiram Nagar (Kasganj)|Kaushambi|Kushinagar (Padrauna)|Lakhimpur - Kheri|Lalitpur|Lucknow|Maharajganj|Mahoba|Mainpuri|Mathura|Mau|Meerut|Mirzapur|Moradabad|Muzaffarnagar|Pilibhit|Pratapgarh|RaeBareli|Rampur|Saharanpur|Sambhal (Bhim Nagar)|Sant Kabir Nagar|Shahjahanpur|Shamali (Prabuddh Nagar)|Shravasti|Siddharth Nagar|Sitapur|Sonbhadra|Sultanpur|Unnao|Varanasi','Uttarakhand':'Almora|Bageshwar|Chamoli|Champawat|Dehradun|Haridwar|Nainital|Pauri Garhwal|Pithoragarh|Rudraprayag|Tehri Garhwal|Udham Singh Nagar|Uttarkashi','West Bengal':'Alipurduar|Bankura|Birbhum|Burdwan (Bardhaman)|Cooch Behar|Dakshin Dinajpur (South Dinajpur)|Darjeeling|Hooghly|Howrah|Jalpaiguri|Kalimpong|Kolkata|Malda|Murshidabad|Nadia|North 24 Parganas|Paschim Medinipur (West Medinipur)|Purba Medinipur (East Medinipur)|Purulia|South 24 Parganas|Uttar Dinajpur (North Dinajpur)'};

  var STATES = Object.keys(DISTRICTS).sort();

  function districtsOf(state) {
    var row = DISTRICTS[state];
    return row ? row.split('|') : [];
  }

  /* The one question both pages and the API ask. Whitespace is squashed
     first: a district arriving from a form, a saved draft or a hand-written
     campaign link can carry spaces the list does not, and " Udupi" failing
     against "Udupi" would be a bug wearing the costume of a rejection. */
  function pairOk(state, district) {
    var s = String(state || '').replace(/\s+/g, ' ').trim();
    var d = String(district || '').replace(/\s+/g, ' ').trim();
    if (!s || !d) return false;
    return districtsOf(s).indexOf(d) > -1;
  }

  function isState(state) {
    return !!DISTRICTS[String(state || '').replace(/\s+/g, ' ').trim()];
  }

  /* Where a PIN code can be (24 Oct 2026, owner: "pincode has to be valid").
     India Post gives each state the PIN codes that begin with these digits;
     a PIN that begins otherwise is not in that state, and a PIN that begins
     with none of them (0, or 9, the Army Postal Service) is not a postal
     address anywhere. Generous on purpose where states share a range
     (Mohali's 160 codes are Punjab's as well as Chandigarh's, Bihar and
     Jharkhand share 81 to 83): a real PIN must never be refused. Whether a
     code actually exists is India Post's to say, and the form asks it as
     the code is typed (lib/routes/location-lookup.js ?pin=). */
  var PIN_PREFIX = {
    'Andaman and Nicobar Islands': '744', 'Andhra Pradesh': '51|52|53', 'Arunachal Pradesh': '790|791|792',
    'Assam': '78', 'Bihar': '80|81|82|83|84|85', 'Chandigarh': '160', 'Chhattisgarh': '49',
    'Dadra and Nagar Haveli and Daman and Diu': '396', 'Delhi': '110', 'Goa': '403', 'Gujarat': '36|37|38|39',
    'Haryana': '12|13', 'Himachal Pradesh': '17', 'Jammu and Kashmir': '18|19', 'Jharkhand': '81|82|83',
    'Karnataka': '56|57|58|59', 'Kerala': '67|68|69', 'Ladakh': '194', 'Lakshadweep': '682',
    'Madhya Pradesh': '45|46|47|48', 'Maharashtra': '40|41|42|43|44', 'Manipur': '795', 'Meghalaya': '793|794',
    'Mizoram': '796', 'Nagaland': '797|798', 'Odisha': '75|76|77', 'Puducherry': '605|607|609|533|673',
    'Punjab': '14|15|16', 'Rajasthan': '30|31|32|33|34', 'Sikkim': '737', 'Tamil Nadu': '60|61|62|63|64',
    'Telangana': '50', 'Tripura': '799', 'Uttar Pradesh': '20|21|22|23|24|25|26|27|28', 'Uttarakhand': '24|26',
    'West Bengal': '70|71|72|73|74'
  };

  function pinShape(pin) {
    return /^[1-9]\d{5}$/.test(String(pin || '').trim());
  }

  /* Can this PIN be in this state? */
  function pinOk(state, pin) {
    var p = String(pin || '').trim();
    var row = PIN_PREFIX[String(state || '').replace(/\s+/g, ' ').trim()];
    if (!row || !pinShape(p)) return false;
    return row.split('|').some(function (prefix) { return p.indexOf(prefix) === 0; });
  }

  /* The states a PIN can be in, the closest first: 737 is Sikkim before it
     is West Bengal. */
  function pinStates(pin) {
    var p = String(pin || '').trim();
    if (!pinShape(p)) return [];
    var hits = [];
    STATES.forEach(function (state) {
      var best = 0;
      PIN_PREFIX[state].split('|').forEach(function (prefix) { if (p.indexOf(prefix) === 0 && prefix.length > best) best = prefix.length; });
      if (best) hits.push({ state: state, length: best });
    });
    hits.sort(function (a, b) { return b.length - a.length; });
    return hits.map(function (h) { return h.state; });
  }

  return { DISTRICTS: DISTRICTS, STATES: STATES, PIN_PREFIX: PIN_PREFIX, districtsOf: districtsOf, pairOk: pairOk, isState: isState, pinShape: pinShape, pinOk: pinOk, pinStates: pinStates };
}));
