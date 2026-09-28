/**
 * Real personal or internal data in a capture.
 *
 * A capture goes into a video that gets posted. Product screens hold customer names, account
 * emails, order and invoice numbers, internal hostnames, and occasionally an API key in a settings
 * pane. `/brag` states the rule this inherits: everything read can end up on screen in something
 * published.
 *
 * ## Precision over recall, deliberately
 *
 * A finding here **blocks the capture**, so a false positive is expensive — and a blocking gate
 * that cries wolf is a gate that gets switched off. This repo's history is full of that: a jitter
 * detector with 346 false positives, a pop detector with 41, a blank-panel detector that flagged
 * two perfectly good title cards.
 *
 * So every pattern here is structured enough to be near-unambiguous, and the obvious candidate
 * that is NOT here is a general phone number. `+49 30 901820` and `Version 4.9 30 901820` are hard
 * to tell apart without context, dates and order numbers look identical to phone numbers, and the
 * cost of getting it wrong is a refused capture with a confusing reason. Internationally formatted
 * numbers are matched; bare digit runs are not.
 *
 * This is a net, not a guarantee. A customer's name is still just a name, and no regex finds it —
 * which is why `sourcing.md` also tells the agent to *look* at what it captured.
 */

export type SecretKind = "email" | "iban" | "payment_card" | "private_host" | "api_key" | "international_phone";

export interface SecretFinding {
  kind: SecretKind;
  /** The match, partially masked — the finding must not itself leak the value into a log. */
  redacted: string;
  /** Where it was found, as a character offset into the scanned text. */
  index: number;
}

/** Mask the middle, keeping just enough to find it on the page. */
function redact(value: string): string {
  if (value.length <= 6) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

/**
 * Luhn, so a 16-digit order number is not reported as a card.
 *
 * Roughly 90% of random digit strings fail it, which turns the noisiest pattern in the set into
 * one of the most precise.
 */
export function passesLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** IBAN: two letters, two check digits, then 11–30 alphanumerics. */
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
/** Card-shaped digit runs, optionally grouped. Luhn decides. */
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PRIVATE_HOST = /\b(?:localhost(?::\d+)?|[\w-]+\.(?:local|internal|lan|test)\b|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/gi;
/** Long opaque tokens with a recognisable vendor prefix. Bare hex is far too common to include. */
const API_KEY = /\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAIza[0-9A-Za-z_-]{30,}\b/g;
/** Only internationally formatted numbers — see the note above about bare digit runs. */
const INTL_PHONE = /\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,3}\b/g;

/** Emails that are obviously placeholders rather than somebody's address. */
const PLACEHOLDER_EMAIL = /@(?:example|test|acme|demo|company|yourcompany|domain|email)\.(?:com|org|net|de)$|^(?:info|hello|support|contact|hi|team|sales|noreply|no-reply)@/i;

function collect(text: string, pattern: RegExp, kind: SecretKind, accept?: (match: string) => boolean): SecretFinding[] {
  const out: SecretFinding[] = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (accept && !accept(value)) continue;
    out.push({ kind, redacted: redact(value.trim()), index: match.index ?? 0 });
  }
  return out;
}

/**
 * Everything in `text` that looks like real personal or internal data.
 *
 * Empty means nothing matched, which is not the same as safe — see the note at the top.
 */
export function scanForSecrets(text: string): SecretFinding[] {
  if (!text.trim()) return [];

  return [
    ...collect(text, EMAIL, "email", (m) => !PLACEHOLDER_EMAIL.test(m)),
    ...collect(text, IBAN, "iban", (m) => /\d/.test(m.slice(4))),
    ...collect(text, CARD, "payment_card", (m) => passesLuhn(m.replace(/[ -]/g, ""))),
    ...collect(text, PRIVATE_HOST, "private_host"),
    ...collect(text, API_KEY, "api_key"),
    ...collect(text, INTL_PHONE, "international_phone"),
  ].sort((a, b) => a.index - b.index);
}

/** What to tell the user, without repeating the value back at them. */
export function formatSecrets(findings: readonly SecretFinding[]): string {
  if (findings.length === 0) return "no personal or internal data matched";
  const byKind = new Map<SecretKind, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  const summary = [...byKind.entries()].map(([kind, n]) => `${n} ${kind}`).join(", ");
  return `${summary} — mask, crop out, or recapture from a demo account. Matches: ${findings.map((f) => f.redacted).join(", ")}`;
}
