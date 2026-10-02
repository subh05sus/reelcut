import path from "node:path";
import { z } from "zod";
import { readValidated, reelcutHome, withLock, writeAtomic } from "./store.js";

/**
 * Switches that outlive a restart and are shared between the studio and the command line.
 *
 * `ingestPaused` is the master pause: while it is on, no watched folder is read, scanned or indexed,
 * and a scan in progress stops starting new files. It lives in a file rather than in the server's
 * memory so that pausing from the dashboard holds if the studio is restarted, and so that
 * `npm run library -- pause` and the page are the same control.
 *
 * `higgsfield` is whether a reel may use Higgsfield for the beats that can be generated: `ask` (the
 * default: Step 0 asks, when the MCP is connected), `always` (use it whenever it is connected) or
 * `never`. It decides whether a question is asked; it never makes anything happen on its own.
 */

export const HIGGSFIELD_SETTINGS = ["ask", "always", "never"] as const;
export type HiggsfieldSetting = (typeof HIGGSFIELD_SETTINGS)[number];

const SettingsSchema = z.object({
  version: z.literal(1),
  ingestPaused: z.boolean().default(false),
  pausedAt: z.string().optional(),
  higgsfield: z.enum(HIGGSFIELD_SETTINGS).default("ask"),
});
export type Settings = z.infer<typeof SettingsSchema>;

function settingsPath(): string {
  return path.join(reelcutHome(), "settings.json");
}

export function loadSettings(): Settings {
  return readValidated(settingsPath(), (raw) => SettingsSchema.safeParse(raw), { version: 1 as const, ingestPaused: false, higgsfield: "ask" as const });
}

/** Change some settings and keep the rest: a switch is never reset by another switch being flipped. */
export function updateSettings(patch: Partial<Pick<Settings, "ingestPaused" | "higgsfield">>): Settings {
  return withLock(`${settingsPath()}.lock`, () => {
    const current = loadSettings();
    const next: Settings = { ...current, ...patch };
    if (patch.ingestPaused !== undefined) {
      if (patch.ingestPaused) next.pausedAt = new Date().toISOString();
      else delete next.pausedAt;
    }
    writeAtomic(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

export function isIngestPaused(): boolean {
  return loadSettings().ingestPaused;
}

export function setIngestPaused(paused: boolean): Settings {
  return updateSettings({ ingestPaused: paused });
}

export function getHiggsfieldSetting(): HiggsfieldSetting {
  return loadSettings().higgsfield;
}

export function setHiggsfieldSetting(value: HiggsfieldSetting): Settings {
  return updateSettings({ higgsfield: value });
}
