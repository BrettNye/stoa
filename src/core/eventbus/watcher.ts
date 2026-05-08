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
  private startingReject: ((err: unknown) => void) | null = null;
  private matcher: ((path: string) => boolean) | null = null;

  constructor(private cfg: WatcherConfig) {
    // Pre-compile the glob matchers for efficiency
    if (cfg.globs.length > 0) {
      const matchers = cfg.globs.map((g) => pm(g, { windows: true }));
      this.matcher = (rel: string) => matchers.some((m) => m(rel));
    }
  }

  start(): Promise<void> {
    if (this.fsw && !this.starting) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((res, rej) => {
      this.startingReject = rej;
      const w = chokidar.watch(this.cfg.vaultPath, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.cfg.awaitStabilityMs ?? 100,
          pollInterval: this.cfg.awaitPollMs ?? 25,
        },
        ignorePermissionErrors: true,
      });
      // Track the in-flight watcher immediately so close() can shut it down
      // even if 'ready' has not fired yet.
      this.fsw = w;
      w.on("ready", () => {
        this.starting = null;
        this.startingReject = null;
        res();
      });
      w.on("error", (err: unknown) => {
        this.starting = null;
        this.startingReject = null;
        rej(err);
      });
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
    // If a start() is in-flight (ready not yet fired), reject its promise so
    // any awaiting callers are unblocked before we close the underlying watcher.
    if (this.startingReject) {
      this.startingReject(new Error("Watcher closed before ready"));
      this.startingReject = null;
    }
    this.starting = null;
    if (this.fsw) {
      await this.fsw.close();
      this.fsw = null;
    }
  }

  private matchesGlobs(absPath: string): boolean {
    if (!this.matcher) return true;
    const rel = relative(this.cfg.vaultPath, absPath).replace(/\\/g, "/");
    return this.matcher(rel);
  }
}
