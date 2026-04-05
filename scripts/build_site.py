#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

All review metadata is read exclusively from YAML frontmatter and passed
through verbatim.  A file is included only when:

  1. It has a valid YAML frontmatter block (``---`` … ``---``).
  2. Its body contains the completion marker ``---fin.---``.

Two YAML keys receive special normalisation:

  score   → also emitted as ``score_raw`` (original string) and ``score``
            (coerced to int, or None).
  tags    → normalised to a list[str] regardless of how YAML encodes it.

All other YAML keys are written to the output dict exactly as-is.
Three extra keys are always injected (never read from YAML):

  path      repo-relative path, e.g. "Author/…/file.md"
  reviewer  top-level folder name (the repository is organised by author)
  modified  file mtime ISO string (used for "recent" sorting)

Output
======
site_data.json  (written to the repository root, listed in .gitignore)
"""

from __future__ import annotations

import hashlib
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
MODIFIED_INDEX_PATH = ROOT / "scripts" / "modified_index.json"


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


def file_sha1(filepath: Path) -> str:
    """Return hex sha1 digest for *filepath* content."""
    h = hashlib.sha1()
    with filepath.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def git_commit_iso(rel_path: str) -> str | None:
    """Return last git commit time (ISO) for *rel_path*, or None if unavailable."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", rel_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return datetime.fromtimestamp(int(result.stdout.strip())).isoformat()
    except Exception:
        return None
    return None


def load_modified_index(path: Path) -> dict[str, dict[str, str]]:
    """Load the persisted modified index from disk."""
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, dict[str, str]] = {}
    for rel_path, entry in raw.items():
        if not isinstance(rel_path, str):
            continue
        if isinstance(entry, dict):
            sha1 = str(entry.get("sha1") or "").strip()
            modified = str(entry.get("modified") or "").strip()
            if sha1 and modified:
                cleaned[rel_path] = {"sha1": sha1, "modified": modified}
    return cleaned


def save_modified_index(path: Path, index: dict[str, dict[str, str]]) -> None:
    """Write the modified index to disk in stable order."""
    ordered = {k: index[k] for k in sorted(index)}
    path.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def resolve_modified(filepath: Path, rel_path: str, index: dict[str, dict[str, str]]) -> str:
    """Resolve stable modified timestamp using digest index, updating entry when needed."""
    digest = file_sha1(filepath)
    cached = index.get(rel_path)
    if isinstance(cached, dict):
        if cached.get("sha1") == digest and str(cached.get("modified") or "").strip():
            return str(cached["modified"])

    modified = git_commit_iso(rel_path)
    if not modified:
        modified = datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()

    index[rel_path] = {"sha1": digest, "modified": modified}
    return modified


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


# ---------------------------------------------------------------------------
# TBA (award files) scanner
# ---------------------------------------------------------------------------

def scan_tba(root: Path, category_map: dict[str, list[dict]]) -> list[dict]:
    """Scan no-YAML award/special files defined via ``category.txt``.

    Files without YAML frontmatter that live in folders listed in a
    ``category.txt`` are included unconditionally (no ``---fin.---``
    requirement).  Their category is taken from the ``category.txt`` mapping
    rather than being hardcoded.
    """
    results: list[dict] = []
    for reviewer_dir in sorted(root.iterdir()):
        if not reviewer_dir.is_dir() or reviewer_dir.name.startswith("."):
            continue
        reviewer = reviewer_dir.name
        cat_entries = category_map.get(reviewer, [])
        for cat_entry in cat_entries:
            cat_name = cat_entry["name"]
            for folder_rel in cat_entry["folders"]:
                cat_dir = reviewer_dir / folder_rel
                if not cat_dir.is_dir():
                    continue
                for fp in sorted(cat_dir.glob("*.md")):
                    try:
                        content = fp.read_text(encoding="utf-8")
                    except Exception:
                        continue
                    # Skip files that have YAML frontmatter — they are handled
                    # by the main scan() / extract_review() pipeline.
                    meta_check, _ = parse_yaml_frontmatter(content)
                    if meta_check:
                        continue
                    rel_path = fp.relative_to(root).as_posix()
                    if not is_content_file(fp, rel_path):
                        continue
                    reviewer_lc = reviewer.lower()
                    if reviewer_lc == "aspark":
                        score_raw, score_num = aspark_score_from_filename(fp)
                        title = re.sub(r"★+$", "", fp.stem).strip()
                        score_system = "stars"
                    else:
                        score_raw, score_num = "", None
                        title = fp.stem
                        score_system = "decimal"
                    results.append({
                        "path":      rel_path,
                        "title":     title,
                        "reviewer":  reviewer,
                        "category":  [cat_name],
                        "modified":  "",
                        "tags":      [],
                        "score":     score_num,
                        "score_raw": score_raw,
                        "score_system": score_system,
                    })
    return results


# ---------------------------------------------------------------------------
# Universal extractor
# ---------------------------------------------------------------------------

def extract_review(filepath: Path, rel_path: str) -> dict | None:
    """Parse *filepath* and return a review dict, or ``None`` to skip.

    All YAML keys are passed through verbatim except for the two special ones:

    * ``score``  — kept as-is under ``score_raw`` (str); also emitted under
                   ``score`` as a coerced int (or None).
    * ``tags``   — normalised to list[str].

    Three keys injected by the extractor (never read from YAML):

    * ``path``     — repo-relative path.
    * ``reviewer`` — top-level folder name (repository is organised by author).
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

    # Start with all YAML keys verbatim
    review: dict = dict(meta)

    # Infrastructure fields derived from the file path (not from YAML)
    review["path"] = rel_path
    review["reviewer"] = rel_path.split("/")[0]
    review["modified"] = ""

    reviewer = rel_path.split("/")[0]
    if reviewer.lower() == "aspark":
        score_raw, score_num = aspark_score_from_filename(filepath)
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
    review["tags"] = to_str_list(meta.get("tags"))

    return review


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

    category_map = load_category_map(ROOT)
    modified_index = load_modified_index(MODIFIED_INDEX_PATH)

    reviews = scan()
    tba = scan_tba(ROOT, category_map)
    reviews.extend(tba)

    # Stable modified strategy: unchanged files keep prior timestamp;
    # changed/new files are refreshed from git (or file mtime fallback).
    current_paths: set[str] = set()
    for review in reviews:
        rel_path = str(review.get("path") or "")
        if not rel_path:
            continue
        current_paths.add(rel_path)
        filepath = ROOT / rel_path
        if filepath.exists():
            review["modified"] = resolve_modified(filepath, rel_path, modified_index)

    # Remove deleted files from index and persist for next build.
    stale_paths = set(modified_index.keys()) - current_paths
    for rel_path in stale_paths:
        modified_index.pop(rel_path, None)
    save_modified_index(MODIFIED_INDEX_PATH, modified_index)

    # Sort: most recently reviewed first (front-end "recent updates" view).
    # Use year+month as the primary key since they represent the review date;
    # fall back to modified (file edit time) as tiebreaker.
    def _sort_key(r: dict) -> tuple:
        year  = int(r["year"])  if r.get("year")  else 0
        month = int(r["month"]) if r.get("month") else 0
        return (year, month, r.get("modified", ""))
    reviews.sort(key=_sort_key, reverse=True)

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
    # Any category found in reviews but not in any category.txt is appended at
    # the end in sorted order so nothing is accidentally hidden.
    ordered_cats: list[str] = []
    seen_cats: set[str] = set()
    for _reviewer, entries in category_map.items():
        for entry in entries:
            name = entry["name"]
            if name not in seen_cats:
                ordered_cats.append(name)
                seen_cats.add(name)
    # Append any remaining categories from reviews that aren't in category.txt
    extra_cats = sorted(
        {c for r in reviews for c in to_str_list(r.get("category"))} - seen_cats
    )
    ordered_cats.extend(extra_cats)

    metadata_maps = load_metadata_maps(ROOT)

    site_data = {
        "reviews": reviews,
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
    print(f"  Reviewers  : {reviewers}")
    print(f"  Categories : {ordered_cats}")
    print(f"  Tags       : {len(all_tags)} unique")


if __name__ == "__main__":
    main()
