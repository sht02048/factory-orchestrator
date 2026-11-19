import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { RunnerId } from "@ganger/core";
import { listRunners } from "@ganger/db";
import { z } from "zod";
import type { SettingsContext } from "../settings/load.js";
import { parsePublicKey } from "./ganger-ssh.js";
import type { GangerSsh } from "./ganger-ssh.js";
import { THIS_MAC_CAPACITY, saveGangerRunner } from "./register.js";
import {
  renderSetupScript,
  reviewFirstCommand,
  setupCommand,
  setupScriptUrl,
} from "./setup-script.js";

export const ENROLLMENT_TTL_MS = 10 * 60_000;
const FORGET_AFTER_MS = 60 * 60_000;
const TOKEN_BYTES = 24;
const DETAIL_LIMIT = 300;

export const ENROLLMENT_PROBLEMS = [
  "remote-login-off",
  "orca-not-found",
  "tailscale-missing",
  "host-key-missing",
  "authorized-keys-failed",
  "service-failed",
  "invalid-report",
  "register-failed",
] as const;
export type EnrollmentProblem = (typeof ENROLLMENT_PROBLEMS)[number];

const REPORTED_PROBLEMS = ENROLLMENT_PROBLEMS.filter(
  (problem) => problem !== "invalid-report" && problem !== "register-failed",
);

export const GITHUB_SETUP_RESULTS = ["done", "gh-missing", "gh-logged-out", "gh-failed"] as const;
export type GitHubSetupResult = (typeof GITHUB_SETUP_RESULTS)[number];

export interface EnrolledRunner {
  id: RunnerId;
  name: string;
  sshTarget: string;
  orcaPath: string;
  capacity: number;
  github: GitHubSetupResult;
}

export type EnrollmentView =
  | { state: "waiting"; expiresInMs: number }
  | { state: "expired" }
  | { state: "registered"; runner: EnrolledRunner }
  | { state: "failed"; problem: EnrollmentProblem; detail: string | null }
  | { state: "unknown" };

export interface IssuedEnrollment {
  id: string;
  token: string;
  expiresInMs: number;
}

export type ClaimRefusal = "unknown" | "expired" | "used";

type Outcome =
  | { state: "waiting" }
  | { state: "claimed" }
  | { state: "registered"; runner: EnrolledRunner }
  | { state: "failed"; problem: EnrollmentProblem; detail: string | null };

interface Entry {
  id: string;
  tokenHash: string;
  issuedAt: number;
  expiresAt: number;
  outcome: Outcome;
}

export interface RunnerEnrollmentsOptions {
  now?: () => number;
  ttlMs?: number;
  newToken?: () => string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class RunnerEnrollments {
  private readonly byHash = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly newToken: () => string;

  constructor(options: RunnerEnrollmentsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? ENROLLMENT_TTL_MS;
    this.newToken = options.newToken ?? (() => randomBytes(TOKEN_BYTES).toString("base64url"));
  }

  issue(replacing?: string): IssuedEnrollment {
    const now = this.now();
    this.forgetOld(now);
    if (replacing !== undefined) this.revoke(replacing);
    const token = this.newToken();
    const entry: Entry = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      outcome: { state: "waiting" },
    };
    this.byHash.set(entry.tokenHash, entry);
    this.byId.set(entry.id, entry);
    return { id: entry.id, token, expiresInMs: this.ttlMs };
  }

  revoke(id: string): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    this.byId.delete(id);
    this.byHash.delete(entry.tokenHash);
  }

  usable(token: string): boolean {
    const entry = this.byHash.get(hashToken(token));
    return entry !== undefined && entry.outcome.state === "waiting" && this.now() < entry.expiresAt;
  }

  claim(token: string): { ok: true; id: string } | { ok: false; refusal: ClaimRefusal } {
    const entry = this.byHash.get(hashToken(token));
    if (entry === undefined) return { ok: false, refusal: "unknown" };
    if (entry.outcome.state !== "waiting") return { ok: false, refusal: "used" };
    if (this.now() >= entry.expiresAt) return { ok: false, refusal: "expired" };
    entry.outcome = { state: "claimed" };
    return { ok: true, id: entry.id };
  }

  finish(id: string, outcome: Exclude<Outcome, { state: "waiting" | "claimed" }>): void {
    const entry = this.byId.get(id);
    if (entry !== undefined) entry.outcome = outcome;
  }

  view(id: string): EnrollmentView {
    const entry = this.byId.get(id);
    if (entry === undefined) return { state: "unknown" };
    const { outcome } = entry;
    switch (outcome.state) {
      case "waiting":
      case "claimed": {
        const left = entry.expiresAt - this.now();
        if (outcome.state === "waiting" && left <= 0) return { state: "expired" };
        return { state: "waiting", expiresInMs: Math.max(0, left) };
      }
      case "registered":
        return { state: "registered", runner: outcome.runner };
      case "failed":
        return { state: "failed", problem: outcome.problem, detail: outcome.detail };
    }
  }

  private forgetOld(now: number): void {
    for (const entry of this.byId.values()) {
      if (now - entry.issuedAt > FORGET_AFTER_MS) this.revoke(entry.id);
    }
  }
}

const accountSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/u);
const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u);
const orcaPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(isAbsolute)
  .refine((value) => !/["\n\r]/u.test(value));
const nameSchema = z.string().trim().min(1).max(100);
const detailSchema = z
  .string()
  .optional()
  .transform((value) => {
    const text = (value ?? "").replace(/\s+/gu, " ").trim();
    if (text === "") return null;
    return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
  });

const tokenOnly = z.object({ token: z.string().min(1).max(200) });

const reportSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ready"),
    name: nameSchema,
    host: hostSchema,
    account: accountSchema,
    hostKey: z.string().max(4000),
    orcaPath: orcaPathSchema,
    github: z.enum(GITHUB_SETUP_RESULTS).catch("gh-failed"),
  }),
  z.object({
    outcome: z.literal("failed"),
    problem: z.enum(REPORTED_PROBLEMS),
    detail: detailSchema,
  }),
]);

export type EnrollmentReply =
  | { status: 200; kind: "registered"; name: string }
  | { status: 200; kind: "failure-recorded" }
  | { status: 400; kind: "invalid-report" }
  | { status: 403; kind: "unknown" }
  | { status: 410; kind: "expired" | "used" }
  | { status: 500; kind: "register-failed" };

export interface EnrollmentContext extends SettingsContext {
  enrollments: RunnerEnrollments;
  ssh: GangerSsh | null;
}

export function receiveEnrollment(
  context: EnrollmentContext,
  body: unknown,
  now: Date,
): EnrollmentReply {
  const auth = tokenOnly.safeParse(body);
  if (!auth.success) return { status: 403, kind: "unknown" };
  const claimed = context.enrollments.claim(auth.data.token);
  if (!claimed.ok) {
    return claimed.refusal === "unknown"
      ? { status: 403, kind: "unknown" }
      : { status: 410, kind: claimed.refusal };
  }
  const { id } = claimed;
  const report = reportSchema.safeParse(body);
  if (!report.success) {
    context.enrollments.finish(id, { state: "failed", problem: "invalid-report", detail: null });
    return { status: 400, kind: "invalid-report" };
  }
  if (report.data.outcome === "failed") {
    context.enrollments.finish(id, {
      state: "failed",
      problem: report.data.problem,
      detail: report.data.detail,
    });
    return { status: 200, kind: "failure-recorded" };
  }
  const ready = report.data;
  const hostKey = parsePublicKey(ready.hostKey);
  if (hostKey === null) {
    context.enrollments.finish(id, {
      state: "failed",
      problem: "host-key-missing",
      detail: null,
    });
    return { status: 400, kind: "invalid-report" };
  }
  const sshTarget = `${ready.account}@${ready.host}`;
  try {
    if (context.ssh === null) throw new Error("Ganger home is unknown");
    const access = context.ssh.pinHostKey(ready.host, hostKey);
    const runnerId = saveGangerRunner(
      context,
      { name: ready.name, sshTarget, orcaPath: ready.orcaPath, access },
      now,
    );
    const stored = listRunners(context.db).find((runner) => runner.id === runnerId);
    const name = stored?.name ?? ready.name;
    context.enrollments.finish(id, {
      state: "registered",
      runner: {
        id: runnerId,
        name,
        sshTarget,
        orcaPath: ready.orcaPath,
        capacity: stored?.capacity ?? THIS_MAC_CAPACITY,
        github: ready.github,
      },
    });
    return { status: 200, kind: "registered", name };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    context.enrollments.finish(id, {
      state: "failed",
      problem: "register-failed",
      detail: detail.slice(0, DETAIL_LIMIT),
    });
    return { status: 500, kind: "register-failed" };
  }
}

export function enrollmentReplyText(reply: EnrollmentReply): string {
  switch (reply.kind) {
    case "registered":
      return `Ganger: registered ${reply.name} as a runner. Ganger is checking it now; see the Ganger screen.\n`;
    case "failure-recorded":
      return "Ganger: sent the problem to the Ganger screen.\n";
    case "invalid-report":
      return "Ganger: the server could not read this Mac's details.\n";
    case "unknown":
      return "Ganger: this command is not valid. Get a new command on the Ganger screen.\n";
    case "expired":
      return "Ganger: this command expired after 10 minutes. Get a new command on the Ganger screen.\n";
    case "used":
      return "Ganger: this command was already used. Get a new command on the Ganger screen.\n";
    case "register-failed":
      return "Ganger: the server could not save the runner. See the Ganger screen.\n";
  }
}

export type StartEnrollmentResult =
  | {
      ok: true;
      id: string;
      expiresInMs: number;
      command: string;
      reviewCommand: string;
      scriptPath: string;
    }
  | { ok: false; reason: "no-web-address" | "no-home" | "keygen-failed" };

export interface StartEnrollmentInput {
  enrollments: RunnerEnrollments;
  ssh: GangerSsh | null;
  webAddress: string | null;
  replacing?: string | undefined;
}

export async function startEnrollment(input: StartEnrollmentInput): Promise<StartEnrollmentResult> {
  if (input.replacing !== undefined) input.enrollments.revoke(input.replacing);
  if (input.webAddress === null || !URL.canParse(input.webAddress)) {
    return { ok: false, reason: "no-web-address" };
  }
  if (input.ssh === null) return { ok: false, reason: "no-home" };
  const key = await input.ssh.publicKey();
  if (!key.ok) return { ok: false, reason: "keygen-failed" };
  const issued = input.enrollments.issue();
  const scriptUrl = setupScriptUrl(input.webAddress, issued.token);
  const { pathname, search } = new URL(scriptUrl);
  return {
    ok: true,
    id: issued.id,
    expiresInMs: issued.expiresInMs,
    command: setupCommand(scriptUrl),
    reviewCommand: reviewFirstCommand(scriptUrl),
    scriptPath: `${pathname}${search}`,
  };
}

export interface SetupScriptRequest {
  enrollments: RunnerEnrollments;
  ssh: GangerSsh | null;
  webAddress: string | null;
  token: string | null;
}

export async function setupScriptFor(request: SetupScriptRequest): Promise<string | null> {
  if (request.token === null || !request.enrollments.usable(request.token)) return null;
  if (request.webAddress === null || request.ssh === null) return null;
  const key = await request.ssh.publicKey();
  if (!key.ok) return null;
  return renderSetupScript({
    serverUrl: request.webAddress,
    token: request.token,
    publicKey: key.publicKey,
  });
}
