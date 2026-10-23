/**
 * License key verification. The signature check runs in the desktop shell
 * (Rust), see src-tauri/src/license.rs.
 */
import { LicenseError, toLicenseErrorCode, type License } from "../domain/license";

export type LicenseVerifier = (key: string) => Promise<License>;

export async function createDesktopLicenseVerifier(): Promise<LicenseVerifier> {
  const { invoke } = await import("@tauri-apps/api/core");
  return async (key) => {
    try {
      return await invoke<License>("verify_license", { key });
    } catch (code) {
      throw new LicenseError(toLicenseErrorCode(code));
    }
  };
}

/** The browser preview cannot verify keys, so every key is rejected. */
export const previewLicenseVerifier: LicenseVerifier = async () => {
  throw new LicenseError("notConfigured");
};
