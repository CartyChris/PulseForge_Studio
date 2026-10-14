/**
 * Host platform abstraction. The studio calls only this interface for anything a
 * future host (the AI OS) may supply. StandaloneHostAdapter is the browser
 * implementation; integrations/aios-adapter holds the documented future stub.
 */
export interface HostEnvironment {
  hostName: string;
  hostVersion: string;
  standalone: boolean;
  platform: string;
}

export interface StudioTheme {
  mode: "dark" | "light";
  accent: string;
}

export interface ImportOptions {
  accept?: string[];
  multiple?: boolean;
}
export interface ImportedFile {
  name: string;
  type: string;
  data: ArrayBuffer;
}
export interface ExportedFile {
  name: string;
  mime: string;
  data: ArrayBuffer | Blob;
}
export interface ProjectDirectoryHandle {
  name: string;
}
export interface StudioNotification {
  title: string;
  body?: string;
  kind?: "info" | "success" | "error";
}

export interface HostPlatformAdapter {
  getEnvironment(): Promise<HostEnvironment>;
  getTheme(): Promise<StudioTheme>;
  /** secrets live in the backend for standalone; a host OS may supply its own vault */
  getSecret(providerId: string): Promise<string | null>;
  setSecret?(providerId: string, value: string): Promise<void>;
  importFiles(options?: ImportOptions): Promise<ImportedFile[]>;
  exportFiles(files: ExportedFile[]): Promise<void>;
  selectProjectDirectory?(): Promise<ProjectDirectoryHandle | null>;
  openExternalURL(url: string): Promise<void>;
  notify(notification: StudioNotification): void;
}

export class StandaloneHostAdapter implements HostPlatformAdapter {
  constructor(private onNotify?: (n: StudioNotification) => void) {}

  async getEnvironment(): Promise<HostEnvironment> {
    return { hostName: "standalone-browser", hostVersion: "1.0.0", standalone: true, platform: navigator.platform };
  }

  async getTheme(): Promise<StudioTheme> {
    return { mode: "dark", accent: "#e8663c" };
  }

  /** Standalone never exposes provider secrets to the frontend — they stay in the backend. */
  async getSecret(_providerId: string): Promise<string | null> {
    return null;
  }

  async importFiles(options?: ImportOptions): Promise<ImportedFile[]> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options?.multiple ?? true;
      if (options?.accept?.length) input.accept = options.accept.join(",");
      input.onchange = async () => {
        const files = [...(input.files ?? [])];
        const out: ImportedFile[] = [];
        for (const f of files) out.push({ name: f.name, type: f.type, data: await f.arrayBuffer() });
        resolve(out);
      };
      // cancel: resolve empty when dialog closes without change
      input.addEventListener("cancel", () => resolve([]));
      input.click();
    });
  }

  async exportFiles(files: ExportedFile[]): Promise<void> {
    for (const f of files) {
      const blob = f.data instanceof Blob ? f.data : new Blob([f.data], { type: f.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }

  async openExternalURL(url: string): Promise<void> {
    if (!/^https?:\/\//.test(url)) throw new Error("Only http(s) URLs may be opened");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  notify(notification: StudioNotification): void {
    this.onNotify?.(notification);
  }
}

let hostInstance: HostPlatformAdapter | null = null;
export function setHost(host: HostPlatformAdapter): void {
  hostInstance = host;
}
export function getHost(): HostPlatformAdapter {
  if (!hostInstance) hostInstance = new StandaloneHostAdapter();
  return hostInstance;
}
