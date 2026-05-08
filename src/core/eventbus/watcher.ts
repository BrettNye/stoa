import * as chokidar from "chokidar";
import { resolve, relative } from "node:path";
import pm from "picomatch";

export type WatcherChangeKind = "add" | "change";
export type WatcherCallback = (absPath: string, kind: WatcherChangeKind) => void;

export interface WatcherConfig {
  vaultPath: string;
  globs: string[];
  onEvent: WatcherCallback;
  awaitStabilityMs?: number;
  awaitPollMs?: number;
}

export class Watcher {
  private fsw: chokidar.FSWatcher | null = null;
  private starting: Promise<void> | null = null;
  private matcher: ((path: string) => boolean) | null = null;

  constructor(private cfg: WatcherConfig) {
    // Pre-compile the glob matchers for efficiency
    if (cfg.globs.length > 0) {
      const matchers = cfg.globs.map((g) => pm(g, { windows: true }));
      this.matcher = (rel: string) => matchers.some((m) => m(rel));
    }
  }

  start(): Promise<void> {
    if (this.fsw) return Promise.resolve();
    if (this.starting) return this.starting;
    const matcher = this.matcher;
    this.starting = new Promise<void>((res, rej) => {
      const w = chokidar.watch(this.cfg.vaultPath, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.cfg.awaitStabilityMs ?? 100,
          pollInterval: this.cfg.awaitPollMs ?? 25,
        },
        ignorePermissionErrors: true,
        ignored: matcher
          ? (absPath: string) => {
              const rel = relative(this.cfg.vaultPath, absPath).replace(/\\/g, "/");
              // Never ignore directories (chokidar needs to traverse them)
              // We filter at the event level instead
              return false;
            }
          : undefined,
      });
      w.on("ready", () => {
        this.fsw = w;
        res();
      });
      w.on("error", (err: unknown) => rej(err));
      w.on("add", (absPath: string) => {
        if (this.matchesGlobs(absPath)) {
          this.cfg.onEvent(absPath, "add");
        }
      });
      w.on("change", (absPath: string) => {
        if (this.matchesGlobs(absPath)) {
          this.cfg.onEvent(absPath, "change");
        }
      });
    });
    return this.starting;
  }

  async close(): Promise<void> {
    if (this.fsw) {
      await this.fsw.close();
      this.fsw = null;
    }
    this.starting = null;
  }

  private matchesGlobs(absPath: string): boolean {
    if (!this.matcher) return true;
    const rel = relative(this.cfg.vaultPath, absPath).replace(/\\/g, "/");
    return this.matcher(rel);
  }
}
