import { app } from "electron";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";

import type { DesktopRuntimePaths } from "./paths";

type OptionalComponentStatus = "not_downloaded" | "downloading" | "downloaded" | "failed" | "skipped";

interface RuntimeManifestComponent {
  name: string;
  description: string;
  assetName: string;
  sha256?: string;
}

interface RuntimeManifest {
  version: string;
  platform: string;
  arch: string;
  coreComponents: Array<{ name: string; path: string }>;
  optionalComponents: RuntimeManifestComponent[];
  checksums: Record<string, string>;
}

interface RuntimeComponentState {
  status: OptionalComponentStatus;
  assetPath?: string;
  downloadedAt?: string;
  error?: string;
}

interface RuntimeState {
  version: string;
  platform: string;
  arch: string;
  onboardingCompleted: boolean;
  optionalComponents: Record<string, RuntimeComponentState>;
}

export interface RuntimeStatusComponent {
  name: string;
  description: string;
  assetName: string;
  sha256?: string;
  status: OptionalComponentStatus;
  assetPath?: string;
  downloadedAt?: string;
  error?: string;
}

export interface RuntimeStatus {
  version: string;
  platform: string;
  arch: string;
  coreReady: boolean;
  onboardingCompleted: boolean;
  optionalComponents: RuntimeStatusComponent[];
}

export interface RuntimeDownloadProgress {
  name: string;
  receivedBytes: number;
  totalBytes: number;
  progress: number;
}

interface RuntimeDownloadRepoConfig {
  owner: string;
  repo: string;
}

export class RuntimeOptionalComponentsManager {
  private manifest: RuntimeManifest;
  private repoConfig: RuntimeDownloadRepoConfig;

  constructor(private paths: DesktopRuntimePaths) {
    this.manifest = this.loadManifest();
    this.repoConfig = this.loadRepoConfig();
    this.ensureState();
  }

  getStatus(): RuntimeStatus {
    const state = this.readState();
    const optionalComponents = this.manifest.optionalComponents.map((component) => {
      const persisted = state.optionalComponents[component.name] ?? { status: "not_downloaded" as const };
      return {
        ...component,
        status: persisted.status,
        assetPath: persisted.assetPath,
        downloadedAt: persisted.downloadedAt,
        error: persisted.error,
      };
    });

    return {
      version: state.version,
      platform: state.platform,
      arch: state.arch,
      coreReady: this.isCoreReady(),
      onboardingCompleted: state.onboardingCompleted,
      optionalComponents,
    };
  }

  async downloadOptionalComponent(
    componentName: string,
    onProgress?: (progress: RuntimeDownloadProgress) => void,
  ): Promise<RuntimeStatus> {
    const component = this.manifest.optionalComponents.find((item) => item.name === componentName);
    if (!component) {
      throw new Error(`Unknown optional component: ${componentName}`);
    }

    const state = this.readState();
    state.optionalComponents[componentName] = { status: "downloading" };
    this.writeState(state);

    try {
      const resolvedAssetName = this.resolveAssetName(component.assetName);
      const releaseAsset = await this.resolveReleaseAsset(resolvedAssetName);
      const componentDir = path.join(this.paths.runtimeOptionalDir, componentName);
      this.ensureDir(componentDir);

      const tempPath = path.join(componentDir, `${resolvedAssetName}.download`);
      const finalPath = path.join(componentDir, resolvedAssetName);

      await this.downloadAssetFile(releaseAsset.url, tempPath, componentName, onProgress);
      if (component.sha256) {
        await this.verifySha256(tempPath, component.sha256);
      }
      renameSync(tempPath, finalPath);

      state.optionalComponents[componentName] = {
        status: "downloaded",
        assetPath: finalPath,
        downloadedAt: new Date().toISOString(),
      };

      if (this.areAllOptionalComponentsReady(state)) {
        state.onboardingCompleted = true;
      }
      this.writeState(state);
    } catch (error) {
      state.optionalComponents[componentName] = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      this.writeState(state);
      throw error;
    }

    return this.getStatus();
  }

  async retryOptionalComponent(
    componentName: string,
    onProgress?: (progress: RuntimeDownloadProgress) => void,
  ): Promise<RuntimeStatus> {
    return this.downloadOptionalComponent(componentName, onProgress);
  }

  markOnboardingCompleted(): RuntimeStatus {
    const state = this.readState();
    state.onboardingCompleted = true;
    this.writeState(state);
    return this.getStatus();
  }

  markComponentSkipped(componentName: string): RuntimeStatus {
    const state = this.readState();
    state.optionalComponents[componentName] = {
      status: "skipped",
    };
    this.writeState(state);
    return this.getStatus();
  }

  private loadManifest(): RuntimeManifest {
    if (existsSync(this.paths.runtimeManifestPath)) {
      return JSON.parse(readFileSync(this.paths.runtimeManifestPath, "utf-8")) as RuntimeManifest;
    }

    return {
      version: "0.1.0",
      platform: process.platform,
      arch: process.arch,
      coreComponents: [],
      optionalComponents: [],
      checksums: {},
    };
  }

  private loadRepoConfig(): RuntimeDownloadRepoConfig {
    try {
      const packageJson = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")) as {
        nionRuntimeDownload?: RuntimeDownloadRepoConfig;
      };
      if (packageJson.nionRuntimeDownload?.owner && packageJson.nionRuntimeDownload?.repo) {
        return packageJson.nionRuntimeDownload;
      }
    } catch {
      // ignore config parse errors and fallback to default
    }

    return {
      owner: "huanxi",
      repo: "nion",
    };
  }

  private ensureState(): void {
    if (!existsSync(this.paths.runtimeStatePath)) {
      const initialState: RuntimeState = {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        onboardingCompleted: false,
        optionalComponents: {},
      };
      this.writeState(initialState);
      return;
    }

    const state = this.readState();
    const shouldReset =
      state.version !== app.getVersion() ||
      state.platform !== process.platform ||
      state.arch !== process.arch;

    if (shouldReset) {
      const resetState: RuntimeState = {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        onboardingCompleted: false,
        optionalComponents: {},
      };
      this.writeState(resetState);
    }
  }

  private readState(): RuntimeState {
    if (!existsSync(this.paths.runtimeStatePath)) {
      return {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        onboardingCompleted: false,
        optionalComponents: {},
      };
    }
    return JSON.parse(readFileSync(this.paths.runtimeStatePath, "utf-8")) as RuntimeState;
  }

  private writeState(state: RuntimeState): void {
    this.ensureDir(path.dirname(this.paths.runtimeStatePath));
    writeFileSync(this.paths.runtimeStatePath, JSON.stringify(state, null, 2));
  }

  private ensureDir(targetPath: string): void {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
  }

  private isCoreReady(): boolean {
    return this.manifest.coreComponents.every((component) =>
      existsSync(path.resolve(this.paths.runtimeDir, component.path)),
    );
  }

  private areAllOptionalComponentsReady(state: RuntimeState): boolean {
    if (this.manifest.optionalComponents.length === 0) {
      return true;
    }
    return this.manifest.optionalComponents.every((component) => {
      const status = state.optionalComponents[component.name]?.status ?? "not_downloaded";
      return status === "downloaded" || status === "skipped";
    });
  }

  private resolveAssetName(template: string): string {
    return template
      .replaceAll("{platform}", process.platform)
      .replaceAll("{arch}", process.arch)
      .replaceAll("{version}", app.getVersion());
  }

  private async resolveReleaseAsset(
    assetName: string,
  ): Promise<{ name: string; url: string }> {
    const tagName = `v${app.getVersion()}`;
    const byTag = await this.fetchReleaseAssetByTag(tagName, assetName);
    if (byTag) {
      return byTag;
    }

    const latest = await this.fetchLatestReleaseAsset(assetName);
    if (latest) {
      return latest;
    }

    throw new Error(`Release asset not found: ${assetName}`);
  }

  private async fetchReleaseAssetByTag(
    tag: string,
    assetName: string,
  ): Promise<{ name: string; url: string } | null> {
    const url = `https://api.github.com/repos/${this.repoConfig.owner}/${this.repoConfig.repo}/releases/tags/${encodeURIComponent(tag)}`;
    return this.fetchAssetFromRelease(url, assetName, true);
  }

  private async fetchLatestReleaseAsset(
    assetName: string,
  ): Promise<{ name: string; url: string } | null> {
    const url = `https://api.github.com/repos/${this.repoConfig.owner}/${this.repoConfig.repo}/releases/latest`;
    return this.fetchAssetFromRelease(url, assetName, false);
  }

  private async fetchAssetFromRelease(
    url: string,
    assetName: string,
    allowNotFound: boolean,
  ): Promise<{ name: string; url: string } | null> {
    const release = await this.fetchJson(url, allowNotFound);
    if (!release) {
      return null;
    }

    const assets = Array.isArray((release as { assets?: unknown }).assets)
      ? ((release as { assets: Array<{ name: string; browser_download_url: string }> }).assets)
      : [];
    const target = assets.find((asset) => asset.name === assetName);
    if (!target) {
      return null;
    }
    return {
      name: target.name,
      url: target.browser_download_url,
    };
  }

  private async fetchJson(url: string, allowNotFound: boolean): Promise<unknown | null> {
    return new Promise((resolve, reject) => {
      https
        .get(
          url,
          {
            headers: {
              "User-Agent": "Nion-Desktop-RuntimeManager",
              Accept: "application/vnd.github+json",
            },
          },
          (res) => {
            let payload = "";
            res.on("data", (chunk) => {
              payload += chunk;
            });
            res.on("end", () => {
              if (allowNotFound && res.statusCode === 404) {
                resolve(null);
                return;
              }
              if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
                resolve(JSON.parse(payload));
                return;
              }
              reject(new Error(`GitHub API request failed: ${res.statusCode} ${payload}`));
            });
          },
        )
        .on("error", reject);
    });
  }

  private async downloadAssetFile(
    url: string,
    outputPath: string,
    componentName: string,
    onProgress?: (progress: RuntimeDownloadProgress) => void,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const fileStream = createWriteStream(outputPath);
      https
        .get(
          url,
          {
            headers: {
              "User-Agent": "Nion-Desktop-RuntimeManager",
            },
          },
          (res) => {
            if ((res.statusCode ?? 500) >= 400) {
              fileStream.close();
              rmSync(outputPath, { force: true });
              reject(new Error(`Download failed with status ${res.statusCode}`));
              return;
            }

            const totalBytes = Number(res.headers["content-length"] ?? 0);
            let receivedBytes = 0;

            res.on("data", (chunk: Buffer) => {
              receivedBytes += chunk.length;
              if (onProgress) {
                onProgress({
                  name: componentName,
                  receivedBytes,
                  totalBytes,
                  progress: totalBytes > 0 ? receivedBytes / totalBytes : 0,
                });
              }
            });

            res.pipe(fileStream);
            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });
          },
        )
        .on("error", (error) => {
          fileStream.close();
          rmSync(outputPath, { force: true });
          reject(error);
        });
    });
  }

  private async verifySha256(filePath: string, expectedHash: string): Promise<void> {
    const content = readFileSync(filePath);
    const current = createHash("sha256").update(content).digest("hex");
    const expected = expectedHash.trim().toLowerCase();
    if (current !== expected) {
      throw new Error(`SHA256 mismatch for ${path.basename(filePath)}: expected ${expected}, got ${current}`);
    }
  }
}
