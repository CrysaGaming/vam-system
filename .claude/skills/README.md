# Project Skills

Project-local skills for VAM-System. Committed to git so the team shares the
same Claude Code behavior. Auto-discovered by Claude Code from this directory.

Each skill lives in its own subfolder: `.claude/skills/<name>/SKILL.md`.

## Current Skills

| Name | Auto-trigger | Purpose |
|---|---|---|
| `vam-multi-tenancy` | yes | airlineId-scoping pattern for DB reads, writes, Server Actions, and API routes across the repo |

## Naming convention

`vam-<scope>-<topic>` — examples:

- `vam-multi-tenancy` — architectural pattern (no sub-topic needed)
- `vam-acars-development` — module + topic
- `vam-overlay-tokens` — feature + topic

Skip the `vam-` prefix only for skills that aren't VAM-specific (rare here).

## Style guide

- **Body length**: keep under ~80 lines and ~2000 tokens. Skills load every
  time they trigger — large skills bloat context across the team.
- **Snippets, not file dumps**: link to real paths (`apps/web/.../foo.ts:42`)
  instead of pasting whole files. Keeps skills readable when underlying code
  evolves.
- **Document, don't invent**: skills describe patterns that exist in the
  codebase. Missing patterns get marked as TODO/future, not fabricated.
- **`paths`-gating** when a skill is only relevant to a sub-tree (e.g.
  `apps/acars/**`). Skip it for cross-cutting concerns (multi-tenancy,
  Server Actions conventions) that apply repo-wide.
- **Frontmatter `description`** is what makes auto-trigger work. Be specific
  about *when* Claude should load the skill, not *what* it contains.

## Reference

Official Claude Code Skills docs: <https://code.claude.com/docs/en/skills.md>
