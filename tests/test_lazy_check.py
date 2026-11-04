"""lazy-check.py against false blocks and misses found in review."""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / ".claude" / "skills" / "lazy" / "lazy-check.py"
spec = importlib.util.spec_from_file_location("lazy_check", HOOK)
lazy_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lazy_check)


@pytest.fixture
def check(tmp_path, monkeypatch):
    """Failures for a reply wrapped in a valid contract, in a workspace with a root problem."""
    monkeypatch.setattr(lazy_check, "gns_meta", lambda key: {"exists": True, "size": 7})
    monkeypatch.setattr(lazy_check, "preferred_address", lambda: None)
    required = lazy_check.required_headers()

    def run(preface="", conclusion="Done."):
        response = f"{preface}\n\n### Conclusion\n{conclusion}\n\n."
        return lazy_check.contract_failures(response, required, str(tmp_path))

    return run


def test_valid_reply_passes(check):
    assert check() == []


def test_bare_yes_is_blocked(check, tmp_path):
    required = lazy_check.required_headers()
    assert lazy_check.contract_failures("Yes.", required, str(tmp_path))


@pytest.mark.parametrize("sentence", ["Latency is even worse at p99.", "Only a few tests were worth keeping."])
def test_technical_sentences_pass(check, sentence):
    assert check(conclusion=sentence) == []


@pytest.mark.parametrize("sentence", ["One caveat: I did not run it.", "Say the word and I will ship it."])
def test_deferrals_block(check, sentence):
    assert check(conclusion=sentence)


@pytest.mark.parametrize(
    "ref",
    [
        "[#123](https://github.com/octo/repo/pull/123)",
        "[octo/repo#123](https://github.com/octo/repo/pull/123)",
        "https://github.com/octo/repo/pull/123#issuecomment-9",
    ],
)
def test_linked_refs_pass(check, ref):
    assert check(conclusion=f"See {ref}.") == []


@pytest.mark.parametrize("ref", ["#123", "octo/repo#123", "repo#123"])
def test_unlinked_refs_block(check, ref):
    assert check(conclusion=f"See {ref}.")


def test_multi_word_owner_passes(check):
    assert check(preface="- [~] **Ada Lovelace**: share the test scripts") == []


@pytest.mark.parametrize("owner", ["Claude", "Codex", "Cursor", "me"])
def test_agent_owned_item_blocks(check, owner):
    assert check(preface=f"- [~] {owner}: run the tests")


def test_item_without_owner_blocks(check):
    assert check(preface="- [ ] Run tests: then deploy")


@pytest.mark.parametrize("meta", [{"exists": False}, {"exists": True, "size": 0}])
def test_missing_root_problem_blocks(check, monkeypatch, meta):
    monkeypatch.setattr(lazy_check, "gns_meta", lambda key: meta)
    assert any(".root-problem is missing" in failure for failure in check())


def test_unreachable_gns_lets_the_turn_through(check, monkeypatch):
    monkeypatch.setattr(lazy_check, "gns_meta", lambda key: None)
    assert check() == []


def test_workspace_key_names_repo_and_worktree(tmp_path):
    repo, worktree = tmp_path / "My Repo", tmp_path / "Kuala_Lumpur"
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "--allow-empty", "-m", "x"], check=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    subprocess.run(["git", "-C", str(repo), "worktree", "add", "-q", str(worktree)], check=True)
    (worktree / "sub").mkdir()
    (repo / "sub").mkdir()
    assert lazy_check.workspace_key(str(worktree / "sub")) == ".lazy.my-repo.kuala-lumpur"
    assert lazy_check.workspace_key(str(repo / "sub")) == ".lazy.my-repo"


def test_workspace_key_outside_git_uses_the_folder(tmp_path):
    (tmp_path / "Some Folder").mkdir()
    assert lazy_check.workspace_key(str(tmp_path / "Some Folder")) == ".lazy.local.some-folder"


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "lazy"


def run_hook(payload, home):
    """The hook's stdout for one stop payload, as each harness sends it."""
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "HOME": str(home), "PATH": f"{home / 'bin'}{os.pathsep}{os.environ['PATH']}"},
        check=True,
    )
    return result.stdout


@pytest.fixture
def workspace(tmp_path):
    """A workspace whose root problem GNS reports as stated, through a stand-in gns."""
    gns = tmp_path / "bin" / "gns"
    gns.parent.mkdir()
    gns.write_text('#!/bin/sh\necho \'{"exists": true, "size": 7}\'\n')
    gns.chmod(0o755)
    return tmp_path


def codex_payload(workspace, **extra):
    return {
        "hook_event_name": "Stop",
        "transcript_path": str(FIXTURES / "codex-rollout.jsonl"),
        "cwd": str(workspace),
        "stop_hook_active": False,
        "last_assistant_message": "Not yet.",
        **extra,
    }


def cursor_payload(workspace, transcript="cursor-transcript.jsonl", **extra):
    """A stop payload captured from cursor-agent, pointed at this test's transcript and workspace."""
    payload = json.loads((FIXTURES / "cursor-stop-payload.json").read_text())
    return {
        **payload,
        "transcript_path": str(FIXTURES / transcript),
        "workspace_roots": [str(workspace)],
        **extra,
    }


def test_codex_invocation_arms_and_blocks(workspace):
    assert '"decision": "block"' in run_hook(codex_payload(workspace), workspace)


def test_codex_blocks_once(workspace):
    assert run_hook(codex_payload(workspace, stop_hook_active=True), workspace) == ""


@pytest.mark.parametrize("transcript", ["cursor-transcript.jsonl", "cursor-cli-transcript.jsonl"])
def test_cursor_read_of_skill_arms_and_blocks_on_transcript_reply(workspace, transcript):
    output = run_hook(cursor_payload(workspace, transcript), workspace)
    assert '"decision": "block"' in output
    assert "root-problem" not in output


def test_cursor_blocks_once(workspace):
    assert run_hook(cursor_payload(workspace, loop_count=1), workspace) == ""


def test_claude_code_read_of_skill_does_not_arm(workspace, tmp_path_factory):
    transcript = tmp_path_factory.mktemp("t") / "claude.jsonl"
    read = {"type": "tool_use", "name": "Read", "input": {"file_path": "/x/.claude/skills/lazy/SKILL.md"}}
    transcript.write_text(json.dumps({"type": "assistant", "message": {"content": [read]}}) + "\n")
    payload = {"transcript_path": str(transcript), "cwd": str(workspace), "last_assistant_message": "Yes."}
    assert run_hook(payload, workspace) == ""
