import { existsSync } from "node:fs";
import path from "node:path";
import { hookSummary, measureHook, saveVerdict } from "../../../src/create/hook.js";
import { buildVariants, setAB, useVariant } from "../../../src/create/hooks.js";

/**
 * The hook: the first 3 seconds of a finished reel.
 *
 *   npm run hook -- check <reel.json>                 measure the master's hook (and the text under Instagram's UI)
 *   npm run hook -- verdict <reel.json> --score 1-10 --clear yes|no --gap yes|no --line "…" [--rewrite "…" --why "…"]
 *   npm run hook -- variants <reel.json>              join and measure a master for each <beat>-hook-{a,b,c} clip
 *   npm run hook -- use <reel.json> <a|b|c|original>  put that hook in (no render)
 *   npm run hook -- ab <reel.json> <x> <y> | --clear  two hooks to post against each other
 */
const argv = process.argv.slice(2);
const cwd = process.env.INIT_CWD ?? process.cwd();
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(v ?? "");
const reel = argv[1] ? path.resolve(cwd, argv[1]) : undefined;
const usage = () => { console.error("usage: hook.ts check|verdict|variants|use|ab <reel.json> …"); process.exit(2); };

async function main(): Promise<void> {
  if (!reel || !existsSync(reel)) usage();
  const rp = reel!;
  switch (argv[0]) {
    case "check": {
      const r = await measureHook(rp);
      console.log(hookSummary(rp, r));
      break;
    }
    case "verdict": {
      const line = flag("--line");
      if (!flag("--score") || !line) { console.error("verdict: --score and --line are needed"); process.exit(2); }
      const r = saveVerdict(rp, { score: Number(flag("--score")), clear: yes(flag("--clear")), gap: yes(flag("--gap")), line, rewrite: flag("--rewrite"), why: flag("--why") });
      console.log(`hook verdict saved: ${r.verdict!.score}/10 · ${r.verdict!.line}${r.verdict!.rewrite ? `\n  rewrite: “${r.verdict!.rewrite}”` : ""}`);
      if (r.verdict!.score < 7) console.log("  The hook is weak: propose the rewrite to the owner (AskUserQuestion: \"Fix the hook (Recommended)\" / \"Make 3 hooks to compare\" / \"Keep it\") and wait for the answer.");
      break;
    }
    case "variants": {
      const set = await buildVariants(rp);
      for (const v of set.variants) console.log(`${v.id === set.chosen ? "*" : " "} ${v.id.padEnd(8)} ${String(v.score).padStart(3)}/100  “${v.line}”${v.angle ? ` (${v.angle})` : ""}${v.strip ? `\n             strip: ${path.join(path.dirname(rp), v.strip)}` : ""}${v.flags.length ? `\n             ${v.flags.map((f) => f.line).join("\n             ")}` : ""}`);
      console.log("The owner picks one (or two for an A/B test) in the studio's Hook card.");
      break;
    }
    case "use": {
      const set = useVariant(rp, argv[2] ?? "");
      console.log(`hook ${set.chosen} is in: reel.json, clips/${set.beat}.mp4, master.mp4 and poster.jpg updated`);
      await measureHook(rp);
      break;
    }
    case "ab": {
      const set = argv.includes("--clear") ? setAB(rp, null) : setAB(rp, [argv[2] ?? "", argv[3] ?? ""]);
      console.log(set.ab ? `A/B: ${set.ab.join(" against ")}` : "A/B cleared");
      break;
    }
    default: usage();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
