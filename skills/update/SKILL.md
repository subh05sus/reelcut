---
name: update
description: "reelcut: pull the latest reelcut, install, test, restart when idle. For when the owner types /reelcut:update."
argument-hint: ""
disable-model-invocation: true
allowed-tools: Bash(~/.reelcut/bin/reelcut:*)
---

# /reelcut:update

Pull the latest reelcut, install, test, restart when idle. Run:

```bash
~/.reelcut/bin/reelcut update $ARGUMENTS
```

(The launcher reaches the reelcut checkout from any folder. If it does not exist yet, run
`npm --prefix <skill-dir>/../.. run -s reelcut -- update $ARGUMENTS` once instead; that writes it.)

Relay what it prints, briefly. If it ends with one of these lines, the decision is the owner's: ask with
AskUserQuestion, then run the command again as said. The rules are the same as `/reelcut update`
(the reelcut skill, "Commands").

- `DECIDE {...}` (exit 3): a reel is being made. Say which and how far along, and ask: "Wait until it finishes
  (Recommended)" → add `--wait`; "Stop it now" → add `--now` (the chat can be continued later); "Cancel" → nothing.
- `CHOOSE {...}` (exit 4): the name matched several reels, or none. Offer its `reels` (title, status) and run again
  with the chosen `id` in place of the name.
- `CONFIRM {...}` (exit 5): something would be deleted. Offer its `options` (multiSelect, plus "Nothing") and run
  again with `--yes <id>,<id>`. Never pass `--yes` without the owner's choice.
