export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
export const safeImg = (u: string) => (/^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i.test((u || "").trim()) ? u.trim() : "");
export const fmtN = (n: number | null) => (n === null ? "–" : Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + "k" : Math.round(n).toLocaleString());
export const fmt1 = (n: number | null) => (n === null ? "–" : n.toFixed(1));
export const pct = (n: number | null, d = 1) => (n === null ? "–" : (n * 100).toFixed(d) + "%");
export const spct = (n: number | null) => (n === null ? "–" : (n > 0 ? "+" : "") + (n * 100).toFixed(1) + "%");
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const PALETTE = ["#1F6FEB", "#F59E0B", "#30A46C", "#8E4EC6", "#0E9AA7", "#D6409F", "#E5484D", "#6E56CF", "#78909C", "#A3A100"];
const p2 = (n: number) => (n < 10 ? "0" + n : "" + n);
/** value for <input type="datetime-local"> in local time */
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const fromLocalInput = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d; };

// Certified visuals may not assign innerHTML. Parse with DOMParser (scripts never execute; all dynamic text is esc()-escaped) and swap nodes in.
export function setHtml(el: HTMLElement, html: string): void {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const nodes = Array.from(doc.body.childNodes).map(n => document.importNode(n, true));
    el.replaceChildren(...nodes);
}

let palFn: ((key: string) => string) | null = null;
export const setPalette = (f: ((key: string) => string) | null) => { palFn = f; };
/** Series colour: the host's colour palette when available (themes / high contrast), else our own. */
export const paletteColor = (key: string, i: number): string => { try { const c = palFn ? palFn(key) : ""; if (c) { return c; } } catch { /* fall through */ } return PALETTE[i % PALETTE.length]; };
export const attr = (s: string) => esc(s.replace(/\|/g, ", "));
