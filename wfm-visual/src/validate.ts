// Validation & fallback diagnostics. Pure functions: produce Issue[] that the UI renders as a "Data health" panel.
import { ParseStats, Row } from "./data";
import { Driver, Settings } from "./store";

export type Level = "error" | "warn" | "info";
export interface Issue { level: Level; code: string; title: string; detail: string; fix?: string; }

const MEASURES = ["forecastVolume", "actualVolume", "forecastAht", "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"];
export const ROLE_LABEL: Record<string, string> = {
    interval: "Interval (date/time)", skill: "Skill / Queue", team: "Team", level: "Level / Tier", agent: "Agent / Team", avatarUrl: "Avatar image URL",
    forecastVolume: "Forecast volume", actualVolume: "Actual volume", forecastAht: "Forecast AHT", actualAht: "Actual AHT",
    requiredFte: "Required FTE", scheduledFte: "Scheduled FTE", serviceLevel: "Service level", adherence: "Adherence"
};
export const ALLOWED_HOST_SUFFIXES = ["logic.azure.com", "api.powerplatform.com", "azurewebsites.net", "azure-api.net"];

export function hostAllowed(url: string): boolean {
    try { const h = new URL(url).hostname.toLowerCase(); return ALLOWED_HOST_SUFFIXES.some(s => h === s || h.endsWith("." + s)); } catch { return false; }
}
export function checkUrl(url: string): string | null {
    if (!url.trim()) { return "Enter an endpoint URL."; }
    let u: URL; try { u = new URL(url); } catch { return "This is not a valid URL."; }
    if (u.protocol !== "https:") { return "The endpoint must use https://."; }
    if (!hostAllowed(url)) { return `Power BI only lets this visual call: ${ALLOWED_HOST_SUFFIXES.map(s => "*." + s).join(", ")}. Other hosts will be blocked.`; }
    return null;
}

export interface DataCtx { stats: ParseStats; bound: Record<string, boolean>; truncated: boolean; rowCap: number; }

export function dataIssues(c: DataCtx): Issue[] {
    const { stats: s, bound: b } = c;
    const out: Issue[] = [];
    const add = (level: Level, code: string, title: string, detail: string, fix?: string) => out.push({ level, code, title, detail, fix });
    if (!b.interval) {
        add("error", "NO_INTERVAL", "No Interval field", "The visual needs the start time of each interval to build any view.", "Drag a Date/Time column into “Interval (date/time)” and set it to “Don't summarize”.");
        return out;
    }
    if (s.totalRows > 0 && s.used === 0) {
        add("error", "ALL_INTERVALS_INVALID", "Interval values are not dates", `None of the ${s.totalRows.toLocaleString()} rows has a readable date/time.`, "Change the column type to Date/Time in Power Query (Transform data), then refresh.");
        return out;
    }
    if (s.totalRows === 0) { add("info", "NO_ROWS", "No rows", "The field wells are bound but no rows are returned (a filter or slicer may exclude everything).", "Clear slicers/filters or check the date range."); return out; }
    if (!MEASURES.some(m => b[m])) { add("error", "NO_MEASURES", "No measures bound", "Only the Interval is bound, so there is nothing to chart.", "Add at least Forecast volume and Actual volume."); }
    if (s.badInterval > 0) { add("warn", "BAD_INTERVAL", `${s.badInterval.toLocaleString()} rows ignored`, "These rows have an empty or unreadable Interval and were skipped.", "Fix the source data or filter them out."); }
    if (s.dateOnly) { add("warn", "DATE_ONLY", "Interval has no time of day", "Every timestamp is at 00:00, so Intraday/hourly views can't work. The visual switched to Daily.", "Use a Date/Time column with the interval start (e.g. 2026-11-04 09:30)."); }
    if (b.forecastVolume && !b.actualVolume) { add("info", "NO_ACTUAL_BOUND", "No Actual volume", "Variance, forecast accuracy and trends vs actual are hidden.", "Add Actual volume to compare."); }
    if (b.actualVolume && !b.forecastVolume) { add("info", "NO_FORECAST_BOUND", "No Forecast volume", "Variance and forecast accuracy are hidden, and drivers have nothing to adjust.", "Add Forecast volume."); }
    if (b.actualVolume && s.noActuals) { add("info", "NO_ACTUALS_IN_RANGE", "No actuals in the data", "Actual volume is bound but every value is empty.", "Check the measure and any filters."); }
    if ((b.requiredFte && !b.scheduledFte) || (!b.requiredFte && b.scheduledFte)) { add("info", "STAFFING_INCOMPLETE", "Staffing needs both FTE fields", "Required FTE and Scheduled FTE are both needed for gap, heatmap and coverage.", "Add the missing one."); }
    if (s.negVol > 0) { add("warn", "NEG_VOLUME", `${s.negVol.toLocaleString()} negative volume values ignored`, "Negative forecast/actual volumes were treated as empty.", "Check the source measure."); }
    if (s.negFte > 0) { add("warn", "NEG_FTE", `${s.negFte.toLocaleString()} negative FTE values ignored`, "Negative required/scheduled FTE were treated as empty.", "Check the source measure."); }
    if (s.badAht > 0) { add("warn", "BAD_AHT", `${s.badAht.toLocaleString()} zero/negative AHT values ignored`, "AHT must be greater than 0 seconds.", "Make sure AHT is in seconds and blank (not 0) when there are no contacts."); }
    if (s.slClamped > 0) { add("warn", "SL_RANGE", `${s.slClamped.toLocaleString()} service-level values outside 0–100%`, "They were clamped to the 0–100% range. This usually means the measure is being summed across rows.", "Set the field's aggregation to Average, or use a ratio measure (answered in threshold ÷ offered)."); }
    if (s.adClamped > 0) { add("warn", "AD_RANGE", `${s.adClamped.toLocaleString()} adherence values outside 0–100%`, "They were clamped to the 0–100% range, likely because the measure is summed.", "Set aggregation to Average or use a ratio measure."); }
    if (s.agentWithPlan > 0) { add("warn", "AGENT_PLAN_MIX", "Agent rows also carry forecast / required FTE", `${s.agentWithPlan.toLocaleString()} agent rows have forecast or required values, so totals can double count.`, "Put forecast and required FTE on plan rows (Agent blank) and only handled volume, SL, adherence and scheduled FTE on agent rows."); }
    if (s.duplicates > 0) { add("warn", "DUPLICATES", `${s.duplicates.toLocaleString()} duplicate rows`, "Several rows share the same interval, skill, team and agent. They are summed, which may double count.", "Add a unique key to the data or aggregate upstream."); }
    if (c.truncated) { add("warn", "TRUNCATED", "Not all data was loaded", `Power BI limits this visual to ${c.rowCap.toLocaleString()} rows per load; totals may be incomplete.`, "Filter to a shorter period, or aggregate to hourly in the model."); }
    return out;
}

/** Fields required for a page; returns the missing role labels. */
export function pageNeeds(page: string, b: Record<string, boolean>): string[] {
    const need: Record<string, string[]> = { skills: ["skill"], teams: ["team", "agent"] };
    return (need[page] || []).filter(r => !b[r]).map(r => ROLE_LABEL[r]);
}

export function configIssues(settings: Settings, drivers: Driver[], rows: Row[], bound: Record<string, boolean>, minT: number, maxT: number, problems: string[], viewMode: number): Issue[] {
    const out: Issue[] = [];
    const add = (level: Level, code: string, title: string, detail: string, fix?: string) => out.push({ level, code, title, detail, fix });
    problems.forEach(p => add("warn", "STORE", "Saved settings had problems", p, "Review the Settings page; invalid values were replaced by defaults."));
    const skills = new Set(rows.map(r => r.skill).filter(Boolean));
    drivers.forEach(d => {
        const a = new Date(d.start).getTime(), e = new Date(d.end).getTime();
        if (!(e > a)) { add("error", "DRV_PERIOD", `Driver “${d.name}” has an invalid period`, "The end is not after the start, so it is ignored.", "Edit the driver."); return; }
        if (minT && (e < minT || a > maxT)) { add("info", "DRV_OUTSIDE", `Driver “${d.name}” is outside the data range`, "It doesn't overlap any interval in the data, so it has no effect right now."); }
        const unk = d.skills.filter(s => skills.size && !skills.has(s));
        if (unk.length) { add("warn", "DRV_SKILL", `Driver “${d.name}” targets unknown skill(s)`, unk.join(", ") + " not found in the data.", "Edit the driver's skills."); }
        if (!bound.forecastVolume) { add("info", "DRV_NOFCST", `Driver “${d.name}” has nothing to adjust`, "Forecast volume isn't bound.", "Add Forecast volume."); }
    });
    // overlapping drivers multiply
    for (let i = 0; i < drivers.length; i++) { for (let j = i + 1; j < drivers.length; j++) {
        const A = drivers[i], B = drivers[j];
        if (new Date(A.start) < new Date(B.end) && new Date(B.start) < new Date(A.end) && (A.skills.length === 0 || B.skills.length === 0 || A.skills.some(s => B.skills.includes(s)))) {
            add("info", "DRV_OVERLAP", `“${A.name}” overlaps “${B.name}”`, "Overlapping drivers multiply (e.g. +20% and +10% = +32%).");
        }
    } }
    const wb = settings.writeBack;
    if (wb.enabled) { const m = checkUrl(wb.url); if (m) { add("warn", "WB_URL", "Write-back endpoint", m, "Fix the URL on the Settings page."); } }
    if (viewMode === 0) { add("info", "READ_ONLY", "Read-only view", "Changes to settings and drivers can't be saved to the report in reading view.", "Open the report in edit mode (or Desktop) to keep changes."); }
    return out;
}

export const worst = (is: Issue[]): Level | null => (is.some(i => i.level === "error") ? "error" : is.some(i => i.level === "warn") ? "warn" : is.length ? "info" : null);
