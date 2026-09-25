# Open Source Maintenance Bot

Self-hostable GitHub App that finds safe maintenance improvements, uses Claude Code or Codex in an isolated job, and opens reviewable pull requests.

## Safety model

- Repositories opt in with `.github/open-source-bot.yml`.
- Public discovery is read-only until a repository owner installs and enables the App.
- The bot creates branches and pull requests; it never writes to the default branch or merges.
- Repository content is untrusted input. Agent jobs run without GitHub credentials and with network disabled by default.
- A PR is not published when validation is unavailable, the patch is too large, or the base branch changed.

## Local setup

1. Copy `.env.example` to `.env` and configure a GitHub App, its private key, and webhook secret.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Apply `db/migrations/001_init.sql` using your migration tool or `psql`.
4. Install dependencies and run `npm run check`.
5. Start the API with `npm run dev` and the worker with `npm run worker`.

In container deployments, the trusted worker needs access to the host Docker socket to launch short-lived sandboxes. Do not expose that socket to the API or agent containers; use a dedicated host or runner if the worker is not fully trusted.

The GitHub App needs repository metadata read access, contents read/write, pull requests read/write, and checks read access. Subscribe it to `push`, `pull_request`, `check_run`, and `check_suite` events.

## CLI

```bash
npm run cli -- scan owner/repo --sha <commit-sha>
npm run cli -- discover --query 'topic:typescript archived:false'
```

Discovery only reports public candidates and never writes to a repository.

## Agent image

The worker expects an `AGENT_IMAGE` containing the selected CLI and its user-provided credentials. Build or provide a hardened image containing `codex` and/or `claude`. The worker passes only the repository workspace and task prompt into that container.
