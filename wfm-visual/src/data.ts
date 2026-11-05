import powerbi from "powerbi-visuals-api";
// Pure data engine: parsing, interval collapsing, bucketing, KPIs. No DOM here.

export type ViewMode = "intraday" | "daily" | "weekly";

export interface Row {
    idx: number;
    t: Date;
    queue: string;
    agent: string;
    avatar: string;
    fv: number | null; av: number | null;
    fa: number | null; aa: number | null;
    rf: number | null; sf: number | null;
    sl: number | null; ad: number | null;
}

export interface Bucket {
    key: string;
    start: Date;
    label: string;
    sub: string;
    rows: number[];
    fv: number; av: number | null; fvA: number;       // fvA = forecast over intervals that have actuals
    fa: number | null; aa: number | null;
    rf: number | null; sf: number | null;
    sl: number | null; ad: number | null;
    absErr: number;                                    // sum |act-fcst| over intervals with actuals
    hasActual: boolean;
}

export interface Kpis {
    fvA: number; av: number; volVarPct: number | null;
    accuracy: number | null;
    fa: number | null; aa: number | null; ahtVarPct: number | null;
    sl: number | null;
    rf: number | null; sf: number | null; gapFte: number | null; gapPct: number | null;
    ad: number | null;
}

export interface AgentStat { name: string; avatar: string; adherence: number | null; handled: number; queues: number; }

const ROLE_ORDER = ["interval", "queue", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht",
    "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"] as const;

const frac = (v: number | null): number | null => (v !== null && v > 1.5 ? v / 100 : v);   // accept 0-1 or 0-100
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") { return null; }
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

export function parseTable(table: powerbi.DataViewTable | undefined): { rows: Row[]; bound: Record<string, boolean> } {
    const bound: Record<string, boolean> = {};
    const rows: Row[] = [];
    if (!table || !table.columns) { return { rows, bound }; }
    const col: Record<string, number> = {};
    table.columns.forEach((c, i) => {
        for (const r of ROLE_ORDER) { if (c.roles && c.roles[r] && col[r] === undefined) { col[r] = i; bound[r] = true; } }
    });
    if (col.interval === undefined) { return { rows, bound }; }
    const get = (r: powerbi.DataViewTableRow, k: string) => (col[k] === undefined ? null : r[col[k]]);
    (table.rows ?? []).forEach((r, idx) => {
        const raw = get(r, "interval");
        const t = raw instanceof Date ? raw : new Date(raw as string | number);
        if (!raw || isNaN(t.getTime())) { return; }
        rows.push({
            idx, t,
            queue: String(get(r, "queue") ?? ""),
            agent: String(get(r, "agent") ?? ""),
            avatar: String(get(r, "avatarUrl") ?? ""),
            fv: num(get(r, "forecastVolume")), av: num(get(r, "actualVolume")),
            fa: num(get(r, "forecastAht")), aa: num(get(r, "actualAht")),
            rf: num(get(r, "requiredFte")), sf: num(get(r, "scheduledFte")),
            sl: frac(num(get(r, "serviceLevel"))), ad: frac(num(get(r, "adherence")))
        });
    });
    return { rows, bound };
}

// ---------- date helpers (local time, as supplied by the model) ----------
export const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function weekStartOf(d: Date, weekStart: number): Date {
    const s = dayStart(d);
    const diff = (s.getDay() - weekStart + 7) % 7;
    return addDays(s, -diff);
}
export function isoWeek(d: Date): number {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dn = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dn);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}
const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dowName = (d: Date) => DOW[d.getDay()];
export const dayLabel = (d: Date) => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;

// ---------- interval collapse: many rows (queues/agents) -> one record per timestamp ----------
interface Iv {
    t: Date; rows: number[];
    fv: number; avSum: number; hasAv: boolean; fvA: number;
    faW: number; faN: number; aaW: number; aaN: number;
    rf: number | null; sf: number | null; slW: number; slN: number; ad: number[]; 
}

export function collapse(rows: Row[]): Iv[] {
    const m = new Map<number, Iv>();
    for (const r of rows) {
        const k = r.t.getTime();
        let iv = m.get(k);
        if (!iv) {
            iv = { t: r.t, rows: [], fv: 0, avSum: 0, hasAv: false, fvA: 0, faW: 0, faN: 0, aaW: 0, aaN: 0, rf: null, sf: null, slW: 0, slN: 0, ad: [] };
            m.set(k, iv);
        }
        iv.rows.push(r.idx);
        if (r.fv !== null) { iv.fv += r.fv; if (r.av !== null) { iv.fvA += r.fv; } }
        if (r.av !== null) { iv.avSum += r.av; iv.hasAv = true; }
        if (r.fa !== null) { const w = r.fv ?? 1; iv.faW += r.fa * w; iv.faN += w; }
        if (r.aa !== null) { const w = r.av ?? 1; iv.aaW += r.aa * w; iv.aaN += w; }
        if (r.rf !== null) { iv.rf = (iv.rf ?? 0) + r.rf; }
        if (r.sf !== null) { iv.sf = (iv.sf ?? 0) + r.sf; }
        if (r.sl !== null) { const w = r.av ?? 1; iv.slW += r.sl * w; iv.slN += w; }
        if (r.ad !== null) { iv.ad.push(r.ad); }
    }
    return Array.from(m.values()).sort((a, b) => a.t.getTime() - b.t.getTime());
}

export function intervalMinutes(ivs: Iv[]): number {
    const d: number[] = [];
    for (let i = 1; i < Math.min(ivs.length, 400); i++) {
        const x = (ivs[i].t.getTime() - ivs[i - 1].t.getTime()) / 60000;
        if (x > 0) { d.push(x); }
    }
    if (!d.length) { return 30; }
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
}

export function bucketize(ivs: Iv[], keyOf: (d: Date) => { key: string; start: Date; label: string; sub: string }): Bucket[] {
    const m = new Map<string, Bucket & { _n: number; _faW: number; _faN: number; _aaW: number; _aaN: number; _slW: number; _slN: number; _adS: number; _adN: number; _rfN: number; _sfN: number; _rfS: number; _sfS: number; _avN: number }>();
    for (const iv of ivs) {
        const k = keyOf(iv.t);
        let b = m.get(k.key);
        if (!b) {
            b = { key: k.key, start: k.start, label: k.label, sub: k.sub, rows: [], fv: 0, av: null, fvA: 0, fa: null, aa: null, rf: null, sf: null, sl: null, ad: null, absErr: 0, hasActual: false,
                _n: 0, _faW: 0, _faN: 0, _aaW: 0, _aaN: 0, _slW: 0, _slN: 0, _adS: 0, _adN: 0, _rfN: 0, _sfN: 0, _rfS: 0, _sfS: 0, _avN: 0 };
            m.set(k.key, b);
        }
        b.rows.push(...iv.rows);
        b.fv += iv.fv;
        if (iv.hasAv) { b.av = (b.av ?? 0) + iv.avSum; b.fvA += iv.fvA; b.absErr += Math.abs(iv.avSum - iv.fvA); b.hasActual = true; }
        b._faW += iv.faW; b._faN += iv.faN; b._aaW += iv.aaW; b._aaN += iv.aaN;
        b._slW += iv.slW; b._slN += iv.slN;
        iv.ad.forEach(a => { b!._adS += a; b!._adN++; });
        if (iv.rf !== null) { b._rfS += iv.rf; b._rfN++; }
        if (iv.sf !== null) { b._sfS += iv.sf; b._sfN++; }
    }
    return Array.from(m.values()).sort((a, b) => a.start.getTime() - b.start.getTime()).map(b => {
        b.fa = b._faN ? b._faW / b._faN : null;
        b.aa = b._aaN ? b._aaW / b._aaN : null;
        b.sl = b._slN ? b._slW / b._slN : null;
        b.ad = b._adN ? b._adS / b._adN : null;
        b.rf = b._rfN ? b._rfS / b._rfN : null;
        b.sf = b._sfN ? b._sfS / b._sfN : null;
        return b as Bucket;
    });
}

export const hourKey = (d: Date) => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()); return { key: "h" + s.getTime(), start: s, label: hhmm(s), sub: "" }; };
export const nativeKey = (d: Date) => ({ key: "n" + d.getTime(), start: d, label: hhmm(d), sub: "" });
export const dayKey = (d: Date) => { const s = dayStart(d); return { key: "d" + s.getTime(), start: s, label: `${dowName(s)} ${s.getDate()}`, sub: MON[s.getMonth()] }; };
export const weekKey = (ws: number) => (d: Date) => {
    const s = weekStartOf(d, ws);
    return { key: "w" + s.getTime(), start: s, label: `W${isoWeek(ws === 1 ? s : addDays(s, 1))}`, sub: `${s.getDate()} ${MON[s.getMonth()]}` };
};

export function kpis(buckets: Bucket[]): Kpis {
    let fvA = 0, av = 0, abs = 0, faW = 0, faN = 0, aaW = 0, aaN = 0, slW = 0, slN = 0, adS = 0, adN = 0, rf = 0, sf = 0, n = 0;
    for (const b of buckets) {
        if (b.av !== null) {
            fvA += b.fvA; av += b.av; abs += b.absErr;
            if (b.fa !== null) { faW += b.fa * (b.fvA || 1); faN += b.fvA || 1; }
            if (b.aa !== null) { aaW += b.aa * (b.av || 1); aaN += b.av || 1; }
            if (b.sl !== null) { slW += b.sl * (b.av || 1); slN += b.av || 1; }
        }
        if (b.ad !== null) { adS += b.ad; adN++; }
        if (b.rf !== null && b.sf !== null) { rf += b.rf; sf += b.sf; n++; }
    }
    const fa = faN ? faW / faN : null, aa = aaN ? aaW / aaN : null;
    return {
        fvA, av,
        volVarPct: fvA > 0 ? (av - fvA) / fvA : null,
        accuracy: fvA > 0 ? Math.max(0, 1 - abs / fvA) : null,
        fa, aa, ahtVarPct: fa && aa !== null ? (aa - fa) / fa : null,
        sl: slN ? slW / slN : null,
        rf: n ? rf / n : null, sf: n ? sf / n : null,
        gapFte: n ? (sf - rf) / n : null,
        gapPct: n && rf > 0 ? (sf - rf) / rf : null,
        ad: adN ? adS / adN : null
    };
}

export function roster(rows: Row[], inRange: Set<number>): AgentStat[] {
    const m = new Map<string, { avatar: string; adS: number; adN: number; handled: number; q: Set<string> }>();
    for (const r of rows) {
        if (!r.agent || !inRange.has(r.idx)) { continue; }
        let a = m.get(r.agent);
        if (!a) { a = { avatar: "", adS: 0, adN: 0, handled: 0, q: new Set() }; m.set(r.agent, a); }
        if (r.avatar && !a.avatar) { a.avatar = r.avatar; }
        if (r.ad !== null) { a.adS += r.ad; a.adN++; }
        if (r.av !== null) { a.handled += r.av; }
        if (r.queue) { a.q.add(r.queue); }
    }
    return Array.from(m, ([name, a]) => ({ name, avatar: a.avatar, adherence: a.adN ? a.adS / a.adN : null, handled: a.handled, queues: a.q.size }))
        .sort((x, y) => y.handled - x.handled || x.name.localeCompare(y.name));
}

// Heatmap: day x hour staffing variance %, from hourly buckets.
export interface HeatCell { day: Date; hour: number; v: number | null; rf: number | null; sf: number | null; }
export function heatmap(hourly: Bucket[], days: Date[]): HeatCell[] {
    const m = new Map<string, Bucket>();
    hourly.forEach(b => m.set(`${dayStart(b.start).getTime()}_${b.start.getHours()}`, b));
    const out: HeatCell[] = [];
    for (const day of days) {
        for (let h = 0; h < 24; h++) {
            const b = m.get(`${day.getTime()}_${h}`);
            const ok = b && b.rf !== null && b.sf !== null && b.rf > 0;
            out.push({ day, hour: h, v: ok ? (b!.sf! - b!.rf!) / b!.rf! : null, rf: b?.rf ?? null, sf: b?.sf ?? null });
        }
    }
    return out;
}
