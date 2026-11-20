# Agent Skills

Reusable Claude Code skills for software engineering agents.

## Structure

Each skill lives in its own directory with a `SKILL.md` (practice guide) and supporting tools.

- `event-modeling/` — event modeling skill: the practice guide, `SKILL.md`
- `event-modeling/ts/` — the model as typed TypeScript; emits event-modeling-spec JSON, generates the protobuf, `em` CLI
- `event-modeling/ts/viewer/` — the live diagram `em view` serves; Vue over the spec JSON, built by Vite into `viewer/dist`
- `.claude/skills/lazy/` — response contract skill plus its `Stop` hook, installed active for this repo

## The lazy skill is edited here, nowhere else

`~/.claude/skills/lazy/` and `~/.codex/skills/lazy/` are symlinks into
`.claude/skills/lazy/`, so this repo is the only copy. Edit it here, open a PR,
and after merge publish it so teammates get the same version:

```bash
gns skills publish .claude/skills/lazy -m "<what changed>" --team architecture --public --force
gns skills repair --key user.noah.skills.lazy
```

Editing `~/.claude/skills/lazy/` directly writes through the symlink into an
unreviewed working copy of this repo. Commit it.

## Dependencies

```bash
pip install pytest                 # lazy-check.py
cd event-modeling/ts && npm ci
```

## Running Tests

```bash
pytest tests/ -v                   # lazy-check.py
cd event-modeling/ts && npm test   # tsc, biome, vite build, node --test, buf lint
```

## Test Harness

Two kinds:

1. **TypeScript tests** (`ts/test/`) — `typecheck.ts` holds one `@ts-expect-error` per compiler check, so
   `tsc` fails if a check stops firing; the rest cover assembly and the spec JSON it emits, the proto generator,
   the viewer's reading of that JSON and its layout (pure, no browser), and the CLI, including the `view` server.
   Biome does not format `typecheck.ts`: the directive binds to the next line, so reformatting a
   chain moves the error off it and silently disarms the check
2. **Brief coverage** (`ts/test/brief-coverage.test.ts`) — whether the model answers the product
   brief, which is the only thing left that no type system can decide

### Test Fixtures

- **Product brief** (`ts/test/fixtures/todo_app_brief.md`) — a plain-text product description, the real input an agent works from
- **The model** (`ts/examples/todo-app/`) — the model built from that brief. `ts/test/todo-app.json` is
  the spec JSON it emits, and it validates against `ts/schema/eventmodeling.schema.json`

## Conventions

- Skills use `SKILL.md` frontmatter with `name` and `description`
- No coauthor signatures in commits
