// Static scan of src/ for APIs that Microsoft certification rejects. Exits 1 on any hit.
import { readdirSync, readFileSync } from "node:fs";
const BAN = [
    [/\beval\s*\(/, "eval"], [/new\s+Function\s*\(/, "new Function"], [/\.innerHTML\s*=/, "innerHTML assignment"], [/\.outerHTML\s*=/, "outerHTML assignment"],
    [/insertAdjacentHTML/, "insertAdjacentHTML"], [/document\.write/, "document.write"], [/XMLHttpRequest/, "XMLHttpRequest"], [/\bfetch\s*\(/, "fetch"],
    [/WebSocket/, "WebSocket"], [/EventSource/, "EventSource"], [/sendBeacon/, "sendBeacon"], [/localStorage|sessionStorage|indexedDB/, "browser storage"],
    [/window\.open|location\.href\s*=|location\.assign/, "navigation"], [/set(Timeout|Interval)\s*\(\s*["'`]/, "string timer"], [/Math\.random/, "Math.random"],
    [/importScripts|new\s+Worker\s*\(/, "worker/importScripts"], [/<script/i, "script tag"], [/javascript:/i, "javascript: URL"], [/\bnavigator\.(clipboard|geolocation)/, "navigator API"]
];
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
let bad = 0;
for (const f of walk("src").filter(f => /\.(ts|less|css)$/.test(f))) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) { return; }
        for (const [re, name] of BAN) { if (re.test(line)) { console.error(`${f}:${i + 1}: banned (${name}): ${line.trim().slice(0, 100)}`); bad++; } }
    });
}
console.log(bad ? `scan: ${bad} problem(s)` : "scan: clean (no banned APIs in src/)");
process.exit(bad ? 1 : 0);
