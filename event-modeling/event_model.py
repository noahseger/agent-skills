#!/usr/bin/env python3
"""Event Model — schema, validation, and SVG visualization.

Terminology:
    Aggregate — DDD aggregate / event stream, rendered as a horizontal swim lane
    Chapter   — horizontal section of the timeline grouping related slices
    Slice     — one vertical cut: one command producing events (one column)

Usage:
    python event_model.py validate <model.json>
    python event_model.py render <model.json> [-o output.svg]
    python event_model.py schema
    python event_model.py init <model.json>
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import textwrap
from html import escape
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class Actor(BaseModel):
    id: str
    name: str
    type: Literal["user", "admin", "system", "external"]


class Aggregate(BaseModel):
    """DDD aggregate / event stream — rendered as a horizontal swim lane."""
    id: str
    name: str


class GivenWhenThen(BaseModel):
    """Test spec using explicit domain names with concrete example data."""
    name: str
    given: list[str]
    when: str = ""  # empty for State View slices (no command to fire)
    then: list[str]


class SourceRef(BaseModel):
    """Clickable annotation linking a diagram element to source code."""
    label: str
    path: str


class Slice(BaseModel):
    """One vertical cut through the timeline. At most one command."""
    name: str | None = None
    actor: str
    aggregate: str
    ui: str | None = None
    external_event: str | None = None  # event arriving from outside the system boundary
    automation: str | None = None
    trigger: str | list[str] | None = None  # event(s) that drive the automation or State View projection
    command: str | None = None
    events: list[str] = Field(default_factory=list)
    reads: list[str] = Field(default_factory=list)  # consumed read models (inputs)
    read_models: list[str] = Field(default_factory=list)  # produced read models (outputs)
    tests: list[GivenWhenThen] = Field(default_factory=list)
    refs: dict[str, list[SourceRef]] = Field(default_factory=dict)


class Chapter(BaseModel):
    """Timeline section grouping related slices."""
    name: str
    slices: list[Slice]

    @model_validator(mode="after")
    def at_least_one_slice(self):
        if not self.slices:
            raise ValueError("Chapter must have at least one slice")
        return self


class EventModel(BaseModel):
    name: str
    description: str = ""
    source_base: str = ""  # URL prefix for source refs (e.g. GitHub blob URL)
    actors: list[Actor]
    aggregates: list[Aggregate]
    chapters: list[Chapter]

    @model_validator(mode="after")
    def validate_references(self):
        actor_ids = {a.id for a in self.actors}
        agg_ids = {a.id for a in self.aggregates}
        errors: list[str] = []
        warnings: list[str] = []

        # Build read model registry: name → union of all field sets
        rm_registry: dict[str, set[str]] = {}
        for ch in self.chapters:
            for sl in ch.slices:
                for rm in sl.read_models:
                    rm_name = _parse_element(rm)[0]
                    rm_fields = _parse_fields(rm)
                    if rm_name in rm_registry:
                        rm_registry[rm_name] |= rm_fields
                    else:
                        rm_registry[rm_name] = set(rm_fields)

        for ch in self.chapters:
            for si, sl in enumerate(ch.slices):
                loc = f"'{sl.name}'" if sl.name else f"slice #{si + 1}"
                loc = f"{loc} in '{ch.name}'"
                if sl.actor not in actor_ids:
                    errors.append(
                        f"{loc} references unknown actor '{sl.actor}'"
                    )
                if sl.aggregate not in agg_ids:
                    errors.append(
                        f"{loc} references unknown aggregate '{sl.aggregate}'"
                    )
                if sl.automation and not _trigger_list(sl):
                    errors.append(
                        f"Automation '{sl.automation}' in {loc} has no trigger — "
                        f"automations MUST be driven by an event or a TODO-list read model"
                    )
                if sl.external_event:
                    ext_name = _parse_element(sl.external_event)[0]
                    if not _looks_past_tense(ext_name):
                        errors.append(
                            f"External event '{ext_name}' in {loc} doesn't look past tense — "
                            f"events should be facts (e.g. InventoryChanged, PriceUpdated)"
                        )
                for ev in sl.events:
                    name = _parse_element(ev)[0]
                    if not _looks_past_tense(name):
                        errors.append(
                            f"Event '{name}' in {loc} doesn't look past tense — "
                            f"events should be facts (e.g. OrderPlaced, UserRegistered)"
                        )
                if sl.command:
                    cmd_name = _parse_element(sl.command)[0]
                    if _looks_past_tense(cmd_name):
                        errors.append(
                            f"Command '{cmd_name}' in {loc} looks past tense — "
                            f"commands should be imperative (e.g. PlaceOrder, RegisterUser)"
                        )
                for test in sl.tests:
                    if not _has_concrete_data(test):
                        errors.append(
                            f"Test '{test.name}' in {loc} lacks concrete example data — "
                            f"use real values like userId=42, amount=59.98"
                        )
                # Projection check: read model must share at least one field with
                # the slice's events (State Change / Automation) or trigger (State View).
                if sl.read_models and sl.events:
                    event_fields: set[str] = set()
                    for ev in sl.events:
                        event_fields |= _parse_fields(ev)
                    for rm in sl.read_models:
                        rm_fields = _parse_fields(rm)
                        if rm_fields and not (rm_fields & event_fields):
                            rm_name = _parse_element(rm)[0]
                            errors.append(
                                f"Read model '{rm_name}' in {loc} shares no fields "
                                f"with events — read models must be projectable from events"
                            )
                elif _is_state_view(sl):
                    trigger_fields = _trigger_fields_union(sl)
                    # State View projections can also draw from consumed
                    # read models declared in 'reads' (data sources).
                    sv_allowed = set(trigger_fields)
                    for consumed in sl.reads:
                        consumed_name = _parse_element(consumed)[0]
                        if consumed_name in rm_registry:
                            sv_allowed |= rm_registry[consumed_name]
                    if sv_allowed:
                        for rm in sl.read_models:
                            rm_fields = _parse_fields(rm)
                            if not rm_fields:
                                continue
                            untraced = rm_fields - sv_allowed
                            if untraced:
                                rm_name = _parse_element(rm)[0]
                                raw_rm_name = rm.split("(")[0].strip() if "(" in rm else rm
                                is_collection = raw_rm_name.endswith("*")
                                sources = ", ".join(
                                    [_parse_element(t)[0] for t in _trigger_list(sl)]
                                    + list(sl.reads)
                                )
                                if is_collection or sl.reads:
                                    # Collection projections can compute
                                    # aggregates (e.g. gameCount = COUNT(*)).
                                    # Slices with reads can derive fields.
                                    # Warn, don't reject.
                                    warnings.append(
                                        f"Read model '{rm_name}' in {loc}: "
                                        f"{len(untraced)} field(s) derived "
                                        f"from {sources} (not name-traced): "
                                        f"{', '.join(sorted(untraced))}"
                                    )
                                else:
                                    errors.append(
                                        f"Read model '{rm_name}' in {loc} has "
                                        f"fields with no provenance from "
                                        f"{sources}: "
                                        f"{', '.join(sorted(untraced))} — "
                                        f"every read model field must trace "
                                        f"to a trigger event or consumed "
                                        f"read model"
                                    )
                # Cross-reference: consumed read models must exist somewhere
                for consumed in sl.reads:
                    consumed_name = _parse_element(consumed)[0]
                    if consumed_name not in rm_registry:
                        errors.append(
                            f"{loc} reads unknown read model '{consumed_name}' — "
                            f"it must be declared in some slice's read_models"
                        )
                # Provenance checks:
                #
                # 1. Event strict — every event field must trace by name to
                #    an input schema (command, trigger, external_event, reads).
                #    Untraced fields → error.  Commands should declare their
                #    full interface so every output field has a declared source.
                #
                # 2. Automation command strictness — every command argument must
                #    trace to a non-command source (trigger, external_event,
                #    reads).  The command receives data; it doesn't invent it.
                reads_fields: set[str] = set()
                for consumed in sl.reads:
                    consumed_name = _parse_element(consumed)[0]
                    if consumed_name in rm_registry:
                        reads_fields |= rm_registry[consumed_name]
                output_fields: set[str] = set()
                for rm in sl.read_models:
                    output_fields |= _parse_fields(rm)

                if sl.events:
                    input_fields: set[str] = set()
                    if sl.command:
                        input_fields |= _parse_fields(sl.command)
                    input_fields |= _trigger_fields_union(sl)
                    if sl.external_event:
                        input_fields |= _parse_fields(sl.external_event)
                    input_fields |= reads_fields
                    for ev in sl.events:
                        ev_fields = _parse_fields(ev)
                        if not ev_fields:
                            continue
                        untraced = ev_fields - input_fields
                        if untraced:
                            ev_name = _parse_element(ev)[0]
                            errors.append(
                                f"Event '{ev_name}' in {loc} has "
                                f"fields with no provenance: "
                                f"{', '.join(sorted(untraced))} — "
                                f"add these fields to the command, "
                                f"trigger, external event, or a "
                                f"consumed read model in 'reads'"
                            )
                # Automation command: every arg must trace to a non-command
                # source.  The command handler receives data from the trigger,
                # external event, consumed read models, or its own events
                # (output fields the handler computes).
                if sl.automation and sl.command:
                    non_cmd_fields: set[str] = set()
                    non_cmd_fields |= _trigger_fields_union(sl)
                    if sl.external_event:
                        non_cmd_fields |= _parse_fields(sl.external_event)
                    non_cmd_fields |= reads_fields
                    non_cmd_fields |= output_fields
                    # Event fields are valid outputs — the handler computes
                    # them.  With projections as separate State View slices,
                    # output_fields from read_models may be empty, but the
                    # command still declares its full interface.
                    for ev in sl.events:
                        non_cmd_fields |= _parse_fields(ev)
                    cmd_fields = _parse_fields(sl.command)
                    cmd_untraced = cmd_fields - non_cmd_fields
                    if cmd_untraced and non_cmd_fields:
                        cmd_name = _parse_element(sl.command)[0]
                        errors.append(
                            f"Automation command '{cmd_name}' in {loc} has "
                            f"fields with no source: "
                            f"{', '.join(sorted(cmd_untraced))} — "
                            f"automation command arguments must trace to "
                            f"the trigger, external event, or consumed "
                            f"read models in 'reads'"
                        )

        if errors:
            raise ValueError(
                "Event model validation errors:\n" + "\n".join(f"  - {e}" for e in errors)
            )
        # Store warnings for CLI to surface (not fatal)
        self._warnings = warnings
        return self


# ---------------------------------------------------------------------------
# Invariant helpers
# ---------------------------------------------------------------------------

def _parse_element(text: str) -> tuple[str, str | None]:
    """Split 'Name(field1, field2)' into ('Name', 'field1, field2').

    Strips collection marker: 'ArchiveGames*(...)' → ('ArchiveGames', ...).
    """
    if "(" in text and text.endswith(")"):
        idx = text.index("(")
        name = text[:idx].strip().rstrip("*")
        return name, text[idx + 1 : -1].strip()
    return text.rstrip("*"), None


_PAST_TENSE_SUFFIXES = ("ed", "en", "wn", "zed")

# Irregular past tenses that don't end in standard suffixes above.
# Broad suffix matching on "ot"/"nt" produces too many false positives
# on common nouns (Post, Connect, Grant, Sprint, Event, Point, etc.).
_IRREGULAR_PAST_WORDS = frozenset({
    "got", "forgot", "begot", "shot",           # -ot irregulars
    "sent", "went", "spent", "burnt", "meant",  # -nt irregulars
    "bent", "lent", "rent",
    "built", "rebuilt",                          # -ilt irregulars
})


def _looks_past_tense(name: str) -> bool:
    """Heuristic: does a CamelCase name end with a past-tense word?"""
    words = re.findall(r"[A-Z][a-z]*", name)
    if not words:
        return False
    last = words[-1].lower()
    if last in _IRREGULAR_PAST_WORDS:
        return True
    return any(last.endswith(s) for s in _PAST_TENSE_SUFFIXES)


def _has_concrete_data(test: GivenWhenThen) -> bool:
    """Check that at least one GWT clause contains a concrete value (=something)."""
    all_clauses = test.given + [test.when] + test.then
    return any("=" in clause for clause in all_clauses)


def _parse_fields(text: str) -> set[str]:
    """Extract field names from 'Name(field1, field2)' schema notation.

    Strips markers: '*period' → 'period', 'gameKey*' → 'gameKey'.
    """
    _, fields_str = _parse_element(text)
    if not fields_str:
        return set()
    fields = set()
    for part in fields_str.split(","):
        field = part.strip().split("=")[0].strip().lstrip("*").rstrip("*")
        if field:
            fields.add(field)
    return fields


def _is_state_view(sl: Slice) -> bool:
    """True when the slice is a pure State View projection (trigger → read models)."""
    return bool(
        sl.trigger and sl.read_models
        and not sl.command and not sl.events
        and not sl.automation and not sl.ui and not sl.external_event
    )


def _trigger_list(sl: Slice) -> list[str]:
    """Normalize trigger to a list (handles both str and list[str])."""
    if sl.trigger is None:
        return []
    if isinstance(sl.trigger, list):
        return sl.trigger
    return [sl.trigger]


def _trigger_fields_union(sl: Slice) -> set[str]:
    """Return the union of all fields across all triggers in the slice."""
    fields: set[str] = set()
    for t in _trigger_list(sl):
        fields |= _parse_fields(t)
    return fields


def _trigger_names(sl: Slice) -> set[str]:
    """Return the set of trigger event names (without fields)."""
    return {_parse_element(t)[0] for t in _trigger_list(sl)}


# ---------------------------------------------------------------------------
# Source ref helpers
# ---------------------------------------------------------------------------

def _resolve_ref(source_base: str, ref_path: str) -> str:
    """Build full URL from base and relative path."""
    if ref_path.startswith(("http://", "https://", "vscode://")):
        return ref_path
    if not source_base:
        return ref_path
    return source_base.rstrip("/") + "/" + ref_path.lstrip("/")


def _lookup_refs(sl: Slice, label: str, source_base: str) -> list[tuple[str, str]]:
    """Return list of (label, full_url) for an element's annotations."""
    src_refs = sl.refs.get(label, [])
    return [(r.label, _resolve_ref(source_base, r.path)) for r in src_refs]


# ---------------------------------------------------------------------------
# SVG helpers
# ---------------------------------------------------------------------------

def _esc(text: str) -> str:
    return escape(text, quote=True)


def _wrap(text: str, max_chars: int = 20) -> list[str]:
    return textwrap.wrap(text, width=max_chars) or [text]


def _camel_wrap(name: str, max_chars: int = 20) -> list[str]:
    """Wrap at CamelCase word boundaries instead of mid-word.

    'CartsWithProductsView' at width 20 → ['CartsWithProducts', 'View']
    Falls back to textwrap for non-CamelCase strings (e.g. URLs with spaces).
    """
    words = re.findall(r"[A-Z][a-z]*", name)
    if not words or "".join(words) != name:
        return textwrap.wrap(name, width=max_chars) or [name]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + len(word) <= max_chars:
            current += word
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _text_block(
    x: float, y: float, lines: list[str],
    font_size: int = 11, fill: str = "#000",
    anchor: str = "middle", line_height: float = 14,
    font_weight: str = "normal",
) -> str:
    offset = -(len(lines) - 1) * line_height / 2
    parts = []
    for i, line in enumerate(lines):
        dy = offset + i * line_height
        parts.append(
            f'<text x="{x}" y="{y + dy}" font-family="Inter, Helvetica, Arial, sans-serif" '
            f'font-size="{font_size}" fill="{fill}" text-anchor="{anchor}" '
            f'font-weight="{font_weight}" '
            f'dominant-baseline="central">{_esc(line)}</text>'
        )
    return "\n".join(parts)


def _element_card(
    x: float, y: float, w: float, h: float,
    label: str, fill: str, text_fill: str = "#fff",
    stroke: str | None = None, rx: int = 6,
    refs: list[tuple[str, str]] = (),
) -> str:
    """Render a card with CamelCase name + optional (fields) schema below.

    refs: list of (label, url) pairs. Single ref wraps card in <a>.
    Multi-ref annotation panels are rendered separately by _ref_panel.
    """
    stroke_attr = f' stroke="{stroke}" stroke-width="1"' if stroke else ""
    name, fields = _parse_element(label)
    # Preserve collection marker (*) in display name
    raw_name = label.split("(")[0].strip() if "(" in label else label
    name_lines = _camel_wrap(raw_name, max_chars=int(w / 6.5))
    parts = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
        f'fill="{fill}"{stroke_attr}/>'
    ]
    if fields:
        field_lines = _wrap(f"({fields})", max_chars=int(w / 5))
        # Pre-calculate all text y-positions, then center the block.
        # Name lines use 13px step, field lines use 10px step.
        # First text is at cy+13 (not cy+0), so we center between first and last.
        n = len(name_lines)
        m = len(field_lines)
        first_offset = 13
        last_offset = n * 13 + m * 10
        mid = (first_offset + last_offset) / 2
        cy = y + h / 2 - mid
        for line in name_lines:
            cy += 13
            parts.append(
                f'<text x="{x + w/2}" y="{cy}" font-family="Inter, Helvetica, Arial, sans-serif" '
                f'font-size="11" fill="{text_fill}" text-anchor="middle" '
                f'dominant-baseline="central" font-weight="600">{_esc(line)}</text>'
            )
        for line in field_lines:
            cy += 10
            parts.append(
                f'<text x="{x + w/2}" y="{cy}" font-family="Inter, Helvetica, Arial, sans-serif" '
                f'font-size="8" fill="{text_fill}" text-anchor="middle" '
                f'dominant-baseline="central" opacity="0.75">{_esc(line)}</text>'
            )
    else:
        parts.append(
            _text_block(x + w / 2, y + h / 2, name_lines, font_size=11, fill=text_fill,
                        font_weight="600")
        )

    card_svg = "\n".join(parts)

    # Single ref: wrap entire card in a clickable link
    if len(refs) == 1:
        ref_label, ref_url = refs[0]
        card_svg = (
            f'<a href="{_esc(ref_url)}" target="_blank">'
            f'<title>{_esc(ref_label)}</title>\n'
            + card_svg
            + f'\n<text x="{x + w - 6}" y="{y + 9}" font-size="8" '
            f'fill="{text_fill}" text-anchor="end" opacity="0.6">\u2197</text>'
            + "\n</a>"
        )

    return card_svg


def _arrow_down(x: float, y1: float, y2: float, color: str = "#666") -> str:
    return (
        f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2 - 6}" '
        f'stroke="{color}" stroke-width="1.5" marker-end="url(#arrowhead-{color.strip("#")})"/>'
    )


def _arrow_up(x: float, y1: float, y2: float, color: str = "#666", dashed: bool = False) -> str:
    dash = ' stroke-dasharray="4,3"' if dashed else ""
    return (
        f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2 + 6}" '
        f'stroke="{color}" stroke-width="1.5"{dash} marker-end="url(#arrowhead-{color.strip("#")})"/>'
    )


def _arrow_right(x1: float, x2: float, y: float, color: str = "#666", dashed: bool = True) -> str:
    dash = ' stroke-dasharray="6,3"' if dashed else ""
    return (
        f'<line x1="{x1}" y1="{y}" x2="{x2 - 6}" y2="{y}" '
        f'stroke="{color}" stroke-width="1.5"{dash} '
        f'marker-end="url(#arrowhead-{color.strip("#")})"/>'
    )


def _gear_icon(cx: float, cy: float, size: float = 12, fill: str = "#9C27B0") -> str:
    r_outer = size
    r_inner = size * 0.55
    teeth = 8
    path_parts = []
    for i in range(teeth):
        a1 = (2 * math.pi / teeth) * i - math.pi / teeth / 2
        a2 = (2 * math.pi / teeth) * i + math.pi / teeth / 2
        ox1 = cx + r_outer * math.cos(a1)
        oy1 = cy + r_outer * math.sin(a1)
        ox2 = cx + r_outer * math.cos(a2)
        oy2 = cy + r_outer * math.sin(a2)
        ix1 = cx + r_inner * math.cos(a1)
        iy1 = cy + r_inner * math.sin(a1)
        ix2 = cx + r_inner * math.cos(a2)
        iy2 = cy + r_inner * math.sin(a2)
        if i == 0:
            path_parts.append(f"M {ix1:.1f} {iy1:.1f}")
        else:
            path_parts.append(f"L {ix1:.1f} {iy1:.1f}")
        path_parts.append(f"L {ox1:.1f} {oy1:.1f}")
        path_parts.append(f"L {ox2:.1f} {oy2:.1f}")
        path_parts.append(f"L {ix2:.1f} {iy2:.1f}")
    path_parts.append("Z")
    return (
        f'<path d="{" ".join(path_parts)}" fill="{fill}" opacity="0.85"/>\n'
        f'<circle cx="{cx}" cy="{cy}" r="{r_inner * 0.5}" fill="white"/>'
    )


# ---------------------------------------------------------------------------
# Diagram renderer
# ---------------------------------------------------------------------------

COMMAND_BG = "#5B8DEF"
EVENT_BG = "#E8A850"
VIEW_BG = "#5BA88A"
UI_BG = "#F5F5F5"
UI_STROKE = "#BDBDBD"
AUTOMATION_COLOR = "#907AB5"
CHAPTER_BG = "#EDF2FA"
GWT_GIVEN_BG = "#FDF5EB"
GWT_WHEN_BG = "#EBF1FA"
GWT_THEN_BG = "#EDF6F1"
AGG_LANE_COLORS = ["#FAFAFA", "#F5F5F5"]
DIVIDER_COLOR = "#E0E0E0"

CARD_W = 190
CARD_H = 56  # minimum card height; actual height is dynamic based on text content
COL_GAP = 48
ROW_GAP = 14
CMD_EVT_GAP = 32  # vertical gap between command and event rows in aggregate lanes
CHAPTER_PAD = 36
LANE_LABEL_W = 110
HEADER_H = 36
RM_X_OFFSET = 30  # horizontal offset for read model cards to clear down-flow arrows
RM_RIGHT_PAD = 18  # right padding for read model cards to clear up-flow arrows
RM_STACK_GAP = 8  # vertical gap between stacked read model cards in the same slice
GWT_LINE_H = 11
GWT_MAX_CHARS = 36  # chars per line at 7px font within CARD_W
GWT_NAME_MAX_CHARS = 28  # chars per line for test name in header bar
GWT_NAME_LINE_H = 10  # line height for wrapped test names
GWT_SECTION_PAD = 6  # padding below GWT section headers before content
REF_LINE_H = 10  # height per annotation line in ref panel
ARROW_SPREAD = 8  # px between overlapping parallel arrows
REF_PAD = 4  # padding above annotation panel


def _card_height(label: str, w: float = CARD_W) -> float:
    """Compute the height a card needs to fit its text without clipping.

    Uses the same wrapping logic as _element_card: CamelCase name at 6.5px
    and field lines at 5px character width.
    """
    name, fields = _parse_element(label)
    raw_name = label.split("(")[0].strip() if "(" in label else label
    name_lines = _camel_wrap(raw_name, max_chars=int(w / 6.5))
    n = len(name_lines)
    if fields:
        field_lines = _wrap(f"({fields})", max_chars=int(w / 5))
        m = len(field_lines)
        text_h = n * 13 + m * 10
    else:
        text_h = n * 13
    # Add vertical padding (top + bottom)
    return max(CARD_H, text_h + 20)


def _ref_panel_h(count: int) -> float:
    """Extra vertical space needed for a multi-ref annotation panel."""
    if count <= 1:
        return 0
    return REF_PAD + count * REF_LINE_H


def _ref_panel(
    x: float, y: float, w: float,
    refs: list[tuple[str, str]],
) -> str:
    """Render clickable annotation lines below a card."""
    if len(refs) <= 1:
        return ""
    lines: list[str] = []
    ry = y + REF_PAD
    for label, url in refs:
        lines.append(
            f'<a href="{_esc(url)}" target="_blank">'
            f'<text x="{x + 4}" y="{ry + REF_LINE_H / 2}" '
            f'font-family="Inter, Helvetica, Arial, sans-serif" '
            f'font-size="7" fill="#1A73E8" dominant-baseline="central">'
            f'\u2197 {_esc(label)}</text></a>'
        )
        ry += REF_LINE_H
    return "\n".join(lines)


def _col_width():
    return CARD_W + COL_GAP


def _gwt_wrap(text: str) -> list[str]:
    """Wrap GWT text to fit within card width."""
    return textwrap.wrap(text, width=GWT_MAX_CHARS) or [text]


def _gwt_name_wrap(name: str) -> list[str]:
    """Wrap test name for GWT header bar."""
    return textwrap.wrap(name, width=GWT_NAME_MAX_CHARS) or [name]


def _gwt_header_h(test: GivenWhenThen) -> float:
    """Height of the GWT card header bar (accounts for name wrapping)."""
    name_lines = len(_gwt_name_wrap(test.name))
    return 20 + max(0, name_lines - 1) * GWT_NAME_LINE_H


def _gwt_card_height(test: GivenWhenThen) -> float:
    header_h = _gwt_header_h(test)
    given_lines = sum(len(_gwt_wrap(g)) for g in test.given)
    when_lines = len(_gwt_wrap(test.when))
    then_lines = sum(len(_gwt_wrap(t)) for t in test.then)
    given_h = given_lines * GWT_LINE_H + 20 + GWT_SECTION_PAD
    when_h = when_lines * GWT_LINE_H + 20 + GWT_SECTION_PAD
    then_h = then_lines * GWT_LINE_H + 8 + GWT_SECTION_PAD
    return header_h + 4 + given_h + when_h + then_h + 6


def render_svg(model: EventModel) -> str:
    actor_map = {a.id: a for a in model.actors}
    agg_map = {a.id: a for a in model.aggregates}
    agg_ids = [a.id for a in model.aggregates]

    # Build read model registry for resolving consumed read model fields
    # and tracking which chapter produces each read model
    rm_registry: dict[str, set[str]] = {}
    rm_source_chapter: dict[str, str] = {}  # RM name → producing chapter name
    for ch in model.chapters:
        for sl in ch.slices:
            for rm in sl.read_models:
                rm_name = _parse_element(rm)[0]
                rm_fields = _parse_fields(rm)
                if rm_name in rm_registry:
                    rm_registry[rm_name] |= rm_fields
                else:
                    rm_registry[rm_name] = set(rm_fields)
                if rm_name not in rm_source_chapter:
                    rm_source_chapter[rm_name] = ch.name

    # Flatten slices into columns
    columns: list[tuple[int, int, Slice]] = []
    for ci, ch in enumerate(model.chapters):
        for si, sl in enumerate(ch.slices):
            columns.append((ci, si, sl))

    if not columns:
        return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text x="10" y="30">Empty model</text></svg>'

    # --- X positions per column, with gaps between chapters ---
    col_x: list[float] = []
    x_cursor = LANE_LABEL_W + CHAPTER_PAD
    prev_chapter = -1
    chapter_x_ranges: dict[int, tuple[float, float]] = {}
    for col_idx, (ci, si, _sl) in enumerate(columns):
        if ci != prev_chapter and prev_chapter >= 0:
            x_cursor += CHAPTER_PAD
        if si == 0:
            chapter_x_ranges[ci] = (x_cursor, 0)
        col_x.append(x_cursor)
        x_cursor += _col_width()
        prev_chapter = ci

    col_counter = 0
    for ci, ch in enumerate(model.chapters):
        start = chapter_x_ranges[ci][0]
        end_col = col_counter + len(ch.slices) - 1
        end = col_x[end_col] + CARD_W
        chapter_x_ranges[ci] = (start, end)
        col_counter += len(ch.slices)

    total_width = x_cursor + CHAPTER_PAD

    # --- Annotation layout: compute max ref counts per card position ---
    max_cmd_refs = 0
    max_evt_refs = 0
    max_ui_refs = 0
    max_rm_refs = 0
    for _, _, sl in columns:
        if sl.command:
            max_cmd_refs = max(max_cmd_refs, len(sl.refs.get(sl.command, [])))
        for ev in sl.events:
            max_evt_refs = max(max_evt_refs, len(sl.refs.get(ev, [])))
        if sl.ui:
            max_ui_refs = max(max_ui_refs, len(sl.refs.get(sl.ui, [])))
        if sl.external_event:
            max_ui_refs = max(max_ui_refs, len(sl.refs.get(sl.external_event, [])))
        for rm in sl.read_models:
            max_rm_refs = max(max_rm_refs, len(sl.refs.get(rm, [])))

    cmd_ref_extra = _ref_panel_h(max_cmd_refs)
    evt_ref_extra = _ref_panel_h(max_evt_refs)
    ui_ref_extra = _ref_panel_h(max_ui_refs)
    rm_ref_extra = _ref_panel_h(max_rm_refs)

    # --- Dynamic card heights: compute max height per row type ---
    max_ui_h = CARD_H
    max_cmd_h = CARD_H
    max_evt_h = CARD_H
    max_rm_h = CARD_H
    for _, _, sl in columns:
        if sl.ui:
            max_ui_h = max(max_ui_h, _card_height(sl.ui))
        if sl.external_event:
            max_ui_h = max(max_ui_h, _card_height(sl.external_event))
        if sl.command:
            max_cmd_h = max(max_cmd_h, _card_height(sl.command))
        for ev in sl.events:
            max_evt_h = max(max_evt_h, _card_height(ev))
        if _is_state_view(sl):
            for t in _trigger_list(sl):
                max_evt_h = max(max_evt_h, _card_height(t))
        for rm in sl.read_models:
            rm_w = CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
            max_rm_h = max(max_rm_h, _card_height(rm, rm_w))

    # --- Y layout: Title → Description → Legend → Chapters → ... ---
    y = 12.0
    title_y = y
    y += 24

    # Description subtitle
    desc_y = y
    has_desc = bool(model.description)
    if has_desc:
        y += 16

    # Color legend
    legend_y = y
    y += 20

    chapter_header_y = y
    y += HEADER_H + 8

    # Slice name row — only present when at least one slice has a name
    has_slice_names = any(sl.name for _, _, sl in columns)
    slice_name_row_h = 28 if has_slice_names else 0  # taller for breathing room
    slice_name_y = y
    y += slice_name_row_h

    # Per-actor swimlanes — one row per actor that has a UI, external event, or automation
    actors_with_entry = [a.id for a in model.actors
                         if any((sl.ui or sl.external_event) and sl.actor == a.id
                                for _, _, sl in columns)]
    actors_with_automation = [a.id for a in model.actors
                              if any(sl.automation and sl.actor == a.id for _, _, sl in columns)
                              and a.id not in actors_with_entry]
    all_actor_lanes = actors_with_entry + actors_with_automation

    ui_row_y: dict[str, float] = {}
    for aid in all_actor_lanes:
        ui_row_y[aid] = y
        y += max_ui_h + ui_ref_extra + ROW_GAP

    # Read model row (above aggregates, feeds UIs) — per-card variable heights
    # to avoid one tall card (e.g. ArchiveGames with 38 fields) inflating all cards
    CONSUMED_CARD_H = 38
    rm_w_layout = CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
    CONSUMED_BOTTOM_PAD = 12  # extra padding below backreference cards
    def _rm_row_height(sl: Slice) -> float:
        consumed_h = (len(sl.reads) * (CONSUMED_CARD_H + RM_STACK_GAP) + CONSUMED_BOTTOM_PAD) if sl.reads else 0
        produced_h = 0
        for rm in sl.read_models:
            produced_h += _card_height(rm, rm_w_layout) + RM_STACK_GAP
        if sl.read_models:
            produced_h -= RM_STACK_GAP
        return consumed_h + max(produced_h, CARD_H)
    rm_row_h = max((_rm_row_height(sl) for _, _, sl in columns), default=CARD_H) + rm_ref_extra
    read_model_row_y = y
    y += rm_row_h + ROW_GAP

    # Divider between read models and aggregate lanes
    divider1_y = y
    y += 8

    # Aggregate swim lanes — each lane has command row + event row
    agg_lane_y: dict[str, dict[str, float]] = {}
    for idx, agg_id in enumerate(agg_ids):
        lane_top = y
        cmd_y = y + 6
        evt_y = cmd_y + max_cmd_h + cmd_ref_extra + CMD_EVT_GAP
        lane_bottom = evt_y + max_evt_h + evt_ref_extra + 6
        agg_lane_y[agg_id] = {
            "cmd": cmd_y, "evt": evt_y,
            "top": lane_top, "bot": lane_bottom,
        }
        y = lane_bottom + 4

    # Divider before GWT
    divider2_y = y
    y += 8

    # GWT label
    gwt_label_y = y
    y += 16

    gwt_y_start = y
    max_gwt_h = 0
    for _ci, _si, sl in columns:
        h = sum(_gwt_card_height(t) + 8 for t in sl.tests)
        max_gwt_h = max(max_gwt_h, h)
    if max_gwt_h == 0:
        max_gwt_h = 20

    total_height = gwt_y_start + max_gwt_h + 20

    # --- Build SVG ---
    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_width} {total_height}" '
        f'width="{total_width}" height="{total_height}" '
        f'style="background: white; font-family: Inter, Helvetica, Arial, sans-serif;">'
    )

    # Arrowhead defs
    arrow_colors = {
        "666", COMMAND_BG.strip("#"), AUTOMATION_COLOR.strip("#"),
        VIEW_BG.strip("#"), EVENT_BG.strip("#"),
    }
    defs = ["<defs>"]
    for c in arrow_colors:
        defs.append(
            f'<marker id="arrowhead-{c}" markerWidth="8" markerHeight="6" '
            f'refX="6" refY="3" orient="auto">'
            f'<polygon points="0 0, 8 3, 0 6" fill="#{c}"/></marker>'
        )
    defs.append("</defs>")
    parts.append("\n".join(defs))

    # Title
    parts.append(
        f'<text x="{total_width / 2}" y="{title_y + 16}" font-size="16" '
        f'font-weight="bold" text-anchor="middle" fill="#333">{_esc(model.name)}</text>'
    )

    # Description subtitle
    if has_desc:
        parts.append(
            f'<text x="{total_width / 2}" y="{desc_y + 12}" font-size="10" '
            f'text-anchor="middle" fill="#777">{_esc(model.description)}</text>'
        )

    # Color legend — horizontal strip of color swatches with labels
    legend_items = [
        (COMMAND_BG, "Command"),
        (EVENT_BG, "Event"),
        (VIEW_BG, "Read Model"),
        (AUTOMATION_COLOR, "Automation"),
        (UI_BG, "Interface"),
    ]
    legend_total_w = len(legend_items) * 120
    lx = (total_width - legend_total_w) / 2
    for fill, label in legend_items:
        text_fill = "#333" if fill in (UI_BG,) else "#fff"
        stroke_attr = f' stroke="{UI_STROKE}" stroke-width="0.5"' if fill == UI_BG else ""
        parts.append(
            f'<rect x="{lx}" y="{legend_y}" width="12" height="12" rx="2" '
            f'fill="{fill}"{stroke_attr}/>'
        )
        parts.append(
            f'<text x="{lx + 16}" y="{legend_y + 7}" font-size="9" fill="#666" '
            f'dominant-baseline="central">{label}</text>'
        )
        lx += 120

    # Chapter headers
    for ci, ch in enumerate(model.chapters):
        sx, ex = chapter_x_ranges[ci]
        w = ex - sx
        parts.append(
            f'<rect x="{sx - 4}" y="{chapter_header_y}" width="{w + 8}" '
            f'height="{HEADER_H}" rx="4" fill="{CHAPTER_BG}"/>'
        )
        parts.append(
            f'<text x="{sx + w / 2}" y="{chapter_header_y + HEADER_H / 2 + 1}" '
            f'font-size="12" font-weight="600" text-anchor="middle" '
            f'dominant-baseline="central" fill="#1A73E8">{_esc(ch.name)}</text>'
        )

    # Slice name labels (column headers between chapter bar and actor lanes)
    if has_slice_names:
        for col_idx, (ci, si, sl) in enumerate(columns):
            if sl.name:
                name_x = col_x[col_idx] + CARD_W / 2
                name_cy = slice_name_y + slice_name_row_h / 2
                parts.append(
                    f'<text x="{name_x}" y="{name_cy}" font-size="9" '
                    f'text-anchor="middle" dominant-baseline="central" '
                    f'fill="#888" font-weight="500">{_esc(sl.name)}</text>'
                )

    # Actor swimlane labels
    for idx, aid in enumerate(all_actor_lanes):
        actor = actor_map[aid]
        ry = ui_row_y[aid]
        lh = max_ui_h + ROW_GAP
        parts.append(
            f'<rect x="0" y="{ry - 4}" width="{total_width}" height="{lh}" '
            f'fill="{AGG_LANE_COLORS[idx % 2]}"/>'
        )
        icon = {"user": "\U0001F464", "admin": "\U0001F6E1", "system": "\u2699", "external": "\U0001F310"}.get(actor.type, "")
        parts.append(
            f'<text x="{LANE_LABEL_W - 8}" y="{ry + max_ui_h / 2}" font-size="11" '
            f'text-anchor="end" dominant-baseline="central" fill="#555">'
            f'{icon} {_esc(actor.name)}</text>'
        )

    # Read model row label — centered in full row height
    parts.append(
        f'<text x="{LANE_LABEL_W - 8}" y="{read_model_row_y + rm_row_h / 2}" font-size="11" '
        f'text-anchor="end" dominant-baseline="central" fill="#888">Read Models</text>'
    )

    # Dividers
    parts.append(
        f'<line x1="0" y1="{divider1_y}" x2="{total_width}" y2="{divider1_y}" '
        f'stroke="{DIVIDER_COLOR}" stroke-width="1"/>'
    )
    parts.append(
        f'<line x1="0" y1="{divider2_y}" x2="{total_width}" y2="{divider2_y}" '
        f'stroke="{DIVIDER_COLOR}" stroke-width="1.5"/>'
    )

    # Aggregate swim lane backgrounds and labels
    for idx, agg_id in enumerate(agg_ids):
        agg = agg_map[agg_id]
        lane = agg_lane_y[agg_id]
        lane_h = lane["bot"] - lane["top"]
        parts.append(
            f'<rect x="0" y="{lane["top"]}" width="{total_width}" height="{lane_h}" '
            f'fill="{AGG_LANE_COLORS[idx % 2]}"/>'
        )
        parts.append(
            f'<text x="{LANE_LABEL_W - 8}" y="{lane["top"] + lane_h / 2}" font-size="12" '
            f'text-anchor="end" dominant-baseline="central" font-weight="600" '
            f'fill="#444">{_esc(agg.name)}</text>'
        )

    # GWT section label — aligned vertically with the first row of test cards
    parts.append(
        f'<text x="{LANE_LABEL_W - 8}" y="{gwt_y_start + 20}" font-size="12" '
        f'text-anchor="end" font-weight="600" fill="#555">Tests</text>'
    )

    # --- Render each slice column ---
    sb = model.source_base
    for col_idx, (ci, si, sl) in enumerate(columns):
        cx = col_x[col_idx]
        agg = agg_lane_y[sl.aggregate]

        # UI card in actor's swimlane
        if sl.ui and sl.actor in ui_row_y:
            ui_refs = _lookup_refs(sl, sl.ui, sb)
            parts.append(
                _element_card(cx, ui_row_y[sl.actor], CARD_W, max_ui_h, sl.ui, UI_BG,
                              text_fill="#333", stroke=UI_STROKE, refs=ui_refs)
            )
            panel = _ref_panel(cx, ui_row_y[sl.actor] + max_ui_h, CARD_W, ui_refs)
            if panel:
                parts.append(panel)

        # External event card in actor's swimlane (orange, like domain events)
        if sl.external_event and sl.actor in ui_row_y:
            ext_refs = _lookup_refs(sl, sl.external_event, sb)
            parts.append(
                _element_card(cx, ui_row_y[sl.actor], CARD_W, max_ui_h,
                              sl.external_event, EVENT_BG, refs=ext_refs)
            )
            panel = _ref_panel(cx, ui_row_y[sl.actor] + max_ui_h, CARD_W, ext_refs)
            if panel:
                parts.append(panel)

        # Automation processor box in actor's swimlane (purple card)
        if sl.automation and sl.actor in ui_row_y:
            uy = ui_row_y[sl.actor]
            # Build label: automation name + "on: TriggerName"
            auto_label = sl.automation
            if _trigger_list(sl):
                trigger_label = ", ".join(_parse_element(t)[0] for t in _trigger_list(sl))
                auto_label += f"\non: {trigger_label}"
            auto_lines = []
            for line in auto_label.split("\n"):
                auto_lines.extend(_camel_wrap(line, max_chars=int(CARD_W / 7)))
            # Purple card
            parts.append(
                f'<rect x="{cx}" y="{uy}" width="{CARD_W}" height="{max_ui_h}" '
                f'rx="6" fill="{AUTOMATION_COLOR}"/>'
            )
            # Gear icon in top-left
            parts.append(_gear_icon(cx + 16, uy + 16, size=8, fill="white"))
            # Text block centered
            parts.append(
                _text_block(cx + CARD_W / 2, uy + max_ui_h / 2 + 2,
                            auto_lines, font_size=9, fill="#fff", font_weight="600")
            )

        # Command card in aggregate lane
        if sl.command:
            cmd_refs = _lookup_refs(sl, sl.command, sb)
            parts.append(
                _element_card(cx, agg["cmd"], CARD_W, max_cmd_h, sl.command, COMMAND_BG,
                              refs=cmd_refs)
            )
            panel = _ref_panel(cx, agg["cmd"] + max_cmd_h, CARD_W, cmd_refs)
            if panel:
                parts.append(panel)

        # Event cards in aggregate lane
        for ei, ev in enumerate(sl.events):
            ev_refs = _lookup_refs(sl, ev, sb)
            ex = cx + ei * 8
            ey = agg["evt"] + ei * 8
            parts.append(
                _element_card(ex, ey, CARD_W, max_evt_h, ev, EVENT_BG, refs=ev_refs)
            )
            panel = _ref_panel(ex, ey + max_evt_h, CARD_W, ev_refs)
            if panel:
                parts.append(panel)

        # Consumed read model cards (reads) — compact name-only with dashed border
        # Shows source chapter label when the RM is produced in a different chapter
        current_chapter_name = model.chapters[ci].name
        consumed_card_count = len(sl.reads)
        consumed_card_h = 38  # height for name + source label
        for ri, consumed_name in enumerate(sl.reads):
            rm_y = read_model_row_y + ri * (consumed_card_h + RM_STACK_GAP)
            rm_w = CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
            name_lines = _camel_wrap(consumed_name, max_chars=int(rm_w / 6.5))
            parts.append(
                f'<rect x="{cx + RM_X_OFFSET}" y="{rm_y}" width="{rm_w}" '
                f'height="{consumed_card_h}" rx="6" fill="{VIEW_BG}" '
                f'stroke="#fff" stroke-width="1.5" stroke-dasharray="4,2"/>'
            )
            # Cross-chapter source label inside the card
            source_ch = rm_source_chapter.get(consumed_name, "")
            has_source = source_ch and source_ch != current_chapter_name
            if has_source:
                parts.append(
                    _text_block(cx + RM_X_OFFSET + rm_w / 2, rm_y + consumed_card_h / 2 - 5,
                                name_lines, font_size=10, fill="#fff", font_weight="600")
                )
                source_label = f"\u2190 {source_ch}"
                parts.append(
                    f'<text x="{cx + RM_X_OFFSET + rm_w / 2}" y="{rm_y + consumed_card_h / 2 + 10}" '
                    f'font-family="Inter, Helvetica, Arial, sans-serif" '
                    f'font-size="6" fill="#fff" text-anchor="middle" '
                    f'dominant-baseline="central" opacity="0.7">{_esc(source_label)}</text>'
                )
            else:
                parts.append(
                    _text_block(cx + RM_X_OFFSET + rm_w / 2, rm_y + consumed_card_h / 2,
                                name_lines, font_size=10, fill="#fff", font_weight="600")
                )
        consumed_bottom_pad = 12 if consumed_card_count else 0  # extra padding after backreferences
        consumed_stack_h = (consumed_card_count * (consumed_card_h + RM_STACK_GAP) + consumed_bottom_pad) if consumed_card_count else 0

        # Produced read model cards — stacked with per-card heights
        rm_w = CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
        produced_y_cursor = read_model_row_y + consumed_stack_h
        for ri, rm in enumerate(sl.read_models):
            rm_h = _card_height(rm, rm_w)
            rm_y = produced_y_cursor
            rm_refs = _lookup_refs(sl, rm, sb)
            parts.append(
                _element_card(cx + RM_X_OFFSET, rm_y, rm_w, rm_h, rm, VIEW_BG,
                              refs=rm_refs)
            )
            panel = _ref_panel(cx + RM_X_OFFSET, rm_y + rm_h, rm_w, rm_refs)
            if panel:
                parts.append(panel)
            produced_y_cursor += rm_h + RM_STACK_GAP

        # --- Arrows ---
        # Down-flow arrows left of RM cards, up-flow arrows right
        x_down = cx + 15  # fixed: always left of RM cards (RM_X_OFFSET=30)
        x_up = cx + CARD_W * 0.65
        actor_y = ui_row_y.get(sl.actor)

        # UI → Command (down from actor row into aggregate lane)
        if sl.ui and sl.command and actor_y is not None:
            parts.append(
                _arrow_down(x_down, actor_y + max_ui_h, agg["cmd"], "#666")
            )

        # External event → Command (dashed down from external event to command)
        if sl.external_event and not sl.automation and sl.command and actor_y is not None:
            parts.append(
                f'<line x1="{x_down}" y1="{actor_y + max_ui_h}" '
                f'x2="{x_down}" y2="{agg["cmd"] - 6}" '
                f'stroke="{EVENT_BG}" stroke-width="1.5" stroke-dasharray="6,3" '
                f'marker-end="url(#arrowhead-{EVENT_BG.strip("#")})"/>'
            )

        # Automation → Command (down from purple box bottom to command)
        if sl.automation and sl.command and actor_y is not None:
            parts.append(
                _arrow_down(cx + CARD_W / 2, actor_y + max_ui_h, agg["cmd"], AUTOMATION_COLOR)
            )

        # Command → Event (down within aggregate lane, centered in column)
        if sl.command and sl.events:
            cmd_evt_x = cx + CARD_W / 2 if sl.automation else x_down
            parts.append(
                _arrow_down(cmd_evt_x, agg["cmd"] + max_cmd_h, agg["evt"], "#666")
            )

        # Consumed Read Model → Command (dashed green arrow straight down)
        consumed_card_h_arrow = 38  # must match consumed_card_h above
        if sl.reads and sl.command:
            rm_w = CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
            n_reads = len(sl.reads)
            for ri in range(n_reads):
                # Spread multiple reads arrows horizontally so they don't stack
                route_x_reads = cx + RM_X_OFFSET + rm_w / 2 + (ri - (n_reads - 1) / 2) * ARROW_SPREAD
                rm_bot_y = read_model_row_y + ri * (consumed_card_h_arrow + RM_STACK_GAP) + consumed_card_h_arrow
                parts.append(
                    f'<line x1="{route_x_reads}" y1="{rm_bot_y}" '
                    f'x2="{route_x_reads}" y2="{agg["cmd"] - 6}" '
                    f'stroke="{VIEW_BG}" stroke-width="1.5" stroke-dasharray="4,3" '
                    f'marker-end="url(#arrowhead-{VIEW_BG.strip("#")})"/>'
                )

        # Event → Read Model (trunk from event card right edge, branches LEFT into RMs)
        consumed_stack_h_arrow = (len(sl.reads) * (38 + RM_STACK_GAP) + CONSUMED_BOTTOM_PAD) if sl.reads else 0
        if sl.events and sl.read_models:
            route_x = cx + CARD_W  # right edge of event card
            evt_mid_y = agg["evt"] + max_evt_h / 2
            first_rm_h = _card_height(sl.read_models[0], rm_w)
            first_produced_y = read_model_row_y + consumed_stack_h_arrow + first_rm_h / 2
            # Trunk: event right side → up to top produced RM height
            parts.append(
                f'<path d="M {route_x} {evt_mid_y} '
                f'L {route_x} {first_produced_y}" '
                f'fill="none" stroke="{VIEW_BG}" stroke-width="1.5" '
                f'stroke-dasharray="4,3"/>'
            )
            # Branch arrow to each produced read model (points LEFT into card)
            rm_right_edge = cx + RM_X_OFFSET + CARD_W - RM_X_OFFSET - RM_RIGHT_PAD
            branch_y_cursor = read_model_row_y + consumed_stack_h_arrow
            for ri, rm_label in enumerate(sl.read_models):
                rm_h = _card_height(rm_label, rm_w)
                rm_mid_y = branch_y_cursor + rm_h / 2
                parts.append(
                    f'<path d="M {route_x} {rm_mid_y} L {rm_right_edge} {rm_mid_y}" '
                    f'fill="none" stroke="{VIEW_BG}" stroke-width="1.5" '
                    f'stroke-dasharray="4,3" marker-end="url(#arrowhead-{VIEW_BG.strip("#")})"/>'
                )
                branch_y_cursor += rm_h + RM_STACK_GAP

        # Read Model → UI (view-only slices: no command/events, just read model feeding UI)
        has_entry = sl.ui or sl.external_event
        if has_entry and sl.read_models and not sl.command and not sl.events and actor_y is not None:
            rm_arrow_x = cx + RM_X_OFFSET + (CARD_W - RM_X_OFFSET - RM_RIGHT_PAD) / 2
            parts.append(
                _arrow_up(rm_arrow_x, read_model_row_y,
                          actor_y + max_ui_h, VIEW_BG, dashed=True)
            )

    # --- Vertical slice outlines (debug: green dashed boxes) ---
    first_actor_y = min(ui_row_y.values()) if ui_row_y else 0
    slice_box_bottom = gwt_y_start + max_gwt_h
    for col_idx, (_ci, _si, sl) in enumerate(columns):
        cx = col_x[col_idx]
        box_top = first_actor_y
        box_h = slice_box_bottom - box_top
        parts.append(
            f'<rect x="{cx - 4}" y="{box_top - 4}" width="{CARD_W + 8}" '
            f'height="{box_h + 8}" rx="8" fill="none" '
            f'stroke="#4CAF50" stroke-width="1.5" stroke-dasharray="8,4" opacity="0.6"/>'
        )

    # --- Horizontal arrows: event → downstream slices (all-pairs within chapter) ---
    # Pre-pass: count arrows per source (departures) and destination (arrivals)
    dst_arrow_count: dict[int, int] = {}  # dst_col → count of arrows arriving
    src_arrow_count: dict[int, int] = {}  # src_col → count of arrows departing

    col_offset = 0
    for ci, ch in enumerate(model.chapters):
        for si, src_sl in enumerate(ch.slices):
            src_col = col_offset + si
            if not src_sl.events:
                continue
            src_event_names = {_parse_element(ev)[0] for ev in src_sl.events}
            for sj in range(si + 1, len(ch.slices)):
                dst_sl = ch.slices[sj]
                dst_col = col_offset + sj
                if not _trigger_list(dst_sl):
                    continue
                if _trigger_names(dst_sl) & src_event_names:
                    dst_arrow_count[dst_col] = dst_arrow_count.get(dst_col, 0) + 1
                    src_arrow_count[src_col] = src_arrow_count.get(src_col, 0) + 1
        col_offset += len(ch.slices)

    # Track indices during drawing
    dst_arrow_idx: dict[int, int] = {}
    src_arrow_idx: dict[int, int] = {}

    col_offset = 0
    for ci, ch in enumerate(model.chapters):
        for si, src_sl in enumerate(ch.slices):
            src_col = col_offset + si
            # Source must produce events (State Change, Automation, External)
            if not src_sl.events:
                continue
            src_event_names = {_parse_element(ev)[0] for ev in src_sl.events}
            src_agg = agg_lane_y[src_sl.aggregate]
            src_evt_y = src_agg["evt"] + max_evt_h / 2

            for sj in range(si + 1, len(ch.slices)):
                dst_sl = ch.slices[sj]
                dst_col = col_offset + sj
                if not _trigger_list(dst_sl):
                    continue
                dst_trigger_names = _trigger_names(dst_sl)
                if not (dst_trigger_names & src_event_names):
                    continue

                # Compute arrival offset to spread overlapping arrows at destination
                arr_idx = dst_arrow_idx.get(dst_col, 0)
                dst_arrow_idx[dst_col] = arr_idx + 1
                total_dst = dst_arrow_count.get(dst_col, 1)
                y_offset_dst = (arr_idx - (total_dst - 1) / 2) * ARROW_SPREAD

                # Compute departure offset to spread overlapping arrows at source
                dep_idx = src_arrow_idx.get(src_col, 0)
                src_arrow_idx[src_col] = dep_idx + 1
                total_src = src_arrow_count.get(src_col, 1)
                y_offset_src = (dep_idx - (total_src - 1) / 2) * ARROW_SPREAD

                # Route vertical segment in the gap right after the source column.
                # Using midpoint of full span causes arrows to cross intermediate cards.
                gap_x = col_x[src_col] + CARD_W + COL_GAP * 0.3 + dep_idx * 6

                if dst_sl.automation:
                    # Automation arrow (purple): event → purple processor box
                    box_mid_y = ui_row_y.get(dst_sl.actor, 0) + max_ui_h / 2 + y_offset_dst
                    depart_y = src_evt_y + y_offset_src
                    parts.append(
                        f'<path d="M {col_x[src_col] + CARD_W} {depart_y} '
                        f'L {gap_x} {depart_y} '
                        f'L {gap_x} {box_mid_y} '
                        f'L {col_x[dst_col] - 6} {box_mid_y}" '
                        f'fill="none" stroke="{AUTOMATION_COLOR}" stroke-width="1.5" '
                        f'stroke-dasharray="6,3" '
                        f'marker-end="url(#arrowhead-{AUTOMATION_COLOR.strip("#")})"/>'
                    )
                elif _is_state_view(dst_sl):
                    # State View arrow (green dashed): event → first read model
                    depart_y = src_evt_y + y_offset_src
                    first_dst_rm_h = _card_height(dst_sl.read_models[0], rm_w_layout) if dst_sl.read_models else CARD_H
                    dst_rm_y = read_model_row_y + first_dst_rm_h / 2 + y_offset_dst
                    parts.append(
                        f'<path d="M {col_x[src_col] + CARD_W} {depart_y} '
                        f'L {gap_x} {depart_y} '
                        f'L {gap_x} {dst_rm_y} '
                        f'L {col_x[dst_col] + RM_X_OFFSET + (CARD_W - RM_X_OFFSET - RM_RIGHT_PAD)} {dst_rm_y}" '
                        f'fill="none" stroke="{VIEW_BG}" stroke-width="1.5" '
                        f'stroke-dasharray="6,3" '
                        f'marker-end="url(#arrowhead-{VIEW_BG.strip("#")})"/>'
                    )
        col_offset += len(ch.slices)

    # --- GWT section ---
    for col_idx, (_ci, _si, sl) in enumerate(columns):
        if not sl.tests:
            continue
        cx = col_x[col_idx]
        card_w = CARD_W
        ty_cursor = gwt_y_start

        for test in sl.tests:
            card_h = _gwt_card_height(test)
            tx = cx
            ty = ty_cursor

            # Card outline
            parts.append(
                f'<rect x="{tx}" y="{ty}" width="{card_w}" height="{card_h}" '
                f'rx="5" fill="white" stroke="{DIVIDER_COLOR}" stroke-width="1"/>'
            )

            # Header bar — wraps long test names
            header_h = _gwt_header_h(test)
            parts.append(
                f'<rect x="{tx}" y="{ty}" width="{card_w}" height="{header_h}" '
                f'rx="5" fill="#424242"/>'
            )
            parts.append(
                f'<rect x="{tx}" y="{ty + header_h - 10}" width="{card_w}" '
                f'height="10" fill="#424242"/>'
            )
            name_lines = _gwt_name_wrap(test.name)
            name_block_h = len(name_lines) * GWT_NAME_LINE_H
            name_start_y = ty + (header_h - name_block_h) / 2 + GWT_NAME_LINE_H / 2
            for ni, nline in enumerate(name_lines):
                parts.append(
                    f'<text x="{tx + card_w / 2}" y="{name_start_y + ni * GWT_NAME_LINE_H}" '
                    f'font-size="8" font-weight="600" text-anchor="middle" '
                    f'dominant-baseline="central" fill="white">{_esc(nline)}</text>'
                )

            rc = ty + header_h + 4

            # GIVEN
            parts.append(
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{EVENT_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="#fff">GIVEN</text>'
            )
            rc += 14 + GWT_SECTION_PAD
            for g in test.given:
                for line in _gwt_wrap(g):
                    parts.append(
                        f'<text x="{tx + 6}" y="{rc + 2}" font-size="7" '
                        f'dominant-baseline="central" fill="#444">{_esc(line)}</text>'
                    )
                    rc += GWT_LINE_H
            rc += 6

            # WHEN
            parts.append(
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{COMMAND_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="#fff">WHEN</text>'
            )
            rc += 14 + GWT_SECTION_PAD
            for line in _gwt_wrap(test.when):
                parts.append(
                    f'<text x="{tx + 6}" y="{rc + 2}" font-size="7" '
                    f'dominant-baseline="central" fill="#444">{_esc(line)}</text>'
                )
                rc += GWT_LINE_H
            rc += 6

            # THEN
            parts.append(
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{VIEW_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="#fff">THEN</text>'
            )
            rc += 14 + GWT_SECTION_PAD
            for t in test.then:
                for line in _gwt_wrap(t):
                    parts.append(
                        f'<text x="{tx + 6}" y="{rc + 2}" font-size="7" '
                        f'dominant-baseline="central" fill="#444">{_esc(line)}</text>'
                    )
                    rc += GWT_LINE_H

            ty_cursor += card_h + 8

    parts.append("</svg>")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_validate(args):
    path = Path(args.model)
    data = json.loads(path.read_text())
    model = EventModel.model_validate(data)
    total_slices = sum(len(ch.slices) for ch in model.chapters)
    total_tests = sum(len(sl.tests) for ch in model.chapters for sl in ch.slices)
    print(
        f"Valid. {len(model.actors)} actors, {len(model.aggregates)} aggregates, "
        f"{len(model.chapters)} chapters, {total_slices} slices, {total_tests} tests."
    )
    for w in getattr(model, "_warnings", []):
        print(f"  warning: {w}")


def cmd_render(args):
    path = Path(args.model)
    data = json.loads(path.read_text())
    model = EventModel.model_validate(data)
    svg = render_svg(model)
    out = Path(args.output) if args.output else path.with_suffix(".svg")
    out.write_text(svg)
    print(f"Wrote {out} ({len(svg)} bytes)")


def cmd_schema(args):
    print(json.dumps(EventModel.model_json_schema(), indent=2))


def cmd_init(args):
    path = Path(args.model)
    if path.exists():
        print(f"Error: {path} already exists", file=sys.stderr)
        sys.exit(1)
    template = EventModel(
        name="My System",
        description="Event model for ...",
        actors=[
            Actor(id="user", name="User", type="user"),
            Actor(id="system", name="System", type="system"),
        ],
        aggregates=[
            Aggregate(id="thing", name="Thing"),
        ],
        chapters=[
            Chapter(
                name="Example Chapter",
                slices=[
                    Slice(
                        name="Do Something",
                        actor="user",
                        aggregate="thing",
                        ui="Dashboard",
                        command="DoSomething(entityId, action)",
                        events=["SomethingHappened(entityId, action)"],
                        read_models=["SomethingView(entityId, action)"],
                        tests=[
                            GivenWhenThen(
                                name="Happy path",
                                given=["SomethingView(entityId=e-1, action=pending)"],
                                when="DoSomething(entityId=e-1, action=approve)",
                                then=["SomethingHappened(entityId=e-1, action=approve)"],
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )
    path.write_text(json.dumps(template.model_dump(), indent=2) + "\n")
    print(f"Created {path}")


def main():
    parser = argparse.ArgumentParser(description="Event Model tool")
    sub = parser.add_subparsers(dest="command")

    p_val = sub.add_parser("validate", help="Validate a model JSON file")
    p_val.add_argument("model")

    p_render = sub.add_parser("render", help="Render model to SVG")
    p_render.add_argument("model")
    p_render.add_argument("-o", "--output", help="Output SVG path")

    sub.add_parser("schema", help="Print JSON schema")

    p_init = sub.add_parser("init", help="Create a template model JSON")
    p_init.add_argument("model")

    args = parser.parse_args()
    if args.command == "validate":
        cmd_validate(args)
    elif args.command == "render":
        cmd_render(args)
    elif args.command == "schema":
        cmd_schema(args)
    elif args.command == "init":
        cmd_init(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
