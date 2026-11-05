# WFM Command Center — Power BI custom visual

Workforce-management visual inspired by enterprise WFM tools (Verint-style intraday/daily/weekly views). **One visual, three view modes.**

| Section | What it shows |
|---|---|
| Header | Title, optional logo image, **Intraday / Daily / Weekly** switcher, prev/next/latest navigation |
| KPI strip | Volume vs forecast, forecast accuracy (1−WAPE), AHT vs forecast, service level, staffing gap, adherence — all vs configurable targets |
| Volume | Actual bars vs forecast line |
| AHT & service level | Forecast/actual AHT (left axis) + SL% (right axis) with target line |
| Staffing | Scheduled FTE bars coloured under / on-target / over vs required FTE marker |
| Heatmap | Day × hour staffing variance (7 days intraday, 14 days daily/weekly) |
| Interval grid | Verint-style table with conditional colouring |
| Agent roster | Avatars (https or `data:image/…` URL), adherence bars, initials fallback |

Click a bar or grid row to cross-filter other visuals. Format pane: view, week start, intraday resolution (hourly/native), font, light/dark theme, title, logo URL, colours, SL/accuracy/staffing targets, and section toggles. Inter is bundled (OFL); Segoe UI, DIN and Calibri are selectable.

## Data model (field wells)

One row per **interval × queue** (15/30/60-min). Only *Interval* is required.

| Well | Type | Notes |
|---|---|---|
| Interval (date/time) | Grouping | interval start timestamp |
| Queue / Skill | Grouping | optional |
| Agent / Team, Avatar image URL | Grouping | optional; enable the roster. Give agent rows **adherence only** (leave volume/FTE blank) so queue-grain measures aren't double counted |
| Forecast / Actual volume | Measure | summed |
| Forecast / Actual AHT (sec) | Measure | volume-weighted |
| Required / Scheduled FTE | Measure | summed across queues, **averaged** across intervals in a bucket |
| Service level, Adherence | Measure | 0–1 or 0–100 both accepted; volume-weighted / averaged |

Intervals with no actual (future) are excluded from variance/accuracy. Max 30,000 rows per refresh (Power BI row limit for this mapping).

## Build / test

```bash
npm install
npm run typecheck && npx eslint src      # must be clean for certification
npx pbiviz package                       # -> dist/*.pbiviz
node scripts/generate-sample-data.mjs    # -> samples/wfm_intervals.csv (28 days, 2 queues, 8 agents with avatars)
NODE_PATH=$(npm root -g) node test/harness.cjs .tmp/shots   # renders the built bundle in Chromium with a mock host
```

Import `dist/*.pbiviz` in Power BI Desktop (… → Import a visual from a file), load the sample CSV, and drop the columns into the wells.

## Before submitting to AppSource

- [ ] Replace placeholder `supportUrl`, `gitHubUrl`, author in `pbiviz.json`; add a real privacy/support page.
- [ ] Don't use the "Verint" name or logo in the visual name, description, icon or screenshots (trademark). "Inspired by" wording is safer outside the listing.
- [ ] Replace `assets/icon.png` with a final 20×20 icon; prepare 1–5 screenshots and a sample `.pbix` using `samples/wfm_intervals.csv`.
- [ ] Publish via Partner Center (Commercial marketplace → Power BI visual offer). Certification (optional, recommended) requires: no external network calls (`privileges` is empty ✔), no `innerHTML` (✔ lint-clean), rendering events (✔), and the open items below.
- [ ] Open items flagged by `pbiviz package`: High-contrast mode, keyboard navigation, context menu, localization, highlight/multi-select. Not implemented yet — add before certification.
