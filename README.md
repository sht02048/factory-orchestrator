# Factory Orchestrator

The control tower of a software factory. It assigns tickets from a tracker to runners, and shows the status and statistics of the runs in which the runners' agents work on those tickets. Terms are defined in [`GLOSSARY.md`](./GLOSSARY.md), and key decisions are recorded in [`docs/adr/`](./docs/adr/).

## Structure

| Path                       | Role                                                                                      | Status  |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `apps/web`                 | UI, server functions, and the Linear webhook receiver (TanStack Start)                    | Started |
| `apps/worker`              | Long-running daemon for the assignment queue, runner commands, and run and PR polling     | Started |
| `apps/cli`                 | `init`, `start`, and launchd/systemd service registration                                 | Started |
| `packages/core`            | Domain logic and the Tracker, Runner, and CodeHost adapter interfaces                     | Stub    |
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

| Command             | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `pnpm dev`    | Runs the web app (hot reload) and the worker with fake adapters |
| `pnpm typecheck`    | Type-checks every package with TypeScript 7 (`tsc`)           |
| `pnpm lint`         | Runs oxlint in type-aware mode                                |
| `pnpm format`       | Formats with oxfmt                                            |
| `pnpm format:check` | Checks formatting                                             |
| `pnpm test`         | Runs Vitest (browser tests need Google Chrome)                |
| `pnpm check:colors` | Checks for raw color values outside `packages/ui`             |
| `pnpm build`        | Builds the web app, the worker, and the CLI                   |
| `pnpm smoke:web`    | Starts the production web build and checks a page             |
| `pnpm smoke:cli`    | Runs the built CLI's `init` and `start` and checks a page     |
| `pnpm bundle`       | Packs the builds into a server bundle in `dist/`              |
| `pnpm smoke:bundle` | Extracts the server bundle outside the repository and runs it |

The browser tests in `e2e` drive the Google Chrome installed on the machine through `playwright-core`; they do not download a browser. GitHub's Ubuntu runners already have Chrome. When a browser test fails, a screenshot of the page is saved to `e2e/test-results/`, and CI uploads it as an artifact.

### Development

`pnpm dev` starts the web app in development mode (hot reload) and the worker in one process. The tracker, the runners, and the code host are fake adapters, so it needs no Linear key, ssh access, or GitHub token, and it never reaches those services. By default it opens on the home screen of a finished setup with sample data: two tracker connections and workspaces, three runners (one online, one with broken GitHub authentication, one offline), runs in every state, and two weeks of past runs for Stats. The fake agents keep working over time: they ask questions now and then, open pull requests, and send completion reports. Answer questions, cancel runs, and assign tickets in the app as usual.

- `pnpm dev --onboarding` starts from step 1 of onboarding with an empty database. **Fill with fake values** (bottom right) fills the form fields with values that pass every check. To see a failed check, put `invalid` in a key or token, or `offline`, `no-orca`, or `push-auth` in the runner's ssh target.
- `--reset` deletes the data of that mode and starts over. `--static` stops the fake agents from moving on their own.
- `/__dev` (the **Dev tools** link at the bottom right) labels a ticket for auto-assignment, adds a ticket, makes an agent ask a question, and fixes or breaks a runner's GitHub authentication.
- Data lives in `.dev/<mode>/` in the repository (ignored by git), or under `FACTORY_DEV_DIR`. It never touches `~/.factory-orchestrator`. The server binds to `127.0.0.1:3000`; set `WEB_HOST` and `WEB_PORT` to change that (for example, `WEB_HOST=0.0.0.0 pnpm dev` to open it from another machine on your network). Anyone who can reach that address can use the dev server and `/__dev`, so bind to an address only trusted machines can reach.
- The fake adapters and the dev tools are registered only by `pnpm dev`. They are not part of the production build or the CLI, and CI checks that with `pnpm check:dev-code` after the build.

`pnpm --filter @factory/web dev` still starts only the web app; open `http://127.0.0.1:3000/ds` to see the design system. Run the production build with `pnpm --filter @factory/web start`. It binds to `127.0.0.1` by default. To change that, set the shell environment variables `WEB_HOST` and `WEB_PORT` (for example, `WEB_PORT=4000 pnpm --filter @factory/web start`).

Build the worker with `pnpm --filter @factory/worker build` and start it with `pnpm --filter @factory/worker start`. It reads `DATABASE_PATH` and `ENCRYPTION_KEY` from the shell environment, applies pending database migrations, and then polls until it receives `SIGINT` or `SIGTERM`. It builds adapters from the runners, tracker connections, and code host connections stored in the database, and rebuilds an adapter when its settings change.

The pre-commit hook runs lint, format check, typecheck, and the color literal check. CI (GitHub Actions) runs on pull requests and on pushes to `main`, in this order: typecheck → lint → color literal check → format check → test → build → web production smoke test → CLI smoke test → server bundle → server bundle smoke test.

## Self-hosting

> There is no published release yet: no npm package, no GitHub Release. To run the orchestrator, build a server bundle from a clone of this repository, as described in [Build a server bundle](#build-a-server-bundle). The commands below are written as `factory-orchestrator <command>`; with a server bundle, that is `node <bundle>/cli/bin/cli.js <command>`.

The orchestrator is a self-hosted tool. One operator runs one installation on their own machine. The planned setup:

- `apps/web` and `apps/worker` run on the same machine and share one SQLite file.
- A runner is an Orca environment that the orchestrator can reach over ssh.
- The orchestrator does not change your projects' agent settings. We recommend adding a rule to each project's agent instructions (for example, `AGENTS.md`) to put the ticket key in the pull request title. Otherwise, if an agent opens the pull request from a branch other than the one the orchestrator created (including by renaming that branch), the orchestrator may not find it and may record the run's pull request as missing or closed.
- Tracker connections, the GitHub token, runners, workspaces, and mappings are set up in web onboarding on first launch. Tokens are stored encrypted in the database.
- `.env` holds only the minimum values needed to boot: port, bind address, data path, and encryption key. `factory-orchestrator init` writes it, as described below.

### Build a server bundle

A server bundle is one folder that holds the web app, the worker, and the CLI with all their runtime dependencies. It does not need the repository, `pnpm`, or `node_modules`. It does not include Node: you need Node 24 on the machine that runs it.

```sh
pnpm install
pnpm build
pnpm bundle
```

This writes `dist/factory-orchestrator-<version>/` and the same folder packed as `dist/factory-orchestrator-<version>.tar.gz`. Copy the tarball to the machine that runs the orchestrator, extract it anywhere, and run the CLI from it:

```sh
tar -xzf factory-orchestrator-<version>.tar.gz
node factory-orchestrator-<version>/cli/bin/cli.js init
node factory-orchestrator-<version>/cli/bin/cli.js start
```

To upgrade, build a new bundle, stop the orchestrator, extract the new bundle, and start it from there. The folder name includes the version, so if you run the orchestrator as a service, run `service uninstall` with the old bundle and `service install` with the new one. Your settings and data stay in the installation folder described below, not in the bundle.

You can also run the CLI straight from the repository after `pnpm build`, with `node apps/cli/dist/bin/cli.js <command>` (or `pnpm --filter @factory/cli cli <command>`).

### Set up and start

The CLI keeps its files in one installation folder: `~/.factory-orchestrator` by default, or the folder in `--home <dir>` or the `FACTORY_HOME` environment variable.

```sh
factory-orchestrator init     # writes <home>/.env with a new encryption key
factory-orchestrator start    # applies database migrations, then runs the web server and the worker
```

- `init` writes `<home>/.env` (readable only by you) with the bind address `127.0.0.1`, port `3000`, the database `<home>/data/factory-orchestrator.db`, and a newly generated encryption key. Change them with `--host`, `--port`, and `--database-path`, or edit the file later. If `.env` already exists, `init` leaves it unchanged, so the encryption key never changes by accident. If you lose or change the key, you have to enter the tokens again.
- `start` reads `<home>/.env`. Shell environment variables with the same names (`WEB_HOST`, `WEB_PORT`, `DATABASE_PATH`, `ENCRYPTION_KEY`) override it. It applies pending database migrations, starts the web server and the worker, and prints the web address once it responds. If either process exits, `start` stops the other one and exits with an error, so a service manager can restart both. `SIGINT` or `SIGTERM` stops both.
- After an upgrade, run `start` again (or restart the service). It applies new migrations before anything else starts.

### Open it from other devices

The web app has no login. Anyone who can reach its address can change settings and send commands to your runners. Keep it on `127.0.0.1` or inside a private network such as a Tailscale tailnet, and never expose the whole app to the public internet; open only the webhook path (`/api/webhooks/...`) publicly. If you share your tailnet with other people, use Tailscale ACLs to limit which users and devices can reach the orchestrator's machine.

### Run as a service

`factory-orchestrator service install` registers `start` as a background service for your user account: a launchd agent on macOS (`~/Library/LaunchAgents/factory-orchestrator.plist`) and a systemd user service on Linux (`~/.config/systemd/user/factory-orchestrator.service`). It starts at login and restarts after a failure. `factory-orchestrator service uninstall` stops it and removes the file.

- Add `--dry-run` to either command to print the file and the commands without changing anything.
- Run `init` first. `service install` refuses to register a service that would fail to boot, and refuses to overwrite an existing service file.
- The service runs the Node and CLI paths you installed it with, and uses your current `PATH`. After you move or upgrade Node, or move the server bundle to another folder, run `service uninstall` and `service install` again.
- On macOS, logs go to `<home>/logs/factory-orchestrator.log`. On Linux, read them with `journalctl --user -u factory-orchestrator.service`, and run `loginctl enable-linger` once so the service keeps running after you log out.

## Work items

Work is tracked as local tickets in [`docs/tickets/`](./docs/tickets/) instead of in a tracker.

## License

[MIT](./LICENSE)
