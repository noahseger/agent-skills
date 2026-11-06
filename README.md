# Agent Skills

Reusable [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for software engineering agents.

## Skills

### [event-modeling](./event-modeling/)

Event modeling captures a system as a left-to-right timeline of commands, events, and state views. The skill includes:

- **SKILL.md** — Full practice guide covering Storm, Capture, Specify, Deliver, and Evolve phases
- **ts/** — the model as typed TypeScript, the `em` CLI and its live diagram

#### [ts](./event-modeling/ts/)

Write the model in TypeScript, or as [event-modeling-spec](https://github.com/dilgerma/event-modeling-spec) JSON for one extracted from an existing system. In TypeScript, names come from exports, fields are Zod schemas, and a slice is a chain of calls that only compiles in a legal order. The worked example is `ts/examples/todo-app/`.

```bash
npx em init   model/                 # scaffold a model directory
npx em view   model/                 # live diagram in the browser; redraws on save
npx em view   model.json             # the same for a spec JSON model
npx em export model/ -o model.html   # one self-contained page, for sharing
npx em json   model/                 # the model as spec JSON
npx em proto  model/ -o proto        # one .proto per service
```

See `ts/README.md`.

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
