# Agent Skills

Reusable [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for software engineering agents.

## Skills

### [event-modeling](./event-modeling/)

Event modeling captures a system as a left-to-right timeline of commands, events, and state views. The skill includes:

- **SKILL.md** — Full practice guide covering Storm, Capture, Specify, Deliver, and Evolve phases
- **event_model.py** — Pydantic schema with invariant validation + SVG diagram renderer

```bash
# Validate a model
python event-modeling/event_model.py validate model.json

# Render to SVG
python event-modeling/event_model.py render model.json -o model.svg

# Create a template
python event-modeling/event_model.py init model.json
```

Requires `pydantic` (no other dependencies).

## Installation

Copy any skill directory into your project's `.claude/skills/` directory:

```bash
cp -r event-modeling /path/to/your/project/.claude/skills/
```

Claude Code will automatically pick up skills from `.claude/skills/`.

## License

MIT
