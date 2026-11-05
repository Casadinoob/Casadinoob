import powerbi from "powerbi-visuals-api";
// Pure data engine: parsing, interval collapsing, bucketing, KPIs. No DOM here.

export type ViewMode = "intraday" | "daily" | "weekly";

export interface Row {
    idx: number;
    t: Date;
    skill: string; team: string; level: string;
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

const ROLE_ORDER = ["interval", "skill", "team", "level", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht",
    "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"] as const;

export interface ParseStats {
    totalRows: number; used: number; badInterval: number; dateOnly: boolean;
    negVol: number; badAht: number; negFte: number; slClamped: number; adClamped: number;
    agentWithPlan: number; duplicates: number; boundColumns: string[]; minT: number; maxT: number; noActuals: boolean;
}
const emptyStats = (): ParseStats => ({ totalRows: 0, used: 0, badInterval: 0, dateOnly: false, negVol: 0, badAht: 0, negFte: 0, slClamped: 0, adClamped: 0, agentWithPlan: 0, duplicates: 0, boundColumns: [], minT: 0, maxT: 0, noActuals: false });

const frac = (v: number | null): number | null => (v !== null && v > 1.5 ? v / 100 : v);   // accept 0-1 or 0-100
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") { return null; }
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Parses the table and applies fallbacks: unusable values are ignored (null) or clamped, and counted in `stats` so the UI can warn. */
export function parseTable(table: powerbi.DataViewTable | undefined): { rows: Row[]; bound: Record<string, boolean>; stats: ParseStats } {
    const bound: Record<string, boolean> = {};
    const rows: Row[] = [];
    const stats = emptyStats();
    if (!table || !table.columns) { return { rows, bound, stats }; }
    const col: Record<string, number> = {};
    table.columns.forEach((c, i) => {
        for (const r of ROLE_ORDER) { if (c.roles && c.roles[r] && col[r] === undefined) { col[r] = i; bound[r] = true; } }
    });
    stats.boundColumns = Object.keys(bound);
    stats.totalRows = (table.rows ?? []).length;
    if (col.interval === undefined) { return { rows, bound, stats }; }
    const get = (r: powerbi.DataViewTableRow, k: string) => (col[k] === undefined ? null : r[col[k]]);
    const seen = new Set<string>();
    let allMidnight = true, anyActual = false, minT = Infinity, maxT = -Infinity;
    (table.rows ?? []).forEach((r, idx) => {
        const raw = get(r, "interval");
        const t = raw instanceof Date ? raw : new Date(raw as string | number);
        if (raw === null || raw === undefined || raw === "" || isNaN(t.getTime())) { stats.badInterval++; return; }
        const pos = (v: number | null, c: "negVol" | "negFte"): number | null => { if (v !== null && v < 0) { stats[c]++; return null; } return v; };
        const aht = (v: number | null): number | null => { if (v !== null && v <= 0) { stats.badAht++; return null; } return v; };
        const rate = (v: number | null, c: "slClamped" | "adClamped"): number | null => { const f = frac(v); if (f !== null && (f > 1 || f < 0)) { stats[c]++; return clampN(f, 0, 1); } return f; };
        const row: Row = {
            idx, t,
            skill: String(get(r, "skill") ?? ""), team: String(get(r, "team") ?? ""), level: String(get(r, "level") ?? ""),
            agent: String(get(r, "agent") ?? ""), avatar: String(get(r, "avatarUrl") ?? ""),
            fv: pos(num(get(r, "forecastVolume")), "negVol"), av: pos(num(get(r, "actualVolume")), "negVol"),
            fa: aht(num(get(r, "forecastAht"))), aa: aht(num(get(r, "actualAht"))),
            rf: pos(num(get(r, "requiredFte")), "negFte"), sf: pos(num(get(r, "scheduledFte")), "negFte"),
            sl: rate(num(get(r, "serviceLevel")), "slClamped"), ad: rate(num(get(r, "adherence")), "adClamped")
        };
        if (t.getHours() !== 0 || t.getMinutes() !== 0 || t.getSeconds() !== 0) { allMidnight = false; }
        if (row.av !== null) { anyActual = true; }
        if (row.agent && (row.fv !== null || row.rf !== null)) { stats.agentWithPlan++; }
        const k = `${t.getTime()}|${row.skill}|${row.team}|${row.agent}`;
        if (seen.has(k)) { stats.duplicates++; } else { seen.add(k); }
        const tt = t.getTime(); if (tt < minT) { minT = tt; } if (tt > maxT) { maxT = tt; }
        rows.push(row);
    });
    stats.used = rows.length; stats.dateOnly = rows.length > 0 && allMidnight; stats.noActuals = rows.length > 0 && !anyActual;
    stats.minT = rows.length ? minT : 0; stats.maxT = rows.length ? maxT : 0;
    return { rows, bound, stats };
}
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
        if (r.fv !== null) { iv.fv += r.fv; }
        if (r.av !== null) { iv.avSum += r.av; iv.hasAv = true; }
        if (r.fa !== null) { const w = r.fv ?? 1; iv.faW += r.fa * w; iv.faN += w; }
        if (r.aa !== null) { const w = r.av ?? 1; iv.aaW += r.aa * w; iv.aaN += w; }
        if (r.rf !== null) { iv.rf = (iv.rf ?? 0) + r.rf; }
        if (r.sf !== null) { iv.sf = (iv.sf ?? 0) + r.sf; }
        if (r.sl !== null) { const w = r.av ?? 1; iv.slW += r.sl * w; iv.slN += w; }
        if (r.ad !== null) { iv.ad.push(r.ad); }
    }
    const out = Array.from(m.values()).sort((a, b) => a.t.getTime() - b.t.getTime());
    out.forEach(iv => { iv.fvA = iv.hasAv ? iv.fv : 0; });   // forecast only counts where actuals exist (decided per interval, rows may differ)
    return out;
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

export type Dim = "skill" | "team" | "level" | "agent";
export interface DimStat {
    name: string; avatar: string; team: string; level: string; skill: string;
    agents: number; fvA: number; av: number; handled: number;
    fa: number | null; aa: number | null; sl: number | null; ad: number | null;
    rf: number | null; sf: number | null; gapPct: number | null; accuracy: number | null; volVarPct: number | null;
}

/** Aggregate rows by a dimension (skill/team/level/agent). FTE is averaged across intervals, volumes summed. */
export function byDim(rows: Row[], dim: Dim): DimStat[] {
    interface Acc { avatar: string; team: string; level: string; skill: string; agents: Set<string>; iv: Map<number, { fv: number; av: number; hasAv: boolean; rf: number; sf: number; hasR: boolean; hasS: boolean }>;
        faW: number; faN: number; aaW: number; aaN: number; slW: number; slN: number; adS: number; adN: number; handled: number }
    const m = new Map<string, Acc>();
    for (const r of rows) {
        const k = r[dim];
        if (!k) { continue; }
        let a = m.get(k);
        if (!a) { a = { avatar: "", team: "", level: "", skill: "", agents: new Set(), iv: new Map(), faW: 0, faN: 0, aaW: 0, aaN: 0, slW: 0, slN: 0, adS: 0, adN: 0, handled: 0 }; m.set(k, a); }
        if (r.avatar && !a.avatar) { a.avatar = r.avatar; }
        if (r.team && !a.team) { a.team = r.team; }
        if (r.level && !a.level) { a.level = r.level; }
        if (r.skill && !a.skill) { a.skill = r.skill; }
        if (r.agent) { a.agents.add(r.agent); }
        const t = r.t.getTime();
        let iv = a.iv.get(t);
        if (!iv) { iv = { fv: 0, av: 0, hasAv: false, rf: 0, sf: 0, hasR: false, hasS: false }; a.iv.set(t, iv); }
        if (r.fv !== null) { iv.fv += r.fv; }
        if (r.av !== null) { iv.av += r.av; iv.hasAv = true; a.handled += r.av; }
        if (r.rf !== null) { iv.rf += r.rf; iv.hasR = true; }
        if (r.sf !== null) { iv.sf += r.sf; iv.hasS = true; }
        if (r.fa !== null) { const w = r.fv ?? 1; a.faW += r.fa * w; a.faN += w; }
        if (r.aa !== null) { const w = r.av ?? 1; a.aaW += r.aa * w; a.aaN += w; }
        if (r.sl !== null) { const w = r.av ?? 1; a.slW += r.sl * w; a.slN += w; }
        if (r.ad !== null) { a.adS += r.ad; a.adN++; }
    }
    return Array.from(m, ([name, a]) => {
        let fvA = 0, av = 0, abs = 0, rf = 0, nr = 0, sf = 0, ns = 0;
        a.iv.forEach(i => {
            if (i.hasAv) { fvA += i.fv; av += i.av; abs += Math.abs(i.av - i.fv); }
            if (i.hasR) { rf += i.rf; nr++; }
            if (i.hasS) { sf += i.sf; ns++; }
        });
        const rfa = nr ? rf / nr : null, sfa = ns ? sf / ns : null;
        return {
            name, avatar: a.avatar, team: a.team, level: a.level, skill: a.skill, agents: a.agents.size, fvA, av, handled: a.handled,
            fa: a.faN ? a.faW / a.faN : null, aa: a.aaN ? a.aaW / a.aaN : null, sl: a.slN ? a.slW / a.slN : null, ad: a.adN ? a.adS / a.adN : null,
            rf: rfa, sf: sfa, gapPct: rfa && sfa !== null ? (sfa - rfa) / rfa : null,
            accuracy: fvA > 0 ? Math.max(0, 1 - abs / fvA) : null, volVarPct: fvA > 0 ? (av - fvA) / fvA : null
        };
    }).sort((x, y) => y.handled - x.handled || x.name.localeCompare(y.name));
}

/** Skill x hour staffing coverage: average required & scheduled FTE per (skill,hour). */
export interface CoverCell { skill: string; hour: number; rf: number | null; sf: number | null; v: number | null; }
export function coverage(rows: Row[], skills: string[]): CoverCell[] {
    const per = new Map<string, { rf: number; sf: number; hasR: boolean; hasS: boolean }>();
    for (const r of rows) {
        if (!r.skill || (r.rf === null && r.sf === null)) { continue; }
        const k = `${r.skill}|${r.t.getTime()}`;
        let x = per.get(k);
        if (!x) { x = { rf: 0, sf: 0, hasR: false, hasS: false }; per.set(k, x); }
        if (r.rf !== null) { x.rf += r.rf; x.hasR = true; }
        if (r.sf !== null) { x.sf += r.sf; x.hasS = true; }
    }
    const agg = new Map<string, { rf: number; nr: number; sf: number; ns: number }>();
    per.forEach((x, k) => {
        const [skill, t] = k.split("|");
        const hr = new Date(Number(t)).getHours();
        const kk = `${skill}|${hr}`;
        let g = agg.get(kk);
        if (!g) { g = { rf: 0, nr: 0, sf: 0, ns: 0 }; agg.set(kk, g); }
        if (x.hasR) { g.rf += x.rf; g.nr++; }
        if (x.hasS) { g.sf += x.sf; g.ns++; }
    });
    const out: CoverCell[] = [];
    for (const skill of skills) {
        for (let h = 0; h < 24; h++) {
            const g = agg.get(`${skill}|${h}`);
            const rf = g && g.nr ? g.rf / g.nr : null, sf = g && g.ns ? g.sf / g.ns : null;
            out.push({ skill, hour: h, rf, sf, v: rf && sf !== null ? (sf - rf) / rf : null });
        }
    }
    return out;
}

/** Average scheduled FTE by skill and level (agent-grain rows). */
export function levelMix(rows: Row[]): Map<string, Map<string, number>> {
    const per = new Map<string, number>(); const ts = new Map<string, Set<number>>();
    for (const r of rows) {
        if (!r.skill || !r.level || r.sf === null) { continue; }
        const k = `${r.skill}|${r.level}`;
        per.set(k, (per.get(k) ?? 0) + r.sf);
        const sk = ts.get(r.skill) ?? new Set<number>(); sk.add(r.t.getTime()); ts.set(r.skill, sk);
    }
    const out = new Map<string, Map<string, number>>();
    per.forEach((v, k) => {
        const [skill, level] = k.split("|");
        const mm = out.get(skill) ?? new Map<string, number>();
        mm.set(level, v / Math.max(1, ts.get(skill)!.size));
        out.set(skill, mm);
    });
    return out;
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
