#!/usr/bin/env python3
"""Stop hook: enforce the /lazy response contract where it applies.

The lazy skill defines an exact Pyramid Principle structure — its verbatim
section headers, an address to the human, and a single period on its own line as the
terminator. Any turn that misses one of those did not follow the protocol, so
block the stop and hand the model back the skill.

The contract only exists once the skill is loaded. Sessions that never invoked
it — checkpoint briefings, news digests, PR bodies — are none of this hook's
business, so it stays silent in them.
"""
import json
import re
import sys
from pathlib import Path

# How each harness records loading this skill. Matched by suffix so the hook
# works wherever GNS installs the skill, and only where the harness writes the
# load, never in tool output: these lines are themselves matches, so reading
# this file would otherwise arm the hook for the rest of the session.
CLAUDE_LOAD = re.compile(r"Base directory for this skill: \S*/skills/lazy\b")
CODEX_LOAD = re.compile(r"\[\$?lazy\]\([^\n)]*/lazy/SKILL\.md\)|(?<!\w)\$lazy\b")
CURSOR_LOAD = re.compile(r"/skills/lazy/SKILL\.md$")

FENCE = re.compile(r"^\s*(```|~~~)")
HEADER = re.compile(r"^\s{0,3}#{1,6}\s+\S")
INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")
PREFERRED_ADDRESS = re.compile(r"address me as [\"“'‘]?([\w-]+)", re.I)
UNCHECKED = re.compile(r"^\s*[-*]\s*\[[ ~]\].*$", re.M)
# A PR or issue number that is not a link makes the human go find it. Matched
# after URLs are removed, so a link's target and a comment anchor never count.
BARE_REF = re.compile(r"(?<![\w/\[#.-])(?:[\w.-]+/)?[\w.-]*#\d+\b(?!\]\()")
URL = re.compile(r"https?://\S+")
# A name is one word, or capitalized words like "Ada Lovelace"; "Run tests:" is not.
OWNER = re.compile(r"^\s*[-*]\s*\[[ ~]\]\s*\**([\w.'-]+(?: [A-Z][\w.'-]*){0,2})\**:")
SELF = {"claude", "codex", "cursor", "me", "i", "agent", "assistant"}

# Frames that hand work back to the human instead of resolving it — the substance
# of non-laziness, where the headers are only its shell. Kept here rather than in
# SKILL.md so the skill stays short: every one of these is a phrase to catch, not
# a principle to read.
DEFERRAL = re.compile(
    r"\bsay the word\b"
    r"|\bworth (knowing|noting|flagging|mentioning|highlighting|calling out|your call)\b"
    r"|\b(one|a) caveat\b"
    r"|what I need from you"
    r"|something I wanted to flag"
    r"|deliberately left out"
    r"|the question for you"
    r"|what I'd want a reviewer"
    r"|^Honestly[,.]"
    r"|\bfair hit\b"
    r"|\bthe kicker\b",
    re.I | re.M,
)


def main():
    payload = read_payload()

    # The block re-enters this hook on the next stop; never fire twice in a row.
    # Cursor counts its loops instead of flagging them, and sets no limit for
    # hooks it imports from Claude Code.
    if payload.get("stop_hook_active") or payload.get("loop_count"):
        return

    transcript = read_transcript(payload.get("transcript_path"))
    if transcript is None or not skill_loaded(transcript):
        return

    # Claude Code and Codex hand the turn-final message to the hook directly;
    # Cursor does not, so read it from the transcript.
    response = payload.get("last_assistant_message") or last_assistant_text(transcript)
    if not isinstance(response, str) or not response.strip():
        return

    required = required_headers()
    if not required:
        return

    cwd = payload.get("cwd") or next(iter(payload.get("workspace_roots") or []), None)
    failures = contract_failures(response, required, cwd)
    if failures:
        print(json.dumps({"decision": "block", "reason": reason_for(failures)}))


def skill_loaded(transcript):
    """Whether the harness actually loaded this skill in this session.

    Tool output is quoted data, not a load: grepping the skills directory or
    reading this file puts the same strings in the transcript without the
    contract ever being handed to the model.
    """
    for line in transcript.splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        for block in content_blocks(record.get("message")):
            if block.get("type") == "text" and CLAUDE_LOAD.search(block.get("text") or ""):
                return True
            # Cursor loads a skill by having the model read its SKILL.md.
            path = (block.get("input") or {}).get("path") if block.get("name") == "ReadFile" else None
            if isinstance(path, str) and CURSOR_LOAD.search(path):
                return True
        item = record.get("payload") if record.get("type") == "response_item" else None
        if isinstance(item, dict) and item.get("role") == "user":
            for block in content_blocks(item):
                if block.get("type") == "input_text" and CODEX_LOAD.search(block.get("text") or ""):
                    return True
    return False


def content_blocks(message):
    content = message.get("content") if isinstance(message, dict) else None
    return [block for block in content if isinstance(block, dict)] if isinstance(content, list) else []


def required_headers():
    """The template's headers, read from the SKILL.md this hook ships beside.

    Deriving them means editing the skill is enough — there is no second copy of
    the template to fall out of sync with the one the model is told to follow.
    """
    try:
        skill = open(Path(__file__).with_name("SKILL.md"), encoding="utf-8").read()
    except OSError:
        return []
    template = re.search(r"Pyramid Principle Structure\n+```\n(.*?\n)```", skill, re.S)
    return headers_in(template.group(1)) if template else []


def contract_failures(response, required, cwd=None):
    """Every way this response breaks the lazy contract, in reporting order."""
    failures = []

    headers = headers_in(response)
    if not is_ordered_subset(headers, required) or "### Conclusion" not in headers:
        failures.append(
            "Sections must be a subset of, and in the order of: "
            + " / ".join(required)
            + ", and must include ### Conclusion. Yours were: "
            + (" / ".join(headers) if headers else "(none)")
            + "."
        )

    body = strip_code(response)

    deferrals = sorted({hit.group(0) for hit in DEFERRAL.finditer(body)})
    if deferrals:
        failures.append(
            "You handed work back instead of resolving it, using: "
            + ", ".join(f'"{deferral}"' for deferral in deferrals)
            + ". Certify the answer yourself or cut the sentence."
        )

    address = preferred_address()
    if address and not re.search(rf"\b{re.escape(address)}\b", body):
        failures.append(f"You did not address the human as {address}.")

    if not ends_with_lone_period(response):
        failures.append("The response must end with a single period on its own line, nothing after it.")

    # Every other check reads the response, so a file nobody renders is the one
    # thing that can go missing and stay missing. Check the disk for this one.
    if not root_problem_stated(cwd):
        failures.append(
            ".context/ROOT_PROBLEM.md is missing or empty in this workspace. Write the root "
            "problem there, then answer."
        )

    bare = sorted(set(BARE_REF.findall(URL.sub(" ", body))))
    if bare:
        failures.append(
            "Name the repo and link every PR or issue; these are bare: " + ", ".join(bare) + "."
        )

    # Each open item names who acts next, so the human sees their own at a glance.
    # An item the model owns is work it could be doing instead of stopping.
    for line in UNCHECKED.findall(preface(body)):
        owner = OWNER.match(line)
        if not owner:
            failures.append(f'Start each open item with who acts next, as "Name:". This one does not: {line.strip()}')
        elif owner.group(1).lower() in SELF:
            failures.append(f"This open item is yours; do it now instead of stopping: {line.strip()}")

    return failures


def root_problem_stated(cwd):
    """True when some ancestor of cwd carries a non-empty .context/ROOT_PROBLEM.md.

    Walked upward rather than read from cwd directly: a shell `cd` during the
    turn moves cwd into a subdirectory, and the workspace's root problem is
    still the one that applies.
    """
    here = Path(cwd or ".").resolve()
    for directory in (here, *here.parents):
        candidate = directory / ".context" / "ROOT_PROBLEM.md"
        try:
            if candidate.read_text(encoding="utf-8", errors="replace").strip():
                return True
        except OSError:
            continue
    return False


def preferred_address():
    """The name the installer told Claude to call them, from their own CLAUDE.md.

    Reading it here keeps the hook honest for whoever installs it: enforce the
    address only where its owner asked for one, rather than shipping one name.
    """
    try:
        instructions = open(Path.home() / ".claude" / "CLAUDE.md", encoding="utf-8").read()
    except OSError:
        return None
    match = PREFERRED_ADDRESS.search(instructions)
    return match.group(1) if match else None


def preface(body):
    """Everything before the first section header — where the checklist lives."""
    lines = body.splitlines()
    for index, line in enumerate(lines):
        if HEADER.match(line):
            return "\n".join(lines[:index])
    return body


def is_ordered_subset(headers, required):
    """Whether every header appears in the template, in the template's order."""
    remaining = list(required)
    for header in headers:
        while remaining and remaining[0] != header:
            remaining.pop(0)
        if not remaining:
            return False
        remaining.pop(0)
    return True


def headers_in(response):
    return [line.strip() for line in strip_code(response).splitlines() if HEADER.match(line)]


def ends_with_lone_period(response):
    lines = response.rstrip().splitlines()
    return bool(lines) and lines[-1].strip() == "."


def strip_code(response):
    """Drop fenced blocks and inline spans.

    Fenced blocks keep shell comments from reading as section headers. Inline
    spans separate mention from use: a banned frame in backticks is being quoted
    as data, which is how this hook gets discussed without tripping itself.
    """
    kept, inside = [], False
    for line in response.splitlines():
        if FENCE.match(line):
            inside = not inside
            continue
        if not inside:
            kept.append(INLINE_CODE.sub(" ", line))
    return "\n".join(kept)


def reason_for(failures):
    return (
        "Your response broke the laziness protocol:\n"
        + "\n".join(f"- {failure}" for failure in failures)
        + "\n\nFix exactly that and send the same answer again. The skill is already in "
        "your context — reloading it costs a turn and changes nothing. Resolve anything "
        "you were about to hand back rather than asking."
    )


def read_transcript(transcript_path):
    if not transcript_path:
        return None
    try:
        return open(transcript_path, encoding="utf-8", errors="replace").read()
    except OSError:
        return None


def last_assistant_text(transcript):
    """Final assistant prose in the transcript, or None if there is none."""
    for line in reversed(transcript.splitlines()):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        # Claude Code tags the record's type; Cursor tags its role.
        if "assistant" not in (record.get("type"), record.get("role")):
            continue
        for block in content_blocks(record.get("message")):
            if block.get("type") == "text" and (block.get("text") or "").strip():
                return block["text"]
    return None


def read_payload():
    try:
        return json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return {}


if __name__ == "__main__":
    main()
