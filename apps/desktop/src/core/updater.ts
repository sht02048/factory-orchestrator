import { newestRelease } from "@ganger/app/updates/releases";
import type {
  ManualReason,
  ServerKind,
  UpdateCheck,
  UpdateToast,
  UpdateView,
} from "@ganger/app/updates/view";
import { z } from "zod";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 15_000;

export const updateSettingsSchema = z.object({
  autoUpdate: z.boolean().optional(),
  lastCheckedAt: z.string().optional(),
  pending: z.object({ from: z.string(), to: z.string(), notesUrl: z.string() }).optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export interface UpdateStore {
  read(): UpdateSettings;
  write(settings: UpdateSettings): void;
}

export interface Installer {
  download(feedUrl: string): void;
  install(): void;
}

export interface UpdaterOptions {
  currentVersion: string;
  arch: string;
  repository: string | null;
  fetchReleases: (repository: string) => Promise<unknown>;
  installer: Installer;
  blocked: () => ManualReason | null;
  store: UpdateStore;
  now: () => Date;
  onChange: () => void;
}

export interface ServerVersion {
  kind: ServerKind;
  version: string | null;
}

export class Updater {
  private readonly options: UpdaterOptions;
  private check: UpdateCheck;
  private latest: { version: string; notesUrl: string } | null = null;
  private toast: UpdateToast | null = null;
  private recheck = false;

  constructor(options: UpdaterOptions) {
    this.options = options;
    this.check = options.repository === null ? { kind: "unavailable" } : { kind: "idle" };
    const settings = options.store.read();
    const pending = settings.pending;
    if (pending !== undefined) {
      if (pending.to === options.currentVersion) {
        this.toast = { kind: "updated", version: pending.to, notesUrl: pending.notesUrl };
      } else {
        this.recheck = true;
      }
      const next: UpdateSettings = { ...settings };
      delete next.pending;
      options.store.write(next);
    }
  }

  get autoUpdate(): boolean {
    return this.options.store.read().autoUpdate ?? true;
  }

  get state(): UpdateCheck {
    return this.check;
  }

  view(server: ServerVersion): UpdateView {
    return {
      appVersion: this.options.currentVersion,
      server,
      autoUpdate: this.autoUpdate,
      lastCheckedAt: this.options.store.read().lastCheckedAt ?? null,
      latest: this.latest,
      check: this.check,
      toast: this.toast,
    };
  }

  due(): boolean {
    if (!this.autoUpdate || !this.idle()) return false;
    if (this.recheck) return true;
    const last = this.options.store.read().lastCheckedAt;
    if (last === undefined) return true;
    const elapsed = this.options.now().getTime() - new Date(last).getTime();
    return Number.isNaN(elapsed) || elapsed >= CHECK_INTERVAL_MS || elapsed < 0;
  }

  async tick(): Promise<void> {
    if (this.due()) await this.checkNow();
  }

  async checkNow(): Promise<void> {
    const repository = this.options.repository;
    if (repository === null || !this.idle()) return;
    const ready = this.check.kind === "ready" ? this.check : null;
    this.recheck = false;
    this.set({ kind: "checking" });
    let release;
    try {
      release = newestRelease(
        await this.options.fetchReleases(repository),
        this.options.currentVersion,
        this.options.arch,
      );
    } catch {
      this.set(ready ?? { kind: "failed" });
      return;
    }
    this.options.store.write({
      ...this.options.store.read(),
      lastCheckedAt: this.options.now().toISOString(),
    });
    if (release === null) {
      this.latest = null;
      this.set(ready ?? { kind: "latest" });
      return;
    }
    this.latest = { version: release.version, notesUrl: release.notesUrl };
    if (ready !== null && ready.version === release.version) {
      this.set(ready);
      return;
    }
    const reason = this.options.blocked();
    if (reason !== null) {
      this.set({ kind: "manual", reason, ...this.latest });
      return;
    }
    this.set({ kind: "downloading", ...this.latest });
    this.options.installer.download(release.feedUrl);
  }

  downloaded(): void {
    if (this.check.kind !== "downloading") return;
    const { version, notesUrl } = this.check;
    this.options.store.write({
      ...this.options.store.read(),
      pending: { from: this.options.currentVersion, to: version, notesUrl },
    });
    this.toast = { kind: "ready", version, notesUrl };
    this.set({ kind: "ready", version, notesUrl });
  }

  failed(): void {
    if (this.check.kind === "downloading" || this.check.kind === "checking") {
      this.set({ kind: "failed" });
    }
  }

  restart(): boolean {
    if (this.check.kind !== "ready") return false;
    this.toast = null;
    this.options.installer.install();
    return true;
  }

  later(): void {
    if (this.toast?.kind !== "ready") return;
    this.toast = null;
    this.options.onChange();
  }

  dismissUpdated(): void {
    if (this.toast?.kind !== "updated") return;
    this.toast = null;
    this.options.onChange();
  }

  setAutoUpdate(enabled: boolean): void {
    this.options.store.write({ ...this.options.store.read(), autoUpdate: enabled });
    this.options.onChange();
  }

  private idle(): boolean {
    switch (this.check.kind) {
      case "checking":
      case "downloading":
      case "unavailable":
        return false;
      case "idle":
      case "latest":
      case "failed":
      case "manual":
      case "ready":
        return true;
    }
  }

  private set(check: UpdateCheck): void {
    this.check = check;
    this.options.onChange();
  }
}
