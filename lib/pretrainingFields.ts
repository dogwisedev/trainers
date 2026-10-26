// The before-training questions and checklist. Pure (no database, no HubSpot), so it's easy to test.
// Keys are the HubSpot CONTACT property internal names used by the two HubSpot forms (Client intake, Client manager).
//  scope "client": one answer per client (household, vet, emergency…), always the contact property.
//  scope "dog":    one answer per dog. Dog 1 (k9___dog_name) = the contact property; dogs 2 to 4 are kept in the app.
// The dog's name is never asked: it comes from the deal (k9___dog_name, dog_2_name, dog_3_name, dog_4_name).
// Field types and dropdown options come from HubSpot's own property definitions when available; `options` here is the fallback.

export type Scope = "client" | "dog";
export type Input = "text" | "textarea" | "yesno" | "select" | "multi" | "date" | "number";
export type Q = {
  key: string; label: string; scope: Scope; input: Input; required?: boolean; options?: string[]; hint?: string;
  showIf?: { key: string; is: "yes" | "no" };   // only asked (and only required) when another answer is Yes / No
};
export type Section = { id: SectionId; title: string; scope: Scope; questions: Q[] };
export type SectionId = "home" | "vet" | "dog" | "health" | "food" | "goals" | "behaviour" | "handling";

const FREQ = ["Always", "Often", "Sometimes", "Rarely", "Never"];
const MOTIV = ["Very", "Neutral", "Not at all"];
const HANDLE = ["Yes", "No", "Sometimes", "Yes, but only by the owner"];

export const SECTIONS: Section[] = [
  { id: "home", title: "You and your home", scope: "client", questions: [
    { key: "phone", label: "Phone number", scope: "client", input: "text", required: true },
    { key: "address", label: "Street address", scope: "client", input: "text", required: true },
    { key: "city", label: "City", scope: "client", input: "text", required: true },
    { key: "state", label: "State", scope: "client", input: "text", required: true },
    { key: "zip", label: "Zip code", scope: "client", input: "text", required: true },
    { key: "is_the_pickup_address_the_same_as_the_address_provided_above", label: "Is the pickup address the same as above?", scope: "client", input: "yesno", required: true },
    { key: "if_no_please_provide_the_full_pickup_address", label: "Full pickup address", scope: "client", input: "textarea", required: true, showIf: { key: "is_the_pickup_address_the_same_as_the_address_provided_above", is: "no" } },
    { key: "number_of_people_in_your_household", label: "How many people live in your home?", scope: "client", input: "text", required: true },
    { key: "are_there_children_in_your_household", label: "Are there children in your home?", scope: "client", input: "yesno", required: true },
    { key: "if_so__how_many_children_are_in_your_household_and_how_old_are_they_", label: "How many children, and how old?", scope: "client", input: "text", required: true, showIf: { key: "are_there_children_in_your_household", is: "yes" } },
    { key: "are_there_other_dogs_in_your_household", label: "Other dogs at home?", scope: "client", input: "yesno", required: true },
    { key: "are_there_other_pets_in_your_household", label: "Other pets at home?", scope: "client", input: "yesno", required: true },
    { key: "how_did_you_hear_abour_dogwise_academy_", label: "How did you hear about Dogwise Academy?", scope: "client", input: "select", required: true, options: ["Facebook", "Instagram", "Bark.com", "Google search/Website", "Recommendation from a friend", "Thumbtack", "Other"] }
  ] },
  { id: "vet", title: "Vet and emergencies", scope: "client", questions: [
    { key: "full_address_of_veterinary_clinic", label: "Vet clinic: full address", scope: "client", input: "textarea", required: true },
    { key: "phone_number_of_veterinary_clinic", label: "Vet clinic: phone", scope: "client", input: "text", required: true },
    { key: "emergency_contact_name___number", label: "Emergency contact: name and number", scope: "client", input: "text", required: true },
    { key: "in_the_event_of_a_life_threatening_situation__would_you_give_consent_for_our_trainer_to_perform_cpr", label: "In a life-threatening emergency, may the trainer perform CPR on your dog?", scope: "client", input: "yesno", required: true },
    { key: "signature", label: "Type your full name to agree to the Terms & Conditions", hint: "dogwiseacademy.com/termsandconditions", scope: "client", input: "text", required: true }
  ] },
  { id: "dog", title: "About your dog", scope: "dog", questions: [
    { key: "dog_s_breed", label: "Breed", scope: "dog", input: "text", required: true },
    { key: "dog_1_date_of_birth", label: "Date of birth", scope: "dog", input: "date", required: true },
    { key: "what_is_your_dog_s_gender_", label: "Gender", scope: "dog", input: "select", required: true, options: ["Female", "Male"] },
    { key: "how_much_does_your_dog_weigh_", label: "Weight", scope: "dog", input: "text", required: true },
    { key: "microchip_number", label: "Microchip number", scope: "dog", input: "text" },
    { key: "has_your_dog_been_spayed__neutered", label: "Spayed or neutered?", scope: "dog", input: "yesno", required: true }
  ] },
  { id: "health", title: "Health and vaccines", scope: "dog", questions: [
    { key: "does_your_dog_have_all_vaccinations_up_to_date__including_bordetella_and_rabies_vaccine", label: "Are all vaccines up to date (DHLPP, Bordetella and Rabies)?", scope: "dog", input: "yesno", required: true },
    { key: "if_the_answer_is_no__when_will_your_dog_be_getting_these_vaccines_", label: "When will your dog get them?", scope: "dog", input: "text", required: true, showIf: { key: "does_your_dog_have_all_vaccinations_up_to_date__including_bordetella_and_rabies_vaccine", is: "no" } },
    { key: "does_your_dog_have_any_allergies_or_medical_conditions_", label: "Any medical conditions, allergies or recent surgery?", scope: "dog", input: "textarea", required: true },
    { key: "has_your_dog_displayed_any_medical_illness_within_the_last_7_days__i_e__coughing__nasal_discharge__", label: "Any illness in the last 7 days (coughing, nasal or eye discharge, loose stool)?", scope: "dog", input: "textarea", required: true }
  ] },
  { id: "food", title: "Food and medication", scope: "dog", questions: [
    { key: "company", label: "What food does your dog eat? (brand)", scope: "dog", input: "text", required: true },
    { key: "is_your_dog_on_any_medication__", label: "Is your dog on any medication?", scope: "dog", input: "yesno", required: true },
    { key: "if_so__please_list_the_medication_", label: "Which medication, how much and when?", scope: "dog", input: "textarea", required: true, showIf: { key: "is_your_dog_on_any_medication__", is: "yes" } }
  ] },
  { id: "goals", title: "Training goals", scope: "dog", questions: [
    { key: "what_are_the_most_important_things_you_would_like_to_change_about_your_dog_s_behaviours_", label: "What would you most like to change? (up to 4)", scope: "dog", input: "multi", required: true, options: ["Nipping", "Jumping", "Door manners", "Leash training", "Recall", "Separation anxiety", "Barking", "Biting", "Potty Training", "Fighting", "Whining", "Counter Surfing", "Inappropriate chewing"] },
    { key: "if_you_selected_any_of_the_following_behaviors__please_give_u_more_detail_on_when_this_occurs__bark", label: "Barking, whining or separation anxiety: when does it happen?", scope: "dog", input: "textarea" },
    { key: "what_cues_or_behaviours_does_your_dog_already_know_", label: "Which cues does your dog already know?", scope: "dog", input: "multi", options: ["Sit", "Stay", "Lay down", "Stop/leave it/no", "Down (from furniture or people)"] },
    { key: "can_your_dog_still_perform_these_bahavioural_cues_regardless_of_distractions_or_environment_", label: "Can your dog do them with distractions around?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "have_you_hired_a_professional_dog_trainer_before_", label: "Have you hired a dog trainer before?", scope: "dog", input: "yesno", required: true },
    { key: "how_food_motivated_is_your_dog_", label: "How food motivated?", scope: "dog", input: "select", required: true, options: MOTIV },
    { key: "how_toy_motivated_is_your_dog_", label: "How toy motivated?", scope: "dog", input: "select", required: true, options: MOTIV }
  ] },
  { id: "behaviour", title: "Behavior", scope: "dog", questions: [
    { key: "how_often_does_your_dog_show_aggressive_behaviours_towards_adults_", label: "Aggressive towards adults?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "how_often_does_your_dog_show_aggressive_behaviour_towards_children_", label: "Aggressive towards children?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "how_often_does_your_dog_show_aggressive_behaviours_towards_other_dogs_", label: "Aggressive towards other dogs?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "how_often_does_your_dog_show_aggressive_behaviour_towards_other_animals_", label: "Aggressive towards other animals?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "how_often_does_your_dog_bark_at_a_new_dog_", label: "Barks at a new dog?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "how_often_does_your_dog_bark_at_another_human_", label: "Barks at people?", scope: "dog", input: "select", required: true, options: FREQ },
    { key: "has_your_dog_ever_bitten_another_dog___if_so__please_describe_", label: "Has your dog ever bitten another dog? If so, what happened?", scope: "dog", input: "textarea", required: true },
    { key: "has_your_dog_ever_bitten_a_person___if_so__please_describe_", label: "Has your dog ever bitten a person? If so, what happened?", scope: "dog", input: "textarea", required: true },
    { key: "how_would_you_describe_your_dog_s_level_of_socialization_with_other_dogs_", label: "How social is your dog with other dogs?", scope: "dog", input: "select", required: true, options: [
      "Maximum- visits dog parks or attends doggy daycare on a regular basis", "Moderate- occasional trips to the dog park or with family and friend's dogs",
      "Minimal- has a couple of play buddies you visit on occasion", "None- has not attempted to greet another dog or avoids other dogs altogether"] }
  ] },
  { id: "handling", title: "Home routine and handling", scope: "dog", questions: [
    { key: "are_your_dogs_crate_trained_", label: "Crate trained?", scope: "dog", input: "yesno", required: true },
    { key: "does_your_dog_get_car_sick_", label: "Gets car sick?", scope: "dog", input: "yesno", required: true },
    { key: "where_does_your_dog_sleep_and_are_they_allowed_on_furniture_", label: "Where does your dog sleep? Allowed on furniture?", scope: "dog", input: "textarea", required: true },
    { key: "where_does_your_dog_stay_when_no_one_is_home__and_for_how_long_are_they_left_alone_", label: "Where does your dog stay when no one's home, and for how long?", scope: "dog", input: "textarea", required: true },
    { key: "is_your_dog_comfortable_with_having_collars_and_harnesses_being_put_on_or_taken_off", label: "OK with collars and harnesses going on and off?", scope: "dog", input: "select", required: true, options: HANDLE },
    { key: "is_your_dog_comfortable_being_handled_and_groomed", label: "OK being handled and groomed (paws, ears, tail, mouth)?", scope: "dog", input: "select", required: true, options: HANDLE },
    { key: "any_additional_information_about_your_dog_that_we_should_know_about", label: "Anything else we should know?", scope: "dog", input: "textarea" }
  ] }
];

export const QUESTIONS = SECTIONS.flatMap((s) => s.questions);
/** Which HubSpot form each question comes from: the Client manager form (one per dog) or the Client intake form (everything else). */
export const MANAGER_KEYS = new Set([
  "has_your_dog_been_spayed__neutered", "are_your_dogs_crate_trained_", "does_your_dog_get_car_sick_", "have_you_hired_a_professional_dog_trainer_before_",
  "where_does_your_dog_sleep_and_are_they_allowed_on_furniture_", "where_does_your_dog_stay_when_no_one_is_home__and_for_how_long_are_they_left_alone_",
  "what_are_the_most_important_things_you_would_like_to_change_about_your_dog_s_behaviours_", "if_you_selected_any_of_the_following_behaviors__please_give_u_more_detail_on_when_this_occurs__bark",
  "how_food_motivated_is_your_dog_", "how_toy_motivated_is_your_dog_", "how_often_does_your_dog_show_aggressive_behaviours_towards_adults_",
  "how_often_does_your_dog_show_aggressive_behaviour_towards_children_", "how_often_does_your_dog_show_aggressive_behaviours_towards_other_dogs_",
  "how_often_does_your_dog_show_aggressive_behaviour_towards_other_animals_", "how_often_does_your_dog_bark_at_a_new_dog_", "how_often_does_your_dog_bark_at_another_human_",
  "has_your_dog_ever_bitten_another_dog___if_so__please_describe_", "has_your_dog_ever_bitten_a_person___if_so__please_describe_",
  "has_your_dog_displayed_any_medical_illness_within_the_last_7_days__i_e__coughing__nasal_discharge__", "what_cues_or_behaviours_does_your_dog_already_know_",
  "can_your_dog_still_perform_these_bahavioural_cues_regardless_of_distractions_or_environment_", "how_would_you_describe_your_dog_s_level_of_socialization_with_other_dogs_",
  "is_your_dog_comfortable_with_having_collars_and_harnesses_being_put_on_or_taken_off", "is_your_dog_comfortable_being_handled_and_groomed",
  "any_additional_information_about_your_dog_that_we_should_know_about"
]);
export const INTAKE_QS = () => QUESTIONS.filter((q) => !MANAGER_KEYS.has(q.key));
export const MANAGER_QS = () => QUESTIONS.filter((q) => MANAGER_KEYS.has(q.key));
export const CLIENT_KEYS = QUESTIONS.filter((q) => q.scope === "client").map((q) => q.key);
export const DOG_KEYS = QUESTIONS.filter((q) => q.scope === "dog").map((q) => q.key);
/** Contact properties the app reads from HubSpot (the questions, plus the vaccine file from the HubSpot form). */
export const VACCINE_FILE_PROP = "please_upload_a_copy_of_your_dog_s_vaccination_records__if_you_are_not_able_to_do_so__please_email_";
export const CONTACT_PROPS = [...QUESTIONS.map((q) => q.key), VACCINE_FILE_PROP, "firstname", "lastname", "email"];
/** Deal properties the app reads. */
export const DOG_NAME_PROPS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];
export const DEAL_PROPS = [...DOG_NAME_PROPS, "how_many_dogs_need_training_", "remaining_balance_link", "payment_status", "vaccines_in_order_", "missing_vaccines", "forms", "pre_training_missing", "dealname"];
export const VACCINES = ["DHLPP", "Bordetella", "Rabies"] as const;
/** The balance link only counts while something is owed: once payment_status is Paid (or refunded / cancelled) it's ignored. */
export const balanceOwed = (deal: Record<string, string | null | undefined>) => {
  const link = String(deal.remaining_balance_link || "").trim();
  return link && !/^(paid|refund|program cancelled)$/i.test(String(deal.payment_status || "").trim()) ? link : "";
};

export type Answers = Record<string, string>;
export const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
export const isYes = (v: unknown) => /^(yes|true|y)$/i.test(String(v ?? "").trim());
export const isNo = (v: unknown) => /^(no|false|n)$/i.test(String(v ?? "").trim());
/** Is this question asked, given the other answers? */
export const asked = (q: Q, a: Answers) => !q.showIf || (q.showIf.is === "yes" ? isYes(a[q.showIf.key]) : isNo(a[q.showIf.key]));
/** Required questions still unanswered. */
export const missingIn = (qs: Q[], a: Answers) => qs.filter((q) => q.required && asked(q, a) && blank(a[q.key]));

// ── Vaccines ─────────────────────────────────────────────────────────────────
export type VaccineFile = { id: string; name: string; at: string; by: string; source?: "app" | "hubspot" };
export type VaccineState = { status?: "ok" | "missing" | "review"; missing?: string[]; files?: VaccineFile[]; reviewedBy?: string; reviewedAt?: string; note?: string };
/** Where a dog's vaccines stand. The deal's "Vaccines in order? = Yes" (ticked in HubSpot) covers every dog on the deal. */
export function vaccineStatus(v: VaccineState, dealSaysYes: boolean, hasFile: boolean, dealMissing: string[] = []): { ok: boolean; label: string; missing: string[]; toCheck: boolean } {
  if (v.status === "review") return { ok: false, label: "Records sent, waiting for the team to check", missing: [], toCheck: true };
  if (v.status === "ok" || (!v.status && dealSaysYes)) return { ok: true, label: "Approved", missing: [], toCheck: false };
  const miss = v.status === "missing" ? v.missing || [] : dealMissing; // checked in the app, or in HubSpot ("Missing vaccines" on the deal)
  if (v.status === "missing" || miss.length) return { ok: false, label: `Missing: ${miss.join(", ") || "records"}`, missing: miss, toCheck: false };
  if (hasFile) return { ok: false, label: "Records sent, waiting for the team to check", missing: [], toCheck: true };
  return { ok: false, label: "Upload the vaccine records", missing: [], toCheck: false };
}

// ── The checklist ────────────────────────────────────────────────────────────
export type Item = { key: string; label: string; done: boolean; detail?: string; count?: number; who: "client" | "admin"; section?: SectionId };
export type Ready = { items: Item[]; missing: Item[]; formsDone: boolean; intakeDone: boolean; managerDone: boolean; ready: boolean; waived?: Item[] };
/** An admin said "OK to start": nothing counts as missing any more (the client isn't asked, no incidents). What was missing is kept in `waived`. */
export const clearReady = (r: Ready): Ready => ({ ...r, ready: true, missing: [], waived: r.missing });

export function checklist(o: {
  client: Answers; dog: Answers; vaccines: ReturnType<typeof vaccineStatus>; balanceLink: string; dogsMismatch?: string | null;
}): Ready {
  const sec = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.questions;
  const gaps = (ids: SectionId[], a: Answers) => ids.flatMap((id) => missingIn(sec(id), a));
  // Name the questions when there are only a few, so it's obvious what's missing
  const n = (qs: Q[]) => qs.length;
  const say = (qs: Q[]) => (!qs.length ? undefined : qs.length <= 3 ? qs.map((q) => q.label.replace(/\?$/, "")).join("; ") : `${qs.length} questions left`);
  const homeQ = gaps(["home", "vet"], o.client), dogQ = gaps(["dog", "health"], o.dog), goalsQ = gaps(["goals", "behaviour", "handling"], o.dog);
  const home = homeQ.length, dog = dogQ.length, goals = goalsQ.length;
  const count = (_n: number, qs: Q[]) => say(qs);
  const food = missingIn(sec("food").slice(0, 1), o.dog).length, meds = missingIn(sec("food").slice(1), o.dog).length;
  const items: Item[] = [
    { key: "home", label: "Your details, vet and emergency contact", done: !home, detail: count(home, homeQ), count: n(homeQ), who: "client", section: "home" },
    { key: "dog", label: "About the dog and health", done: !dog, detail: count(dog, dogQ), count: n(dogQ), who: "client", section: dogQ.some((q) => sec("dog").includes(q)) ? "dog" : "health" },
    { key: "goals", label: "Training goals and behavior", done: !goals, detail: count(goals, goalsQ), count: n(goalsQ), who: "client", section: goalsQ.some((q) => sec("goals").includes(q)) ? "goals" : goalsQ.some((q) => sec("behaviour").includes(q)) ? "behaviour" : "handling" },
    { key: "food", label: "Food", done: !food, who: "client", section: "food" },
    { key: "meds", label: "Medication", done: !meds, who: "client", section: "food" },
    { key: "vaccines", label: "Vaccines", done: o.vaccines.ok, detail: o.vaccines.ok ? undefined : o.vaccines.label, who: "client", section: "health" }
  ];
  if (o.balanceLink.trim()) items.push({ key: "balance", label: "Pay the remaining balance", done: false, who: "client" });
  if (o.dogsMismatch) items.push({ key: "dogs", label: "Number of dogs", done: false, detail: o.dogsMismatch, who: "admin" });
  const missing = items.filter((i) => !i.done);
  const both = { ...o.dog, ...o.client };
  const intakeDone = !missingIn(INTAKE_QS(), both).length, managerDone = !missingIn(MANAGER_QS(), o.dog).length;
  return { items, missing, formsDone: intakeDone && managerDone, intakeDone, managerDone, ready: !missing.length };
}

/** Which deal name slot a booking's dog is: matched by name, case and spaces ignored. */
export const normName = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function matchSlots(bookings: { id: string; dog_name: string | null; created_at?: string; slot?: number | null; slot_set_by?: string | null }[], names: (string | null | undefined)[]): Map<string, number> {
  const out = new Map<string, number>(), used = new Set<number>();
  for (const b of bookings) if (b.slot && b.slot_set_by) { out.set(b.id, b.slot); used.add(b.slot); }            // an admin chose it
  for (const b of bookings) {
    if (out.has(b.id)) continue;
    const i = names.findIndex((n, k) => !used.has(k + 1) && normName(n) && normName(n) === normName(b.dog_name));
    if (i >= 0) { out.set(b.id, i + 1); used.add(i + 1); }
  }
  const rest = [...bookings].filter((b) => !out.has(b.id)).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  for (const b of rest) { let s = 1; while (used.has(s) && s < 4) s++; out.set(b.id, s); used.add(s); }   // unmatched: next free slot
  return out;
}
