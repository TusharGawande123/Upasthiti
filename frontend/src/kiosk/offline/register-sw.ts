// Registers the gate's service worker (M4 spec §7 rule 13). Only the gate page calls this, and
// the worker's scope is /attendance, so the admin website is never controlled or cached by it.
// Development has no service worker (a stale cache would hide code changes).

export function registerGateServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  // After the page has loaded, so the worker never competes with the first paint of the gate.
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/attendance" }).catch(() => {
        // Without a worker the gate still works online; it just cannot reload offline.
      });
    },
    { once: true },
  );
}
