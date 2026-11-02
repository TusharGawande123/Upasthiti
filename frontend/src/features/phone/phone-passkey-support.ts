// Passkeys (F-80, WebAuthn) in the phone's browser. The server sends options as JSON with
// base64url text; the browser wants byte arrays, and the server wants text back. These small
// converters do that. Only a phone's own screen lock is used ("platform" authenticator).

type Json = Record<string, unknown>;

export class PasskeyCancelled extends Error {
  constructor() {
    super("PASSKEY_CANCELLED");
    this.name = "PasskeyCancelled";
  }
}

export function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): ArrayBuffer {
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** True when this browser can use the phone's own screen lock as a passkey. */
export async function passkeysSupported(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === "undefined") return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function withDecodedIds(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((item: Json) => ({ ...item, id: fromBase64Url(String(item.id)) }));
}

function decodeCreation(options: Json): PublicKeyCredentialCreationOptions {
  const user = options.user as Json;
  return {
    ...options,
    challenge: fromBase64Url(String(options.challenge)),
    user: { ...user, id: fromBase64Url(String(user.id)) },
    excludeCredentials: withDecodedIds(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function decodeRequest(options: Json): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: fromBase64Url(String(options.challenge)),
    allowCredentials: withDecodedIds(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
}

function encodeCredential(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  const encoded: Json = { clientDataJSON: toBase64Url(response.clientDataJSON) };
  if (response.attestationObject) {
    encoded.attestationObject = toBase64Url(response.attestationObject);
    encoded.transports = response.getTransports?.() ?? [];
  } else {
    encoded.authenticatorData = toBase64Url(response.authenticatorData);
    encoded.signature = toBase64Url(response.signature);
    if (response.userHandle) encoded.userHandle = toBase64Url(response.userHandle);
  }
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: encoded,
  };
}

async function askBrowser(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  try {
    const credential = await run();
    if (!credential) throw new PasskeyCancelled();
    return credential as PublicKeyCredential;
  } catch (error) {
    if (error instanceof PasskeyCancelled) throw error;
    // The person closed the screen-lock prompt or the browser refused: not a server problem.
    throw new PasskeyCancelled();
  }
}

/** Makes a new passkey with the phone's screen lock; returns the JSON the server wants. */
export async function createPasskey(options: Json): Promise<Json> {
  const credential = await askBrowser(() =>
    navigator.credentials.create({ publicKey: decodeCreation(options) }),
  );
  return encodeCredential(credential);
}

/** Signs a login challenge with an existing passkey. */
export async function signWithPasskey(options: Json): Promise<Json> {
  const credential = await askBrowser(() =>
    navigator.credentials.get({ publicKey: decodeRequest(options) }),
  );
  return encodeCredential(credential);
}
