import { describe, expect, it } from "vitest";
import { formatSecrets, passesLuhn, scanForSecrets } from "../src/capture/secrets.js";

const kinds = (text: string) => scanForSecrets(text).map((f) => f.kind);

describe("passesLuhn", () => {
  it("accepts real test card numbers", () => {
    for (const card of ["4242424242424242", "5555555555554444", "378282246310005"]) {
      expect(passesLuhn(card)).toBe(true);
    }
  });

  /*
   * The whole reason Luhn is here: a 16-digit order number looks exactly like a card until you
   * check it, and roughly 90% of random digit runs fail.
   */
  it("rejects a digit run that merely looks like one", () => {
    expect(passesLuhn("1234567890123456")).toBe(false);
    expect(passesLuhn("0000000000000001")).toBe(false);
  });

  it("rejects anything outside card length", () => {
    expect(passesLuhn("42424242424")).toBe(false);
    expect(passesLuhn("42424242424242424242")).toBe(false);
  });
});

describe("scanForSecrets — what it must catch", () => {
  it("finds a real-looking account email", () => {
    expect(kinds("Signed in as a.muster@kundenportal.de")).toContain("email");
  });

  it("finds an IBAN", () => {
    expect(kinds("IBAN DE89370400440532013000")).toContain("iban");
  });

  it("finds a card number, grouped or not", () => {
    expect(kinds("Visa ending 4242 4242 4242 4242")).toContain("payment_card");
    expect(kinds("4242424242424242")).toContain("payment_card");
  });

  it("finds an internal host", () => {
    expect(kinds("api.internal/v2")).toContain("private_host");
    expect(kinds("running on 192.168.1.14")).toContain("private_host");
    expect(kinds("http://localhost:3000/admin")).toContain("private_host");
  });

  it("finds a vendor-prefixed key", () => {
    expect(kinds("sk_live_51H8xKfJ2eZvKYlo2C9abcdef")).toContain("api_key");
    expect(kinds("ghp_16C7e42F292c6912E7710c838347Ae178B4a")).toContain("api_key");
  });

  it("finds an internationally formatted phone number", () => {
    expect(kinds("Call +49 30 901820 for support")).toContain("international_phone");
  });

  it("reports several findings in order", () => {
    const found = scanForSecrets("a@real.co then DE89370400440532013000");
    expect(found).toHaveLength(2);
    expect(found[0]!.index).toBeLessThan(found[1]!.index);
  });
});

describe("scanForSecrets — what it must NOT catch", () => {
  /*
   * A blocking gate with false positives is a gate people switch off. This repo has shipped a
   * jitter detector with 346 of them, a pop detector with 41, and a blank-panel detector that
   * flagged two well-composed title cards. Precision first.
   */
  it("ignores placeholder and role addresses", () => {
    for (const text of ["jane@example.com", "user@test.de", "info@acme.com", "hello@beispiel.de", "support@anything.io", "noreply@service.com"]) {
      expect(kinds(text)).not.toContain("email");
    }
  });

  it("ignores a bare digit run that is not a card", () => {
    expect(kinds("Order 1234567890123456")).not.toContain("payment_card");
    expect(kinds("Invoice 2026091800042")).not.toContain("payment_card");
  });

  /*
   * The pattern deliberately left out. "+49 30 901820" and "Version 4.9 30 901820" are hard to
   * separate, and dates and order numbers look identical to bare phone numbers.
   */
  it("ignores bare digit groups that could be a phone number", () => {
    for (const text of ["030 901820", "Version 4.9.30", "2026-09-28", "call 555 0134"]) {
      expect(kinds(text)).not.toContain("international_phone");
    }
  });

  it("ignores public hostnames and version strings", () => {
    expect(kinds("visit anthropic.com/brand")).not.toContain("private_host");
    expect(kinds("chat.openai.com")).not.toContain("private_host");
  });

  it("ignores a bare hex string, which is far too common to block on", () => {
    expect(kinds("commit 55961cd8f2a1b3c4d5e6f70819")).not.toContain("api_key");
  });

  it("finds nothing in an ordinary product screen", () => {
    const screen = "Dashboard — Projects  Artifacts  Scheduled. You have used 75% of your weekly limit. Get more usage. Write a message…";
    expect(scanForSecrets(screen)).toEqual([]);
  });

  it("finds nothing in empty or whitespace text", () => {
    expect(scanForSecrets("")).toEqual([]);
    expect(scanForSecrets("   \n  ")).toEqual([]);
  });
});

describe("formatSecrets", () => {
  it("never repeats the value back in full", () => {
    const text = formatSecrets(scanForSecrets("a.muster@kundenportal.de"));
    expect(text).not.toContain("a.muster@kundenportal.de");
    expect(text).toMatch(/a\.m\*\*\*/);
  });

  it("counts by kind and says what to do", () => {
    const text = formatSecrets(scanForSecrets("a@real.co and b@other.co and DE89370400440532013000"));
    expect(text).toMatch(/2 email/);
    expect(text).toMatch(/1 iban/);
    expect(text).toMatch(/mask, crop out, or recapture/);
  });

  it("says so plainly when there is nothing", () => {
    expect(formatSecrets([])).toBe("no personal or internal data matched");
  });
});
