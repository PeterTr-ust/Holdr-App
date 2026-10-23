/**
 * Lets the user pick where a backup is saved and which backup is opened.
 */

export interface BackupFiles {
  /** Asks for a location and writes the text there. Returns false if the user cancels. */
  save(suggestedName: string, contents: string): Promise<boolean>;
  /** Asks for a file and returns its text, or null if the user cancels. */
  open(): Promise<string | null>;
}

const FILTERS = [{ name: "Holdr Backup", extensions: ["json"] }];

/** Native dialogs of the desktop shell. Only the chosen file becomes accessible. */
export async function createDesktopBackupFiles(): Promise<BackupFiles> {
  const [dialog, fs] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  return {
    async save(suggestedName, contents) {
      const path = await dialog.save({ defaultPath: suggestedName, filters: FILTERS });
      if (!path) return false;
      await fs.writeTextFile(path, contents);
      return true;
    },
    async open() {
      const path = await dialog.open({ multiple: false, directory: false, filters: FILTERS });
      if (!path) return null;
      return fs.readTextFile(path);
    },
  };
}

/** Browser download and file picker, for the preview without the desktop shell. */
export function createBrowserBackupFiles(): BackupFiles {
  return {
    async save(suggestedName, contents) {
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: suggestedName,
      });
      link.click();
      URL.revokeObjectURL(url);
      return true;
    },
    open() {
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement("input"), {
          type: "file",
          accept: ".json,application/json",
        });
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          resolve(file ? file.text() : null);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
      });
    },
  };
}
