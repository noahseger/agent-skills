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
    when: str
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
    trigger: str | None = None  # event or read model that drives the automation
    command: str | None = None
    events: list[str] = Field(default_factory=list)
    read_models: list[str] = Field(default_factory=list)
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
                if sl.automation and not sl.trigger:
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
                # Projection check: read model must share at least one field with events.
                # Additive events (ItemAdded) carry all fields; destructive events
                # (ItemRemoved, CartCleared) carry only identifying fields — both are valid.
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

        if errors:
            raise ValueError(
                "Event model validation errors:\n" + "\n".join(f"  - {e}" for e in errors)
            )
        return self


# ---------------------------------------------------------------------------
# Invariant helpers
# ---------------------------------------------------------------------------

def _parse_element(text: str) -> tuple[str, str | None]:
    """Split 'Name(field1, field2)' into ('Name', 'field1, field2')."""
    if "(" in text and text.endswith(")"):
        idx = text.index("(")
        return text[:idx].strip(), text[idx + 1 : -1].strip()
    return text, None


_PAST_TENSE_SUFFIXES = ("ed", "en", "wn", "zed")

# Irregular past tenses that don't end in standard suffixes above.
# Broad suffix matching on "ot"/"nt" produces too many false positives
# on common nouns (Post, Connect, Grant, Sprint, Event, Point, etc.).
_IRREGULAR_PAST_WORDS = frozenset({
    "got", "forgot", "begot", "shot",           # -ot irregulars
    "sent", "went", "spent", "burnt", "meant",  # -nt irregulars
    "bent", "lent", "rent",
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
    """Extract field names from 'Name(field1, field2)' schema notation."""
    _, fields_str = _parse_element(text)
    if not fields_str:
        return set()
    fields = set()
    for part in fields_str.split(","):
        field = part.strip().split("=")[0].strip()
        if field:
            fields.add(field)
    return fields


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
    name_lines = _camel_wrap(name, max_chars=int(w / 6.5))
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

COMMAND_BG = "#4285F4"
EVENT_BG = "#FF9800"
VIEW_BG = "#0F9D58"
UI_BG = "#F5F5F5"
UI_STROKE = "#BDBDBD"
AUTOMATION_COLOR = "#9C27B0"
CHAPTER_BG = "#E8F0FE"
GWT_GIVEN_BG = "#FFF3E0"
GWT_WHEN_BG = "#E3F2FD"
GWT_THEN_BG = "#E8F5E9"
AGG_LANE_COLORS = ["#FAFAFA", "#F5F5F5"]
DIVIDER_COLOR = "#E0E0E0"

CARD_W = 160
CARD_H = 56
COL_GAP = 28
ROW_GAP = 14
CMD_EVT_GAP = 32  # vertical gap between command and event rows in aggregate lanes
CHAPTER_PAD = 36
LANE_LABEL_W = 110
HEADER_H = 36
RM_X_OFFSET = 65  # horizontal offset for read model cards to clear down-flow arrows
RM_STACK_GAP = 8  # vertical gap between stacked read model cards in the same slice
GWT_LINE_H = 11
GWT_MAX_CHARS = 36  # chars per line at 7px font within CARD_W
GWT_NAME_MAX_CHARS = 28  # chars per line for test name in header bar
GWT_NAME_LINE_H = 10  # line height for wrapped test names
GWT_SECTION_PAD = 6  # padding below GWT section headers before content
REF_LINE_H = 10  # height per annotation line in ref panel
REF_PAD = 4  # padding above annotation panel


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

    # --- Y layout: Title → Chapters → Actor lanes → ReadModels → Aggregate lanes → GWT ---
    y = 12.0
    title_y = y
    y += 32

    chapter_header_y = y
    y += HEADER_H + 8

    # Slice name row — only present when at least one slice has a name
    has_slice_names = any(sl.name for _, _, sl in columns)
    slice_name_row_h = 16 if has_slice_names else 0
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
        y += CARD_H + ui_ref_extra + ROW_GAP

    # Read model row (above aggregates, feeds UIs) — height grows for stacked cards
    max_rm_per_slice = max((len(sl.read_models) for _, _, sl in columns), default=0)
    rm_stack_count = max(1, max_rm_per_slice)
    rm_row_h = rm_stack_count * CARD_H + max(0, rm_stack_count - 1) * RM_STACK_GAP + rm_ref_extra
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
        evt_y = cmd_y + CARD_H + cmd_ref_extra + CMD_EVT_GAP
        lane_bottom = evt_y + CARD_H + evt_ref_extra + 6
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
        f'<text x="{total_width / 2}" y="{title_y + 18}" font-size="16" '
        f'font-weight="bold" text-anchor="middle" fill="#333">{_esc(model.name)}</text>'
    )

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
        lh = CARD_H + ROW_GAP
        parts.append(
            f'<rect x="0" y="{ry - 4}" width="{total_width}" height="{lh}" '
            f'fill="{AGG_LANE_COLORS[idx % 2]}"/>'
        )
        icon = {"user": "\U0001F464", "admin": "\U0001F6E1", "system": "\u2699", "external": "\U0001F310"}.get(actor.type, "")
        parts.append(
            f'<text x="{LANE_LABEL_W - 8}" y="{ry + CARD_H / 2}" font-size="11" '
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
                _element_card(cx, ui_row_y[sl.actor], CARD_W, CARD_H, sl.ui, UI_BG,
                              text_fill="#333", stroke=UI_STROKE, refs=ui_refs)
            )
            panel = _ref_panel(cx, ui_row_y[sl.actor] + CARD_H, CARD_W, ui_refs)
            if panel:
                parts.append(panel)

        # External event card in actor's swimlane (orange, like domain events)
        if sl.external_event and sl.actor in ui_row_y:
            ext_refs = _lookup_refs(sl, sl.external_event, sb)
            parts.append(
                _element_card(cx, ui_row_y[sl.actor], CARD_W, CARD_H,
                              sl.external_event, EVENT_BG, refs=ext_refs)
            )
            panel = _ref_panel(cx, ui_row_y[sl.actor] + CARD_H, CARD_W, ext_refs)
            if panel:
                parts.append(panel)

        # Automation gear in actor's swimlane
        if sl.automation and sl.actor in ui_row_y:
            uy = ui_row_y[sl.actor]
            gcx = cx + CARD_W / 2
            gcy = uy + CARD_H / 2
            parts.append(_gear_icon(gcx, gcy - 12, size=10, fill=AUTOMATION_COLOR))
            auto_lines = _wrap(sl.automation, max_chars=20)
            parts.append(
                _text_block(gcx, gcy + 8, auto_lines, font_size=9, fill=AUTOMATION_COLOR)
            )
            if sl.trigger:
                trigger_name = _parse_element(sl.trigger)[0]
                parts.append(
                    f'<text x="{gcx}" y="{gcy + 22}" font-family="Inter, Helvetica, Arial, sans-serif" '
                    f'font-size="7" fill="{AUTOMATION_COLOR}" text-anchor="middle" '
                    f'dominant-baseline="central" opacity="0.7">on: {_esc(trigger_name)}</text>'
                )

        # Command card in aggregate lane
        if sl.command:
            cmd_refs = _lookup_refs(sl, sl.command, sb)
            parts.append(
                _element_card(cx, agg["cmd"], CARD_W, CARD_H, sl.command, COMMAND_BG,
                              refs=cmd_refs)
            )
            panel = _ref_panel(cx, agg["cmd"] + CARD_H, CARD_W, cmd_refs)
            if panel:
                parts.append(panel)

        # Event cards in aggregate lane
        for ei, ev in enumerate(sl.events):
            ev_refs = _lookup_refs(sl, ev, sb)
            ex = cx + ei * 8
            ey = agg["evt"] + ei * 8
            parts.append(
                _element_card(ex, ey, CARD_W, CARD_H, ev, EVENT_BG, refs=ev_refs)
            )
            panel = _ref_panel(ex, ey + CARD_H, CARD_W, ev_refs)
            if panel:
                parts.append(panel)

        # Read model cards — stacked vertically within the read model row
        for ri, rm in enumerate(sl.read_models):
            rm_y = read_model_row_y + ri * (CARD_H + RM_STACK_GAP)
            rm_refs = _lookup_refs(sl, rm, sb)
            rm_w = CARD_W - RM_X_OFFSET
            parts.append(
                _element_card(cx + RM_X_OFFSET, rm_y, rm_w, CARD_H, rm, VIEW_BG,
                              refs=rm_refs)
            )
            panel = _ref_panel(cx + RM_X_OFFSET, rm_y + CARD_H, rm_w, rm_refs)
            if panel:
                parts.append(panel)

        # --- Arrows ---
        # Down-flow arrows offset left, up-flow arrows offset right
        x_down = cx + CARD_W * 0.35
        x_up = cx + CARD_W * 0.65
        actor_y = ui_row_y.get(sl.actor)

        # UI → Command (down from actor row into aggregate lane)
        if sl.ui and sl.command and actor_y is not None:
            parts.append(
                _arrow_down(x_down, actor_y + CARD_H, agg["cmd"], "#666")
            )

        # External event → Command (dashed down from external event to command)
        if sl.external_event and not sl.automation and sl.command and actor_y is not None:
            parts.append(
                f'<line x1="{x_down}" y1="{actor_y + CARD_H}" '
                f'x2="{x_down}" y2="{agg["cmd"] - 6}" '
                f'stroke="{EVENT_BG}" stroke-width="1.5" stroke-dasharray="6,3" '
                f'marker-end="url(#arrowhead-{EVENT_BG.strip("#")})"/>'
            )

        # Automation → Command (down from gear to command in aggregate lane)
        if sl.automation and sl.command and actor_y is not None:
            parts.append(
                _arrow_down(x_down, actor_y + CARD_H, agg["cmd"], AUTOMATION_COLOR)
            )

        # Command → Event (down within aggregate lane)
        if sl.command and sl.events:
            parts.append(
                _arrow_down(x_down, agg["cmd"] + CARD_H, agg["evt"], "#666")
            )

        # Event → Read Model (trunk right of command card, branches to each RM)
        if sl.events and sl.read_models:
            route_x = cx + CARD_W + 10
            evt_mid_y = agg["evt"] + CARD_H / 2
            top_rm_y = read_model_row_y + CARD_H / 2
            # Trunk: event right edge → route_x → up to top RM height
            parts.append(
                f'<path d="M {cx + CARD_W} {evt_mid_y} '
                f'L {route_x} {evt_mid_y} '
                f'L {route_x} {top_rm_y}" '
                f'fill="none" stroke="{VIEW_BG}" stroke-width="1.5" '
                f'stroke-dasharray="4,3"/>'
            )
            # Branch arrow to each read model
            for ri in range(len(sl.read_models)):
                rm_mid_y = read_model_row_y + ri * (CARD_H + RM_STACK_GAP) + CARD_H / 2
                parts.append(
                    f'<path d="M {route_x} {rm_mid_y} L {cx + CARD_W} {rm_mid_y}" '
                    f'fill="none" stroke="{VIEW_BG}" stroke-width="1.5" '
                    f'stroke-dasharray="4,3" marker-end="url(#arrowhead-{VIEW_BG.strip("#")})"/>'
                )

        # Read Model → UI (view-only slices: no command/events, just read model feeding UI)
        has_entry = sl.ui or sl.external_event
        if has_entry and sl.read_models and not sl.command and not sl.events and actor_y is not None:
            rm_arrow_x = cx + RM_X_OFFSET + (CARD_W - RM_X_OFFSET) / 2
            parts.append(
                _arrow_up(rm_arrow_x, read_model_row_y,
                          actor_y + CARD_H, VIEW_BG, dashed=True)
            )

    # --- Horizontal arrows: event → automation/command in next slice ---
    col_offset = 0
    for ci, ch in enumerate(model.chapters):
        for si in range(len(ch.slices) - 1):
            cur = ch.slices[si]
            nxt = ch.slices[si + 1]
            cur_col = col_offset + si
            nxt_col = col_offset + si + 1

            # Only draw horizontal arrows for event → automation (explicit trigger).
            # Non-automation slices are independently initiated by their actor.
            if cur.events and nxt.automation:
                cur_agg = agg_lane_y[cur.aggregate]
                evt_y = cur_agg["evt"] + CARD_H / 2
                gear_cx = col_x[nxt_col] + CARD_W / 2
                gear_cy = ui_row_y.get(nxt.actor, 0) + CARD_H / 2 - 12  # gear icon center
                mid_x = (col_x[cur_col] + CARD_W + col_x[nxt_col]) / 2
                parts.append(
                    f'<path d="M {col_x[cur_col] + CARD_W} {evt_y} '
                    f'L {mid_x} {evt_y} '
                    f'L {mid_x} {gear_cy} '
                    f'L {gear_cx - 16} {gear_cy}" '
                    f'fill="none" stroke="{AUTOMATION_COLOR}" stroke-width="1.5" '
                    f'stroke-dasharray="6,3" '
                    f'marker-end="url(#arrowhead-{AUTOMATION_COLOR.strip("#")})"/>'
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
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{GWT_GIVEN_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="{EVENT_BG}">GIVEN</text>'
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
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{GWT_WHEN_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="{COMMAND_BG}">WHEN</text>'
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
                f'<rect x="{tx + 3}" y="{rc}" width="{card_w - 6}" height="14" rx="2" fill="{GWT_THEN_BG}"/>'
            )
            parts.append(
                f'<text x="{tx + card_w / 2}" y="{rc + 7}" font-size="7" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central" fill="{VIEW_BG}">THEN</text>'
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
                        command="DoSomething(entityId)",
                        events=["SomethingHappened(entityId, result)"],
                        read_models=["SomethingView(entityId, status)"],
                        tests=[
                            GivenWhenThen(
                                name="Happy path",
                                given=["SomethingView(entityId=e-1, status=pending)"],
                                when="DoSomething(entityId=e-1)",
                                then=["SomethingHappened(entityId=e-1, result=ok)"],
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
