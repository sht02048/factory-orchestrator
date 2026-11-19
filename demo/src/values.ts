export const FAIL_AUTH = "invalid";
export const FAIL_OFFLINE = "offline";
export const FAIL_NO_ORCA = "no-orca";
export const FAIL_PUSH_AUTH = "push-auth";
export const SLOW_CHECK = "slow";
export const SLOW_CHECK_MS = 20_000;

export const DEMO_WEB_ADDRESS = "https://orchestrator.example.ts.net";
export const DEMO_WEBHOOK_ADDRESS = "https://hooks.example.com";

export const PREFILL: Readonly<Record<string, string>> = {
  name: "Acme",
  apiKey: "lin_api_demo_acme",
  webhookSecret: "lin_wh_demo_acme",
  token: "github_pat_demo",
  sshTarget: "runner-a.example.com",
  orcaPath: "orca",
  capacity: "4",
  webAddress: DEMO_WEB_ADDRESS,
  webhookAddress: DEMO_WEBHOOK_ADDRESS,
};

export const PREFILL_RUNNER_NAME = "runner-a";
