import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reelcutHome } from "../../../src/library/store.js";
import {
  STYLES, defaultPersonality, getPersonality, previewComposition, styleById, type PreviewKind, type Personality, type StyleSpec,
} from "../../../src/personality/index.js";

/**
 * The personality on the command line.
 *
 *   npm run personality -- previews [--only claymation,swiss] [--kind sample|showcase|both] [--quality draft|looks]
 *       Render the style previews the Personality page shows (once; they are saved in ~/.reelcut/style-previews):
 *       every style's comparable sample and its showcase, 1:1, 4 s, a loop MP4 and a poster each.
 *   npm run personality -- mini <personality id> [--quality draft|looks]
 *       Render a mini beat per chosen style in that personality's colours, type, motion and texture
 *       (~/.reelcut/personality-renders/<id>/<style>.mp4).
 *   npm run personality -- patterns
 *       Write each style's showcase to assets/patterns/styles/<style>.html (the reference to open before composing in it).
 *   npm run personality -- brief [--json]
 *       The default personality, for Step 0: what it answers and how a reel uses it.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const previewDir = (): string => path.join(reelcutHome(), "style-previews");
export const miniDir = (id: string): string => path.join(reelcutHome(), "personality-renders", id);

interface Item { id: string; html: string; out: string }

function renderItems(items: Item[], work: string, quality: string): number {
  mkdirSync(path.join(work, "src"), { recursive: true });
  const beats = items.map((it) => {
    const file = path.join(work, "src", `${it.id}.html`);
    writeFileSync(file, it.html);
    return { id: it.id, durationSeconds: 4, composition: file };
  });
  const manifest = path.join(work, "reel.json");
  writeFileSync(manifest, `${JSON.stringify({ format: "1:1", fps: 60, beats }, null, 2)}\n`);
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const r = spawnSync(process.execPath, [tsx, path.join(REPO, "skills", "reelcut", "scripts", "render.ts"), manifest, "--clips-only", "--no-record", "--quality", quality], { cwd: REPO, stdio: "inherit" });
  let ok = 0;
  for (const it of items) {
    const clip = path.join(work, "clips", `${it.id}.mp4`);
    if (!existsSync(clip)) { console.error(`  ${it.id}: not rendered`); continue; }
    mkdirSync(path.dirname(it.out), { recursive: true });
    copyFileSync(clip, `${it.out}.mp4`);
    // The poster: the settled frame, where everything has landed.
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "3.2", "-i", clip, "-frames:v", "1", "-q:v", "3", `${it.out}.jpg`]);
    ok++;
  }
  console.log(`${ok} of ${items.length} saved.${r.status ? " (the render reported a problem; see above)" : ""}`);
  return ok === items.length ? 0 : 1;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function previews(argv: string[]): number {
  const only = (arg(argv, "--only") ?? "").split(",").filter(Boolean);
  const kind = arg(argv, "--kind") ?? "both";
  const kinds: PreviewKind[] = kind === "both" ? ["sample", "showcase"] : [kind as PreviewKind];
  const styles = only.length ? only.map((id) => styleById(id)).filter((s): s is StyleSpec => !!s) : [...STYLES];
  const items: Item[] = styles.flatMap((s) => kinds.map((k) => {
    // Composition ids start with a letter ("3d" does not), so they carry a prefix; the saved files do not.
    const id = `pv-${s.id}-${k}`;
    return { id, out: path.join(previewDir(), `${s.id}-${k}`), html: previewComposition(s, k, { id, palette: s.palettes[0]!, pairing: s.fonts.best[0]! }) };
  }));
  console.log(`rendering ${items.length} style previews into ${previewDir()}`);
  return renderItems(items, path.join(previewDir(), ".work"), arg(argv, "--quality") ?? "looks");
}

function mini(argv: string[]): number {
  const id = argv[0];
  const p = id ? getPersonality(id) : defaultPersonality();
  if (!p) { console.error(`no personality ${id ?? "(default)"}`); return 1; }
  const items: Item[] = p.styles.map((st) => {
    const s = styleById(st.id)!;
    const cid = `mini-${s.id}`;
    const texture = p.texture.useStyle === false ? { ...s.texture, ...p.texture } as StyleSpec["texture"] : s.texture;
    const cadence = p.motion.cadence === "smooth" ? "smooth" : p.motion.cadence === "stepped" ? "stepped-12" : s.motion.cadence;
    return { id: cid, out: path.join(miniDir(p.id), s.id), html: previewComposition(s, "sample", { id: cid, palette: p.palettes[s.id] ?? s.palettes[0]!, pairing: p.fonts[s.id] ?? s.fonts.best[0]!, energy: p.motion.energy, cadence, texture }) };
  });
  if (!items.length) { console.error("this personality has no styles yet"); return 1; }
  console.log(`rendering ${items.length} mini beat(s) for "${p.name}" into ${miniDir(p.id)}`);
  return renderItems(items, path.join(miniDir(p.id), ".work"), arg(argv.slice(1), "--quality") ?? "looks");
}

export function personalityBrief(p: Personality): string {
  const lines = [`Personality: ${p.name}${p.isDefault ? " (default)" : ""}`];
  for (const st of p.styles) {
    const s = styleById(st.id)!;
    const pal = p.palettes[s.id] ?? s.palettes[0]!;
    lines.push(`  ${s.name} ${st.weight}%: look ${s.look}, palette ${pal.name} (ground ${pal.ground}, ink ${pal.ink}, accent ${pal.accent}, second ${pal.accent2}), type ${p.fonts[s.id] ?? s.fonts.best[0]}, ${s.render === "render" ? "rendered by the kit" : "directed"}`);
    lines.push(`    moves: prefer ${s.moves.prefer.join(", ")}; avoid ${s.moves.avoid.join(", ")}. Motion: ${s.motion.note}.`);
  }
  const beats = Object.entries(p.beatStyles).map(([k, v]) => `${k} → ${styleById(v)?.name ?? v}`).join(", ");
  if (beats) lines.push(`  Beats: ${beats}`);
  lines.push(`  Motion: ${p.motion.energy}, camera ${p.motion.camera}, overshoot ${p.motion.overshoot}, between beats ${p.motion.transitions}, cadence ${p.motion.cadence}`);
  lines.push(`  Signature: intro ${p.signature.intro}, logo ${p.signature.logoReveal}, lower third ${p.signature.lowerThird}, end card ${p.signature.endCard}, key word ${p.signature.emphasis}, captions ${p.signature.captions}${p.signature.tagline ? `, tagline "${p.signature.tagline}"` : ""}`);
  lines.push(`  Copy: ${p.copy.case} case, full stops ${p.copy.punctuation}, ${p.copy.quotes} quotes, numbers as ${p.copy.numbers}, ${p.copy.voice} voice${p.copy.emoji ? ", emoji allowed" : ", no emoji"}`);
  lines.push(`  Sound: effects ${p.sound.effects} (${p.sound.effectsLevel}), music ${p.sound.music} ${p.sound.bpm[0]}–${p.sound.bpm[1]} BPM`);
  lines.push(`  Pacing: text ${p.pacing.text}, beats ${p.pacing.beatSeconds[0]}–${p.pacing.beatSeconds[1]} s, payoff holds ${p.pacing.payoffHold} s, format ${p.pacing.format}`);
  const g = p.guardrails;
  const never = [...g.bannedColors.map((c) => `colour ${c}`), ...g.bannedFonts.map((f) => `font ${f}`), ...g.bannedMoves.map((m) => `move ${m}`), ...(g.noGlass ? ["glass"] : []), ...(g.noConfetti ? ["confetti"] : [])];
  lines.push(`  Never: ${never.length ? never.join(", ") : "nothing banned"}; at most ${g.maxFonts} type families; text contrast ≥ ${g.contrast}:1${g.notes ? `; ${g.notes}` : ""}`);
  if (p.brand.name || p.brand.url) lines.push(`  Brand: ${p.brand.name}${p.brand.url ? ` (${p.brand.url})` : ""}${p.brand.colors.length ? `, colours ${p.brand.colors.join(" ")}` : ""}`);
  return lines.join("\n");
}

function brief(argv: string[]): number {
  const p = defaultPersonality();
  if (!p) { console.log(argv.includes("--json") ? "null" : "No personality yet: Step 0 asks as usual. One can be made in the studio's Personality page."); return 0; }
  console.log(argv.includes("--json") ? JSON.stringify(p, null, 2) : personalityBrief(p));
  return 0;
}

/** The style patterns: each style's showcase as a composition to open before composing a beat in it. */
export const STYLE_PATTERN_DIR = path.join(REPO, "skills", "reelcut", "assets", "patterns", "styles");
export function stylePatternHtml(s: StyleSpec): string {
  return previewComposition(s, "showcase", { id: `style-${s.id}`, palette: s.palettes[0]!, pairing: s.fonts.best[0]! });
}
function patterns(): number {
  mkdirSync(STYLE_PATTERN_DIR, { recursive: true });
  for (const s of STYLES) writeFileSync(path.join(STYLE_PATTERN_DIR, `${s.id}.html`), stylePatternHtml(s));
  console.log(`${STYLES.length} style patterns written to ${STYLE_PATTERN_DIR}`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const code = cmd === "previews" ? previews(rest) : cmd === "mini" ? mini(rest) : cmd === "brief" ? brief(rest) : cmd === "patterns" ? patterns()
  : (console.error("usage: personality.ts previews [--only a,b] [--kind sample|showcase|both] | mini <id> | brief [--json] | patterns"), 2);
process.exitCode = code;
