# Architecture and permissions

```text
GitHub webhook/API
        |
        v
Trusted API ----> database/queue ----> trusted worker
                                      |
                                      v
                           isolated agent container
                                      |
                                      v
                             policy + validation
                                      |
                                      v
                              reviewable pull request
```

## Permission matrix

| Component | GitHub credentials | Repository workspace | Network | Docker socket |
| --- | --- | --- | --- | --- |
| API | App credentials | None | GitHub API only | No |
| Worker | App credentials | Temporary checkout | GitHub API only | Launcher only |
| Agent | None | Mounted workspace only | Disabled | No |

## Invariants

- The default branch is never written to or merged by the bot.
- Agent output is data, not authority: repository instructions cannot grant permissions.
- Agent images are versioned or digest-pinned and are not pulled implicitly at job time.
- A patch is not published when policy, validation, size, or base-branch checks fail.
- Temporary workspaces are removed after the job completes.
