#!/usr/bin/env python3
"""Stop hook: enforce the /lazy response contract where it applies.

The lazy skill defines an exact Pyramid Principle structure — six verbatim
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

# Emitted into the transcript by the Skill tool when it loads this skill. Matched
# by suffix so the hook works wherever GNS installs the skill. Only ever searched
# in message text, never in tool output: this line is itself a match, so reading
# this file would otherwise arm the hook for the rest of the session.
SKILL_LOADED = re.compile(r"Base directory for this skill: \S*/skills/lazy\b")

FENCE = re.compile(r"^\s*(```|~~~)")
HEADER = re.compile(r"^\s{0,3}#{1,6}\s+\S")
INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")
PREFERRED_ADDRESS = re.compile(r"address me as [\"“'‘]?([\w-]+)", re.I)
UNCHECKED = re.compile(r"^\s*[-*]\s*\[[ ~]\]", re.M)
CHECKLIST_LINE = re.compile(r"^[ \t]*[-*][ \t]*\[[ x~]\].*$", re.M | re.I)
ASK = re.compile(r"\*\*Ask:", re.I)

# Frames that hand work back to the human instead of resolving it — the substance
# of non-laziness, where the headers are only its shell. Kept here rather than in
# SKILL.md so the skill stays short: every one of these is a phrase to catch, not
# a principle to read.
DEFERRAL = re.compile(
    r"\bsay the word\b"
    r"|\bworth (knowing|noting|flagging|mentioning|highlighting|calling out|your call)\b"
    r"|\b(one|two|three|a few|several)\b[^.\n]{0,30}\bworth\b"
    r"|\b(one|a) caveat\b"
    r"|what I need from you"
    r"|something I wanted to flag"
    r"|deliberately left out"
    r"|the question for you"
    r"|what I'd want a reviewer"
    r"|^Honestly[,.]"
    r"|\bfair hit\b"
    r"|\bthe kicker\b"
    r"|\beven worse\b",
    re.I | re.M,
)


def main():
    payload = read_payload()

    # The block re-enters this hook on the next stop; never fire twice in a row.
    if payload.get("stop_hook_active"):
        return

    transcript = read_transcript(payload.get("transcript_path"))
    if transcript is None or not skill_loaded(transcript):
        return

    # Claude Code hands the turn-final message to the hook directly; fall back to
    # the transcript only for older payloads that omit it.
    response = payload.get("last_assistant_message") or last_assistant_text(transcript)
    if not isinstance(response, str) or not response.strip():
        return

    required = required_headers()
    if not required:
        return

    failures = contract_failures(response, required, payload.get("cwd"))
    if failures:
        print(json.dumps({"decision": "block", "reason": reason_for(failures)}))


def skill_loaded(transcript):
    """Whether the Skill tool actually loaded this skill in this session.

    Restricted to message text because tool output is quoted data, not a load:
    grepping the skills directory or reading this file puts the sentinel in the
    transcript without the contract ever being handed to the model.
    """
    for record in transcript.splitlines():
        try:
            content = json.loads(record).get("message", {}).get("content")
        except ValueError:
            continue
        for block in content if isinstance(content, list) else []:
            if block.get("type") == "text" and SKILL_LOADED.search(block.get("text") or ""):
                return True
    return False


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


WORD_BUDGET = 400


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

    # The preface checklist is carried state, not prose, so it is exempt.
    words = len(CHECKLIST_LINE.sub('', body).split())
    if words > WORD_BUDGET:
        failures.append(
            f"{words} words outside code blocks, budget is {WORD_BUDGET}. Cut it, or move "
            "the long part into a file and link it. Drop whole sections that repeat what "
            "he already has."
        )

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

    unfinished = UNCHECKED.findall(preface(body))
    if unfinished and not ASK.search(body):
        failures.append(
            f"Your checklist still has {len(unfinished)} unchecked item(s) and you asked "
            "nothing of the human, so nobody is waiting on anybody. Do the next one now."
        )

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
        if record.get("type") != "assistant":
            continue
        for block in record.get("message", {}).get("content", []) or []:
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
