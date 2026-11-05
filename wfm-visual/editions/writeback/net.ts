// WRITE-BACK EDITION ONLY. Copied over src/net.ts by scripts/edition.mjs when building the non-certified edition.
// Certified (AppSource) builds use the stub in src/net.ts, which contains no network code.
import { checkUrl } from "./validate";

export const WRITE_BACK_AVAILABLE = true;
export interface WriteBackResult { ok: boolean; message: string; data?: any; }
const SCHEMA = "wfm-command-center/1";

/** POSTs JSON to the configured endpoint. Uses a "simple" request (text/plain, no-cors) so no CORS preflight is needed; the response is opaque. */
export async function sendWriteBack(url: string, kind: string, payload: unknown): Promise<WriteBackResult> {
    const bad = checkUrl(url); if (bad) { return { ok: false, message: bad }; }
    try {
        await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "save", kind, sentAt: new Date().toISOString(), payload }) });
        return { ok: true, message: `Sent ${kind} (response is opaque in no-cors mode; confirm in your flow run history)` };
    } catch (e) { return { ok: false, message: "Send failed — the request was blocked or the network is unreachable. Check the URL, that your tenant allows this visual to call external services, and that you are online." }; }
}

/** Loads {settings?, drivers?} from the endpoint. Requires the endpoint to answer CORS requests. */
export async function loadWriteBack(url: string): Promise<WriteBackResult> {
    const bad = checkUrl(url); if (bad) { return { ok: false, message: bad }; }
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ schema: SCHEMA, action: "load" }) });
        if (!res.ok) { return { ok: false, message: `Load failed: the endpoint answered HTTP ${res.status}.` }; }
        let data: unknown; try { data = await res.json(); } catch { return { ok: false, message: "Load failed: the endpoint did not return valid JSON. Expected { settings?, drivers? }." }; }
        if (!data || typeof data !== "object") { return { ok: false, message: "Load failed: expected a JSON object { settings?, drivers? }." }; }
        return { ok: true, message: "Loaded from endpoint", data };
    } catch (e) { return { ok: false, message: "Load failed — most likely the endpoint does not return CORS headers (Power Automate triggers often do not). Put an Azure Function / API Management in front, or use Send only." }; }
}
