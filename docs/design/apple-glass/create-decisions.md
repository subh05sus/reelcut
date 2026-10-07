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

## Round 3 (2026-10-08), after the first real run

- **Skip:** Claude never asks what the page settles: the studio question (it is already open), anything a chip or the
  personality answered, and motion blur (off unless asked: reels are 60 fps). It still asks what only the script raises.
- **Title:** Claude names the reel after reading the script; the chat takes that name (the owner can rename it).
- **Question cards:** unchanged ("(Recommended)" stays in the label).
- **Chips:** text on screen, sound effects, music and motion blur join personality, format, length and quality. A chip
  left on "ask" is asked by Claude; a chip that is set is never asked.

## Round 4 (2026-10-08): what comes next

- **Chosen:** edit beats in the reel panel · script writer · recipes · batch and series · captions · post kit ·
  frame comments · performance loop · generated assets · share for review. (Voice features: not now.)
- **Order:** edit beats and frame comments first.
- **Generated assets:** Claude-drawn vectors (SVG in the personality's style) first; Higgsfield for video backdrops
  when connected.
- **Share for review:** a temporary Cloudflare tunnel to a read-only review page, live while the studio runs; comments
  come back into the chat; revocable.
- **Performance loop:** analytics screenshots or CSV exports, read by Claude; no platform logins.
- **Integrations bar:** the Create page shows whether Higgsfield is connected, and later Adobe Premiere Pro and
  DaVinci Resolve, which reels will be orchestrated with.

## Built (2026-10-08)

- Edit beats (sheet per beat, drag to reorder) and frame comments (pins, timeline, send to Claude); a progress card,
  header line and meter read from the reel folder.
- Write it with Claude (three hooks → script → approve → reel); six recipes plus the owner's own; series with a shared
  intro and outro; batches that run unattended, now or tonight.
- Captions (.srt/.vtt; burned in for voiced reels, in the personality's type) and a Post tab: covers from the reel's
  frames, the post kit per platform with limits and copy buttons.
- Share for review: a separate review server on its own port, reached through a cloudflared quick tunnel only;
  tokens expire and can be turned off; reviewers' comments become frame comments.
- Performance: results from screenshots/CSV (read by Claude) or typed; a Performance page with differences between
  reels and a conversation that proposes learnings for approval.
- Drawn assets: SVG in the personality's style, checked, kept in the library as pending.
