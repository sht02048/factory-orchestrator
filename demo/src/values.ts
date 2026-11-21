export const FAIL_AUTH = "invalid";
export const FAIL_OFFLINE = "offline";
export const FAIL_NO_ORCA = "no-orca";
export const FAIL_PUSH_AUTH = "push-auth";
export const SLOW_CHECK = "slow";
export const SLOW_CHECK_MS = 20_000;
export const DEV_CHANNEL = "ganger-dev";
export const ASK_QUERY_DEVTOOLS = "ask-query-devtools";

export const DEMO_WEB_ADDRESS = "https://orchestrator.example.ts.net";
export const DEMO_WEBHOOK_ADDRESS = "https://hooks.example.com";
export const DEMO_TAILNET_HOST = "ganger.example.ts.net";

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

export const DEMO_WORKSPACE_BRIEF = {
  before: "Read AGENTS.md and README.md before you change any code.",
  after: [
    "Finish by pushing the branch and opening a pull request to develop.",
    "Run the project checks and write their results in the pull request body.",
  ].join("\n"),
};
