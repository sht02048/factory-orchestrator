import { DEFAULT_ORCA_PATH, serviceInstallArgs } from "@ganger/runner-orca";
import { publicKeyLineOf } from "./ganger-ssh.js";
import type { PublicKey } from "./ganger-ssh.js";
import { SHARING_SETTINGS_URL } from "./model.js";

import {
  ENROLLMENT_PATH,
  PROGRESS_ENV,
  PROGRESS_FAIL_PREFIX,
  PROGRESS_GITHUB_PREFIX,
  PROGRESS_STEP_PREFIX,
  SETUP_SCRIPT_PATH,
} from "./enrollment-protocol.js";

export { ENROLLMENT_PATH, PROGRESS_ENV, SETUP_SCRIPT_PATH } from "./enrollment-protocol.js";
export const SETUP_SCRIPT_TOKEN_PARAM = "t";
export const SYSTEM_HOST_KEY_FILE = "/etc/ssh/ssh_host_ed25519_key.pub";
export const SCRIPT_FILE_NAME = "ganger-runner-setup.sh";
const REMOTE_LOGIN_TRIES = 150;
const GH_CANDIDATES = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
const TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export interface SetupScriptInput {
  serverUrl: string;
  token: string;
  publicKey: PublicKey;
  defaultOrcaPath?: string;
  hostKeyFile?: string;
  remoteLoginTries?: number;
  ghCandidates?: ReadonlyArray<string>;
  tailscaleApp?: string;
}

export function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function serverBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/u, "");
}

export function setupScriptUrl(serverUrl: string, token: string): string {
  const url = new URL(`${serverBase(serverUrl)}${SETUP_SCRIPT_PATH}`);
  url.searchParams.set(SETUP_SCRIPT_TOKEN_PARAM, token);
  return url.toString();
}

export function setupCommand(scriptUrl: string): string {
  return `curl -fsSL ${shellLiteral(scriptUrl)} | sh`;
}

export function reviewFirstCommand(scriptUrl: string): string {
  return [
    `curl -fsSL ${shellLiteral(scriptUrl)} -o ${SCRIPT_FILE_NAME}`,
    `less ${SCRIPT_FILE_NAME}`,
    `sh ${SCRIPT_FILE_NAME}`,
  ].join(" && ");
}

const ORCA_VARIABLE = "__ORCA__";

function serviceInstallLine(): string {
  return serviceInstallArgs(ORCA_VARIABLE)
    .map((arg) => (arg === ORCA_VARIABLE ? `"$orca"` : shellLiteral(arg)))
    .join(" ");
}

export function renderSetupScript(input: SetupScriptInput): string {
  const settings = [
    ["GANGER_URL", serverBase(input.serverUrl)],
    ["GANGER_TOKEN", input.token],
    ["GANGER_KEY", publicKeyLineOf(input.publicKey)],
    ["GANGER_KEY_BODY", input.publicKey.body],
    ["DEFAULT_ORCA", input.defaultOrcaPath ?? DEFAULT_ORCA_PATH],
    ["HOST_KEY_FILE", input.hostKeyFile ?? SYSTEM_HOST_KEY_FILE],
    ["SHARING_URL", SHARING_SETTINGS_URL],
    ["ENROLL_URL", `${serverBase(input.serverUrl)}${ENROLLMENT_PATH}`],
    ["REMOTE_LOGIN_TRIES", String(input.remoteLoginTries ?? REMOTE_LOGIN_TRIES)],
    ["TAILSCALE_APP", input.tailscaleApp ?? TAILSCALE_APP],
  ]
    .map(([name, value]) => `${name}=${shellLiteral(value ?? "")}`)
    .join("\n");
  return `#!/bin/sh
set -u
PATH="$PATH:/usr/sbin:/sbin"
${settings}

say() { printf '%s\\n' "$*"; }

progress() {
  [ "\${${PROGRESS_ENV}:-}" = 1 ] && printf '%s%s\\n' "$1" "$2"
  return 0
}

step() { progress ${shellLiteral(PROGRESS_STEP_PREFIX)} "$1"; }

report_failure() {
  printf '%s' "$GANGER_TOKEN" | curl -fsS -o /dev/null -X POST "$ENROLL_URL" \\
    --data-urlencode 'token@-' \\
    --data-urlencode 'outcome=failed' \\
    --data-urlencode "problem=$1" \\
    --data-urlencode "detail=$2" >/dev/null 2>&1 || true
}

fail() {
  trap - INT TERM
  progress ${shellLiteral(PROGRESS_FAIL_PREFIX)} "$1"
  say "Ganger: $3" >&2
  report_failure "$1" "$2"
  say "Ganger: get a new command on the Ganger screen and run it again." >&2
  exit 1
}

remote_login_on() {
  nc -z -G 2 127.0.0.1 22 </dev/null >/dev/null 2>&1
}

stop_on_signal() {
  trap - INT TERM
  report_failure canceled ""
  progress ${shellLiteral(PROGRESS_FAIL_PREFIX)} canceled
  say "Ganger: stopped before this Mac was registered." >&2
  exit 130
}

wait_for_remote_login() {
  remote_login_on && return 0
  step remote-login-wait
  say "Remote Login is off. Opening System Settings > General > Sharing."
  say "Turn on Remote Login there. Ganger waits for it here."
  open "$SHARING_URL" </dev/null >/dev/null 2>&1 || true
  tries=0
  while [ "$tries" -lt "$REMOTE_LOGIN_TRIES" ]; do
    sleep 2
    remote_login_on && return 0
    tries=$((tries + 1))
  done
  fail remote-login-off "" "Remote Login is still off."
}

find_orca() {
  if [ -x "$DEFAULT_ORCA" ]; then
    printf '%s\\n' "$DEFAULT_ORCA"
    return 0
  fi
  found=$(command -v orca 2>/dev/null) || return 1
  case "$found" in
    /*) [ -x "$found" ] && printf '%s\\n' "$found" ;;
    *) return 1 ;;
  esac
}

find_tailscale() {
  found=$(command -v tailscale 2>/dev/null) && { printf '%s\\n' "$found"; return 0; }
  [ -x "$TAILSCALE_APP" ] && printf '%s\\n' "$TAILSCALE_APP"
}

tailnet_address() {
  ts=$(find_tailscale) || return 1
  [ -n "$ts" ] || return 1
  dns=$("$ts" status --json </dev/null 2>/dev/null | plutil -extract Self.DNSName raw -o - - 2>/dev/null)
  dns=\${dns%.}
  if [ -n "$dns" ]; then
    printf '%s\\n' "$dns"
    return 0
  fi
  "$ts" ip -4 </dev/null 2>/dev/null | head -n 1
}

authorize_ganger_key() {
  ssh_dir="$HOME/.ssh"
  file="$ssh_dir/authorized_keys"
  mkdir -p "$ssh_dir" && chmod 700 "$ssh_dir" || return 1
  if [ -f "$file" ] && grep -qF "$GANGER_KEY_BODY" "$file"; then
    chmod 600 "$file"
    return 0
  fi
  if [ -s "$file" ] && [ -n "$(tail -c 1 "$file")" ]; then
    printf '\\n' >>"$file" || return 1
  fi
  printf '%s\\n' "$GANGER_KEY" >>"$file" && chmod 600 "$file"
}

find_gh() {
  found=$(command -v gh 2>/dev/null) && { printf '%s\\n' "$found"; return 0; }
  for candidate in ${(input.ghCandidates ?? GH_CANDIDATES).map(shellLiteral).join(" ")}; do
    [ -x "$candidate" ] && { printf '%s\\n' "$candidate"; return 0; }
  done
  return 1
}

setup_github() {
  gh_bin=$(find_gh) || { github=gh-missing; return 0; }
  if ! "$gh_bin" auth status --hostname github.com </dev/null >/dev/null 2>&1; then
    github=gh-logged-out
    return 0
  fi
  if "$gh_bin" auth token --hostname github.com </dev/null 2>/dev/null |
    "$gh_bin" auth login --hostname github.com --insecure-storage --with-token >/dev/null 2>&1 &&
    "$gh_bin" auth setup-git --hostname github.com </dev/null >/dev/null 2>&1; then
    github=done
  else
    github=gh-failed
  fi
}

main() {
  trap stop_on_signal INT TERM
  say "Ganger: setting up this Mac as a runner for $GANGER_URL"
  wait_for_remote_login
  step remote-login
  say "  - Remote Login is on"

  orca=$(find_orca) || fail orca-not-found "" "Could not find Orca. Install the Orca app and try again."
  say "  - Found Orca at $orca"

  host=$(tailnet_address)
  [ -n "$host" ] || fail tailscale-missing "" "Could not read this Mac's tailnet address. Connect Tailscale and try again."
  say "  - Tailnet address: $host"

  host_key=$(head -n 1 "$HOST_KEY_FILE" 2>/dev/null)
  [ -n "$host_key" ] || fail host-key-missing "$HOST_KEY_FILE" "Could not read $HOST_KEY_FILE."

  authorize_ganger_key || fail authorized-keys-failed "" "Could not add the Ganger key to ~/.ssh/authorized_keys."
  step key
  say "  - Added the Ganger key to ~/.ssh/authorized_keys"

  service_log=$(mktemp)
  if ! ${serviceInstallLine()} </dev/null >"$service_log" 2>&1; then
    detail=$(tail -n 3 "$service_log" | tr '\\n' ' ')
    rm -f "$service_log"
    fail service-failed "$detail" "Could not install the Orca background service: $detail"
  fi
  rm -f "$service_log"
  step service
  say "  - Installed the Orca background service"

  setup_github
  progress ${shellLiteral(PROGRESS_GITHUB_PREFIX)} "$github"
  step github
  case "$github" in
    done) say "  - Set up GitHub sign-in for git" ;;
    gh-missing) say "  - Skipped GitHub: gh is not installed" ;;
    gh-logged-out) say "  - Skipped GitHub: gh is not signed in" ;;
    *) say "  - Could not set up GitHub sign-in for git" ;;
  esac

  name=$(scutil --get ComputerName 2>/dev/null </dev/null || hostname -s)
  account=$(id -un)
  trap '' INT TERM
  printf '%s' "$GANGER_TOKEN" | curl -sS --fail-with-body -X POST "$ENROLL_URL" \\
    --data-urlencode 'token@-' \\
    --data-urlencode 'outcome=ready' \\
    --data-urlencode "name=$name" \\
    --data-urlencode "host=$host" \\
    --data-urlencode "account=$account" \\
    --data-urlencode "hostKey=$host_key" \\
    --data-urlencode "orcaPath=$orca" \\
    --data-urlencode "github=$github"
  sent=$?
  if [ "$sent" -eq 0 ]; then
    step report
    exit 0
  fi
  if [ "$sent" -eq 22 ]; then
    progress ${shellLiteral(PROGRESS_FAIL_PREFIX)} refused
  else
    progress ${shellLiteral(PROGRESS_FAIL_PREFIX)} unreachable
    say "Ganger: could not reach $GANGER_URL. Check that both Macs are on the same tailnet." >&2
  fi
  exit 1
}

main "$@"
`;
}
