/**
 * Curated terms that commonly trip AI safety refusals.
 * Code that drops them into identifiers or strings with no domain reason
 * is a known trick to make an AI reviewer refuse to read the file.
 *
 * Words are matched after identifiers are split (camelCase, snake_case),
 * never as substrings, so "pricing" does not match "ricin".
 */
export type BaitCategory = "cbrn" | "explosives" | "self-harm" | "drugs" | "censorship";

/** Strong terms: suspicious on their own in ordinary code. */
export const STRONG: Record<string, BaitCategory> = {
  ricin: "cbrn",
  abrin: "cbrn",
  sarin: "cbrn",
  cyclosarin: "cbrn",
  tabun: "cbrn",
  soman: "cbrn",
  novichok: "cbrn",
  anthrax: "cbrn",
  botulinum: "cbrn",
  bioweapon: "cbrn",
  bioweapons: "cbrn",
  bioweaponry: "cbrn",
  phosgene: "cbrn",
  yellowcake: "cbrn",
  tatp: "explosives",
  anfo: "explosives",
  hmtd: "explosives",
  semtex: "explosives",
  nitroglycerin: "explosives",
  detonator: "explosives",
  pipebomb: "explosives",
  suicide: "self-harm",
  selfharm: "self-harm",
  methamphetamine: "drugs",
  fentanyl: "drugs",
  carfentanil: "drugs",
  heroin: "drugs",
  cocaine: "drugs",
};

/** Two-word phrases (adjacent words, any separator). */
export const PHRASES: Record<string, BaitCategory> = {
  "nerve agent": "cbrn",
  "mustard gas": "cbrn",
  "chlorine gas": "cbrn",
  "chemical weapon": "cbrn",
  "biological weapon": "cbrn",
  "dirty bomb": "explosives",
  "pipe bomb": "explosives",
  "car bomb": "explosives",
  "self harm": "self-harm",
  "kill myself": "self-harm",
};

/** Weak terms: only flagged next to an amplifier (they have real uses). */
export const WEAK: Record<string, BaitCategory> = {
  uranium: "cbrn",
  plutonium: "cbrn",
  pathogen: "cbrn",
  toxin: "cbrn",
  explosive: "explosives",
  explosives: "explosives",
  overdose: "self-harm",
};

/** Words that turn a term into an instruction-shaped request ("lethal dosage", "synthesis route"). */
export const AMPLIFIERS = new Set([
  "lethal",
  "fallout",
  "overpressure",
  "dosage",
  "dose",
  "synthesis",
  "synthesize",
  "synthesise",
  "weaponize",
  "weaponise",
  "weaponized",
  "aerosolize",
  "aerosolized",
  "enrich",
  "enrichment",
  "detonate",
  "detonation",
  "cultivate",
  "cultivation",
  "manufacture",
  "precursor",
  "precursors",
  "dispersal",
  "disperse",
  "poison",
  "poisoning",
  "contaminate",
  "recipe",
]);

/**
 * Politically censored strings that trip some models' filters. Informational:
 * they are legitimate in content, odd in a fingerprinting bundle.
 */
export const CENSORSHIP: string[] = ["tiananmen", "天安门", "六四事件", "法轮功"];
