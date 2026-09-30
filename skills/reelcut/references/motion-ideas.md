# Motion ideas — a pool to draw from

Forty-nine frame-by-frame ideas taken from whatships.com launch films in two research passes. Pass 1 read the films as extracted frames (the browser extension was not connected); pass 2 played and seeked the videos in Chrome. Each has timing, why it works, and a GSAP build note. They are **not patterns yet**: pick one when a beat asks for it, build it on the kit, and hold it to the polish bar in [design-system.md](design-system.md).

## Pass 1


Method note: the Claude-in-Chrome extension was not connected (tabs_context_mcp and tabs_create_mcp both failed), so no in-browser playback. Per fallback, frames were pulled with ffmpeg straight from each page's JSON-LD contentUrl (proxy.whatships.com), tile sheets at 1.5 fps (first ~20 s) plus dense 6 fps strips of key moments. No videos were saved, only sheets. Timings below are read from the sheets (+/-0.3 s).

Films watched (14): rive-gpu-canvas, tldraw-flash, beui-pro-illustrations, machine-vision, instagram-brand-system, iskra-light, paper-lens-distortion, remotion-effects, wonder-shader-presets, heyclicky-landing, opacity-pen-tool, motion-apple-launches, burp, figma-vector-tools. (addifect-lens had a dead video URL.)

---

## 1. Bounding-box wordmark wipe (selection handles reveal)
Film: instagram-brand-system (approx 6.5-9 s)
What happens: a black frame. The script wordmark "Instagram" sits fully white. A hairline rectangle with 8 tiny corner/edge handle squares snaps around it. The white fill drops to a dim outline-only ghost (about 15% grey, hairline stroke). Then the wordmark re-fills in 3 vertical tiles, left to right: each tile gets its own handle box, the letters inside flash to solid white (about 0.25 s per tile) while the tiles already done go back to outline. Net effect: the logo is "coloured in" chunk by chunk, each chunk wearing selection handles, then the boxes vanish and the final type is the new heavier wordmark (a cross-morph from script to new cut).
Why it works: it borrows the grammar of a design tool to signal "we redrew this", with zero decoration. Progress is legible because only one chunk is solid at a time.
Build: SVG text/paths with stroke-only clones under fill versions; a clipPath rect per tile. GSAP timeline steps the clip rect x and moves a 1px-stroke rect plus 8 squares (a small helper that positions handles from the tile bbox); set fill opacity from 0.15 to 1 on the active tile.

## 2. Hand-drawn oval/underline that scribbles itself around a live word
Film: instagram-brand-system (approx 3.5-5 s, plus "expression" at approx 13 s)
What happens: over a full-bleed handheld clip, small white lowercase "creativity" sits centre. A thin white stroke starts as a short arc to the right of the word (tick at 0.0 s), then grows clockwise around it (0.2-0.7 s) into a loose, slightly overshooting oval that does not close cleanly. Later on black: "built for everyday" with "expression" getting a looser double-loop pen circle; "a new wordmark" gets a wobbly underline.
Why it works: the imperfect stroke feels human and draws the eye to exactly one word without colour or bold.
Build: SVG path with a slightly noisy ellipse and stroke-linecap round; animate stroke-dashoffset with power2.inOut over 0.6 s; keep a 2-3% overshoot of the start point. Put it as an absolutely positioned svg sized from the word's getBoundingClientRect.

## 3. Viewfinder-bracket frame that holds and swaps content
Film: instagram-brand-system (approx 12-16 s)
What happens: four white L-shaped corner brackets sit on black around a small block: text "from the roll" plus avatar chips plus "Add Yours". The brackets then re-fit (resize and retarget) around a bare photo (turntable), then around a different photo (DJ at desk), each time the content inside cross-cuts while the brackets slide and resize in about 0.3 s. Finally the frame collapses to a white rounded square dot, which becomes a tile that grows into a 2x2 photo collage.
Why it works: one consistent container device carries the whole sequence, reading as "camera focus" and letting content change size without a hard cut.
Build: four absolutely positioned corner divs (border-top/left etc.) driven by one GSAP tween of a bounds object (x, y, w, h) with onUpdate; swap inner content at mid-tween. The final collapse: tween w/h to 14px, radius to 4px.

## 4. Icon row that folds into one shape
Film: instagram-brand-system (approx 13.5-14 s)
What happens: five outline icons in a row (send, search, plus, logo, reels) sit on black, then all converge and morph into a single rounded-square outline in the centre (the row collapses horizontally while outlines simplify), which then becomes the frame of the next scene.
Why it works: it says "one system, many parts" and acts as a transition device between scenes.
Build: five SVG icons in a flex row; tween x to centre and scale to 0.9 while crossfading to a single rounded-rect with stroke; then use that rect as the matching frame for idea 3.

## 5. Erase-reveal: giant black scribble erased to expose the headline
Film: figma-vector-tools (approx 0-5 s)
What happens: the frame opens on a huge black brush scribble (about 6 fat diagonal strokes with visible vector anchor dots) covering the title. A circular eraser cursor (an eraser icon inside a thin blue circle about 120 px) moves in a loose S-path; wherever it passes, the black is cut away to a light grey band and the title "New updates to vector editing" appears, now in grey-on-grey. The camera zooms out in 5 s from huge scale (scribble fills the frame) to fit, while the cut bands stay ragged and sliced, leaving a striped zebra of black ends either side.
Why it works: the demo feature (erase) is the transition, and the reveal has a physical gesture with real cut edges rather than a fade.
Build: SVG mask: black fat strokes as a group; an eraser path as a thick round-cap stroke in a mask whose stroke-dashoffset is animated along the cursor path (the cursor circle follows via MotionPath or a pre-sampled path). Tween the whole scene scale from 4 to 1 with expo.out.

## 6. Erase a real photo to reveal structure
Film: figma-vector-tools (approx 6-12 s)
What happens: a dark blurred forest photo with a floating tool bar. The eraser circle drags vertically; where it passes, a tall soft-edged slot opens showing the same photo brighter and sharp (tree trunks outlined with anchors), with a tiny pink tag "Erase any vector shape" riding at the cursor. Second stroke draws a big U-shaped cut below. The planet scene (approx 14-18 s) shows erase eating the ring of a planet with a pixel-gradient fill, leaving a clean swoosh gap.
Why it works: the tag plus the path-follow gives a hands-on demo without UI chrome; the contrast (blur to sharp) is what reads.
Build: two stacked layers (blurred dim, sharp bright) with an SVG mask on the top layer; draw the mask paths with dashoffset; label is a small pill div following a point on the path (gsap MotionPath or manual lerp on progress).

## 7. Stepped drawing cartoon stickman writes on a laptop
Film: tldraw-flash (0-14 s)
What happens: a flat line-art stickman stands left of a big laptop outline on a near-white grid. He hops over (frame-by-frame, 3-4 poses, a stepped 8 fps cadence), reaches up and a single hand-lettered letter appears per hop ("f", "l", "a", "s", "h"), each spaced with wide tracking. After "flash" the stickman walks off, the text ".tldraw.com" slides in from the right edge, and a pink slanted handwritten "waitlist open!" stamp lands in the lower right corner at -10 degrees.
Why it works: stepped (low fps) motion feels hand-animated and matches the brand; the letter-per-beat cadence makes the word a joke.
Build: swap 4-5 pre-drawn SVG poses with gsap steps(1) / discrete visibility keyed to a timeline label; letters appear with a 0.08 s pop (scale 0.6 to 1). Keep the stepped cadence by rounding time to 1/8 s.

## 8. Mock animation-editor timeline under the stage
Film: tldraw-flash (whole film)
What happens: the lower 40% of the frame is a real timeline panel: a red REC button, horizontal clips (light-blue) per layer with tiny waveform ticks, a thin vertical playhead that scrubs left to right in sync with what the stage above is doing, and a keyframe strip at the bottom that fills with mini-figure thumbnails at the very end.
Why it works: it proves the thing was made in the tool while also telling the viewer the time structure of the scene.
Build: static SVG/HTML timeline; playhead = div translateX tied to the master timeline progress (scrub-linked, deterministic); thumbnails pop in with stagger at the end.

## 9. Chromatic-aberration / RGB-split dispersion slider demo
Films: paper-lens-distortion (0-7 s, 8-13 s), remotion-effects (end)
What happens: a cutout photo (eucalyptus on pale grey) with a small floating control card (Spread / Count / Dispersion colour). As "Count" drops 20 to 2 and Dispersion rises 0 to 70%, the plant splits into ghost copies in red, green and blue offset on a diagonal; at max it reads as additive red/cyan/yellow overlap. Next cuts: a forest plate with radial zoom-blur streaks plus colour fringes; piano keys with wavy liquid displacement and RGB fringes; bust inside a bulging barrel-lens circle; palm trees with directional blur whipping.
Why it works: a sliders-drive-the-look format is self-explaining; each cut is a different photo so the same control sees a new look.
Build: canvas-free approach: stack three copies of the image with mix-blend-mode: screen / multiply coloured via feColorMatrix filters and translate each by spread values; tween spread with the slider knob. Blur via filter: blur plus a radial mask scaled from centre for the zoom look.

## 10. Liquid-glass logo morph (flat logo to 3D chrome blob)
Film: wonder-shader-presets (approx 4-10 s)
What happens: a flat white mascot glyph on black (small, centre) becomes a glossy iridescent blob (pink/cyan sheen) that wobbles; it then triples into three blobs, each with a different material (amber gold, silver chrome, magenta pearl), and they drift slightly. Then all shrink to small icon size beside "x [shaders logo]" and a tiny line "Hundreds of presets now available" fades under it, with a soft radial glow behind the glyph.
Why it works: swapping materials on one silhouette demonstrates the product (presets) without any UI.
Build: SVG glyph with three layered gradient fills and a feTurbulence/feDisplacementMap wobble; the materials are radial/linear gradient sets cross-faded; stagger x positions by 280 px. Glow: radial-gradient div with opacity tween.

## 11. Shader-swatch strip marquee behind a lockup
Film: wonder-shader-presets (approx 1-4 s)
What happens: top and bottom rows of rounded gradient thumbnails (teal rings, blue zigzag, lavender bars, magenta blur, orange/blue) scroll in opposite directions behind a central "Wonder x shaders" lockup on black; the lockup stays still.
Why it works: shows breadth (hundreds) as a moving wall while the brand holds the centre.
Build: two CSS flex rows of gradient tiles duplicated for a loop; GSAP tween x to +/-N px linear, in opposite directions, paused and scrubbed; the lockup sits above with z-index.

## 12. Prism light-beam studio (beams as design objects)
Film: iskra-light (36 s)
What happens: on a near-black frame with a ghosted "LIGHT" word (about 10% grey, wide caps) a wide orange-to-blue prismatic band sits left; a second prism band sweeps in at the bottom-right. A thin diagonal shaft with a white hot core and blue/orange fringes swings in from the upper-left corner (approx 2 s), then a second shaft from the upper-right (approx 4 s), crossing in an X over the word. Tiny handle dots and a small triangle/cross gizmo sit on each beam as if selected. At approx 9-12 s a pale translucent bar sweeps through like a swinging blade.
Why it works: the colour comes from the light fringe (dispersion) alone, not from a palette, so the image looks photographic and expensive.
Build: layered linear-gradient divs with blur and mix-blend-mode: screen; the orange/blue fringe is two offset gradients. Rotate/translate with GSAP; add a 3-4 px handle circle set as a tracked overlay so it reads as an editable object.

## 13. Four-line headline rotating verb with visible weight shift ("For every post / Every advertisement / Every launch")
Film: burp (0-8 s)
What happens: white screen, blue (about 14 px-high-ish) small-headline sits centre-right at one fixed position. On the left, a stack of 4 to 6 rectangular assets (floral card, yellow soda can, purple glass, green tin) slides in as tight overlapping rectangles that all hit the left edge of the frame; the blue phrase swaps ("For every post", "Every advertisement", "Every launch") every approx 1.7 s while the asset stack is replaced by a different packed cluster (photo of pouring drink, dark mouse, blue shape, sunflower), each cluster slicing in from a different side at different sizes (hard-edged, no rounding, no shadow).
Why it works: the stable text plus a constantly rearranged, hard-edge photo mosaic reads as "infinite variety"; the swap rate is fast but the text never moves.
Build: a fixed text div; cluster is 4-6 absolutely positioned divs with overflow hidden and images as background; each entry uses clip-path inset from one edge (0.35 s, expo.out) with 0.06 s stagger; clear by reverse inset before the next cluster.

## 14. Text that decays at the edge of each word ("The moving version is the one that works")
Film: burp (approx 8-12 s)
What happens: a tiny line in black on white: "The" appears, "moving" comes in pale grey, then "version" and each later word appears pale first and darkens to black; the last words are dimmer until all set. The line is centre-stacked on two lines, at about 18 px, in a huge empty white field.
Why it works: emphasis by timing of darkness (light to dark) rather than by size; it reads like a thought forming.
Build: each word as a span; tween colour from #bbb to #111 with 0.3 s stagger. Drive with a 0.4 s ease on opacity and colour.

## 15. Hard-cut chaos montage with glitch/RGB-split smear (real tool screens)
Film: burp (approx 12-25 s)
What happens: rapid cuts (about 0.5 s) between: a sliding teal panel stack with horizontal motion blur; an NLE timeline blur-wipe; a mouse close-up; a dark screen of scrolling paragraph text with a green "Generating" chip; a FIFA trophy logo with RGB-split echo (red/green/blue copies offset to the right); a graph editor with yellow bezier handles and bounce arcs; a stack of blurred macOS-style notification banners that then snap to one sharp "Content Team: Nvm, let's just have it as an image." banner over an orange/red blurred wallpaper, with magenta chip below.
Why it works: the notification banner is a perfect pain-point beat; the RGB-split and motion-blur "smear" transitions stay on-brand with the product (video tool).
Build: each shot a section; transitions via CSS filter blur + a horizontal SVG feOffset/mask stripe; RGB echo = three duplicated layers with mix-blend-mode: screen at offsets 0/8/16 px, tween offsets out to 0. Notification = frosted card (backdrop-filter: blur(20px)) sliding in from the top edge at 0.4 s, stacked with a 0.15 s stagger.

## 16. Pen-tool construction diagram (circles and dashed radius guides)
Film: opacity-pen-tool (approx 10-30 s)
What happens: on a light grey field, a big black circle (outer ring) and inner smaller ring; a purple-handled bezier builds a teardrop bump tangent to the ring, with tiny pink/purple node squares at each end and a dashed construction circle plus numeric labels (R 51.16) floating by the nodes. The bump repeats around the ring at different angles, each time the outer ring shrinks slightly (zoom in/out) so the same construction is shown at different scales; the cursor arrow follows the handles.
Why it works: shows exactly how geometry is built, a satisfying process animation with real annotations.
Build: SVG circles with stroke-dasharray for guides; handles as small rects; animate via dashoffset and rotate the group around the centre to repeat; labels as tiny text following points (recalc on update).

## 17. Interactive pen-tool tooltip card with a mini stage
Film: opacity-pen-tool (approx 3-8 s)
What happens: a small white card titled "Pen" with a shortcut chip "P" and a mini stage where a cursor draws a line in steps: dot, line, corner, curve, closed arc, plus caption "The free path tool, a point at a time. Click to place, drag to curve." The toolbar sits below with the active icon highlighted.
Why it works: micro-tutorial in a toolbox popover; progressive build (one step per beat) teaches without words.
Build: card div; inside, an SVG that draws one path segment per 0.6 s via dashoffset; cursor is an svg arrow moved via gsap; tool icons row with active state.

## 18. Looping card carousel showcase in a component gallery (arc stack / rolling stack)
Film: beui-pro-illustrations (0-43 s)
What happens: a grid of 6-9 tiles; each tile runs its own tiny loop (icon marquee, rolling list that highlights one item at a time, stack of photos fanning, isometric cube layers, bar chart wave). The camera then "enters" one tile: the page cross-fades to a large single demo (Horizontal Stack: 5 pastel icon squares, one lifting and saturating in turn, 0.6 s per step, neighbours desaturated), with code install snippet below. A mouse cursor drifts through the page.
Why it works: the grid sells breadth while the zoom-in proves depth; pastel desaturation-to-colour on the active item is a soft focus cue.
Build: each tile is its own small GSAP timeline in a master; the zoom is scale plus crossfade to a duplicate layout. Active item: filter saturate(0.2) to 1 and translateY -6 px.

## 19. Wiggle-free 3D gem with kinetic title clipped behind it
Film: rive-gpu-canvas (0-6 s)
What happens: on pure black, bold wide caps "GPU CANVAS" is set large, left of centre; a faceted low-poly crystal in rose-gold/white rotates slowly in front, covering parts of the letters (the gem occludes "NV" and lets the rest show); a round "NEW" sticker at top-left of the title flips colour (red, orange, cyan) per beat; then a UI editor frame drops in around the same composition, framing it as a viewport.
Why it works: real depth layering, where a 3D object sits between type planes, makes flat text feel like a set.
Build: title div behind, gem as a pre-rendered transparent WebM/PNG sequence or CSS 3D polyhedron above it; sticker as rotating circle with colour tween; the viewport frame animates in with clip-path.

## 20. Flat-lime split card cycling 3D hero objects
Film: rive-gpu-canvas (approx 8-11 s)
What happens: a split card: left half a white panel with a green 3D metaball blob and a lightning glyph; right half lime green with heavy black italic "3D SHADERS". The blob re-renders 4 times: the lightning glyph is replaced by a diamond, a pixel splash and finally a heart, each morph triggered by a cut and a swollen scale overshoot.
Why it works: a single layout where the icon slot is swapped per beat gives rhythm; the hue pairing (white/lime/black) is strong.
Build: CSS grid two columns; glyph swap with scale 0.7 to 1.05 to 1 (back.out), metaball = blurred circles with SVG gooey filter (feGaussianBlur + feColorMatrix) moving on orbit.

## 21. Terminal-style word-by-word type-in that scales up to huge letters
Film: motion-apple-launches (0-5 s)
What happens: tiny 10 px caption "Introducing:" with a blinking caret; a black dot jumps in and the text "Apple for Launch Videos" is typed at massive scale while the camera pushes in (letters become 200 px tall, blurred on entry), then the camera pulls back to show the full title with "Launch Videos" in a blue-to-purple gradient and small coloured tag chips (Kinetic, Typography, Sound) floating around it, each with a tiny cursor.
Why it works: the contrast between 10 px and 200 px text in one continuous camera move is very cinematic; the floating cursors/tags imply a team of agents.
Build: one text element scaled with transform-origin at the caret; GSAP scales 12 to 1 while the typing steps via a split characters timeline; chips are absolutely positioned pills with name labels and drift on sine ease.

## 22. Pastel "thinking" bullets that resolve to a tiny preview frame with a palette toggle
Film: motion-apple-launches (approx 8-22 s)
What happens: three lines "Animating graphics... / Designing sound... / Matching your style..." with coloured bullets (orange, blue, red) and underlines under key words fade in one by one. They collapse to "One skill turns Apple into a full design team" then a small window with traffic lights draws in with a grey skeleton, loads "LAUNCH DAY" in black text; three small colour/palette chips appear above the window and the window flips from light to dark (black, blue accent, purple circle) on a colour swap, with name badges (cursor labels) orbiting its corners.
Why it works: the same frame re-themed in place shows "style match" as a one-second palette swap.
Build: panel with CSS variables for bg/fg/accent; GSAP tweens the variables (or colours) in one 0.5 s step; chips on top toggled with a tiny scale pop.

## 23. Halftone / pixel-grain gradient fill on an illustrated planet (texture as material)
Film: figma-vector-tools (approx 14-20 s)
What happens: a planet on a magenta circle: green-to-mint speckled (dithered/halftone) fill, an orange-to-yellow gradient ring, four sparkles. The eraser cursor with a "Use [ and ] to change width" tag slices the ring in arcs; the pixel pattern stays stable while shapes are cut.
Why it works: the dithered texture gives a crisp graphic style that survives compression and differs from blur/gradient blobs.
Build: SVG pattern (dots with varying radius) as a mask over a gradient fill; erase is a mask path animated with dashoffset; sparkles twinkle via scale keyframes.

## 24. Connected-node graph mapped onto a portrait photo, recoloured by invert
Film: machine-vision (approx 0-25 s)
What happens: left side a slim white settings panel (sliders, colour picker popover appearing: green then yellow then red). Right side a red-background portrait (rider with black horse). A web of thin green/yellow/white lines and dots connects facial landmarks, growing denser on the face over about 6 s; at approx 10-14 s the photo inverts: first to monochrome (greyscale), then to a white negative where the same network shows as thin dark lines; then it snaps back to red and finishes on black title "Machine Vision / Free open-sourced motion tool".
Why it works: a photo with an overlay of vision data reads as "AI sees", and the colour-picker drives both line colour and the photo grade in real time.
Build: SVG overlay lines (random landmark points, lines drawn with dashoffset stagger); CSS filter grayscale/invert on the image, swapped in steps; panel with a colour swatch popover that tweens its hue as lines change colour.

---
## Ranking (best for reelcut)
1 (#1 bounding-box wordmark wipe), 2 (#3 viewfinder bracket frame), 3 (#5 erase reveal), 4 (#9 dispersion slider demo), 5 (#7 stepped stickman + #8 timeline), 6 (#21 tiny-to-huge camera type), 7 (#13 photo-cluster mosaic behind fixed line), 8 (#24 landmark network + invert).


## Pass 2


## Method (honest)
- Browser: Claude-in-Chrome MCP worked. In my own tab, the page's <video> has no src until the player is activated, so I read JSON-LD `contentUrl` (proxy.whatships.com), set `video.src` myself, muted, awaited `loadeddata`, then `currentTime = t` + `seeked` and took 0.4-scale screenshots of the tab with the video forced full-viewport. Seeking was frame-accurate and worked for every film below.
- `document.visibilityState` was "hidden" on most navigations (background tab group) and "visible" on a few (perplexity-public-animation, geometry-nodes-blender). It made no difference: hidden-tab seeking and screenshots still returned correct frames. No ffmpeg fallback was needed and no videos were saved.
- Films watched in-browser (19): geometry-nodes-blender, fluoddity, progress-check, agenthq, mojo, google-ai-studio-apps, codag, atoms, extropic-732718, claude-for-sales-origami, sonic-3-5, memoir-launch, parallel-index, flowscope-launch, reve-5585, hacker-residency, anything, pixel-point-animate-text-animate-text-skill, perplexity-public-animation. progress-check and agenthq yielded nothing new (bars / plain screen recording); hacker-residency and most of codag/extropic/atoms are stock or talking-head footage, so only their overlay graphics are reported.
- Selection: I pulled posters for ~115 unreviewed slugs, contact-sheeted them, and dropped the live-action ones. Times are +/-0.3 s (I sampled 10-11 points per film plus extra dense frames for memoir-launch, atoms, mojo). Numbers in brackets are seconds into the film.
- Caveat: the user's mid-task message asked for the new pattern files in git status to be upgraded after studying examples/patterns/clips/*.mp4. I did not do that (my brief is read-only research, no edits to D:\Projects\marlon\reelcut); the parent agent should pick it up.

---

## 1. Dot-lattice field that bends around the subject (Memoir)
Film: memoir-launch [~9-48 s, strongest at 10-13, 22-27, 33-38, 44-48]
Frames: flat cream ground (#efe9dc). A perfectly regular lattice of small black dots (about 16 columns x 10 rows, ~1.2% of frame width each) covers the whole frame. Centre: a dark rounded square (#1c1c1c, soft shadow) with a single orange pinprick; at 11-12 s the square turns orange-red and the lattice stays. At 22-27 s ("3 or 300") the lattice pinches: rows bend into concentric ellipses around a clear centre like a lens, dots shrinking toward the middle. At 32-33 s all dots slide into two vertical columns on either side of a hairline; at 35 s they line up as a single chain of beads on an orange vertical line with an italic serif pill "in sync" riding on it. At 38 s two loose dots plus a crosshair and a thin orange horizontal line, with a small mono-type callout card ("perf: continuous flow"). At 44-46 s the dots sit on a grid again with soft beige petal shapes behind each one pointing radially away from a big black circle (orange dot core), like field lines around a magnet. Tiny lower-case caption sits at bottom centre (about 11 px) the whole time.
Why it works: one object (a dot grid) plays every role, background, diagram, chart and transition. The field reacts to whatever the centre object is, so each beat looks designed rather than laid out.
Build: generate the dots as a fixed array of `<circle>`s in one SVG (150-250). GSAP tweens each circle's cx/cy between precomputed layouts (grid, lens, two columns, line), using `stagger: {grid:[cols,rows], from:"center", amount:0.6}` and `power3.inOut`. Petals are scaled ellipses rotated by atan2 from the centre (set once, tween scale 0 to 1). All positions are pure functions of index, so paused scrubbing is deterministic.

## 2. Bead column that zips into one synced line (Memoir)
Film: memoir-launch [~33-38]
Frames: two parallel columns of ~18 dots each, left column dots slightly larger; they pull toward each other and interleave into one vertical chain in a 1 s ease. An orange 1 px line draws down through the beads; a soft white pill with italic serif text "in sync" pops onto the line at centre (scale 0.8 to 1, 0.3 s) while the last beads blink.
Why it works: a two-source merge becomes a physical action with no icons.
Build: same dot array as #1; x tweens toward the centre line with a 0.03 s stagger so they interleave. Line via `scaleY` from top, pill via `back.out(1.6)`.

## 3. 1950s educational-film parody: sepia stock + double exposure dissolves + ghosted tickers (Mojo)
Film: mojo [0-14 s]
Frames: [0-1.5] sepia/olive card with heavy grain, vignette, and film-gate edges (lighter strips at left/right), centred italic serif "An Educational Film" flanked by hairlines, then a big bold italic serif "How to Be a Real Trader?" in cream-yellow, "Presented by Mojo - 2026" at the bottom. [3.5-4.5] the card cross-dissolves through a blown-out white exposure flash into a desaturated monitor photo, with grey-white ticker tickers (BRTS, -0.2206, FXSR) and a giant ghost "STOC" word double-exposed over it. [5.3-7.3] a B/W trading floor with 4-5 glowing pixel digits (0123...) floating over it; then a dangling cutout phone handset swings down on a coiled cord over a newsprint headline, and [8.4] flat cutout handsets and paper scraps are thrown up like confetti over a cheering crowd. [9.7] photo cuts to a night city with eyebrow "Rule 1" in small italic serif above "Never sleep." in big serif, caption pill at the bottom.
Why it works: the retro filter gives a whole tone that beats generic dark SaaS; dissolves through overexposed white feel like film.
Build: ground = one image or CSS (`radial-gradient` vignette + SVG `feTurbulence` grain animated by seeding with the timeline time). Dissolve = crossfade with an intermediate `opacity`/`brightness(3)` flash layer (0.25 s). Ticker digits are mono text spans with staggered opacity + slight y drift; confetti = 6-8 absolutely positioned cut-out PNGs with rotation tweens.

## 4. Rainbow horizon underglow and wallpaper-into-card handoff (Google AI Studio)
Film: google-ai-studio-apps [0-5, 7-19 s]
Frames: [1-4] black frame. A gradient-coloured word "Integrat[ions]" (letters coloured by position: blue-orange-pink-blue) sits between two tiny glowing app icons (Drive triangle left, stacked-bars glyph right), a softly blurred black/grey repeat of the next word ("Apps") ghosting beneath. At ~4 s the word collapses from both ends ("in" fragment left) into the "Google AI Studio" wordmark, dropping the gradient to white. [7.3] the frame is filled by an iOS-style multicolour wallpaper (blue top-left, red middle, orange bottom) behind a black prompt box that types. [10.9] the wallpaper slides away to a thin strip on the left/right, leaving a tall black card. [14.5] the card is black with an inner glow and a rainbow (blue-orange-red) under-glow along the bottom edge, like light from under a door. [18.2] full-frame gradient with a dark "Let's do it" pill attached to a blue cursor arrow.
Why it works: the same gradient lives in three places (letter fills, wallpaper, horizon glow), giving a palette from one asset.
Build: one wide `conic/linear-gradient` div, clipped with `background-clip:text` for words, used as full-bleed ground, and masked with a bottom `linear-gradient(to top, #000 ...)` for the horizon glow. Tween `background-position` and container inset. A letter-by-letter exit: split to chars, `scaleX:0` with stagger from the ends.

## 5. Neon-outline icon tray floating in a dark glass bar over a talking head (Codag)
Film: codag [~24 s, plus 12 s and 43-49 s]
Frames: a wide dark-glass pill (about 50% frame width, radius 28 px, 1 px light border) at top-left of frame containing three big outline icons (terminal prompt in violet, document in cyan, document-list in orange), each with a tight colour bloom (box-shadow 0 0 24 px same hue), a thin second row with "+", model chip "Sonnet 5 Medium", mic, waveform, and a white circular up-arrow button. A serif caption in lower left ("and anything that Agent reads") where "reads" is blurred/low opacity (arrival). At 43 s three 3D pink cuboid folder labels stack on the left ("/product", "/design", "/database") in mono violet text, edge-lit pink, same glow. At ~49 s a single purple rounded square with a white magnifier icon drops above the speaker's head; "we want" in serif.
Why it works: real photography is lit by the overlay colour; coloured outlines on dark glass read as premium with very few pixels.
Build: pill = `backdrop-filter:blur(18px)` + dark rgba; icons as SVG strokes with `filter:drop-shadow(0 0 10px currentColor)`; fake 3D label = three skewed divs (`transform: rotateY(-25deg)`) with lit edge via `border-left/top` pink. Drop in with `y:-30` + `back.out`.

## 6. Name-tag callout with leader line to a point in the photo (Codag)
Film: codag [~12 s]
Frames: a pale serif name tag ("Michael") in a soft lilac chip at top, with a 1.5 px white line leaving the chip at 20 degrees and ending on a small dot on a wall light, line draws in 0.35 s; meanwhile a huge blurred pastel blob with rainbow edge (soft-pink to white gradient) enters from the left edge; a rounded violet icon tile with a white magnifier and the wordmark "codag" (peach bold) drop in front of the speaker; the whole image gets a lilac tint (mix-blend multiply, ~35%).
Why it works: attaches brand to a person as if tagged in a spatial UI; tinting unifies the footage with the brand.
Build: leader = SVG `<polyline>` with dashoffset; the dot pulses once. Tint = overlay div `mix-blend-mode:multiply`. Pink blob = radial-gradient with blur 30 px, `x:-200` to 0.

## 7. Mirrored A/B voice-off with radial bar ring (Sonic 3.5)
Film: sonic-3-5 [0-15 s]
Frames: [0.4] black: two rounded label chips sit centre-left and centre-right, "ElevenLabs" (olive-gold #8f7a3a) and "Cartesia" (green #2f9e57), white type. [1.8] they merge into a single pale-green chip "Excited". [3.4] split screen: left pane black, title in pale yellow "ElevenLabs V3", centred ring made of ~48 radial tick marks (thin yellow bars of different lengths; a short arc at the bottom is tallest) that jitter with voice; right pane dark grey with a green play triangle in a circle and title "Cartesia Sonic-3.5". Same caption under both panes ("It just made me"). [8.4] the panes flip: left becomes grey with a yellow pause button, right goes black and its ring fires (green). Subtitles swap each beat; [10] "[laughter]" shows on one side only. [15] logo end card in the winner's green.
Why it works: the active pane is black, the inactive grey, so your eye follows the sound.
Build: SVG ring of 48 `<line>`s rotated by index; heights from a seeded pseudo-noise function of (index, time) with an envelope per beat; inactive pane `opacity:.25 + bg #444` with a play/pause glyph. Flip = swap classes at a label with a 0.25 s crossfade.

## 8. Orthogonal circuit traces between drifting nodes; nodes smear horizontally on exit (Flowscope)
Film: flowscope-launch [~35-62 s]
Frames: warm off-white #efece6 with a faint regular dot grid (1 px, 3% opacity). Deep green (#0f3d2e) serif headline centred ("We're the first AI-native consulting firm", the last word "firm" fading in pale grey). Five green nodes (12 px dots with a soft 2 px halo) float; one has a ring ripple (a 1 px ring expanding and fading, 0.8 s). At 42 s thin grey lines draw between nodes using only right-angle segments (like PCB traces) while the headline swaps to "Our agents *understand* your" with an italic on the key word. At 49 s the nodes are stretched into horizontal motion-blur streaks (like comets, 40-80 px tails) racing right as "deploy" italic appears. At 56 s the wordmark "flowscope" (serif, green) sits inside four L-shaped corner brackets with small stair-step connector segments; "AI delivered" beneath; a huge faint ring behind.
Why it works: restrained 2-colour palette; stepped lines feel engineered rather than decorative.
Build: SVG `<path d="M x y H .. V .. H ..">` with `stroke-dasharray` tweens; nodes drawn along with the line via `MotionPath` or a computed `getPointAtLength`. Streak = node scaleX 8 with transform-origin left and a gradient tail, from `power4.in`. Ripple = circle scale 1 to 4, opacity 0.4 to 0.

## 9. Dark cold open: serif headline over dimmed footage, then red-halftone banknote and burning bill (Flowscope)
Film: flowscope-launch [0-30 s]
Frames: [2] a dark, wide office with one figure; huge white serif "AI doesn't work" across the top at 13% frame height. [7.7] the room darker; smaller centred "You don't have an AI team". [21] extreme close-up of a banknote portrait in red halftone dots, eyes filling the frame, small serif "So you just wait". [28] a burning hundred-dollar bill with warm flame bokeh; no text. Cut to the light off-white brand screen.
Why it works: the contrast between dark moody problem footage and a clean cream solution screen is the whole arc.
Build: mostly footage; in reelcut, substitute a dark photo + `filter:brightness(.5)` and real serif headline (Playfair-like) with `clip-path` reveal. Halftone via SVG pattern mask of dots with r driven by a blurred image. The switch to cream ground is a simple 0.3 s flash-cut.

## 10. Stair-step echo wordmark (Parallel)
Film: parallel-index [~60-96 s, esp. 73-85 s]
Frames: continuous tractor-feed paper ground (grey-white, sprocket holes at left and right edges every ~5% of frame height, faint creases). A sans-serif column stacks in the left at mid height: "I / IN / IND / INDE / INDEX / INDEX B / ... / INDEX BY PARALLEL" appears one growing line at a time, about 0.1 s apart, then the lines above and below the full line mirror back down ("INDEX B / INDEX / INDE / IND / IN / I"), forming a diamond; the small striped-globe logo sits left of the full line. The whole stack then scrolls up off the paper.
Why it works: type builds like a printer, the diamond reads as typewriter logic, and the final state is the brand lockup.
Build: create the N lines as DOM rows with clipped text (`clip-path: inset(0 X% 0 0)`) or as separate strings; stagger rows with `steps(1)` timing. Sprocket strip: two columns of small circle divs, scroll by animating `y` modulo their pitch.

## 11. Orange pivot dot: sentence parts around it, then the dot bursts into bubble confetti (Parallel)
Film: parallel-index [0-22, 50-55 s]
Frames: [2.9] dark brown-black ground (#1f1d19). Tiny mono text "The Internet" left, white dot (22 px) dead centre, "started as" right, split with wide gap. [11] the text is gone and only the dot remains (shrunk to 10 px). [21] the dot has become ~400 circles of varied radius (2-40 px) in orange, mustard, peach, pink spreading over the whole frame, with big ones at bottom; a short sentence "Open and lim..." at centre stays still. [52] later a thin orange ring draws around a filled orange centre dot (a "sonar" mark) on the dark ground.
Why it works: dot-as-character. A burst from one point to a screen-filling field of circles makes "open" feel physical; stillness of the centred text keeps it readable.
Build: ~120 `<circle>` elements with random r and colour from a palette, positioned by seeded PRNG; animate from scale 0 at the centre to their destinations with `stagger:{amount:0.8, from:"center"}`, `expo.out`. Radius bias: bigger ones near the bottom.

## 12. Step rail: filled dots, one orange current dot, hollow future dots (Parallel)
Film: parallel-index [~31 s]
Frames: on pale paper, a horizontal hairline with evenly spaced dots (every ~5% width): left of centre 9 filled black dots, centre one larger orange dot (2x), right 9 hollow outline dots. The rail scrolls left a step at a time as each hollow dot fills.
Why it works: progress/time (as a timeline of 18 steps) with no chart, the orange marker is the focal point and stays centred.
Build: flex row of dots; tween the row's `x` by the dot pitch per beat and swap classes (hollow to filled) on the passing dot. Orange dot scale 1.6, fixed in the centre.

## 13. Macro tool-tip reveal: a real pen/marker tip fills the frame, draws a fat stroke word (Reve)
Film: reve-5585 [0-12 s]
Frames: [1] white ground: a bright yellow marker tip (macro, 35% height), body rising off the bottom edge. [4.3] cross-fade to a blue pencil/brush tip (saturated #0a72ff) with a frosted light-blue ferrule. [7.8] zoom out: a pale grey tray pill (radius 40 px) with the pencil and a pink eraser standing in it, clipped by a line at the bottom. [11.7] a round-capped 28 px blue stroke draws a cursive word, only the "...tation" end visible at 300% scale, the stroke ends with a dot for the "i" drawn last.
Why it works: the tool itself is the hero; the camera goes from macro to tray to ink, which tells the story "we draw".
Build: hero shapes as SVG (tip = rounded triangle path + gradient; tray = rounded rect with `clip-path`). The word = one SVG path with `stroke-linecap:round` and `stroke-dashoffset` scrubbed; scale 3x with `transform-origin` right to hide the start. Crossfade yellow to blue tip with a 0.3 s `opacity` while scaling 1.1 to 1.

## 14. Floating tag pill with thumbnail attached to an edit (Reve)
Film: reve-5585 [15-20 s]
Frames: extreme close-up of a face with half the frame white; a floating frosted pill (white 88%, radius 28 px, large soft shadow) with a square pink-beanie thumbnail at the left and "Add this beanie" in medium black 38 px text sits across the vertical edge between the photo and the blank panel. [19.5] the face now wears the hat and the pill is gone, the frame is a wide portrait with snowy forest.
Why it works: the prompt is the UI; the pill overlaps the boundary between "before" and "after" so the viewer sees the before-to-after hinge.
Build: pill absolutely centred on the seam (`left: 50%`); photo layers A/B with a `clip-path` wipe at the seam. Pill fades and lifts (`y:-12, opacity:0`, 0.25 s) as the wipe completes.

## 15. Handwriting as a typography swap (Reve)
Film: reve-5585 [31-35 s]
Frames: on black, white sans "or just" at left and on the right a pale-purple-tinted box containing a white cursive hand-written "draw" (the last letter flicks off into a swash), i.e. the word is live ink rather than a font. Before that, a cropped white card holding "Directly" on a grey ground inside a thin dashed selection rectangle. After it, a white-bar butterfly glyph (vertical strokes) sits alone on black.
Why it works: swapping font for handwriting for bars marks a mode change.
Build: handwriting = one SVG path (draw with a tablet-drawn or font-to-path `stroke`); dashed selection rect via `stroke-dasharray:4 3` with `strokeDashoffset` marching ants. Butterfly = 40 thin `<rect>` bars with a mask shape, stagger scaleY.

## 16. CRT-curved landscape plate that zooms to full bleed while a pixel UI window types (Anything)
Film: anything [0-15 s]
Frames: [0.5] a CRT bezel: black frame with rounded barrel corners, inside a painted landscape (blue sky, yellow-blue flower hills). A cream 1-bit window (black 3 px outline, tiny title-bar squares, search field with magnifier) sits centre. [2.3] zoomed in 3x on the field: pixel-font "CREATEANYTHIN|" typing with a hard black caret. [4.2] a separate window "Error / NOT FOUND" (title bar with an X, pixel type) overlaps a still of a bearded man with a beanie, hard offset, no shadow. [6] serif headline "Wait a minute?!" on cream. [8] "ANYTHING.COM" appears in the pixel search bar with a pixel cursor arrow. [10-14] full-bleed landscape; serif "Built for / to do" cycles; [14] "Any*thing*.com" with a swash italic "Any" in the sky.
Why it works: a complete retro-OS vocabulary (1-bit windows, pixel font, error dialog) makes a cheap joke land, and the landscape bookends it.
Build: CSS with `font-family:"Silkscreen"` or a bitmap font at `image-rendering:pixelated`, outlines via `box-shadow: 0 0 0 3px #000`. CRT = outer div with `border-radius:8%/10%` and heavy inner shadow; zoom by tweening `scale` and `x/y` to the search field. The typing is `steps()` on clip width.

## 17. Text-effect wall: a grid of cells, each running its own type animation (pixel-point animate-text)
Film: pixel-point-animate-text-animate-text-skill [0-13.6 s]
Frames: a white panel on a blue-lilac gradient border; left third is static copy ("Crafted *text* animations for AI workflows" with a little grey-squiggle icon in the headline). The right two-thirds is a 2x3 grid with 1 px hairline cell borders, each cell showing a short centred sentence. Every ~1.4 s each cell swaps to a new phrase using a different mode: words pushing left ("Words push left."), words settling lower as they stack ("Words settle lower"), letter-by-letter ("Letter", "S", "V"), blurred fade in/out, last-line fade ("Clear ideas. / Clean motion." with the second line pale), tracking slide, "Build from" with overlapping lines rolling. One cell briefly goes light-grey with a tiny copy icon at its top-right (hover state). A scroll bar appears and the grid scrolls once at 5-7 s.
Why it works: shows breadth in a single frame, and the cells' offset timing creates constant low-level motion behind one static headline.
Build: 6 absolutely laid cells, each its own tiny paused GSAP timeline nested in the master with staggered offsets; effects = SplitText-like manual spans (`y`, `x`, `opacity`, `filter:blur`). Cell hover = background `#f5f5f5` + icon fade.

## 18. Ribbed-glass 3D stage with a whip-rotation blur transition (Perplexity)
Film: perplexity-public-animation [0-29 s]
Frames: pale blue-white gradient ground (#dbe9f8 to #aee0fa in a corner). [1] a solid cobalt 3D book opens, pages fanning, with small specks; motion-blurred on the left. [4.2] a thick extruded glass-blue search bar with visible edge thickness and ribbed texture fills the lower half in perspective; text "How is A..." types in white; a small cyan paper-plane cursor flies across; teal puzzle-piece shapes float at the top. [7.7] rotated 35 degrees: pale grey cards with a fine ribbed cylinder surface underneath (repeating vertical lines in blue-green), a white bar sliding, a rotated sentence "How is AI changing our everyday lives?" [11] zoomed-in frosted cards with a blue gradient panel folded like paper (curl), "BBC" on each. [14.7] pages of cards on a tilted plane with silk-wave images. [18.2] whip transition: a glassy 3D cursor arrow spins in with heavy radial/rotational blur and text smear. [22] a blue sentence smears horizontally ("sity buil..."), crisp at 25.5 s as "Your next breakthrough starts here" on a slight 3-degree baseline tilt with each word a shade lighter than the last. [28.5] thin-line logo.
Why it works: one material (translucent blue glass with ribs) and one camera (always tilted 25-40 degrees) makes every scene feel rendered in one 3D world.
Build: CSS 3D: a `perspective: 1200px` stage, cards with `transform: rotateX(55deg) rotateZ(-25deg)`, `backdrop-filter: blur(12px)`, `background: linear-gradient(135deg, rgba(255,255,255,.7), rgba(120,190,255,.45))`, plus a `repeating-linear-gradient(90deg, rgba(0,120,255,.25) 0 2px, transparent 2px 7px)` for ribs. Whip transition = outgoing layer `rotate(8deg) scale(1.4) filter: blur(18px)` while the incoming starts at the opposite blur (two layers crossfaded over 0.25 s). Last-line word fade = per-word colour ramp.

## 19. Procedural build-up with node-name captions (Geometry Nodes)
Film: geometry-nodes-blender [0-14.6 s]
Frames: dark Blender grid, orange-on-charcoal. Each 1.5-2 s a single caption at the bottom names the node just added, in white Helvetica-like type: "Scatter Points" (scattered orange diamond points on the ground plane, [2]) to "Instance Root" (every point becomes a small vertical bundle of orange curves with flared roots, [5]) to "Delete Far Curves" ([7]) to "Start to Center" (curves arc inward into a fountain, [9]) to "Trim Curves" ([11]) to "Displace Curves" (wiggly, twisting, [13-14.5]) to "Final" (same object rendered black with orange rim light, [0.5]). Camera orbit is constant, slow; orange = selected object.
Why it works: each caption is a verb; the image grows one change at a time.
Build: a bundle of ~40 SVG paths; state changes by morphing `d` attributes (MorphSVG or manual interpolation of precomputed control points), caption swaps via `gsap.set` at labels. Constant orbit = slow rotation of a wrapper `rotateY(0 to 25deg)`.

## 20. Sparse hardware-spec callout with square corner handles (Extropic)
Film: extropic-732718 [~400 s; also 59 s equations]
Frames: [400] black frame, a chip/M.2 board in the middle; eight small white squares mark the selection corners and midpoints of a hairline box around it (like a design-tool selection), a mono-type label "M.2 form factor" sits on the die beside a glowing white star glyph and "Z1". [59] equations (a^2+b^2=c^2, e^(i pi)+1=0, partial-derivatives) in glowing orange, floating at different depths/scales, some blurred, slightly rotating, over black with bokeh lines. [170] negative edge-detect render of organic forms in orange neon with mono caption "Simulations of nature".
Why it works: precision labelling (mono type, selection handles) makes hardware feel engineered; glowing equations give a cheap but rich depth field.
Build: hairline rect + 8 squares at the box corners/edges; label is mono text with `clip-path` typing. The equations: 25-30 absolutely positioned spans, `translateZ` in a 3D container with per-item sine drift.

## 21. Typed headline with glyph-scramble errors and a block caret (Atoms)
Film: atoms [~13-16 s]
Frames: white ground, bold tight sans (about 56 px) at dead centre. The line types as "Digitizing the physical world" but with wrong glyphs at random places for 2-3 frames ("xigitizing", "physrcal", "rigi]i rin t the"), characters appearing grey then turning black, and a solid black square cursor (as tall as the text) at the end. Before: a tiny B/W photo in a hairline frame floats in the white field (220 px wide), popped on/off. After the final line, a ring of 8 black pixel squares rotates (spinner) on grey and resolves to a white ATOMS wordmark on black (it dissolves through a dot-grid of white points at ~99 s).
Why it works: corrupted-then-corrected typing reads like a machine booting, with a stark B/W palette.
Build: a scramble routine (chars change every 2 frames from a glyph pool, then lock by index); set with timeline callbacks keyed to progress so scrubbing is deterministic (seeded RNG). Caret = inline-block black square. Loader = 8 squares on a circle, opacity-stagger.

## 22. Contribution-heatmap compare: green to red grid (Origami)
Film: claude-for-sales-origami [~37 s]
Frames: white ground with soft pink radial blobs at top-left and bottom-right. Two stacked white cards (radius 14 px, hairline shadow). Card 1 caption with a green bullet: "Your coding looks like this" over a wide grid of ~24 x 6 tiny rounded squares in 4 shades of green (light to dark), right edge fades to smaller dots. Card 2: "With Origami, your calendar now does too", the same grid in 4 shades of red/salmon. The cells light in left to right order by a wave, ~0.6 s total per card.
Why it works: a side-by-side of "what you know" vs "what you get" reuses a familiar visual; the colour change carries the message.
Build: 2 x 144 small rect divs; GSAP `stagger:{grid:[24,6], from:"start", axis:"x", each:0.004}` from `scale:0` to 1, with random colour index from a seeded array. Colour ramps as CSS vars.

## 23. Chat bubbles feed coloured dots into calendar cells (Origami)
Film: claude-for-sales-origami [~32.8 s, also 42 s]
Frames: headline "Replies roll in. Meetings get booked." at top. Left column: 4 white pill bubbles with coloured avatar initials (SC, ML, PP, NK) stacking in with 0.25 s stagger ("Interested, let's talk! check"). Right: a calendar card (August 2026) whose cells sprout tiny coloured squares (pink, teal, purple, red) as each reply lands. At 42 s: a large pink "100x" at left with "your pipeline" under it; a phone with a 9:41 lock screen with a stack of notification cards (LinkedIn, Gmail, Calendar, Stripe) scrolling up.
Why it works: the bubble-to-calendar mapping is literal; no chart labels needed.
Build: bubble items slide from x:-20 with fade; for each bubble emit a dot that flies (GSAP `motionPath` or lerp) to a target cell on the calendar and scales from 0.4 to 1. Notification stack = 7 cards in a clipped container, `y` shifts by card height.

## 24. Generative cell-automata / particle-life bits as a background material (Fluoddity)
Film: fluoddity [0-18 s]
Frames: black ground. A dense white-lavender twisting ball (~360 px) with long thin thread tendrils with purple tips, lines twisting like DNA (0.7-2.7 s); [4.9] a honeycomb cell lattice in green/purple dots; [7] radial pulsing "urchin" filaments of white and gold around a cyan core; [9] a neon blob with green petal rim and violet core; [11.5] five yellow-green starfish shapes with glowing blue halo; [13.7] four different shader objects in a 2x2 (green fingerprint, pink stick cross, teal snake, orange foam); [16-18] a whole-frame field of many small colonies in varied colours with threads between them.
Why it works: it is the only "organic" motion in the set; to reelcut it suggests a generative backdrop with slow tumbling that is not a blur blob.
Build: 2D canvas or SVG reaction-diffusion is heavy; cheap analogue: 300 small circles with seeded positions advected along a curl-noise field precomputed per frame (timeline progress in, positions out); tint per group with `mix-blend-mode: screen`, plus `filter: blur(0.6px) contrast(1.4)` for glow.

## 25. Red-stroke redaction bars across the eyes of cut-out people (Hacker Residency)
Film: hacker-residency [0-4 s]
Frames: textured plaster-grey paper ground. A cut-out photo of five men at a boardroom table (b/w, hard white cut edge), each with a red-and-teal ragged brush scribble over the eyes (like a censored photo, 2-3 layered strokes with offset), a huge black italic serif "I" at the left edge and heavy sans "killed the need" that changes colour to dark maroon on the last word; later [8.6] a giant italic serif "Today" sweeps in from the right edge across a gold cow cut-out.
Why it works: hand-made strokes on a cut-out photograph is a cheap, loud anti-corporate look.
Build: photo as PNG cut-out on a paper texture; scribbles = 2 SVG paths with `stroke-linecap:round`, width 14 px, dashoffset tween 0.25 s each, using red #ff3b4d and teal #1fb5a8 with `mix-blend-mode:multiply`; big serif word via `x:120vw` to 0, `expo.out`.

---
## Best for reelcut (ranked)
1. #1 Dot-lattice field (Memoir): one data-driven SVG that takes many layouts. Not covered at all.
2. #18 Ribbed-glass 3D stage + whip blur (Perplexity): high-end depth from plain CSS 3D.
3. #11 Dot burst into bubble confetti (Parallel): two-keyframe idea, big payoff.
4. #10 Stair-step echo wordmark on tractor-feed paper (Parallel).
5. #8 Orthogonal circuit traces with horizontal-smear exits (Flowscope).
6. #17 Text-effect wall (pixel-point): good for any "we do many things" beat.
7. #7 A/B voice-off with radial bar ring (Sonic).
8. #3 Retro educational-film parody with double-exposure dissolves (Mojo).
Also strong and cheap: #21 scramble-typed headline, #22 heatmap compare, #16 pixel-OS retro window, #13 macro tool tip.
