// Persisted configuration (settings + drivers), driver application and optional write-back.
import { Row } from "./data";
import { checkUrl } from "./validate";

export type DriverType = "Promotion" | "Event" | "Holiday" | "Outage" | "Marketing" | "Weather" | "Other";
export const DRIVER_TYPES: DriverType[] = ["Promotion", "Event", "Holiday", "Outage", "Marketing", "Weather", "Other"];
export const DRIVER_COLORS: Record<DriverType, string> = { Promotion: "#D6409F", Event: "#8E4EC6", Holiday: "#0E9AA7", Outage: "#E5484D", Marketing: "#F59E0B", Weather: "#3E63DD", Other: "#78909C" };

export interface Driver {
    id: string; name: string; type: DriverType;
    start: string; end: string;               // ISO local date-times
    volPct: number; ahtPct: number;           // % change vs baseline forecast
    skills: string[];                         // [] = all skills
    status: "Planned" | "Confirmed";
    note: string;
}
export interface SkillCfg { color?: string; slTarget?: number | null; priority?: number; hidden?: boolean; }
export interface LevelCfg { label?: string; color?: string; }
export interface Settings {
    v: 1;
    slTarget: number; slThresholdSec: number; agentSlTarget: number | null;
    accuracyTarget: number; adherenceTarget: number; staffingTolerance: number;
    heatFrom: number; heatTo: number;
    applyDrivers: boolean;
    skills: Record<string, SkillCfg>;
    teams: Record<string, { slTarget?: number | null }>;
    levels: Record<string, LevelCfg>;
    writeBack: { enabled: boolean; url: string; autoSend: boolean };
}
export interface Store { settings: Settings; drivers: Driver[]; }

export const defaultSettings = (): Settings => ({
    v: 1, slTarget: 80, slThresholdSec: 20, agentSlTarget: null, accuracyTarget: 90, adherenceTarget: 90, staffingTolerance: 5,
    heatFrom: 7, heatTo: 21, applyDrivers: true, skills: {}, teams: {}, levels: {},
    writeBack: { enabled: false, url: "", autoSend: false }
});

const clampN = (v: unknown, a: number, b: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };

/** Parses persisted JSON with fallbacks: bad JSON -> defaults; out-of-range values -> clamped. Reports what it fixed. */
export function parseStoreChecked(settingsJson?: string, driversJson?: string): { store: Store; problems: string[] } {
    const d = defaultSettings(), problems: string[] = [];
    let s: Settings = d;
    if (settingsJson) {
        try {
            const j = JSON.parse(settingsJson);
            s = { ...d, ...j, writeBack: { ...d.writeBack, ...(j.writeBack || {}) }, skills: j.skills || {}, teams: j.teams || {}, levels: j.levels || {} };
        } catch { problems.push("The stored settings could not be read; defaults are used."); }
    }
    const fix = (k: "slTarget" | "accuracyTarget" | "adherenceTarget" | "staffingTolerance" | "slThresholdSec", lo: number, hi: number) => {
        const v = clampN(s[k], lo, hi, d[k]); if (v !== s[k]) { problems.push(`${k} was out of range (${lo}–${hi}) and was reset to ${v}.`); } s[k] = v;
    };
    fix("slTarget", 0, 100); fix("accuracyTarget", 0, 100); fix("adherenceTarget", 0, 100); fix("staffingTolerance", 0, 100); fix("slThresholdSec", 0, 3600);
    if (s.agentSlTarget !== null && s.agentSlTarget !== undefined) { const v = clampN(s.agentSlTarget, 0, 100, d.slTarget); if (v !== s.agentSlTarget) { problems.push("Agent SL target was out of range and was clamped."); } s.agentSlTarget = v; }
    const hf = Math.round(clampN(s.heatFrom, 0, 23, 7)), ht = Math.round(clampN(s.heatTo, 0, 23, 21));
    if (hf > ht) { problems.push("Heatmap hours were reversed and were reset to 7–21."); s.heatFrom = 7; s.heatTo = 21; } else { s.heatFrom = hf; s.heatTo = ht; }
    let dr: Driver[] = [];
    if (driversJson) {
        try {
            const j = JSON.parse(driversJson);
            if (Array.isArray(j)) {
                dr = j.filter(x => x && x.id && x.start && x.end && !isNaN(new Date(x.start).getTime()) && !isNaN(new Date(x.end).getTime())).map(x => ({
                    id: String(x.id), name: String(x.name ?? "Driver"), type: DRIVER_TYPES.includes(x.type) ? x.type : "Other", start: String(x.start), end: String(x.end),
                    volPct: clampN(x.volPct, -100, 1000, 0), ahtPct: clampN(x.ahtPct, -90, 500, 0), skills: Array.isArray(x.skills) ? x.skills.map(String) : [], status: x.status === "Confirmed" ? "Confirmed" : "Planned", note: String(x.note ?? "")
                }));
                if (dr.length < j.length) { problems.push(`${j.length - dr.length} saved driver(s) had invalid data and were dropped.`); }
            } else { problems.push("The stored drivers had an unexpected format and were ignored."); }
        } catch { problems.push("The stored drivers could not be read and were ignored."); }
    }
    return { store: { settings: s, drivers: dr }, problems };
}
export const parseStore = (settingsJson?: string, driversJson?: string): Store => parseStoreChecked(settingsJson, driversJson).store;

export const slTargetFor = (s: Settings, kind: "skill" | "team" | "agent", name = ""): number => {
    const o = kind === "skill" ? s.skills[name]?.slTarget : kind === "team" ? s.teams[name]?.slTarget : s.agentSlTarget;
    return (o ?? s.slTarget) / 100;
};

export function driverActive(d: Driver, t: Date): boolean {
    return t.getTime() >= new Date(d.start).getTime() && t.getTime() < new Date(d.end).getTime();
}
export const driverApplies = (d: Driver, skill: string) => d.skills.length === 0 || d.skills.includes(skill);

/** Returns rows with forecast & requirement adjusted by active drivers. Actuals are untouched. */
export function applyDrivers(rows: Row[], drivers: Driver[]): Row[] {
    if (!drivers.length) { return rows; }
    const ds = drivers.map(d => ({ d, a: new Date(d.start).getTime(), b: new Date(d.end).getTime() })).filter(x => x.b > x.a);
    return rows.map(r => {
        if (r.fv === null && r.rf === null) { return r; }
        let m = 1, a = 1;
        const t = r.t.getTime();
        for (const x of ds) { if (t >= x.a && t < x.b && driverApplies(x.d, r.skill)) { m *= 1 + x.d.volPct / 100; a *= 1 + x.d.ahtPct / 100; } }
        if (m === 1 && a === 1) { return r; }
        return { ...r, fv: r.fv === null ? null : r.fv * m, fa: r.fa === null ? null : r.fa * a, rf: r.rf === null ? null : r.rf * m * a };
    });
}

// ----------------------------------------------------------------- write-back
export interface WriteBackResult { ok: boolean; message: string; data?: any; }
const SCHEMA = "wfm-command-center/1";

/** POSTs JSON to the configured endpoint. Uses a "simple" request (text/plain, no-cors) so no CORS preflight is needed; the response is opaque. */
export async function sendWriteBack(url: string, kind: string, payload: unknown): Promise<WriteBackResult> {
    const bad = checkUrl(url); if (bad) { return { ok: false, message: bad }; }
    try {
        await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "save", kind, sentAt: new Date().toISOString(), payload }) });
        return { ok: true, message: `Sent ${kind} (response is opaque in no-cors mode; confirm in your flow run history)` };
    } catch (e) { return { ok: false, message: "Send failed — the request was blocked or the network is unreachable. Check the URL, that your tenant allows this visual to call external services, and that you are online." }; }
}

/** Loads {settings?, drivers?} from the endpoint. Requires the endpoint to answer CORS requests. */
export async function loadWriteBack(url: string): Promise<WriteBackResult> {
    const bad = checkUrl(url); if (bad) { return { ok: false, message: bad }; }
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "load" }) });
        if (!res.ok) { return { ok: false, message: `Load failed: the endpoint answered HTTP ${res.status}.` }; }
        let data: unknown; try { data = await res.json(); } catch { return { ok: false, message: "Load failed: the endpoint did not return valid JSON. Expected { settings?, drivers? }." }; }
        if (!data || typeof data !== "object") { return { ok: false, message: "Load failed: expected a JSON object { settings?, drivers? }." }; }
        return { ok: true, message: "Loaded from endpoint", data };
    } catch (e) { return { ok: false, message: "Load failed — most likely the endpoint does not return CORS headers (Power Automate triggers often do not). Put an Azure Function / API Management in front, or use Send only." }; }
}
