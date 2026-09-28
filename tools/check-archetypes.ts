import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectComposition } from "../src/render/project.js";

/**
 * Render every archetype on its own and put each through the same gates a real beat gets.
 *
 *   npm run archetypes:check [-- name …]
 *
 * An archetype is the fallback for when composing a beat failed, so the one thing it may not do is
 * fail too. This wraps each file as a one-beat reel and hands the lot to the real render script —
 * the hyperframes check (non-zero samples), the render, and the frame checker — rather than a
 * second, friendlier path that could drift from the one users hit.
 *
 * Before rendering it checks what the render would only discover by freezing: that the file's
 * `data-composition-id` and its `__timelines` key both equal the filename. A mismatch renders
 * frozen at t=0 with no error, and the library shipped with six experiment ids (`sc-00` …) that
 * only matched because nobody had wrapped one under its own name.
 *
 * Each archetype declares how long it wants to run in a header comment,
 * `<!-- archetype seconds=4.2 -->` — the time its motion needs plus the reading floor of its
 * placeholder text. A missing header is an error: a guessed duration either cuts the motion off or
 * pads a hold that then reads as a stall.
 */

const cwd = process.env.INIT_CWD ?? process.cwd();
const root = path.resolve(import.meta.dirname, "..");
const library = path.join(root, "skills/reelcut/assets/archetypes");
const outDir = path.resolve(cwd, "out/archetypes");

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = readdirSync(library)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.html$/, "")))
  .sort();

const problems: string[] = [];
const beats = files.flatMap((file) => {
  const id = file.replace(/\.html$/, "");
  const html = readFileSync(path.join(library, file), "utf8");
  const seconds = Number(/<!--\s*archetype seconds=([\d.]+)\s*-->/.exec(html)?.[1] ?? "NaN");
  const shape = inspectComposition(html);
  if (!Number.isFinite(seconds) || seconds <= 0) problems.push(`${file}: no "<!-- archetype seconds=N -->" header`);
  if (shape.compositionId !== id) problems.push(`${file}: data-composition-id is "${shape.compositionId}", expected "${id}"`);
  if (shape.timelineKey !== id) problems.push(`${file}: timeline key is "${shape.timelineKey}", expected "${id}"`);
  return [{ id, durationSeconds: seconds, composition: path.join(library, file) }];
});

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const manifest = path.join(outDir, "reel.json");
writeFileSync(manifest, JSON.stringify({ format: "1:1", fps: 30, beats }, null, 2));
console.log(`${beats.length} archetypes → ${path.relative(cwd, manifest)}`);

const render = spawnSync("npx", ["tsx", path.join(root, "skills/reelcut/scripts/render.ts"), manifest, "--clips-only"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, INIT_CWD: cwd },
});
process.exit(render.status ?? 1);
