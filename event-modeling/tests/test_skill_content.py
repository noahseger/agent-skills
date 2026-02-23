"""Outcome evaluation: does the golden model correctly cover the product brief?

These tests verify that applying the event-modeling skill to a product brief produces
a model with the right structural properties. They evaluate outcomes, not SKILL.md prose.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from event_model import EventModel, _parse_element, _parse_fields

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def model():
    data = json.loads((FIXTURES / "todo_app_model.json").read_text())
    return EventModel.model_validate(data)


@pytest.fixture
def brief():
    return (FIXTURES / "todo_app_brief.md").read_text()


@pytest.fixture
def all_slices(model):
    return [sl for ch in model.chapters for sl in ch.slices]


# ---------------------------------------------------------------------------
# Requirement coverage: every brief requirement maps to a slice
# ---------------------------------------------------------------------------

class TestRequirementCoverage:
    """Each requirement in the brief should be covered by at least one slice."""

    REQUIREMENTS = [
        ("create a named todo list", ["CreateList"]),
        ("add items to a list", ["AddItem"]),
        ("mark an item as done", ["CompleteItem"]),
        ("delete an item", ["DeleteItem"]),
        ("delete an entire todo list", ["DeleteList"]),
        ("view all their todo lists", ["TodoLists"]),
        ("view a single list with all its items", ["ListDetail"]),
        ("automatically marked as completed", ["CompleteList", "OnAllItemsDone"]),
        ("external calendar system can push", ["ExternalTaskScheduled"]),
    ]

    @pytest.mark.parametrize("description,expected_elements", REQUIREMENTS,
                             ids=[r[0][:40] for r in REQUIREMENTS])
    def test_requirement_has_slice(self, all_slices, description, expected_elements):
        all_elements = set()
        for sl in all_slices:
            if sl.command:
                all_elements.add(_parse_element(sl.command)[0])
            for ev in sl.events:
                all_elements.add(_parse_element(ev)[0])
            for rm in sl.read_models:
                all_elements.add(_parse_element(rm)[0])
            if sl.automation:
                all_elements.add(sl.automation)
            if sl.external_event:
                all_elements.add(_parse_element(sl.external_event)[0])

        found = [e for e in expected_elements if e in all_elements]
        assert found, (
            f"Requirement '{description}' not covered — "
            f"expected one of {expected_elements} in model elements"
        )


# ---------------------------------------------------------------------------
# API coverage: every endpoint from the brief appears in the model
# ---------------------------------------------------------------------------

class TestApiCoverage:
    ENDPOINTS = [
        "POST /v1/lists",
        "POST /v1/lists/{listId}/items",
        "PATCH /v1/lists/{listId}/items/{itemId}",
        "DELETE /v1/lists/{listId}/items/{itemId}",
        "DELETE /v1/lists/{listId}",
        "GET /v1/lists",
        "GET /v1/lists/{listId}",
    ]

    @pytest.mark.parametrize("endpoint", ENDPOINTS)
    def test_endpoint_has_slice(self, all_slices, endpoint):
        uis = [sl.ui for sl in all_slices if sl.ui]
        assert endpoint in uis, f"Endpoint '{endpoint}' not found in any slice ui field"


# ---------------------------------------------------------------------------
# Business rules: each rule is captured as a GWT test with an error scenario
# ---------------------------------------------------------------------------

class TestBusinessRuleCoverage:

    def _all_tests(self, all_slices):
        return [t for sl in all_slices for t in sl.tests]

    def test_max_items_rule(self, all_slices):
        tests = self._all_tests(all_slices)
        error_tests = [t for t in tests
                       if any("error" in clause.lower() or "maximum" in clause.lower()
                              for clause in t.then)]
        max_item_tests = [t for t in error_tests if "item" in t.name.lower()]
        assert max_item_tests, "No GWT test enforces the max-3-items business rule"

    def test_duplicate_name_rule(self, all_slices):
        tests = self._all_tests(all_slices)
        dup_tests = [t for t in tests if "duplicate" in t.name.lower()
                     or "already exists" in " ".join(t.then).lower()]
        assert dup_tests, "No GWT test enforces the unique-list-name business rule"


# ---------------------------------------------------------------------------
# Structural quality
# ---------------------------------------------------------------------------

class TestStructuralQuality:

    def test_every_slice_has_a_name(self, all_slices):
        unnamed = [i for i, sl in enumerate(all_slices) if not sl.name]
        assert not unnamed, f"Slices at positions {unnamed} are missing names"

    def test_one_command_per_slice(self, all_slices):
        for sl in all_slices:
            commands = [sl.command] if sl.command else []
            assert len(commands) <= 1, f"Slice '{sl.name}' has multiple commands"

    def test_state_change_slices_have_events(self, all_slices):
        for sl in all_slices:
            if sl.command:
                assert sl.events, f"Slice '{sl.name}' has a command but no events"

    def test_view_slices_have_no_commands(self, all_slices):
        for sl in all_slices:
            if not sl.command and not sl.events and sl.read_models:
                assert sl.ui, f"View slice '{sl.name}' has read models but no ui"

    def test_automation_slices_have_triggers(self, all_slices):
        for sl in all_slices:
            if sl.automation:
                assert sl.trigger, f"Automation '{sl.automation}' has no trigger"


# ---------------------------------------------------------------------------
# Slice type coverage: model uses all four slice types when appropriate
# ---------------------------------------------------------------------------

class TestSliceTypeCoverage:

    def test_has_state_change_slices(self, all_slices):
        state_changes = [sl for sl in all_slices if sl.ui and sl.command and sl.events]
        assert len(state_changes) >= 1

    def test_has_view_only_slices(self, all_slices):
        views = [sl for sl in all_slices
                 if sl.ui and sl.read_models and not sl.command and not sl.events]
        assert len(views) >= 1

    def test_has_automation_slices(self, all_slices):
        automations = [sl for sl in all_slices if sl.automation]
        assert len(automations) >= 1

    def test_has_external_event_slices(self, all_slices):
        externals = [sl for sl in all_slices if sl.external_event]
        assert len(externals) >= 1


# ---------------------------------------------------------------------------
# Information completeness: read model fields trace to event fields
# ---------------------------------------------------------------------------

class TestInformationCompleteness:

    def test_read_model_fields_sourced_from_events(self, all_slices):
        for sl in all_slices:
            if not sl.read_models or not sl.events:
                continue
            event_fields = set()
            for ev in sl.events:
                event_fields |= _parse_fields(ev)
            for rm in sl.read_models:
                rm_fields = _parse_fields(rm)
                if rm_fields:
                    overlap = rm_fields & event_fields
                    rm_name = _parse_element(rm)[0]
                    assert overlap, (
                        f"Read model '{rm_name}' in '{sl.name}' shares no fields "
                        f"with events — not information complete"
                    )


# ---------------------------------------------------------------------------
# GWT quality: tests use concrete data, not schemas
# ---------------------------------------------------------------------------

class TestGwtQuality:

    def test_state_change_slices_have_tests(self, all_slices):
        untested = []
        for sl in all_slices:
            if sl.command and sl.events and not sl.tests:
                untested.append(sl.name)
        assert not untested, f"State-change slices without tests: {untested}"

    def test_all_gwt_have_concrete_data(self, all_slices):
        for sl in all_slices:
            for t in sl.tests:
                all_clauses = t.given + [t.when] + t.then
                has_values = any("=" in c for c in all_clauses)
                assert has_values, (
                    f"Test '{t.name}' in '{sl.name}' uses schema placeholders "
                    f"instead of concrete data"
                )


# ---------------------------------------------------------------------------
# Automation wiring: triggers reference events that exist elsewhere
# ---------------------------------------------------------------------------

class TestAutomationWiring:

    def test_trigger_references_existing_event(self, all_slices):
        all_event_names = set()
        for sl in all_slices:
            for ev in sl.events:
                all_event_names.add(_parse_element(ev)[0])

        for sl in all_slices:
            if sl.trigger:
                trigger_name = _parse_element(sl.trigger)[0]
                assert trigger_name in all_event_names, (
                    f"Automation '{sl.automation}' trigger '{trigger_name}' "
                    f"doesn't match any event in the model"
                )
