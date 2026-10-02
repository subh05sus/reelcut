import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { LibraryError, readValidated, reelcutHome, withLock, writeAtomic } from "../library/store.js";
import { AnnotationSchema, ReferencesFileSchema, type Annotation, type Reference, type ReferencesFile } from "./schema.js";
import { MOVES, isMove, isTextStyle } from "./vocab.js";
import { referenceSignals } from "./signals.js";
import { syncReferenceSignals } from "../learnings/store.js";

/**
 * `~/.reelcut/references/`: reference videos, their measurements, and what has been seen in them.
 *
 * Its own folder and its own index, written the way the library is (under a lock, via a temp file),
 * and deliberately **not** part of the library: nothing in the matcher, the footage finder or the
 * renderer reads this index, so a reference cannot end up in a reel however it is described.
 */

export function referencesRoot(): string {
  return path.join(reelcutHome(), "references");
}

function indexPath(): string {
  return path.join(referencesRoot(), "references.json");
}

const empty = (): ReferencesFile => ({ version: 1, references: [] });

export function loadReferences(): ReferencesFile {
  return readValidated(indexPath(), (raw) => ReferencesFileSchema.safeParse(raw), empty());
}

export function mutateReferences<T>(fn: (file: ReferencesFile) => T): T {
  return withLock(`${indexPath()}.lock`, () => {
    const file = loadReferences();
    const result = fn(file);
    writeAtomic(indexPath(), `${JSON.stringify(file, null, 2)}\n`);
    return result;
  });
}

export const referenceBlobPath = (r: Pick<Reference, "file">): string => path.join(referencesRoot(), r.file);
export const referenceSheetPath = (r: Pick<Reference, "sheet">): string | undefined => (r.sheet ? path.join(referencesRoot(), r.sheet) : undefined);
export const referenceThumbPath = (r: Pick<Reference, "thumb">): string | undefined => (r.thumb ? path.join(referencesRoot(), r.thumb) : undefined);

/**
 * Rebuild what the studio has learned from references.
 *
 * Reference signals are a pure function of the references on file, so after any change the whole set is
 * rebuilt and a reference that was removed or switched off leaves no evidence behind. Never allowed to
 * fail the change that triggered it.
 */
export function syncLearning(): void {
  try {
    syncReferenceSignals(referenceSignals(loadReferences().references));
  } catch {
    // The reference was saved; the rules will catch up on the next change.
  }
}

/** Move a finished temp file to where it lives, across drives if it must. */
function moveInto(temp: string, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    rmSync(temp, { force: true });
    return;
  }
  try {
    renameSync(temp, target);
  } catch {
    copyFileSync(temp, target);
    unlinkSync(temp);
  }
}

export interface PreparedReference extends Omit<Reference, "annotation"> {
  /** The finished temp file, to be moved to `file`. */
  temp: string;
}

export function addReference(p: PreparedReference): { reference: Reference; existed: boolean } {
  const { temp, ...reference } = p;
  const result = mutateReferences((file) => {
    const existing = file.references.find((r) => r.sha256 === reference.sha256);
    if (existing) {
      rmSync(temp, { force: true });
      return { reference: existing, existed: true };
    }
    moveInto(temp, path.join(referencesRoot(), reference.file));
    file.references.push(reference);
    return { reference, existed: false };
  });
  if (!result.existed) syncLearning();
  return result;
}

export interface ReferencePatch {
  name?: string;
  include?: boolean;
}

export function updateReference(id: string, patch: ReferencePatch): Reference {
  const out = mutateReferences((file) => {
    const ref = file.references.find((r) => r.id === id);
    if (!ref) throw new LibraryError(`no reference ${id}`);
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new LibraryError("a reference needs a name");
      ref.name = patch.name.trim().slice(0, 120);
    }
    if (patch.include !== undefined) ref.include = patch.include;
    return ref;
  });
  if (patch.include !== undefined) syncLearning();
  return out;
}

export interface AnnotationInput {
  moves?: readonly string[];
  textStyle?: string | undefined;
  note?: string | undefined;
}

/**
 * Write what was seen in a reference, in the fixed words.
 *
 * Claude's annotation is stored unreviewed and teaches nothing until a person accepts it; a person's own
 * is accepted as it is written. A word outside the vocabulary is refused, not dropped, so a mistake is
 * seen. Claude cannot overwrite an annotation a person has reviewed.
 */
export function annotateReference(id: string, input: AnnotationInput, by: "claude" | "user"): Reference {
  const unknown = (input.moves ?? []).filter((m) => !isMove(m));
  if (unknown.length) throw new LibraryError(`not a move: ${unknown.join(", ")}. The moves are: ${MOVES.join(", ")}`);
  if (input.textStyle !== undefined && !isTextStyle(input.textStyle)) throw new LibraryError(`not a text style: ${input.textStyle}. Use kinetic, key-lines, minimal or none`);
  const out = mutateReferences((file) => {
    const ref = file.references.find((r) => r.id === id);
    if (!ref) throw new LibraryError(`no reference ${id}`);
    if (by === "claude" && ref.annotation?.reviewed) throw new LibraryError("a person has already reviewed this reference's tags; Claude does not change them");
    const annotation: Annotation = AnnotationSchema.parse({
      moves: [...new Set(input.moves ?? ref.annotation?.moves ?? [])],
      ...(input.textStyle ?? ref.annotation?.textStyle ? { textStyle: input.textStyle ?? ref.annotation?.textStyle } : {}),
      ...(input.note ?? ref.annotation?.note ? { note: (input.note ?? ref.annotation?.note)!.slice(0, 400) } : {}),
      by,
      at: new Date().toISOString(),
      reviewed: by === "user",
    });
    ref.annotation = annotation;
    return ref;
  });
  syncLearning();
  return out;
}

/** A person keeping Claude's tags as they are. */
export function acceptAnnotation(id: string): Reference {
  const out = mutateReferences((file) => {
    const ref = file.references.find((r) => r.id === id);
    if (!ref?.annotation) throw new LibraryError(`reference ${id} has no tags to accept`);
    ref.annotation = { ...ref.annotation, reviewed: true };
    return ref;
  });
  syncLearning();
  return out;
}

export function removeReference(id: string): void {
  const gone = mutateReferences((file) => {
    const at = file.references.findIndex((r) => r.id === id);
    if (at < 0) throw new LibraryError(`no reference ${id}`);
    return file.references.splice(at, 1)[0]!;
  });
  for (const rel of [gone.file, gone.sheet, gone.thumb]) if (rel) rmSync(path.join(referencesRoot(), rel), { force: true });
  syncLearning();
}

/** References a person has not yet looked at the tags of, or that have none: what Claude is asked to study. */
export function needsStudy(r: Reference): boolean {
  return r.include && !r.annotation;
}

export function studyQueue(refs: readonly Reference[]): Reference[] {
  return refs.filter(needsStudy).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}
