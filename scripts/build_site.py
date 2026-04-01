#!/usr/bin/env python3
"""Build site_data.json from markdown review files.

Architecture
============
Each author's content lives in its own folder and uses a different
file format.  This script defines a **strategy pattern** so that each
folder gets its own :class:`ReviewExtractor` subclass:

  Aspark/                    →  AsparkExtractor
  Blind-Guess-Senior/        →  BlindGuessSeniorExtractor

To add a new author/folder, subclass :class:`ReviewExtractor`, implement
:meth:`extract`, then register it in :func:`build_registry`.

Output
======
site_data.json  (written to the repository root, listed in .gitignore)

Schema of each item in ``reviews``:

  path          str            repo-relative path, e.g. "Aspark/…/file.md"
  title         str            display title
  reviewer      str            folder owner / pen-name
  score         int|None       normalised numeric score (None = unscored)
  score_raw     str            score as shown in the UI, e.g. "★★★★" / "9/10"
  score_system  "stars"|"decimal"
  sub_scores    dict           {dimension: value}  – structure is extractor-defined
  category      list[str]      e.g. ["游戏"]
  status        str            e.g. "已完成" / "进行中" / "未完成"
  tags          list[str]
  date          str|None       review date, ISO-like: "YYYY-MM-DD" / "YYYY-MM" / "YYYY"
  modified      str            file mtime ISO string (used for "recent" sorting)
  extra         dict           any additional fields the extractor wants to surface
"""

from __future__ import annotations

import abc
import json
import os
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
    """Canonical representation of a single review entry.

    Fields with a default of ``None`` or ``[]`` are optional – extractors
    may leave them unset when the information is not available.
    """

    # ── mandatory ──────────────────────────────────────────────────────────
    path: str           # repo-relative path (forward slashes)
    title: str          # display title
    reviewer: str       # folder owner / pen-name

    # ── scoring ────────────────────────────────────────────────────────────
    score: int | None = None        # normalised numeric score
    score_raw: str = ""             # score as it appears in the UI
    score_system: str = ""          # "stars" | "decimal"
    sub_scores: dict = field(default_factory=dict)

    # ── classification ─────────────────────────────────────────────────────
    category: list[str] = field(default_factory=list)
    status: str = ""
    tags: list[str] = field(default_factory=list)

    # ── dates ──────────────────────────────────────────────────────────────
    date: str | None = None         # review date (YYYY-MM-DD / YYYY-MM / YYYY)
    modified: str = ""              # file mtime ISO string

    # ── catch-all for extractor-specific data ──────────────────────────────
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Helper utilities (available to all extractors)
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


# ---------------------------------------------------------------------------
# Abstract base extractor
# ---------------------------------------------------------------------------

class ReviewExtractor(abc.ABC):
    """Base class for folder-specific extraction strategies.

    Subclass this and implement :meth:`extract`.  Then register your
    subclass together with the folder(s) it handles in :func:`build_registry`.
    """

    # Folders (relative to ROOT, forward slashes) whose *.md files this
    # extractor is responsible for.  Set by the registry builder.
    folders: list[str] = []

    @abc.abstractmethod
    def extract(self, filepath: Path, rel_path: str) -> Review | None:
        """Parse *filepath* and return a :class:`Review`, or ``None`` to skip.

        Parameters
        ----------
        filepath:
            Absolute :class:`~pathlib.Path` to the markdown file.
        rel_path:
            Repo-relative path using forward slashes (ready for URLs /
            ``site_data.json``).
        """

    def should_include(self, filepath: Path, rel_path: str) -> bool:
        """Return ``True`` if this file should be processed at all.

        Override to add folder-specific filters on top of the global
        :func:`is_content_file` check (which is always applied first).
        """
        return True

    # ── shared helpers ──────────────────────────────────────────────────────

    @staticmethod
    def mtime_iso(filepath: Path) -> str:
        return datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()

    @staticmethod
    def read(filepath: Path) -> str | None:
        try:
            return filepath.read_text(encoding="utf-8")
        except Exception:
            return None


# ---------------------------------------------------------------------------
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  EXTRACTOR 1 – Aspark                                                   │
# │                                                                         │
# │  Folder: Aspark/小众变态测评/{游戏,二游与竞技,未完成}/                  │
# │  Format: no YAML frontmatter; star rating in filename;                  │
# │          Chinese title as first line; sub-scores on lines 2-5;         │
# │          review date + @author near the end.                            │
# └─────────────────────────────────────────────────────────────────────────┘

class AsparkExtractor(ReviewExtractor):
    """Extraction strategy for Aspark's review files.

    How to fill this in
    -------------------
    Implement the ``_extract_*`` helper methods below.  Each method receives
    the file content (and, where needed, the filepath) and should return
    the corresponding piece of metadata.  The :meth:`extract` driver calls
    them in order and assembles the final :class:`Review`.

    Already wired up
    ----------------
    * ``filepath`` / ``rel_path`` → ``Review.path``
    * ``Review.reviewer`` is always ``"Aspark"``
    * ``Review.score_system`` is always ``"stars"``
    * ``Review.modified`` comes from the file mtime
    * ``Review.category`` defaults to ``["游戏"]``
    * ``Review.status`` is inferred from the containing sub-folder name
    """

    def extract(self, filepath: Path, rel_path: str) -> Review | None:
        content = self.read(filepath)
        if content is None:
            return None

        # Only include reviews marked as finished with ---fin.---
        if "---fin.---" not in content:
            return None

        lines = [l.rstrip() for l in content.splitlines()]
        modified = self.mtime_iso(filepath)

        # Status: inferred from sub-folder (kept in data but not shown in UI)
        if "/游戏/" in rel_path or "/二游与竞技/" in rel_path:
            status = "已完成"
        elif "/未完成/" in rel_path:
            status = "未完成"
        else:
            status = ""

        return Review(
            path=rel_path,
            title=self._extract_title(filepath, lines),
            reviewer="Aspark",
            score=self._extract_score(filepath, lines, content),
            score_raw=self._extract_score_raw(filepath, lines, content),
            score_system="stars",
            sub_scores=self._extract_sub_scores(lines),
            category=["游戏"],
            status=status,
            tags=self._extract_tags(filepath, lines, content),
            date=self._extract_date(lines, content),
            modified=modified,
            extra=self._extract_extra(filepath, lines, content),
        )

    def _extract_title(self, filepath: Path, lines: list[str]) -> str:
        return lines[0].strip() if lines else filepath.stem

    def _extract_score(
        self, filepath: Path, lines: list[str], content: str
    ) -> int | None:
        m = re.search(r"(★+)", filepath.stem)
        return len(m.group(1)) if m else None

    def _extract_score_raw(
        self, filepath: Path, lines: list[str], content: str
    ) -> str:
        m = re.search(r"(★+)", filepath.stem)
        return m.group(1) if m else ""

    def _extract_sub_scores(self, lines: list[str]) -> dict:
        result = {}
        for line in lines[1:]:
            stripped = line.strip()
            if not stripped or re.match(r"^-{3,}", stripped):
                break
            m = re.match(r"^([^★]+)(★+)\s*$", stripped)
            if m:
                result[m.group(1).strip()] = len(m.group(2))
            else:
                break
        return result

    def _extract_tags(
        self, filepath: Path, lines: list[str], content: str
    ) -> list[str]:
        return []

    def _extract_date(self, lines: list[str], content: str) -> str | None:
        # Date appears near the end as ---YY.M.D (e.g. ---25.9.12 初版)
        m = re.search(r"---(\d{2})\.(\d{1,2})\.(\d{1,2})", content)
        if m:
            yy, mo, dd = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
            return f"20{yy}-{mo}-{dd}"
        return None

    def _extract_extra(
        self, filepath: Path, lines: list[str], content: str
    ) -> dict:
        extra = {}
        m = re.search(r"@(\S+)", content)
        if m:
            extra["author"] = m.group(1)
        return extra


# ---------------------------------------------------------------------------
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  EXTRACTOR 2 – Blind-Guess-Senior                                       │
# │                                                                         │
# │  Folders: Blind-Guess-Senior/Game/by-name/                              │
# │           Blind-Guess-Senior/Anime/by-year/                             │
# │           Blind-Guess-Senior/Book/by-author/                            │
# │  Format:  YAML frontmatter (status, score, year, month, category,       │
# │           tags, …); sub-scores in a fenced code block in the body.      │
# └─────────────────────────────────────────────────────────────────────────┘

class BlindGuessSeniorExtractor(ReviewExtractor):
    """Extraction strategy for Blind-Guess-Senior's review files.

    How to fill this in
    -------------------
    Same pattern as :class:`AsparkExtractor`: implement the ``_extract_*``
    helpers.  The YAML frontmatter is already parsed for you and passed as
    ``meta``; the body text (after the ``---`` block) is passed as ``body``.

    Already wired up
    ----------------
    * ``Review.path`` / ``Review.reviewer`` / ``Review.modified``
    * ``Review.score_system`` is always ``"decimal"``
    * ``Review.title`` comes from the filename (stars stripped)
    """

    # YAML keys consumed by the standard Review fields – not forwarded to ``extra``.
    _STANDARD_YAML_KEYS: frozenset[str] = frozenset(
        {"status", "score", "year", "month", "category", "tags"}
    )

    def extract(self, filepath: Path, rel_path: str) -> Review | None:
        content = self.read(filepath)
        if content is None:
            return None

        meta, body = parse_yaml_frontmatter(content)

        # Only include reviews marked as finished with ---fin.---
        if "---fin.---" not in body:
            return None

        title = re.sub(r"★.*$", "", filepath.stem).strip()
        modified = self.mtime_iso(filepath)

        return Review(
            path=rel_path,
            title=title,
            reviewer="Blind-Guess-Senior",
            score=self._extract_score(meta, body),
            score_raw=self._extract_score_raw(meta, body),
            score_system="decimal",
            sub_scores=self._extract_sub_scores(meta, body),
            category=self._extract_category(meta, body),
            status=self._extract_status(meta, body),
            tags=self._extract_tags(meta, body),
            date=self._extract_date(meta, body),
            modified=modified,
            extra=self._extract_extra(meta, body, filepath),
        )

    def _extract_score(self, meta: dict, body: str) -> int | None:
        return coerce_int(meta.get("score"))

    def _extract_score_raw(self, meta: dict, body: str) -> str:
        score = coerce_int(meta.get("score"))
        if score is None:
            return ""
        m = re.search(r"(\d+/10[^\n]*)", body)
        if m:
            return m.group(1).strip()
        return f"{score}/10"

    def _extract_sub_scores(self, meta: dict, body: str) -> dict:
        m = re.search(r"```\n(.*?)\n```", body, re.DOTALL)
        if not m:
            return {}
        result = {}
        for line in m.group(1).splitlines():
            line = line.strip()
            # "美术 2/4 Average" – scored entry
            lm = re.match(r"^(\S+)\s+(\d+)/(\d+)\s*(.*?)\s*$", line)
            if lm:
                result[lm.group(1)] = {
                    "value": int(lm.group(2)),
                    "max":   int(lm.group(3)),
                    "label": lm.group(4).strip(),
                }
                continue
            # "美术 /4" – placeholder (no value yet)
            lm2 = re.match(r"^(\S+)\s+/(\d+)\s*$", line)
            if lm2:
                result[lm2.group(1)] = {
                    "value": None,
                    "max":   int(lm2.group(2)),
                    "label": "",
                }
        return result

    def _extract_category(self, meta: dict, body: str) -> list[str]:
        return to_str_list(meta.get("category"))

    def _extract_status(self, meta: dict, body: str) -> str:
        return str(meta.get("status") or "").strip()

    def _extract_tags(self, meta: dict, body: str) -> list[str]:
        return to_str_list(meta.get("tags"))

    def _extract_date(self, meta: dict, body: str) -> str | None:
        year  = coerce_int(meta.get("year"))
        month = coerce_int(meta.get("month"))
        if year:
            return f"{year}-{month:02d}" if month and 1 <= month <= 12 else str(year)
        return None

    def _extract_extra(self, meta: dict, body: str, filepath: Path) -> dict:
        """Pass through all YAML fields not consumed by standard Review fields.

        Any new field added to the YAML frontmatter automatically appears in
        ``extra`` without requiring code changes here.
        """
        def _nonempty(v) -> bool:
            if v is None:
                return False
            if isinstance(v, (list, dict)):
                return len(v) > 0
            return str(v).strip() != ""

        return {
            k: v for k, v in meta.items()
            if k not in self._STANDARD_YAML_KEYS and _nonempty(v)
        }


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
# Registry: map folders → extractors
# ---------------------------------------------------------------------------

def build_registry() -> list[tuple[Path, ReviewExtractor]]:
    """Return ``[(folder_path, extractor_instance), …]``.

    Add new ``(folder, extractor)`` pairs here when new authors or
    content types are introduced.
    """
    return [
        # Aspark – completed game reviews
        (ROOT / "Aspark" / "小众变态测评" / "游戏",         AsparkExtractor()),
        # Aspark – gacha / competitive game reviews
        (ROOT / "Aspark" / "小众变态测评" / "二游与竞技",   AsparkExtractor()),
        # Aspark – in-progress reviews
        (ROOT / "Aspark" / "小众变态测评" / "未完成",        AsparkExtractor()),

        # Blind-Guess-Senior – games (alphabetical)
        (ROOT / "Blind-Guess-Senior" / "Game"  / "by-name",   BlindGuessSeniorExtractor()),
        # Blind-Guess-Senior – anime (by release year)
        (ROOT / "Blind-Guess-Senior" / "Anime" / "by-year",   BlindGuessSeniorExtractor()),
        # Blind-Guess-Senior – books (by author)
        (ROOT / "Blind-Guess-Senior" / "Book"  / "by-author", BlindGuessSeniorExtractor()),
    ]


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def scan(registry: list[tuple[Path, ReviewExtractor]]) -> list[dict]:
    """Walk every registered folder, extract metadata, return list of dicts."""
    seen: set[str] = set()
    results: list[dict] = []
    errors: list[str] = []

    for folder, extractor in registry:
        if not folder.exists():
            print(f"  [warn] folder not found: {folder}")
            continue

        for filepath in sorted(folder.rglob("*.md")):
            rel_path = filepath.relative_to(ROOT).as_posix()

            if not is_content_file(filepath, rel_path):
                continue
            if not extractor.should_include(filepath, rel_path):
                continue
            if rel_path in seen:
                continue  # already processed by an earlier folder entry
            seen.add(rel_path)

            try:
                review = extractor.extract(filepath, rel_path)
            except NotImplementedError:
                # Extractor stub not yet filled in — skip silently
                continue
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

    registry = build_registry()
    reviews = scan(registry)

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
