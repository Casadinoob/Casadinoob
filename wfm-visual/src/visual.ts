import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualSettings } from "./settings";
import {
    Bucket, Row, ViewMode, ParseStats, parseTable, collapse, bucketize, hourKey, nativeKey, dayKey, weekKey, kpis, byDim, coverage, levelMix, heatmap,
    dayStart, addDays, dayLabel, dowName, intervalMinutes, Kpis, HeatCell, DimStat
} from "./data";
import {
    Store, Driver, parseStoreChecked, parseStore, applyDrivers, driverApplies, slTargetFor, defaultSettings, sendWriteBack, loadWriteBack, DRIVER_COLORS
} from "./store";
import { skillsHtml, teamsHtml, driversHtml, settingsHtml, skillColor, issuesHtml } from "./pages";
import { Issue, dataIssues, configIssues, pageNeeds, worst, ROLE_LABEL } from "./validate";
import { esc, safeImg, fmtN, fmt1, pct, spct, initials, clamp, fmtDate, setHtml, PALETTE, toLocalInput, fromLocalInput } from "./util";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ITooltipService = powerbi.extensibility.ITooltipService;

const FONT_STACKS: Record<string, string> = {
    inter: `"WFM Inter", "Segoe UI", system-ui, sans-serif`,
    segoe: `"Segoe UI", "Segoe UI Web (West European)", system-ui, sans-serif`,
    din: `"DIN", "Segoe UI", system-ui, sans-serif`,
    calibri: `"Calibri", "Segoe UI", system-ui, sans-serif`
};
type Page = "planning" | "skills" | "teams" | "drivers" | "settings";
const PAGES: [Page, string][] = [["planning", "Planning"], ["skills", "Skills & Levels"], ["teams", "Teams & Agents"], ["drivers", "Drivers"], ["settings", "Settings"]];
const uid = () => "d" + Date.now().toString(36) + Array.from(window.crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16)).join("");

interface Series { vals: (number | null)[]; color: string; axis: "l" | "r"; dash?: string; label: string; }

export class Visual implements IVisual {
    private host: IVisualHost;
    private root: HTMLElement;
    private selection: ISelectionManager;
    private tooltip: ITooltipService;
    private fs = new FormattingSettingsService();
    private settings = new VisualSettings();

    private table: powerbi.DataViewTable | undefined;
    private rows: Row[] = [];
    private bound: Record<string, boolean> = {};
    private minDay = new Date(); private maxDay = new Date();
    private page: Page = "planning";
    private view: ViewMode | null = null;
    private anchor: Date | null = null;
    private selectedKey: string | null = null;
    private buckets: Bucket[] = [];
    private baseFv = new Map<string, number>();
    private bDrivers = new Map<string, Driver[]>();
    private viewport = { width: 0, height: 0 };
    private viewMode = 0;
    private lastDefaultView = "";
    private dataKey = "";
    private fSkill: string | null = null;
    private teamFilter: string | null = null;
    private sort: { k: string; dir: 1 | -1 } = { k: "sl", dir: -1 };
    private store: Store = parseStore();
    private sig = "";
    private hasStore = false;
    private editing: Driver | null = null;
    private status = "";
    private issues: Issue[] = [];
    private stats: ParseStats | null = null;
    private storeProblems: string[] = [];
    private fetches = 0;
    private truncated = false;
    private showIssues = false;
    private fatal = "";

    constructor(options?: VisualConstructorOptions) {
        if (!options) { throw new Error("VisualConstructorOptions required"); }
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        this.tooltip = this.host.tooltipService;
        this.root = document.createElement("div");
        this.root.className = "wfm";
        options.element.appendChild(this.root);

        this.root.addEventListener("click", e => this.onClick(e));
        this.root.addEventListener("change", e => this.onChange(e));
        this.root.addEventListener("mousemove", e => this.onMove(e));
        this.root.addEventListener("mouseleave", () => this.tooltip.hide({ immediately: true, isTouchEvent: false }));
        this.root.addEventListener("error", e => {
            const t = e.target as HTMLElement;
            if (t && t.tagName === "IMG") {
                if (t.classList.contains("logo")) { t.remove(); return; }   // broken logo URL: just hide it
                const p = t.parentElement; if (p) { p.textContent = t.getAttribute("data-init") || "?"; }
            }
        }, true);
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        try {
            const dv = options.dataViews && options.dataViews[0];
            this.settings = this.fs.populateFormattingSettingsModel(VisualSettings, dv);
            this.viewport = { width: options.viewport.width, height: options.viewport.height };
            this.viewMode = options.viewMode ?? 0;
            const st = dv?.metadata?.objects?.store as { settingsJson?: string; driversJson?: string } | undefined;
            const sig = `${st?.settingsJson ?? ""}|${st?.driversJson ?? ""}`;
            this.hasStore = !!st;
            if (sig !== this.sig) { this.sig = sig; const pc = parseStoreChecked(st?.settingsJson, st?.driversJson); this.store = pc.store; this.storeProblems = pc.problems; }

            this.table = dv && dv.table;
            const parsed = parseTable(this.table);
            const key = `${parsed.rows.length}|${parsed.rows[0]?.t.getTime()}|${parsed.rows[parsed.rows.length - 1]?.t.getTime()}`;
            this.rows = parsed.rows; this.bound = parsed.bound; this.stats = parsed.stats;
            // Power BI loads data in 30k-row segments: keep fetching (bounded) so totals are complete
            if (options.operationKind === 0) { this.fetches = 0; }
            const more = !!dv?.metadata?.segment;
            const fetching = more && this.fetches < 25;
            if (fetching) { this.fetches++; this.host.fetchMoreData(true); }
            this.truncated = more && !fetching;
            if (this.rows.length) {
                let a = Infinity, b = -Infinity;
                for (const r of this.rows) { const t = r.t.getTime(); if (t < a) { a = t; } if (t > b) { b = t; } }
                this.minDay = dayStart(new Date(a)); this.maxDay = dayStart(new Date(b));
            }
            const dv0 = this.settings.general.defaultView.value.value as ViewMode;
            if (this.view === null || this.lastDefaultView !== dv0) { this.view = dv0; this.lastDefaultView = dv0; }
            if (parsed.stats.dateOnly && this.view === "intraday") { this.view = "daily"; }   // fallback: no time-of-day in the data
            this.issues = dataIssues({ stats: parsed.stats, bound: parsed.bound, truncated: this.truncated, rowCap: parsed.rows.length });
            if (key !== this.dataKey || !this.anchor) { this.dataKey = key; this.anchor = this.anchor ?? this.maxDay; }
            this.anchor = new Date(clamp(this.anchor.getTime(), this.minDay.getTime(), this.maxDay.getTime()));
            if (!this.selection.getSelectionIds().length) { this.selectedKey = null; }
            this.render();
            this.host.eventService.renderingFinished(options);
        } catch (e) {
            this.host.eventService.renderingFailed(options, String(e));
            throw e;
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.fs.buildFormattingModel(this.settings);
    }

    // ---------------------------------------------------------------- persistence
    private persist(): void {
        const settingsJson = JSON.stringify(this.store.settings), driversJson = JSON.stringify(this.store.drivers);
        this.sig = `${settingsJson}|${driversJson}`;
        this.hasStore = true;
        this.host.persistProperties({ merge: [{ objectName: "store", selector: undefined as any, properties: { settingsJson, driversJson } }] });
    }

    private async writeBack(kind: "settings" | "drivers" | "forecast"): Promise<void> {
        const wb = this.store.settings.writeBack;
        if (!wb.enabled || !wb.url) { this.status = "Write-back is not enabled. Tick “Enable write-back” and enter an endpoint URL."; this.render(); return; }
        const payload = kind === "settings" ? this.store.settings : kind === "drivers" ? this.store.drivers : this.forecastPayload();
        this.status = "Sending…"; this.render();
        const r = await sendWriteBack(wb.url, kind, payload);
        this.status = r.message; this.render();
    }

    private forecastPayload() {
        const adj = applyDrivers(this.rows, this.store.drivers);
        const out: unknown[] = [];
        for (let i = 0; i < this.rows.length && out.length < 20000; i++) {
            const a = this.rows[i], b = adj[i];
            if (a !== b && a.fv !== null) {
                out.push({ interval: toLocalInput(a.t), skill: a.skill, baselineForecast: a.fv, adjustedForecast: +(b.fv ?? 0).toFixed(2), baselineRequiredFte: a.rf, adjustedRequiredFte: b.rf === null ? null : +b.rf.toFixed(2) });
            }
        }
        return out;
    }

    private commit(): void {
        this.persist();
        if (this.store.settings.writeBack.enabled && this.store.settings.writeBack.autoSend) { void this.writeBack("drivers"); }
    }

    // ---------------------------------------------------------------- render
    private colors() {
        const c = this.settings.colors;
        return { actual: c.actual.value.value, forecast: c.forecast.value.value, under: c.under.value.value, ok: c.ok.value.value, over: c.over.value.value };
    }

    private windowFor(view: ViewMode, ws: number): { from: Date; to: Date } {
        const a = this.anchor!;
        if (view === "intraday") { return { from: a, to: addDays(a, 1) }; }
        if (view === "daily") { return { from: addDays(a, -30), to: addDays(a, 1) }; }
        const w0 = addDays(a, -((a.getDay() - ws + 7) % 7));
        return { from: addDays(w0, -12 * 7), to: addDays(w0, 7) };
    }

    private distinct(f: (r: Row) => string): string[] { return Array.from(new Set(this.rows.map(f).filter(Boolean))).sort(); }

    private render(): void {
        try { this.renderCore(); this.fatal = ""; } catch (e) {
            this.fatal = String(e);
            setHtml(this.root, `<div class="empty"><strong>Something went wrong while drawing this visual.</strong><br><br><code>${esc(this.fatal)}</code><br><br><button class="btn pri" data-act="recover">Reset view</button><br><br><span class="hint">If this keeps happening, check the Data health notes in Settings → or re-bind the fields.</span></div>`);
        }
    }

    private bannerHtml(is: Issue[]): string {
        if (!this.settings.sections.showWarnings.value || !is.length) { return ""; }
        const w = worst(is)!;
        const open = this.showIssues || w === "error";
        const cnt = (["error", "warn", "info"] as const).map(l => ({ l, n: is.filter(i => i.level === l).length })).filter(x => x.n).map(x => `${x.n} ${x.l === "warn" ? "warning" : x.l}${x.n > 1 ? "s" : ""}`).join(" · ");
        return `<div class="hb ${w}"><button data-act="issues">${w === "error" ? "⛔" : w === "warn" ? "⚠️" : "ℹ️"} Data health: ${cnt} <span class="chev">${open ? "▴" : "▾"}</span></button>${open ? issuesHtml(is) : ""}</div>`;
    }

    private renderCore(): void {
        const g = this.settings.general;
        const col = this.colors();
        const dark = g.theme.value.value === "dark";
        this.root.className = "wfm" + (dark ? " dark" : "");
        const st = this.root.style;
        st.setProperty("--actual", col.actual); st.setProperty("--forecast", col.forecast);
        st.setProperty("--under", col.under); st.setProperty("--ok", col.ok); st.setProperty("--over", col.over);
        st.setProperty("--font", FONT_STACKS[g.fontFamily.value.value] || FONT_STACKS.inter);

        const view = this.view as ViewMode;
        const ws = Number(g.weekStart.value.value);
        const logo = safeImg(g.logoUrl.value);
        const win = this.rows.length ? this.windowFor(view, ws) : { from: new Date(), to: new Date() };
        const showView = this.page === "planning" || this.page === "skills" || this.page === "teams";
        const range = view === "intraday" ? dayLabel(this.anchor ?? new Date()) + " " + (this.anchor ?? new Date()).getFullYear() : `${fmtDate(win.from)} – ${fmtDate(addDays(win.to, -1))}`;

        let h = `<div class="hd">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ""}<div class="ttl">${esc(g.title.value)}</div>`;
        h += `<nav class="pages">${PAGES.map(([p, l]) => `<button data-act="page" data-p="${p}" class="${p === this.page ? "on" : ""}">${l}</button>`).join("")}</nav><div class="grow"></div>`;
        if (showView && this.rows.length) {
            h += `<div class="seg">${(["intraday", "daily", "weekly"] as ViewMode[]).map(v => (v === "intraday" && this.stats?.dateOnly) ? `<button class="dis" title="Needs a time of day in the Interval field">Intraday</button>` : `<button data-act="view" data-v="${v}" class="${v === view ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>`;
            h += `<div class="nav"><button data-act="prev" title="Previous">‹</button><span class="rng">${esc(range)}</span><button data-act="next" title="Next">›</button><button data-act="latest" title="Jump to latest" style="width:auto;padding:0 8px">Latest</button></div>`;
        }
        h += `</div><div class="body"><div id="hb"></div><div id="pg" class="stack"></div></div>`;
        setHtml(this.root, h);
        const body = this.root.querySelector<HTMLElement>("#pg")!;
        const hbEl = this.root.querySelector<HTMLElement>("#hb")!;
        const dataPage = this.page === "planning" || this.page === "skills" || this.page === "teams";
        const cfg = (this.page === "drivers" || this.page === "settings")
            ? configIssues(this.store.settings, this.store.drivers, this.rows, this.bound, this.stats?.minT ?? 0, this.stats?.maxT ?? 0, this.storeProblems, this.viewMode) : [];
        const allIssues = [...this.issues, ...cfg];
        setHtml(hbEl, this.bannerHtml(allIssues));
        const msg = (title: string, text: string, btns = "") => setHtml(body, `<div class="card"><h3>${esc(title)}</h3><p>${text}</p><div class="btns">${btns}</div></div>`);
        if (this.viewport.width < 300 || this.viewport.height < 180) { msg("Visual is too small", "Make this visual larger to see the dashboard."); return; }
        if (dataPage) {
            if (!this.rows.length) {
                const need = ["interval", "forecastVolume", "actualVolume", "requiredFte", "scheduledFte"].map(r => `<li>${esc(ROLE_LABEL[r])}</li>`).join("");
                msg("Nothing to show yet", `Fill the field wells to get started. At minimum bind:<ul>${need}</ul>Skill, Team, Level, Agent and Avatar fields unlock the other pages.`);
                return;
            }
            const miss = pageNeeds(this.page, this.bound);
            if (miss.length) { msg("This page needs more fields", `Add <b>${esc(miss.join(" and "))}</b> to the field wells to use this page. Until then, everything on the Planning page still works.`, `<button class="btn pri" data-act="page" data-p="planning">Back to Planning</button>`); return; }
            if (!this.rows.some(r => r.t >= win.from && r.t < win.to)) {
                msg("No data in this period", `There are no intervals in <b>${esc(range)}</b>. Your data covers ${esc(fmtDate(this.minDay))} – ${esc(fmtDate(this.maxDay))}.`, `<button class="btn pri" data-act="latest">Jump to latest data</button><button class="btn" data-act="view" data-v="${this.stats?.dateOnly ? "daily" : "weekly"}">Zoom out</button>`);
                return;
            }
        }
        if (this.page === "planning") { this.renderPlanning(body, win, ws); }
        else if (this.page === "skills") { this.renderSkills(body, win, range); }
        else if (this.page === "teams") { this.renderTeams(body, win, ws, range); }
        else if (this.page === "drivers") { this.renderDrivers(body); }
        else { this.renderSettings(body); }
    }

    private inWin(rows: Row[], win: { from: Date; to: Date }) { return rows.filter(r => r.t >= win.from && r.t < win.to); }
    private adjusted(rows: Row[]) { return this.store.settings.applyDrivers ? applyDrivers(rows, this.store.drivers) : rows; }

    private keyFn(view: ViewMode, ws: number) {
        return view === "intraday" ? (this.settings.general.intradayResolution.value.value === "native" ? nativeKey : hourKey) : view === "daily" ? dayKey : weekKey(ws);
    }

    // ---------------------------------------------------------------- planning page
    private renderPlanning(body: HTMLElement, win: { from: Date; to: Date }, ws: number): void {
        const S = this.settings.sections, cfg = this.store.settings;
        const view = this.view as ViewMode;
        const rowsBase = this.fSkill ? this.rows.filter(r => r.skill === this.fSkill) : this.rows;
        const rowsAdj = this.adjusted(rowsBase);
        const hasDrv = cfg.applyDrivers && this.store.drivers.length > 0;
        const ivsAdj = collapse(rowsAdj), ivsBase = hasDrv ? collapse(rowsBase) : ivsAdj;
        const keyFn = this.keyFn(view, ws);
        const sel = (ivs: ReturnType<typeof collapse>) => ivs.filter(iv => iv.t >= win.from && iv.t < win.to);
        this.buckets = bucketize(sel(ivsAdj), keyFn);
        this.baseFv.clear();
        if (hasDrv) { bucketize(sel(ivsBase), keyFn).forEach(b => this.baseFv.set(b.key, b.fv)); }
        const mins = intervalMinutes(ivsAdj);
        this.bDrivers = this.driversByBucket(view, mins);
        const K = kpis(this.buckets);
        const tol = cfg.staffingTolerance / 100;
        const slTarget = this.fSkill ? slTargetFor(cfg, "skill", this.fSkill) : cfg.slTarget / 100, accTarget = cfg.accuracyTarget / 100;

        const rangeIvs = new Set<number>(); this.buckets.forEach(b => b.rows.forEach(r => rangeIvs.add(r)));
        const ros: DimStat[] = this.bound.agent && S.showRoster.value ? byDim(rowsAdj.filter(r => rangeIvs.has(r.idx)), "agent").slice(0, 60) : [];
        const wide = this.viewport.width >= 860;
        const sideOn = (S.showHeatmap.value || ros.length > 0);

        let h = "";
        const skills = this.distinct(r => r.skill);
        if (skills.length) {
            h += `<div class="chips"><button class="chip ${this.fSkill ? "" : "on"}" data-act="skillfilter" data-skill="">All skills</button>${skills.map((s, i) => `<button class="chip ${this.fSkill === s ? "on" : ""}" data-act="skillfilter" data-skill="${esc(s)}"><i class="sw" style="background:${skillColor(cfg, s, i)}"></i>${esc(s)}</button>`).join("")}</div>`;
        }
        if (S.showKpis.value) { h += this.kpiHtml(K, slTarget, accTarget, tol); }
        h += `<div class="grid${wide && sideOn ? "" : " single"}"><div class="col">`;
        h += `<div class="card"><h3>Volume · forecast vs actual<span class="lg"><span><i class="sw" style="background:var(--actual)"></i>Actual</span><span><i class="sw" style="background:var(--forecast)"></i>Forecast${hasDrv ? " + drivers" : ""}</span>${hasDrv ? `<span><i class="sw" style="background:var(--muted)"></i>Baseline</span>` : ""}</span></h3><div class="chart" data-chart="vol"></div></div>`;
        h += `<div class="card"><h3>AHT &amp; service level<span class="lg"><span><i class="sw" style="background:var(--actual)"></i>Actual AHT</span><span><i class="sw" style="background:var(--forecast)"></i>Forecast AHT</span><span><i class="sw" style="background:var(--ok)"></i>Service level</span></span></h3><div class="chart" data-chart="aht"></div></div>`;
        h += `<div class="card"><h3>Staffing · scheduled vs required FTE<span class="lg"><span><i class="sw" style="background:var(--under)"></i>Under</span><span><i class="sw" style="background:var(--ok)"></i>On target</span><span><i class="sw" style="background:var(--over)"></i>Over</span><span><i class="sw" style="background:var(--ink)"></i>Required</span></span></h3><div class="chart" data-chart="staff"></div></div>`;
        if (S.showTable.value) { h += `<div class="card"><h3>Interval grid</h3><div class="tbl">${this.tableHtml(tol, slTarget)}</div></div>`; }
        h += `</div>`;
        if (sideOn) {
            h += `<div class="col">`;
            if (S.showHeatmap.value) {
                h += `<div class="card"><h3>Staffing variance heatmap<span class="lg">${view === "intraday" ? "7 days" : "14 days"} · by hour</span></h3><div class="chart" data-chart="heat"></div>
                      <div class="heatleg"><span>Under</span><i style="background:var(--under)"></i><i style="background:var(--ok);opacity:.6"></i><i style="background:var(--over)"></i><span>Over</span></div></div>`;
            }
            if (ros.length) { h += `<div class="card"><h3>Agents &amp; teams<span class="lg">${ros.length}</span></h3><div class="roster">${this.rosterHtml(ros)}</div></div>`; }
            h += `</div>`;
        }
        h += `</div>`;
        setHtml(body, h);

        const ch = clamp(Math.floor(this.viewport.height * 0.2), 150, 240);
        const el = (n: string) => this.root.querySelector<HTMLElement>(`[data-chart="${n}"]`);
        const put = (n: string, fn: (w: number) => string) => { const e = el(n); if (e) { setHtml(e, fn(Math.max(240, e.clientWidth || 320))); } };
        put("vol", w => this.volumeChart(w, ch));
        put("aht", w => this.ahtChart(w, ch, slTarget));
        put("staff", w => this.staffChart(w, ch, tol));
        if (S.showHeatmap.value) {
            const endDay = view === "weekly" ? new Date(Math.min(this.maxDay.getTime(), addDays(win.to, -1).getTime())) : this.anchor!;
            const nd = view === "intraday" ? 7 : 14;
            const days = Array.from({ length: nd }, (_, i) => addDays(endDay, i - nd + 1)).filter(d => d >= this.minDay);
            put("heat", w => this.heatChart(w, heatmap(bucketize(ivsAdj, hourKey), days), days, tol));
        }
    }

    private driversByBucket(view: ViewMode, mins: number): Map<string, Driver[]> {
        const m = new Map<string, Driver[]>();
        if (!this.store.drivers.length) { return m; }
        const span = view === "intraday" ? (this.settings.general.intradayResolution.value.value === "native" ? mins : 60) * 60000 : view === "daily" ? 864e5 : 7 * 864e5;
        for (const b of this.buckets) {
            const a = b.start.getTime(), e = a + span;
            const hit = this.store.drivers.filter(d => new Date(d.start).getTime() < e && new Date(d.end).getTime() > a && (!this.fSkill || driverApplies(d, this.fSkill)));
            if (hit.length) { m.set(b.key, hit); }
        }
        return m;
    }

    // ---------------------------------------------------------------- skills page
    private renderSkills(body: HTMLElement, win: { from: Date; to: Date }, range: string): void {
        const wr = this.inWin(this.adjusted(this.rows), win);
        const skills = byDim(wr, "skill");
        const names = skills.map(s => s.name);
        setHtml(body, skillsHtml({ skills, levels: byDim(wr, "level"), cover: coverage(wr, names), mix: levelMix(wr), settings: this.store.settings, rangeLabel: range }));
    }

    // ---------------------------------------------------------------- teams page
    private renderTeams(body: HTMLElement, win: { from: Date; to: Date }, ws: number, range: string): void {
        const cfg = this.store.settings, view = this.view as ViewMode;
        const wr = this.inWin(this.adjusted(this.rows), win);
        const teams = byDim(wr, "team");
        const keyFn = this.keyFn(view, ws);
        this.buckets = bucketize(collapse(wr), keyFn);
        const tnames = teams.map(t => t.name);
        const series: Series[] = tnames.slice(0, 8).map((t, i) => {
            const bm = new Map(bucketize(collapse(wr.filter(r => r.team === t)), keyFn).map(b => [b.key, b.sl] as [string, number | null]));
            return { vals: this.buckets.map(b => bm.get(b.key) ?? null), color: PALETTE[i % PALETTE.length], axis: "l", label: t };
        });
        const legend = series.map(s => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span>`).join("");
        setHtml(body, teamsHtml({ teams, agents: byDim(wr, "agent"), teamFilter: this.teamFilter, sort: this.sort, settings: cfg, trend: "", trendLegend: legend, rangeLabel: range }));
        const e = this.root.querySelector<HTMLElement>('[data-chart="teamtrend"]');
        if (e) {
            const w = Math.max(240, e.clientWidth || 320), h = clamp(Math.floor(this.viewport.height * 0.22), 150, 240);
            const f = this.frame(w, h, 1, v => pct(v, 0), 44, 10, 8, 22, 0.5);
            const tY = f.y(clamp(cfg.slTarget / 100, 0.5, 1));
            let s = `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}<line x1="${f.l}" x2="${w - f.r}" y1="${tY}" y2="${tY}" stroke="var(--ok)" stroke-dasharray="2 4" opacity=".7"/>`;
            series.forEach(sr => { s += this.polyline(f, sr, 0.5, 1); });
            s += `${f.labels}</svg>`;
            setHtml(e, s);
        }
    }

    // ---------------------------------------------------------------- drivers & settings pages
    private renderDrivers(body: HTMLElement): void {
        const impact = new Map<string, number>();
        for (const d of this.store.drivers) {
            const a = new Date(d.start).getTime(), b = new Date(d.end).getTime();
            let x = 0;
            for (const r of this.rows) { if (r.fv !== null && r.t.getTime() >= a && r.t.getTime() < b && driverApplies(d, r.skill)) { x += r.fv * d.volPct / 100; } }
            impact.set(d.id, x);
        }
        setHtml(body, driversHtml({ drivers: this.store.drivers, editing: this.editing, skills: this.distinct(r => r.skill), settings: this.store.settings, status: this.status, impact }));
    }

    private summaryLines(): string[] {
        const st = this.stats; if (!st) { return []; }
        const iv = collapse(this.rows);
        return [
            `Rows used: ${st.used.toLocaleString()} of ${st.totalRows.toLocaleString()}`,
            st.used ? `Data range: ${fmtDate(this.minDay)} – ${fmtDate(this.maxDay)} · interval ≈ ${intervalMinutes(iv)} min` : "No usable data",
            `Fields bound: ${st.boundColumns.map(r => ROLE_LABEL[r] || r).join(", ") || "none"}`,
            `Skills: ${this.distinct(r => r.skill).length} · Teams: ${this.distinct(r => r.team).length} · Levels: ${this.distinct(r => r.level).length} · Agents: ${this.distinct(r => r.agent).length}`
        ];
    }

    private renderSettings(body: HTMLElement): void {
        setHtml(body, settingsHtml({ settings: this.store.settings, skills: this.distinct(r => r.skill), teams: this.distinct(r => r.team), levels: this.distinct(r => r.level), status: this.status, hasStore: !(this.viewMode === 0 && !this.hasStore), issues: [...this.issues, ...configIssues(this.store.settings, this.store.drivers, this.rows, this.bound, this.stats?.minT ?? 0, this.stats?.maxT ?? 0, this.storeProblems, this.viewMode)], summary: this.summaryLines() }));
    }

    // ---------------------------------------------------------------- html parts (planning)
    private kpiHtml(K: Kpis, slT: number, accT: number, tol: number): string {
        const cls = (good: boolean | null) => (good === null ? "neutral" : good ? "good" : "bad");
        const varPill = (v: number | null, goodWhenLow = false) => v === null ? "" : `<span class="pill ${(goodWhenLow ? v <= 0 : Math.abs(v) <= 0.05) ? "good" : "bad"}">${spct(v)}</span>`;
        const card = (l: string, v: string, s: string, c: string) => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
        const stfOk = K.gapPct === null ? null : K.gapPct >= -tol;
        const adT = this.store.settings.adherenceTarget / 100;
        return `<div class="kpis">`
            + card("Volume", fmtN(K.av), `Forecast ${fmtN(K.fvA)} ${varPill(K.volVarPct)}`, cls(K.volVarPct === null ? null : Math.abs(K.volVarPct) <= 0.05))
            + card("Forecast accuracy", pct(K.accuracy), `Target ${pct(accT, 0)}`, cls(K.accuracy === null ? null : K.accuracy >= accT))
            + card("AHT (sec)", K.aa === null ? "–" : Math.round(K.aa).toString(), `Forecast ${K.fa === null ? "–" : Math.round(K.fa)} ${varPill(K.ahtVarPct, true)}`, cls(K.ahtVarPct === null ? null : K.ahtVarPct <= 0.05))
            + card(`Service level (${this.store.settings.slThresholdSec}s)`, pct(K.sl), `Target ${pct(slT, 0)}`, cls(K.sl === null ? null : K.sl >= slT))
            + card("Staffing (avg FTE)", `${fmt1(K.sf)} <span style="font-size:13px;font-weight:500;color:var(--muted)">/ ${fmt1(K.rf)}</span>`, `Gap ${K.gapFte === null ? "–" : (K.gapFte > 0 ? "+" : "") + K.gapFte.toFixed(1)} FTE ${K.gapPct === null ? "" : `<span class="pill ${stfOk ? "good" : "bad"}">${spct(K.gapPct)}</span>`}`, cls(stfOk))
            + card("Adherence", pct(K.ad), `Target ${pct(adT, 0)}`, cls(K.ad === null ? null : K.ad >= adT))
            + `</div>`;
    }

    private tableHtml(tol: number, slT: number): string {
        const rows = this.buckets.map(b => {
            const vv = b.av !== null && b.fvA > 0 ? (b.av - b.fvA) / b.fvA : null;
            const gap = b.sf !== null && b.rf !== null ? b.sf - b.rf : null;
            const gp = gap !== null && b.rf ? gap / b.rf : null;
            const gc = gp === null ? "" : gp < -tol ? "bad" : gp > tol ? "over" : "good";
            const label = this.view === "intraday" ? b.label : `${b.label} <span style="color:var(--muted);font-weight:400">${esc(b.sub)}</span>`;
            const drv = this.bDrivers.get(b.key);
            const dm = drv ? ` <span class="dtag" style="background:${DRIVER_COLORS[drv[0].type]}" title="${esc(drv.map(d => d.name).join(", "))}">${drv.length > 1 ? drv.length : esc(drv[0].type[0])}</span>` : "";
            return `<tr data-key="${esc(b.key)}" class="${this.selectedKey === b.key ? "sel" : ""}"><td>${label}${dm}</td><td>${fmtN(b.fv)}</td><td>${fmtN(b.av)}</td><td class="${vv === null ? "" : Math.abs(vv) <= 0.05 ? "good" : "bad"}">${spct(vv)}</td>`
                + `<td>${b.fa === null ? "–" : Math.round(b.fa)}</td><td>${b.aa === null ? "–" : Math.round(b.aa)}</td><td>${fmt1(b.rf)}</td><td>${fmt1(b.sf)}</td>`
                + `<td class="${gc}">${gap === null ? "–" : (gap > 0 ? "+" : "") + gap.toFixed(1)}</td><td class="${b.sl === null ? "" : b.sl >= slT ? "good" : "bad"}">${pct(b.sl)}</td></tr>`;
        }).join("");
        return `<table><thead><tr><th>${this.view === "intraday" ? "Time" : this.view === "daily" ? "Day" : "Week"}</th><th>Fcst vol</th><th>Act vol</th><th>Var</th><th>Fcst AHT</th><th>Act AHT</th><th>Req FTE</th><th>Sched FTE</th><th>Gap</th><th>SL</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    private rosterHtml(ros: DimStat[]): string {
        const adT = this.store.settings.adherenceTarget / 100;
        return ros.map(a => {
            const img = safeImg(a.avatar), ad = a.ad;
            const c = ad === null ? "var(--line)" : ad >= adT ? "var(--ok)" : ad >= adT - 0.1 ? "var(--forecast)" : "var(--under)";
            return `<div class="ag" data-tip="${esc(a.name)}|Adherence|${pct(ad)}|Service level|${pct(a.sl)}${a.handled > 0 ? `|Handled|${fmtN(a.handled)}` : ""}">
                <div class="av">${img ? `<img src="${esc(img)}" data-init="${esc(initials(a.name))}" alt="">` : esc(initials(a.name))}</div>
                <div><div class="nm">${esc(a.name)}</div><div class="bar"><i style="width:${ad === null ? 0 : clamp(ad, 0, 1) * 100}%;background:${c}"></i></div></div>
                <div style="text-align:right"><div class="nm">${pct(ad, 0)}</div>${a.sl !== null ? `<div class="sb">SL ${pct(a.sl, 0)}</div>` : ""}</div></div>`;
        }).join("");
    }

    // ---------------------------------------------------------------- svg charts
    private xLabels(l: number, band: number): string {
        const every = Math.max(1, Math.ceil(46 / band));
        let s = "";
        this.buckets.forEach((b, i) => { if (i % every) { return; } s += `<text x="${l + band * i + band / 2}" y="__Y__" text-anchor="middle">${esc(b.label)}</text>`; });
        return s;
    }

    private frame(w: number, h: number, max: number, fmtY: (v: number) => string, l = 44, r = 10, t = 8, b = 22, min = 0) {
        const iw = w - l - r, ih = h - t - b;
        const y = (v: number) => t + ih - ((v - min) / (max - min)) * ih;
        let s = "";
        for (let i = 0; i <= 4; i++) {
            const v = min + ((max - min) * i) / 4;
            s += `<line class="grid-l" x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 6}" y="${y(v) + 3}" text-anchor="end">${fmtY(v)}</text>`;
        }
        const band = iw / Math.max(1, this.buckets.length);
        return { iw, ih, y, band, l, t, b, r, grid: s, labels: this.xLabels(l, band).replace(/__Y__/g, String(h - 6)) };
    }

    private hits(f: { band: number; l: number; t: number; ih: number }, tipFn: (b: Bucket) => string): string {
        return this.buckets.map((b, i) => `<rect class="hit" data-key="${esc(b.key)}" data-tip="${esc(tipFn(b))}" x="${f.l + f.band * i}" y="${f.t}" width="${f.band}" height="${f.ih}"/>`).join("");
    }

    private driverBands(f: { band: number; l: number; t: number; ih: number }): string {
        return this.buckets.map((b, i) => {
            const d = this.bDrivers.get(b.key); if (!d) { return ""; }
            return `<rect x="${f.l + f.band * i}" y="${f.t}" width="${f.band}" height="${f.ih}" fill="${DRIVER_COLORS[d[0].type]}" opacity=".13"/><rect x="${f.l + f.band * i}" y="${f.t}" width="${f.band}" height="3" fill="${DRIVER_COLORS[d[0].type]}"/>`;
        }).join("");
    }

    private drvTip(b: Bucket): string {
        const d = this.bDrivers.get(b.key);
        return d ? `|Drivers|${d.map(x => `${x.name} ${x.volPct > 0 ? "+" : ""}${x.volPct}%`).join("; ")}` : "";
    }

    private dimCls(b: Bucket) { return this.selectedKey && this.selectedKey !== b.key ? "dim" : ""; }
    private tipHead(b: Bucket): string { return this.view === "intraday" ? b.label : `${b.label} ${b.sub}`; }

    private volumeChart(w: number, h: number): string {
        const B = this.buckets;
        const max = Math.max(1, ...B.map(b => Math.max(b.fv, b.av ?? 0, this.baseFv.get(b.key) ?? 0))) * 1.1;
        const f = this.frame(w, h, max, fmtN);
        const bw = Math.min(40, f.band * 0.62);
        const bars = B.map((b, i) => b.av === null ? "" : `<rect class="${this.dimCls(b)}" x="${f.l + f.band * i + (f.band - bw) / 2}" y="${f.y(b.av)}" width="${bw}" height="${Math.max(0, f.y(0) - f.y(b.av))}" rx="2" fill="var(--actual)"/>`).join("");
        const pts = B.map((b, i) => `${f.l + f.band * i + f.band / 2},${f.y(b.fv)}`).join(" ");
        const base = this.baseFv.size ? `<polyline points="${B.map((b, i) => `${f.l + f.band * i + f.band / 2},${f.y(this.baseFv.get(b.key) ?? b.fv)}`).join(" ")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>` : "";
        const dots = B.length <= 40 ? B.map((b, i) => `<circle cx="${f.l + f.band * i + f.band / 2}" cy="${f.y(b.fv)}" r="2.6" fill="var(--panel)" stroke="var(--forecast)" stroke-width="1.6"/>`).join("") : "";
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${this.driverBands(f)}${bars}${base}<polyline points="${pts}" fill="none" stroke="var(--forecast)" stroke-width="2" stroke-linejoin="round"/>${dots}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Forecast|${fmtN(b.fv)}${this.baseFv.size ? `|Baseline|${fmtN(this.baseFv.get(b.key) ?? null)}` : ""}|Actual|${fmtN(b.av)}|Variance|${spct(b.av !== null && b.fvA > 0 ? (b.av - b.fvA) / b.fvA : null)}${this.drvTip(b)}`)}</svg>`;
    }

    private polyline(f: ReturnType<Visual["frame"]>, sr: Series, rmin: number, rmax: number): string {
        const scale = (v: number) => (sr.axis === "l" && rmin === 0 && rmax === 0 ? f.y(v) : f.t + f.ih - ((clamp(v, rmin, rmax) - rmin) / (rmax - rmin)) * f.ih);
        let s = ""; let seg: string[] = [];
        const flush = () => { if (seg.length > 1) { s += `<polyline points="${seg.join(" ")}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""}/>`; } seg = []; };
        sr.vals.forEach((v, i) => { if (v === null) { flush(); } else { seg.push(`${f.l + f.band * i + f.band / 2},${scale(v)}`); } });
        flush();
        return s;
    }

    private ahtChart(w: number, h: number, slT: number): string {
        const B = this.buckets;
        const ah = B.flatMap(b => [b.fa, b.aa]).filter((v): v is number => v !== null);
        const lo = ah.length ? Math.floor((Math.min(...ah) * 0.8) / 10) * 10 : 0, hi = ah.length ? Math.ceil((Math.max(...ah) * 1.08) / 10) * 10 : 1;
        const top = Math.max(hi, lo + 10);
        const f = this.frame(w, h, top, v => Math.round(v).toString(), 44, 40, 8, 22, lo);
        const rmin = 0.5, rmax = 1;
        let rAxis = "";
        for (let i = 0; i <= 4; i++) { rAxis += `<text x="${w - 36}" y="${f.t + f.ih - (i / 4) * f.ih + 3}" text-anchor="start">${Math.round((rmin + (i / 4) * (rmax - rmin)) * 100)}%</text>`; }
        const tY = f.t + f.ih - ((clamp(slT, rmin, rmax) - rmin) / (rmax - rmin)) * f.ih;
        const line = (vals: (number | null)[], color: string, dash: string | undefined, left: boolean) => this.polyline(f, { vals: left ? vals.map(v => (v === null ? null : (v - lo) / (top - lo) * 0.5 + 0.5)) : vals, color, axis: "r", dash, label: "" }, rmin, rmax);
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${rAxis}<line x1="${f.l}" x2="${w - f.r}" y1="${tY}" y2="${tY}" stroke="var(--ok)" stroke-dasharray="2 4" opacity=".7"/>${line(B.map(b => b.fa), "var(--forecast)", "5 4", true)}${line(B.map(b => b.aa), "var(--actual)", undefined, true)}${line(B.map(b => b.sl), "var(--ok)", undefined, false)}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Forecast AHT|${b.fa === null ? "–" : Math.round(b.fa) + "s"}|Actual AHT|${b.aa === null ? "–" : Math.round(b.aa) + "s"}|Service level|${pct(b.sl)}`)}</svg>`;
    }

    private staffChart(w: number, h: number, tol: number): string {
        const B = this.buckets;
        const max = Math.max(1, ...B.map(b => Math.max(b.rf ?? 0, b.sf ?? 0))) * 1.15;
        const f = this.frame(w, h, max, v => v.toFixed(v < 10 ? 1 : 0));
        const bw = Math.min(40, f.band * 0.62);
        const bars = B.map((b, i) => {
            if (b.sf === null) { return ""; }
            const gp = b.rf ? (b.sf - b.rf) / b.rf : 0;
            const c = gp < -tol ? "var(--under)" : gp > tol ? "var(--over)" : "var(--ok)";
            return `<rect class="${this.dimCls(b)}" x="${f.l + f.band * i + (f.band - bw) / 2}" y="${f.y(b.sf)}" width="${bw}" height="${Math.max(0, f.y(0) - f.y(b.sf))}" rx="2" fill="${c}" opacity=".85"/>`;
        }).join("");
        const req = B.map(b => b.rf).map((v, i) => v === null ? "" : `<line x1="${f.l + f.band * i + (f.band - bw) / 2 - 3}" x2="${f.l + f.band * i + (f.band + bw) / 2 + 3}" y1="${f.y(v)}" y2="${f.y(v)}" stroke="var(--ink)" stroke-width="2.4"/>`).join("");
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${this.driverBands(f)}${bars}${req}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Required FTE|${fmt1(b.rf)}|Scheduled FTE|${fmt1(b.sf)}|Gap|${b.rf !== null && b.sf !== null ? (b.sf - b.rf > 0 ? "+" : "") + (b.sf - b.rf).toFixed(1) : "–"}${this.drvTip(b)}`)}</svg>`;
    }

    private heatChart(w: number, cells: HeatCell[], days: Date[], tol: number): string {
        const S = this.store.settings, from = clamp(S.heatFrom, 0, 23), to = clamp(S.heatTo, from, 23), n = to - from + 1;
        const l = 62, t = 14, cw = (w - l - 4) / n, chh = 20, h = t + days.length * chh + 4;
        let s = "";
        for (let hr = from; hr <= to; hr++) { if ((hr - from) % Math.max(1, Math.round(3 / Math.max(0.5, cw / 18))) === 0) { s += `<text x="${l + (hr - from) * cw + cw / 2}" y="9" text-anchor="middle">${String(hr).padStart(2, "0")}</text>`; } }
        days.forEach((d, r) => { s += `<text x="${l - 6}" y="${t + r * chh + 14}" text-anchor="end">${dowName(d)} ${d.getDate()}</text>`; });
        for (const c of cells) {
            if (c.hour < from || c.hour > to) { continue; }
            const r = days.findIndex(d => d.getTime() === c.day.getTime());
            const x = l + (c.hour - from) * cw, y = t + r * chh;
            let fill = "var(--line)", op = 0.35;
            if (c.v !== null) {
                if (c.v < -tol) { fill = "var(--under)"; op = clamp(0.3 + (-c.v - tol) / 0.3, 0.3, 1); }
                else if (c.v > tol) { fill = "var(--over)"; op = clamp(0.3 + (c.v - tol) / 0.4, 0.3, 1); }
                else { fill = "var(--ok)"; op = 0.55; }
            }
            const tip = c.v === null ? "" : `data-tip="${esc(`${dayLabel(c.day)} ${String(c.hour).padStart(2, "0")}:00|Required FTE|${fmt1(c.rf)}|Scheduled FTE|${fmt1(c.sf)}|Variance|${spct(c.v)}`)}"`;
            s += `<rect x="${x + 0.75}" y="${y + 0.75}" width="${Math.max(1, cw - 1.5)}" height="${chh - 1.5}" rx="3" fill="${fill}" opacity="${op}" ${tip}/>`;
        }
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${s}</svg>`;
    }

    // ---------------------------------------------------------------- events
    private onClick(e: MouseEvent): void {
        const t = e.target as HTMLElement;
        const act = t.closest<HTMLElement>("[data-act]");
        if (act) { this.onAct(act); return; }
        const k = t.closest<HTMLElement>("[data-key]");
        if (k) {
            const key = k.getAttribute("data-key")!;
            if (this.selectedKey === key) { this.clearSelection(); this.render(); return; }
            const b = this.buckets.find(x => x.key === key);
            if (!b || !this.table) { return; }
            const ids = b.rows.map(i => this.host.createSelectionIdBuilder().withTable(this.table!, i).createSelectionId());
            this.selectedKey = key;
            this.selection.select(ids);
            this.render();
        }
    }

    private onAct(el: HTMLElement): void {
        const a = el.getAttribute("data-act")!;
        const q = (id: string) => this.root.querySelector<HTMLInputElement>("#" + id)?.value ?? "";
        const step = this.view === "intraday" ? 1 : this.view === "daily" ? 7 : 28;
        switch (a) {
            case "issues": this.showIssues = !this.showIssues; break;
            case "recover": this.page = "planning"; this.fSkill = null; this.teamFilter = null; this.editing = null; this.clearSelection(); this.anchor = this.maxDay; this.view = this.settings.general.defaultView.value.value as ViewMode; break;
            case "page": this.page = el.getAttribute("data-p") as Page; this.status = ""; break;
            case "view": this.view = el.getAttribute("data-v") as ViewMode; this.clearSelection(); break;
            case "prev": this.anchor = addDays(this.anchor!, -step); this.clearSelection(); break;
            case "next": this.anchor = addDays(this.anchor!, step); this.clearSelection(); break;
            case "latest": this.anchor = this.maxDay; this.clearSelection(); break;
            case "skillfilter": this.fSkill = el.getAttribute("data-skill") || null; this.page = "planning"; this.clearSelection(); break;
            case "teamfilter": this.teamFilter = el.getAttribute("data-team") || null; break;
            case "sort": { const k = el.getAttribute("data-k")!; this.sort = this.sort.k === k ? { k, dir: (this.sort.dir * -1) as 1 | -1 } : { k, dir: k === "name" || k === "team" || k === "level" ? 1 : -1 }; break; }
            case "drv-new": {
                const s = this.anchor ?? new Date();
                this.editing = { id: uid(), name: "", type: "Promotion", start: toLocalInput(s), end: toLocalInput(addDays(s, 1)), volPct: 10, ahtPct: 0, skills: [], status: "Planned", note: "" };
                break;
            }
            case "drv-edit": this.editing = { ...this.store.drivers.find(d => d.id === el.getAttribute("data-id"))! }; break;
            case "drv-cancel": this.editing = null; break;
            case "drv-dup": if (this.editing) { const c = { ...this.editing, id: uid(), name: this.editing.name + " (copy)" }; this.store.drivers.push(c); this.editing = c; this.commit(); } break;
            case "drv-del": if (this.editing) { this.store.drivers = this.store.drivers.filter(d => d.id !== this.editing!.id); this.editing = null; this.commit(); } break;
            case "drv-save": {
                if (!this.editing) { break; }
                const s = fromLocalInput(q("f-start")), en = fromLocalInput(q("f-end"));
                if (!q("f-name").trim()) { this.status = "⚠ Enter a name for the driver."; break; }
                if (!s || !en) { this.status = "⚠ Start and end must be valid dates."; break; }
                if (en <= s) { this.status = "⚠ The end must be after the start."; break; }
                const vp = Number(q("f-vol") || 0), ap = Number(q("f-aht") || 0);
                if (!Number.isFinite(vp) || vp < -100 || vp > 1000) { this.status = "⚠ Volume impact must be between -100% and 1000%."; break; }
                if (!Number.isFinite(ap) || ap < -90 || ap > 500) { this.status = "⚠ AHT impact must be between -90% and 500%."; break; }
                const d: Driver = {
                    id: this.editing.id, name: q("f-name").trim(), type: q("f-type") as Driver["type"], start: toLocalInput(s), end: toLocalInput(en),
                    volPct: Number(q("f-vol")) || 0, ahtPct: Number(q("f-aht")) || 0, status: q("f-status") as Driver["status"], note: q("f-note"),
                    skills: Array.from(this.root.querySelectorAll<HTMLInputElement>(".f-skill:checked")).map(x => x.value)
                };
                const i = this.store.drivers.findIndex(x => x.id === d.id);
                if (i >= 0) { this.store.drivers[i] = d; } else { this.store.drivers.push(d); }
                this.editing = d; this.status = "Saved"; this.commit();
                break;
            }
            case "wb-send": void this.writeBack(el.getAttribute("data-kind") as "settings" | "drivers" | "forecast"); return;
            case "wb-load": void this.loadFromEndpoint(); return;
            case "reset": this.store.settings = defaultSettings(); this.persist(); break;
        }
        this.render();
    }

    private async loadFromEndpoint(): Promise<void> {
        const wb = this.store.settings.writeBack;
        if (!wb.enabled || !wb.url) { this.status = "Write-back is not enabled."; this.render(); return; }
        this.status = "Loading…"; this.render();
        const r = await loadWriteBack(wb.url);
        if (r.ok && r.data) {
            const next = parseStore(r.data.settings ? JSON.stringify({ ...r.data.settings, writeBack: wb }) : JSON.stringify(this.store.settings), r.data.drivers ? JSON.stringify(r.data.drivers) : JSON.stringify(this.store.drivers));
            this.store = next; this.persist();
        }
        this.status = r.message; this.render();
    }

    private onChange(e: Event): void {
        const el = e.target as HTMLInputElement;
        const kind = el.getAttribute("data-s"); if (!kind) { return; }
        const f = el.getAttribute("data-f")!, n = el.getAttribute("data-n") || "";
        const S = this.store.settings as any;
        const val: any = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
        if (el.type === "number" && val !== null) {
            const hour = f === "heatFrom" || f === "heatTo";
            const hi = hour ? 23 : f === "slThresholdSec" ? 3600 : 100;
            if (!Number.isFinite(val) || val < 0 || val > hi) { this.status = `⚠ ${f} must be between 0 and ${hi}; the value was not saved.`; this.render(); return; }
            if (f === "heatFrom" && val > S.heatTo) { this.status = "⚠ Heatmap “from” hour must not be after “to”."; this.render(); return; }
            if (f === "heatTo" && val < S.heatFrom) { this.status = "⚠ Heatmap “to” hour must not be before “from”."; this.render(); return; }
        }
        this.status = "";
        if (kind === "root") { S[f] = (f === "agentSlTarget" || val !== null) ? val : S[f]; }
        else if (kind === "wb") { S.writeBack[f] = val; }
        else { const bucket = kind === "skill" ? S.skills : kind === "team" ? S.teams : S.levels; bucket[n] = { ...(bucket[n] || {}), [f]: val === "" ? null : val }; }
        this.persist();
        this.render();
    }

    private clearSelection(): void { this.selectedKey = null; this.selection.clear(); }

    private onMove(e: MouseEvent): void {
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        if (!t) { this.tooltip.hide({ immediately: false, isTouchEvent: false }); return; }
        const parts = (t.getAttribute("data-tip") || "").split("|");
        const dataItems: powerbi.extensibility.VisualTooltipDataItem[] = [];
        for (let i = 1; i + 1 < parts.length; i += 2) { dataItems.push({ displayName: parts[i], value: parts[i + 1] }); }
        this.tooltip.show({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: [{ displayName: parts[0], value: "", header: parts[0] }, ...dataItems], identities: [] });
    }
}
