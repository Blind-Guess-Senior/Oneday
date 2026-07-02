#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

All review metadata is read exclusively from YAML frontmatter and passed
through verbatim. A YAML review is included when:

    1. It has a valid YAML frontmatter block (``---`` … ``---``).
    2. It is considered "scored" by the top-level reviewer
         ``reviewer_config.toml`` score-only rules. If those rules are absent,
         everything under that reviewer is treated as scored.

The ``completed`` YAML key controls whether a review is complete. Reviews
without ``completed: true`` are marked as ``score_only`` when they match the
top-level reviewer ``reviewer_config.toml`` score-only rules.

Three YAML keys receive special normalisation:

  score   → emitted as ``score_raw`` (original string), ``score_rank``
            (sortable position), and ``score_tier`` (1-based tier index).
  tags    → normalised to a list[str] regardless of how YAML encodes it.
  aka     → normalised to a list[str].

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
import tomllib
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
    match = re.match(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", content, re.DOTALL)
    if not match:
        return {}, content
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, content[match.end():].lstrip("\r\n")


def extract_sub_scores(body: str) -> list[str]:
    """Return the lines of the first fenced code block in *body* as a list of strings.

    Returns an empty list when no code block is found.
    """
    match = re.search(r"^```[^\n]*\n(.*?)\n```", body, re.DOTALL | re.MULTILINE)
    if not match:
        return []
    return [ln.strip() for ln in match.group(1).strip().split("\n") if ln.strip()]


def to_str_list(val) -> list[str]:
    """Coerce *val* to a non-None list of non-empty strings."""
    if val is None:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v is not None and str(v).strip()]
    s = str(val).strip()
    return [s] if s else []


def load_toml(path: Path) -> dict:
    """Load a TOML file, returning an empty dict when it does not exist."""
    if not path.exists():
        return {}
    with path.open("rb") as fh:
        return tomllib.load(fh)


def score_key(val) -> str:
    """Return the canonical string key used for score matching."""
    return str(val).strip()


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


def title_from_aspark_filename(filepath: Path) -> str:
    """Return the Aspark filename stem with any trailing star score removed."""
    return re.sub(r"★+$", "", filepath.stem).strip()


def normalize_rel_token(value: str) -> str:
    """Trim whitespace and surrounding slashes from a path token."""
    return str(value).strip().strip("/")


# ---------------------------------------------------------------------------
# Metadata map loader
# ---------------------------------------------------------------------------

def load_metadata_maps(root: Path) -> dict[str, dict[str, list]]:
    """Load category-scoped metadata maps from reviewer config files.

    Returns a dict keyed first by reviewer, then by category name.  Each leaf is
    an ordered list of mapping entries::

        {"Reviewer": {"游戏": [{"keys": ["year", "month"], "separator": ".", "label": "游玩日期"}, ...]}}
    """
    maps: dict[str, dict[str, list]] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        config = load_toml(top_dir / "reviewer_config.toml")
        metadata_maps = config.get("metadata_maps")
        if not isinstance(metadata_maps, dict):
            continue
        reviewer_maps: dict[str, list] = {}
        for category_name, entries_value in metadata_maps.items():
            category_name = str(category_name).strip()
            if not category_name or not isinstance(entries_value, list):
                continue
            entries: list[dict] = []
            for raw_entry in entries_value:
                if not isinstance(raw_entry, dict):
                    continue
                keys = to_str_list(raw_entry.get("keys"))
                label = str(raw_entry.get("label") or "").strip()
                if not keys or not label:
                    continue
                entry = {"keys": keys, "label": label}
                separator = raw_entry.get("separator")
                if separator is not None:
                    entry["separator"] = str(separator)
                entries.append(entry)
            if entries:
                reviewer_maps[category_name] = entries
        if reviewer_maps:
            maps[top_dir.name] = reviewer_maps
    return maps


def load_score_configs(root: Path) -> dict[str, dict]:
    """Load reviewer score ordering and tier rules."""
    configs: dict[str, dict] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        config = load_toml(top_dir / "reviewer_config.toml")
        score_config = config.get("score")
        if not isinstance(score_config, dict):
            continue

        order = to_str_list(score_config.get("order"))
        order_map = {value: idx + 1 for idx, value in enumerate(order)}

        tiers: list[set[str]] = []
        raw_tiers = score_config.get("tiers")
        if isinstance(raw_tiers, list):
            for raw_tier in raw_tiers:
                if not isinstance(raw_tier, dict):
                    continue
                values = set(to_str_list(raw_tier.get("values")))
                if values:
                    tiers.append(values)

        configs[top_dir.name] = {
            "order": order,
            "order_map": order_map,
            "tiers": tiers,
        }
    return configs


def apply_score_configs(reviews: list[dict], score_configs: dict[str, dict]) -> None:
    """Populate score_raw, score_rank, and score_tier for each review."""
    for review in reviews:
        score_raw = score_key(review.get("score_raw"))
        review["score_raw"] = score_raw

        config = score_configs.get(str(review.get("reviewer") or ""), {})
        order_map = config.get("order_map") or {}
        if score_raw in order_map:
            score_rank = order_map[score_raw]
        else:
            score_rank = None
        review["score_rank"] = score_rank
        review["score"] = score_raw

        score_tier = None
        tiers = config.get("tiers") or []
        for idx, tier_values in enumerate(tiers, start=1):
            if score_raw in tier_values:
                score_tier = idx
                break
        review["score_tier"] = score_tier


def score_options_by_reviewer(reviews: list[dict], score_configs: dict[str, dict]) -> dict[str, list[str]]:
    """Return ordered score filter options for each reviewer."""
    seen_scores: dict[str, set[str]] = {}
    for review in reviews:
        reviewer = str(review.get("reviewer") or "")
        score_raw = str(review.get("score_raw") or "")
        if not reviewer or not score_raw:
            continue
        seen_scores.setdefault(reviewer, set()).add(score_raw)

    result: dict[str, list[str]] = {}
    for reviewer, scores in seen_scores.items():
        order = score_configs.get(reviewer, {}).get("order") or []
        ordered = [score for score in order if score in scores]
        remaining = sorted(scores - set(ordered))
        result[reviewer] = ordered + remaining
    return result


def css_attr_value(value: str) -> str:
    """Escape a string for use in a double-quoted CSS attribute selector."""
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def scoped_reviewer_css(reviewer: str, css: str) -> str:
    """Extract score-tier rules and scope them to a reviewer.

    Reviewer CSS is intentionally treated as a small whitelist: only simple
    ``.score-tier-N { ... }`` rule blocks are emitted.  Other selectors are
    ignored so a malformed reviewer stylesheet cannot leak global styles.
    """
    prefix = f'[data-reviewer="{css_attr_value(reviewer)}"]'
    scoped_rules: list[str] = []
    for match in re.finditer(r"(?s)(\.score-tier-\d+\s*)\{([^{}]*)\}", css):
        selector = match.group(1).strip()
        declarations = match.group(2).strip()
        if not declarations:
            continue
        scoped_rules.append(f"{prefix}{selector} {{\n{declarations}\n}}")
    return "\n\n".join(scoped_rules).strip()


def write_reviewer_styles(root: Path) -> str:
    """Write generated reviewer score styles and return the repo-relative path."""
    generated_dir = root / "generated"
    generated_dir.mkdir(exist_ok=True)
    out = generated_dir / "reviewer_styles.css"

    css_parts: list[str] = []
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        style_file = top_dir / "reviewer_style.css"
        if not style_file.exists():
            continue
        css = style_file.read_text(encoding="utf-8").strip()
        if css:
            css_parts.append(f"/* {top_dir.name} */\n{scoped_reviewer_css(top_dir.name, css)}")

    out.write_text("\n\n".join(css_parts) + ("\n" if css_parts else ""), encoding="utf-8")
    return out.relative_to(root).as_posix()


# ---------------------------------------------------------------------------
# Reviewer config loader  (reads reviewer_config.toml from top-level reviewer dirs)
# ---------------------------------------------------------------------------

def load_category_map(root: Path) -> dict[str, list[dict]]:
    """Load category mappings from top-level reviewer config files.

    Returns a dict keyed by reviewer name.  Each value is an ordered list of
    entries::

        [{"name": "动漫", "folders": ["Anime"]}, ...]
    """
    result: dict[str, list[dict]] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        config = load_toml(top_dir / "reviewer_config.toml")
        categories = config.get("categories")
        if not isinstance(categories, dict):
            continue
        entries: list[dict] = []
        for name, folders_value in categories.items():
            name = str(name).strip()
            folders = to_str_list(folders_value)
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
    """Return category names for *rel_path* based on reviewer config mapping."""
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
# Include rules loader  (reads reviewer_config.toml from top-level reviewer dirs)
# ---------------------------------------------------------------------------

def load_include_rules(root: Path) -> dict[str, list[tuple[str, str]] | None]:
    """Load score-only include rules from top-level reviewer config files.

    A review is considered "scored" when at least one rule matches exactly.
    If a reviewer has no score_only table, all YAML reviews under that reviewer
    are treated as scored by default.

    Returns a dict keyed by reviewer folder name:

    * ``None``          – no score_only table found; all reviews are scored.
    * ``[(k, v), ...]`` – score_only exists; any rule match marks scored.
    """
    result: dict[str, list[tuple[str, str]] | None] = {}
    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith("."):
            continue
        config_file = top_dir / "reviewer_config.toml"
        if not config_file.exists():
            continue
        config = load_toml(config_file)
        score_only = config.get("score_only")
        if not isinstance(score_only, dict):
            result[top_dir.name] = None
            continue
        rules: list[tuple[str, str]] = []
        for key, values in score_only.items():
            key = str(key).strip()
            if not key:
                continue
            for value in to_str_list(values):
                rules.append((key, value))
        result[top_dir.name] = rules
    return result


def is_scored_review(
    meta: dict,
    reviewer: str,
    include_rules: dict[str, list[tuple[str, str]] | None],
) -> bool:
    """Return whether a YAML review should be treated as scored.

    * No score_only table for reviewer => all reviews are scored.
    * score_only exists               => any configured value match is scored.
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

    All YAML keys are passed through verbatim except for the three special ones:

    * ``score``  — normalised to ``score_raw`` (str); later enriched with
                   ``score_rank`` and ``score_tier`` from reviewer config.
    * ``tags``   — normalised to list[str].
    * ``aka``    — normalised to list[str].

    Four keys injected by the extractor (never read from YAML):

    * ``path``     — repo-relative path.
    * ``reviewer`` — top-level folder name (repository is organised by author).
    * ``modified`` — file mtime ISO string.
    * ``score_only`` — True when ``completed`` is not boolean ``true``.

    A ``title`` fallback is applied when the YAML has no ``title`` key:
    the filename stem is used. Aspark filenames additionally strip trailing
    ``★…``.
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
    # 1) complete review: in configured category folder AND completed: true
    # 2) score-only review: not complete, in configured category folder, and score-only rule match
    is_completed = meta.get("completed") is True
    if is_completed:
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

    if not str(review.get("title") or "").strip():
        if reviewer.lower() == "aspark":
            review["title"] = title_from_aspark_filename(filepath)
        else:
            review["title"] = filepath.stem.strip()

    # Special: score → keep raw string form. Ranking and tier are applied later.
    score_val = meta.get("score")
    review["score_raw"] = score_key(score_val) if score_val is not None else ""

    # Special: tags → normalise to list[str]
    review["tags"] = to_str_list(meta.get("tags")) if has_yaml else []

    # Special: aka → normalise to list[str]
    review["aka"] = to_str_list(meta.get("aka")) if has_yaml else []

    review["sub_scores"] = extract_sub_scores(effective_body)

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
    candidate = normalize_rel_token(standard_category_rel)
    if not candidate:
        return ""

    best_match_name = ""
    best_match_len = -1
    for entry in category_map.get(reviewer, []):
        cat_name = normalize_rel_token(str(entry.get("name") or ""))
        if not cat_name:
            continue

        keys = [cat_name]
        for folder_rel in entry.get("folders", []):
            folder = normalize_rel_token(str(folder_rel))
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
    standard_category_rel = "/".join(parts[2:-1])
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
# Tag type loader  (reads scripts/site_config.toml)
# ---------------------------------------------------------------------------

def load_tag_types(root: Path) -> dict:
    """Load tag type classification from ``scripts/site_config.toml``.

    A ``canonical+tag_alias`` expression means *tag_alias* is merged into
    *canonical* (the alias tag is replaced by the canonical one when processing
    reviews).
    Tags absent from the selected category's type config default to type 3.

    Returns a dict with two keys:

    * ``type_map``  – ``{category_name: {canonical_tag: type_number}}``
    * ``tag_aliases`` – ``{category_name: {alias_tag: canonical_tag}}``
    """
    type_map: dict[str, dict[str, int]] = {}
    tag_aliases: dict[str, dict[str, str]] = {}
    config = load_toml(root / "scripts" / "site_config.toml")
    tag_types = config.get("tag_types", {})
    if not isinstance(tag_types, dict):
        return {"type_map": type_map, "tag_aliases": tag_aliases}

    for type_key, categories in tag_types.items():
        try:
            type_num = int(type_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(categories, dict):
            continue
        for category_name, tags_value in categories.items():
            category_name = str(category_name).strip()
            if not category_name:
                continue
            category_type_map = type_map.setdefault(category_name, {})
            category_aliases = tag_aliases.setdefault(category_name, {})
            for tag_expr in to_str_list(tags_value):
                if "+" in tag_expr:
                    parts = [p.strip() for p in tag_expr.split("+") if p.strip()]
                    if not parts:
                        continue
                    canonical = parts[0]
                    for tag_alias in parts[1:]:
                        category_aliases[tag_alias] = canonical
                    category_type_map[canonical] = type_num
                else:
                    category_type_map[tag_expr] = type_num
    return {"type_map": type_map, "tag_aliases": tag_aliases}


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
    score_configs = load_score_configs(ROOT)

    reviews = scan(include_rules, category_map)
    standards = scan_standards(category_map)
    apply_score_configs(reviews, score_configs)

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

    # Load tag type classification and apply tag aliases
    tag_types_data = load_tag_types(ROOT)
    tag_aliases_by_category = tag_types_data["tag_aliases"]
    if tag_aliases_by_category:
        for review in reviews:
            orig_tags = review.get("tags") or []
            review_categories = to_str_list(review.get("category"))
            new_tags: list[str] = []
            seen_tags: set[str] = set()
            for t in orig_tags:
                canonical = t
                for category in review_categories:
                    category_aliases = tag_aliases_by_category.get(category, {})
                    if t in category_aliases:
                        canonical = category_aliases[t]
                        break
                if canonical not in seen_tags:
                    seen_tags.add(canonical)
                    new_tags.append(canonical)
            review["tags"] = new_tags

    # Aggregate vocabulary for filter dropdowns
    all_tags = sorted({t for r in reviews for t in (r.get("tags") or [])})
    reviewers = sorted({r["reviewer"] for r in reviews})

    # Build ordered categories list from reviewer config files (preserving order).
    ordered_cats: list[str] = []
    seen_cats: set[str] = set()
    for _reviewer, entries in category_map.items():
        for entry in entries:
            name = entry["name"]
            if name not in seen_cats:
                ordered_cats.append(name)
                seen_cats.add(name)

    metadata_maps = load_metadata_maps(ROOT)
    score_options = score_options_by_reviewer(reviews, score_configs)
    reviewer_stylesheet = write_reviewer_styles(ROOT)

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
            "score_options":  score_options,
            "reviewer_stylesheet": reviewer_stylesheet,
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
