import { MOVES, moveById, STAGE_CSS, type ClawdMove } from "./moves.js";

/**
 * Compositions that are only Clawd: a move or a pack pose on its own, in any style and look. The overlay command renders
 * them with a transparent ground (`npm run clawd -- overlay`), and the studio's Clawd page plays a sheet of them.
 */

export interface ClawdShot {
  /** "move:<id>" or "pose:<id>". */
  what: string;
  /** A personality style id (claymation, paper-cutout, linear…), or none for flat. */
  style?: string;
  /** The kit's look: paper, ink, cool… (default paper). */
  look?: string;
  width?: number;
  height?: number;
  /** No ground, grain or mesh: only Clawd, for laying over other footage. */
  transparent?: boolean;
}

/** The score and length for "move:<id>" or "pose:<id>", or an error that says what exists. */
export function shotScore(what: string): { score: string; seconds: number; stage?: string; name: string } {
  const [kind, id] = what.includes(":") ? (what.split(":") as [string, string]) : ["move", what];
  if (kind === "pose") return { name: id, seconds: 2.8, score: `RC.clawd.pose(tl, c, 0.15, ${JSON.stringify(id)}, { dur: 2.3 });` };
  const m: ClawdMove | undefined = moveById(id);
  if (!m) throw new Error(`no Clawd move "${id}" (moves: ${MOVES.map((x) => x.id).join(", ")}; or pose:<id>)`);
  return { name: m.name, seconds: m.seconds, score: m.score, ...(m.stage ? { stage: m.stage } : {}) };
}

/** A HyperFrames composition of one shot. `id` becomes its composition id and timeline key. */
export function shotComposition(id: string, shot: ClawdShot): { html: string; seconds: number } {
  const W = shot.width ?? 1080, H = shot.height ?? 1080;
  const s = shotScore(shot.what);
  const ground = shot.transparent ? "#root { background: transparent !important; }" : "";
  const style = shot.style ? ` data-style="${shot.style}"` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head><body>
<template>
<style>${STAGE_CSS}${ground}
  #root .cam { position: absolute; inset: 0; }
</style>
<div id="root" data-look="${shot.look ?? "paper"}"${style} data-composition-id="${id}" data-width="${W}" data-height="${H}">
  <div class="cam">${shot.transparent ? "" : s.stage ?? ""}</div>
</div>
<script>
(function () {
  var tl = gsap.timeline({ paused: true }), W = ${W}, H = ${H};
  var c = RC.clawd("#root .cam", { x: W / 2, y: Math.round(H * 0.78), size: Math.round(Math.min(W, H) * 0.32), seed: 11 });
  ${s.score}
  RC.clawd.life(tl, c, 0, ${s.seconds});
  RC.hold(tl, ${s.seconds});
  window.__timelines["${id}"] = RC.cadence ? RC.cadence(tl, "#root") : tl;
})();
</script>
</template>
</body></html>
`;
  return { html, seconds: s.seconds };
}

/**
 * The studio's Clawd page: one page playing many shots at once, each in its cell and on a loop, with a star on each.
 * Real time, not a render: `kitCss` and `kitJs` are the kit as the studio serves it, `gsapUrl` where GSAP comes from.
 */
export function sheetPage(args: { shots: { what: string; label: string; starred: boolean }[]; style?: string; look?: string; kitCss: string; kitJs: string; gsapUrl: string }): string {
  const cell = 250;
  const cells = args.shots.map((sh, i) => {
    const s = shotScore(sh.what);
    return { i, what: sh.what, label: sh.label, starred: sh.starred, seconds: s.seconds, score: s.score, stage: s.stage ?? "" };
  });
  const style = args.style ? ` data-style="${args.style}"` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<script src="${args.gsapUrl}"></script>
<style>${args.kitCss}</style>
<style>${STAGE_CSS}
  html, body { margin: 0; background: transparent; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, ${cell}px); gap: 14px; padding: 2px; justify-content: start; }
  /* Each card carries the look, so its label sits on the look's own ground. */
  .cell[data-look] { position: relative; inset: auto; width: ${cell}px; height: ${cell + 34}px; border-radius: 18px; overflow: hidden; cursor: pointer; }
  .cell .stage { position: absolute; left: 0; top: 0; width: 1080px; height: 1080px; transform: scale(${cell / 1080}); transform-origin: 0 0; overflow: hidden; }
  .cell .cam { position: absolute; inset: 0; }
  .cell .lab { position: absolute; left: 12px; right: 40px; bottom: 6px; font: 600 13px ui-monospace, monospace; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell .star { position: absolute; right: 10px; bottom: 4px; font: 18px system-ui; color: var(--muted); }
  .cell.on .star { color: #f5b400; }
</style>
</head><body>
<div class="sheet">${cells.map((c) => `
  <div class="cell${c.starred ? " on" : ""}" data-what="${c.what}" title="${c.what}" data-look="${args.look ?? "paper"}"${style}>
    <div class="stage" id="s${c.i}"><div class="cam">${c.stage}</div></div>
    <div class="lab">${c.label}</div><div class="star">★</div>
  </div>`).join("")}
</div>
<script>window.__timelines = {};</script>
<script>${args.kitJs}</script>
<script>
// Each cell is its own small scene, looping. The studio plays them in real time; renders never loop.
${cells.map((c) => `(function () {
  var stage = document.getElementById("s${c.i}"), W = 1080, H = 1080, tl = gsap.timeline({ paused: true });
  try {
    var c = RC.clawd(stage.querySelector(".cam"), { x: W / 2, y: Math.round(H * 0.78), size: 340, seed: ${c.i + 3} });
    ${c.score.replace(/#root /g, `#s${c.i} `)}
    RC.clawd.life(tl, c, 0, ${c.seconds});
    RC.hold(tl, ${c.seconds} + 0.6);
    var played = RC.cadence ? RC.cadence(tl, stage) : tl;
    played.eventCallback("onComplete", function () { played.restart(); });
    played.play();
  } catch (e) { stage.innerHTML = "<p style='padding:40px;font:24px monospace'>" + e.message + "</p>"; }
})();`).join("\n")}
// The studio sizes the frame to the sheet, so the page scrolls instead of the frame.
function sendHeight() { parent.postMessage({ clawdSheetHeight: document.documentElement.scrollHeight }, location.origin); }
addEventListener("load", sendHeight);
new ResizeObserver(sendHeight).observe(document.body);
document.querySelectorAll(".cell").forEach(function (el) {
  el.addEventListener("click", function () {
    var on = !el.classList.contains("on");
    el.classList.toggle("on", on);
    fetch("/api/clawd/favourites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: el.dataset.what, star: on }) });
  });
});
</script>
</body></html>`;
}
