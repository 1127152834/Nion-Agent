import { app } from "electron";
import https from "node:https";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface UpdateConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  checkIntervalMinutes: number;
}

interface UpdateState {
  lastCheckedAt: string | null;
  lastNotifiedVersion: string | null;
  ignoredVersion: string | null;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseNotes?: string;
}

export class GitHubUpdateManager {
  private config: UpdateConfig;
  private statePath: string;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(appDataDir: string) {
    // Load config from package.json
    const packageJson = require(path.join(__dirname, "..", "package.json"));
    this.config = packageJson.nionAutoUpdate || {
      enabled: false,
      owner: "",
      repo: "",
      checkIntervalMinutes: 240
    };

    this.statePath = path.join(appDataDir, "update-state.json");
  }

  start(): void {
    if (!this.config.enabled) {
      console.log("[UpdateManager] Auto-update disabled");
      return;
    }

    console.log("[UpdateManager] Starting auto-update checks");
    this.scheduleNextCheck();
  }

  stop(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const currentVersion = app.getVersion();

    try {
      const latestRelease = await this.fetchLatestRelease();
      const latestVersion = this.normalizeVersion(latestRelease.tag_name);

      const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;

      if (hasUpdate) {
        this.updateState({
          lastCheckedAt: new Date().toISOString(),
          lastNotifiedVersion: latestVersion,
          ignoredVersion: null
        });
      }

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        downloadUrl: latestRelease.html_url,
        releaseNotes: latestRelease.body
      };
    } catch (error) {
      console.error("[UpdateManager] Failed to check for updates:", error);
      return {
        hasUpdate: false,
        currentVersion
      };
    }
  }

  private async fetchLatestRelease(): Promise<any> {
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/releases/latest`;

    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          "User-Agent": "Nion-Desktop",
          "Accept": "application/vnd.github.v3+json"
        }
      }, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}`));
          }
        });
      }).on("error", reject);
    });
  }

  private normalizeVersion(version: string): string {
    // Remove 'v' prefix if present
    return version.replace(/^v/, "");
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  private scheduleNextCheck(): void {
    const intervalMs = this.config.checkIntervalMinutes * 60 * 1000;

    this.checkTimer = setTimeout(async () => {
      await this.checkForUpdates();
      this.scheduleNextCheck();
    }, intervalMs);
  }

  private loadState(): UpdateState {
    if (existsSync(this.statePath)) {
      return JSON.parse(readFileSync(this.statePath, "utf-8"));
    }
    return {
      lastCheckedAt: null,
      lastNotifiedVersion: null,
      ignoredVersion: null
    };
  }

  private updateState(updates: Partial<UpdateState>): void {
    const state = { ...this.loadState(), ...updates };
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
