"""Unit tests for event_model.py validation logic, helpers, and rendering."""

import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

# Add parent dir so we can import the module directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from event_model import (
    EventModel,
    GivenWhenThen,
    _has_concrete_data,
    _looks_past_tense,
    _parse_element,
    _parse_fields,
    _resolve_ref,
    render_svg,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


# ---------------------------------------------------------------------------
# _parse_element
# ---------------------------------------------------------------------------

class TestParseElement:
    def test_name_with_fields(self):
        assert _parse_element("PlaceOrder(customerId, items)") == (
            "PlaceOrder", "customerId, items"
        )

    def test_name_without_fields(self):
        assert _parse_element("PlaceOrder") == ("PlaceOrder", None)

    def test_empty_parens(self):
        assert _parse_element("Foo()") == ("Foo", "")

    def test_nested_brackets(self):
        name, fields = _parse_element("AddItem(items=[sku-1, sku-2])")
        assert name == "AddItem"
        assert "items=" in fields


# ---------------------------------------------------------------------------
# _looks_past_tense
# ---------------------------------------------------------------------------

class TestLooksPastTense:
    @pytest.mark.parametrize("name", [
        "OrderPlaced", "UserRegistered", "ItemAdded", "CartCleared",
        "InventoryReserved", "PaymentConfirmed", "ItemDeleted",
        "PasswordFrozen", "TokenRevoked",
    ])
    def test_recognizes_past_tense(self, name):
        assert _looks_past_tense(name) is True

    @pytest.mark.parametrize("name", [
        "PlaceOrder", "RegisterUser", "AddItem", "ClearCart",
        "ReserveInventory", "ConfirmPayment", "DeleteItem",
    ])
    def test_rejects_imperative(self, name):
        assert _looks_past_tense(name) is False

    @pytest.mark.parametrize("name", [
        "OrderSent", "MoneySpent", "ItemGot",
    ])
    def test_recognizes_irregular_past(self, name):
        assert _looks_past_tense(name) is True

    def test_single_word_past(self):
        assert _looks_past_tense("Created") is True

    def test_single_word_imperative(self):
        assert _looks_past_tense("Create") is False

    def test_empty_string(self):
        assert _looks_past_tense("") is False

    def test_no_camel_case(self):
        assert _looks_past_tense("lowercase") is False


# ---------------------------------------------------------------------------
# _has_concrete_data
# ---------------------------------------------------------------------------

class TestHasConcreteData:
    def test_concrete_when(self):
        gwt = GivenWhenThen(
            name="test", given=[], when="PlaceOrder(id=42)", then=["OrderPlaced(id=42)"]
        )
        assert _has_concrete_data(gwt) is True

    def test_schema_only(self):
        gwt = GivenWhenThen(
            name="test", given=[], when="PlaceOrder(id, items)", then=["OrderPlaced(id, items)"]
        )
        assert _has_concrete_data(gwt) is False

    def test_concrete_in_given(self):
        gwt = GivenWhenThen(
            name="test",
            given=["OrderPlaced(orderId=ord-1)"],
            when="CancelOrder(orderId)",
            then=["OrderCancelled(orderId)"],
        )
        assert _has_concrete_data(gwt) is True


# ---------------------------------------------------------------------------
# _parse_fields
# ---------------------------------------------------------------------------

class TestParseFields:
    def test_extracts_fields(self):
        assert _parse_fields("OrderPlaced(orderId, items, total)") == {
            "orderId", "items", "total"
        }

    def test_no_fields(self):
        assert _parse_fields("OrderPlaced") == set()

    def test_fields_with_values(self):
        assert _parse_fields("OrderPlaced(orderId=42, total=59.98)") == {
            "orderId", "total"
        }


# ---------------------------------------------------------------------------
# _resolve_ref
# ---------------------------------------------------------------------------

class TestResolveRef:
    def test_relative_path(self):
        assert _resolve_ref("https://github.com/org/repo/blob/main", "src/Foo.kt") == (
            "https://github.com/org/repo/blob/main/src/Foo.kt"
        )

    def test_absolute_url(self):
        assert _resolve_ref("https://example.com", "https://other.com/file") == (
            "https://other.com/file"
        )

    def test_vscode_url(self):
        assert _resolve_ref("https://example.com", "vscode://file/path") == (
            "vscode://file/path"
        )

    def test_empty_base(self):
        assert _resolve_ref("", "src/Foo.kt") == "src/Foo.kt"

    def test_trailing_slash_base(self):
        assert _resolve_ref("https://example.com/", "src/Foo.kt") == (
            "https://example.com/src/Foo.kt"
        )


# ---------------------------------------------------------------------------
# Model validation: valid models
# ---------------------------------------------------------------------------

class TestValidModel:
    def test_golden_fixture_validates(self):
        data = json.loads((FIXTURES / "todo_app_model.json").read_text())
        model = EventModel.model_validate(data)
        total_slices = sum(len(ch.slices) for ch in model.chapters)
        assert total_slices == 9

    def test_minimal_model(self):
        data = {
            "name": "Minimal",
            "actors": [{"id": "u", "name": "User", "type": "user"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{
                "name": "Ch",
                "slices": [{
                    "actor": "u", "aggregate": "a",
                    "ui": "POST /test",
                    "command": "DoThing(id, result)",
                    "events": ["ThingCompleted(id, result)"],
                    "read_models": ["ThingView(id, result)"],
                }],
            }],
        }
        model = EventModel.model_validate(data)
        assert model.name == "Minimal"

    def test_view_only_slice(self):
        data = {
            "name": "ViewOnly",
            "actors": [{"id": "u", "name": "User", "type": "user"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{
                "name": "Ch",
                "slices": [{
                    "actor": "u", "aggregate": "a",
                    "ui": "GET /things",
                    "read_models": ["ThingList(id, name)"],
                }],
            }],
        }
        EventModel.model_validate(data)

    def test_multi_trigger_state_view(self):
        """State View with multiple triggers: RM fields covered by union."""
        data = {
            "name": "MultiTrigger",
            "actors": [{"id": "u", "name": "User", "type": "user"},
                       {"id": "s", "name": "System", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{
                "name": "Ch",
                "slices": [
                    {
                        "actor": "u", "aggregate": "a",
                        "ui": "POST /items",
                        "command": "AddItem(itemId, name, price)",
                        "events": ["ItemAdded(itemId, name, price)"],
                        "read_models": ["CategoryRules(name, category)"],
                    },
                    {
                        "actor": "s", "aggregate": "a",
                        "automation": "OnItemAdded",
                        "trigger": "ItemAdded(itemId, name, price)",
                        "reads": ["CategoryRules"],
                        "command": "Categorize(itemId)",
                        "events": ["ItemCategorized(itemId, category)"],
                    },
                    {
                        "name": "Project Catalog",
                        "actor": "s", "aggregate": "a",
                        "trigger": [
                            "ItemAdded(itemId, name, price)",
                            "ItemCategorized(itemId, category)",
                        ],
                        "read_models": ["Catalog(itemId, name, price, category)"],
                    },
                ],
            }],
        }
        model = EventModel.model_validate(data)
        assert len(model.chapters[0].slices) == 3

    def test_multi_trigger_renders(self):
        """Multi-trigger State Views produce valid SVG."""
        data = {
            "name": "MultiTrigger",
            "actors": [{"id": "s", "name": "Sys", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{
                "name": "Ch",
                "slices": [{
                    "actor": "s", "aggregate": "a",
                    "trigger": [
                        "EventA(id, x)",
                        "EventB(id, y)",
                    ],
                    "read_models": ["View(id, x, y)"],
                }],
            }],
        }
        model = EventModel.model_validate(data)
        svg = render_svg(model)
        assert "<svg" in svg


# ---------------------------------------------------------------------------
# Model validation: rejection tests
# ---------------------------------------------------------------------------

class TestInvalidModel:
    def _base(self, **overrides):
        """Minimal valid slice with overrides applied."""
        slc = {
            "actor": "u", "aggregate": "a",
            "ui": "POST /test",
            "command": "DoThing(id)",
            "events": ["ThingDone(id, result)"],
            "read_models": ["ThingView(id, result)"],
        }
        slc.update(overrides)
        return {
            "name": "Test",
            "actors": [{"id": "u", "name": "User", "type": "user"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": [slc]}],
        }

    def test_unknown_actor(self):
        data = self._base(actor="nonexistent")
        with pytest.raises(ValidationError, match="unknown actor"):
            EventModel.model_validate(data)

    def test_unknown_aggregate(self):
        data = self._base(aggregate="nonexistent")
        with pytest.raises(ValidationError, match="unknown aggregate"):
            EventModel.model_validate(data)

    def test_imperative_event_rejected(self):
        data = self._base(events=["PlaceOrder(id, result)"],
                          read_models=["OrderView(id, result)"])
        with pytest.raises(ValidationError, match="doesn't look past tense"):
            EventModel.model_validate(data)

    def test_past_tense_command_rejected(self):
        data = self._base(command="OrderPlaced(id)")
        with pytest.raises(ValidationError, match="looks past tense"):
            EventModel.model_validate(data)

    def test_automation_without_trigger(self):
        data = self._base(automation="OnSomething", trigger=None,
                          ui=None)
        with pytest.raises(ValidationError, match="no trigger"):
            EventModel.model_validate(data)

    def test_schema_only_gwt_rejected(self):
        data = self._base(tests=[{
            "name": "bad test",
            "given": [],
            "when": "DoThing(id, name)",
            "then": ["ThingDone(id, result)"],
        }])
        with pytest.raises(ValidationError, match="lacks concrete example data"):
            EventModel.model_validate(data)

    def test_read_model_no_field_overlap(self):
        data = self._base(
            events=["ThingDone(thingId, result)"],
            read_models=["OtherView(userId, email)"],
        )
        with pytest.raises(ValidationError, match="shares no fields"):
            EventModel.model_validate(data)

    def test_state_view_strict_provenance(self):
        """State View RM fields must ALL trace to trigger, not just one."""
        data = {
            "name": "Test",
            "actors": [{"id": "s", "name": "Sys", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": [{
                "actor": "s", "aggregate": "a",
                "trigger": "SmallEvent(id, status)",
                "read_models": ["BigView(id, status, extra1, extra2, extra3)"],
            }]}],
        }
        with pytest.raises(ValidationError, match="no provenance"):
            EventModel.model_validate(data)

    def test_multi_trigger_covers_all_fields(self):
        """Multi-trigger union must cover ALL RM fields, not just some."""
        data = {
            "name": "Test",
            "actors": [{"id": "s", "name": "Sys", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": [{
                "actor": "s", "aggregate": "a",
                "trigger": [
                    "EventA(id, x)",
                    "EventB(id, y)",
                ],
                "read_models": ["View(id, x, y, mystery)"],
            }]}],
        }
        with pytest.raises(ValidationError, match="no provenance.*mystery"):
            EventModel.model_validate(data)

    def test_event_provenance_strict_with_reads(self):
        """Reads doesn't grant a free pass — untraced event fields are errors."""
        data = {
            "name": "Test",
            "actors": [{"id": "u", "name": "User", "type": "user"},
                       {"id": "s", "name": "Sys", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": [
                {
                    "actor": "u", "aggregate": "a",
                    "ui": "POST /items",
                    "command": "AddItem(itemId, name)",
                    "events": ["ItemAdded(itemId, name)"],
                    "read_models": ["Inventory(itemId, stock)"],
                },
                {
                    "actor": "s", "aggregate": "a",
                    "automation": "OnItemAdded",
                    "trigger": "ItemAdded(itemId, name)",
                    "reads": ["Inventory"],
                    "command": "EnrichItem(itemId, name, stock)",
                    "events": ["ItemEnriched(itemId, name, stock, mystery)"],
                },
            ]}],
        }
        with pytest.raises(ValidationError, match="no provenance.*mystery"):
            EventModel.model_validate(data)

    def test_event_provenance_passes_when_fields_in_reads(self):
        """Event fields that trace to consumed read model fields are valid."""
        data = {
            "name": "Test",
            "actors": [{"id": "u", "name": "User", "type": "user"},
                       {"id": "s", "name": "Sys", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": [
                {
                    "actor": "u", "aggregate": "a",
                    "ui": "POST /items",
                    "command": "AddItem(itemId, name)",
                    "events": ["ItemAdded(itemId, name)"],
                    "read_models": ["Inventory(itemId, stock)"],
                },
                {
                    "actor": "s", "aggregate": "a",
                    "automation": "OnItemAdded",
                    "trigger": "ItemAdded(itemId, name)",
                    "reads": ["Inventory"],
                    "command": "EnrichItem(itemId, name, stock)",
                    "events": ["ItemEnriched(itemId, name, stock)"],
                },
            ]}],
        }
        EventModel.model_validate(data)

    def test_empty_chapter_rejected(self):
        data = {
            "name": "Test",
            "actors": [{"id": "u", "name": "User", "type": "user"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Empty", "slices": []}],
        }
        with pytest.raises(ValidationError, match="at least one slice"):
            EventModel.model_validate(data)


# ---------------------------------------------------------------------------
# SVG rendering
# ---------------------------------------------------------------------------

class TestRenderSvg:
    def test_golden_model_renders(self):
        data = json.loads((FIXTURES / "todo_app_model.json").read_text())
        model = EventModel.model_validate(data)
        svg = render_svg(model)
        assert svg.startswith("<svg")
        assert "</svg>" in svg
        assert "Todo List Application" in svg

    def test_empty_model_renders(self):
        model = EventModel(
            name="Empty",
            actors=[{"id": "u", "name": "U", "type": "user"}],
            aggregates=[{"id": "a", "name": "A"}],
            chapters=[{"name": "Ch", "slices": [{
                "actor": "u", "aggregate": "a",
                "ui": "GET /x",
                "read_models": ["X(id)"],
            }]}],
        )
        svg = render_svg(model)
        assert "<svg" in svg

    def test_svg_contains_slice_elements(self):
        data = json.loads((FIXTURES / "todo_app_model.json").read_text())
        model = EventModel.model_validate(data)
        svg = render_svg(model)
        assert "CreateList" in svg
        assert "ListCreated" in svg
        assert "TodoLists" in svg
        assert "POST /v1/lists" in svg


# ---------------------------------------------------------------------------
# CLI: init produces valid model
# ---------------------------------------------------------------------------

class TestInit:
    def test_init_template_validates(self, tmp_path):
        out = tmp_path / "model.json"
        from event_model import cmd_init
        import argparse
        args = argparse.Namespace(model=str(out))
        cmd_init(args)
        data = json.loads(out.read_text())
        EventModel.model_validate(data)


# ---------------------------------------------------------------------------
# Fields the TypeScript model emits natively: query, polls, note/notes, mapping
# ---------------------------------------------------------------------------

TS_EXAMPLE = Path(__file__).resolve().parent.parent / "ts" / "test" / "todo-app.json"


class TestNativeFields:
    CREATE = {
        "name": "Create", "actor": "u", "aggregate": "a", "ui": "Svc/Create",
        "command": "Create(id, text)", "events": ["Created(id, title)"],
        "mapping": {"Created": {"title": {"from": "text"}}},
    }
    PROJECT = {
        "actor": "s", "aggregate": "a", "trigger": ["Created(id, title)"],
        "read_models": ["Table(*id, title, count)"],
        "mapping": {"Created": {"count": {"count": True}}},
    }
    VIEW = {
        "actor": "u", "aggregate": "a", "ui": "Svc/Get",
        "read_models": ["Table(*id, title, count)"], "query": ["id"],
    }
    POLLER = {
        "actor": "s", "aggregate": "a", "automation": "Poller", "polls": "Table",
        "command": "Process(id)", "events": ["Processed(id)"],
    }

    def _model(self, *slices, **extra):
        return {
            "name": "Native",
            "actors": [{"id": "u", "name": "User", "type": "user"},
                       {"id": "s", "name": "System", "type": "system"}],
            "aggregates": [{"id": "a", "name": "A"}],
            "chapters": [{"name": "Ch", "slices": list(slices)}],
            **extra,
        }

    def test_ts_example_validates_with_no_warnings(self):
        model = EventModel.model_validate(json.loads(TS_EXAMPLE.read_text()))
        assert model._warnings == []

    def test_mapping_traces_a_renamed_field_and_a_computed_column(self):
        EventModel.model_validate(self._model(self.CREATE, self.PROJECT, self.VIEW))

    def test_renamed_field_without_mapping_is_an_error(self):
        create = {k: v for k, v in self.CREATE.items() if k != "mapping"}
        with pytest.raises(ValidationError, match="no provenance: title"):
            EventModel.model_validate(self._model(create, self.PROJECT, self.VIEW))

    def test_computed_column_without_mapping_is_an_error(self):
        project = {k: v for k, v in self.PROJECT.items() if k != "mapping"}
        with pytest.raises(ValidationError, match="no provenance from Created: count"):
            EventModel.model_validate(self._model(self.CREATE, project, self.VIEW))

    def test_mapping_from_must_name_a_field_the_handler_receives(self):
        create = {**self.CREATE, "mapping": {"Created": {"title": {"from": "nope"}}}}
        with pytest.raises(ValidationError, match="reads 'nope', which Create does not carry"):
            EventModel.model_validate(self._model(create, self.PROJECT, self.VIEW))

    def test_mapping_source_rejects_unknown_keys(self):
        create = {**self.CREATE, "mapping": {"Created": {"title": {"form": "text"}}}}
        with pytest.raises(ValidationError):
            EventModel.model_validate(self._model(create, self.PROJECT, self.VIEW))

    def test_polls_drives_an_automation_without_a_trigger(self):
        model = EventModel.model_validate(self._model(self.CREATE, self.PROJECT, self.VIEW, self.POLLER))
        assert model.chapters[0].slices[3].polls == "Table"

    def test_polls_must_name_a_projected_read_model(self):
        poller = {**self.POLLER, "polls": "Nope"}
        with pytest.raises(ValidationError, match="reads unknown read model 'Nope'"):
            EventModel.model_validate(self._model(self.CREATE, self.PROJECT, self.VIEW, poller))

    def test_query_fields_draw_on_the_interface_card(self):
        svg = render_svg(EventModel.model_validate(self._model(self.CREATE, self.PROJECT, self.VIEW)))
        assert "Svc/Get" in svg and "(id)" in svg

    def test_polls_draws_on_the_gear(self):
        svg = render_svg(EventModel.model_validate(
            self._model(self.CREATE, self.PROJECT, self.VIEW, self.POLLER)))
        assert "polls: Table" in svg

    def test_notes_are_tooltips(self):
        create = {**self.CREATE, "note": "The first slice."}
        data = self._model(create, self.PROJECT, self.VIEW, notes={"Created": "One per id."})
        svg = render_svg(EventModel.model_validate(data))
        assert "<title>One per id.</title>" in svg
        assert "<title>The first slice.</title>" in svg
