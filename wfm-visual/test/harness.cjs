// Renders the BUILT visual (.tmp/drop) in headless Chromium with a mock Power BI host.
// usage: node test/harness.cjs <outDir>
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
(async () => {
    const out = process.argv[2] || ".tmp/shots"; fs.mkdirSync(out, { recursive: true });
    const { generate } = await import("../scripts/sample-data.mjs");
    const rows = generate();
    const roles = ["interval", "queue", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht", "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"];
    const table = {
        columns: roles.map((r, i) => ({ displayName: r, index: i, roles: { [r]: true } })),
        rows: rows.map(r => [r.t.toISOString(), r.queue, r.agent, r.avatar, r.fv, r.av, r.fa, r.aa, r.rf, r.sf, r.sl, r.ad])
    };
    // interval arrives as Date in real hosts
    table.rows.forEach((r, i) => { r[0] = new Date(rows[i].t.getTime()); });
    const drop = path.resolve(".tmp/drop");
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const errs = []; pg.on("pageerror", e => errs.push("PAGEERROR " + e.message)); pg.on("console", m => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
    await pg.setContent(`<html><head><style>html,body{margin:0;height:100%}#v{position:absolute;inset:0}</style></head><body><div id="v"></div></body></html>`);
    await pg.addStyleTag({ path: path.join(drop, "visual.css") });
    await pg.evaluate(() => { window.powerbi = { visuals: { plugins: {} } }; });
    await pg.addScriptTag({ path: path.join(drop, "visual.js") });
    const api = (obj) => `(() => { const o = ${obj}; return o; })()`;
    await pg.evaluate(({ table, dark }) => {
        const plugin = Object.values(window.powerbi.visuals.plugins)[0];
        const sel = { ids: [], getSelectionIds() { return this.ids; }, select(i) { this.ids = i; }, clear() { this.ids = []; } };
        window.__tips = [];
        const host = {
            createSelectionManager: () => sel,
            createSelectionIdBuilder: () => ({ withTable() { return this; }, createSelectionId() { return {}; } }),
            tooltipService: { show: t => window.__tips.push(t), hide() {} },
            eventService: { renderingStarted() {}, renderingFinished() { window.__fin = (window.__fin || 0) + 1; }, renderingFailed(o, m) { window.__fail = m; } },
            colorPalette: {}, hostCapabilities: {}, locale: "en-US"
        };
        window.__vis = plugin.create({ element: document.getElementById("v"), host });
        window.__upd = (objects) => window.__vis.update({ dataViews: [{ table, metadata: { columns: [], objects } }], viewport: { width: 1280, height: 900 }, type: 2, viewMode: 1 });
        window.__upd(undefined);
    }, { table });
    const shot = async n => { await pg.waitForTimeout(150); await pg.screenshot({ path: path.join(out, n + ".png"), fullPage: false }); };
    await shot("1-intraday");
    await pg.click('[data-act="view"][data-v="daily"]'); await shot("2-daily");
    await pg.click('[data-act="view"][data-v="weekly"]'); await shot("3-weekly");
    await pg.click('[data-act="view"][data-v="intraday"]'); await pg.click('[data-act="prev"]');
    await pg.click('[data-chart="vol"] rect.hit >> nth=6'); await shot("4-intraday-prevday-selected");
    await pg.hover('[data-chart="staff"] rect.hit >> nth=5');
    await pg.evaluate(() => window.__upd({ general: { theme: "dark", defaultView: "daily" } })); await shot("5-dark-daily");
    const info = await pg.evaluate(() => ({ fin: window.__fin, fail: window.__fail, tips: window.__tips.length, kpis: [...document.querySelectorAll(".kpi")].map(k => k.innerText.replace(/\n/g, " | ")), avatars: document.querySelectorAll(".av img").length, font: getComputedStyle(document.querySelector(".wfm")).fontFamily }));
    console.log(JSON.stringify(info, null, 1)); console.log(errs.length ? errs.join("\n") : "NO JS ERRORS");
    await b.close();
})();
