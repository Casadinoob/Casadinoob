// Deterministic synthetic WFM data at AGENT grain.
//  - "plan" rows  (agent blank): interval x skill with forecast volume/AHT and required FTE
//  - "agent" rows (agent set)  : interval x agent with handled volume, AHT, scheduled FTE (=1 when on shift), SL and adherence
// Totals (volume, FTE, SL) therefore add up correctly in the visual with no double counting.
export function generate({ days = 28, end = new Date(2026, 10, 4), partialLastDayHour = 14 } = {}) {
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const skills = [{ n: "Support EN", base: 1.0, aht: 360 }, { n: "Billing", base: 0.7, aht: 480 }, { n: "Tech Tier 2", base: 0.45, aht: 600 }];
    const teams = ["Team Alpha", "Team Beta", "Team Gamma"];
    const names = ["Amira Haddad", "Ben Carter", "Chloe Nguyen", "Dmitri Ivanov", "Elena Rossi", "Farah Khan", "Giorgio Bianchi", "Hana Sato", "Ivan Petrov",
        "Jada Brooks", "Kenji Mori", "Lena Fischer", "Mateo Silva", "Nora Eriksen", "Omar Aziz", "Priya Nair", "Quinn Murphy", "Rosa Delgado"];
    const levels = ["L1", "L2", "L3"];
    const palette = ["#1F6FEB", "#E5484D", "#30A46C", "#F59E0B", "#8E4EC6", "#0E9AA7", "#D6409F", "#6E56CF", "#3E63DD"];
    const avatar = i => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='${palette[i % 9]}'/><circle cx='32' cy='25' r='11' fill='rgba(255,255,255,.85)'/><ellipse cx='32' cy='56' rx='19' ry='15' fill='rgba(255,255,255,.85)'/></svg>`);
    const shifts = [[7, 15], [10, 18], [13, 21]];
    const agents = names.map((n, i) => ({ n, i, skill: skills[i % 3].n, team: teams[Math.floor(i / 6)], level: levels[(i * 7 + Math.floor(i / 3)) % 3], shift: shifts[Math.floor(i / 3) % 3], off: [i % 7, (i + 3) % 7], skillAdh: 0.97 - (i % 6) * 0.02, skillSl: 0.88 - ((i * 5) % 7) * 0.025 }));
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
            for (const sk of skills) {
                const fv = Math.round(shape * 22 * sk.base * dayF);
                const rf = +(fv * sk.aht / 1800 / 0.85).toFixed(2);
                const on = agents.filter(a => a.skill === sk.n && !a.off.includes(dow) && hr >= a.shift[0] && hr < a.shift[1]);
                const actual = future ? 0 : Math.max(0, Math.round(fv * (0.88 + rnd() * 0.26)));
                rows.push({ t, skill: sk.n, team: "", level: "", agent: "", avatar: "", fv, av: on.length || future ? null : actual, fa: sk.aht, aa: null, rf, sf: null, sl: on.length || future ? null : 0.45, ad: null });
                if (future) { continue; }
                // split handled volume between agents on shift
                let left = actual;
                on.forEach((a, k) => {
                    const share = k === on.length - 1 ? left : Math.min(left, Math.round(actual / on.length + (rnd() - 0.5) * 2));
                    left -= share;
                    const pressure = Math.max(0, (rf - on.length) / Math.max(rf, 1));          // understaffed -> lower SL
                    const sl = Math.min(1, Math.max(0.35, a.skillSl + 0.06 - pressure * 0.5 + (rnd() - 0.5) * 0.08));
                    rows.push({ t, skill: sk.n, team: a.team, level: a.level, agent: a.n, avatar: avatar(a.i), fv: null, av: Math.max(0, share), fa: null, aa: Math.round(sk.aht * (0.88 + (a.level === "L1" ? 0.14 : a.level === "L3" ? -0.04 : 0.02) + rnd() * 0.1)), rf: null, sf: 1, sl: +sl.toFixed(3), ad: +Math.min(1, a.skillAdh + (rnd() - 0.5) * 0.06).toFixed(3) });
                });
            }
        }
    }
    return rows;
}
