# Create: making a reel from the dashboard — decisions

A chat in the studio where the owner gives a script and instructions and Claude makes the reel, asking its questions
as Claude does. Answers from the owner, dated. Each question is asked once.

## Round 1 (2026-10-08)

- **Engine:** Claude Code through the Agent SDK, with the owner's Claude login: the real /reelcut skill, same tools,
  memory and skills. AskUserQuestion calls come back to the dashboard as clickable question cards.
- **Layout:** chat on the left (messages, question cards, composer), a live reel panel on the right (plan, beats,
  frames, clips as they render). On the phone the panel is a tab.
- **Activity:** streaming replies; collapsed tool steps (expandable); inline frames and clips as they exist; elapsed
  time and usage with a Stop button.
- **Permissions:** free inside the project (reelcut and ~/.reelcut); anything outside or outward-facing shows an
  Allow / Deny card in the chat.

## Round 2 (2026-10-08)

- **Inputs:** script pasted or dropped (.txt / .srt); voiceover audio; assets and footage (into the library); quick
  settings chips above the composer (personality, format, length, HD/4K).
- **Threads:** saved and resumable: every reel keeps its chat; a follow-up ("make beat 3 calmer") resumes the same
  session and re-renders only what changed.
- **Model:** a picker in the composer (model and effort), defaulting to what Claude Code uses.
- **Background:** the run lives in the studio server, not the tab; reopening catches up; a browser notification when a
  question is waiting or the reel is done.
