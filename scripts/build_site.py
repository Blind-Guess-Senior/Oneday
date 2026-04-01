#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

All review metadata is read exclusively from YAML frontmatter.
A file is included only when:

  1. It has a valid YAML frontmatter block (``---`` … ``---``).
  2. Its body contains the completion marker ``---fin.---``.
  3. The frontmatter has a non-empty ``reviewer`` field.

Output
======
site_data.json  (written to the repository root, listed in .gitignore)

Schema of each item in ``reviews``:

  path          str            repo-relative path, e.g. "Author/…/file.md"
  title         str            from YAML ``title``; falls back to filename stem
  reviewer      str            from YAML ``reviewer`` (required)
  score         int|None       numeric score, or None
  score_raw     str            score as it appears in the UI (string form of the YAML value)
  score_system  str            "stars" | "decimal" | "" — from YAML or auto-detected
  category      list[str]      e.g. ["游戏"]
  status        str            e.g. "已完成" / "进行中" / "未完成"
  tags          list[str]
  date          str|None       from YAML ``date``, or assembled from ``year``/``month``
  modified      str            file mtime ISO string (used for "recent" sorting)
  extra         dict           all non-standard YAML keys
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path

import yaml  # PyYAML — already available in this environment

# ---------------------------------------------------------------------------
# Repository root
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

@dataclass
class Review:
    """Canonical representation of a single review entry."""

    # ── mandatory ──────────────────────────────────────────────────────────
    path: str           # repo-relative path (forward slashes)
    title: str          # display title
    reviewer: str       # from YAML ``reviewer``

    # ── scoring ────────────────────────────────────────────────────────────
    score: int | None = None        # normalised numeric score
    score_raw: str = ""             # score as it appears in the UI
    score_system: str = ""          # "stars" | "decimal"

    # ── classification ─────────────────────────────────────────────────────
    category: list[str] = field(default_factory=list)
    status: str = ""
    tags: list[str] = field(default_factory=list)

    # ── dates ──────────────────────────────────────────────────────────────
    date: str | None = None         # review date (YYYY-MM-DD / YYYY-MM / YYYY)
    modified: str = ""              # file mtime ISO string

    # ── catch-all for non-standard YAML keys ──────────────────────────────
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

# YAML keys consumed by the standard Review fields.
# Any other key is forwarded to ``extra``.
_STANDARD_KEYS: frozenset[str] = frozenset({
    "title", "reviewer",
    "score", "score_system",
    "category", "status", "tags",
    "date", "year", "month",
})


def parse_yaml_frontmatter(content: str) -> tuple[dict, str]:
    """Return ``(metadata_dict, body_string)`` from a YAML-fenced markdown file.

    If no valid frontmatter is found, returns ``({}, content)``.
    """
    if not content.startswith("---"):
        return {}, content
    end = content.find("\n---", 3)
    if end == -1:
        return {}, content
    try:
        meta = yaml.safe_load(content[3:end]) or {}
    except Exception:
        meta = {}
    return meta, content[end + 4:].lstrip("\n")


def coerce_int(val) -> int | None:
    """Safely coerce *val* to ``int``, returning ``None`` on failure."""
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def to_str_list(val) -> list[str]:
    """Coerce *val* to a non-None list of non-empty strings."""
    if val is None:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v is not None and str(v).strip()]
    s = str(val).strip()
    return [s] if s else []


def mtime_iso(filepath: Path) -> str:
    return datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()


# ---------------------------------------------------------------------------
# Universal extractor
# ---------------------------------------------------------------------------

def extract_review(filepath: Path, rel_path: str) -> Review | None:
    """Parse *filepath* and return a :class:`Review`, or ``None`` to skip.

    All metadata is read from YAML frontmatter.  A file is skipped when:
    * it has no valid YAML frontmatter,
    * its body does not contain ``---fin.---``, or
    * the frontmatter has no ``reviewer`` field.
    """
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception:
        return None

    meta, body = parse_yaml_frontmatter(content)
    if not meta:
        return None  # no YAML frontmatter → not a review

    if "---fin.---" not in body:
        return None

    reviewer = str(meta.get("reviewer") or "").strip()
    if not reviewer:
        return None

    # Title: explicit YAML field, or filename stem (stars stripped)
    title = str(meta.get("title") or "").strip() or re.sub(r"★.*$", "", filepath.stem).strip()

    # Score: keep the raw YAML value as-is for the UI
    score_val = meta.get("score")
    score_raw = str(score_val) if score_val is not None else ""
    score = coerce_int(score_val)

    # Score system: from YAML, or auto-detected
    score_system = str(meta.get("score_system") or "").strip()
    if not score_system:
        if isinstance(score_val, str) and "★" in score_val:
            score_system = "stars"
        elif score is not None:
            score_system = "decimal"
    # When using stars, derive the numeric count from the raw value
    if score_system == "stars" and score is None and isinstance(score_val, str):
        score = score_val.count("★") or None

    # Date: explicit ISO ``date`` field, or assembled from ``year``/``month``
    date_val = str(meta.get("date") or "").strip() or None
    if not date_val:
        year = coerce_int(meta.get("year"))
        month = coerce_int(meta.get("month"))
        if year:
            date_val = f"{year}-{month:02d}" if month and 1 <= month <= 12 else str(year)

    def _nonempty(v) -> bool:
        if v is None:
            return False
        if isinstance(v, (list, dict)):
            return len(v) > 0
        return str(v).strip() != ""

    extra = {k: v for k, v in meta.items() if k not in _STANDARD_KEYS and _nonempty(v)}

    return Review(
        path=rel_path,
        title=title,
        reviewer=reviewer,
        score=score,
        score_raw=score_raw,
        score_system=score_system,
        category=to_str_list(meta.get("category")),
        status=str(meta.get("status") or "").strip(),
        tags=to_str_list(meta.get("tags")),
        date=date_val,
        modified=mtime_iso(filepath),
        extra=extra,
    )


# ---------------------------------------------------------------------------
# Global filter: which files are candidates for extraction
# ---------------------------------------------------------------------------

# File/folder names that indicate non-review content
_NON_REVIEW_NAMES: tuple[str, ...] = (
    "标准", "说明书", "Template", "Award",
    "ToWatch", "ToRead", "Recent", "README", "Readme",
)


def is_content_file(filepath: Path, rel_path: str) -> bool:
    """Return ``True`` if the file is a candidate review (not a template, standard, etc.)."""
    if "/Templates/" in rel_path:
        return False
    if filepath.name.startswith("_"):
        return False
    if any(token in filepath.name for token in _NON_REVIEW_NAMES):
        return False
    return True


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def scan() -> list[dict]:
    """Walk the entire repository tree, extract metadata, return list of dicts."""
    seen: set[str] = set()
    results: list[dict] = []
    errors: list[str] = []

    for filepath in sorted(ROOT.rglob("*.md")):
        rel_path = filepath.relative_to(ROOT).as_posix()

        if not is_content_file(filepath, rel_path):
            continue
        if rel_path in seen:
            continue
        seen.add(rel_path)

        try:
            review = extract_review(filepath, rel_path)
        except Exception as exc:
            errors.append(f"{rel_path}: {exc}")
            continue

        if review is not None:
            results.append(review.to_dict())

    if errors:
        print(f"  [warn] {len(errors)} extraction error(s):")
        for e in errors[:10]:
            print(f"         {e}")

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Building site_data.json…")

    reviews = scan()

    # Sort: most recently modified first (front-end "recent updates" view)
    reviews.sort(key=lambda r: r.get("modified", ""), reverse=True)

    # Aggregate vocabulary for filter dropdowns
    all_tags       = sorted({t for r in reviews for t in (r.get("tags") or [])})
    all_categories = sorted({c for r in reviews for c in (r.get("category") or [])})
    reviewers      = sorted({r["reviewer"] for r in reviews})

    site_data = {
        "reviews": reviews,
        "meta": {
            "total":      len(reviews),
            "generated":  datetime.now().isoformat(),
            "categories": all_categories,
            "reviewers":  reviewers,
            "all_tags":   all_tags,
        },
    }

    out = ROOT / "site_data.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(site_data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✓ Written {out}")
    print(f"  Reviews    : {len(reviews)}")
    print(f"  Reviewers  : {reviewers}")
    print(f"  Categories : {all_categories}")
    print(f"  Tags       : {len(all_tags)} unique")


if __name__ == "__main__":
    main()
