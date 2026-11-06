// Types for scripts/test-run-lock.mjs (used by the Playwright global setup).
export const LOCK_FILE: string;
export const REFUSAL_TEXT: string;
export function isProcessAlive(pid: number): boolean;
export class RunLock {
  constructor(kind: string, options?: { path?: string; pid?: number });
  acquire(waitMs?: number): Promise<void>;
  release(): Promise<void>;
}
