// Can this browser do what phone attendance needs? A camera and a location reading. Chrome and
// Edge on a phone can; an old or in-app browser may not (spec M4b §9 PHONE_BROWSER_UNSUPPORTED).

export function phoneBrowserSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && "geolocation" in navigator;
}
