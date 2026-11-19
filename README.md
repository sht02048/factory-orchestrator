<p align="center">
  <img src="packages/ui/brand/mascot-default.svg" alt="" width="120">
  <br>
  <img src="packages/ui/brand/wordmark.svg" alt="Ganger" height="44">
</p>

# Ganger

Ganger is the foreman of your software factory: it hands tracker tickets to coding agents on your own runners and shows the status and statistics of every run. The artwork and the rules for using it are in the [brand guide](packages/ui/brand/README.md). Terms are defined in [`GLOSSARY.md`](./GLOSSARY.md), and key decisions are recorded in [`docs/adr/`](./docs/adr/).

## Structure

| Path                       | Role                                                                                      | Status  |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `apps/web`                 | UI, server functions, and the Linear webhook receiver (TanStack Start)                    | Started |
| `apps/worker`              | Long-running daemon for the assignment queue, runner commands, and run and PR polling     | Started |
| `apps/cli`                 | `init`, `start`, and launchd/systemd service registration                                 | Started |
| `apps/desktop`             | macOS desktop app (Electron): window, tray, and notifications; runs the server bundle     | Started |
| `packages/core`            | Domain logic and the Tracker, Runner, and CodeHost adapter interfaces                     | Stub    |
| `packages/app`             | What each screen reads and writes, shared by the web server functions and `ganger mcp`    | Started |
| `packages/db`              | SQLite (WAL) schema, access, and migrations                                               | Started |
| `packages/ui`              | Design system (StyleX + UI SDK)                                                           | Started |
| `packages/tracker-linear`  | Tracker adapter for Linear (GraphQL API and webhooks)                                     | Planned |
| `packages/runner-orca`     | Runner adapter that runs `orca` on a remote runner over ssh                               | Planned |
| `packages/codehost-github` | Code host adapter for GitHub (finding pull requests and reading their state and CI state) | Planned |
| `e2e`                      | End-to-end tests with fake adapters, including operator actions in a real browser         | Started |
| `demo`                     | The `pnpm dev` entry point: web and worker with fake adapters and seeded data             | Started |

"Planned" paths do not exist in the repository yet. `packages/ui` holds the design system: tokens, components, and the usage rules in [`packages/ui/DESIGN.md`](./packages/ui/DESIGN.md). `apps/web` only has a design system preview (`/ds`) so far, and the stub packages have no real code yet.

## Getting started

You need Node 24 LTS and the pnpm version set in the `packageManager` field of `package.json`.

```sh
nvm use
pnpm install   # also installs the lefthook pre-commit hook
```

## Commands

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `pnpm dev`           | Runs the web app (hot reload) and the worker with fake adapters |
| `pnpm typecheck`     | Type-checks every package with TypeScript 7 (`tsc`)             |
| `pnpm lint`          | Runs oxlint in type-aware mode                                  |
| `pnpm format`        | Formats with oxfmt                                              |
| `pnpm format:check`  | Checks formatting                                               |
| `pnpm test`          | Runs Vitest (browser tests need Google Chrome)                  |
| `pnpm check:colors`  | Checks for raw color values outside `packages/ui`               |
| `pnpm check:lengths` | Checks for raw px/rem/em lengths in `apps/web` styles           |
| `pnpm build`         | Builds the web app, the worker, the CLI, and the desktop app    |
| `pnpm smoke:web`     | Starts the production web build and checks a page               |
| `pnpm smoke:cli`     | Runs the built CLI's `init` and `start` and checks a page       |
| `pnpm bundle`        | Packs the builds into a server bundle in `dist/`                |
| `pnpm smoke:bundle`  | Extracts the server bundle outside the repository and runs it   |

The browser tests in `e2e` drive the Google Chrome installed on the machine through `playwright-core`; they do not download a browser. GitHub's Ubuntu runners already have Chrome. When a browser test fails, a screenshot of the page is saved to `e2e/test-results/`, and CI uploads it as an artifact.

### Development

`pnpm dev` starts the web app in development mode (hot reload) and the worker in one process. The tracker, the runners, and the code host are fake adapters, so it needs no Linear key, ssh access, or GitHub token, and it never reaches those services. By default it opens on the Dashboard of a finished setup with sample data: two tracker connections and workspaces, three runners (one online, one with broken GitHub authentication, one offline) with sample provider usage, runs in every state, and two weeks of past runs for Stats. The fake agents keep working over time: they ask questions now and then, open pull requests, and send completion reports. Answer questions, cancel runs, and assign tickets in the app as usual.

- `pnpm dev --onboarding` starts from step 1 of onboarding with an empty database. **Fill with fake values** (bottom right) fills the form fields with values that pass every check. To see a failed check, put `invalid` in a key or token, or `offline`, `no-orca`, or `push-auth` in the runner's ssh target.
- `--reset` deletes the data of that mode and starts over. `--static` stops the fake agents from moving on their own.
- `/__dev` (the **Dev tools** link at the bottom right) labels a ticket for auto-assignment, adds a ticket, makes an agent ask a question, fixes or breaks a runner's GitHub authentication, and stands in for another Mac that runs the runner setup command (or lets that command expire).
- Data lives in `.dev/<mode>/` in the repository (ignored by git), or under `GANGER_DEV_DIR`. It never touches `~/.ganger`. The server binds to `127.0.0.1:3000`; set `WEB_HOST` and `WEB_PORT` to change that (for example, `WEB_HOST=0.0.0.0 pnpm dev` to open it from another machine on your network). Anyone who can reach that address can use the dev server and `/__dev`, so bind to an address only trusted machines can reach.
- The fake adapters and the dev tools are registered only by `pnpm dev`. They are not part of the production build or the server bundle; the bundle check (`scripts/bundle-check.ts`, run by `pnpm bundle` and `pnpm smoke:bundle`) fails if fake adapters or dev-only values end up in the bundle.

`pnpm --filter @ganger/web dev` still starts only the web app; open `http://127.0.0.1:3000/ds` to see the design system. Run the production build with `pnpm --filter @ganger/web start`. It binds to `127.0.0.1` by default. To change that, set the shell environment variables `WEB_HOST` and `WEB_PORT` (for example, `WEB_PORT=4000 pnpm --filter @ganger/web start`).

Build the worker with `pnpm --filter @ganger/worker build` and start it with `pnpm --filter @ganger/worker start`. It reads `DATABASE_PATH` and `ENCRYPTION_KEY` from the shell environment, applies pending database migrations, and then polls until it receives `SIGINT` or `SIGTERM`. It builds adapters from the runners, tracker connections, and code host connections stored in the database, and rebuilds an adapter when its settings change. Started on its own like this, the worker picks up changes made in the web app (assignments, cancellations, answers, settings, tracker webhooks) only at its next poll, about every 10 seconds. Started by `ganger start` (which the service and the desktop app also use) or by `pnpm dev`, the web app wakes the worker right after each change, so the worker handles it within about a second.

The pre-commit hook runs lint, format check, typecheck, and the color literal check. CI (GitHub Actions) runs on pull requests and on pushes to `main`, in this order: typecheck → lint → color literal check → format check → test → build → web production smoke test → CLI smoke test → server bundle → server bundle smoke test.

## Self-hosting

> The server bundle is not published: there is no npm package and no server download. The macOS app is published on GitHub Releases (see [Desktop app (macOS)](#desktop-app-macos)). To run the orchestrator as a service, build a server bundle from a clone of this repository, as described in [Build a server bundle](#build-a-server-bundle). The commands below are written as `ganger <command>`; with a server bundle, that is `node <bundle>/cli/bin/cli.js <command>`.

The orchestrator is a self-hosted tool. One operator runs one installation on their own machine. The planned setup:

- `apps/web` and `apps/worker` run on the same machine and share one SQLite file.
- A runner is an Orca environment that the orchestrator can reach over ssh.
- To add another Mac that has the Ganger desktop app, pick **Another Mac · it has the Ganger app** in onboarding or under Runners > Add runner. A Ganger app on that Mac that is connected to this server (**Connect to another server**) asks "Register this Mac as a runner?"; press Register there and the app runs the same setup script as the terminal command and shows its progress. The request lasts 10 minutes, and only one Mac can take it. The app on the Mac that runs the server never asks.
- To add another Mac as a runner, pick **Another Mac · terminal command** in onboarding or under Runners > Add runner. Ganger shows a one-line `curl … | sh` command that works once within 10 minutes. It needs Orca on that Mac, the same tailnet, and the address other devices use to reach this server (Settings > Addresses).
- The orchestrator does not change your projects' agent settings. We recommend adding a rule to each project's agent instructions (for example, `AGENTS.md`) to put the ticket key in the pull request title. Otherwise, if an agent opens the pull request from a branch other than the one the orchestrator created (including by renaming that branch), the orchestrator may not find it and may record the run's pull request as missing or closed.
- Tracker connections, the GitHub token, runners, workspaces, and mappings are set up in web onboarding on first launch. Tokens are stored encrypted in the database.
- `.env` holds only the minimum values needed to boot: port, bind address, data path, and encryption key. `ganger init` writes it, as described below. The addresses that other devices and your tracker use are set in Settings, as described in [Open it from other devices](#open-it-from-other-devices).

### Build a server bundle

A server bundle is one folder that holds the web app, the worker, and the CLI with all their runtime dependencies. It does not need the repository, `pnpm`, or `node_modules`. It does not include Node: you need Node 24 on the machine that runs it.

```sh
pnpm install
pnpm build
pnpm bundle
```

This writes `dist/ganger-<version>/` and the same folder packed as `dist/ganger-<version>.tar.gz`. Copy the tarball to the machine that runs the orchestrator, extract it anywhere, and run the CLI from it:

```sh
tar -xzf ganger-<version>.tar.gz
node ganger-<version>/cli/bin/cli.js init
node ganger-<version>/cli/bin/cli.js start
```

To upgrade, build a new bundle, stop the orchestrator, extract the new bundle, and start it from there. The folder name includes the version, so if you run the orchestrator as a service, run `service uninstall` with the old bundle and `service install` with the new one. Your settings and data stay in the installation folder described below, not in the bundle.

You can also run the CLI straight from the repository after `pnpm build`, with `node apps/cli/dist/bin/cli.js <command>` (or `pnpm --filter @ganger/cli cli <command>`).

### Set up and start

The CLI keeps its files in one installation folder: `~/.ganger` by default, or the folder in `--home <dir>` or the `GANGER_HOME` environment variable.

```sh
ganger init     # writes <home>/.env with a new encryption key
ganger start    # applies database migrations, then runs the web server and the worker
```

- `init` writes `<home>/.env` (readable only by you) with the bind address `127.0.0.1`, port `3000`, the database `<home>/data/ganger.db`, and a newly generated encryption key. Change them with `--host`, `--port`, and `--database-path`, or edit the file later. If `.env` already exists, `init` leaves it unchanged, so the encryption key never changes by accident. If you lose or change the key, you have to enter the tokens again.
- `start` holds a lock file, `<home>/server.lock`, while it runs, so only one `start` (one web server and one worker) runs per installation folder. A second `start` for the same folder exits with an error. A lock left behind by a process that no longer exists is taken over.
- `start` reads `<home>/.env`. Shell environment variables with the same names (`WEB_HOST`, `WEB_PORT`, `DATABASE_PATH`, `ENCRYPTION_KEY`) override it. It applies pending database migrations, starts the web server and the worker, and prints the web address once it responds. If either process exits, `start` stops the other one and exits with an error, so a service manager can restart both. `SIGINT` or `SIGTERM` stops both.
- After an upgrade, run `start` again (or restart the service). It applies new migrations before anything else starts.
- On macOS, `start` keeps the Mac from going to sleep while you are away (idle sleep) for as long as it runs, so runs keep going and webhooks still arrive. It holds the assertion with `caffeinate`, which you can see in `pmset -g assertions`, and releases it when `start` exits. If `caffeinate` fails, `start` prints a warning and keeps running. Turn it off in Settings > Sleep (stored in `<home>/power.json`); the change applies within a few seconds without a restart. On Linux, `start` does not prevent sleep.
- It cannot stop every kind of sleep. A laptop still sleeps when you close the lid, choose Sleep yourself, or run low on battery. To keep a laptop server awake with the lid closed, connect power and an external display (clamshell mode), or change the sleep settings with `pmset`. The same applies to runner Macs, which the orchestrator does not keep awake.

### Open it from other devices

The web app has no login. Anyone who can reach its address can change settings and send commands to your runners. Keep it on `127.0.0.1` or inside a private network such as a Tailscale tailnet, and never expose the whole app to the public internet; open only the webhook path (`/api/webhooks/...`) publicly. If you share your tailnet with other people, use Tailscale ACLs to limit which users and devices can reach the orchestrator's machine.

The server accepts a request only when its host name is one it knows, which blocks DNS rebinding and requests that other sites make from your browser. `127.0.0.1`, `localhost`, and `[::1]` always work, and so does the bind address (`WEB_HOST`) when it is a specific address rather than `0.0.0.0`. To use any other name, set it in Settings > Addresses (open Settings at `http://127.0.0.1:<port>` on the server machine the first time):

- **Web address**: where you open the app from other devices, for example the Tailscale Serve address `https://server.example.ts.net`. Requests to this host name reach the whole app.
- **Webhook address**: the public address your tracker sends webhooks to, for example a Tailscale Funnel or Cloudflare Tunnel address. Set it in Settings, then create the webhook in your tracker with this address followed by the connection's webhook path (shown under the tracker connection in Settings). Browser requests to this host name reach only the webhook path. Onboarding does not ask for a webhook. A webhook is optional. Without one, the worker checks the tracker for tickets with the Auto-assign Label about once a minute and assigns the ones that have never had a run. Retrying a ticket that already had a run by removing and adding the label again needs the webhook; without it, assign the ticket again from Tickets. The check only looks back 24 hours after the worker starts, so tickets labeled while the worker was stopped for longer are not picked up; assign them from Tickets.

Requests that change data (including server functions) must also come from a page on an allowed host (the `Origin` header), except the webhook path, which checks the tracker's signature instead. Rejected requests get `403` and a line in the web server log. If you upgrade an installation that you already open by another name, such as a tailnet name with `WEB_HOST=0.0.0.0`, that name is blocked until you add it as the web address. The host check protects you from web pages in your browser; it is not access control, because any other client can send whatever host name it likes. So still publish only the webhook path through your tunnel (for example, a Tailscale Funnel or Cloudflare Tunnel route for `/api/webhooks/` only). `GET /api/identity` answers on any host name with the product name, version, and installation ID, so a client can tell this server apart from other machines.

### Run as a service

`ganger service install` registers `start` as a background service for your user account: a launchd agent on macOS (`~/Library/LaunchAgents/ganger.plist`) and a systemd user service on Linux (`~/.config/systemd/user/ganger.service`). It starts at login and restarts after a failure. `ganger service uninstall` stops it and removes the file.

- Add `--dry-run` to either command to print the file and the commands without changing anything.
- Run `init` first. `service install` refuses to register a service that would fail to boot, and refuses to overwrite an existing service file.
- The service runs the Node and CLI paths you installed it with, and uses your current `PATH`. After you move or upgrade Node, or move the server bundle to another folder, run `service uninstall` and `service install` again.
- On macOS, logs go to `<home>/logs/ganger.log`. On Linux, read them with `journalctl --user -u ganger.service`, and run `loginctl enable-linger` once so the service keeps running after you log out.

### Connect an MCP client

`ganger mcp` runs an [MCP](https://modelcontextprotocol.io) server over stdin and stdout, so an agent on the same machine (for example, Hermes) can read Ganger's current state and, when you allow it, use the app's write actions. The MCP client starts the command itself; it opens no network port. It reads the database of the installation folder (`--home` or `GANGER_HOME`) directly, so it works even while the server is stopped, and every result says whether the server is running.

- The read tools cover the Dashboard summary (including runners' provider usage), tickets, runs and run detail (with the last stored lines of the log), runners and their provider usage, stats, and settings. They are marked read-only. Tools that take a workspace accept its id or name, and you can leave it out when there is only one.
- Write tools appear only after you turn on **Allow MCP writes** in Settings > MCP (off by default); turning it on or off takes effect without restarting the client. They match the app's write actions: assigning a ticket, answering a question, denying a permission request, canceling a run, refreshing a run's log, the workspace name and longest run time, adding and removing tracker projects, Mapping, the In Progress state, the Auto-assign Label, checking the tracker connection and the GitHub token again, changing an existing runner's capacity, checking a runner again, and keeping the Mac awake. Canceling a run and removing a tracker project are marked destructive.
- These stay in the app only, with no MCP tool: saving secrets (tracker API keys, webhook secrets, the GitHub token), adding a runner or changing its ssh target or Orca path, the addresses, and the **Allow MCP writes** switch itself.
- Every MCP write is recorded as "MCP · client name" (the `clientInfo.name` the client sends, shortened and with control characters removed), with the tool, the target, and the result. Requests about a run show up in that run's timeline on Run detail; other writes show up under Recent activity in Settings > MCP. When the server is stopped, writes the worker handles are saved, and the result says the server handles them when it starts.
- Results are JSON. Text that someone other than the operator wrote (ticket titles and bodies, agent questions and reports, logs) is in `external` fields, and the server instructions tell the client to treat it as data, not instructions. No result includes a secret value; settings show only whether a key or token is set.
- `ganger mcp` never applies database migrations. If the database is older than the CLI, it stops and asks you to start the server first; if it is newer, it asks you to update Ganger. It checks again before every write, so a server that migrates the database later never gets writes from an older CLI.
- Settings > MCP shows the client configuration with the absolute paths of this installation's CLI, in the Hermes `~/.hermes/config.yaml` format and the `mcpServers` JSON format, with a copy button. With the desktop app, `ganger` is not on your `PATH`, so copy it from there.

For a server bundle, the configuration looks like this (Hermes, `~/.hermes/config.yaml`):

```yaml
mcp_servers:
  ganger:
    command: "/usr/local/bin/node"
    args:
      - "/opt/ganger-0.1.0/cli/bin/cli.js"
      - "mcp"
      - "--home"
      - "/Users/you/.ganger"
```

## Desktop app (macOS)

`apps/desktop` is an Electron app with a window, a menu bar (tray) icon, and notifications. Its window shows the same web app.

### Install

1. Download `Ganger-<version>-arm64.dmg` from the Releases page of this repository on GitHub. The app runs on Macs with Apple silicon.
2. Open the dmg and drag **Ganger** onto **Applications**.
3. Open Ganger from Applications. Release builds are signed with a Developer ID and notarized by Apple, so macOS opens them without a warning.

The app does not update itself yet. To update, download the new dmg from Releases and replace the app in Applications. The server keeps running while you do. When the new app opens, it replaces a server it started with its own version; a server you run as a service keeps its version, and the app tells you that the versions differ.

### Which setup to choose

- **A machine that is always on** (a desktop or a server): run the orchestrator as a service, as described in [Run as a service](#run-as-a-service). launchd or systemd keeps it running and restarts it after a failure.
- **Your laptop**: use the desktop app's local mode (**이 기계에서 서버 돌리기**, run the server on this machine). The app starts the server in the background, separate from the app itself. Closing or quitting the app leaves the server running; only **서버도 끄고 종료** (quit and stop the server) in the tray menu stops it. **서버 멈추기** and **서버 켜기** stop and start it without quitting. While the app is open, it restarts the server if it crashes. When the laptop sleeps, the server sleeps too, so runs are only watched while the laptop is awake.
- **Another machine already runs the orchestrator**: use the desktop app's remote mode (**다른 서버에 붙기**, connect to another server) to open it and get notifications. The tray then only shows whether the server is reachable.

On a machine where the service is already installed or running for the same installation folder, the app does not start a second server: it connects to the service and only shows its status. If the service runs a different version than the app, the app tells you once.

### Build and run it locally

```sh
pnpm install
pnpm build
pnpm bundle                                                            # the server bundle the app ships
pnpm --filter @ganger/desktop exec node node_modules/electron/install.js   # downloads Electron once
pnpm --filter @ganger/desktop run package
```

This writes `apps/desktop/dist/app/Ganger-darwin-<arch>/Ganger.app` and a `.zip` of it. The app carries the server bundle unchanged in `Contents/Resources/server/` and runs it with its own Node (Electron's), so the machine does not need Node. For development, `pnpm --filter @ganger/desktop start` runs the app from the repository with the bundle in `dist/`.

A build you package yourself is not signed, so macOS asks you to confirm before it opens the first time (Control-click the app, then **Open**).

### Build a release dmg

`pnpm release:mac` builds everything, packages the app, and writes `dist/release/Ganger-<version>-<arch>.dmg`. Without signing settings, it skips signing and notarization and makes an unsigned dmg. To sign and notarize, set:

| Variable              | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `APPLE_API_KEY_PATH`  | Path to an App Store Connect API key (`.p8`)                                                      |
| `APPLE_API_KEY_ID`    | The key's Key ID                                                                                  |
| `APPLE_API_ISSUER`    | The key's Issuer ID                                                                               |
| `MACOS_SIGN_KEYCHAIN` | Optional: the keychain that holds the certificate. Without it, the default keychains are searched |

The script signs with the one valid "Developer ID Application" identity it finds in the keychain, notarizes and staples the app, then signs, notarizes, and staples the dmg. Set all three API key variables or none.

### Make a release

Releases are made by GitHub Actions. There is no changelog file; Release notes are generated from merged pull requests.

1. In the Actions tab, run **Prepare release** on `main` with the new version, without the `v` (such as `0.1.0` or `0.1.0-rc.2`). It opens a pull request from `release/v<version>` that changes the `version` in `package.json` and `apps/desktop/package.json`. The version must be higher than the current one.
2. Merge that pull request after its checks pass. On the push to `main`, **Tag release** (`.github/workflows/tag-release.yml`) sees that both versions changed to the same higher version and creates the `v<version>` tag on the merge commit.
3. The tag push starts **Release** (`.github/workflows/release.yml`). It checks that the tag matches both versions and that its commit is on `main`, runs the CI checks, builds and signs the dmg on a macOS runner with a certificate and API key from the `release` environment, verifies the signature, notarization, and Gatekeeper assessment, and then creates the Release.

A tag with a `-` (such as `v0.1.0-rc.1`) makes a prerelease, and a stable Release collects notes from the previous stable tag. Tag release does nothing when the versions did not change or the tag already points at the merge commit. It fails when only one of the two versions changed, when the version is lower, when the version is not like `1.2.3` or `1.2.3-rc.1`, or when the tag already points at another commit. Release stops before building when a Release for the tag already exists.

An administrator can still push a `v*` tag by hand to release a commit on `main`. `release.yml` can also be called from another workflow with a `tag` input, but its signing job only gets the `release` environment when the calling run is on a `v*` tag.

### Automatic releases

Tags and pull requests made with the default `GITHUB_TOKEN` do not start other workflows, so Prepare release and Tag release use a GitHub App token instead. The app's key lives in a `release-bot` environment that only `main` can use; the signing secrets stay in the `release` environment, which only `v*` tags can use. Set this up once, before you merge a version change. Replace `OWNER/REPO` with your repository.

1. Create a GitHub App (Settings > Developer settings > GitHub Apps > New GitHub App) under the account that owns the repository:
   - Homepage URL: the repository URL.
   - Webhook: clear **Active**.
   - Repository permissions: **Contents** read and write, **Pull requests** read and write. Leave everything else at no access.
   - Where can this GitHub App be installed: **Only on this account**.
2. On the app's page, note the **App ID** and generate a private key (a `.pem` file).
3. Install the app (Install App) on this repository only.
4. Create the `release-bot` environment and allow only the `main` branch to use it:

   ```sh
   gh api --method PUT repos/OWNER/REPO/environments/release-bot \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api --method POST repos/OWNER/REPO/environments/release-bot/deployment-branch-policies \
     -f name=main -f type=branch
   ```

5. Store the app ID and key in that environment, then delete the local `.pem` file:

   ```sh
   gh secret set RELEASE_APP_ID --env release-bot --repo OWNER/REPO --body <app-id>
   gh secret set RELEASE_APP_PRIVATE_KEY --env release-bot --repo OWNER/REPO < <key>.pem
   ```

6. If a ruleset limits who can create `v*` tags, add the app to its bypass list. `PUT` replaces the whole list, so this keeps the actors that are already there and adds the app:

   ```sh
   ruleset_id="$(gh api repos/OWNER/REPO/rulesets --jq '.[] | select(.name == "Release tags") | .id')"
   gh api "repos/OWNER/REPO/rulesets/$ruleset_id" \
     | jq --argjson app <app-id> '{bypass_actors: (.bypass_actors + [{actor_id: $app, actor_type: "Integration", bypass_mode: "always"}])}' \
     | gh api --method PUT "repos/OWNER/REPO/rulesets/$ruleset_id" --input -
   ```

7. Optional, recommended when pull requests can be merged without a person: require a reviewer on the `release` environment. With the app, anyone who can merge to `main` can make a tag and so start signing; a required reviewer keeps one human approval before the signing job reads the certificate. Replace `<user-id>` with your GitHub user ID (`gh api user --jq .id`):

   ```sh
   gh api --method PUT repos/OWNER/REPO/environments/release \
     -F 'reviewers[][type]=User' -F 'reviewers[][id]=<user-id>' \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   ```

Without these settings, Prepare release and Tag release stop with an error that points here. If a job runs before the `release-bot` environment exists, GitHub creates the environment without the branch rule, so do step 4 first. After you finish, re-run a failed Tag release run to create the tag.

The app uses the same installation folder as the CLI (`~/.ganger`, or `GANGER_HOME`). It writes the server's output to `<home>/logs/desktop-server.log`.

### First launch

The app asks how you want to use it:

- **이 기계에서 서버 돌리기** (run the server on this machine): the app runs `init` if needed, starts the server, and opens onboarding. It also asks whether to start the server when you log in (on by default).
- **다른 서버에 붙기** (connect to another server): the app lists the orchestrator servers in your Tailscale tailnet. It reads the device list from the Tailscale app already signed in on this Mac (`tailscale status --json`; no extra sign-in) and asks each online device `http://<device>:3000/api/identity`, then `https://<device>/api/identity`. Pick a server to open it. If Tailscale is not installed or not running, or the server uses another port, enter the port or the server's address (the **Web address** from that server's Settings > Addresses). The app remembers the server and opens it next time; if it cannot reach it, it shows that and opens the server as soon as it answers again.

We recommend serving the app to other devices with Tailscale Serve (HTTPS on the device's MagicDNS name) and setting that address as the **Web address**, as described in [Open it from other devices](#open-it-from-other-devices).

The app shows a notification when an agent asks a question, waits for a permission, a run needs a Human Check, or a runner goes Offline. It polls the server's `GET /api/attention` for these.

## Work items

Work is tracked as local tickets in [`docs/tickets/`](./docs/tickets/) instead of in a tracker.

## Contributing

The repository was renamed from `factory-orchestrator` to `ganger`. GitHub forwards the old address for now, but do not rely on that. In each clone and worktree you already have, point `origin` at the new address (replace `<owner>` with the account that owns the repository):

```sh
git remote set-url origin https://github.com/<owner>/ganger.git
git remote -v   # check that fetch and push show the new address
```

Use `git@github.com:<owner>/ganger.git` instead if you clone over ssh. Worktrees share the remote of their main clone, so running the command once per clone is enough.

## License

[MIT](./LICENSE)
