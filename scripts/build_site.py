#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

All review metadata is read exclusively from YAML frontmatter and passed
through verbatim. A YAML review is included when:

    1. It has a valid YAML frontmatter block (``---`` … ``---``).
    2. It is considered "scored" by the top-level reviewer ``include.txt``
         rules (``key=value`` lines, any-match). If include.txt is absent,
         everything under that reviewer is treated as scored.

The ``---fin.---`` marker no longer controls inclusion directly. Instead,
reviews without that marker are marked as ``score_only`` so the frontend can
choose whether to show them.

Two YAML keys receive special normalisation:

  score   → also emitted as ``score_raw`` (original string) and ``score``
            (coerced to int, or None).
  tags    → normalised to a list[str] regardless of how YAML encodes it.

All other YAML keys are written to the output dict exactly as-is.
Three extra keys are always injected (never read from YAML):

  path      repo-relative path, e.g. "Author/…/file.md"
  reviewer  top-level folder name (the repository is organised by author)
  modified  last git commit time ISO string (used for "recent" sorting)

Output
======
site_data.json  (written to the repository root, listed in .gitignore)
"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

import yaml  # PyYAML — already available in this environment

# ---------------------------------------------------------------------------
# Repository root
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent
ASPARK_SCORE_RE = re.compile(r"(★{1,5})$")


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


def git_commit_iso(rel_path: str) -> str:
    """Return last git commit time (ISO) for *rel_path*.

    Falls back to the current time if git is unavailable or the file has no
    commit history (e.g. freshly added but not yet pushed).
    """
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", rel_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return datetime.fromtimestamp(int(result.stdout.strip())).isoformat()
    except Exception:
        pass
    return ""


def aspark_score_from_filename(filepath: Path) -> tuple[str, int | None]:
    """Return (raw_score, numeric_score) for an Aspark filename."""
    stem = filepath.stem
    match = ASPARK_SCORE_RE.search(stem)
    if not match:
        return "", None
    stars = match.group(1)
    return stars, len(stars)


# ---------------------------------------------------------------------------
# Metadata map loader
# ---------------------------------------------------------------------------

def load_metadata_maps(root: Path) -> dict[str, list]:
    """Load all metadata_map.txt files found anywhere in the repository.

    Returns a dict keyed by the folder path (relative to root) containing the
    file.  Each value is an ordered list of mapping entries::

        [{"keys": ["year", "month"], "label": "游玩日期"}, ...]

    Line format (one per line):
        key . label              – single key
        key1+key2 . label        – merged keys (displayed as "val1.val2")
    Lines starting with ``#`` or without `` . `` are ignored.
    """
    maps: dict[str, list] = {}
    for map_file in root.rglob("metadata_map.txt"):
        folder = map_file.parent.relative_to(root).as_posix()
        entries: list[dict] = []
        for line in map_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if " . " in line:
                # Merged-key format: key1+key2 . label  or  key . label
                key_part, label = line.split(" . ", 1)
                keys = [k.strip() for k in key_part.split("+")]
                entries.append({"keys": keys, "label": label.strip()})
            elif " " in line:
                # Simple format: key label
                key_part, label = line.split(None, 1)
                entries.append({"keys": [key_part.strip()], "label": label.strip()})
        maps[folder] = entries
    return maps


# ---------------------------------------------------------------------------
# Category map loader  (reads category.txt from top-level reviewer dirs)
# ---------------------------------------------------------------------------

def load_category_map(root: Path) -> dict[str, list[dict]]:
    """Load ``category.txt`` files from top-level reviewer directories.

    Line format::

        分类名 = folder1+folder2

    The category name (left of ``=``) is the label shown on the website.
    The right side lists one or more sub-folder paths (relative to the reviewer
    directory) separated by ``+``.

    Returns a dict keyed by reviewer name.  Each value is an ordered list of
    entries::

        [{"name": "动漫", "folders": ["Anime"]}, ...]
    """
    result: dict[str, list[dict]] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        cat_file = top_dir / "category.txt"
        if not cat_file.exists():
            continue
        entries: list[dict] = []
        for line in cat_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, folders_str = line.split("=", 1)
            name = name.strip()
            folders = [f.strip() for f in folders_str.split("+") if f.strip()]
            if name and folders:
                entries.append({"name": name, "folders": folders})
        if entries:
            result[top_dir.name] = entries
    return result


def categories_from_path(
    reviewer: str,
    rel_path: str,
    category_map: dict[str, list[dict]],
) -> list[str]:
    """Return category names for *rel_path* based on category.txt folder mapping."""
    matched: list[str] = []
    reviewer_prefix = reviewer + "/"
    for entry in category_map.get(reviewer, []):
        cat_name = str(entry.get("name") or "").strip()
        if not cat_name:
            continue
        for folder_rel in entry.get("folders", []):
            folder_rel = str(folder_rel).strip().strip("/")
            if not folder_rel:
                continue
            if rel_path.startswith(reviewer_prefix + folder_rel + "/"):
                matched.append(cat_name)
                break
    return matched


# ---------------------------------------------------------------------------
# Include rules loader  (reads include.txt from top-level reviewer dirs)
# ---------------------------------------------------------------------------

def load_include_rules(root: Path) -> dict[str, list[tuple[str, str]] | None]:
    """Load include rules from top-level reviewer ``include.txt`` files.

    Rule line format::

        key=value

    A review is considered "scored" when at least one rule matches exactly.
    If a reviewer has no include.txt, all YAML reviews under that reviewer are
    treated as scored by default.

    Returns a dict keyed by reviewer folder name:

    * ``None``          – no include.txt found; all reviews are scored.
    * ``[(k, v), ...]`` – include.txt exists; any rule match marks scored.
    """
    result: dict[str, list[tuple[str, str]] | None] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        include_file = top_dir / "include.txt"
        if not include_file.exists():
            result[top_dir.name] = None
            continue
        rules: list[tuple[str, str]] = []
        for line in include_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key and value:
                rules.append((key, value))
        result[top_dir.name] = rules
    return result


def is_scored_review(
    meta: dict,
    reviewer: str,
    include_rules: dict[str, list[tuple[str, str]] | None],
) -> bool:
    """Return whether a YAML review should be treated as scored.

    * No include.txt for reviewer => all reviews are scored.
    * include.txt exists          => any ``key=value`` rule match is scored.
    """
    rules = include_rules.get(reviewer, None)
    if rules is None:
        return True
    for key, value in rules:
        meta_val = meta.get(key)
        if meta_val is not None and str(meta_val).strip() == value:
            return True
    return False


# ---------------------------------------------------------------------------
# Universal extractor
# ---------------------------------------------------------------------------

def extract_review(
    filepath: Path,
    rel_path: str,
    include_rules: dict[str, list[tuple[str, str]] | None],
    category_map: dict[str, list[dict]],
) -> dict | None:
    """Parse *filepath* and return a review dict, or ``None`` to skip.

    All YAML keys are passed through verbatim except for the two special ones:

    * ``score``  — kept as-is under ``score_raw`` (str); also emitted under
                   ``score`` as a coerced int (or None).
    * ``tags``   — normalised to list[str].

    Four keys injected by the extractor (never read from YAML):

    * ``path``     — repo-relative path.
    * ``reviewer`` — top-level folder name (repository is organised by author).
    * ``modified`` — file mtime ISO string.
    * ``score_only`` — True when body lacks ``---fin.---`` marker.

    A ``title`` fallback is applied when the YAML has no ``title`` key:
    the filename stem is used (trailing ``★…`` stripped).
    """
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception:
        return None

    reviewer = rel_path.split("/")[0]
    categories = categories_from_path(reviewer, rel_path, category_map)
    if not categories:
        return None

    meta, body = parse_yaml_frontmatter(content)
    has_yaml = bool(meta)
    effective_body = body if has_yaml else content

    # Inclusion order:
    # 1) complete review: in category.txt folder AND has ---fin.---
    # 2) score-only review: not complete, in category.txt folder, and include.txt rule match
    has_fin_marker = "---fin.---" in effective_body
    if has_fin_marker:
        score_only = False
    else:
        if not is_scored_review(meta, reviewer, include_rules):
            return None
        score_only = True

    # Start with all YAML keys verbatim
    review: dict = dict(meta) if has_yaml else {}

    # Infrastructure fields derived from the file path (not from YAML)
    review["path"] = rel_path
    review["reviewer"] = reviewer
    review["modified"] = ""
    review["score_only"] = score_only
    review["category"] = categories

    if reviewer.lower() == "aspark":
        score_raw, score_num = aspark_score_from_filename(filepath)
        if score_num is None:
            return None
        review["score_raw"] = score_raw
        review["score"] = score_num
        review["title"] = re.sub(r"★+$", "", filepath.stem).strip()
    elif not str(review.get("title") or "").strip():
        review["title"] = re.sub(r"★.*$", "", filepath.stem).strip()

    # Special: score → coerce to int; keep raw string form
    if reviewer.lower() != "aspark":
        score_val = meta.get("score")
        review["score_raw"] = str(score_val) if score_val is not None else ""
        review["score"] = coerce_int(score_val)

    # Auto-detect score system: Aspark uses star ratings (1–5), others decimal (1–10)
    review["score_system"] = "stars" if reviewer.lower() == "aspark" else "decimal"

    # Special: tags → normalise to list[str]
    review["tags"] = to_str_list(meta.get("tags")) if has_yaml else []

    return review


# ---------------------------------------------------------------------------
# Rating standard extractor
# ---------------------------------------------------------------------------

def resolve_standard_category(
    reviewer: str,
    standard_category_rel: str,
    category_map: dict[str, list[dict]],
) -> str:
    """Resolve a standard folder path to a display category name."""
    candidate = standard_category_rel.strip().strip("/")
    if not candidate:
        return ""

    best_match_name = ""
    best_match_len = -1
    for entry in category_map.get(reviewer, []):
        cat_name = str(entry.get("name") or "").strip().strip("/")
        if not cat_name:
            continue

        keys = [cat_name]
        for folder_rel in entry.get("folders", []):
            folder = str(folder_rel).strip().strip("/")
            if folder:
                keys.append(folder)

        for key in keys:
            if candidate == key or candidate.startswith(key + "/"):
                if len(key) > best_match_len:
                    best_match_name = cat_name
                    best_match_len = len(key)

    return best_match_name or candidate


def extract_standard(
    filepath: Path,
    rel_path: str,
    category_map: dict[str, list[dict]],
) -> dict | None:
    """Parse a rating standard markdown file under ``reviewer/Standard/category/``."""
    parts = rel_path.split("/")
    if len(parts) < 4 or parts[1] != "Standard":
        return None

    reviewer = parts[0]
    standard_category_rel = "/".join(parts[2:-1]).strip("/")
    category = resolve_standard_category(reviewer, standard_category_rel, category_map)
    if not category:
        return None

    return {
        "path": rel_path,
        "reviewer": reviewer,
        "category": category,
        "title": filepath.stem,
        "modified": "",
    }


# ---------------------------------------------------------------------------
# Tag type loader  (reads type1.txt / type2.txt / type3.txt from scripts/)
# ---------------------------------------------------------------------------

def load_tag_types(root: Path) -> dict:
    """Load tag type classification from ``scripts/type{1,2,3}.txt``.

    File format — one or more sections, each opened by a ``-CategoryName``
    header line followed by comma-separated tags::

        -书籍
        单元剧,公路片,自然+动物

    A ``canonical+alias`` expression means *alias* is merged into *canonical*
    (the alias tag is replaced by the canonical one when processing reviews).
    Tags absent from all type files default to type 3.

    Returns a dict with two keys:

    * ``type_map``  – ``{canonical_tag: type_number}``  (1, 2, or 3)
    * ``aliases``   – ``{alias_tag: canonical_tag}``
    """
    type_map: dict[str, int] = {}
    aliases: dict[str, str] = {}
    for type_num in (1, 2, 3):
        type_file = root / "scripts" / f"type{type_num}.txt"
        if not type_file.exists():
            continue
        with type_file.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("-") or line.startswith("#"):
                    continue
                for tag_expr in line.split(","):
                    tag_expr = tag_expr.strip()
                    if not tag_expr:
                        continue
                    if "+" in tag_expr:
                        parts = [p.strip() for p in tag_expr.split("+")]
                        canonical = parts[0]
                        for alias in parts[1:]:
                            if alias:
                                aliases[alias] = canonical
                        if canonical:
                            type_map[canonical] = type_num
                    else:
                        type_map[tag_expr] = type_num
    return {"type_map": type_map, "aliases": aliases}


# ---------------------------------------------------------------------------
# Global filter: which files are candidates for extraction
# ---------------------------------------------------------------------------

# File/folder names that indicate non-review content
_NON_REVIEW_NAMES: tuple[str, ...] = (
    "标准", "说明书", "Template",
    "ToWatch", "ToRead", "Recent", "README", "Readme",
)


def is_content_file(filepath: Path, rel_path: str) -> bool:
    """Return ``True`` if the file is a candidate review (not a template, standard, etc.)."""
    if "/Templates/" in rel_path:
        return False
    if "/Standard/" in rel_path:
        return False
    if filepath.name.startswith("_"):
        return False
    if any(token in filepath.name for token in _NON_REVIEW_NAMES):
        return False
    return True


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def scan(
    include_rules: dict[str, list[tuple[str, str]] | None],
    category_map: dict[str, list[dict]],
) -> list[dict]:
    """Walk the entire repository tree, extract metadata, return list of dicts."""
    results: list[dict] = []
    errors: list[str] = []
    filepaths = sorted(ROOT.rglob("*.md"))

    for want_score_only in (False, True):
        for filepath in filepaths:
            rel_path = filepath.relative_to(ROOT).as_posix()

            if not is_content_file(filepath, rel_path):
                continue

            try:
                review = extract_review(filepath, rel_path, include_rules, category_map)
            except Exception as exc:
                errors.append(f"{rel_path}: {exc}")
                continue

            if review is None:
                continue
            if bool(review.get("score_only")) != want_score_only:
                continue
            results.append(review)

    if errors:
        print(f"  [warn] {len(errors)} extraction error(s):")
        for e in errors[:10]:
            print(f"         {e}")

    return results


def scan_standards(category_map: dict[str, list[dict]]) -> list[dict]:
    """Collect rating standard markdown files from ``reviewer/Standard/category/``."""
    results: list[dict] = []
    for filepath in sorted(ROOT.rglob("*.md")):
        rel_path = filepath.relative_to(ROOT).as_posix()
        try:
            standard = extract_standard(filepath, rel_path, category_map)
        except Exception:
            standard = None
        if standard is not None:
            results.append(standard)
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Building site_data.json…")

    include_rules = load_include_rules(ROOT)
    category_map = load_category_map(ROOT)

    reviews = scan(include_rules, category_map)
    standards = scan_standards(category_map)

    # Populate modified: ask git for the last commit time of each file.
    # CI uses fetch-depth: 0 so the full history is always available.
    for review in reviews:
        rel_path = str(review.get("path") or "")
        if rel_path:
            review["modified"] = git_commit_iso(rel_path)
    for standard in standards:
        rel_path = str(standard.get("path") or "")
        if rel_path:
            standard["modified"] = git_commit_iso(rel_path)

    # Sort: most recently modified first (front-end "recent updates" view)
    reviews.sort(key=lambda r: r.get("modified", ""), reverse=True)
    standards.sort(
        key=lambda s: (
            str(s.get("reviewer") or ""),
            str(s.get("category") or ""),
            str(s.get("title") or ""),
        )
    )

    # Load tag type classification and apply aliases
    tag_types_data = load_tag_types(ROOT)
    aliases = tag_types_data["aliases"]
    if aliases:
        for review in reviews:
            orig_tags = review.get("tags") or []
            new_tags: list[str] = []
            seen_tags: set[str] = set()
            for t in orig_tags:
                canonical = aliases.get(t, t)
                if canonical not in seen_tags:
                    seen_tags.add(canonical)
                    new_tags.append(canonical)
            review["tags"] = new_tags

    # Aggregate vocabulary for filter dropdowns
    all_tags = sorted({t for r in reviews for t in (r.get("tags") or [])})
    reviewers = sorted({r["reviewer"] for r in reviews})

    # Build ordered categories list from category.txt files (preserving order).
    ordered_cats: list[str] = []
    seen_cats: set[str] = set()
    for _reviewer, entries in category_map.items():
        for entry in entries:
            name = entry["name"]
            if name not in seen_cats:
                ordered_cats.append(name)
                seen_cats.add(name)

    metadata_maps = load_metadata_maps(ROOT)

    site_data = {
        "reviews": reviews,
        "standards": standards,
        "meta": {
            "total":         len(reviews),
            "generated":     datetime.now().isoformat(),
            "categories":    ordered_cats,
            "reviewers":     reviewers,
            "all_tags":      all_tags,
            "metadata_maps": metadata_maps,
            "tag_types":     tag_types_data,
        },
    }

    out = ROOT / "site_data.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(site_data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✓ Written {out}")
    print(f"  Reviews    : {len(reviews)}")
    print(f"  Standards  : {len(standards)}")
    print(f"  Reviewers  : {reviewers}")
    print(f"  Categories : {ordered_cats}")
    print(f"  Tags       : {len(all_tags)} unique")


if __name__ == "__main__":
    main()
