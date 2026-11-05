import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualSettings } from "./settings";
import {
    Bucket, Row, ViewMode, parseTable, collapse, bucketize, hourKey, nativeKey, dayKey, weekKey, kpis, roster, heatmap,
    dayStart, addDays, dayLabel, dowName, intervalMinutes, Kpis, HeatCell
} from "./data";

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const safeImg = (u: string) => (/^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i.test((u || "").trim()) ? u.trim() : "");
const fmtN = (n: number | null) => (n === null ? "–" : Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + "k" : Math.round(n).toLocaleString());
const fmt1 = (n: number | null) => (n === null ? "–" : n.toFixed(1));
const pct = (n: number | null, d = 1) => (n === null ? "–" : (n * 100).toFixed(d) + "%");
const spct = (n: number | null) => (n === null ? "–" : (n > 0 ? "+" : "") + (n * 100).toFixed(1) + "%");
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Certified visuals may not assign innerHTML. Parse with DOMParser (scripts never execute; all dynamic text is esc()-escaped) and swap nodes in.
function setHtml(el: HTMLElement, html: string): void {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const nodes = Array.from(doc.body.childNodes).map(n => document.importNode(n, true));
    el.replaceChildren(...nodes);
}

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
    private ivsAll: ReturnType<typeof collapse> = [];
    private hourlyAll: Bucket[] = [];
    private minDay = new Date(); private maxDay = new Date();
    private view: ViewMode | null = null;
    private anchor: Date | null = null;
    private selectedKey: string | null = null;
    private buckets: Bucket[] = [];
    private viewport = { width: 0, height: 0 };
    private lastDefaultView = "";
    private dataKey = "";

    constructor(options?: VisualConstructorOptions) {
        if (!options) { throw new Error("VisualConstructorOptions required"); }
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        this.tooltip = this.host.tooltipService;
        this.root = document.createElement("div");
        this.root.className = "wfm";
        options.element.appendChild(this.root);

        this.root.addEventListener("click", e => this.onClick(e));
        this.root.addEventListener("mousemove", e => this.onMove(e));
        this.root.addEventListener("mouseleave", () => this.tooltip.hide({ immediately: true, isTouchEvent: false }));
        // image load failures don't bubble -> capture phase
        this.root.addEventListener("error", e => {
            const t = e.target as HTMLElement;
            if (t && t.tagName === "IMG") {
                const p = t.parentElement;
                if (p) { p.textContent = t.getAttribute("data-init") || "?"; }
            }
        }, true);
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        try {
            const dv = options.dataViews && options.dataViews[0];
            this.settings = this.fs.populateFormattingSettingsModel(VisualSettings, dv);
            this.viewport = { width: options.viewport.width, height: options.viewport.height };
            this.table = dv && dv.table;
            const parsed = parseTable(this.table);
            const key = `${parsed.rows.length}|${parsed.rows[0]?.t.getTime()}|${parsed.rows[parsed.rows.length - 1]?.t.getTime()}`;
            this.rows = parsed.rows; this.bound = parsed.bound;
            this.ivsAll = collapse(this.rows);
            this.hourlyAll = bucketize(this.ivsAll, hourKey);
            if (this.ivsAll.length) {
                this.minDay = dayStart(this.ivsAll[0].t);
                this.maxDay = dayStart(this.ivsAll[this.ivsAll.length - 1].t);
            }
            const dv0 = this.settings.general.defaultView.value.value as ViewMode;
            if (this.view === null || this.lastDefaultView !== dv0) { this.view = dv0; this.lastDefaultView = dv0; }
            if (key !== this.dataKey) { this.dataKey = key; if (!this.anchor) { this.anchor = this.maxDay; } }
            if (!this.anchor) { this.anchor = this.maxDay; }
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

    // ---------------------------------------------------------------- render
    private colors() {
        const c = this.settings.colors;
        return { actual: c.actual.value.value, forecast: c.forecast.value.value, under: c.under.value.value, ok: c.ok.value.value, over: c.over.value.value };
    }

    private windowFor(view: ViewMode, ws: number): { from: Date; to: Date; days: number } {
        const a = this.anchor!;
        if (view === "intraday") { return { from: a, to: addDays(a, 1), days: 1 }; }
        if (view === "daily") { return { from: addDays(a, -30), to: addDays(a, 1), days: 31 }; }
        const w0 = addDays(a, -((a.getDay() - ws + 7) % 7));
        return { from: addDays(w0, -12 * 7), to: addDays(w0, 7), days: 91 };
    }

    private render(): void {
        const g = this.settings.general, S = this.settings.sections, T = this.settings.targets;
        const col = this.colors();
        const dark = g.theme.value.value === "dark";
        this.root.className = "wfm" + (dark ? " dark" : "");
        const st = this.root.style;
        st.setProperty("--actual", col.actual); st.setProperty("--forecast", col.forecast);
        st.setProperty("--under", col.under); st.setProperty("--ok", col.ok); st.setProperty("--over", col.over);
        st.setProperty("--font", FONT_STACKS[g.fontFamily.value.value] || FONT_STACKS.inter);

        if (!this.ivsAll.length) {
            setHtml(this.root, `<div class="empty"><strong>${esc(g.title.value)}</strong><br><br>Add an <b>Interval (date/time)</b> field plus Forecast / Actual volume, AHT, FTE and Service level measures.</div>`);
            return;
        }

        const view = this.view as ViewMode;
        const ws = Number(g.weekStart.value.value);
        const win = this.windowFor(view, ws);
        const inWin = this.ivsAll.filter(iv => iv.t >= win.from && iv.t < win.to);
        const resolution = g.intradayResolution.value.value;
        const keyFn = view === "intraday" ? (resolution === "native" ? nativeKey : hourKey) : view === "daily" ? dayKey : weekKey(ws);
        this.buckets = bucketize(inWin, keyFn);
        const K = kpis(this.buckets);
        const tol = T.staffingTolerance.value / 100;
        const slTarget = T.serviceLevelTarget.value / 100, accTarget = T.accuracyTarget.value / 100;

        const logo = safeImg(g.logoUrl.value);
        const range = view === "intraday" ? dayLabel(this.anchor!) + " " + this.anchor!.getFullYear()
            : `${fmtDate(win.from)} – ${fmtDate(addDays(win.to, -1))}`;

        const rangeIvs = new Set<number>(); this.buckets.forEach(b => b.rows.forEach(r => rangeIvs.add(r)));
        const ros = this.bound.agent && S.showRoster.value ? roster(this.rows, rangeIvs) : [];
        const wide = this.viewport.width >= 860;
        const sideOn = (S.showHeatmap.value || ros.length > 0);

        let h = `<div class="hd">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ""}<div class="ttl">${esc(g.title.value)}</div><div class="grow"></div>`;
        h += `<div class="seg">${(["intraday", "daily", "weekly"] as ViewMode[]).map(v => `<button data-act="view" data-v="${v}" class="${v === view ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>`;
        h += `<div class="nav"><button data-act="prev" title="Previous">‹</button><span class="rng">${esc(range)}</span><button data-act="next" title="Next">›</button><button data-act="latest" title="Jump to latest" style="width:auto;padding:0 8px">Latest</button></div></div>`;

        h += `<div class="body">`;
        if (S.showKpis.value) { h += this.kpiHtml(K, slTarget, accTarget, tol); }
        h += `<div class="grid${wide && sideOn ? "" : " single"}"><div class="col">`;
        h += `<div class="card"><h3>Volume · forecast vs actual<span class="lg"><span><i class="sw" style="background:var(--actual)"></i>Actual</span><span><i class="sw" style="background:var(--forecast)"></i>Forecast</span></span></h3><div class="chart" data-chart="vol"></div></div>`;
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
        h += `</div></div>`;
        setHtml(this.root, h);

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
            put("heat", w => this.heatChart(w, heatmap(this.hourlyAll, days), days, tol));
        }
    }

    // ---------------------------------------------------------------- html parts
    private kpiHtml(K: Kpis, slT: number, accT: number, tol: number): string {
        const cls = (good: boolean | null) => (good === null ? "neutral" : good ? "good" : "bad");
        const varPill = (v: number | null, goodWhenLow = false) => v === null ? "" : `<span class="pill ${(goodWhenLow ? v <= 0 : Math.abs(v) <= 0.05) ? "good" : "bad"}">${spct(v)}</span>`;
        const card = (l: string, v: string, s: string, c: string) => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
        const stfOk = K.gapPct === null ? null : K.gapPct >= -tol;
        return `<div class="kpis">`
            + card("Volume", fmtN(K.av), `Forecast ${fmtN(K.fvA)} ${varPill(K.volVarPct)}`, cls(K.volVarPct === null ? null : Math.abs(K.volVarPct) <= 0.05))
            + card("Forecast accuracy", pct(K.accuracy), `Target ${pct(accT, 0)}`, cls(K.accuracy === null ? null : K.accuracy >= accT))
            + card("AHT (sec)", K.aa === null ? "–" : Math.round(K.aa).toString(), `Forecast ${K.fa === null ? "–" : Math.round(K.fa)} ${varPill(K.ahtVarPct, true)}`, cls(K.ahtVarPct === null ? null : K.ahtVarPct <= 0.05))
            + card("Service level", pct(K.sl), `Target ${pct(slT, 0)}`, cls(K.sl === null ? null : K.sl >= slT))
            + card("Staffing (avg FTE)", `${fmt1(K.sf)} <span style="font-size:13px;font-weight:500;color:var(--muted)">/ ${fmt1(K.rf)}</span>`, `Gap ${K.gapFte === null ? "–" : (K.gapFte > 0 ? "+" : "") + K.gapFte.toFixed(1)} FTE ${K.gapPct === null ? "" : `<span class="pill ${stfOk ? "good" : "bad"}">${spct(K.gapPct)}</span>`}`, cls(stfOk))
            + card("Adherence", pct(K.ad), "Avg across period", cls(K.ad === null ? null : K.ad >= 0.9))
            + `</div>`;
    }

    private tableHtml(tol: number, slT: number): string {
        const rows = this.buckets.map(b => {
            const vv = b.av !== null && b.fvA > 0 ? (b.av - b.fvA) / b.fvA : null;
            const gap = b.sf !== null && b.rf !== null ? b.sf - b.rf : null;
            const gp = gap !== null && b.rf ? gap / b.rf : null;
            const gc = gp === null ? "" : gp < -tol ? "bad" : gp > tol ? "over" : "good";
            const label = this.view === "intraday" ? b.label : `${b.label} <span style="color:var(--muted);font-weight:400">${esc(b.sub)}</span>`;
            return `<tr data-key="${esc(b.key)}" class="${this.selectedKey === b.key ? "sel" : ""}"><td>${label}</td><td>${fmtN(b.fv)}</td><td>${fmtN(b.av)}</td><td class="${vv === null ? "" : Math.abs(vv) <= 0.05 ? "good" : "bad"}">${spct(vv)}</td>`
                + `<td>${b.fa === null ? "–" : Math.round(b.fa)}</td><td>${b.aa === null ? "–" : Math.round(b.aa)}</td><td>${fmt1(b.rf)}</td><td>${fmt1(b.sf)}</td>`
                + `<td class="${gc}">${gap === null ? "–" : (gap > 0 ? "+" : "") + gap.toFixed(1)}</td><td class="${b.sl === null ? "" : b.sl >= slT ? "good" : "bad"}">${pct(b.sl)}</td></tr>`;
        }).join("");
        return `<table><thead><tr><th>${this.view === "intraday" ? "Time" : this.view === "daily" ? "Day" : "Week"}</th><th>Fcst vol</th><th>Act vol</th><th>Var</th><th>Fcst AHT</th><th>Act AHT</th><th>Req FTE</th><th>Sched FTE</th><th>Gap</th><th>SL</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    private rosterHtml(ros: ReturnType<typeof roster>): string {
        return ros.slice(0, 60).map(a => {
            const img = safeImg(a.avatar);
            const ad = a.adherence;
            const c = ad === null ? "var(--line)" : ad >= 0.9 ? "var(--ok)" : ad >= 0.8 ? "var(--forecast)" : "var(--under)";
            return `<div class="ag" data-tip="${esc(a.name)}|Adherence|${pct(ad)}${a.handled > 0 ? `|Handled|${fmtN(a.handled)}` : ""}">
                <div class="av">${img ? `<img src="${esc(img)}" data-init="${esc(initials(a.name))}" alt="">` : esc(initials(a.name))}</div>
                <div><div class="nm">${esc(a.name)}</div><div class="bar"><i style="width:${ad === null ? 0 : clamp(ad, 0, 1) * 100}%;background:${c}"></i></div></div>
                <div style="text-align:right"><div class="nm">${pct(ad, 0)}</div>${a.handled > 0 ? `<div class="sb">${fmtN(a.handled)} handled</div>` : ""}</div></div>`;
        }).join("");
    }

    // ---------------------------------------------------------------- svg charts
    private xLabels(w: number, l: number, band: number): string {
        const n = this.buckets.length, every = Math.max(1, Math.ceil(46 / band));
        let s = "";
        this.buckets.forEach((b, i) => {
            if (i % every) { return; }
            s += `<text x="${l + band * i + band / 2}" y="__Y__" text-anchor="middle">${esc(b.label)}</text>`;
        });
        return n ? s : "";
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
        return { iw, ih, y, band, l, t, b, r, grid: s, labels: this.xLabels(w, l, band).replace(/__Y__/g, String(h - 6)) };
    }

    private hits(f: { band: number; l: number; t: number; ih: number }, tipFn: (b: Bucket) => string): string {
        return this.buckets.map((b, i) => `<rect class="hit" data-key="${esc(b.key)}" data-tip="${esc(tipFn(b))}" x="${f.l + f.band * i}" y="${f.t}" width="${f.band}" height="${f.ih}"/>`).join("");
    }

    private dimCls(b: Bucket) { return this.selectedKey && this.selectedKey !== b.key ? "dim" : ""; }

    private volumeChart(w: number, h: number): string {
        const B = this.buckets;
        const max = Math.max(1, ...B.map(b => Math.max(b.fv, b.av ?? 0))) * 1.1;
        const f = this.frame(w, h, max, fmtN);
        const bw = Math.min(40, f.band * 0.62);
        const bars = B.map((b, i) => b.av === null ? "" : `<rect class="${this.dimCls(b)}" x="${f.l + f.band * i + (f.band - bw) / 2}" y="${f.y(b.av)}" width="${bw}" height="${Math.max(0, f.y(0) - f.y(b.av))}" rx="2" fill="var(--actual)"/>`).join("");
        const pts = B.map((b, i) => `${f.l + f.band * i + f.band / 2},${f.y(b.fv)}`).join(" ");
        const dots = B.length <= 40 ? B.map((b, i) => `<circle cx="${f.l + f.band * i + f.band / 2}" cy="${f.y(b.fv)}" r="2.6" fill="var(--panel)" stroke="var(--forecast)" stroke-width="1.6"/>`).join("") : "";
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${bars}<polyline points="${pts}" fill="none" stroke="var(--forecast)" stroke-width="2" stroke-linejoin="round"/>${dots}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Forecast|${fmtN(b.fv)}|Actual|${fmtN(b.av)}|Variance|${spct(b.av !== null && b.fvA > 0 ? (b.av - b.fvA) / b.fvA : null)}`)}</svg>`;
    }

    private lines(f: ReturnType<Visual["frame"]>, series: Series[], rmin: number, rmax: number): string {
        let s = "";
        for (const sr of series) {
            const scale = (v: number) => (sr.axis === "l" ? f.y(v) : f.t + f.ih - ((clamp(v, rmin, rmax) - rmin) / (rmax - rmin)) * f.ih);
            let seg: string[] = [];
            const flush = () => { if (seg.length > 1) { s += `<polyline points="${seg.join(" ")}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""}/>`; } seg = []; };
            sr.vals.forEach((v, i) => { if (v === null) { flush(); } else { seg.push(`${f.l + f.band * i + f.band / 2},${scale(v)}`); } });
            flush();
        }
        return s;
    }

    private ahtChart(w: number, h: number, slT: number): string {
        const B = this.buckets;
        const ah = B.flatMap(b => [b.fa, b.aa]).filter((v): v is number => v !== null);
        const lo = ah.length ? Math.floor((Math.min(...ah) * 0.8) / 10) * 10 : 0, hi = ah.length ? Math.ceil((Math.max(...ah) * 1.08) / 10) * 10 : 1;
        const f = this.frame(w, h, Math.max(hi, lo + 10), v => Math.round(v).toString(), 44, 40, 8, 22, lo);
        const rmin = 0.5, rmax = 1;
        let rAxis = "";
        for (let i = 0; i <= 4; i++) { rAxis += `<text x="${w - 36}" y="${f.t + f.ih - (i / 4) * f.ih + 3}" text-anchor="start">${Math.round((rmin + (i / 4) * (rmax - rmin)) * 100)}%</text>`; }
        const tY = f.t + f.ih - ((clamp(slT, rmin, rmax) - rmin) / (rmax - rmin)) * f.ih;
        const series: Series[] = [
            { vals: B.map(b => b.fa), color: "var(--forecast)", axis: "l", dash: "5 4", label: "Forecast AHT" },
            { vals: B.map(b => b.aa), color: "var(--actual)", axis: "l", label: "Actual AHT" },
            { vals: B.map(b => b.sl), color: "var(--ok)", axis: "r", label: "SL" }
        ];
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${rAxis}<line x1="${f.l}" x2="${w - f.r}" y1="${tY}" y2="${tY}" stroke="var(--ok)" stroke-dasharray="2 4" opacity=".7"/>${this.lines(f, series, rmin, rmax)}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Forecast AHT|${b.fa === null ? "–" : Math.round(b.fa) + "s"}|Actual AHT|${b.aa === null ? "–" : Math.round(b.aa) + "s"}|Service level|${pct(b.sl)}`)}</svg>`;
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
        return `<svg viewBox="0 0 ${w} ${h}" height="${h}">${f.grid}${bars}${req}${f.labels}${this.hits(f, b => `${this.tipHead(b)}|Required FTE|${fmt1(b.rf)}|Scheduled FTE|${fmt1(b.sf)}|Gap|${b.rf !== null && b.sf !== null ? (b.sf - b.rf > 0 ? "+" : "") + (b.sf - b.rf).toFixed(1) : "–"}`)}</svg>`;
    }

    private heatChart(w: number, cells: HeatCell[], days: Date[], tol: number): string {
        const l = 62, t = 14, cw = (w - l - 4) / 24, chh = 20, h = t + days.length * chh + 4;
        let s = "";
        for (let hr = 0; hr < 24; hr += 3) { s += `<text x="${l + hr * cw + cw / 2}" y="9" text-anchor="middle">${hr < 10 ? "0" + hr : hr}</text>`; }
        days.forEach((d, r) => {
            s += `<text x="${l - 6}" y="${t + r * chh + 14}" text-anchor="end">${dowName(d)} ${d.getDate()}</text>`;
        });
        for (const c of cells) {
            const r = days.findIndex(d => d.getTime() === c.day.getTime());
            const x = l + c.hour * cw, y = t + r * chh;
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

    private tipHead(b: Bucket): string { return this.view === "intraday" ? b.label : `${b.label} ${b.sub}`; }

    // ---------------------------------------------------------------- events
    private onClick(e: MouseEvent): void {
        const t = e.target as HTMLElement;
        const act = t.closest<HTMLElement>("[data-act]");
        if (act) {
            const a = act.getAttribute("data-act");
            const step = this.view === "intraday" ? 1 : this.view === "daily" ? 7 : 28;
            if (a === "view") { this.view = act.getAttribute("data-v") as ViewMode; }
            if (a === "prev") { this.anchor = addDays(this.anchor!, -step); }
            if (a === "next") { this.anchor = addDays(this.anchor!, step); }
            if (a === "latest") { this.anchor = this.maxDay; }
            this.anchor = new Date(clamp(this.anchor!.getTime(), this.minDay.getTime(), this.maxDay.getTime()));
            this.clearSelection();
            this.render();
            return;
        }
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

    private clearSelection(): void {
        this.selectedKey = null;
        this.selection.clear();
    }

    private onMove(e: MouseEvent): void {
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        if (!t) { this.tooltip.hide({ immediately: false, isTouchEvent: false }); return; }
        const parts = (t.getAttribute("data-tip") || "").split("|");
        const dataItems: powerbi.extensibility.VisualTooltipDataItem[] = [];
        for (let i = 1; i + 1 < parts.length; i += 2) { dataItems.push({ displayName: parts[i], value: parts[i + 1] }); }
        this.tooltip.show({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: [{ displayName: parts[0], value: "", header: parts[0] }, ...dataItems], identities: [] });
    }
}
