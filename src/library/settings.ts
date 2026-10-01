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
 */

const SettingsSchema = z.object({
  version: z.literal(1),
  ingestPaused: z.boolean().default(false),
  pausedAt: z.string().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

function settingsPath(): string {
  return path.join(reelcutHome(), "settings.json");
}

export function loadSettings(): Settings {
  return readValidated(settingsPath(), (raw) => SettingsSchema.safeParse(raw), { version: 1 as const, ingestPaused: false });
}

export function isIngestPaused(): boolean {
  return loadSettings().ingestPaused;
}

export function setIngestPaused(paused: boolean): Settings {
  return withLock(`${settingsPath()}.lock`, () => {
    const next: Settings = { version: 1, ingestPaused: paused, ...(paused ? { pausedAt: new Date().toISOString() } : {}) };
    writeAtomic(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}
