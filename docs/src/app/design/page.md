---
title: "Farm.js design"
description: "The Farm.js visual system and the Farming Labs design-engineering rules: tokens, type, layout, components, motion, SVG figures, and how to verify a design pass."
---

# Farm.js design

The visual system behind farmjs.dev and the design-engineering rules Farming Labs uses to build it. Read it before you design a Farm.js page, write a component for the docs site, or draw a figure. Agents can fetch the raw file at [farmjs.dev/design.md](https://farmjs.dev/design.md).

Values come from the site source in [`docs/`](https://github.com/farming-labs/farm.js/tree/main/docs). When this file and the code disagree, the code wins. The rules in the second half are condensed from the [Farming Labs design-engineering skills](https://github.com/farming-labs/design-eng-skills).

## Principles

- **Structure first.** 1px hairlines, rails, grids, and separators carry the layout. Cards are for repeated items or framed tools, never nested.
- **Proof over decoration.** Show the install command, the code, the terminal, real benchmark numbers, or a figure that explains a mechanism. No orbs, bokeh, or one-note gradients.
- **Black, white, and greys.** The site is dark-only, with no brand accent colour. Contrast comes from opacity, and colour appears only for status.
- **Mono as utility.** Geist Mono carries commands, routes, labels, indexes, and tags. Geist Sans carries reading text.
- **Motion with a job.** Feedback, state, continuity, or explanation. Every loop pauses off screen and has a still pose for reduced motion.
- **Agent-ready.** Copyable commands, a markdown mirror of every page, `llms.txt`, and real states (loading, empty, error) are part of the design, not extras.

## Color

The site is dark-only: the docs theme toggle is off with `default: "dark"` (`docs/docs.config.ts`), and there is no light palette.

### Site tokens

From `docs/src/app/globals.css`:

| Token              | Value                      | Use                      |
| ------------------ | -------------------------- | ------------------------ |
| `--farm-bg`        | `#000`                     | Page background          |
| `--farm-line`      | `rgb(255 255 255 / 0.12)`  | Hairlines and dividers   |
| `--farm-line-soft` | `rgb(255 255 255 / 0.055)` | Quiet separators         |
| `--farm-rule`      | `rgb(255 255 255 / 0.09)`  | Full-bleed section rules |

### Code tokens

From `docs/src/app/docs-overrides.css`. The homepage and the blog use the same palette for highlighted code.

| Token                     | Value                     | Use                      |
| ------------------------- | ------------------------- | ------------------------ |
| `--farm-code-bg`          | `#070707`                 | Code panel background    |
| `--farm-code-line`        | `rgb(255 255 255 / 0.14)` | Code panel border        |
| `--farm-code-line-strong` | `rgb(255 255 255 / 0.32)` | Hover and active border  |
| `--farm-code-text`        | `#a1a1a1`                 | Plain code, identifiers  |
| `--farm-code-dim`         | `#6b6b6b`                 | Keywords and punctuation |
| `--farm-code-bright`      | `#d4d4d4`                 | Names, classes           |
| `--farm-code-string`      | `#e8e8e8`                 | Strings (brightest)      |
| `--farm-code-legend`      | `#8f8f8f`                 | File name legend         |

### Text and neutrals

| Role           | Value                                              |
| -------------- | -------------------------------------------------- |
| Primary text   | `#ededed`                                          |
| Reading copy   | `#b7b7b7` (blog), `rgb(255 255 255 / 0.72)` (docs) |
| Muted text     | `#929292`                                          |
| Marketing body | `white` at 48%                                     |
| Hairlines      | `white` at 7% to 18%                               |

Opacity is the colour system: Tailwind's opacity scale is extended in `docs/tailwind.config.js` (8, 12, 14, 18, 22, 24 and up to 94) so borders and text step in small increments.

### Status colours

The only chromatic colours, used for agent check results (`docs/src/components/agents/check.css`):

| State       | Value     |
| ----------- | --------- |
| Pass        | `#8ce0b5` |
| Warn        | `#e9c46a` |
| Fail, error | `#ff8f87` |

Selection is white on black on the homepage and `#ededed` on `#000` on the agents page and the blog.

## Typography

Three faces, all from the `geist` package, loaded with `localFont` in `docs/src/app/layout.tsx`:

| Face               | Variable             | Weights    | Use                                                       |
| ------------------ | -------------------- | ---------- | --------------------------------------------------------- |
| Geist Sans         | `--font-geist-sans`  | 100 to 900 | Reading text, headings                                    |
| Geist Mono         | `--font-geist-mono`  | 100 to 900 | Code, commands, labels, nav, buttons                      |
| Geist Pixel Square | `--font-geist-pixel` | 500        | Feature headings, figure titles, the final call to action |

Headings run light and tight: weights 380 to 450 with negative tracking. Body text runs at weight 300 with generous leading.

| Element        | Size                       | Weight     | Leading     | Tracking |
| -------------- | -------------------------- | ---------- | ----------- | -------- |
| Hero h1        | `clamp(40px, 5vw, 64px)`   | 400 to 450 | 1.07        | -0.055em |
| Section h2     | 30px to 36px               | 400        | 1.06        | -0.035em |
| Docs h1        | `clamp(28px, 2.6vw, 34px)` | 380        | 1.12        | -0.04em  |
| Docs h2        | 22px                       | 400        |             | -0.03em  |
| Docs body      | 15px                       | 300        | 1.75        |          |
| Long-form body | 16px                       | 300        | 1.85        |          |
| Code           | 13px (docs), 12px (blog)   |            | 1.75 to 1.8 |          |

### Labels

Labels are uppercase Geist Mono with modest tracking:

- Eyebrows: 10px, an index number at 26% white, a `/` at 18%, then the label (`01 / Guide`).
- Docs labels (table headers, sidebar sections, breadcrumbs): 11px, `0.06em` to `0.08em`.
- Footer labels: 9px to 10px, `0.04em`.

## Layout and shape

- **Page frame.** `.farm-page-grid` caps the page at 1320px. From 768px up it is `40px minmax(0, 1240px) 40px`, and the two 40px rails are hatched: a 1px line every 7px at `rgb(255 255 255 / 0.07)` on a 135° angle.
- **Full-bleed rules.** Section boundaries are 1px `--farm-rule` lines that run the full viewport width while the content stays inside the frame.
- **Sections.** A 14rem label column with a right border, then the content. Feature grids are two columns from `lg`, cells at least 500px tall with 24px to 40px padding, divided by 12% hairlines.
- **Header.** 44px tall, sticky, `bg-black/94` with a backdrop blur. Nav items are bordered cells; "Docs" is the one solid white cell.
- **Docs content width.** 900px.

### Radius

| Surface                                                      | Radius |
| ------------------------------------------------------------ | ------ |
| Marketing chrome, buttons, nav                               | 0      |
| Docs panels, code blocks, tables, search, blog figure panels | 3px    |
| Agents figure panels                                         | 6px    |
| Small chips                                                  | 2px    |

### Elevation

Almost none. Shadows appear only on floating surfaces: mock windows inside feature cells, the docs menu (`0 12px 32px rgb(0 0 0 / 0.6)`), and the search dialog (`0 24px 64px rgb(0 0 0 / 0.65)`). Highlighted code lines and notes get a bright left edge, `box-shadow: inset 2px 0 0 #ededed`, instead of a fill.

## Components

- **Buttons.** Square, 1px border, uppercase mono. Default `h-11 px-5` at 11px, compact `h-9 px-4` at 10px. Primary is white with black text (hover 88% white). Secondary is black with an 18% border (hover: 42% border, 6% fill). Pressed: `translate-y-px`. A leading glyph (`>_`, `#`, `{}`) at 55% opacity is allowed; external links end with `↗`.
- **Code blocks.** `#070707`, 3px radius, 1px border. The file name sits on the top border as a legend, and the copy button is a chip in the top-right corner. Copying never changes the block's width.
- **Tables.** Framed like code panels. Header cells are 11px uppercase mono on `white / 0.035`, with 7% rules between rows and columns.
- **Install command.** A tab row for each package manager, then the command with a copy cell. It belongs in the first viewport of a product page.
- **Terminals.** A title bar with three dots (22%, 14%, 10% white), 10px to 11px mono, typed commands.
- **Indexes and tags.** Sections are numbered (`00`, `01`, `01.1`). Figures and versions use bracket tags: `[ Fig 1 ]`, `[ v0.1.0 ]`, `[ Close ]`.
- **Corner ticks.** Small L-shaped ticks (7px to 9px, 28% white) mark the corners of framed media and the hero.
- **Focus.** A solid 2px white ring with a 2px to 5px offset. Iso figures use a 1px 40% ring.

## Motion

There is no animation library. Motion is CSS keyframes plus small `requestAnimationFrame` loops.

- **Easing.** `cubic-bezier(0.22, 1, 0.36, 1)` for entrances and UI; a cubic ease-in-out for figure timelines.
- **Hover.** 150ms, from 120ms to 200ms at most.
- **Entrances.** Code panels 260ms; figure dialogs 240ms; route draw-ins 420ms to 520ms with `stroke-dashoffset`.
- **Ambient loops.** Terminal typing (9.6s, `steps()`), the logo marquee (4s per logo, paused on hover and focus), the benchmark title rotation (12s), the agents mesh (12s). All low contrast, none shift layout.
- **Off screen.** Every loop is gated by an `IntersectionObserver` and pauses in hidden tabs.
- **Reduced motion.** Every stylesheet with motion has a `prefers-reduced-motion: reduce` block. Figures render one finished, still pose; the hero wire shows its connected state. Do not just slow things down.

## SVG figures

Figures are plain SVG drawn from a small kit in `docs/src/components/iso/` (`scene.tsx`, `scene.css`): no figure library, no canvas, no video.

- **Projection.** World units of 30 (`UNIT`). The isometric camera is yaw 45° and pitch `asin(√(1/3))`. The homepage benchmark figures use a flatter pitch of 30° at scale 1.25.
- **Strokes.** One weight per figure: `stroke-width: 1` with `vector-effect: non-scaling-stroke` and round joins, at 20% white. Detail lines 30%, ticks 14%, dashes `2 3`.
- **Faces.** Top `#121212`, left `#0e0e0e`, right `#0a0a0a`. Hairline figures fill faces with `#000` and use 30% strokes and 14% creases.
- **One bright edge.** The part that matters right now (`[data-on]`, `[data-hot]`) rises to 55% to 60% white. Everything else stays at hairline contrast.
- **Words beside the drawing.** Names printed in Geist Mono only where they sit on the object. Callouts are a dot, a wire with rounded elbows, and a label that fades in once the wire lands.
- **Interaction.** Each figure loops on its own clock. Pointing at a part takes over the loop and releasing resumes it in place; arrow keys step through parts; Enter opens a close-up dialog. A live readout sits under the drawing.
- **Hydration.** Coordinates are snapped to two decimals so the server and the browser draw identical paths.

## Brand

- **Mark.** Three-tone stacked bars: `#0a0a0a`, `#666666`, `#a3a3a3` on light, and `#f5f5f4`, `#a3a3a3`, `#595959` on dark ([`farming-labs-mark.svg`](https://github.com/farming-labs/farm.js/blob/main/.github/assets/farming-labs-mark.svg)).
- **Lockup.** The mark with a monospace `FARM` wordmark and `.JS` at 52% opacity ([`farmjs-lockup.svg`](https://github.com/farming-labs/farm.js/blob/main/.github/assets/farmjs-lockup.svg)).
- **Avatar and favicon.** The dark mark centred on a 512px `#0A0A0A` square with 64px corners ([`farmjs-avatar.svg`](https://github.com/farming-labs/farm.js/blob/main/.github/assets/farmjs-avatar.svg)).
- **Name.** Write "Farm.js" in prose. "FARM.JS" appears only inside uppercase mono labels and the wordmark.

## Icons

- [Lucide](https://lucide.dev) for interface actions and objects, at 12px to 16px with `strokeWidth` 1.5 to 1.8. Match size and stroke within a row.
- [Simple Icons](https://simpleicons.org) for brand logos, rendered white.
- Icon-only buttons need an `aria-label` and a tooltip.

## Voice

- Labels are uppercase mono: nav, buttons, eyebrows, footer, captions.
- Headings are sentence case and often short fragments with a period: "Build once. Deploy together." "One framework. The whole product."
- Commands and paths stay lowercase: `farm dev`, `pnpm dev`.
- Concrete over grand. Name the API, the command, the measured number. No "seamless" or "powerful".

## Design engineering

How Farming Labs designs and ships interfaces, condensed from the [design-engineer skill](https://github.com/farming-labs/design-eng-skills/tree/main/design-engineer).

### Workflow

1. **Read the surface first.** Open the route and its local primitives before touching styles. Reuse the repo's components, tokens, and icons.
2. **Set the direction from the product's job.** Docs and OSS sites need product signal in the first viewport, copyable install commands, and crisp navigation. Dashboards need density, keyboard access, and quiet hierarchy.
3. **Design every state.** Loading, empty, error, denied, success, hover, focus-visible, pressed, disabled, selected, long text, and mobile.
4. **Keep layout stable.** Explicit dimensions, grid tracks, and aspect ratios. No text overlap and no layout shift when content changes.
5. **Verify in a browser.** Run the repo's checks, then look at every edited route at desktop and phone widths for overlap, clipping, contrast, console errors, and stalled states.

### Primitive rules

- **Buttons** keep a stable height and never wrap. Loading buttons keep their width and show a compact loader with a label ("Saving").
- **Links** are visibly links: underline, dotted underline, or clear contrast. Leaving the site gets an arrow.
- **Cards** carry a title, status, and primary action in the header, and a visible hover and focus state.
- **Code and terminals** have a header, a copy action, and horizontal overflow. A copied state never changes width.
- **Loaders** are small, quiet, and labelled. They never replace real progress, error text, or a retry.

### Motion timing

| Interaction            | Duration                                |
| ---------------------- | --------------------------------------- |
| Hover, focus           | 120ms to 180ms                          |
| Press, tap             | 80ms to 140ms                           |
| Tooltip, popover, menu | 140ms to 220ms                          |
| Drawer, dialog         | 180ms to 280ms                          |
| Page or section        | 240ms to 450ms                          |
| Ambient loop           | 2s to 12s, low opacity, no layout shift |
| Spinner                | 0.8s to 1.8s per loop                   |

Repeated UI stays under 300ms. Keyboard and expert actions are instant. Exits are faster than entrances.

### Motion review fixes

| Instead of                       | Do                                                                   | Why                                               |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `transition: all`                | Transition exact properties (`transform`, `opacity`, `border-color`) | No accidental layout work                         |
| Entering from `scale(0)`         | Start near final size, `scale(0.95)` with opacity                    | Things settle in, they do not appear from nowhere |
| `ease-in` on UI                  | `ease-out` for feedback, `ease-in-out` between two visible states    | Immediate motion feels responsive                 |
| Popovers scaling from the centre | Scale from the trigger's origin                                      | Anchored surfaces come from their control         |
| Hover motion on touch            | Gate with `@media (hover: hover) and (pointer: fine)`                | No accidental hover on phones                     |
| Keyframes for fast-changing UI   | Transitions or springs that can be interrupted                       | Retargets smoothly when the user acts quickly     |

Reduced motion means fewer and gentler movements, not removing opacity, colour, and focus cues.

## SVG motion

How Farming Labs draws animated figures, condensed from the [svg-figures skill](https://github.com/farming-labs/design-eng-skills/tree/main/svg-figures). The work is mostly restraint: fewer lines, rounded corners, one bright edge, words on a wire beside the drawing.

### Pick one grammar per page

- **Iso faces.** Isometric objects with dark filled faces (top lightest), thin strokes, real names printed small on the parts, and a live readout below. For scenes with many objects. Example: the [agents page](/agents) figures.
- **Hairline.** Outlines only: one projection, one stroke weight, faces filled with the page background so solids hide what is behind them, one dim crease per solid. For small figures beside headline copy. Example: the homepage benchmark figures.
- **Glyph.** Tiny line icons in a fixed viewBox (for example 32 by 24) with one accent stroke, animated by CSS keyframes on hover or focus. For nav menus and lists.

### Rules

- Write one sentence for what the figure says before drawing it. If you cannot, it is decoration.
- One projection and one stroke weight per figure, `vector-effect: non-scaling-stroke`, round caps and joins.
- Round every corner: solids are rounded rectangles and discs.
- Faces fill with the background colour, and occlusion comes from paint order (far things first), never masks.
- One bright edge at a time. No glow, bokeh, gradients, or squash-and-stretch wobble.
- A hint in one corner (what to do, uppercase mono) and a readout in the other (what is happening, tabular numbers, fixed height).
- Show real data when the figure is about data. Never invent numbers.
- Never restyle one figure differently from its siblings.

### Motion

- **Springs** for anything the pointer or the story moves: stiffness 170, damping 22, step capped at 1/30s so a background tab cannot explode the simulation.
- **Ease the clock** that drives a sweep, `t * t * (3 - 2 * t)`, so it starts and stops softly.
- **Finish a motion** before the next one starts. Never cut a wire or a sweep halfway.
- **Pointing holds or slows** the figure and resumes where it was. It never restarts or jumps. On touch, keep what was tapped.
- **Share a clock.** A figure beside rotating copy runs on that copy's animation clock (`getAnimations()[0].currentTime`) so the two cannot drift.
- **Draw the rest pose first.** It is what the server renders, what reduced motion shows, and what most people see. Start motion from an effect after hydration.
- **Run only on screen.** An `IntersectionObserver` gates the frame loop, which stops once everything settles.

### Verify

1. Freeze the clock and screenshot fixed moments: before, mid-motion, finished, reset.
2. When changing the shared kit, capture the other figures under reduced motion before and after, and compare the files byte for byte.
3. Move a real pointer over each part; tap on a touch device.
4. Check reduced motion, phone width, console errors, hydration warnings, and pausing off screen.
5. Show screenshots or a short recording before proposing the change.

## Use the skills

Install the Farming Labs design-engineering skills into your coding agent:

```bash
npx skills add farming-labs/design-eng-skills --skill design-engineer
npx skills add farming-labs/design-eng-skills --skill svg-figures
```

The full references cover the component sources, design tools, interaction grammar, and the projection and callout code: [github.com/farming-labs/design-eng-skills](https://github.com/farming-labs/design-eng-skills).
