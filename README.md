# Agent Skills

Reusable [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for software engineering agents.

## Skills

### [event-modeling](./event-modeling/)

Event modeling captures a system as a left-to-right timeline of commands, events, and state views. The skill includes:

- **SKILL.md** — Full practice guide covering Storm, Capture, Specify, Deliver, and Evolve phases
- **event_model.py** — Pydantic schema with invariant validation + SVG diagram renderer
- **ts/** — the model as typed TypeScript; it assembles to the JSON above and generates the protobuf

```bash
# Validate a model
python event-modeling/event_model.py validate model.json

# Render to SVG
python event-modeling/event_model.py render model.json -o model.svg

# Create a template
python event-modeling/event_model.py init model.json
```

Requires `pydantic` (no other dependencies).

#### [ts](./event-modeling/ts/)

Write the model in TypeScript instead of JSON. Names come from exports, fields are Zod schemas, and a slice is a chain of calls that only compiles in a legal order. The worked example is `ts/examples/todo-app/`.

```bash
npx em init   model/                 # scaffold a model directory
npx em view   model/                 # live diagram in the browser; redraws on save
npx em export model/ -o model.html   # one self-contained page, for sharing
npx em render model/ -o model.svg    # still picture; --watch redraws on save
npx em proto  model/ -o proto        # one .proto per service
```

`render` shells out to `event_model.py`. See `ts/README.md`.

### [lazy](./.claude/skills/lazy/)

A response contract: understand the problem, simplify, and answer in a fixed
Pyramid Principle structure inside a 220-word budget.

- **SKILL.md** — the laziness principles and the response template
- **lazy-check.py** — a `Stop` hook that blocks a turn breaking the contract

The hook only fires in sessions that actually loaded the skill, so it stays
silent otherwise. It is wired for this repo in `.claude/settings.json`.

This skill is installed under `.claude/skills/` because it is active while
working in this repo, not just published from it.

## Installation

Copy any skill directory into your project's `.claude/skills/` directory:

```bash
cp -r event-modeling /path/to/your/project/.claude/skills/
```

Claude Code will automatically pick up skills from `.claude/skills/`.

The `lazy` skill also needs its hook registered in that project's
`.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/lazy/lazy-check.py\""
          }
        ]
      }
    ]
  }
}
```

## License

MIT
