/**
 * AI OS host adapter — INTEGRATION STUB (documented, intentionally unimplemented).
 *
 * When PulseForge is embedded inside the AI OS, construct AIOSHostAdapter with the
 * OS bridge object and pass it to setHost() before the studio mounts. Every method
 * below maps 1:1 to a capability the AI OS is expected to provide; the studio
 * already routes all host-dependent behavior through HostPlatformAdapter, so no
 * engine/project/UI code changes are needed. See AI_OS_INTEGRATION_GUIDE.md.
 */
import type {
  HostPlatformAdapter, HostEnvironment, StudioTheme, ImportOptions, ImportedFile,
  ExportedFile, ProjectDirectoryHandle, StudioNotification,
} from "../../src/host/adapter";

/** Shape of the bridge the AI OS must inject (via postMessage, preload, or module). */
export interface AIOSBridge {
  environment(): Promise<{ version: string; platform: string }>;
  theme(): Promise<{ mode: "dark" | "light"; accent: string }>;
  secrets: {
    get(providerId: string): Promise<string | null>;
    set(providerId: string, value: string): Promise<void>;
  };
  files: {
    pickImport(options?: { accept?: string[]; multiple?: boolean }): Promise<Array<{ name: string; type: string; data: ArrayBuffer }>>;
    saveExport(files: Array<{ name: string; mime: string; data: ArrayBuffer }>): Promise<void>;
    pickDirectory(): Promise<{ name: string } | null>;
  };
  openURL(url: string): Promise<void>;
  notify(n: { title: string; body?: string; kind?: string }): void;
}

export class AIOSHostAdapter implements HostPlatformAdapter {
  constructor(private bridge: AIOSBridge) {}

  async getEnvironment(): Promise<HostEnvironment> {
    const env = await this.bridge.environment();
    return { hostName: "ai-os", hostVersion: env.version, standalone: false, platform: env.platform };
  }
  async getTheme(): Promise<StudioTheme> {
    return this.bridge.theme();
  }
  async getSecret(providerId: string): Promise<string | null> {
    return this.bridge.secrets.get(providerId);
  }
  async setSecret(providerId: string, value: string): Promise<void> {
    return this.bridge.secrets.set(providerId, value);
  }
  async importFiles(options?: ImportOptions): Promise<ImportedFile[]> {
    return this.bridge.files.pickImport(options);
  }
  async exportFiles(files: ExportedFile[]): Promise<void> {
    const resolved = await Promise.all(
      files.map(async (f) => ({ name: f.name, mime: f.mime, data: f.data instanceof Blob ? await f.data.arrayBuffer() : f.data })),
    );
    return this.bridge.files.saveExport(resolved);
  }
  async selectProjectDirectory(): Promise<ProjectDirectoryHandle | null> {
    return this.bridge.files.pickDirectory();
  }
  async openExternalURL(url: string): Promise<void> {
    return this.bridge.openURL(url);
  }
  notify(notification: StudioNotification): void {
    this.bridge.notify(notification);
  }
}
