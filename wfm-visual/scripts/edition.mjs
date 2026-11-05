// Builds a .pbiviz edition and restores the working tree afterwards.
//   node scripts/edition.mjs certified   -> no network code, no privileges (AppSource certification)
//   node scripts/edition.mjs writeback   -> real net.ts + WebAccess privilege, separate GUID/name (non-certified)
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const edition = process.argv[2];
if (!["certified", "writeback"].includes(edition)) { console.error("usage: edition.mjs certified|writeback"); process.exit(2); }
const files = ["src/net.ts", "capabilities.json", "pbiviz.json"];
const backup = Object.fromEntries(files.map(f => [f, readFileSync(f, "utf8")]));
try {
    if (edition === "writeback") {
        copyFileSync("editions/writeback/net.ts", "src/net.ts");
        const cap = JSON.parse(backup["capabilities.json"]);
        cap.privileges = [{ name: "WebAccess", essential: false, parameters: ["https://*.logic.azure.com", "https://*.api.powerplatform.com", "https://*.azurewebsites.net", "https://*.azure-api.net"] }];
        writeFileSync("capabilities.json", JSON.stringify(cap, null, 2));
        const pv = JSON.parse(backup["pbiviz.json"]);
        pv.visual.guid = "wfmCommandCenterWB" + pv.visual.guid.slice(-14);
        pv.visual.name = "wfmCommandCenterWriteBack";
        pv.visual.displayName = pv.visual.displayName + " (Write-back)";
        writeFileSync("pbiviz.json", JSON.stringify(pv, null, 2));
    }
    rmSync("dist", { recursive: true, force: true });
    execSync("npx pbiviz package", { stdio: "inherit" });
    mkdirSync("releases", { recursive: true });
    for (const f of readdirSync("dist").filter(f => f.endsWith(".pbiviz"))) { copyFileSync(`dist/${f}`, `releases/${f}`); console.log(`-> releases/${f}`); }
} finally {
    for (const f of files) { writeFileSync(f, backup[f]); }
}
