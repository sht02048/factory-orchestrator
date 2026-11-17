# Factory Orchestrator

The control tower of a software factory. It assigns tickets from a tracker to runners, and shows the status and statistics of the runs in which the runners' agents work on those tickets. Terms are defined in [`GLOSSARY.md`](./GLOSSARY.md), and key decisions are recorded in [`docs/adr/`](./docs/adr/).

## Structure

| Path                       | Role                                                                                      | Status  |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `apps/web`                 | UI, server functions, and the Linear webhook receiver (TanStack Start)                    | Started |
| `apps/worker`              | Long-running daemon for the assignment queue, runner commands, and run and PR polling     | Stub    |
| `apps/cli`                 | `init`, `start`, and launchd/systemd service registration                                 | Planned |
| `packages/core`            | Domain logic and the Tracker, Runner, and CodeHost adapter interfaces                     | Stub    |
| `packages/db`              | SQLite (WAL) schema, access, and migrations                                               | Started |
| `packages/ui`              | Design system (StyleX + UI SDK)                                                           | Started |
| `packages/tracker-linear`  | Tracker adapter for Linear (GraphQL API and webhooks)                                     | Planned |
| `packages/runner-orca`     | Runner adapter that runs `orca` on a remote runner over ssh                               | Planned |
| `packages/codehost-github` | Code host adapter for GitHub (finding pull requests and reading their state and CI state) | Planned |
| `e2e`                      | End-to-end tests with fake adapters, including operator actions in a real browser         | Started |

"Planned" paths do not exist in the repository yet. `packages/ui` holds the design system: tokens, components, and the usage rules in [`packages/ui/DESIGN.md`](./packages/ui/DESIGN.md). `apps/web` only has a design system preview (`/ds`) so far, and the stub packages have no real code yet.

## Getting started

You need Node 24 LTS and the pnpm version set in the `packageManager` field of `package.json`.

```sh
nvm use
pnpm install   # also installs the lefthook pre-commit hook
```

## Commands

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `pnpm typecheck`    | Type-checks every package with TypeScript 7 (`tsc`) |
| `pnpm lint`         | Runs oxlint in type-aware mode                      |
| `pnpm format`       | Formats with oxfmt                                  |
| `pnpm format:check` | Checks formatting                                   |
| `pnpm test`         | Runs Vitest (browser tests need Google Chrome)      |
| `pnpm check:colors` | Checks for raw color values outside `packages/ui`   |
| `pnpm build`        | Builds the web app for production                   |
| `pnpm smoke:web`    | Starts the production web build and checks a page   |

The browser tests in `e2e` drive the Google Chrome installed on the machine through `playwright-core`; they do not download a browser. GitHub's Ubuntu runners already have Chrome. When a browser test fails, a screenshot of the page is saved to `e2e/test-results/`, and CI uploads it as an artifact.

Start the web app with `pnpm --filter @factory/web dev` and open `http://127.0.0.1:3000/ds` to see the design system. Run the production build with `pnpm --filter @factory/web start`. It binds to `127.0.0.1` by default. To change that, set the shell environment variables `WEB_HOST` and `WEB_PORT` (for example, `WEB_PORT=4000 pnpm --filter @factory/web start`).

The pre-commit hook runs lint, format check, typecheck, and the color literal check. CI (GitHub Actions) runs on pull requests and on pushes to `main`, in this order: typecheck → lint → color literal check → format check → test → build → web production smoke test.

## Self-hosting

> There is nothing to run yet. Installation and upgrade steps will be added here once there is.

The orchestrator is a self-hosted tool. One operator runs one installation on their own machine. The planned setup:

- `apps/web` and `apps/worker` run on the same machine and share one SQLite file.
- A runner is an Orca environment that the orchestrator can reach over ssh.
- The orchestrator does not change your projects' agent settings. We recommend adding a rule to each project's agent instructions (for example, `AGENTS.md`) to put the ticket key in the pull request title. Otherwise, if an agent opens the pull request from a branch other than the one the orchestrator created (including by renaming that branch), the orchestrator may not find it and may record the run's pull request as missing or closed.
- Tracker connections, the GitHub token, runners, workspaces, and mappings are set up in web onboarding on first launch. Tokens are stored encrypted in the database.
- `.env` holds only the minimum values needed to boot: port, bind address, data path, and encryption key. Copy [`.env.example`](./.env.example) to `.env` and replace the values with your own. Generate the encryption key with `openssl rand -base64 32`. `packages/db` parses these values from the shell environment (`parseBootConfig`), but nothing loads `.env` automatically yet.

## Work items

Work is tracked as local tickets in [`docs/tickets/`](./docs/tickets/) instead of in a tracker.

## License

[MIT](./LICENSE)
