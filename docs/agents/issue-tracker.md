# Issue tracker: GitHub

Issues, specs, and tickets for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## PRs as a request surface

`no`. External pull requests are not included in triage discovery. An explicitly named
PR may still be triaged on request.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

- **The map** is a GitHub issue labelled `wayfinder:map`.
- **Tickets** are child issues of the map, linked with GitHub's native sub-issue relationship.
- **Blocking edges** use GitHub's native issue-to-issue blocking relationship where available; otherwise record them in a `## Blocked by` section in the ticket body.
- **Claim** a ticket by assigning it to the driving developer before starting work.
- **Frontier** = open, unblocked, unassigned child issues of the map.
- **Resolve** a ticket by recording its answer as a comment, then closing it and adding one line to the map's "Decisions so far" section.
