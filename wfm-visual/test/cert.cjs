// Exercises certification-related behaviour on the BUILT visual: high contrast, keyboard, context menu, multi-select, localisation, allowInteractions.
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
(async () => {
    const out = process.argv[2] || ".tmp/shots-cert"; fs.mkdirSync(out, { recursive: true });
    const { generate } = await import("../scripts/sample-data.mjs");
    const rows = generate({ days: 6 });
    const roles = ["interval", "skill", "team", "level", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht", "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"];
    const table = { columns: roles.map((r, i) => ({ displayName: r, index: i, roles: { [r]: true } })), rows: rows.map(r => [new Date(r.t), r.skill, r.team, r.level, r.agent, r.avatar, r.fv, r.av, r.fa, r.aa, r.rf, r.sf, r.sl, r.ad]) };
    const drop = path.resolve(".tmp/drop"); const b = await chromium.launch();
    const run = async (name, host, steps) => {
        const pg = await b.newPage({ viewport: { width: 1200, height: 820 } });
        const errs = []; pg.on("pageerror", e => errs.push(e.message));
        await pg.setContent(`<html><head><style>html,body{margin:0;height:100%}#v{position:absolute;inset:0}</style></head><body><div id="v"></div></body></html>`);
        await pg.addStyleTag({ path: path.join(drop, "visual.css") });
        await pg.evaluate(() => { window.powerbi = { visuals: { plugins: {} } }; });
        await pg.addScriptTag({ path: path.join(drop, "visual.js") });
        await pg.evaluate(({ table, host }) => {
            const plugin = Object.values(window.powerbi.visuals.plugins)[0];
            window.__log = []; const sel = { ids: [], getSelectionIds() { return this.ids; }, select(i) { this.ids = i; window.__log.push("select:" + i.length); }, clear() { this.ids = []; window.__log.push("clear"); }, showContextMenu(id, pos) { window.__log.push("ctx:" + JSON.stringify(pos)); } };
            const dict = host.dict || {};
            const h = { createSelectionManager: () => sel, createSelectionIdBuilder: () => ({ withTable() { return this; }, createSelectionId() { return {}; } }), tooltipService: { show() {}, hide() {} }, persistProperties() {}, fetchMoreData() { return true; },
                createLocalizationManager: () => ({ getDisplayName: k => dict[k] || k }), eventService: { renderingStarted() {}, renderingFinished() { window.__fin = true; }, renderingFailed(o, m) { window.__fail = m; } },
                colorPalette: { isHighContrast: !!host.hc, foreground: { value: "#ffffff" }, background: { value: "#000000" }, foregroundSelected: { value: "#ffff00" }, hyperlink: { value: "#00ffff" }, getColor: k => ({ value: host.hc ? "#ffffff" : "#" + (Array.from(k).reduce((a, c) => a + c.charCodeAt(0) * 7919, 0) % 0xffffff).toString(16).padStart(6, "0") }) },
                hostCapabilities: { allowInteractions: host.allowInteractions !== false }, locale: "en-US" };
            window.__vis = plugin.create({ element: document.getElementById("v"), host: h });
            window.__vis.update({ dataViews: [{ table, metadata: { columns: [], objects: undefined } }], viewport: { width: 1200, height: 820 }, type: 2, viewMode: 1, operationKind: 0 });
        }, { table, host });
        const res = await steps(pg);
        console.log(name.padEnd(22), JSON.stringify(res), errs.length ? "JSERR " + errs.join(";") : "");
        await pg.screenshot({ path: path.join(out, name + ".png") }); await pg.close();
    };
    await run("hc", { hc: true }, async pg => pg.evaluate(() => ({ hcClass: document.querySelector(".wfm").classList.contains("hc"), bg: getComputedStyle(document.querySelector(".wfm")).backgroundColor, ink: getComputedStyle(document.querySelector(".card")).borderTopColor })));
    await run("localised-fr", { dict: { Page_planning: "Planification", Page_skills: "Compétences & niveaux", View_daily: "Quotidien", KPI_accuracy: "Précision des prévisions", Chart_volume: "Volume · prévision vs réel", Health_title: "Qualité des données" } }, async pg => pg.evaluate(() => ({ tabs: [...document.querySelectorAll(".pages button")].map(x => x.innerText), kpi: document.querySelectorAll(".kpi .l")[1].innerText, view: [...document.querySelectorAll(".seg button")].map(x => x.innerText) })));
    await run("keyboard+select+ctx", {}, async pg => {
        const hits = await pg.evaluate(() => document.querySelectorAll('[data-chart="vol"] rect.hit').length);
        await pg.focus('[data-chart="vol"] rect.hit >> nth=2'); await pg.keyboard.press("ArrowRight");
        const focusedIdx = await pg.evaluate(() => [...document.querySelectorAll('[data-chart="vol"] rect.hit')].indexOf(document.activeElement));
        await pg.keyboard.press("Enter");
        const afterEnter = await pg.evaluate(() => window.__log.slice());
        await pg.keyboard.press("ArrowRight"); await pg.keyboard.down("Control"); await pg.click('[data-chart="vol"] rect.hit >> nth=6', { modifiers: ["Control"] }); await pg.keyboard.up("Control");
        const multi = await pg.evaluate(() => ({ dimmed: document.querySelectorAll('[data-chart="vol"] rect.dim').length, log: window.__log.slice() }));
        await pg.keyboard.press("Escape"); const cleared = await pg.evaluate(() => window.__log.slice(-1)[0]);
        await pg.click('[data-chart="vol"] rect.hit >> nth=1', { button: "right" }); const ctx = await pg.evaluate(() => window.__log.slice(-1)[0]);
        await pg.focus('[data-act="page"][data-p="skills"]'); await pg.keyboard.press("Enter");
        const page = await pg.evaluate(() => document.querySelector(".pages button.on").innerText);
        return { hits, focusedIdx, afterEnter, multi, cleared, ctx, page, tabindexOnRows: await pg.evaluate(() => document.querySelectorAll("tr[tabindex='0']").length) };
    });
    await run("no-interactions", { allowInteractions: false }, async pg => { await pg.click('[data-chart="vol"] rect.hit >> nth=2'); await pg.click('[data-chart="vol"] rect.hit >> nth=2', { button: "right" }); return pg.evaluate(() => ({ log: window.__log.slice() })); });
    await b.close();
})();
