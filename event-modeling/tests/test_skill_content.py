"""Content evaluation: score SKILL.md against key concepts from the event modeling talk.

Each test checks that SKILL.md covers an essential principle. Run before and after
improvements to measure progress. Failing tests identify gaps in the skill's guidance.
"""

import re
from pathlib import Path

import pytest

SKILL_MD = Path(__file__).resolve().parent.parent / "SKILL.md"


def _skill_text() -> str:
    return SKILL_MD.read_text().lower()


def _has_any(text: str, terms: list[str]) -> bool:
    """Return True if any of the terms appear in the text."""
    return any(term.lower() in text for term in terms)


def _has_all(text: str, terms: list[str]) -> bool:
    """Return True if ALL terms appear in the text."""
    return all(term.lower() in text for term in terms)


# ---------------------------------------------------------------------------
# Concept 1: Information Completeness
# ---------------------------------------------------------------------------

class TestInformationCompleteness:
    """Every read model field must trace to an event field. Missing data blocks work."""

    def test_mentions_information_completeness(self):
        text = _skill_text()
        assert _has_any(text, [
            "information complete",
            "information completeness",
        ]), "SKILL.md should explain information completeness as a principle"

    def test_explains_blocked_work(self):
        text = _skill_text()
        assert _has_any(text, [
            "cannot start implementation",
            "blocked",
            "cannot start with",
            "must trace",
        ]), "SKILL.md should explain that missing information blocks implementation"


# ---------------------------------------------------------------------------
# Concept 2: Slice Independence
# ---------------------------------------------------------------------------

class TestSliceIndependence:
    """Slices are independent. Events are the only contract between them."""

    def test_mentions_independence(self):
        text = _skill_text()
        assert _has_any(text, [
            "independent",
            "independently",
        ]), "SKILL.md should state that slices are independent"

    def test_events_as_contract(self):
        text = _skill_text()
        assert _has_any(text, [
            "only contract",
            "only coupling",
            "only dependency",
            "events are the only",
            "sole contract",
        ]), "SKILL.md should explain events are the only contract between slices"


# ---------------------------------------------------------------------------
# Concept 3: The WHY — Problem Statement
# ---------------------------------------------------------------------------

class TestProblemStatement:
    """Coupling and feature explosion as the problem event modeling solves."""

    def test_mentions_coupling(self):
        text = _skill_text()
        assert _has_any(text, [
            "coupling",
            "coupled",
        ]), "SKILL.md should explain coupling as a root problem"

    def test_mentions_feature_explosion_or_communication(self):
        text = _skill_text()
        assert _has_any(text, [
            "feature explosion",
            "bad communication",
            "wrong assumptions",
            "misunderstood requirements",
            "build the wrong thing",
        ]), "SKILL.md should explain the root cause (communication/requirements)"


# ---------------------------------------------------------------------------
# Concept 4: The V Pattern
# ---------------------------------------------------------------------------

class TestVPattern:
    """V-shaped information flow: read model → command → event → read model."""

    def test_mentions_v_pattern(self):
        text = _skill_text()
        assert _has_any(text, [
            "v pattern",
            "v-shape",
            "v shape",
            '"v"',
        ]), "SKILL.md should describe the V pattern of information flow"


# ---------------------------------------------------------------------------
# Concept 5: AI Agent Integration
# ---------------------------------------------------------------------------

class TestAiIntegration:
    """Slices are the right abstraction level for AI agents."""

    def test_mentions_ai_agents(self):
        text = _skill_text()
        assert _has_any(text, [
            "ai agent",
            "ai agents",
            "code generation",
            "coding agent",
        ]), "SKILL.md should mention AI agents working with event models"

    def test_mentions_abstraction_level(self):
        text = _skill_text()
        assert _has_any(text, [
            "right abstraction",
            "right level",
            "perfect size",
            "natural unit",
        ]), "SKILL.md should explain why slices are the right abstraction for AI"


# ---------------------------------------------------------------------------
# Concept 6: Screens / UI Mockups
# ---------------------------------------------------------------------------

class TestScreenMockups:
    """Sketching UIs is part of the modeling process."""

    def test_mentions_screen_sketching(self):
        text = _skill_text()
        assert _has_any(text, [
            "sketch",
            "wireframe",
            "mockup",
            "screen",
            "ui mockup",
        ]), "SKILL.md should mention sketching screens as part of modeling"


# ---------------------------------------------------------------------------
# Concept 7: Business Rules as Guardrails
# ---------------------------------------------------------------------------

class TestBusinessRulesAsGuardrails:
    """GWT tests as executable specs and guardrails for AI and developers."""

    def test_gwt_as_executable_spec(self):
        text = _skill_text()
        assert _has_any(text, [
            "executable spec",
            "executable specification",
            "the tests are the specification",
            "tests are the spec",
        ]), "SKILL.md should describe GWT tests as executable specifications"

    def test_gwt_as_guardrails(self):
        text = _skill_text()
        assert _has_any(text, [
            "guardrail",
            "guard rail",
            "acceptance criteria",
        ]), "SKILL.md should describe GWT tests as guardrails"


# ---------------------------------------------------------------------------
# Concept 8: Collaborative Process
# ---------------------------------------------------------------------------

class TestCollaborativeProcess:
    """Working with business experts, not solo engineering."""

    def test_mentions_collaboration(self):
        text = _skill_text()
        assert _has_any(text, [
            "business expert",
            "domain expert",
            "collaborat",
            "together with",
            "shared language",
        ]), "SKILL.md should emphasize collaborative modeling with domain experts"


# ---------------------------------------------------------------------------
# Concept 9: Slices as Work Items
# ---------------------------------------------------------------------------

class TestSlicesAsWorkItems:
    """Slices map to implementable work items with status tracking."""

    def test_mentions_work_items(self):
        text = _skill_text()
        assert _has_any(text, [
            "work item",
            "backlog",
            "ticket",
            "task",
        ]), "SKILL.md should describe slices as work items"

    def test_mentions_status_tracking(self):
        text = _skill_text()
        assert _has_any(text, [
            "planned",
            "in progress",
            "status",
        ]), "SKILL.md should mention slice status tracking"


# ---------------------------------------------------------------------------
# Concept 10: Repeatable Code Patterns
# ---------------------------------------------------------------------------

class TestRepeatablePatterns:
    """Slices produce predictable, boring, repeatable code structure."""

    def test_mentions_repeatable_patterns(self):
        text = _skill_text()
        assert _has_any(text, [
            "repeatable",
            "repeating pattern",
            "same structure",
            "predictable",
            "boring",
        ]), "SKILL.md should explain that slices produce repeatable code patterns"
