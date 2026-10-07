/**
 * The reel's motion energy, carried to every beat as `data-motion` on its root, where the kit's springs read it:
 * `restrained` is slower and fully damped, `default` is Apple's own springs, `energetic` is quicker and lets presses
 * and pops overshoot a little. A beat that set its own keeps it.
 */
export const MOTION_LEVELS = ["restrained", "default", "energetic"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];

export function isMotionLevel(v: unknown): v is MotionLevel {
  return typeof v === "string" && (MOTION_LEVELS as readonly string[]).includes(v);
}

/** Give a composition the reel's motion energy unless its root chose one. Unchanged without a kit root or a known level. */
export function applyDefaultMotion(html: string, motion: string | undefined): string {
  if (!isMotionLevel(motion) || motion === "default") return html;
  const root = /<[a-z]+[^>]*\bid=["']root["'][^>]*>/i.exec(html)?.[0];
  if (!root || !/\bdata-look\s*=/.test(root) || /\bdata-motion\s*=/.test(root)) return html;
  return html.replace(root, root.replace(/>$/, ` data-motion="${motion}">`));
}
