"""A software passkey for the tests (F-80): it answers WebAuthn options like a phone's screen lock
would, with a real P-256 key. The server then checks real signatures with py_webauthn: nothing is
mocked. No biometric is involved anywhere."""

import base64
import hashlib
import json
import secrets
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from tests.conftest import TEST_ORIGIN

UP, UV, AT = 0x01, 0x04, 0x40  # authenticator data flags: user present, verified, key included


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class SoftPasskey:
    def __init__(self, rp_id: str = "testserver", origin: str = TEST_ORIGIN) -> None:
        self.rp_id = rp_id
        self.origin = origin
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(32)
        self.sign_count = 0

    def _cose_public_key(self) -> bytes:
        numbers = self.private_key.public_key().public_numbers()
        return cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def _client_data(self, kind: str, challenge: str, origin: str | None) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": challenge,
                "origin": origin or self.origin,
                "crossOrigin": False,
            }
        ).encode()

    def register(self, options: dict, *, verified: bool = True) -> dict:
        """The answer to `navigator.credentials.create(options)` (attestation "none")."""
        flags = UP | AT | (UV if verified else 0)
        auth_data = (
            hashlib.sha256(options["rp"]["id"].encode()).digest()
            + bytes([flags])
            + struct.pack(">I", self.sign_count)
            + bytes(16)  # AAGUID
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + self._cose_public_key()
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        client_data = self._client_data("webauthn.create", options["challenge"], None)
        return {
            "id": b64url(self.credential_id),
            "rawId": b64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "attestationObject": b64url(attestation),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def sign_in(
        self,
        options: dict,
        *,
        count: int | None = None,
        origin: str | None = None,
        challenge: str | None = None,
    ) -> dict:
        """The answer to `navigator.credentials.get(options)`."""
        self.sign_count = self.sign_count + 1 if count is None else count
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([UP | UV])
            + struct.pack(">I", self.sign_count)
        )
        client_data = self._client_data("webauthn.get", challenge or options["challenge"], origin)
        signature = self.private_key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": b64url(self.credential_id),
            "rawId": b64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "authenticatorData": b64url(auth_data),
                "signature": b64url(signature),
                "userHandle": None,
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }
