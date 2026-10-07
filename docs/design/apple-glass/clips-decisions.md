# reelcut clips: Apple motion and Apple UI decisions

Answers from the owner, dated. Each question is asked once. (The studio's own decisions are in `decisions.md`.)

## Round 1 (2026-10-07)

- **Motion scope:** Apple springs are the default everywhere. Every RC helper and every built-in pattern moves on
  critically damped springs; no `back.out` bounce and no `expo.inOut` travel. Overshoot only for the one earned moment
  of a reel (`spring.reward`, `RC.pop(..., { reward: true })`). `--motion energetic` keeps a punchier version
  (quicker springs, a little overshoot on presses and pops); `restrained` is slower and fully damped.
- **Frame rate:** 60 fps is the default (`DEFAULT_FPS`, render, beats). 30 stays available with `"fps": 30`.
- **Components:** all of them: iPhone controls, iPhone surfaces, Mac window, feedback moments, plus app mockups
  (chat, Maps, Calendar, home screen and apps, and so on).
- **Look:** the mockups follow each reel's look (paper, ink, cool…): Apple's structure (grouped grounds, cells,
  separators, label hierarchy, shapes, glass only on floating controls) in the reel's colours, with the accent as the
  app tint. Delivered as kit classes, helpers and patterns. No separate gallery page.
