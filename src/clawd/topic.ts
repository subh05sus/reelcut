/**
 * Whether a script is about Claude, so Clawd hosts its reel (the personality's Mascot setting, `when: "claude"`), and a
 * first idea of what Clawd does in each beat: the director's starting point, never a rule. English and German, the
 * owner's two languages.
 */

/** Words that make a script about Claude by themselves, and words that only count in company. */
const STRONG: [RegExp, string][] = [
  [/\bclaude[\s-]?code\b/i, "Claude Code"],
  [/\bclaude\.ai\b/i, "claude.ai"],
  [/\bclaude(?:'s|s)?\b/i, "Claude"],
  [/\banthropic\b/i, "Anthropic"],
  [/\bclawd\b/i, "Clawd"],
  [/\bcowork\b/i, "Cowork"],
];
const MEDIUM: [RegExp, string][] = [
  [/\bmcp\b|model context protocol/i, "MCP"],
  [/\bconnectors?\b|\bkonnektor(?:en)?\b/i, "connector"],
  [/\bskill\.md\b|\bskills?\b/i, "skill"],
  [/\bsub-?agents?\b/i, "subagent"],
  [/\bclaude\.md\b|\bslash[- ]commands?\b|\/[a-z][\w-]+\b/i, "command"],
  [/\b(?:opus|sonnet|haiku)\b/i, "model"],
  [/\bagent sdk\b|\bplugins?\b/i, "plugin"],
  [/\bscheduled tasks?\b|\bgeplante aufgaben?\b/i, "scheduled task"],
];

export interface ClaudeTopic {
  about: boolean;
  /** What was found, strongest first, each once. */
  mentions: string[];
}

/** Is this script about Claude or its tools? One strong word, or two of the others. */
export function claudeTopic(text: string): ClaudeTopic {
  const strong = STRONG.filter(([re]) => re.test(text)).map(([, n]) => n);
  const medium = MEDIUM.filter(([re]) => re.test(text)).map(([, n]) => n);
  const mentions = [...new Set([...strong, ...medium])];
  return { about: strong.length > 0 || medium.length >= 2, mentions };
}

export type ClawdRole = "hook" | "step" | "payoff" | "cta" | "react" | "rest";

export interface ClawdBeatPlan {
  beat: string;
  role: ClawdRole;
  /** RC.clawd acts that fit what the line says, best first. */
  acts: string[];
  /** Pack poses that fit, best first (RC.clawd.pose). */
  poses: string[];
  /** Why, in a few words, for plan.md. */
  why: string;
}

const STEP = /\b(first|then|next|after that|finally|step \d|zuerst|erstens|dann|danach|anschließend|schließlich|zum schluss|als nächstes)\b/i;
const CTA = /\b(comment|follow|subscribe|link in (?:the )?bio|dm me|save this|kommentier\w*|folg\w*|abonnier\w*|schreib mir|speicher\w*)\b/i;
const PAYOFF = /\b(so yeah|that's it|and that's|just like that|done\b|und das war'?s|fertig|so einfach|that's all)\b/i;

/** Keyword → the acts and poses that show it, for a beat's line (English and German). */
const CUES: { re: RegExp; acts: string[]; poses: string[]; why: string }[] = [
  { re: /\b(connect\w*|connector|mcp|integrat\w*|link (?:it|your)|verbind\w*|konnektor)\b/i, acts: ["plug"], poses: ["disconnected-plug"], why: "connecting: Clawd plugs the cable in" },
  { re: /\b(skill\.md|skills?|upload\w*|give it (?:my|the)|lade\w* hoch|gib ihm)\b/i, acts: ["carry"], poses: ["holding-ancient-scroll"], why: "a skill or file: Clawd carries it in" },
  { re: /\b(schedul\w*|calendar|every day|daily|each week|at \d+\s?(?:am|pm)|uhr\b|termin\w*|plan\w*|jeden tag|täglich|woche)\b/i, acts: ["hold:calendar", "hold:clock"], poses: ["planning-list", "hourglass-stress"], why: "time and schedule: Clawd holds the calendar" },
  { re: /\b(post\w*|publish\w*|instagram|tiktok|share|veröffentlich\w*|teil\w*)\b/i, acts: ["tap", "hold:phone"], poses: ["rocket-launch-success"], why: "posting: Clawd taps Post" },
  { re: /\b(type|prompt|ask|tell (?:it|claude)|write|schreib\w*|frag\w*|sag\w*|tipp\w*)\b/i, acts: ["type", "say"], poses: ["writing-software-code", "thinking-in-code"], why: "telling Claude: Clawd types it" },
  { re: /\b(sub-?agents?|parallel|agents|team|gleichzeitig)\b/i, acts: ["minis"], poses: ["with-minis"], why: "parallel work: mini Clawds run off" },
  { re: /\b(new|launch\w*|introduc\w*|released?|neu\w*|vorgestellt)\b/i, acts: ["hatch"], poses: ["rocket-launch-success"], why: "something new: it hatches" },
  { re: /\b(install\w*|plugins?|add\w*|füg\w* hinzu|installier\w*)\b/i, acts: ["carry:puzzle"], poses: ["building-colorful-blocks"], why: "adding a tool: Clawd carries the piece in" },
  { re: /\b(code|terminal|claude code|cli|programm\w*)\b/i, acts: ["type", "hold:terminal"], poses: ["writing-software-code", "developer-pair-programming-scene"], why: "code: Clawd at the terminal" },
  { re: /\b(fast|quick|seconds|instantly|schnell|sofort|sekunden)\b/i, acts: ["walk"], poses: ["fast-performance-trail"], why: "speed" },
  { re: /\b(error|bug|fail\w*|broken|wrong|fehler|kaputt)\b/i, acts: ["react:oops"], poses: ["bugs-attack", "error-state", "dizzy-failed-state"], why: "something breaks: Clawd reacts" },
  { re: /\b(think\w*|plan\w*|idea|überleg\w*|idee|denk\w*)\b/i, acts: ["think"], poses: ["idea-lightbulb", "thinking-pixel-bubble"], why: "thinking" },
  { re: /\b(sleep\w*|overnight|while you sleep|on the go|unterwegs|nachts|schlaf\w*)\b/i, acts: ["sleep"], poses: ["sleeping-soundly"], why: "while you rest: Clawd sleeps, Claude works" },
  { re: /\b(secure|safe|privacy|password|sicher\w*|datenschutz)\b/i, acts: ["hold:key"], poses: ["shield-protect", "secure-access-padlock"], why: "safety" },
  { re: /\b(data|chart|numbers|growth|daten|zahlen|wachstum)\b/i, acts: ["point"], poses: ["trending-up", "system-monitoring-dashboard"], why: "numbers: Clawd points at them" },
  { re: /\b(hello|hi|hey|welcome|hallo|willkommen|servus)\b/i, acts: ["wave"], poses: ["welcome-pixel-banner", "hello-languages"], why: "a greeting: Clawd waves" },
];

/**
 * A role and a few ideas per beat: the hook opens with Clawd arriving, step beats act the step out, the payoff
 * celebrates, the call to action holds up the word. Beats with nothing to act sit Clawd out ("rest"), so a reel never
 * has Clawd in every frame for its own sake.
 */
export function planClawd(beats: readonly { id: string; text: string }[]): ClawdBeatPlan[] {
  const ctaAt = beats.map((b) => CTA.test(b.text)).lastIndexOf(true);
  const payoffAt = (() => {
    const p = beats.map((b) => PAYOFF.test(b.text)).lastIndexOf(true);
    if (p >= 0) return p;
    const before = (ctaAt >= 0 ? ctaAt : beats.length) - 1;
    return before > 0 ? before : -1;
  })();
  return beats.map((b, i): ClawdBeatPlan => {
    const hits = CUES.filter((c) => c.re.test(b.text));
    const acts = [...new Set(hits.flatMap((h) => h.acts))], poses = [...new Set(hits.flatMap((h) => h.poses))];
    if (i === 0) return { beat: b.id, role: "hook", acts: ["enter", ...acts.slice(0, 2), "wave"], poses: poses.slice(0, 2), why: `the hook: Clawd arrives${hits[0] ? `; ${hits[0].why}` : ""}` };
    if (i === ctaAt) return { beat: b.id, role: "cta", acts: ["sign", "wave"], poses: ["welcome-pixel-banner"], why: "the call to action: Clawd holds up the word" };
    if (i === payoffAt) return { beat: b.id, role: "payoff", acts: ["confetti", ...acts.slice(0, 1)], poses: ["with-success-checkmark", "excited", ...poses.slice(0, 1)], why: "the payoff: Clawd celebrates" };
    // A step says it is one ("first", "then"), or connects or hands something over; a line that only mentions posting
    // or typing is context, and Clawd reacts to it rather than acting it out.
    if (STEP.test(b.text) || hits.some((h) => h.acts.some((a) => /^(plug|carry)/.test(a)))) return { beat: b.id, role: "step", acts: acts.length ? acts : ["point"], poses, why: hits[0]?.why ?? "a step: Clawd does it" };
    if (hits.length) return { beat: b.id, role: "react", acts, poses, why: hits[0]!.why };
    return { beat: b.id, role: "rest", acts: [], poses: [], why: "nothing to act out: Clawd sits this one out" };
  });
}
