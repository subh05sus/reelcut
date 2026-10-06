# reelcut studio: Apple glass audit (2026-10-07)

Screens: `before/*-{dark,light}-{phone,desktop}.png` (8 tabs × 2 themes × 2 sizes). Automatic leads: `before/audit.md`.

The studio is one vanilla page (`src/studio/index.html`, about 900 lines, hash routes), served on localhost by `src/studio/server.ts`. It is mainly a desktop tool (opened from Claude Code at the end of a render), but it should hold up on a phone on the same network.

## The five biggest problems

1. **The header does everything.** It holds eight text tabs, the Higgsfield setting, the ingest status and Pause in one bar that wraps.
   - On a phone it becomes three rows and scrolls sideways (`.sync` ends at 400 px).
   - On a desktop the tabs are 32 px pills with nothing to group them.
   - The Higgsfield setting is a preference sitting in the navigation.
2. **Dark mode is a warm grey theme, not Apple's.**
   - The base is #111113 and panels #1a1a1d, separated by hairline borders rather than elevation.
   - The orange accent is used for selection, the logo, the focus ring and chips all at once.
3. **Hierarchy comes from boxes.**
   - Cards, rules, folders, jobs, moments, the key box and `<details>` are each a bordered panel. The Footage side panel is a long column of mixed bordered controls.
   - Nothing is an inset group, and nothing uses Apple's type scale. Five sizes from 11 to 15 px, all close together.
4. **Every page starts with a paragraph of explanation, then a toolbar.**
   - Library: a dashed drop zone, a search field, five filter pills and a wall of about 20 tag chips come before the first asset.
   - Learnings shows a raw native file input ("Choose File · No file chosen").
5. **Controls are below Apple's metrics and give no feedback.**
   - Sizes: 32 px tabs, a 26 px select, 33 px buttons, 11 px badges.
   - Spacing is off the 4 px grid (3, 7 and 13 px).
   - No press state; feedback is a toast. Busy states are text.

## Per page, one line each

- **Library:** the grid is good, but the filters and tags crowd it. The selection panel should be a macOS-style inspector.
- **Footage:** the card grid is fine. The detail panel is a long form; it should become grouped sections (Preview · Moments · Green screen · Details).
- **Review:** the empty state is fine. The bulk actions bar is a row of equal-weight buttons, so it needs one primary action.
- **Folders:** an "add" form above an empty list. It should be the list first, with Add as a sheet.
- **References:** a drop zone plus an empty state.
- **Learnings:** rules as bordered cards with five buttons each. They should be inset rows with a swipe or ⋯ menu.
- **Reels:** a poster grid. Good bones.
- **Jobs:** an empty state, then log blocks.

## States

Empty states exist (plain text). There are no loading skeletons: pages paint blank, then fill. Errors are toasts only.

## Accessibility

- Focus rings exist. There are no `aria-current` tabs.
- Targets are under 44 px on the phone and under 28 px on the desktop for the select.
- Reduced motion is honoured (there is little motion).

## After the pass (2026-10-07)

All the changes are in `src/studio/index.html`; the server and the API are unchanged.

### What changed

- **Foundations**
  - Apple semantic tokens: iOS black and grouped cells on the phone; macOS graphite, a window-grey sidebar and 85% labels on the desktop.
  - The reelcut orange as the one accent: #C2410C in light mode, #FF9230 in dark mode with dark text on it.
  - Type: four sizes per screen. 14 px body on the desktop (comfortable macOS), iOS styles on the phone.
  - A 4 px grid, the kit's Liquid Glass recipe ported to plain CSS (floating controls only), and one focus ring.
  - Theme setting: System, Light or Dark, applied before the first paint.
- **Shell**
  - Desktop: a sidebar with icons and counts, collapsible to a rail (⌘B), with status, Pause and Settings in its footer.
  - Phone: a milky glass tab bar with a sliding lens (Library, Footage, Reels, More) that shrinks on scroll, and large titles that hand over to an inline title.
- **Components**
  - Segmented controls with a sliding thumb.
  - Solid menus that grow from their trigger, with checkable items.
  - Sheets: centred dialogs on the desktop, bottom sheets with a grabber on the phone. Alerts replace `confirm()` and `prompt()`.
  - Inset groups with hairlines inset from the leading edge.
  - Row actions in a ⋯ menu, on right-click, and on swipe (touch).
  - Switches, tinted status badges, a solid toast pill, empty states with one action, skeletons after 150 ms, and Retry on errors.
- **Pages**
  - Library: search, Add, a type filter and a Tags menu.
  - Inspectors become a column on the desktop and a sheet on the phone, built from inset groups.
  - Review gets a glass floating action bar.
  - Folders: Add moves into a sheet; the folder settings sit in ⋯.
  - Learnings: inset rule rows with Accept and ⋯.
  - Files can be dropped anywhere on the window.

### Audit, before → after (8 tabs × 2 themes × 2 sizes)

| Check | Before | After |
|---|---|---|
| Small targets | 248 | 0 |
| Pages with sideways scroll | 16 | 0 |
| Off-grid spacing values | 772 | about 190 (auto margins and the kit's 5 px tab-bar padding) |
| Pages with clean contrast | 26 of 32 | 32 of 32 |

The only deliberate departure from Apple's values: light-mode secondary labels sit at 76% instead of 60%, and white text sits on a deeper red. Apple's own values miss 4.5:1 there.

### Checked by looking at the screenshots

- Dark and light, phone and desktop.
- Increase Contrast and Reduce Transparency.
- Reduced motion.
- The inspector, sheets, menus, More, tab-bar minimise, and the green-screen key preview.
