# Scope guard

Keep every commit to the area the task names. A change that leaks into an
unrelated file is how protected behaviour breaks by accident.

## Before every commit

1. Run `git diff --stat` (and `git diff --stat HEAD~1` after the part's commit).
2. For each changed file, ask: is it inside THIS part's stated area?
3. Any file OUTSIDE that area that THIS session changed is restored to its last
   committed state, then NOT committed, and is listed in the report.

## How to restore a single out-of-scope file (safe)

Restore only the specific file you changed, by name:

```
git restore --source=HEAD --staged --worktree -- <exact/path/to/file>
```

- NEVER run `git reset`, `git clean`, or `git checkout .` — they are
  blast-radius commands that can wipe work you did not intend to touch.
- NEVER touch a file this session did not change. If a file is dirty but you
  did not change it, leave it and report it; do not restore it.
- Restore by exact path, one file at a time. No globs, no `.`.

## Tests before every commit

Before every commit, run BOTH and both must pass:

```
npm test
npm run e2e
```

- `npm test` is the Vitest unit suite (includes the contract tests); `pretest`
  runs `tsc --noEmit` first.
- `npm run e2e` builds, starts the preview server on port 4321, runs every
  `e2e/*.e2e.mjs`, always stops the server, and exits non-zero on any failure.
- A failure your change caused must be fixed before committing. A pre-existing
  failure on `main` is reported with evidence your diff did not cause it; do not
  silence it.

## Every report includes

- `git diff --stat` for each commit (what that commit actually changed).
- Any out-of-scope file that was restored instead of committed.
- The `npm test` and `npm run e2e` result.

## Data and untracked reports

- Never stage `data/source/`. The repo does not hand-edit data.
- Untracked `*-report.md` files and `course-issues.csv` are working notes:
  never commit them (`.gitignore`).

## Branching and remote

- Always work on `main`. Commit and push to `main` when tests pass.
- Never create branches or pull requests unless explicitly asked.
