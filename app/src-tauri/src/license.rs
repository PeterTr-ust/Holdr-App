//! Offline verification of Holdr license keys.
//!
//! A license key has the form `HOLDR-<payload>.<signature>`, where `payload`
//! is base64url-encoded JSON and `signature` is the base64url-encoded Ed25519
//! signature of the payload string. Keys are issued with
//! `scripts/license-tool.mjs`; only the public key is part of the app.
//! Checking expiry dates is left to the frontend, which knows the plan rules.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::license_public_key::PUBLIC_KEY;

const PREFIX: &str = "HOLDR-";

/// Contents of a license key, as signed by the issuer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub id: String,
    pub licensee: String,
    /// "lifetime" for a one-time purchase, "subscription" for a time-limited key.
    pub plan: String,
    pub issued_at: String,
    pub expires_at: Option<String>,
}

/// Why a key was rejected; the frontend maps these codes to messages.
#[derive(Debug, PartialEq, Eq)]
pub enum LicenseError {
    /// This build contains no public key (see scripts/license-tool.mjs init).
    NotConfigured,
    Malformed,
    InvalidSignature,
}

impl LicenseError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "notConfigured",
            Self::Malformed => "malformed",
            Self::InvalidSignature => "invalidSignature",
        }
    }
}

/// Verifies a license key against the given Ed25519 public key.
pub fn verify(key: &str, public_key: &[u8; 32]) -> Result<License, LicenseError> {
    let body = key
        .trim()
        .strip_prefix(PREFIX)
        .ok_or(LicenseError::Malformed)?;
    let (payload, signature) = body.split_once('.').ok_or(LicenseError::Malformed)?;

    let signature: [u8; 64] = URL_SAFE_NO_PAD
        .decode(signature)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(LicenseError::Malformed)?;
    let verifying_key =
        VerifyingKey::from_bytes(public_key).map_err(|_| LicenseError::NotConfigured)?;
    verifying_key
        .verify_strict(payload.as_bytes(), &Signature::from_bytes(&signature))
        .map_err(|_| LicenseError::InvalidSignature)?;

    let json = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| LicenseError::Malformed)?;
    serde_json::from_slice(&json).map_err(|_| LicenseError::Malformed)
}

/// Tauri command: verifies a key with the public key built into the app.
#[tauri::command]
pub fn verify_license(key: String) -> Result<License, String> {
    let public_key = PUBLIC_KEY.ok_or(LicenseError::NotConfigured.code())?;
    verify(&key, &public_key).map_err(|error| error.code().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn issue(payload_json: &str, key: &SigningKey) -> String {
        let payload = URL_SAFE_NO_PAD.encode(payload_json);
        let signature = key.sign(payload.as_bytes());
        format!(
            "{PREFIX}{payload}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        )
    }

    const PAYLOAD: &str = r#"{"id":"a1","licensee":"Erika Muster","plan":"lifetime","issuedAt":"2026-10-22","expiresAt":null}"#;

    #[test]
    fn accepts_a_correctly_signed_key() {
        let key = signing_key();
        let license = verify(&issue(PAYLOAD, &key), key.verifying_key().as_bytes()).unwrap();
        assert_eq!(license.licensee, "Erika Muster");
        assert_eq!(license.plan, "lifetime");
        assert_eq!(license.expires_at, None);
    }

    #[test]
    fn rejects_a_key_signed_by_someone_else() {
        let forged = issue(PAYLOAD, &SigningKey::from_bytes(&[9u8; 32]));
        let public = signing_key().verifying_key();
        assert_eq!(
            verify(&forged, public.as_bytes()),
            Err(LicenseError::InvalidSignature)
        );
    }

    #[test]
    fn rejects_a_modified_payload() {
        let key = signing_key();
        let original = issue(PAYLOAD, &key);
        let (_, signature) = original.split_once('.').unwrap();
        let tampered_payload = URL_SAFE_NO_PAD.encode(PAYLOAD.replace("lifetime", "forever"));
        let tampered = format!("{PREFIX}{tampered_payload}.{signature}");
        assert_eq!(
            verify(&tampered, key.verifying_key().as_bytes()),
            Err(LicenseError::InvalidSignature)
        );
    }

    #[test]
    fn rejects_garbage() {
        let public = signing_key().verifying_key();
        for key in ["", "HOLDR-", "HOLDR-abc", "HOLDR-abc.def", "nonsense.key"] {
            assert_eq!(
                verify(key, public.as_bytes()),
                Err(LicenseError::Malformed),
                "{key}"
            );
        }
    }
}
