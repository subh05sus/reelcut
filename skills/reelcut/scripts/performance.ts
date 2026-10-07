import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPerformance, insights, latest, readPerformance, reelFacts, type PerfRow } from "../../../src/create/performance.js";

/**
 * How posted reels performed.
 *
 *   npm run performance -- add out/reel.json --platform instagram --source screenshot --views 1200 --avg-watch 9.5 \
 *       [--reach N] [--likes N] [--comments N] [--shares N] [--saves N] [--follows N] [--retention3s 64] [--completion 22] [--captured 2026-10-08]
 *   npm run performance -- summary [--json]      every reel with results, and what differs between them
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (argv[0] === "add") {
  const reel = argv[1];
  if (!reel || !existsSync(reel)) { console.error("add: give the reel.json"); process.exit(2); }
  const e = addPerformance(path.resolve(reel), {
    platform: flag("--platform") ?? "other", source: (flag("--source") ?? "typed") as never, capturedAt: flag("--captured"),
    views: flag("--views") as never, reach: flag("--reach") as never, likes: flag("--likes") as never, comments: flag("--comments") as never,
    shares: flag("--shares") as never, saves: flag("--saves") as never, follows: flag("--follows") as never,
    avgWatchSeconds: flag("--avg-watch") as never, retention3s: flag("--retention3s") as never, completionRate: flag("--completion") as never, note: flag("--note"),
  });
  console.log(`recorded ${e.platform}: ${Object.entries(e).filter(([k]) => !["platform", "capturedAt", "source"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
} else if (argv[0] === "summary") {
  const rows: PerfRow[] = readdirSync(REPO).filter((d) => /^out(-|$)/.test(d)).map((d) => path.join(REPO, d, "reel.json"))
    .filter((p) => existsSync(p) && readPerformance(p).length)
    .map((p) => ({ conversation: "", title: path.basename(path.dirname(p)), reel: p, facts: reelFacts(p), latest: latest(readPerformance(p)) }));
  const found = insights(rows);
  if (argv.includes("--json")) console.log(JSON.stringify({ rows, insights: found }, null, 1));
  else {
    if (!rows.length) console.log("No reel has results yet.");
    for (const r of rows) console.log(`${r.title} · ${r.facts.seconds} s · ${r.facts.style ?? "?"}: ${r.latest.map((e) => `${e.platform} ${e.views ?? "?"} views${e.avgWatchSeconds != null ? `, ${e.avgWatchSeconds} s watched` : ""}`).join("; ")}`);
    for (const i of found.slice(0, 6)) console.log(`- ${i.by} ${i.value}: ${Math.round(i.hold * 100)}% watched (${i.reels} reels) vs ${Math.round(i.versus.hold * 100)}% (${i.versus.reels})`);
  }
} else { console.error("usage: performance.ts add <reel.json> --platform … | summary [--json]"); process.exit(2); }
