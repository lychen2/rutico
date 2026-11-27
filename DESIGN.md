# T3 Code Design System (`DESIGN.md`)

A high-craft, ergonomic interface specification for T3 Code, grounded in the **Rutico** visual identity derived from `seedream-5-5-1(1).png` (`apps/web/public/rutico-hero-desktop.webp` and `apps/mobile/assets/rutico-hero-mobile.webp`) alongside Fitts's Law, Hick's Law, and Gaze–Input vertical alignment principles.

---

## 1. Visual Philosophy & Spatial Hierarchy

- **Focal Discipline**: The coding workbench separates concerns spatially across a three-zone layout: a calm left navigation rail, a centered Gaze–Input conversation/composer axis (`--chat-content-max-width: 46rem`), and an optional on-demand inspection panel/sheet on the right.
- **Atmosphere Without Interference**: In the default **Rutico** theme, directional canvas scrims (`rutico-backdrop-scrim-workspace` and `rutico-backdrop-scrim-hero` in `apps/web/src/index.css`) preserve crisp reading contrast along the left navigation rail and center chat column while allowing the right-bottom illustration (`object-[78%_76%]`) to remain legible.
- **Compositor Budget**: Structural chrome and sidebar containers (`[data-slot="sidebar-container"]`) avoid decorative `backdrop-filter: blur(...)` rules so scrolling timelines and virtualized lists sustain smooth 60fps+ frame pacing (enforced by `motionBudget.browser.test.ts`).

---

## 2. Seedream-Anchored OKLCH Color System

Defined in `packages/shared/src/themePalettes.ts` (`RUTICO_THEME`, unstored client default with `system` appearance mode) and mirrored for instant first paint in `apps/web/index.html` and desktop window chrome (`apps/desktop/src/window/DesktopWindow.ts`):

| Semantic Role                   | Light OKLCH (`#faf7fd` base)                      | Dark OKLCH (`#121019` primary)                    | Seedream Anchor                                  |
| :------------------------------ | :------------------------------------------------ | :------------------------------------------------ | :----------------------------------------------- |
| `canvas` / `surface`            | `oklch(0.980 0.008 308)`                          | `oklch(0.180 0.018 298)`                          | Lavender mist sky / obsidian-plum collar ground  |
| `rail` (`sidebar`)              | `oklch(0.964 0.018 312)`                          | `oklch(0.160 0.016 296)`                          | Soft left-edge wisteria sky / recessed rail      |
| `codeBackground`                | `oklch(0.962 0.012 308)`                          | `oklch(0.156 0.015 296)`                          | Recessed dark `#0d0b12` code well                |
| `text`                          | `oklch(0.220 0.035 304)`                          | `oklch(0.932 0.010 308)`                          | Deep plum ink / anti-halation pearl (`15.39:1`)  |
| `mutedText`                     | `oklch(0.455 0.038 306)`                          | `oklch(0.735 0.020 304)`                          | Muted amethyst metadata (`7.98:1` dark contrast) |
| `accent`                        | `oklch(0.505 0.165 344)`                          | `oklch(0.785 0.108 348)`                          | Sakura-rose cardigan primary accent (`9.08:1`)   |
| `update`                        | `oklch(0.470 0.165 288)`                          | `oklch(0.755 0.108 292)`                          | Wisteria-lavender hair accent                    |
| `error` / `errorForeground`     | `oklch(0.610 0.215 16)` / `oklch(0.455 0.185 16)` | `oklch(0.680 0.185 18)` / `oklch(0.775 0.150 18)` | High-clarity coral-crimson alerts                |
| `warning` / `warningForeground` | `oklch(0.755 0.165 65)` / `oklch(0.485 0.145 48)` | `oklch(0.805 0.135 76)` / `oklch(0.845 0.130 80)` | Golden lower-iris amber warning state            |
| `border` / `line`               | `oklch(0.896 0.022 312)`                          | `oklch(0.290 0.022 302)`                          | Soft lavender / obsidian hairline divider        |

- **Dark-Mode-First Ergonomics**: Dark Mode uses a 5-tier obsidian-plum tonal depth (`#0d0b12` code well -> `#0e0c13` sidebar rail -> `#121019` canvas -> `#1b1722` raised card -> overlay) with low surface chroma (`C=0.014–0.026`), anti-halation `L=0.932` pearl prose, and balanced nocturne artwork grading (`opacity-52`/`62` + `brightness-92`/`95`, `90% -> 76% -> 34% -> 12%` right-directional dark scrim) so the character remains clearly legible without washing out code blocks.
- **Color Contrast Rule**: Every interactive text, icon, badge, and status surface pair meets or exceeds WCAG 2.1 AA (`>= 4.5:1` text contrast; `>= 3:1` UI indicator contrast), automatically verified by `themePalette.test.ts` and `themeBoot.test.ts`.
- **De-boxed Borders**: Hierarchy favors soft tonal steps (`canvas` -> `surfaceRaised` -> `sidebar`) and generous spacing over high-opacity `1px` concentric boxes.

---

## 3. Typography & Strict 4px Spatial Grid

- **Font Stacks** (`apps/web/src/appearanceFonts.ts`, `apps/web/src/index.css`):
  - **UI Sans**: `"Geist Variable", "Geist", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
  - **Monospace**: `"Geist Mono Variable", "Geist Mono", "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`
  - Live telemetry, token counts, and timestamps use `tabular-nums` (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter during streaming updates.
- **Spatial Rhythm**:
  - Strictly derived from a `4px` base unit (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`). Avoid odd ad-hoc heights or off-grid gaps (e.g. normalize `30px`/`26px`/`2px` clusters onto `32px`/`24px`/`4px` multiples).
  - Independent groups use >= `1.5x` vertical breathing separation compared to sibling items inside the same group.
  - Reading lane: `--chat-content-max-width: 46rem` (`736px`) with `--workspace-gutter: 0.75rem` (`12px`, `1.25rem` / `20px` at `sm+`), keeping line lengths comfortable (~65–85 characters) across ultrawide displays.

---

## 4. Ergonomic Layout & Gaze–Input Alignment

1. **Vertical Axis Alignment**: `ChatHeader` aligns its breadcrumb lane within the same `max-w-(--chat-content-max-width)` horizontal track as the timeline messages and bottom `ChatComposer` / `BranchToolbar`, keeping scanning and typing along a single vertical corridor.
2. **Consolidated Single-Row Bottom Chrome**: Below the composer card, workspace/worktree/branch pickers, compact session telemetry (`ComposerThreadContext` in `compact` mode), and permissions consolidate onto a single `4px`-grid horizontal strip instead of stacking separate status pills above workspace pickers.
3. **Zero Control Duplication**: Secondary drawers/cards (`ThreadDetailsCard`, `ThreadDetailsPanel`) suppress controls already visible in the composer's bottom strip (`composerShowsContext`), avoid nested pill frames around tabs, and separate sections with whitespace rather than redundant `border-t` rules.

---

## 5. Intent-Driven Disclosure (Hick's Law & Fitts's Law)

- **Quiet Resting State**:
  - `SidebarOverview` renders `null` when attention, today's tasks, and active runs are all empty, and omits the `"Running now"` header unless running/incomplete items exist.
  - Sidebar category/new-action buttons (`Sidebar.tsx`) stay subdued (`opacity-0` at rest on desktop pointer devices) and reveal on container hover or keyboard focus-within, while remaining directly accessible on touch screens (`pointer: coarse`).
- **Hover Intent & Safe Triangles**:
  - `ThreadHoverCard` uses an intentional `700ms` hover dwell (`openDelayMs={700}`) via `SharedTooltipTrigger` so rapid pointer scanning across sidebar rows does not flash preview popovers.
  - Nested menus (`apps/web/src/components/ui/menu.tsx`) preserve `220ms` open / `360ms` close delays and polygonal safe-triangle geometry.
- **Response Footer Restraint**:
  - In `MessagesTimeline` / `TimelineAssistantRows`, the latest landed assistant turn keeps its action bar visible (`opacity-100`) as the active terminal landmark, while older historical turns reveal their action rows on group hover or `focus-within` without removing click targets from the DOM.
