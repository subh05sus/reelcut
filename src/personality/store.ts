import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { readValidated, reelcutHome, withLock, writeAtomic } from "../library/store.js";
import { PersonalitySchema, type Personality, type PersonalityInput } from "./schema.js";

/**
 * `~/.reelcut/personalities.json`: every saved personality, one of them the default.
 * Read-modify-write under a lock via a temp file, like the library and the learnings.
 */
const FileSchema = z.object({ version: z.literal(1), personalities: z.array(PersonalitySchema) });
type File = z.infer<typeof FileSchema>;

const filePath = (): string => path.join(reelcutHome(), "personalities.json");
const empty = (): File => ({ version: 1, personalities: [] });

export function loadPersonalities(): Personality[] {
  return readValidated(filePath(), (raw) => FileSchema.safeParse(raw), empty()).personalities;
}

function mutate<T>(fn: (file: File) => T): T {
  return withLock(`${filePath()}.lock`, () => {
    const file = readValidated(filePath(), (raw) => FileSchema.safeParse(raw), empty());
    const out = fn(file);
    // Exactly one default whenever there is at least one personality.
    if (file.personalities.length && !file.personalities.some((p) => p.isDefault)) file.personalities[0]!.isDefault = true;
    writeAtomic(filePath(), `${JSON.stringify(file, null, 2)}\n`);
    return out;
  });
}

export function defaultPersonality(): Personality | undefined {
  const all = loadPersonalities();
  return all.find((p) => p.isDefault) ?? all[0];
}

export function getPersonality(id: string): Personality | undefined {
  return loadPersonalities().find((p) => p.id === id);
}

/** Create one (an id is made) or replace one with the same id. Returns the stored, validated personality. */
export function savePersonality(input: Omit<PersonalityInput, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string }, now = new Date()): Personality {
  return mutate((file) => {
    const id = input.id ?? `p_${randomBytes(4).toString("hex")}`;
    const prev = file.personalities.find((p) => p.id === id);
    const next = PersonalitySchema.parse({ ...input, id, createdAt: prev?.createdAt ?? input.createdAt ?? now.toISOString(), updatedAt: now.toISOString() });
    if (next.isDefault) file.personalities.forEach((p) => { p.isDefault = false; });
    if (prev) file.personalities[file.personalities.indexOf(prev)] = next;
    else file.personalities.push(next);
    return next;
  });
}

export function setDefaultPersonality(id: string): boolean {
  return mutate((file) => {
    if (!file.personalities.some((p) => p.id === id)) return false;
    file.personalities.forEach((p) => { p.isDefault = p.id === id; });
    return true;
  });
}

export function deletePersonality(id: string): boolean {
  return mutate((file) => {
    const before = file.personalities.length;
    file.personalities = file.personalities.filter((p) => p.id !== id);
    return file.personalities.length < before;
  });
}
