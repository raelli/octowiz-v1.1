# Changelog
All notable changes to this project are documented in this file.

## [Unreleased]
### Fixed
- Made `tests/multiplayer/conflicts.test.js` branch-name-agnostic by detecting the temp repo base branch dynamically and using it instead of hardcoded `main` during branch checkouts.
- Removed the remaining hardcoded default-branch checkout in the `returns empty when no overlap` test case to stabilize Node CI jobs across environments where `git init` defaults to `master`.
- Updated README setup instructions to install Python dependencies with `python3 -m pip` so dependency installation matches the interpreter used by the local supervisor (`python3 -m uvicorn`).

### Merged
- Merged PR #10 (`docs: align README with the current Octowiz implementation`) into `main`, including CI-fix follow-up commits that resolved failing `tests/node` checks.
