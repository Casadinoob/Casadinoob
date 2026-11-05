// Feeds deliberately broken inputs to the BUILT visual and prints the "Data health" findings + screenshots.
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
(async () => {
    const out = process.argv[2] || ".tmp/shots-health"; fs.mkdirSync(out, { recursive: true });
    const { generate } = await import("../scripts/sample-data.mjs");
    const base = generate({ days: 6 });
    const ALL = ["interval", "skill", "team", "level", "agent", "avatarUrl", "forecastVolume", "actualVolume", "forecastAht", "actualAht", "requiredFte", "scheduledFte", "serviceLevel", "adherence"];
    const mk = (roles, rows) => ({ columns: roles.map((r, i) => ({ displayName: r, index: i, roles: { [r]: true } })), rows: rows.map(r => roles.map(k => r[k])) });
    const R = base.map(r => ({ interval: new Date(r.t), skill: r.skill, team: r.team, level: r.level, agent: r.agent, avatarUrl: r.avatar, forecastVolume: r.fv, actualVolume: r.av, forecastAht: r.fa, actualAht: r.aa, requiredFte: r.rf, scheduledFte: r.sf, serviceLevel: r.sl, adherence: r.ad }));
    const clone = () => R.map(r => ({ ...r }));
    const scenarios = {
        "A-no-interval": { table: mk(["forecastVolume", "actualVolume"], clone()) },
        "B-dates-are-text": { table: mk(ALL, clone().map(r => ({ ...r, interval: "not a date" }))) },
        "C-date-only": { table: mk(ALL, clone().map(r => ({ ...r, interval: new Date(r.interval.getFullYear(), r.interval.getMonth(), r.interval.getDate()) }))) },
        "D-dirty": { table: mk(ALL, (() => { const x = clone(); x.forEach((r, i) => { if (i % 50 === 0) { r.forecastVolume = -5; } if (i % 40 === 0 && r.serviceLevel !== null) { r.serviceLevel = 540; } if (i % 70 === 0) { r.interval = null; } if (i % 60 === 0 && r.actualAht) { r.actualAht = 0; } if (r.agent && i % 30 === 0) { r.requiredFte = 2; } }); return x.concat(x.slice(0, 25)); })()) },
        "E-no-skill-team": { table: mk(["interval", "forecastVolume", "actualVolume", "requiredFte", "scheduledFte"], clone().filter(r => !r.agent)) , pages: true },
        "F-corrupt-store": { table: mk(ALL, clone()), objects: { store: { settingsJson: "{oops not json", driversJson: JSON.stringify([{ id: "1", name: "Bad", start: "2026-11-04T10:00", end: "2026-11-04T09:00", volPct: 20, ahtPct: 0, skills: ["Ghost Skill"] }, { id: "2", name: "Far away", start: "2030-01-01T00:00", end: "2030-01-02T00:00", volPct: 10, ahtPct: 0, skills: [], type: "Event" }, { nope: true }]) } }, page: "drivers" },
        "G-out-of-window": { table: mk(ALL, clone()), nav: 'prev', navTimes: 9 },
        "H-no-rows": { table: mk(ALL, []) }
    };
    const drop = path.resolve(".tmp/drop");
    const b = await chromium.launch();
    for (const [name, sc] of Object.entries(scenarios)) {
        const pg = await b.newPage({ viewport: { width: 1100, height: 700 } });
        const errs = []; pg.on("pageerror", e => errs.push(e.message));
        await pg.setContent(`<html><head><style>html,body{margin:0;height:100%}#v{position:absolute;inset:0}</style></head><body><div id="v"></div></body></html>`);
        await pg.addStyleTag({ path: path.join(drop, "visual.css") });
        await pg.evaluate(() => { window.powerbi = { visuals: { plugins: {} } }; });
        await pg.addScriptTag({ path: path.join(drop, "visual.js") });
        await pg.evaluate(({ table, objects }) => {
            const plugin = Object.values(window.powerbi.visuals.plugins)[0];
            const sel = { ids: [], getSelectionIds() { return this.ids; }, select(i) { this.ids = i; }, clear() { this.ids = []; } };
            const host = { createSelectionManager: () => sel, createSelectionIdBuilder: () => ({ withTable() { return this; }, createSelectionId() { return {}; } }), tooltipService: { show() {}, hide() {} }, persistProperties() {}, fetchMoreData() { return true; }, eventService: { renderingStarted() {}, renderingFinished() { window.__fin = true; }, renderingFailed(o, m) { window.__fail = m; } }, colorPalette: {}, hostCapabilities: {}, locale: "en-US" };
            window.__vis = plugin.create({ element: document.getElementById("v"), host });
            window.__vis.update({ dataViews: [{ table, metadata: { columns: [], objects } }], viewport: { width: 1100, height: 700 }, type: 2, viewMode: 1, operationKind: 0 });
        }, { table: sc.table, objects: sc.objects });
        if (sc.page) { await pg.click(`[data-act="page"][data-p="${sc.page}"]`); }
        if (sc.pages) { await pg.click('[data-act="page"][data-p="skills"]'); }
        if (sc.nav) { for (let i = 0; i < sc.navTimes; i++) { await pg.click(`[data-act="${sc.nav}"]`); } }
        await pg.waitForTimeout(200);
        const info = await pg.evaluate(() => ({ fail: window.__fail || null, banner: document.querySelector(".hb > button")?.innerText || null, issues: [...document.querySelectorAll("ul.iss li b")].map(x => x.innerText), card: document.querySelector("#pg .card h3")?.innerText || null, intradayDisabled: !!document.querySelector(".seg button.dis"), view: document.querySelector(".seg button.on")?.innerText || null }));
        console.log(name.padEnd(18), JSON.stringify(info), errs.length ? "JSERR " + errs.join(";") : "");
        await pg.screenshot({ path: path.join(out, name + ".png") }); await pg.close();
    }
    await b.close();
})();
