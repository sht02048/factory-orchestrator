# Runners

A runner is an Orca environment that the orchestrator can reach over ssh.

## Add another Mac

- To add another Mac that has the Ganger desktop app, pick **Another Mac · it has the Ganger app** in onboarding or under Runners > Add runner. A Ganger app on that Mac that is connected to this server (**Connect to another server**) asks "Register this Mac as a runner?"; press Register there and the app runs the same setup script as the terminal command and shows its progress. The request lasts 10 minutes, and only one Mac can take it. The app on the Mac that runs the server never asks.
- To add another Mac as a runner, pick **Another Mac · terminal command** in onboarding or under Runners > Add runner. Ganger shows a one-line `curl … | sh` command that works once within 10 minutes. It needs Orca on that Mac, the same tailnet, and the address other devices use to reach this server (Settings > Addresses).

## Put the ticket key in pull request titles

The orchestrator does not change your projects' agent settings. We recommend adding a rule to each project's agent instructions (for example, `AGENTS.md`) to put the ticket key in the pull request title. Otherwise, if an agent opens the pull request from a branch other than the one the orchestrator created (including by renaming that branch), the orchestrator may not find it and may record the run's pull request as missing or closed.
