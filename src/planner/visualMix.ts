import { TEXT_LEAD_CAP, VISUAL_MIX_LABELS, visualForIntent, type Beat, type PlanningLogEntry, type PlanWarning, type VisualMix } from "../core/index.js";
import { isLeadBeat } from "./continuation.js";

/**
 * How much of a reel is allowed to be text on a background.
 *
 * The reported symptom was "the main output is always pure Textoverlay". The cause is one line:
 * `continuation.ts` promotes every sentence that has no strong visual of its own, and that cannot
 * continue the previous scene, to a `text_overlay` LEAD. It fires constantly, because the keyword
 * classifier needs very specific German to say anything else (`"schritt fuer schritt"`,
 * `"diagramm"`, `"so funktioniert"`) and its default is `none`. `text_overlay` is also first in
 * `density.ts`'s `DOWNGRADE_ORDER`, so the planner reaches for it a second time whenever a bucket
 * is too dense.
 *
 * And `visualType` is not cosmetic: it reaches the scene director as `- Visual category:` in the
 * prompt and is what `deterministicDirector` routes on. A text classification propagates all the
 * way to the frame.
 *
 * Two halves fix it, and both are needed. `visualForIntent` gives the promotion something better to
 * reach for than text. This module then enforces a ratio, because a corrected default with nothing
 * holding it is a default that drifts back — the repo has watched that happen to `swap`, to
 * `timeline` and to `annotation_callout.target`.
 */

export {
  DEFAULT_VISUAL_MIX,
  isVisualMix,
  TEXT_LEAD_CAP,
  VISUAL_FOR_INTENT,
  VISUAL_MIX_LABELS,
  VISUAL_MIXES,
  visualForIntent,
  VisualMixSchema,
  type VisualMix,
} from "../core/index.js";

export interface VisualMixResult {
  beats: Beat[];
  planningLog: PlanningLogEntry[];
  warnings: PlanWarning[];
}

/**
 * Brings the share of text leads down to the preset's cap, and says what it changed.
 *
 * Corrective rather than fatal, for the same reason `applyDensityEnforcement` is: refusing to
 * create the reel would leave a person with a script and no way in, over a judgement about pacing.
 * A lead is re-typed, never dropped or merged — the beat timeline is already fixed by this point
 * and changing it here would invalidate the density decisions just made above.
 *
 * Text leads are converted worst-first: the ones whose own intent says they should have been
 * something else go before the ones that are genuinely text. A reel of nothing but `cta` and
 * `claim` sentences therefore keeps its text beats and gets a warning rather than a pile of
 * fabricated diagrams.
 */
export function applyVisualMix(beats: readonly Beat[], mix: VisualMix): VisualMixResult {
  const planningLog: PlanningLogEntry[] = [];
  const warnings: PlanWarning[] = [];
  const result = [...beats].sort((a, b) => a.index - b.index).map((beat) => ({ ...beat }));

  const leads = result.filter(isLeadBeat);
  if (leads.length === 0) return { beats: result, planningLog, warnings };

  const cap = TEXT_LEAD_CAP[mix];
  const allowed = Math.floor(leads.length * cap);
  const textLeads = leads.filter((beat) => beat.visualType === "text_overlay");
  if (textLeads.length <= allowed) return { beats: result, planningLog, warnings };

  // Worst first: a `number` sentence rendered as a caption is a clearer mistake than a `cta` one.
  const convertible = textLeads
    .filter((beat) => visualForIntent(beat.beatIntent) !== "text_overlay")
    .sort((a, b) => a.index - b.index);

  let converted = 0;
  for (const beat of convertible) {
    if (textLeads.length - converted <= allowed) break;
    const target = result.find((entry) => entry.id === beat.id)!;
    const next = visualForIntent(target.beatIntent);
    planningLog.push({
      type: "visual_mix_retyped",
      beatId: target.id,
      message: `${target.id}: text_overlay → ${next} (Intent „${target.beatIntent ?? "unbekannt"}“) — Textanteil über ${Math.round(cap * 100)} %.`,
    });
    target.visualType = next;
    converted += 1;
  }

  const remaining = textLeads.length - converted;
  if (remaining > allowed) {
    warnings.push({
      code: "visual_mix_text_heavy",
      message:
        `${remaining} von ${leads.length} Szenen sind reine Textbeats (erlaubt: ${allowed} bei „${VISUAL_MIX_LABELS[mix]}“). ` +
        `Die übrigen lassen sich nicht sinnvoll umtypisieren — ihr Intent ist selbst Text (meist „cta“). ` +
        `Entweder ist das Skript wirklich so, oder es braucht konkretere Sätze, die etwas Sichtbares benennen.`,
    });
  }

  return { beats: result, planningLog, warnings };
}

/** The share of scene leads that are pure text — what the gate above measures, exposed for tests
 *  and for the UI's own readout. */
export function textLeadRatio(beats: readonly Beat[]): { textLeads: number; leads: number; ratio: number } {
  const leads = beats.filter(isLeadBeat);
  const textLeads = leads.filter((beat) => beat.visualType === "text_overlay").length;
  return { textLeads, leads: leads.length, ratio: leads.length === 0 ? 0 : textLeads / leads.length };
}
