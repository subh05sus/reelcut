import { signalId } from "../learnings/store.js";
import { subjectOf } from "../learnings/signals.js";
import type { Signal } from "../learnings/schema.js";
import type { Reference } from "./schema.js";

/**
 * The facts a set of references gives the studio to learn from.
 *
 * What was **measured** counts straight away (how it cuts, how light it is). What Claude **saw** (the moves,
 * how type is set) counts only once a person has accepted it, because a label is a guess and a rule that
 * steers every reel should not rest on one. A reference that is switched off teaches nothing.
 */
export function referenceSignals(refs: readonly Reference[]): Signal[] {
  const out: Signal[] = [];
  for (const r of refs) {
    if (!r.include) continue;
    const push = (type: "pacing" | "ground" | "move" | "typestyle", value: string | undefined): void => {
      const subject = subjectOf(type, value);
      if (!subject) return;
      out.push({ id: signalId("reference", r.id, subject.type, subject.value), type: "reference", subject, reference: r.id, at: r.addedAt });
    };
    push("pacing", r.analysis.pacing);
    push("ground", r.analysis.ground);
    if (r.annotation?.reviewed) {
      for (const m of r.annotation.moves) push("move", m);
      push("typestyle", r.annotation.textStyle);
    }
  }
  return out;
}
