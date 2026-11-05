// Certified edition: this build makes NO network calls. (The write-back edition swaps in editions/writeback/net.ts.)
export const WRITE_BACK_AVAILABLE = false;
export interface WriteBackResult { ok: boolean; message: string; data?: any; }
const NA: WriteBackResult = { ok: false, message: "Write-back is not available in this edition. Settings and drivers are saved inside the report." };
export function sendWriteBack(_url: string, _kind: string, _payload: unknown): Promise<WriteBackResult> { return Promise.resolve(NA); }
export function loadWriteBack(_url: string): Promise<WriteBackResult> { return Promise.resolve(NA); }
