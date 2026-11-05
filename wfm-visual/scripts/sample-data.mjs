// Deterministic synthetic WFM interval data. Used by the CSV generator and the render harness.
export function generate({ days = 28, end = new Date(2026, 10, 4), partialLastDayHour = 14 } = {}) {
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const queues = [{ n: "Support EN", base: 1.0, aht: 360 }, { n: "Billing", base: 0.55, aht: 480 }];
    const agents = ["Amira Haddad", "Ben Carter", "Chloe Nguyen", "Dmitri Ivanov", "Elena Rossi", "Farah Khan", "Giorgio Bianchi", "Hana Sato"];
    const palette = ["#1F6FEB", "#E5484D", "#30A46C", "#F59E0B", "#8E4EC6", "#0E9AA7", "#D6409F", "#6E56CF"];
    const avatar = (name, i) => {
        const ini = name.split(" ").map(w => w[0]).join("");
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='${palette[i % 8]}'/><circle cx='32' cy='25' r='11' fill='rgba(255,255,255,.85)'/><ellipse cx='32' cy='56' rx='19' ry='15' fill='rgba(255,255,255,.85)'/><text x='32' y='38' font-size='0' >${ini}</text></svg>`;
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    };
    const rows = [];
    for (let d = days - 1; d >= 0; d--) {
        const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - d);
        const dow = day.getDay();
        const dayF = dow === 0 ? 0.55 : dow === 6 ? 0.7 : dow === 1 ? 1.15 : 1;
        for (let m = 7 * 60; m < 21 * 60; m += 30) {
            const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
            const hr = m / 60;
            const shape = Math.exp(-Math.pow((hr - 10.5) / 2.2, 2)) * 0.8 + Math.exp(-Math.pow((hr - 15.5) / 2.6, 2)) * 0.6 + 0.08;
            const future = d === 0 && hr >= partialLastDayHour;
            for (const q of queues) {
                const fv = Math.round(shape * 60 * q.base * dayF);
                const fa = q.aht;
                const av = future ? null : Math.max(0, Math.round(fv * (0.88 + rnd() * 0.26)));
                const aa = future ? null : Math.round(fa * (0.93 + rnd() * 0.16));
                const rf = +(fv * fa / 1800 / 0.85).toFixed(2);
                const sched = +(rf * (0.8 + rnd() * 0.45)).toFixed(2);
                const slv = future ? null : +Math.min(1, Math.max(0.4, 0.82 + (sched - rf) / Math.max(rf, 1) * 0.9 + (rnd() - 0.5) * 0.08)).toFixed(3);
                rows.push({ t, queue: q.n, agent: "", avatar: "", fv, av, fa, aa, rf, sf: sched, sl: slv, ad: null });
            }
        }
    }
    // Agent-grain rows carry adherence only (avoid double counting queue-grain measures).
    agents.forEach((a, i) => {
        for (let d = days - 1; d >= 0; d--) {
            const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - d);
            for (let m = 9 * 60; m < 17 * 60; m += 30) {
                if (d === 0 && m / 60 >= partialLastDayHour) { continue; }
                const base = 0.97 - i * 0.025;
                rows.push({ t: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m), queue: "", agent: a, avatar: avatar(a, i), fv: null, av: null, fa: null, aa: null, rf: null, sf: null, sl: null, ad: +(Math.min(1, base + (rnd() - 0.5) * 0.06)).toFixed(3) });
            }
        }
    });
    return rows;
}
