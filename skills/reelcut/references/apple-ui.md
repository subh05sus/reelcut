# Apple UI — iPhone, Mac, apps and the moments in between

`assets/kit/ui/` holds Apple's interface as kit pieces: CSS classes sized in points, and seek-safe helpers on `RC`
that move each one the way Apple's own UI moves. The render loads every file in `ui/` after `kit.css`/`kit.js`, so
any beat with `data-look` has them. Every piece has a finished pattern in `assets/patterns/apple/`; open it before
building a beat of that kind.

The rules come from Apple's Human Interface Guidelines as distilled in the apple-glass skill: glass only on the
floating controls layer, solid elevated surfaces for anything holding text (menus, sheets, alerts, notifications),
Apple's shapes (capsules, concentric radii), Apple's text styles, and motion on critically damped springs.

## Points and colour

- **`--pt`** sizes everything in iOS points (default `1.5px`). Set it on the phone, card or component. Keep text
  ≥ 16 px: Caption 2 (11 pt) needs `--pt ≥ 1.46`, Footnote (13 pt) `≥ 1.24`, Body (17 pt) `≥ 0.95`. A phone that
  must be large is cropped by the frame edge rather than shrunk.
- **Colour follows the look.** `--ui-bg --ui-grouped --ui-cell --ui-raised --ui-label --ui-label-2 --ui-label-3 --ui-sep
  --ui-fill --ui-fill-2 --ui-tint` are derived from the look's tokens in Apple's arrangement (light: grey grouped
  ground, white cells; `ink`/`cinema`: black ground, raised cells). The tint is the accent. System colours
  (`--ui-green --ui-red --ui-blue --ui-orange …`, Apple's light and dark values) are for meaning only.
- **Text styles:** `.rc-t-large .rc-t-title1 .rc-t-title2 .rc-t-title3 .rc-t-headline .rc-t-body .rc-t-callout
  .rc-t-subhead .rc-t-footnote .rc-t-caption .rc-t-caption2`, in the reel's sans.

## The iPhone (`00-base`)

`.rc-iphone > .rc-scr` is a 402 × 874 pt screen (16 Pro proportions) with `.rc-status` (`b` time, `.rc-island`,
`.rc-sys`), `.rc-homebar` and `.rc-view` pages. `.rc-iphone.rc-dark` draws light status text. `.rc-touch` is a finger
(move it with `RC.cursor`, press it with `RC.press`).

Shared motion: `RC.to(tl, el, at, vars, "default")` (a tween on a spring with its natural length),
`RC.press` (down 80 ms on the CSS curve, up on a snappy spring), `RC.present` / `RC.dismiss`, `RC.stagger(i)`.

## The Dynamic Island (`22-island`)

Built to Apple's Live Activities spec: idle 126 × 37 pt; **compact** 230 wide (leading and trailing 52 pt, snug against
the camera); **minimal** attached on the leading side with a detached circle to the right; **expanded** 371 × 84–160 pt
with 44 pt corners; always black, a tinted key line on dark screens; medium-weight-or-heavier text in bold colour;
transitions inside two seconds; existing elements keep their places across states.

| | |
|---|---|
| markup | `.rc-di > .rc-di-shape (i.rc-di-body, i.rc-di-bubble)` + slots with `data-di="compact|minimal|expanded|<name>"`: `.rc-di-lead .rc-di-trail .rc-di-min .rc-di-bub .rc-di-exp .rc-di-wide`; parts `.rc-di-glyph .rc-di-ring .rc-di-bar .rc-di-btn .rc-di-wave` |
| `RC.islandSet(di, state)` | the state at frame 0 |
| `RC.island(tl, di, at, state, o)` | morph on `spring.island` (the one shape Apple lets overshoot, 1.7%); content leaves first, the new content pours in 0.12 s later out of blur; the bubble splits off through a goo filter; the status clock and indicators give way under the expanded island. `state` may be `{ name, l, w, h, rad }` in pt for a custom pill (Silent Mode, Face ID) |
| `RC.islandWave(tl, wave, at, s)` | a live waveform from a seeded smooth signal |
| `RC.numeric(tl, el, at, { values, each })` | SwiftUI's numeric content transition: only changed digits roll, down when falling, up when rising, right to left 20 ms apart; columns glide to each glyph's width |

Patterns: `ios-island` (timer: compact → expanded → compact → minimal split), `ios-island-alert` (Silent Mode pill,
a Live Activity alert into expanded, settling to compact).

## iOS controls (`10-ios-controls`)

| piece | markup | motion |
|---|---|---|
| Tab bar | `.rc-tabbar.rc-glass > .rc-lens > i` + `.rc-tab (svg, span)` | `RC.lensSet`, `RC.lensTo(tl, bar, at, i)` (one lens travels on `default`, its child swells 1.14 × 1.08 → 1, the tab presses .92), `RC.tabbarMin(tl, bar, at, true)` (62 → 50 pt, labels fold) |
| Segmented | `.rc-segctl > .rc-lens > i` + `span…` | `RC.lensSet`, `RC.lensTo` |
| Switch | `.rc-sw > .rc-sw-fill + .rc-sw-knob` (64 × 28) | `RC.toggle(tl, sw, at, on)`: the knob widens under the finger, travels, the track fills green |
| Slider | `.rc-slider > .rc-sl-track + .rc-sl-fill + .rc-sl-thumb + .rc-sl-bubble` | `RC.slide(tl, sl, at, { from, to, duration, format })`: held, the thumb swells into clear glass and the bubble pops up; the drag is a hand's (`apple.glide`) |
| Stepper | `.rc-stepper > button + i + button` | `RC.press` + `RC.numeric` |
| Glass buttons | `.rc-gbtn.rc-glass` (44 pt), `.rc-gbar.rc-glass` | `RC.press(…, { scale: .9 })` |
| Search | `.rc-search > svg + .rc-q + .rc-caret + .rc-ph + .rc-x` | `RC.searchFocus`, `RC.keyType` |
| Keyboard | `RC.keyboard(container)` builds `.rc-kb` | `RC.keyboardIn` (iOS curve), `RC.keyType(tl, kb, field, at, { text, cps })`: each key shows its callout exactly while pressed |

Patterns: `ios-tabbar`, `ios-controls-board`, `ios-search-keyboard`.

## iOS surfaces (`20-ios-surfaces`)

| piece | markup | motion |
|---|---|---|
| Notification | `.rc-note > .rc-note-ico + .rc-note-tx (b > small, span)` | `RC.notify(tl, note, at)` drops on `default`; move older ones with `RC.to` |
| Sheet | `.rc-scrim` + `.rc-sheet(.rc-grouped) > .rc-grabber` | `RC.sheet(tl, sheet, at, "medium" \| "large" \| "closed" \| topPt, { behind })`: the page behind steps back like a card on large |
| Context menu | `.rc-cm-back` + `.rc-cmenu > .rc-cm-row (span, svg)` `.rc-cm-sep` `.rc-red` | `RC.contextMenu(tl, item, menu, at, { backdrop, origin })` (sink, lift, blur, grow), `RC.menuPick(tl, menu, at, i)` |
| Alert | `.rc-alert > b + p + .rc-alert-btns > span(.rc-prime \| .rc-red)` | `RC.alertIn`, `RC.alertOut` (0.95 → 1 in 200 ms over the scrim) |
| Inset group | `.rc-ghead`, `.rc-group > .rc-cell (.rc-ico-tile, span, .rc-val, .rc-chev)` | rows fill on press, never scale |
| Swipe row | `.rc-swipe > .rc-acts > span… + .rc-cell` | `RC.swipe(tl, row, at, { remove })`: follows the finger past its actions, springs back onto them; remove folds it shut |
| Navigation | `.rc-view` pages, `.rc-navbar (.rc-back, .rc-inline)`, `.rc-ltitle`, `.rc-dimmer` | `RC.navPush` / `RC.navPop` (380 ms `apple.push`, the old page shifts −28% and dims) |

Patterns: `ios-notification`, `ios-sheet`, `ios-context-menu` (with the alert), `ios-push-swipe`.

## The Mac (`30-mac`)

Use `--pt` 1.6–2.2 (Body is 13 pt). `.rc-mac` is a Tahoe window: `.rc-mac-side.rc-glass` (floating slab, `.rc-lights`,
`.rc-mac-sec`, `.rc-mac-row`, one `.rc-mac-sel`), `.rc-mac-main > .rc-mac-tb (b, .rc-mac-tools.rc-glass)` and
`.rc-mac-list > .rc-mac-item`. Menus: `.rc-menubar`, `.rc-mmenu > .rc-mm-hl + .rc-mm-row (kbd)` `.rc-mm-sep`. Dock:
`.rc-dock > .rc-dock-shelf.rc-glass + .rc-dock-icon > i`.

`RC.macSelect` / `RC.macSelectSet`, `RC.macOpen(tl, win, at, { from: dockIcon })`, `RC.menuOpen`, `RC.menuHover`
(the highlight glides, the label turns white), `RC.menuChoose` (the Mac's single blink), `RC.dockSet`,
`RC.dockHover(tl, dock, cursor, at, [[x, y, s]…], { enter, leave })` (magnification follows the cursor's own path),
`RC.dockBounce`.

Patterns: `mac-dock-window`, `mac-menu`.

## Apps (`40-apps`)

| app | markup | motion |
|---|---|---|
| Messages | `.rc-thread > .rc-msg(.rc-me)(.rc-tail)`, `.rc-typing > i×3`, `.rc-tapback`, `.rc-composer.rc-glass (.rc-ctext, .rc-caret, .rc-ph, .rc-send)` | `RC.threadSet`, `RC.msgShow` (the thread glides up, sent bubbles rise, received ones grow from the tail corner, the previous tail goes), `RC.msgTyping`, `RC.compose` |
| Calendar | `.rc-cal`, `.rc-cal-days`, `.rc-cal-h`, `.rc-ev` (`--c`), `.rc-now` | `RC.present`, `RC.evDrag` (lift, carry, set down on the grid) |
| Maps | `RC.mapDraw(el, { seed, labels })` → svg; `.rc-pin(-shadow)`, `.rc-medot`, `.rc-map-banner` | `RC.routePath` + `RC.draw`, `RC.pinDrop`, `RC.breathe` |
| Music | `.rc-np > .rc-art + .rc-np-meta + .rc-scrub + .rc-np-ctl (.rc-pp > .rc-play, .rc-pause)` | `RC.playPause` (the artwork rests smaller while paused), `RC.scrubTo` |
| Home screen | `.rc-home > .rc-widget, .rc-hgrid > .rc-appicon (i, b)`, `.rc-appview > .rc-cover` | `RC.appOpen` / `RC.appClose` (the app grows out of its icon on `spring.page`) |

Patterns: `app-messages`, `app-calendar`, `app-maps`, `app-music`, `ios-home`.

## Feedback moments (`60-feedback`)

`RC.checkDraw` (disc 0.4 → 1 snappy, tick draws after 80 ms) · `RC.saved` (`.rc-saved`) · `RC.copied` (`.rc-copy`) ·
`RC.asyncButton` (`.rc-abtn`: label → spinner → check) · `RC.ringDone` (`.rc-pring`) · `RC.bump` (`.rc-nbadge`) ·
`RC.delta` (`.rc-delta`, "+N" rises 18 pt) · `RC.shine` (droplet wobble, light sweep, rainbow bloom: **the earned
moment**, once a reel) · `RC.confetti` (seeded, finite, only for the biggest moment).

Patterns: `fx-odometer-pay`, `fx-checklist-shine`.

## When building a new piece

Put it in the family file it belongs to (or a new `ui/NN-name.css|js`), size it in points, colour it from tokens, move
it with a spring or an `apple.*` curve, end the file with one `Object.assign(window.RC, { … })` (the tests read it and
refuse a name another part of the kit already exports), and give it a pattern mounted in `examples/patterns/reel.json`.
