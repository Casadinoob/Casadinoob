// Persisted configuration (settings + drivers), driver application and optional write-back.
import { Row } from "./data";

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

export function parseStore(settingsJson?: string, driversJson?: string): Store {
    const d = defaultSettings();
    let s = d;
    try { if (settingsJson) { const j = JSON.parse(settingsJson); s = { ...d, ...j, writeBack: { ...d.writeBack, ...(j.writeBack || {}) }, skills: j.skills || {}, teams: j.teams || {}, levels: j.levels || {} }; } } catch { /* keep defaults */ }
    let dr: Driver[] = [];
    try { if (driversJson) { const j = JSON.parse(driversJson); if (Array.isArray(j)) { dr = j.filter(x => x && x.id && x.start && x.end); } } } catch { /* ignore */ }
    return { settings: s, drivers: dr };
}

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
    if (!/^https:\/\//i.test(url)) { return { ok: false, message: "Endpoint must be an https:// URL" }; }
    try {
        await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "save", kind, sentAt: new Date().toISOString(), payload }) });
        return { ok: true, message: `Sent ${kind} (response is opaque in no-cors mode; confirm in your flow run history)` };
    } catch (e) { return { ok: false, message: `Send failed: ${String(e)}` }; }
}

/** Loads {settings?, drivers?} from the endpoint. Requires the endpoint to answer CORS requests. */
export async function loadWriteBack(url: string): Promise<WriteBackResult> {
    if (!/^https:\/\//i.test(url)) { return { ok: false, message: "Endpoint must be an https:// URL" }; }
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "load" }) });
        if (!res.ok) { return { ok: false, message: `Load failed: HTTP ${res.status}` }; }
        return { ok: true, message: "Loaded from endpoint", data: await res.json() };
    } catch (e) { return { ok: false, message: `Load failed (CORS or network): ${String(e)}` }; }
}
