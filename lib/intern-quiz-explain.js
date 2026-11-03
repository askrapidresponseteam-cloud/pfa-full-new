'use strict';

/* For every question in the law quiz and its practice round: why each of the
   five choices is right or wrong, in the order the bank lists them, and what
   can go wrong in real life when someone acts on a wrong answer (owner,
   3 Nov 2026: "give explanation at the end as to why each ans is the right
   and why each other option is wrong. what can go wrong. etc.. for practise
   as well as for the real test"). Read by lib/intern-quiz-bank.js, which
   sets them on each question as `explain` and `risk`. Each was checked
   against the question's marked answer and its own explanation. */

module.exports = {
 "bite-e": {
  "options": [
   "Washing with soap and running water for fifteen minutes removes much of the virus from the wound, and the vaccine must start the same day because rabies, once symptoms show, is almost always fatal.",
   "The ten-day watch on the dog can tell a doctor when to stop the vaccine course, never whether to start it. A tight bandage also traps virus and dirt in the wound.",
   "Chilli, turmeric or oil do nothing against rabies and can irritate or infect the wound. They also replace the washing and vaccine that actually work.",
   "Bite wounds are usually left open or stitched only later, after rabies immunoglobulin is given into the wound. Stitching at once can push virus deeper and trap infection.",
   "A dog can carry and pass on rabies for some days before it looks ill, and vaccination records are often unreliable. Every bite that breaks the skin needs medical care."
  ],
  "risk": "A delay of even a few days can let the virus reach the nerves, after which rabies cannot be cured. A wrong first step can cost a human life and turn a community against the dogs."
 },
 "bite-m": {
  "options": [
   "A bite through the skin that draws blood is Category III, which needs the anti-rabies vaccine plus rabies immunoglobulin infiltrated into and around the wound, on top of washing.",
   "Treatment for a Category III bite starts at once. The ten-day watch on the dog can only justify stopping the course, and waiting for the dog to die wastes the time that matters.",
   "A dog can shed rabies virus before it shows any signs, so a healthy look is no safety. A bleeding bite always needs treatment.",
   "Tetanus cover may also be advised for a dirty wound, but it does nothing against rabies. Giving it alone leaves the person unprotected.",
   "Antibiotics may help against a bacterial infection in the wound, but rabies is a virus. Only the vaccine and immunoglobulin protect against it."
  ],
  "risk": "Skipping immunoglobulin on a deep bite, especially near the face or hands, leaves a gap before the vaccine works, and rabies in that gap is fatal. A wrong answer here can kill the person who was bitten."
 },
 "bite-h": {
  "options": [
   "Hospital figures count bites that reach a hospital, not all bites. If the campaign sent more bitten people for free treatment, recorded cases rise even when actual bites do not.",
   "Nothing supports the idea that vaccinated dogs bite more, and brief handling during a campaign would not raise bites across a city. It is an invented cause.",
   "There is no evidence that the anti-rabies vaccine makes dogs aggressive for months. This claim is unsupported and would wrongly discourage vaccination.",
   "Fewer street dogs would, if anything, mean fewer bites, so this deepens the puzzle instead of explaining it.",
   "Double counting affects the number of vaccinations recorded, not the number of bite cases at hospitals. It explains nothing about the rise in bites."
  ],
  "risk": "Reading a rise in reported bites as a rise in real bites can lead a council to halt vaccination or order dogs removed, which raises rabies risk. It also lets critics attack welfare work with misleading numbers."
 },
 "poison-e": {
  "options": [
   "Section 325 of the BNS replaced IPC sections 428 and 429 from 1 July 2024. It punishes killing, poisoning or maiming any animal, whatever its value, with up to five years.",
   "Section 11 of the PCA Act punishes cruelty and can be cited alongside, but it did not replace the IPC sections. Those were replaced by the BNS, the new penal code.",
   "Article 51A(g) is a fundamental duty of citizens to show compassion to living creatures. It sets no offence or punishment of its own.",
   "Section 9 of the Wildlife Act bans hunting scheduled wild animals. It does not replace the general penal sections and does not cover dogs, cattle or other domestic animals.",
   "Rule 20 of the ABC Rules deals with feeding community animals. Rules made under the PCA Act create no criminal offence for killing or poisoning."
  ],
  "risk": "Citing a repealed IPC section or a wrong provision can weaken an FIR or let police record it under a minor, non-cognizable clause. The poisoner may then face no real case."
 },
 "poison-m": {
  "options": [
   "Section 11(1)(l) names killing any animal, including stray dogs, by strychnine injection in the heart or other cruel ways. BNS 325 covers killing or poisoning any animal, owned or not.",
   "The ABC Rules govern sterilisation, vaccination and feeding of community dogs. They create no offence, and a street dog is fully protected by the PCA Act and the BNS.",
   "A street dog is not a wild animal under the Wildlife Act. That Act does not apply here, and the correct laws are the PCA Act and the BNS.",
   "Section 11(1)(h) punishes an owner who fails to give an animal food, drink or shelter. It does not fit a deliberate killing, which clause (l) and BNS 325 cover directly.",
   "No owner is needed for a complaint. Anyone may report the offence, and BNS 325 is cognizable, so police must register an FIR."
  ],
  "risk": "If only a weak or wrong provision is cited, the case may go nowhere and the accused may go on poisoning. Without BNS 325, police may treat it as non-cognizable and refuse an FIR."
 },
 "poison-h": {
  "options": [
   "Section 174(4) of the BNSS says that where a case relates to two or more offences and at least one is cognizable, the whole case is treated as cognizable. Police must register it.",
   "The law does not split one complaint into two cases. Because the poisoning under BNS 325 is cognizable, no magistrate's order is needed for the beating either.",
   "This reverses the rule. The BNSS makes the cognizable offence decide the nature of the whole case, not the non-cognizable one.",
   "The Animal Welfare Board advises and coordinates but cannot investigate crimes. Offences under the PCA Act and the BNS are for the police and the courts.",
   "The PCA Act does not displace the BNS here. Both apply together, and BNS 325 is what makes the case cognizable."
  ],
  "risk": "If police treat the case as non-cognizable, they may refuse an FIR and send the complainant to a magistrate, losing days in which poison samples and witnesses vanish. Evidence may never be collected."
 },
 "feeding-e": {
  "options": [
   "Rule 20 makes the resident welfare or apartment owners' association, or the local body's representative, responsible for arranging feeding, at spots and times away from children and older people.",
   "The Rules give the police no role in approving feeders or times. Police sit on the Animal Welfare Committee that settles disputes, but they do not run feeding.",
   "The Rules protect community animals and their feeders without any formal adoption or registration. Feeding is not limited to registered owners.",
   "The government vet may sit on the dispute committee but does not choose feeding spots. Rule 20 puts that duty on the association or local body.",
   "Rule 20 requires feeding to be arranged, not banned. A society cannot outlaw feeding of community animals on its campus."
  ],
  "risk": "If the duty is misread, a society may ban feeding outright and harass feeders. Hungry dogs then roam and scavenge more, which raises conflict and bites."
 },
 "feeding-m": {
  "options": [
   "Rule 20 makes the association arrange feeding, not ban it, at spots and times away from children and older people. If it refuses, the Animal Welfare Committee under Rule 20 settles the dispute.",
   "There is no need to go straight to the Supreme Court. Rule 20 provides a committee for such disputes, and a High Court or local authority can also act.",
   "An association's resolution cannot override the ABC Rules, which are made under a central Act. A ban that defeats Rule 20 is not binding.",
   "Rule 20 asks for feeding away from places and times used by children. Feeding at the gate as children leave for school does the opposite and invites conflict.",
   "Community dogs must stay in their own territory under the ABC Rules. Moving them and telling the association they were rehomed is both unlawful and dishonest."
  ],
  "risk": "Moving dogs or feeding at the wrong time can expose the feeder to complaints and lose the moral high ground. Giving in to an unlawful ban leaves dogs hungry and conflict growing."
 },
 "feeding-h": {
  "options": [
   "The argument jumps from feeding coming first to feeding causing the bites. It works only if the bites would not have happened without the feeding.",
   "The argument never relies on feeding being illegal; it relies on cause and effect. Feeding is in any case lawful under Rule 20 of the ABC Rules.",
   "The argument says nothing about the care taken by feeders. Its point is about what feeding supposedly caused, not about the feeders' habits.",
   "This goes further than the argument needs. It concerns only these dogs and these two bites, not fed dogs everywhere.",
   "Whether the victims had fed dogs is beside the point. The argument would stand or fall the same either way."
  ],
  "risk": "Accepting a false cause can lead a society to stop feeding while ignoring the real reason, such as an unsterilised mother with pups or teasing. Bites continue and feeders get blamed."
 },
 "moved-e": {
  "options": [
   "Rule 11(19) of the ABC Rules requires release at the same place or locality from where the dog was caught, so its territory is not taken by new, unsterilised dogs.",
   "Dumping dogs in a forest is not allowed under the Rules. Dogs there harm wildlife, can spread disease to it, and often die from lack of food or from predators.",
   "Lifelong shelter is not the general rule for community dogs. Only dogs from institutional premises named by the Supreme Court go to shelters.",
   "The association has no power to pick a release site. The Rules fix release at the place of capture.",
   "A pound is not a release site. Keeping sterilised dogs there defeats the ABC method, which relies on returning them to hold their territory."
  ],
  "risk": "Releasing dogs elsewhere leaves their old territory open to new, unsterilised dogs and puts the moved dogs at risk of fights, hunger and road deaths. Those who move them may face complaints for breaking the Rules."
 },
 "moved-m": {
  "options": [
   "In its May 2026 judgment the Court kept its November 2025 directions: dogs from hospitals and similar premises are sterilised, vaccinated and moved to shelters, not returned there.",
   "The general ABC rule of return to the same place does not apply to hospitals, schools, stations and similar premises. The Court carved them out because returning dogs there defeats the purpose.",
   "Neither the ABC Rules nor the judgment allow healthy dogs to be killed. Putting a dog down is only for one that is incurably ill or mortally wounded, as a vet decides.",
   "Dropping a dog in another ward is relocation, which neither the Rules nor the Court allow. It creates fights and leaves the dog without its food sources.",
   "An association has no role in taking these dogs. The Court directed shelters run by the authorities for dogs from institutional premises."
  ],
  "risk": "Acting on the old rule could put a dog back inside a hospital against the Court's directions and invite contempt or complaints. Killing or dumping the dog would itself be an offence."
 },
 "moved-h": {
  "options": [
   "If food stayed the same and new dogs came in from nearby wards, removal itself created the gap they filled. That shows why removal fails, which is the vacuum effect.",
   "This only rules out the removed dogs escaping back. It does not explain why the numbers returned, so it adds little support.",
   "Fewer complaints soon after removal suggests a short-term gain, if anything. It does not show that numbers came back or why.",
   "This is about sterilisation in another ward, not removal in Ward 7. It neither supports nor undermines the claim that removal fails.",
   "The health and vaccination of the removed dogs has no bearing on whether removal reduced the number of dogs in the ward."
  ],
  "risk": "Missing the vacuum effect leads councils to keep removing dogs, which costs money and brings in unsterilised, unvaccinated dogs. Bites and rabies risk can then rise rather than fall."
 },
 "road-e": {
  "options": [
   "A hit dog may have unseen spinal or internal injuries. Shielding it from traffic, approaching calmly and moving it flat on a board or blanket protects the spine on the way to the vet.",
   "Lifting by the front legs and making it walk can worsen a spinal, pelvic or leg injury. Testing whether it can walk is the vet's job.",
   "Food and water can make an injured dog choke or vomit, and can delay surgery under anaesthesia. Get it to a vet first.",
   "Dragging by the tail or hind legs can damage the spine and pelvis further. Speed matters, but a board or blanket is just as quick and much safer.",
   "A dog that cannot get up may be in shock or bleeding inside. An hour's wait can be fatal, and it stays in danger from traffic."
  ],
  "risk": "Wrong handling can turn a treatable injury into paralysis or death. A frightened, hurt dog may also bite the helper, and a helper on the road can be hit by traffic."
 },
 "road-m": {
  "options": [
   "Driving at a dog to kill it is mischief by killing an animal under BNS 325, which is cognizable and carries up to five years. Section 11(1)(l) of the PCA Act can be cited with it.",
   "The Motor Vehicles Act does not turn a deliberate killing into an accident. Intent decides it, and running a dog over on purpose is a crime.",
   "Section 11(1)(i) covers abandoning an animal where it may starve or go thirsty. It has nothing to do with deliberately killing a dog.",
   "The ABC Rules deal with sterilisation, vaccination and feeding and create no offence. A community dog is protected by the BNS and the PCA Act like any other animal.",
   "A civil claim does not deal with the crime. Anyone may report the killing, and because BNS 325 is cognizable the police must register an FIR."
  ],
  "risk": "If the killing is treated as a road accident or a civil quarrel, no FIR is registered and the motorist goes free. Evidence such as CCTV and witness accounts can be lost within days."
 },
 "road-h": {
  "options": [
   "If most dogs along the stretch were removed in the same months, fewer would be killed whatever the speed breakers did. This offers another cause for the fall.",
   "Speed breakers on other, uncounted roads tell us nothing about this stretch. They neither explain nor challenge the fall in deaths here.",
   "Drivers' complaints show the speed breakers slowed them down, which if anything fits the council's claim. It does not offer another cause for the fall.",
   "A count kept the same way for five years makes the figures more reliable. That strengthens the conclusion rather than weakening it.",
   "When dogs were hit does not explain why fewer are hit now. Without a change in night conditions, it does not challenge the speed breakers' effect."
  ],
  "risk": "Crediting the wrong cause can hide the fact that dogs were removed, which may itself breach the ABC Rules. Councils may also put money into measures that did not actually save lives."
 },
 "sample-1": {
  "options": [
   "Article 51A sits in Part IVA, the Fundamental Duties, added in 1976. Clause (g) asks every citizen to protect the environment and wildlife and to have compassion for living creatures.",
   "Article 51A(g) is in the part on duties, not the part on fundamental rights. Courts use it to read animal welfare laws, but it gives animals no right to sue under it.",
   "The duty falls on every citizen, not on the police alone. Police duties come from the BNSS and the laws they enforce.",
   "It is part of the Constitution, not a rule of the Animal Welfare Board. The Board advises governments and cannot make constitutional provisions.",
   "The PCA Act is a separate law passed by Parliament in 1960. Article 51A(g) is in the Constitution and was added in 1976."
  ],
  "risk": "Citing Article 51A(g) as if it were an enforceable right or a penal section can make a complaint look poorly founded. It works best alongside the PCA Act and the BNS, not in place of them."
 },
 "sample-2": {
  "options": [
   "Rule 11(9) bars catching puppies under six months and mothers with puppies under two months. Taking a mother from very young puppies would leave them to die.",
   "The Rules require both male and female dogs to be sterilised. Neutering males also reduces fighting and mating stress, and the ABC programme covers both sexes.",
   "The Rules set no upper age limit. Older dogs can still breed, and the vet decides whether each dog is fit for surgery.",
   "The Rules do not need feeders' written consent before a dog is caught. Feeders are encouraged to help, but they hold no veto.",
   "The Rules contain no seasonal ban on catching females. Proper surgery and post-operative care, not the calendar, govern healing."
  ],
  "risk": "Catching a nursing mother can kill her whole litter and is a breach of the Rules that can be reported against the ABC centre. Wrongly leaving out males or older dogs slows the programme."
 },
 "sample-3": {
  "options": [
   "Cool first, transport second. Water cooler than the dog, with moving air, brings the temperature down fastest, and a vet is still needed because heatstroke can damage organs after the dog seems better.",
   "Heatstroke gets worse by the minute, and waiting in the shade alone does not cool a collapsed dog fast enough. An hour can mean organ failure or death.",
   "Forcing large amounts of water can make the dog vomit or inhale water into its lungs. Small sips are safe; cooling the body from the outside is what works.",
   "A wet blanket left on traps heat against the body and stops evaporation. Cooling needs water poured over and air moving across the dog.",
   "Paracetamol can damage a dog's liver and blood, and fever medicine does not lower heatstroke temperature, which is not a fever. Never give human medicines without a vet."
  ],
  "risk": "Delay or the wrong first aid can cause brain damage, organ failure or death within hours. Giving human medicines can poison the dog on top of the heatstroke."
 },
 "neglect-e": {
  "options": [
   "Section 11(1)(i) punishes abandoning an animal where it is likely to suffer from starvation or thirst. A dog shut in an empty house with no one to feed it is exactly that.",
   "Telling a neighbour hands over no duty of care. Unless someone has actually taken charge of feeding the dog, it is still abandoned and likely to starve.",
   "A pet stays its owners' animal when they move away. It does not turn into a community dog, and locking it in a compound is the opposite of a free-roaming dog anyway.",
   "Clause (i) needs only that the animal is likely to suffer from hunger or thirst. The offence is complete when the dog is left; nobody has to wait for it to die.",
   "The ABC Rules deal with sterilising and vaccinating community dogs. They do not cover an owned pet abandoned by its family; that is cruelty under the PCA Act."
  ],
  "risk": "If helpers treat this as lawful or wait for a death, the dog can die of thirst within days and the owners escape. Breaking in without the police can also expose the helper to a trespass complaint, so call the police first."
 },
 "neglect-m": {
  "options": [
   "Clause (f) covers keeping an animal on an unreasonably short or heavy chain for an unreasonable time, and clause (g) covers not exercising a dog that is habitually chained.",
   "BNS 325 needs killing, poisoning, maiming or rendering an animal useless. Chaining causes suffering, but the PCA Act has clauses written for exactly this, so it is the direct provision.",
   "A pet dog is a domestic animal, not a wild species listed in the schedules of the Wild Life (Protection) Act, so that Act does not apply.",
   "Article 48 is a Directive Principle on agriculture, animal husbandry and cattle breeds. Directive Principles guide the State and cannot be used to charge a person with an offence.",
   "Rule 20 of the ABC Rules, 2023 deals with feeding community animals. The ABC Rules govern community dogs, not how an owner treats his own pet."
  ],
  "risk": "A complaint citing the wrong law may be returned or quietly closed, and the dog stays on the chain. Long chaining can cause neck wounds, muscle wasting and aggression that later leads to bites."
 },
 "neglect-h": {
  "options": [
   "The new offence came after the earlier one and before the arrest. If the earlier offence was 30 months before the arrest, the gap is at most 30 months, inside three years. Statement (2) alone mentions no earlier offence.",
   "Statement (2) gives only the date of the new offence. It says nothing about any earlier conviction, so it cannot tell us whether there is a previous offence within three years.",
   "Together they give the exact gap of 26 months, but statement (1) alone already fixes the answer. The verdict is right only when no single statement is enough, which is not the case here.",
   "Statement (1) alone is enough, but statement (2) alone is not, since it says nothing of an earlier offence. Both must work alone for this verdict.",
   "Statement (1) alone already fixes the answer as yes, so the statements together are more than enough."
  ],
  "risk": "Under Section 11(1), a first offence carries only a small fine, while a subsequent offence within three years can bring up to three months in jail. Missing the previous conviction lets a repeat offender off with a token fine."
 },
 "transport-e": {
  "options": [
   "Clause (d) punishes carrying any animal, in a vehicle or not, in a manner or position that causes unnecessary pain or suffering. Buffaloes that cannot stand or lie for twelve hours are exactly that.",
   "Clause (i) is about leaving an animal where it will starve or go thirsty. These buffaloes are being carried, not left behind.",
   "Clause (g) is about not exercising a dog that is habitually chained. It does not deal with buffaloes in a truck.",
   "Section 28 is a saving clause for killing in the manner a religion requires. It does not create an offence and has nothing to do with transport.",
   "Clause (n) is about places used for animal fights. A truck carrying buffaloes is not a fighting venue."
  ],
  "risk": "A complaint under the wrong clause can fail, and the truck drives on with animals that may collapse, break bones or die on the way. Cite Section 11(1)(d) with the Transport of Animals Rules so the police can act."
 },
 "transport-m": {
  "options": [
   "Section 28 says nothing in the Act makes it an offence to kill an animal in the manner a community's religion requires. Other laws, such as state cattle slaughter laws, may still apply.",
   "Abandoning an animal where it is likely to starve or go thirsty is an offence under Section 11(1)(i).",
   "Inciting animals to fight is an offence under Section 11(1)(m), and organising or running a fight under Section 11(1)(n).",
   "Section 11(1)(e) punishes keeping an animal in a cage that does not let it move about reasonably. A bird that cannot stretch its wings is covered.",
   "Packing goats so tightly that they suffer is carrying animals in a manner that causes unnecessary pain, an offence under Section 11(1)(d)."
  ],
  "risk": "A complaint against lawful religious slaughter under the PCA Act will fail and can cause community tension or a counter-complaint. Believing any of the real offences is lawful means they go unreported and animals keep suffering."
 },
 "transport-h": {
  "options": [
   "The figure counts trucks caught, not trucks running. If trucks were stopped only on a phone tip before, the rise may come from checking more, not from more cruelty.",
   "Where the cattle were bought says nothing about whether cruel transport grew or whether more trucks were simply caught. It neither weakens nor strengthens the conclusion.",
   "More animals per truck suggests the cruelty got worse, if anything. It does not explain the rise in trucks stopped, so it does not weaken the claim.",
   "A rise on highways with no checkpoints suggests the cruel trade really grew everywhere, which supports the official rather than weakening him.",
   "Where the rescued cattle went happens after the count. It tells us nothing about how many cruel trucks were on the highway."
  ],
  "risk": "Mistaking better detection for more cruelty can lead officials to call the checkpoints a failure, or move police elsewhere. Then cruel trucks run unchecked again and more cattle die in transit."
 },
 "wild-e": {
  "options": [
   "The Wild Life (Protection) Act, 1972 protects native wild species listed in its schedules, including parakeets, munias and the star tortoise. Catching, keeping or selling them is an offence.",
   "The PCA Act punishes cruelty, such as a cramped cage, but it does not ban catching, keeping or trading wild species. That is the job of the Wild Life (Protection) Act.",
   "The ABC Rules, 2023 cover sterilising and vaccinating community dogs and cats. They say nothing about wild birds or reptiles.",
   "The Motor Vehicles Act deals with vehicles and road traffic, not with the trade in wild animals.",
   "The RTI Act lets citizens get information from public authorities. It creates no offence about wild animals."
  ],
  "risk": "A complaint under the wrong law may never reach the forest department, which has the powers to seize. A helper who buys or keeps a parakeet to 'rescue' it commits an offence and also feeds the trade."
 },
 "wild-m": {
  "options": [
   "The 2022 amendment cut six schedules to four: two for animals by level of protection, one for plants, and one for species listed under CITES.",
   "Six was the number before the 2022 amendment. The amendment merged and removed schedules, including the old vermin schedule.",
   "Two is only the number of schedules for animals. The Act also has a schedule for plants and one for CITES species.",
   "The Act has never had eight schedules. This number has no basis in the Act.",
   "The Act has never had twelve schedules. This number has no basis in the Act."
  ],
  "risk": "Citing an old schedule number, such as Schedule V or VI, in a complaint can make it look careless and confuse the forest officer. It may delay seizure while the animals are moved or sold."
 },
 "wild-h": {
  "options": [
   "An animal sold with a receipt cannot be wild-caught, since every wild-caught animal went without one. Every star tortoise was wild-caught, so those receipted animals were not star tortoises.",
   "This reverses the rule. We know every star tortoise was sold without a receipt, not that everything sold without a receipt was a star tortoise.",
   "It could be true, but it need not be. Every wild-caught animal there might have been a star tortoise, and nothing in the facts rules that out.",
   "The facts give no numbers. We cannot tell whether most animals were sold with or without a receipt.",
   "The facts say every star tortoise had been taken from the wild, so none was bred in captivity. This statement contradicts the facts."
  ],
  "risk": "Reading more into evidence than it proves can lead to accusing the wrong seller in a raid report. That can sink the case and expose the helper to a defamation complaint."
 },
 "fights-e": {
  "options": [
   "Clause (m) forbids inciting any animal to fight for entertainment. Clause (n) forbids organising or managing a place for animal fights, including taking money for admission.",
   "Fighting cocks are domestic fowl, not wild birds in the schedules of the Wild Life (Protection) Act. The offence lies under the PCA Act.",
   "A practice being traditional does not make it lawful. The PCA Act bans animal fights, and no exemption has been made for cock fights.",
   "The ABC Rules, 2023 deal with sterilising community dogs and cats. They do not govern poultry or fights.",
   "The fight is an offence under the PCA Act whether or not a bird dies. BNS 325 can be added if a bird is killed or maimed, but it is not the condition."
  ],
  "risk": "If helpers think the fight is lawful or wait for a death, the birds are injured with blades and the organisers keep earning. A complaint under the wrong law can be closed without any action."
 },
 "fights-m": {
  "options": [
   "The 1998 notification under Section 22 barred bears, monkeys, tigers, panthers and lions from being trained or exhibited, and bulls were added in 2011.",
   "Dogs and horses are not on the banned list. They may perform if registered under the Performing Animals (Registration) Rules, 2001.",
   "Animals may be used in films and advertisements if they are registered and the Board's rules are followed. There is no blanket ban.",
   "Elephants are not on the Section 22 list. Captive elephants are regulated, but the notification bars bears, monkeys, tigers, panthers, lions and bulls.",
   "Cats and birds are not on the Section 22 list. Many native birds are protected under the Wild Life (Protection) Act, but that is a different law."
  ],
  "risk": "Not knowing the list lets bear and monkey shows go unreported, while complaints against lawful registered shows waste police time. Buying a performing monkey to 'free' it can itself break wildlife law."
 },
 "fights-h": {
  "options": [
   "In May 2023 the Constitution Bench upheld the state amendments allowing jallikattu, kambala and bullock-cart races. The welfare conditions in those amendments must still be met.",
   "The Court did the opposite. It held the amendments valid, so these events are lawful in those states if they follow the conditions.",
   "The Court made no nationwide ban and did not direct any state to repeal its laws. It ruled only on the three states' amendments.",
   "The Court decided the question itself. It did not hand it to the Animal Welfare Board of India.",
   "The Court did not strike down any part of the PCA Act. It upheld the state amendments and left whether a sport is part of a state's culture to the legislature."
  ],
  "risk": "Telling the police that jallikattu is banned leads to a complaint that fails and costs credibility. The useful complaint is about breaches of the welfare conditions, such as injuring or harassing the bulls."
 },
 "police-e": {
  "options": [
   "Section 7(1) of the RTI Act gives 30 days, or 48 hours where the information concerns a person's life or liberty.",
   "There is no general 7-day limit. The only shorter limit is 48 hours, for information about life or liberty.",
   "90 days is the time to file a second appeal, not the time for the public authority to reply.",
   "The Act sets no 6-month limit for replies. The limit is 30 days.",
   "Section 7 fixes a limit, and no reply in 30 days is treated as a refusal under Section 7(2), which opens the right to appeal."
  ],
  "risk": "If you do not know the 30-day limit, you may wait too long and miss the 30 days you then have to file a first appeal. The information, such as a post-mortem report or CCTV log, may then be lost."
 },
 "police-m": {
  "options": [
   "Section 173(4) of the BNSS lets you send the substance of the information in writing to the Superintendent of Police. If that fails, a magistrate can order investigation under Section 175(3).",
   "The refusal is not final. The BNSS gives you a written complaint to the Superintendent of Police and then an application to a magistrate.",
   "An RTI can ask for reasons, but it cannot force an FIR, and the reply can take 30 days. Meanwhile evidence disappears.",
   "No provision of the BNSS treats a public post as a complaint. Even information sent electronically must be signed by the informant within three days to be recorded.",
   "The Animal Welfare Board advises and can write to the police, but it cannot register an FIR. Only the police can."
  ],
  "risk": "While you wait or post online, the bodies, poison samples and CCTV footage are lost, and CCTV is often overwritten within days. Without them, the poisoner may never be charged."
 },
 "police-h": {
  "options": [
   "BNS 325 is cognizable and carries up to five years. For such offences Section 173(3) allows a preliminary enquiry of up to 14 days, with permission from a Deputy Superintendent or above.",
   "The feeder is the informant, not the dog. Anyone can report a cognizable offence, and BNS 325 exists to protect animals.",
   "Section 173 does not ask the informant to own anything. BNS 325 covers any animal, and a community dog needs no owner for the law to protect it.",
   "The officer must record the information first. A post-mortem is part of the investigation that follows the FIR, not a condition for taking down the information.",
   "BNS 325 carries up to five years and is cognizable. Treating it as non-cognizable and sending the feeder to a magistrate dodges the duty to register."
  ],
  "risk": "A feeder who accepts an unlawful refusal or an ownership demand lets the case die, and the poisoner may strike again. A preliminary enquiry is the most the officer can lawfully do; answer a refusal under Section 173(4)."
 },
 "sample-4": {
  "options": [
   "A third factor, the number of dogs, can drive both feeders and bites. Two things rising together in the same places does not prove that one causes the other.",
   "Whether every feeder is registered does not touch the causal leap. Even a perfect count of feeders would not show that feeding causes bites.",
   "The source of bite reports is a data quibble. Hospital records would still show only a link, not that feeders cause bites.",
   "Missing details about the cities weaken the evidence a little, but the main flaw is treating a link as cause, even with full details.",
   "How serious each bite was is beside the point. The argument fails because it ignores a common cause, not because of bite severity."
  ],
  "risk": "Blaming feeders leads to feeding bans and harassment of feeders. Hungry, displaced dogs then roam and bite more, and the ABC Rules, 2023 provide for feeding spots rather than bans."
 },
 "sample-5": {
  "options": [
   "Statement (1) gives only the share, 40 percent sterilised. Without the total number of dogs, the number unsterilised cannot be found.",
   "Statement (2) gives 150 sterilised dogs but not the total or the share, so the number unsterilised cannot be found.",
   "Neither alone gives the total. Together, 150 is 40 percent of 375, so 375 minus 150 leaves 225 unsterilised.",
   "Neither statement works alone: one has only a percentage and the other only a count. Each alone leaves the total unknown.",
   "Together they fix the total at 375 and the unsterilised count at 225, so they are sufficient."
  ],
  "risk": "Planning an ABC drive on a guess rather than a fixed count can leave the team short of surgery slots, vaccines and kennels. Unsterilised dogs keep breeding and the drive fails to stabilise the ward."
 },
 "sample-6": {
  "options": [
   "Each kennel holds a dog for 5 days, so it turns over 30 divided by 5, which is 6 times a month. 40 kennels times 6 gives 240 dogs.",
   "160 is 40 kennels times 4 post-surgery days. That multiplies kennels by days instead of dividing the month by each dog's stay.",
   "200 comes from dividing 1,200 kennel-days by 6, adding an extra day to each stay. Each dog uses 5 days, not 6.",
   "300 comes from dividing 1,200 kennel-days by 4, which leaves out the day before surgery. Each dog uses 5 days.",
   "1,200 is the total kennel-days, 40 times 30. It treats each kennel-day as a separate dog, ignoring that each dog stays 5 days."
  ],
  "risk": "Overestimating capacity crowds the kennels, so dogs are released before they recover and wounds can open or get infected. The ABC Rules, 2023 require proper post-operative care before release."
 },
 "sample-7": {
  "options": [
   "Sterilised, vaccinated dogs that hold their ground keep others out. Clearing the meat waste removes the food that pulls new, unsterilised dogs in and undoes the work.",
   "When the market is busiest says nothing about whether the plan will cut bites. It is background, not support.",
   "Past work in another village two years ago says nothing about this market or whether new dogs will keep arriving here.",
   "Daily scraps keep a food source open that can draw new dogs, and pet dogs at home are outside the plan. It does not clearly help.",
   "Fewer visitors during the surgery months does not show bites will fall once the season ends. The result depends on keeping new dogs out."
  ],
  "risk": "If food waste keeps drawing new dogs, bites continue and the panchayat may push to remove the sterilised dogs. The ABC Rules, 2023 require dogs to be returned where they were caught, so relocation is unlawful."
 }
};
