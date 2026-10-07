import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeAudio, gainFor } from "../../../src/library/analyze.js";
import { packDir, SFX_CATEGORIES, type PackManifest, type PackSound, type SfxCategory } from "../../../src/library/sfxpack.js";

/**
 * (Maintainers) Build the bundled motion-graphics sound pack from CC0 sources.
 *
 *   npm run sfx-pack -- build [--src <downloads dir>]     download (if needed), curate, process, write assets/sfx
 *
 * Every source is CC0 (public domain): Kenney's audio packs and CC0 sets from OpenGameArt, each licence checked on
 * its own page. A pick takes an even spread of a sound family; each sound is trimmed of silence, peak-normalised to
 * -1 dBFS, measured with the library's own loudness code and stored as Opus in Ogg. Risers, reverse swells, typing
 * runs and a slow-down are derived from CC0 sounds (CC0 allows it) and say what they were made from.
 */

interface Source {
  key: string;
  url: string;
  page: string;
  author: string;
  title: string;
}

const SOURCES: Source[] = [
  { key: "kenney-interface", url: "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip", page: "https://kenney.nl/assets/interface-sounds", author: "Kenney", title: "Interface Sounds" },
  { key: "kenney-ui", url: "https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip", page: "https://kenney.nl/assets/ui-audio", author: "Kenney", title: "UI Audio" },
  { key: "kenney-impact", url: "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip", page: "https://kenney.nl/assets/impact-sounds", author: "Kenney", title: "Impact Sounds" },
  { key: "kenney-digital", url: "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip", page: "https://kenney.nl/assets/digital-audio", author: "Kenney", title: "Digital Audio" },
  { key: "kenney-scifi", url: "https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip", page: "https://kenney.nl/assets/sci-fi-sounds", author: "Kenney", title: "Sci-fi Sounds" },
  { key: "kenney-casino", url: "https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip", page: "https://kenney.nl/assets/casino-audio", author: "Kenney", title: "Casino Audio" },
  { key: "kenney-rpg", url: "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip", page: "https://kenney.nl/assets/rpg-audio", author: "Kenney", title: "RPG Audio" },
  { key: "oga-air-whoosh", url: "https://opengameart.org/sites/default/files/whoosh2_0.wav", page: "https://opengameart.org/content/air-whoosh", author: "pyranostudios", title: "Air whoosh" },
  { key: "oga-swishes", url: "https://opengameart.org/sites/default/files/swishes.zip", page: "https://opengameart.org/content/swishes-sound-pack", author: "artisticdude", title: "Swishes Sound Pack" },
  { key: "oga-timehitwind", url: "https://opengameart.org/sites/default/files/qubodup-timehitwind.zip", page: "https://opengameart.org/content/wind-hit-time-morph", author: "qubodup", title: "Wind, hit, time morph" },
  { key: "oga-swoshes", url: "https://opengameart.org/sites/default/files/swoshes.7z", page: "https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes", author: "qubodup", title: "Swish - bamboo stick weapon swhoshes" },
  { key: "oga-3pops", url: "https://opengameart.org/sites/default/files/3pops.zip", page: "https://opengameart.org/content/3-pop-sounds", author: "wubitog", title: "3 Pop Sounds" },
  { key: "oga-bubble-pop", url: "https://opengameart.org/sites/default/files/pop.ogg", page: "https://opengameart.org/content/bubbles-pop", author: "farfadet46", title: "bubbles 'pop'" },
  { key: "oga-pop", url: "https://opengameart.org/sites/default/files/pop_.wav", page: "https://opengameart.org/content/pop", author: "0f9ran", title: "pop!" },
  { key: "oga-slidepop", url: "https://opengameart.org/sites/default/files/slidepop_0.mp3", page: "https://opengameart.org/content/a-slide-pop-sound", author: "ezduzziteh", title: "A Slide Pop Sound" },
  { key: "oga-balloon", url: "https://opengameart.org/sites/default/files/balloon_pop.flac", page: "https://opengameart.org/content/balloon-sounds", author: "antumdeluge", title: "Balloon Sounds" },
  { key: "oga-clicks", url: "https://opengameart.org/sites/default/files/Click_Clips.zip", page: "https://opengameart.org/content/87-clickety-clips", author: "OwlishMedia", title: "87 Clickety Clips" },
  { key: "oga-breaking", url: "https://opengameart.org/sites/default/files/sfx_breaking_and_falling.zip", page: "https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx", author: "rubberduck", title: "75 CC0 breaking / falling / hit sfx" },
  { key: "oga-dings", url: "https://opengameart.org/sites/default/files/ding_-_starninjas.zip", page: "https://opengameart.org/content/4-metal-dingsrings", author: "StarNinjas", title: "4 Metal Dings/Rings" },
  { key: "oga-ui", url: "https://opengameart.org/sites/default/files/sounds_2.zip", page: "https://opengameart.org/content/ui-sounds", author: "StumpyStrust", title: "UI Sounds" },
  { key: "oga-menu", url: "https://opengameart.org/sites/default/files/UISoundEffects.zip", page: "https://opengameart.org/content/7-assorted-sound-effects-menu-level-up", author: "Joth", title: "7 Assorted Sound Effects (Menu, Level Up)" },
  { key: "oga-58", url: "https://opengameart.org/sites/default/files/Sound%20Effects.zip", page: "https://opengameart.org/content/58-random-sound-effects", author: "TokyoGeisha", title: "58 Random Sound Effects" },
  { key: "oga-18", url: "https://opengameart.org/sites/default/files/sound_effects.zip", page: "https://opengameart.org/content/18-random-video-game-sound-effects", author: "Bart", title: "18 random video game sound effects" },
];

interface Selection {
  from: string;
  /** Matched against the file's path inside the source, case-insensitively. */
  match: RegExp;
  take: number;
  id: string;
  name: string;
  category: SfxCategory;
  tags: string[];
}

const P = (from: string, match: RegExp, take: number, id: string, name: string, category: SfxCategory, tags: string[]): Selection => ({ from, match, take, id, name, category, tags });

const PICKS: Selection[] = [
  // Transitions: whooshes, swipes, slides.
  P("oga-swoshes", /swosh-\d+/, 18, "whoosh-bamboo", "Whoosh, bamboo", "transition", ["whoosh", "swoosh", "swipe", "fast"]),
  P("oga-swishes", /swish-\d+/, 10, "swish", "Swish", "transition", ["whoosh", "swish", "swipe", "fast"]),
  P("oga-air-whoosh", /whoosh2/, 1, "whoosh-air", "Whoosh, air", "transition", ["whoosh", "swoosh", "air", "slow", "reveal"]),
  P("oga-timehitwind", /megaswosh/, 2, "whoosh-big", "Whoosh, big", "transition", ["whoosh", "swoosh", "big", "reveal"]),
  P("oga-timehitwind", /60009/, 1, "whoosh-wind", "Whoosh, wind", "transition", ["whoosh", "swoosh", "wind"]),
  P("oga-18", /whoosh/, 2, "whoosh-retro", "Whoosh, retro", "transition", ["whoosh", "swoosh", "retro"]),
  P("kenney-interface", /maximize/, 6, "whoosh-ui-up", "UI whoosh up", "transition", ["whoosh", "swipe", "open", "rise", "ui"]),
  P("kenney-interface", /minimize/, 6, "whoosh-ui-down", "UI whoosh down", "transition", ["whoosh", "swipe", "close", "fall", "ui"]),
  P("kenney-casino", /card-slide/, 8, "slide-card", "Card slide", "transition", ["slide", "swipe", "swoosh", "roll"]),
  P("oga-58", /card_swipe/, 3, "slide-swipe", "Card swipe", "transition", ["swipe", "slide", "swoosh"]),
  P("kenney-rpg", /bookflip/, 3, "paper-flip", "Page flip", "transition", ["paper", "flip", "page", "swipe"]),
  P("kenney-rpg", /cloth\d/, 2, "cloth", "Cloth swoosh", "transition", ["swoosh", "cloth", "soft"]),
  P("oga-menu", /transition/, 1, "menu-transition", "Menu transition", "transition", ["whoosh", "transition", "ui"]),
  // UI and clicks.
  P("kenney-interface", /click_/, 5, "ui-click", "UI click", "ui", ["click", "tap", "ui"]),
  P("kenney-interface", /tick_/, 3, "ui-tick", "UI tick", "ui", ["tick", "count", "click"]),
  P("kenney-interface", /select_/, 6, "ui-select", "UI select", "ui", ["click", "select", "tap", "blip"]),
  P("kenney-interface", /toggle_/, 4, "ui-toggle", "UI toggle", "ui", ["toggle", "switch", "click"]),
  P("kenney-interface", /switch_/, 4, "ui-switch", "UI switch", "ui", ["switch", "toggle", "click"]),
  P("kenney-interface", /scroll_/, 5, "ui-scroll", "UI scroll", "ui", ["tick", "scroll", "roll", "count"]),
  P("kenney-interface", /open_/, 4, "ui-open", "UI open", "ui", ["pop", "open", "ui"]),
  P("kenney-interface", /close_/, 4, "ui-close", "UI close", "ui", ["close", "pop", "ui"]),
  P("kenney-interface", /confirmation_/, 4, "ui-success", "UI success", "ui", ["success", "chime", "confirm", "ding"]),
  P("kenney-interface", /error_/, 5, "ui-error", "UI error", "ui", ["error", "buzz", "wrong"]),
  P("kenney-interface", /question_/, 2, "ui-question", "UI question", "ui", ["notification", "blip", "chime"]),
  P("kenney-interface", /glass_/, 4, "ui-glass", "UI glass", "ui", ["ding", "glass", "chime", "notification"]),
  P("kenney-interface", /bong_/, 1, "ui-bong", "UI bong", "ui", ["ding", "bell", "notification"]),
  P("kenney-interface", /drop_/, 4, "ui-drop", "UI drop", "ui", ["drop", "pop", "thud"]),
  P("kenney-interface", /pluck_/, 2, "ui-pluck", "UI pluck", "ui", ["pop", "pluck", "blip"]),
  P("kenney-interface", /back_/, 2, "ui-back", "UI back", "ui", ["click", "back"]),
  P("kenney-ui", /\/click\d/, 5, "click-soft", "Soft click", "ui", ["click", "tap"]),
  P("kenney-ui", /mouse(click|release)/, 2, "click-mouse", "Mouse click", "ui", ["click", "mouse", "tap"]),
  P("kenney-ui", /rollover/, 4, "ui-rollover", "Rollover", "ui", ["blip", "hover", "tick"]),
  P("kenney-ui", /switch\d/, 10, "switch", "Switch", "ui", ["switch", "toggle", "click"]),
  P("oga-clicks", /click/, 16, "click", "Click", "ui", ["click", "tap", "tick"]),
  P("oga-58", /(^|\/)(click_|finger_click|tongue_click)/, 8, "click-finger", "Finger click", "ui", ["click", "tap", "snap"]),
  P("oga-58", /keys_/, 4, "keys", "Keys", "ui", ["type", "typing", "keyboard", "keys"]),
  P("oga-58", /scissors/, 3, "snip", "Snip", "ui", ["click", "snip", "cut"]),
  P("oga-58", /coins/, 4, "coins", "Coins", "ui", ["coin", "success", "money"]),
  P("oga-ui", /button/, 2, "button", "Button", "ui", ["click", "tap"]),
  P("oga-ui", /complete/, 1, "success-complete", "Complete", "ui", ["success", "chime"]),
  P("oga-ui", /\/(on|off)\./, 2, "toggle-onoff", "On/off", "ui", ["toggle", "switch", "click"]),
  P("oga-menu", /menu/, 3, "menu", "Menu", "ui", ["click", "blip", "ui"]),
  P("oga-menu", /level/, 1, "level-up", "Level up", "ui", ["success", "shimmer", "sparkle"]),
  P("oga-menu", /item/, 1, "item", "Item", "ui", ["pop", "blip", "success"]),
  P("oga-dings", /ding/, 4, "ding-metal", "Metal ding", "ui", ["ding", "bell", "chime", "notification"]),
  P("oga-58", /spoon_on_(glass|cup)/, 5, "ding-glass", "Glass ding", "ui", ["ding", "chime", "glass"]),
  // Pops and hits.
  P("oga-3pops", /\/pop/, 3, "pop", "Pop", "pop", ["pop", "bubble", "blip"]),
  P("oga-bubble-pop", /pop/, 1, "pop-bubble", "Bubble pop", "pop", ["pop", "bubble"]),
  P("oga-pop", /pop/, 1, "pop-mouth", "Mouth pop", "pop", ["pop", "blip"]),
  P("oga-58", /\/pop_/, 2, "pop-cork", "Cork pop", "pop", ["pop", "blip"]),
  P("oga-slidepop", /slidepop/, 1, "pop-slide", "Slide pop", "pop", ["pop", "slide", "blip"]),
  P("oga-balloon", /balloon/, 1, "pop-balloon", "Balloon pop", "pop", ["pop", "burst"]),
  P("kenney-digital", /pepsound/, 5, "pep", "Pep", "pop", ["pop", "blip", "count"]),
  P("oga-18", /(bloops|boing|squeak)/, 4, "bloop", "Bloop", "pop", ["pop", "blip", "boing"]),
  P("oga-58", /hand_clap/, 3, "clap", "Clap", "hit", ["hit", "clap"]),
  P("kenney-impact", /impactpunch_heavy/, 5, "hit-punch", "Punch", "hit", ["hit", "impact", "punch", "slam"]),
  P("kenney-impact", /impactpunch_medium/, 3, "hit-punch-light", "Punch, light", "hit", ["hit", "impact"]),
  P("kenney-impact", /impactsoft_heavy/, 5, "thud", "Thud", "hit", ["thud", "hit", "impact"]),
  P("kenney-impact", /impactsoft_medium/, 3, "thud-soft", "Thud, soft", "hit", ["thud", "drop"]),
  P("kenney-impact", /impactplate_heavy/, 3, "hit-plate", "Plate hit", "hit", ["hit", "impact", "clang"]),
  P("kenney-impact", /impactmetal_heavy/, 3, "hit-metal", "Metal hit", "hit", ["hit", "clang", "metal"]),
  P("kenney-impact", /impactglass_heavy/, 2, "hit-glass", "Glass hit", "hit", ["hit", "glass", "crash"]),
  P("kenney-impact", /impactbell_heavy/, 3, "hit-bell", "Bell hit", "hit", ["ding", "bell", "hit"]),
  P("kenney-impact", /impactwood_heavy/, 3, "hit-wood", "Wood hit", "hit", ["hit", "knock"]),
  P("kenney-scifi", /lowfrequency_explosion/, 2, "boom-sub", "Sub boom", "hit", ["boom", "sub", "impact", "hit"]),
  P("kenney-scifi", /explosioncrunch/, 3, "boom-crunch", "Crunch boom", "hit", ["boom", "impact", "hit"]),
  P("kenney-scifi", /impactmetal/, 2, "hit-scifi", "Sci-fi hit", "hit", ["hit", "impact", "metal"]),
  P("oga-18", /thump/, 1, "thump", "Thump", "hit", ["thud", "hit"]),
  P("oga-breaking", /bfh1_hit/, 5, "hit-misc", "Hit", "hit", ["hit", "impact"]),
  // Texture and glitch.
  P("kenney-interface", /glitch_/, 4, "glitch-ui", "UI glitch", "texture", ["glitch", "digital", "error"]),
  P("kenney-interface", /scratch_/, 3, "scratch", "Scratch", "texture", ["glitch", "scratch"]),
  P("kenney-digital", /laser\d/, 5, "laser", "Laser", "texture", ["zap", "laser", "glitch"]),
  P("kenney-digital", /phaserup/, 4, "phaser-up", "Phaser up", "texture", ["riser", "zap", "rise", "shimmer"]),
  P("kenney-digital", /phaserdown/, 3, "phaser-down", "Phaser down", "texture", ["zap", "fall"]),
  P("kenney-digital", /powerup/, 8, "power-up", "Power up", "texture", ["success", "shimmer", "sparkle", "powerup"]),
  P("kenney-digital", /\/zap/, 6, "zap", "Zap", "texture", ["zap", "glitch"]),
  P("kenney-digital", /spacetrash/, 5, "glitch-trash", "Glitch", "texture", ["glitch", "digital"]),
  P("kenney-digital", /(threetone|twotone|tone\d)/, 4, "chime-tone", "Tone chime", "texture", ["chime", "notification", "blip"]),
  P("kenney-digital", /highup/, 1, "tone-up", "Tone up", "texture", ["success", "rise", "blip"]),
  P("kenney-digital", /highdown/, 1, "tone-down", "Tone down", "texture", ["error", "fall", "blip"]),
  P("kenney-digital", /phasejump/, 3, "glitch-jump", "Phase jump", "texture", ["glitch", "zap"]),
  P("kenney-scifi", /computernoise/, 4, "glitch-computer", "Computer noise", "texture", ["glitch", "digital", "data"]),
  P("kenney-scifi", /forcefield/, 3, "shimmer-field", "Force field", "texture", ["shimmer", "hum", "sparkle"]),
  P("kenney-scifi", /lasersmall/, 3, "laser-small", "Small laser", "texture", ["zap", "laser"]),
  P("oga-18", /(trekscan|atomize)/, 2, "shimmer-scan", "Scan shimmer", "texture", ["shimmer", "scan", "sparkle"]),
  P("oga-18", /beam/, 3, "beam", "Beam", "texture", ["zap", "beam"]),
  P("oga-58", /fizz/, 2, "fizz", "Fizz", "texture", ["shimmer", "sparkle", "fizz"]),
  P("oga-58", /(paper_crunch|rip_)/, 2, "paper", "Paper", "texture", ["paper", "rip"]),
];

const AUDIO = /\.(wav|ogg|mp3|flac)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : AUDIO.test(f) && !/preview/i.test(f) ? [p] : [];
  });
}

/** An even spread of `n` from a naturally sorted list. */
function spread<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, n - 1))]!);
}

function fetchSources(src: string): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const s of SOURCES) {
    const dir = path.join(src, s.key);
    const file = path.join(src, `${s.key}${path.extname(new URL(s.url).pathname).toLowerCase()}`);
    if (!existsSync(file)) execFileSync("curl", ["-sL", "-m", "180", "-o", file, s.url]);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      if (/\.(zip|7z)$/.test(file)) execFileSync("/usr/bin/tar", ["-xf", file, "-C", dir]);
      else execFileSync("cp", [file, path.join(dir, decodeURIComponent(path.basename(new URL(s.url).pathname)))]);
    }
    dirs.set(s.key, dir);
  }
  return dirs;
}

/** Apply `filter` (a filter_complex graph when there are several inputs), trim silence at both ends, peak-normalise to -1 dBFS, store as Opus in Ogg. */
function processTo(inputs: string[], out: string, filter: string): void {
  const raw = `${out}.raw.wav`, trimmed = `${out}.trim.wav`;
  if (inputs.length > 1) execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((i) => ["-i", i]), "-filter_complex", filter, raw]);
  else execFileSync("ffmpeg", ["-v", "error", "-y", "-i", inputs[0]!, "-af", filter || "anull", raw]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,aresample=48000", trimmed]);
  // Peak-normalise to -3 dBFS, then check what the encoder made: Opus overshoots on sharp transients, so a file
  // that decodes above -0.5 dBFS is encoded again that much quieter. Nothing in the pack clips.
  const peak = peakOf(trimmed);
  let gain = Number.isFinite(peak) ? -3 - peak : 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", trimmed, "-af", `volume=${gain.toFixed(2)}dB,afade=t=in:d=0.003`, "-c:a", "libopus", "-b:a", "96k", "-ar", "48000", out]);
    const decoded = peakOf(out);
    if (!(decoded > -0.5)) break;
    gain -= decoded + 0.5 + 0.2;
  }
  rmSync(raw, { force: true });
  rmSync(trimmed, { force: true });
}

function peakOf(file: string): number {
  // volumedetect reports on stderr.
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr ?? "")?.[1] ?? NaN);
}

function measure(file: string): Pick<PackSound, "durationSeconds" | "gainDb" | "lufs" | "peakDb"> {
  // At full rate: clicks, glass and coins live above 4 kHz, and an 8 kHz decode would call them near-silent.
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const shape = describeAudio(samples, 48000);
  return { durationSeconds: Math.round((samples.length / 48000) * 1000) / 1000, gainDb: gainFor(shape), lufs: Math.round(shape.lufs * 10) / 10, peakDb: Math.round(peakOf(file) * 10) / 10 };
}

function build(argv: string[]): void {
  const at = argv.indexOf("--src");
  const src = at >= 0 ? path.resolve(argv[at + 1]!) : path.join(os.tmpdir(), "reelcut-sfx-src");
  mkdirSync(src, { recursive: true });
  const dirs = fetchSources(src);
  const out = packDir();
  for (const c of SFX_CATEGORIES) rmSync(path.join(out, c), { recursive: true, force: true });
  const sounds: PackSound[] = [];
  const credit = (key: string) => {
    const s = SOURCES.find((x) => x.key === key)!;
    return { pack: s.title, author: s.author, url: s.page, licence: "CC0 1.0" as const };
  };
  const add = (id: string, name: string, category: SfxCategory, tags: string[], inputs: string[], from: string, filter = "", derived?: string) => {
    const file = `${category}/${id}.ogg`;
    mkdirSync(path.join(out, category), { recursive: true });
    processTo(inputs, path.join(out, file), filter);
    sounds.push({ id, name, file, category, tags, ...measure(path.join(out, file)), source: credit(from), ...(derived ? { derivedFrom: derived } : {}) });
  };

  for (const p of PICKS) {
    const dir = dirs.get(p.from)!;
    const files = walk(dir).filter((f) => p.match.test(path.relative(dir, f).toLowerCase().replace(/\\/g, "/").replace(/^/, "/"))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!files.length) throw new Error(`${p.id}: nothing in ${p.from} matches ${p.match}`);
    spread(files, p.take).forEach((f, i) => add(`${p.id}-${String(i + 1).padStart(2, "0")}`, `${p.name} ${i + 1}`, p.category, p.tags, [f], p.from));
  }

  // Derived from CC0 sounds: what the packs lack, made from what they have.
  const one = (key: string, re: RegExp, n = 0) => walk(dirs.get(key)!).filter((f) => re.test(f.toLowerCase())).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[n]!;
  const big = one("oga-timehitwind", /megaswosh/);
  const air = one("oga-air-whoosh", /whoosh2/);
  // Risers: a whoosh reversed, so it builds into the moment instead of leaving it; slowed for the longer ones.
  // [source, seconds of it to use, tempo]: the output lasts seconds / tempo (about 1.2, 2, 2 and 3.3 s).
  const risers: [string, number, number, string, string][] = [[big, 1.2, 1, "riser-01", "Riser, short"], [big, 1.2, 0.6, "riser-02", "Riser"], [air, 1.5, 0.75, "riser-03", "Riser, air"], [air, 2, 0.6, "riser-04", "Riser, long"]];
  for (const [f, seconds, tempo, id, name] of risers)
    add(id, name, "transition", ["riser", "swell", "reveal", "build"], [f], f === big ? "oga-timehitwind" : "oga-air-whoosh", `atrim=0:${seconds},areverse${tempo !== 1 ? `,atempo=${tempo}` : ""},afade=t=in:d=0.25`, `${path.basename(f)} reversed${tempo !== 1 ? `, slowed ×${tempo}` : ""}`);
  // Reverse swells: a ringing hit played backwards, sucking in to the cut.
  [[one("kenney-impact", /impactbell_heavy/), "kenney-impact"], [one("kenney-impact", /impactplate_heavy/, 1), "kenney-impact"], [one("kenney-scifi", /explosioncrunch/, 2), "kenney-scifi"], [one("kenney-impact", /impactglass_heavy/), "kenney-impact"]].forEach(([f, key], i) =>
    add(`swell-reverse-${String(i + 1).padStart(2, "0")}`, `Reverse swell ${i + 1}`, "transition", ["swell", "riser", "reverse", "reveal"], [f as string], key as string, "areverse,atempo=0.5,afade=t=in:d=0.08", `${path.basename(f as string)} reversed, slowed ×0.5`));
  // Slow-down: the time-morph sound, a tape-stop for a beat that freezes.
  add("slowdown-01", "Slow-down", "transition", ["slowdown", "tape-stop", "transition"], [one("oga-timehitwind", /slomo/)], "oga-timehitwind");
  // Typing runs: real key and click sounds laid at fixed, uneven intervals (no randomness: the same every build).
  const keys = walk(dirs.get("oga-58")!).filter((f) => /keys_|click_0/i.test(path.basename(f))).sort();
  const gaps = [0, 0.11, 0.19, 0.33, 0.41, 0.5, 0.62, 0.7, 0.83, 0.95, 1.04, 1.18, 1.26, 1.37, 1.5, 1.61, 1.73, 1.8, 1.92, 2.05, 2.17, 2.26, 2.4, 2.52, 2.6, 2.71, 2.85, 2.96];
  [0.8, 1.4, 2.0, 3.0].forEach((len, k) => {
    const hits = gaps.filter((g) => g < len - 0.05);
    const inputs = hits.map((_, i) => keys[(i * 3 + k) % keys.length]!);
    const graph = `${hits.map((g, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,volume=${(0.75 + ((i * 7) % 5) * 0.06).toFixed(2)},adelay=${Math.round(g * 1000)}|${Math.round(g * 1000)}[k${i}]`).join(";")};${hits.map((_, i) => `[k${i}]`).join("")}amix=inputs=${hits.length}:normalize=0`;
    add(`typing-run-${String(k + 1).padStart(2, "0")}`, `Typing run ${len} s`, "ui", ["type", "typing", "keyboard", "keys"], inputs, "oga-58", graph, `${hits.length} key sounds from 58 Random Sound Effects`);
  });

  // Sounds that came out silent (a trim took everything) are dropped.
  const kept = sounds.filter((s) => s.durationSeconds >= 0.03 && Number.isFinite(peakOf(path.join(out, s.file))));
  const manifest: PackManifest = { version: 1, builtAt: new Date().toISOString(), licence: "CC0 1.0 (public domain); see CREDITS.md", sounds: kept };
  writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const lines = SOURCES.map((s) => `- **${s.title}** by ${s.author}: ${s.page} (CC0 1.0). ${kept.filter((k) => k.source.pack === s.title).length} sound(s).`);
  writeFileSync(path.join(out, "CREDITS.md"), `# The bundled sound pack\n\nEvery sound here is CC0 1.0 (public domain): free for any use, commercial included, with no attribution required. These creators made them; credit them anyway when you can.\n\n${lines.join("\n")}\n\nTrimmed, peak-normalised and re-encoded (Opus) by reelcut. Risers, reverse swells and typing runs are derived from the CC0 sounds above (reversed, slowed or layered); each says what it was made from in manifest.json.\n`);
  console.log(`${kept.length} sounds in ${out}`);
  for (const c of SFX_CATEGORIES) console.log(`  ${c.padEnd(11)} ${kept.filter((s) => s.category === c).length}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "build") build(rest);
else {
  console.error("usage: sfx-pack build [--src <dir>]");
  process.exitCode = 2;
}
