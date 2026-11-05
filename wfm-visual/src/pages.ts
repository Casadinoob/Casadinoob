import { DimStat, CoverCell } from "./data";
import { Issue, checkUrl } from "./validate";
import { Driver, DRIVER_TYPES, DRIVER_COLORS, Settings, slTargetFor } from "./store";
import { esc, fmtN, fmt1, pct, spct, initials, safeImg, clamp, PALETTE, toLocalInput, MONTHS } from "./util";

export const skillColor = (s: Settings, name: string, i: number) => s.skills[name]?.color || PALETTE[i % PALETTE.length];
const levelColor = (s: Settings, name: string, i: number) => s.levels[name]?.color || PALETTE[(i + 3) % PALETTE.length];
const levelLabel = (s: Settings, name: string) => s.levels[name]?.label || name;

/** SL bar with target tick */
function slBar(v: number | null, target: number): string {
    if (v === null) { return `<span style="color:var(--muted)">–</span>`; }
    const c = v >= target ? "var(--ok)" : v >= target - 0.1 ? "var(--forecast)" : "var(--under)";
    return `<div class="slb"><span class="slv" style="color:${c}">${pct(v, 1)}</span><div class="bar sl"><i style="width:${clamp(v, 0, 1) * 100}%;background:${c}"></i><u style="left:${clamp(target, 0, 1) * 100}%"></u></div></div>`;
}
const gapCell = (g: number | null, tol: number) => g === null ? "<td>–</td>" : `<td class="${g < -tol ? "bad" : g > tol ? "over" : "good"}">${spct(g)}</td>`;
const avatar = (name: string, url: string) => { const u = safeImg(url); return `<div class="av sm">${u ? `<img src="${esc(u)}" data-init="${esc(initials(name))}" alt="">` : esc(initials(name))}</div>`; };
const covColor = (v: number | null, tol: number) => v === null ? ["var(--line)", 0.35] as const : v < -tol ? ["var(--under)", clamp(0.3 + (-v - tol) / 0.3, 0.3, 1)] as const : v > tol ? ["var(--over)", clamp(0.3 + (v - tol) / 0.4, 0.3, 1)] as const : ["var(--ok)", 0.55] as const;

// ------------------------------------------------------------------ Skills & levels
export interface SkillsCtx { skills: DimStat[]; levels: DimStat[]; cover: CoverCell[]; mix: Map<string, Map<string, number>>; settings: Settings; rangeLabel: string; }
export function skillsHtml(c: SkillsCtx): string {
    const S = c.settings, tol = S.staffingTolerance / 100;
    const vis = c.skills.filter(s => !S.skills[s.name]?.hidden).sort((a, b) => (S.skills[a.name]?.priority ?? 99) - (S.skills[b.name]?.priority ?? 99));
    const names = vis.map(s => s.name);
    const rows = vis.map((s, i) => `<tr data-act="skillfilter" data-skill="${esc(s.name)}" style="cursor:pointer" title="Open in Planning"><td><i class="sw" style="background:${skillColor(S, s.name, i)}"></i>${esc(s.name)}</td>
        <td>${fmtN(s.fvA)}</td><td>${fmtN(s.av)}</td><td class="${s.volVarPct === null ? "" : Math.abs(s.volVarPct) <= .05 ? "good" : "bad"}">${spct(s.volVarPct)}</td>
        <td>${pct(s.accuracy)}</td><td>${s.fa === null ? "–" : Math.round(s.fa)}</td><td>${s.aa === null ? "–" : Math.round(s.aa)}</td>
        <td class="slc">${slBar(s.sl, slTargetFor(S, "skill", s.name))}</td><td>${fmt1(s.rf)}</td><td>${fmt1(s.sf)}</td>${gapCell(s.gapPct, tol)}</tr>`).join("");
    const cover = c.cover.filter(x => names.includes(x.skill));
    const hrs: number[] = []; for (let h = S.heatFrom; h <= S.heatTo; h++) { hrs.push(h); }
    const lw = 96, cw = 100 / hrs.length;
    let heat = `<div class="cov"><div class="covrow hdr"><span style="width:${lw}px"></span>${hrs.map(h => `<span style="flex:1">${h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>`).join("")}</div>`;
    names.forEach(n => {
        heat += `<div class="covrow"><span class="nm" style="width:${lw}px">${esc(n)}</span>${hrs.map(h => {
            const x = cover.find(y => y.skill === n && y.hour === h)!; const [col, op] = covColor(x.v, tol);
            const tip = x.v === null ? "" : `data-tip="${esc(`${n} ${String(h).padStart(2, "0")}:00|Required FTE|${fmt1(x.rf)}|Scheduled FTE|${fmt1(x.sf)}|Gap|${spct(x.v)}`)}"`;
            return `<span class="cc" style="flex:1;background:${col};opacity:${op}" ${tip}></span>`;
        }).join("")}</div>`;
    });
    heat += `</div><div class="heatleg"><span>Understaffed</span><i style="background:var(--under)"></i><i style="background:var(--ok);opacity:.6"></i><i style="background:var(--over)"></i><span>Overstaffed</span></div>`;
    void cw;
    // level mix: stacked bars of avg scheduled FTE per skill by level
    const levelNames = Array.from(new Set(c.levels.map(l => l.name))).sort();
    let mix = "";
    const maxTot = Math.max(1, ...names.map(n => Array.from(c.mix.get(n)?.values() ?? []).reduce((a, b) => a + b, 0)));
    names.forEach(n => {
        const m = c.mix.get(n); if (!m) { return; }
        const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
        mix += `<div class="mixrow"><span class="nm">${esc(n)}</span><div class="mixbar" style="width:${(tot / maxTot) * 100}%">${levelNames.map((l, i) => { const v = m.get(l) ?? 0; return v > 0 ? `<i style="flex:${v};background:${levelColor(S, l, i)}" data-tip="${esc(`${n} · ${levelLabel(S, l)}|Avg scheduled FTE|${fmt1(v)}`)}"></i>` : ""; }).join("")}</div><span class="tot">${fmt1(tot)}</span></div>`;
    });
    const mixLegend = levelNames.map((l, i) => `<span><i class="sw" style="background:${levelColor(S, l, i)}"></i>${esc(levelLabel(S, l))}</span>`).join("");
    const lvlRows = c.levels.map((l, i) => `<tr><td><i class="sw" style="background:${levelColor(S, l.name, levelNames.indexOf(l.name))}"></i>${esc(levelLabel(S, l.name))}</td><td>${l.agents}</td><td>${fmt1(l.sf)}</td><td>${fmtN(l.handled)}</td><td>${l.aa === null ? "–" : Math.round(l.aa)}</td><td class="slc">${slBar(l.sl, slTargetFor(S, "agent"))}</td><td>${pct(l.ad)}</td></tr>`).join("");
    void levelColor;
    return `<div class="stack">
      <div class="card"><h3>Skill-based planning<span class="lg">${esc(c.rangeLabel)} · click a skill to open it in Planning</span></h3><div class="tbl"><table><thead><tr><th>Skill</th><th>Fcst vol</th><th>Act vol</th><th>Var</th><th>Accuracy</th><th>Fcst AHT</th><th>Act AHT</th><th>Service level (tick = target)</th><th>Req FTE</th><th>Sched FTE</th><th>Gap</th></tr></thead><tbody>${rows || `<tr><td colspan="11" class="empty">Add a Skill / Queue field to enable skill planning.</td></tr>`}</tbody></table></div></div>
      <div class="two"><div class="card"><h3>Coverage by skill &amp; hour<span class="lg">scheduled vs required</span></h3>${heat}</div>
      <div class="card"><h3>Level mix per skill<span class="lg">${mixLegend}</span></h3><div class="mix">${mix || `<div class="empty">Add Level and Agent fields (with Skill) to see level mix.</div>`}</div></div></div>
      <div class="card"><h3>Levels</h3><div class="tbl"><table><thead><tr><th>Level</th><th>Agents</th><th>Avg sched FTE</th><th>Handled</th><th>AHT</th><th>Service level</th><th>Adherence</th></tr></thead><tbody>${lvlRows || `<tr><td colspan="7" class="empty">No level data.</td></tr>`}</tbody></table></div></div></div>`;
}

// ------------------------------------------------------------------ Teams & agents
export interface TeamsCtx { teams: DimStat[]; agents: DimStat[]; teamFilter: string | null; sort: { k: string; dir: 1 | -1 }; settings: Settings; trend: string; trendLegend: string; rangeLabel: string; }
export function teamsHtml(c: TeamsCtx): string {
    const S = c.settings;
    const chips = [`<button data-act="teamfilter" data-team="" class="chip ${c.teamFilter ? "" : "on"}">All teams</button>`, ...c.teams.map(t => `<button data-act="teamfilter" data-team="${esc(t.name)}" class="chip ${c.teamFilter === t.name ? "on" : ""}">${esc(t.name)}</button>`)].join("");
    const trows = c.teams.map(t => `<tr data-act="teamfilter" data-team="${esc(t.name)}" style="cursor:pointer"><td>${esc(t.name)}</td><td>${t.agents}</td><td>${fmtN(t.handled)}</td><td>${t.aa === null ? "–" : Math.round(t.aa)}</td><td class="slc">${slBar(t.sl, slTargetFor(S, "team", t.name))}</td><td>${pct(t.ad)}</td><td>${fmt1(t.sf)}</td></tr>`).join("");
    const keyOf: Record<string, (a: DimStat) => number | string> = { name: a => a.name.toLowerCase(), team: a => a.team, level: a => a.level, handled: a => a.handled, aa: a => a.aa ?? -1, sl: a => a.sl ?? -1, ad: a => a.ad ?? -1 };
    const list = c.agents.filter(a => !c.teamFilter || a.team === c.teamFilter).sort((x, y) => {
        const f = keyOf[c.sort.k] || keyOf.sl; const a = f(x), b = f(y);
        return (a < b ? -1 : a > b ? 1 : 0) * c.sort.dir;
    }).slice(0, 300);
    const th = (k: string, l: string) => `<th data-act="sort" data-k="${k}" style="cursor:pointer">${l}${c.sort.k === k ? (c.sort.dir === 1 ? " ▲" : " ▼") : ""}</th>`;
    const arows = list.map(a => {
        const t = slTargetFor(S, "agent");
        return `<tr data-tip="${esc(`${a.name}|Team|${a.team || "–"}|Level|${levelLabel(S, a.level) || "–"}|Service level|${pct(a.sl)}|Adherence|${pct(a.ad)}`)}"><td><div class="agc">${avatar(a.name, a.avatar)}<span>${esc(a.name)}</span></div></td><td>${esc(a.team)}</td><td>${esc(levelLabel(S, a.level))}</td><td>${fmtN(a.handled)}</td><td>${a.aa === null ? "–" : Math.round(a.aa)}</td><td class="slc">${slBar(a.sl, t)}</td><td class="${a.ad === null ? "" : a.ad * 100 >= S.adherenceTarget ? "good" : "bad"}">${pct(a.ad)}</td></tr>`;
    }).join("");
    return `<div class="stack">
      <div class="card"><h3>Service level by team<span class="lg">${esc(c.rangeLabel)}</span></h3><div class="tbl"><table><thead><tr><th>Team</th><th>Agents</th><th>Handled</th><th>AHT</th><th>Service level (tick = target)</th><th>Adherence</th><th>Avg FTE</th></tr></thead><tbody>${trows || `<tr><td colspan="7" class="empty">Add Team and Agent fields to enable team SLA.</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Service level trend by team<span class="lg">${c.trendLegend}</span></h3><div class="chart" data-chart="teamtrend">${c.trend}</div></div>
      <div class="card"><h3>Service level by agent<span class="lg">${list.length} agents</span></h3><div class="chips">${chips}</div><div class="tbl tall"><table><thead><tr>${th("name", "Agent")}${th("team", "Team")}${th("level", "Level")}${th("handled", "Handled")}${th("aa", "AHT")}${th("sl", "Service level (tick = target)")}${th("ad", "Adherence")}</tr></thead><tbody>${arows || `<tr><td colspan="7" class="empty">No agent data.</td></tr>`}</tbody></table></div></div></div>`;
}

// ------------------------------------------------------------------ Drivers
export interface DriversCtx { drivers: Driver[]; editing: Driver | null; skills: string[]; settings: Settings; status: string; impact: Map<string, number>; }
export function driversHtml(c: DriversCtx): string {
    const e = c.editing;
    const timeline = driverTimeline(c.drivers);
    const rows = c.drivers.slice().sort((a, b) => a.start.localeCompare(b.start)).map(d => {
        const s = new Date(d.start), en = new Date(d.end);
        return `<tr data-act="drv-edit" data-id="${esc(d.id)}" style="cursor:pointer" class="${e?.id === d.id ? "sel" : ""}"><td><i class="sw" style="background:${DRIVER_COLORS[d.type]}"></i>${esc(d.name)}</td><td>${esc(d.type)}</td><td>${s.getDate()} ${MONTHS[s.getMonth()]} ${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")} → ${en.getDate()} ${MONTHS[en.getMonth()]} ${String(en.getHours()).padStart(2, "0")}:${String(en.getMinutes()).padStart(2, "0")}</td><td class="${d.volPct > 0 ? "bad" : d.volPct < 0 ? "over" : ""}">${d.volPct > 0 ? "+" : ""}${d.volPct}%</td><td>${d.ahtPct > 0 ? "+" : ""}${d.ahtPct}%</td><td>${d.skills.length ? esc(d.skills.join(", ")) : "All"}</td><td>${esc(d.status)}</td><td>${c.impact.get(d.id) !== undefined ? "+" + fmtN(c.impact.get(d.id)!) : "–"}</td></tr>`;
    }).join("");
    const f = (k: keyof Driver) => esc(e ? String((e as any)[k] ?? "") : "");
    const form = e ? `<div class="form" data-form="driver">
        <label>Name<input id="f-name" value="${f("name")}" placeholder="e.g. Black Friday promo"></label>
        <label>Type<select id="f-type">${DRIVER_TYPES.map(t => `<option ${e.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Start<input id="f-start" type="datetime-local" value="${toLocalInput(new Date(e.start))}"></label>
        <label>End<input id="f-end" type="datetime-local" value="${toLocalInput(new Date(e.end))}"></label>
        <label>Volume impact %<input id="f-vol" type="number" step="1" value="${e.volPct}"></label>
        <label>AHT impact %<input id="f-aht" type="number" step="1" value="${e.ahtPct}"></label>
        <label>Status<select id="f-status"><option ${e.status === "Planned" ? "selected" : ""}>Planned</option><option ${e.status === "Confirmed" ? "selected" : ""}>Confirmed</option></select></label>
        <label class="wide">Applies to skills <span class="hint">(none ticked = all)</span><div class="chk">${c.skills.map(s => `<label><input type="checkbox" class="f-skill" value="${esc(s)}" ${e.skills.includes(s) ? "checked" : ""}>${esc(s)}</label>`).join("") || `<em>No skills in data</em>`}</div></label>
        <label class="wide">Note<input id="f-note" value="${f("note")}" placeholder="Optional"></label>
        <div class="btns wide"><button class="btn pri" data-act="drv-save">Save driver</button><button class="btn" data-act="drv-dup">Duplicate</button><button class="btn dng" data-act="drv-del">Delete</button><button class="btn" data-act="drv-cancel">Close</button></div></div>` : "";
    return `<div class="stack">
      <div class="card"><h3>Demand drivers<span class="lg">events · promotions · holidays · outages <button class="btn pri" data-act="drv-new">+ New driver</button></span></h3>
        <p class="hint">Drivers adjust the <b>forecast volume, AHT and required FTE</b> for the intervals they cover. Actuals are never changed. Turn "Apply drivers" off in Settings to see the baseline.</p>${timeline}</div>
      <div class="card"><h3>Driver list<span class="lg">${esc(c.status)}</span></h3><div class="tbl"><table><thead><tr><th>Driver</th><th>Type</th><th>Period</th><th>Volume</th><th>AHT</th><th>Skills</th><th>Status</th><th>Extra contacts (in data)</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty">No drivers yet. Click “New driver”.</td></tr>`}</tbody></table></div>${form}</div></div>`;
}

function driverTimeline(ds: Driver[]): string {
    if (!ds.length) { return ""; }
    const t0 = Math.min(...ds.map(d => new Date(d.start).getTime())) - 3 * 864e5, t1 = Math.max(...ds.map(d => new Date(d.end).getTime())) + 3 * 864e5;
    const span = Math.max(t1 - t0, 14 * 864e5), W = 1000, L = 150, rowH = 22, H = 22 + ds.length * rowH + 4;
    const x = (t: number) => L + ((t - t0) / span) * (W - L - 40);
    let s = "";
    const days = Math.ceil(span / 864e5), step = Math.max(1, Math.ceil(days / 14));
    for (let i = 0; i <= days; i += step) { const t = t0 + i * 864e5, d = new Date(t); s += `<line class="grid-l" x1="${x(t)}" x2="${x(t)}" y1="14" y2="${H}"/><text x="${x(t)}" y="10" text-anchor="middle">${d.getDate()} ${MONTHS[d.getMonth()]}</text>`; }
    ds.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach((d, i) => {
        const y = 20 + i * rowH, a = x(new Date(d.start).getTime()), b = Math.max(a + 4, x(new Date(d.end).getTime()));
        s += `<text x="${L - 8}" y="${y + 13}" text-anchor="end">${esc(d.name.length > 22 ? d.name.slice(0, 21) + "…" : d.name)}</text><rect x="${a}" y="${y + 2}" width="${b - a}" height="14" rx="3" fill="${DRIVER_COLORS[d.type]}" opacity="${d.status === "Confirmed" ? 0.95 : 0.55}" data-act="drv-edit" data-id="${esc(d.id)}" data-tip="${esc(`${d.name}|Type|${d.type}|Volume|${d.volPct > 0 ? "+" : ""}${d.volPct}%|AHT|${d.ahtPct > 0 ? "+" : ""}${d.ahtPct}%|Status|${d.status}`)}" style="cursor:pointer"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none">${s}</svg>`;
}

// ------------------------------------------------------------------ Settings
export interface SettingsCtx { settings: Settings; skills: string[]; teams: string[]; levels: string[]; status: string; hasStore: boolean; issues: Issue[]; summary: string[]; }
export function settingsHtml(c: SettingsCtx): string {
    const S = c.settings;
    const num = (f: string, v: number | null, w = 90, ph = "") => `<input type="number" data-s="root" data-f="${f}" value="${v ?? ""}" placeholder="${ph}" style="width:${w}px">`;
    const tgt = (kind: string, n: string, v: number | null | undefined) => `<input type="number" min="0" max="100" data-s="${kind}" data-n="${esc(n)}" data-f="slTarget" value="${v ?? ""}" placeholder="default" style="width:90px">`;
    const skills = c.skills.map((n, i) => `<tr><td>${esc(n)}</td><td><input type="color" data-s="skill" data-n="${esc(n)}" data-f="color" value="${esc(S.skills[n]?.color || PALETTE[i % PALETTE.length])}"></td><td>${tgt("skill", n, S.skills[n]?.slTarget)}</td><td><input type="number" data-s="skill" data-n="${esc(n)}" data-f="priority" value="${S.skills[n]?.priority ?? ""}" placeholder="–" style="width:70px"></td><td><input type="checkbox" data-s="skill" data-n="${esc(n)}" data-f="hidden" ${S.skills[n]?.hidden ? "checked" : ""}></td></tr>`).join("");
    const teams = c.teams.map(n => `<tr><td>${esc(n)}</td><td>${tgt("team", n, S.teams[n]?.slTarget)}</td></tr>`).join("");
    const levels = c.levels.map((n, i) => `<tr><td>${esc(n)}</td><td><input data-s="level" data-n="${esc(n)}" data-f="label" value="${esc(S.levels[n]?.label || "")}" placeholder="${esc(n)}" style="width:140px"></td><td><input type="color" data-s="level" data-n="${esc(n)}" data-f="color" value="${esc(S.levels[n]?.color || PALETTE[(i + 3) % PALETTE.length])}"></td></tr>`).join("");
    const wb = S.writeBack;
    return `<div class="stack">
      ${c.status.startsWith("⚠") ? `<div class="card warn">${esc(c.status)}</div>` : ""}
      ${c.hasStore ? "" : `<div class="card warn">Settings are stored in the report file. Changes made in a read-only view may not be kept — open the report in edit mode (or Desktop) to save.</div>`}
      <div class="two"><div class="card"><h3>Targets</h3><div class="form">
        <label>Service level target %${num("slTarget", S.slTarget)}</label>
        <label>SL threshold (sec) <span class="hint">label only</span>${num("slThresholdSec", S.slThresholdSec)}</label>
        <label>Agent SL target % <span class="hint">blank = same as global</span>${num("agentSlTarget", S.agentSlTarget, 90, "global")}</label>
        <label>Forecast accuracy target %${num("accuracyTarget", S.accuracyTarget)}</label>
        <label>Adherence target %${num("adherenceTarget", S.adherenceTarget)}</label>
        <label>Staffing tolerance ± %${num("staffingTolerance", S.staffingTolerance)}</label>
        <label>Heatmap from hour${num("heatFrom", S.heatFrom, 70)}</label>
        <label>Heatmap to hour${num("heatTo", S.heatTo, 70)}</label>
        <label class="wide"><span><input type="checkbox" data-s="root" data-f="applyDrivers" ${S.applyDrivers ? "checked" : ""}> Apply drivers to forecast &amp; required FTE</span></label></div></div>
      <div class="card"><h3>Write-back</h3><div class="form">
        <label class="wide"><span><input type="checkbox" data-s="wb" data-f="enabled" ${wb.enabled ? "checked" : ""}> Enable write-back to my endpoint</span></label>
        <label class="wide">Endpoint URL (https)<input data-s="wb" data-f="url" value="${esc(wb.url)}" placeholder="https://prod-00.westeurope.logic.azure.com/workflows/…">${wb.url && checkUrl(wb.url) ? `<span class="fld-err">${esc(checkUrl(wb.url)!)}</span>` : ""}</label>
        <label class="wide"><span><input type="checkbox" data-s="wb" data-f="autoSend" ${wb.autoSend ? "checked" : ""}> Send automatically whenever I save a driver or setting</span></label>
        <div class="btns wide"><button class="btn" data-act="wb-send" data-kind="settings">Send settings</button><button class="btn" data-act="wb-send" data-kind="drivers">Send drivers</button><button class="btn" data-act="wb-send" data-kind="forecast">Send adjusted forecast</button><button class="btn" data-act="wb-load">Load from endpoint</button></div>
        <p class="hint wide">${esc(c.status) || "Settings and drivers are always saved inside the report. The endpoint is optional and lets you also store them in your own system."}</p></div></div></div>
      <div class="two"><div class="card"><h3>Skills</h3><div class="tbl"><table><thead><tr><th>Skill</th><th>Color</th><th>SL target %</th><th>Priority</th><th>Hide</th></tr></thead><tbody>${skills || `<tr><td colspan="5" class="empty">No skills in data</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Teams</h3><div class="tbl"><table><thead><tr><th>Team</th><th>SL target %</th></tr></thead><tbody>${teams || `<tr><td colspan="2" class="empty">No teams in data</td></tr>`}</tbody></table></div>
      <h3 style="margin-top:12px">Levels</h3><div class="tbl"><table><thead><tr><th>Level</th><th>Display name</th><th>Color</th></tr></thead><tbody>${levels || `<tr><td colspan="3" class="empty">No levels in data</td></tr>`}</tbody></table></div></div></div>
      <div class="card"><h3>Data health<span class="lg">${c.issues.length ? `${c.issues.length} item(s)` : "all good"}</span></h3>${c.issues.length ? issuesHtml(c.issues) : `<p class="hint">No problems detected.</p>`}<ul class="sum">${c.summary.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="btns"><button class="btn dng" data-act="reset">Reset all settings</button></div></div>`;
}

export function issuesHtml(is: Issue[]): string {
    const ic = { error: "⛔", warn: "⚠️", info: "ℹ️" };
    return `<ul class="iss">${is.map(i => `<li class="${i.level}"><span class="ico">${ic[i.level]}</span><div><b>${esc(i.title)}</b> — ${esc(i.detail)}${i.fix ? `<div class="fix">How to fix: ${esc(i.fix)}</div>` : ""}</div></li>`).join("")}</ul>`;
}
