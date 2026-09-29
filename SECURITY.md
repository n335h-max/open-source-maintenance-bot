# Security model

This project treats repository content, issue text, pull-request text, and generated agent output as untrusted input.

## Trust boundaries

The GitHub App and worker are trusted application components. Agent jobs are not trusted: they may inspect and edit only the mounted repository workspace, and their output must pass policy and validation before a pull request is published.

The production deployment must enforce these controls:

- Agent containers use a versioned or digest-pinned `AGENT_IMAGE`; `latest` is rejected.
- Agent containers run as an unprivileged UID, with a read-only root filesystem, dropped Linux capabilities, no-new-privileges, a process limit, CPU/memory limits, and a writable `noexec` temporary filesystem only where required.
- Agent containers use `--network=none` unless a separately reviewed capability is introduced.
- GitHub tokens, App private keys, webhook secrets, and the Docker socket are never mounted or passed to agent containers.
- The Docker socket is available only to the trusted worker launcher, never to the API or agent containers.
- The worker publishes a pull request only after policy checks, validation, patch-size checks, and base-branch freshness checks succeed.

## Reporting

Please do not report security issues in public issues. Contact the repository owner privately with reproduction steps, impact, and a proposed mitigation.
