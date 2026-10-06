# reelcut studio: Apple glass decisions

Answers from the owner, dated. Each question is asked once.

## Round 1: direction (2026-10-07)

- **Dark mode:** macOS graphite on the desktop, iOS black on the phone.
- **Navigation:** a sidebar on the desktop (icons and counts, collapsible to a rail with ⌘B); a floating glass tab bar on the phone (four tabs and More).
- **Glass:** floating controls only (tab bar, floating toolbar buttons, the selection action bar, search). Cards, panels and the sidebar stay solid.
- **Desktop density:** comfortable macOS, with 14–15 px body text and 36–40 px rows.

## Round 2: navigation and chrome (2026-10-07)

- **Phone tab bar:** Library, Footage, Reels, More. Review, Folders, References, Learnings and Jobs are under More.
- **Library top:** a capsule search field, a segmented control for All / Images / Vectors / Video / Sounds / Docs, and a Tags pop-up menu with counts. Dropping files anywhere on the window adds them, and there is an Add button.
- **Details:** an inspector column on the desktop (inset groups: Preview, Details, Moments, Green screen); a bottom sheet with a grabber on the phone.
- **Status and Higgsfield:** the status dot and Pause sit in the sidebar footer. Higgsfield moves into a Settings sheet (gear) with Appearance. On the phone both are under More.

## Round 3: components, colour, motion (2026-10-07)

- **Lists:** inset groups. Row actions go in a ⋯ menu and on right-click on the desktop, and on swipe on the phone. At most one visible primary action per row (for example Accept).
- **Accent:** keep the reelcut orange, tuned to Apple's dark orange (#FF9230) so it passes contrast.
- **Motion:** calm, like Apple. Quick, critically damped springs, a press scale, inspector and sheet slides, and a soft fade between pages. No bounce.
- **Appearance:** a theme setting only (System / Light / Dark), saved in the browser and applied before the first paint. There is no surface-style setting, so the glass follows the OS: Reduce Transparency gives the frosted look, Increase Contrast or no `backdrop-filter` gives solid.
