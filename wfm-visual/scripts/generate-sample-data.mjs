import { writeFileSync } from "node:fs";
import { generate } from "./sample-data.mjs";
const p = n => String(n).padStart(2, "0");
const ts = t => `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`;
const q = v => (v === null || v === "" ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
const head = "Interval,Skill,Team,Level,Agent,AvatarUrl,ForecastVolume,ActualVolume,ForecastAHT,ActualAHT,RequiredFTE,ScheduledFTE,ServiceLevel,Adherence";
const body = generate().map(r => [ts(r.t), r.skill, r.team, r.level, r.agent, r.avatar, r.fv, r.av, r.fa, r.aa, r.rf, r.sf, r.sl, r.ad].map(q).join(","));
writeFileSync(new URL("../samples/wfm_intervals.csv", import.meta.url), [head, ...body].join("\n"));
console.log(`wrote ${body.length} rows`);
