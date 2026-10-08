/**
 * reelcut's commands as a list: what `/reelcut <command>` and `/reelcut:<command>` offer, one line each. The command line
 * tool (skills/reelcut/scripts/cmd.ts) runs them; `npm run reelcut -- _skills` writes a skill per command from this
 * list (skills/<command>/SKILL.md), and a test keeps the two the same.
 */
export const COMMAND_LINES: Record<string, string> = {
  help: "every command, with an example",
  start: "start the studio in the background and open it",
  stop: "stop the studio (asks first if a reel is being made)",
  restart: "restart the studio, to load new code (asks first if a reel is being made)",
  status: "the studio, reels being made, the batch, links and tools",
  open: "open a page (create, library, reels, personality, performance, learnings, review, jobs) or a reel",
  list: "recent reels and chats, numbered for the other commands",
  continue: "carry on a chat in the studio: continue [reel] [message]",
  new: "hand a script to a new Create chat: new script.txt [--format 9:16 …] [words]",
  batch: "queue every script in a folder: batch <folder> [--tonight] [--format 9:16 …]",
  share: "make a review link for a reel: share [reel] [--days 1|7|30]",
  shares: "the live review links",
  unshare: "turn review links off: unshare [reel] | --all",
  edit: "change one beat: edit <beat> calmer|punchier|redo|remove|style <name>|text \"…\"|move <n>|<anything> [--reel x]",
  rerender: "render beats again as they are: rerender <beat>[,<beat>…] [--reel x]",
  doctor: "check everything reelcut needs, with fixes",
  update: "pull the latest reelcut, install, test, restart when idle",
  clean: "see what old reels and render projects take, and delete the ones you pick",
  logs: "the studio, review-link or render log: logs [studio|review|render] [-n 40]",
};

/** Argument hints shown by autocomplete. */
const HINTS: Record<string, string> = {
  stop: "[--now | --wait]", restart: "[--now | --wait]", open: "[page | reel]", list: "[-n 15]", continue: "[reel] [message]",
  new: "<script.txt> [--format 9:16] [--short] [words…]", batch: "<folder> [--tonight] [--format 9:16]", share: "[reel] [--days 1|7|30]",
  unshare: "[reel | --all]", edit: "<beat> <calmer|punchier|redo|remove|style X|text \"…\"|move N|words> [--reel x]",
  rerender: "<beat>[,<beat>…] [--reel x]", clean: "", logs: "[studio|review|render] [-n 40]", start: "[--no-open]",
};
export function commandSkill(name: string, line: string): string {
  return `---
name: ${name}
description: "reelcut: ${line.replace(/"/g, "'")}. For when the owner types /reelcut:${name}."
argument-hint: "${(HINTS[name] ?? "").replace(/"/g, "'")}"
disable-model-invocation: true
allowed-tools: Bash(~/.reelcut/bin/reelcut:*)
---

# /reelcut:${name}

${line[0]!.toUpperCase()}${line.slice(1)}. Run:

\`\`\`bash
~/.reelcut/bin/reelcut ${name} $ARGUMENTS
\`\`\`

(The launcher reaches the reelcut checkout from any folder. If it does not exist yet, run
\`npm --prefix <skill-dir>/../.. run -s reelcut -- ${name} $ARGUMENTS\` once instead; that writes it.)

Relay what it prints, briefly. If it ends with one of these lines, the decision is the owner's: ask with
AskUserQuestion, then run the command again as said. The rules are the same as \`/reelcut ${name}\`
(the reelcut skill, "Commands").

- \`DECIDE {...}\` (exit 3): a reel is being made. Say which and how far along, and ask: "Wait until it finishes
  (Recommended)" → add \`--wait\`; "Stop it now" → add \`--now\` (the chat can be continued later); "Cancel" → nothing.
- \`CHOOSE {...}\` (exit 4): the name matched several reels, or none. Offer its \`reels\` (title, status) and run again
  with the chosen \`id\` in place of the name.
- \`CONFIRM {...}\` (exit 5): something would be deleted. Offer its \`options\` (multiSelect, plus "Nothing") and run
  again with \`--yes <id>,<id>\`. Never pass \`--yes\` without the owner's choice.
`;
}
