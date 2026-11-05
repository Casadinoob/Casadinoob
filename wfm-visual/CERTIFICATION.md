# Getting WFM Command Center certified

Microsoft "Power BI certified" is a review Microsoft performs **after** the visual is on AppSource. This file tracks what the codebase already satisfies and what only you can do. Requirements below come from Microsoft's published certification guidance as of writing; **re-read the current page before submitting** (https://learn.microsoft.com/power-bi/developer/visuals/power-bi-custom-visuals-certified) — it changes. Nothing here guarantees approval.

## Two editions from one codebase

| | **Certified** | **Write-back** |
|---|---|---|
| Package | `releases/wfmCommandCenter7F3A91C2D4E54B6A.<ver>.pbiviz` | `releases/wfmCommandCenterWB3A91C2D4E54B6A.<ver>.pbiviz` |
| `privileges` | none | `WebAccess` (Azure/Power Platform hosts only) |
| Network code in `src/` | **none** (`src/net.ts` is a stub) | real `fetch` (from `editions/writeback/net.ts`) |
| Settings/drivers storage | inside the report (`persistProperties`) | same, plus optional endpoint |
| Use for | AppSource certification | direct distribution / separate non-certified listing |

Build: `npm run package:certified`, `npm run package:writeback`. The edition script swaps files, builds, then restores your working tree.

**For the certification submission, give Microsoft a repo/branch that does not contain `editions/`** (or at least point them at the certified build) so the reviewed source has no network code at all.

## Automated checks (`npm run verify`)

| Requirement | Status |
|---|---|
| ESLint with `eslint-plugin-powerbi-visuals` clean | ✅ |
| No banned APIs in `src/` (`eval`, `innerHTML=`, `fetch`, `XMLHttpRequest`, storage, `window.open`, `Math.random`, string timers, …) — `scripts/scan.mjs` | ✅ |
| `npm audit` has no vulnerabilities (production and dev) | ✅ 0 (uses `overrides` for `uuid`, `minimatch`, `powerbi-visuals-api`) |
| Latest `powerbi-visuals-api` | ✅ 5.11.1 |
| No external calls / no privileges (certified edition) | ✅ bundle contains no `fetch(` |
| Rendering events (`renderingStarted/Finished/Failed`) | ✅ |
| Build is reproducible from source with `npm install && npx pbiviz package`; lockfile committed | ✅ `package-lock.json` |
| Third-party licences included | ✅ `THIRD_PARTY_NOTICES.md` (Inter, OFL-1.1) |

## Recommended Power BI features

| Feature | Status |
|---|---|
| Allow interactions (`hostCapabilities.allowInteractions`) | ✅ selection and context menu disabled when off |
| Color palette (`host.colorPalette`) | ✅ series colours come from the host palette unless you override in Settings |
| High-contrast mode | ✅ uses host foreground/background/selected/hyperlink colours, outlines instead of colour-only cues |
| Keyboard navigation (`supportsKeyboardFocus`) | ✅ Tab / Enter / Space / arrows / Esc; focus retained across redraws; ARIA labels |
| Context menu | ✅ right-click on bars/rows and background |
| Selection across visuals / multi-select (`supportsMultiVisualSelection`) | ✅ Ctrl/⌘/Shift-click |
| Localisation | 🟡 en-US, fr-FR, de-DE, es-ES for field wells, format pane, tabs, KPI and chart titles. Long-form text (data-health messages, driver/settings forms, table headers) is English only |
| Highlight data (`supportsHighlight`) | ❌ not available with a `table` data mapping |

## Things only you can do

1. **Own repo.** Move `wfm-visual/` to its own repository (so `package.json` is at the root) — certification reviewers build from the repo root. I can't create repositories from this environment.
2. **Real metadata** in `pbiviz.json`: `supportUrl`, `gitHubUrl`, author name/email (currently placeholders).
3. **Licence** for the source (not chosen for you).
4. **AppSource listing** via Partner Center: Power BI visual offer, 20×20 icon (`assets/icon.png` is a placeholder), screenshots, privacy policy URL, support URL, description, **sample `.pbix`** using `samples/wfm_intervals.csv`.
5. Don't use the Verint name/logo in the name, description, icon or screenshots.
6. After AppSource approval, **request certification** in Partner Center and answer the reviewers' source-code questions. Plan for revision rounds; Microsoft re-reviews on updates.
7. Test in real Power BI Desktop *and* the Service, in high-contrast and with keyboard only. This was tested only in headless Chromium with a mock host.

## Known review risks

* `setHtml()` in `src/util.ts` builds DOM from escaped strings with `DOMParser` + `importNode` instead of `innerHTML`. It passes the lint rule, but a reviewer may ask about it; every dynamic value goes through `esc()`.
* Persisting settings/drivers uses `host.persistProperties`; they are only saved from edit mode.
* The Inter font is embedded as a base64 `@font-face` in the stylesheet (OFL permits this; notice included).
