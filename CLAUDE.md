# Agent Skills

Reusable Claude Code skills for software engineering agents.

## Structure

Each skill lives in its own directory with a `SKILL.md` (practice guide) and supporting tools.

- `event-modeling/` — event modeling skill with Pydantic schema, validation, and SVG rendering
- `.claude/skills/lazy/` — response contract skill plus its `Stop` hook, installed active for this repo

## Dependencies

```bash
pip install pydantic pytest
```

## Running Tests

```bash
pytest event-modeling/tests/ -v
```

## Test Harness

Each skill has two kinds of tests:

1. **Unit tests** (`test_event_model.py`) — validate the tool's logic (parsing, validation, rendering)
2. **Content evaluation** (`test_skill_content.py`) — score the SKILL.md against key concepts the skill must teach

Content tests check that SKILL.md covers essential principles. When improving a skill, run tests before and after to confirm the score improves.

### Test Fixtures

- **Product brief** (`fixtures/todo_app_brief.md`) — a plain-text product description, the real input an agent works from
- **Golden model** (`fixtures/todo_app_model.json`) — the expected event model output from that brief, used for validation verification

## Conventions

- Skills use `SKILL.md` frontmatter with `name` and `description`
- Tool scripts are self-contained Python with minimal dependencies
- No coauthor signatures in commits
