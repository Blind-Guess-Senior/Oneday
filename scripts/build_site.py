#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

All review metadata is read exclusively from YAML frontmatter and passed
through verbatim.  A file is included only when:

  1. It has a valid YAML frontmatter block (``---`` … ``---``).
  2. Its body contains the completion marker ``---fin.---``.
  3. The frontmatter has a non-empty ``reviewer`` field.

Two YAML keys receive special normalisation:

  score   → also emitted as ``score_raw`` (original string) and ``score``
            (coerced to int, or None).
  tags    → normalised to a list[str] regardless of how YAML encodes it.

All other YAML keys are written to the output dict exactly as-is.
Two extra keys are always injected (never in YAML):

  path      repo-relative path, e.g. "Author/…/file.md"
  modified  file mtime ISO string (used for "recent" sorting)

Output
======
site_data.json  (written to the repository root, listed in .gitignore)
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import yaml  # PyYAML — already available in this environment

# ---------------------------------------------------------------------------
# Repository root
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

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

def extract_review(filepath: Path, rel_path: str) -> dict | None:
    """Parse *filepath* and return a review dict, or ``None`` to skip.

    All YAML keys are passed through verbatim except for the two special ones:

    * ``score``  — kept as-is under ``score_raw`` (str); also emitted under
                   ``score`` as a coerced int (or None).
    * ``tags``   — normalised to list[str].

    Two keys injected by the extractor (never in YAML):

    * ``path``     — repo-relative path.
    * ``modified`` — file mtime ISO string.

    A ``title`` fallback is applied when the YAML has no ``title`` key:
    the filename stem is used (trailing ``★…`` stripped).
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

    if not str(meta.get("reviewer") or "").strip():
        return None

    # Start with all YAML keys verbatim
    review: dict = dict(meta)

    # Infrastructure fields (not from YAML)
    review["path"] = rel_path
    review["modified"] = mtime_iso(filepath)

    # Title fallback: use filename stem when YAML has no ``title``
    if not str(review.get("title") or "").strip():
        review["title"] = re.sub(r"★.*$", "", filepath.stem).strip()

    # Special: score → coerce to int; keep raw string form
    score_val = meta.get("score")
    review["score_raw"] = str(score_val) if score_val is not None else ""
    review["score"] = coerce_int(score_val)

    # Special: tags → normalise to list[str]
    review["tags"] = to_str_list(meta.get("tags"))

    return review


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
            results.append(review)

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
    all_categories = sorted({c for r in reviews for c in to_str_list(r.get("category"))})
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
