// Renders the BUILT visual (.tmp/drop) in headless Chromium with a mock Power BI host and exercises every page.
// usage: node test/harness.cjs <outDir>
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
(async () => {
    const out = process.argv[2] || ".tmp/shots"; fs.mkdirSync(out, { recursive: true });
    const { generate } = await import("../scripts/sample-data.mjs");
    const rows = generate();
    const roles = ["interval", "skill", "team", "level", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht", "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"];
    const table = {
        columns: roles.map((r, i) => ({ displayName: r, index: i, roles: { [r]: true } })),
        rows: rows.map(r => [new Date(r.t.getTime()), r.skill, r.team, r.level, r.agent, r.avatar, r.fv, r.av, r.fa, r.aa, r.rf, r.sf, r.sl, r.ad])
    };
    const drop = path.resolve(".tmp/drop");
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const errs = []; pg.on("pageerror", e => errs.push("PAGEERROR " + e.message)); pg.on("console", m => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
    const posts = []; await pg.route("https://prod-00.westeurope.logic.azure.com/**", r => { posts.push(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ drivers: [{ id: "x1", name: "Loaded from endpoint", type: "Event", start: "2026-11-04T09:00", end: "2026-11-04T12:00", volPct: 15, ahtPct: 0, skills: [], status: "Confirmed", note: "" }] }) }); });
    await pg.setContent(`<html><head><style>html,body{margin:0;height:100%}#v{position:absolute;inset:0}</style></head><body><div id="v"></div></body></html>`);
    await pg.addStyleTag({ path: path.join(drop, "visual.css") });
    await pg.evaluate(() => { window.powerbi = { visuals: { plugins: {} } }; });
    await pg.addScriptTag({ path: path.join(drop, "visual.js") });
    await pg.evaluate(({ table }) => {
        const plugin = Object.values(window.powerbi.visuals.plugins)[0];
        const sel = { ids: [], getSelectionIds() { return this.ids; }, select(i) { this.ids = i; }, clear() { this.ids = []; } };
        window.__tips = []; window.__persist = []; window.__objects = undefined;
        const host = {
            createSelectionManager: () => sel,
            createSelectionIdBuilder: () => ({ withTable() { return this; }, createSelectionId() { return {}; } }),
            tooltipService: { show: t => window.__tips.push(t), hide() {} },
            persistProperties: c => { window.__persist.push(c); const p = c.merge[0]; window.__objects = { ...(window.__objects || {}), [p.objectName]: { ...((window.__objects || {})[p.objectName] || {}), ...p.properties } }; setTimeout(() => window.__upd(window.__objects), 0); },
            eventService: { renderingStarted() {}, renderingFinished() { window.__fin = (window.__fin || 0) + 1; }, renderingFailed(o, m) { window.__fail = m; } },
            colorPalette: {}, hostCapabilities: {}, locale: "en-US"
        };
        window.__vis = plugin.create({ element: document.getElementById("v"), host });
        window.__upd = (objects) => window.__vis.update({ dataViews: [{ table, metadata: { columns: [], objects } }], viewport: { width: 1280, height: 900 }, type: 2, viewMode: 1 });
        window.__upd(window.__objects);
    }, { table });
    const shot = async n => { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(out, n + ".png"), fullPage: false }); };
    const click = sel => pg.click(sel);
    await shot("1-planning");
    await click('[data-act="skillfilter"][data-skill="Billing"]'); await shot("2-planning-skill-filter");
    await click('[data-act="skillfilter"][data-skill=""]');
    await click('[data-act="page"][data-p="skills"]'); await shot("3-skills");
    await click('[data-act="page"][data-p="teams"]'); await shot("4-teams");
    await click('[data-act="sort"][data-k="sl"]'); await click('[data-act="teamfilter"][data-team="Team Beta"] >> nth=0'); await shot("5-teams-filtered");
    // drivers: create one
    await click('[data-act="page"][data-p="drivers"]'); await click('[data-act="drv-new"]');
    await pg.fill("#f-name", "Black Friday promo"); await pg.selectOption("#f-type", "Promotion"); await pg.fill("#f-vol", "35"); await pg.fill("#f-aht", "8");
    await pg.fill("#f-start", "2026-11-03T08:00"); await pg.fill("#f-end", "2026-11-04T20:00");
    await click('[data-act="drv-save"]');
    await click('[data-act="drv-new"]'); await pg.fill("#f-name", "System outage"); await pg.selectOption("#f-type", "Outage"); await pg.fill("#f-vol", "60");
    await pg.fill("#f-start", "2026-11-04T09:00"); await pg.fill("#f-end", "2026-11-04T11:00"); await pg.check('.f-skill[value="Tech Tier 2"]'); await click('[data-act="drv-save"]');
    await shot("6-drivers");
    await click('[data-act="page"][data-p="planning"]'); await shot("7-planning-with-drivers");
    // settings
    await click('[data-act="page"][data-p="settings"]');
    await pg.fill('input[data-s="root"][data-f="slTarget"]', "85"); await pg.press('input[data-s="root"][data-f="slTarget"]', "Tab");
    await pg.fill('input[data-s="team"][data-n="Team Alpha"][data-f="slTarget"]', "90"); await pg.press('input[data-s="team"][data-n="Team Alpha"][data-f="slTarget"]', "Tab");
    await pg.check('input[data-s="wb"][data-f="enabled"]'); await pg.fill('input[data-s="wb"][data-f="url"]', "https://prod-00.westeurope.logic.azure.com/workflows/abc/triggers/manual"); await pg.press('input[data-s="wb"][data-f="url"]', "Tab");
    await click('[data-act="wb-send"][data-kind="drivers"]'); await pg.waitForTimeout(400);
    await click('[data-act="wb-send"][data-kind="forecast"]'); await pg.waitForTimeout(400);
    await click('[data-act="wb-load"]'); await pg.waitForTimeout(500);
    await shot("8-settings");
    await click('[data-act="page"][data-p="teams"]'); await shot("9-teams-after-settings");
    const info = await pg.evaluate(() => ({ fail: window.__fail, persistCalls: window.__persist.length, store: Object.keys(window.__objects.store), drivers: JSON.parse(window.__objects.store.driversJson).map(d => d.name), slTarget: JSON.parse(window.__objects.store.settingsJson).slTarget, avatars: document.querySelectorAll(".av img").length }));
    info.posts = posts.map(p => { const j = JSON.parse(p); return { action: j.action, kind: j.kind, items: Array.isArray(j.payload) ? j.payload.length : "obj" }; });
    console.log(JSON.stringify(info, null, 1)); console.log(errs.length ? errs.join("\n") : "NO JS ERRORS");
    await b.close();
})();
