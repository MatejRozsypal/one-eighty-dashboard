/**
 * Proposing a ClickUp task for an unmapped Meta ad.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * The authoritative join is the Meta `ad_id` written into the ClickUp task's
 * `Creative ID` field. Today that field contains the literal string
 * "Creative ID" on every one of the 65 Manami tasks: it has never been filled
 * once. A product that waits for someone to paste 65 eighteen-digit numbers by
 * hand is a product that never starts.
 *
 * So the dashboard fills it. This module proposes the match, a human confirms
 * it in one click, and the confirmation WRITES THE AD ID BACK to ClickUp — so
 * the next sync resolves it as `creative_id` at full confidence and this
 * heuristic is never consulted for that ad again. The fuzzy matching is
 * scaffolding that removes itself.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * Nothing below 1.0 is ever auto-applied. A wrong match does not look wrong
 * afterwards: it attributes real spend to the wrong persona and the number it
 * produces is entirely plausible.
 */

export type MatchMethod = "creative_id" | "name_exact" | "name_fuzzy" | "manual";

export interface Candidate {
  taskId: string;
  taskName: string;
  taskUrl: string | null;
  status: string | null;
  conceptId: string | null;
  conceptName: string | null;
  market: string | null;
  contentFormat: string | null;
}

export interface Proposal {
  candidate: Candidate;
  method: MatchMethod;
  /** 0..1. Rendered as a percentage next to the name. */
  confidence: number;
  /** Which tokens agreed, for the one-line explanation under the proposal. */
  reasons: string[];
}

/**
 * The naming convention, once it is written down:
 *
 *     [PersonaCode] | [ConceptID] | [Stage] | [Format] | [bNhN] | [DATE] | [MKT]
 *     HeadacheFromSynthetics | C07 | TOF | STAT | b1h3 | 04SEP | CZ
 *
 * Real names in the account predate it and are messier. Three separators are in
 * live use — `|`, `-`, and a capital `I` standing in for a pipe, as in
 * "DYN I Příběh Manami V1 I 6JUN I CZ". The capital-I case is not a typo to be
 * cleaned up later; it is in the names of ads holding real spend today, and a
 * splitter that ignores it silently fails to tokenise a third of the account.
 */
const SEPARATORS = /\s*(?:\||\s-\s|\sI\s)\s*/g;

export interface NameTokens {
  parts: string[];
  conceptId: string | null;
  stage: string | null;
  format: string | null;
  bodyHook: string | null;
  /** Normalised as `DDMMM`, e.g. `04SEP`. */
  date: string | null;
  market: string | null;
  /** Everything not recognised as a structural token. Usually the persona. */
  words: string[];
}

const STAGES = new Set(["TOF", "MOF", "BOF"]);
const FORMATS = new Set(["STAT", "STATIC", "DYN", "VIDEO", "CAR", "CAROUSEL", "DPA", "UGC"]);
const MARKETS = new Set(["CZ", "SK", "PL", "DE", "AT", "HU", "OE"]);
const MONTHS = "JAN|FEB|MAR|APR|MAY|JUN|JUL|JULY|AUG|SEP|SEPT|OCT|NOV|DEC";

export function tokenise(name: string): NameTokens {
  const parts = name
    .split(SEPARATORS)
    .map((p) => p.trim())
    .filter(Boolean);

  const t: NameTokens = {
    parts,
    conceptId: null, stage: null, format: null, bodyHook: null,
    date: null, market: null, words: [],
  };

  for (const part of parts) {
    const up = part.toUpperCase();

    if (!t.conceptId && /^C\d{2,3}$/.test(up)) { t.conceptId = up; continue; }
    if (!t.stage && STAGES.has(up)) { t.stage = up; continue; }
    if (!t.format && FORMATS.has(up)) { t.format = normaliseFormat(up); continue; }
    if (!t.bodyHook && /^B\d+H\d+$/.test(up)) { t.bodyHook = up.toLowerCase(); continue; }

    const date = up.match(new RegExp(`^(\\d{1,2})\\s*(${MONTHS})`));
    if (!t.date && date) {
      t.date = `${date[1].padStart(2, "0")}${normaliseMonth(date[2])}`;
      continue;
    }
    if (!t.market && MARKETS.has(up)) { t.market = up; continue; }

    t.words.push(part);
  }

  return t;
}

function normaliseFormat(up: string): string {
  if (up === "STATIC") return "STAT";
  if (up === "VIDEO" || up === "UGC") return "DYN";
  if (up === "CAROUSEL") return "CAR";
  return up;
}

function normaliseMonth(m: string): string {
  if (m === "JULY") return "JUL";
  if (m === "SEPT") return "SEP";
  return m;
}

/**
 * Strip accents and punctuation so "Něžná" and "Nezna" compare equal.
 * Czech creative names are written both ways in Ads Manager and in ClickUp,
 * often for the same ad.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    // Escaped rather than written literally: the combining marks are invisible
    // in an editor and the first person to reformat this file would delete them.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Score one candidate against an ad name.
 *
 * Weights are deliberately lopsided. A concept id agreeing is nearly decisive —
 * it is a unique key that appears in both names on purpose. A format agreeing
 * is nearly worthless on its own, because most of the account is STAT and
 * "both are static" is true of two ads picked at random.
 */
export function score(adName: string, candidate: Candidate): Proposal | null {
  if (fold(adName) === fold(candidate.taskName)) {
    return {
      candidate,
      method: "name_exact",
      confidence: 0.95,
      reasons: ["name matches exactly"],
    };
  }

  const a = tokenise(adName);
  const b = tokenise(candidate.taskName);
  const reasons: string[] = [];
  let points = 0;
  let possible = 0;

  const weigh = (weight: number, agree: boolean | null, reason: string) => {
    if (agree === null) return;          // one side has nothing to say
    possible += weight;
    if (agree) { points += weight; reasons.push(reason); }
  };

  const pair = <T>(x: T | null, y: T | null): boolean | null =>
    x === null || y === null ? null : x === y;

  // The concept id is the strongest signal available short of the ad id itself.
  weigh(4, pair(a.conceptId, b.conceptId ?? candidate.conceptId), `concept ${a.conceptId}`);
  weigh(3, pair(a.date, b.date), `same launch date ${a.date}`);
  weigh(2, pair(a.bodyHook, b.bodyHook), `body/hook ${a.bodyHook}`);
  weigh(1.5, pair(a.market, b.market ?? candidate.market), `market ${a.market}`);
  weigh(1, pair(a.stage, b.stage), `stage ${a.stage}`);
  weigh(1, pair(a.format, b.format ?? normaliseFormat((candidate.contentFormat ?? "").toUpperCase())), `format ${a.format}`);

  // The persona / free-text half. Jaccard over folded words: a shared rare word
  // like "headachefromsynthetics" is worth much more than a shared "tof", and
  // treating them as sets rather than sequences survives reordering.
  const aw = new Set(fold(a.words.join(" ")).split(" ").filter((w) => w.length > 2));
  const bw = new Set(fold(b.words.join(" ")).split(" ").filter((w) => w.length > 2));
  if (aw.size && bw.size) {
    const shared = [...aw].filter((w) => bw.has(w));
    const union = new Set([...aw, ...bw]).size;
    const jaccard = shared.length / union;
    possible += 4;
    points += 4 * jaccard;
    if (shared.length) reasons.push(`shared wording: ${shared.slice(0, 3).join(", ")}`);
  }

  if (possible === 0) return null;

  // Capped below the exact-match score, and floored so a single weak token
  // agreement cannot present itself as a real proposal.
  const confidence = Math.min(0.9, (points / possible) * 0.9);
  if (confidence < 0.35) return null;

  return { candidate, method: "name_fuzzy", confidence, reasons };
}

/** The best proposal for one ad, or null when nothing scores well enough. */
export function propose(adName: string, candidates: Candidate[]): Proposal | null {
  let best: Proposal | null = null;
  for (const c of candidates) {
    const p = score(adName, c);
    if (p && (!best || p.confidence > best.confidence)) best = p;
  }
  return best;
}

/**
 * Confidence above which the UI offers a one-click Confirm rather than making
 * the user pick from a list. Still a human pressing a button: nothing here is
 * ever applied automatically.
 */
export const CONFIRM_THRESHOLD = 0.7;
