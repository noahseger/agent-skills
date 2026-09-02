# Agent Skills

Reusable Claude Code skills for software engineering agents.

## Structure

Each skill lives in its own directory with a `SKILL.md` (practice guide) and supporting tools.

- `event-modeling/` — event modeling skill with Pydantic schema, validation, and SVG rendering
- `event-modeling/ts/` — the model as typed TypeScript; assembles to the JSON, generates the protobuf, `em` CLI
- `event-modeling/ts/viewer/` — the live diagram `em view` serves; Vue over the assembled JSON, built by Vite into `viewer/dist`
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
pip install pydantic pytest
```

## Running Tests

```bash
pytest event-modeling/tests/ -v
cd event-modeling/ts && npm test   # tsc, biome, vite build, node --test, buf lint
```

## Test Harness

Three kinds:

1. **Unit tests** (`tests/test_event_model.py`) — the Python tool's parsing, validation and rendering
2. **TypeScript tests** (`ts/test/`) — `typecheck.ts` holds one `@ts-expect-error` per compiler check, so
   `tsc` fails if a check stops firing; the rest cover assembly, the proto generator, the viewer's
   layout (pure, no browser) and the CLI, including the `view` server.
   Biome does not format `typecheck.ts`: the directive binds to the next line, so reformatting a
   chain moves the error off it and silently disarms the check
3. **Brief coverage** (`ts/test/brief-coverage.test.ts`) — whether the model answers the product
   brief, which is the only thing left that no type system can decide

### Test Fixtures

- **Product brief** (`tests/fixtures/todo_app_brief.md`) — a plain-text product description, the real input an agent works from
- **The model** (`ts/examples/todo-app/`) — the model built from that brief. `ts/test/todo-app.json` is
  what it assembles to, and `event_model.py validate` reports zero warnings on it
- **Golden JSON** (`tests/fixtures/todo_app_model.json`) — a hand-written model of the same brief, for the Python tests

## Conventions

- Skills use `SKILL.md` frontmatter with `name` and `description`
- Tool scripts are self-contained Python with minimal dependencies
- No coauthor signatures in commits
