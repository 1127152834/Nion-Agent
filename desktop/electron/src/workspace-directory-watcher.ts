import { promises as fsPromises, watch, type Dirent, type FSWatcher } from "node:fs";
import path from "node:path";

export interface WorkspaceDirectoryWatchEvent {
  type: "rename" | "change";
  path: string;
  rootPath: string;
  watchedPath: string;
  filename: string | null;
  timestamp: number;
}

interface WorkspaceDirectoryWatcherOptions {
  rootPath: string;
  onChange: (event: WorkspaceDirectoryWatchEvent) => void;
  debounceMs?: number;
}

export class WorkspaceDirectoryWatcher {
  private readonly rootPath: string;
  private readonly onChange: (event: WorkspaceDirectoryWatchEvent) => void;
  private readonly debounceMs: number;
  private readonly watchers = new Map<string, FSWatcher>();
  private syncTimer: NodeJS.Timeout | null = null;
  private syncQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: WorkspaceDirectoryWatcherOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.onChange = options.onChange;
    this.debounceMs = options.debounceMs ?? 80;
  }

  async start(): Promise<void> {
    await this.assertRootDirectory();
    await this.queueSyncWatchers();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    await this.syncQueue.catch(() => undefined);
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private async assertRootDirectory(): Promise<void> {
    const stat = await fsPromises.stat(this.rootPath);
    if (!stat.isDirectory()) {
      throw new Error(`Workspace watch path is not a directory: ${this.rootPath}`);
    }
  }

  private scheduleSync(): void {
    if (this.closed) {
      return;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.queueSyncWatchers();
    }, this.debounceMs);
  }

  private queueSyncWatchers(): Promise<void> {
    this.syncQueue = this.syncQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.closed) {
          return;
        }
        await this.syncWatchers();
      });
    return this.syncQueue;
  }

  private async syncWatchers(): Promise<void> {
    if (this.closed) {
      return;
    }

    const nextDirectories = await this.collectDirectories(this.rootPath);
    const nextSet = new Set(nextDirectories);

    for (const [watchedPath, watcher] of this.watchers.entries()) {
      if (nextSet.has(watchedPath)) {
        continue;
      }
      watcher.close();
      this.watchers.delete(watchedPath);
    }

    for (const directory of nextDirectories) {
      if (this.watchers.has(directory)) {
        continue;
      }
      const watcher = watch(
        directory,
        { persistent: false, encoding: "utf8" },
        (eventType, filename) => {
          void this.handleFsEvent(directory, eventType, filename ?? null);
        },
      );
      watcher.on("error", () => {
        this.scheduleSync();
      });
      this.watchers.set(directory, watcher);
    }
  }

  private async handleFsEvent(
    watchedPath: string,
    eventType: "rename" | "change",
    filename: string | null,
  ): Promise<void> {
    if (this.closed) {
      return;
    }

    const changedPath = filename ? path.join(watchedPath, filename) : watchedPath;
    const shouldAwaitSync = await this.isDirectory(changedPath);
    if (shouldAwaitSync) {
      await this.queueSyncWatchers();
    } else {
      this.scheduleSync();
    }

    this.onChange({
      type: eventType,
      path: changedPath,
      rootPath: this.rootPath,
      watchedPath,
      filename,
      timestamp: Date.now(),
    });
  }

  private async isDirectory(targetPath: string): Promise<boolean> {
    try {
      const stat = await fsPromises.stat(targetPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async collectDirectories(rootPath: string): Promise<string[]> {
    const directories: string[] = [];
    const walk = async (currentPath: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fsPromises.readdir(currentPath, {
          withFileTypes: true,
          encoding: "utf8",
        });
      } catch {
        return;
      }

      directories.push(currentPath);

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          continue;
        }
        await walk(path.join(currentPath, entry.name));
      }
    };

    await walk(rootPath);
    return directories;
  }
}
