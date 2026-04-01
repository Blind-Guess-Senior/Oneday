#!/usr/bin/env python3
"""Auto-generate _sidebar.md for Docsify from the repository file structure."""

import os
import re
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Lines that begin with these substrings are rating/score lines, not titles
_RATING_PREFIXES = ("玩法★", "叙事★", "美术★", "音乐★", "玩法N", "叙事N", "美术N", "音乐N",
                    "★", "```")


def _filename_title(filepath):
    """Derive a clean title from the filename by stripping star ratings and suffixes."""
    stem = os.path.splitext(os.path.basename(filepath))[0]
    # Remove everything from the first ★ onward (e.g. "明日方舟★★" → "明日方舟")
    stem = re.sub(r"★.*$", "", stem).strip()
    # Remove trailing parenthetical notes (e.g. "（未完成）")
    stem = re.sub(r"[（(].*[）)]$", "", stem).strip()
    return stem or os.path.splitext(os.path.basename(filepath))[0]


_ORGANIZED_DIRS = ("by-name", "by-year", "by-series", "by-author")


def get_file_title(filepath):
    """Extract a display title from a Markdown file.

    For files inside ``by-name/``, ``by-year/``, ``by-series/``, or ``by-author/``
    directories, the filename is the authoritative title.  For other files,
    try to find an explicit ``# Heading``, then a clean plain-text first line,
    and fall back to the filename.
    """
    # In organized directories the filename IS the title
    if any(f"/{d}/" in filepath.replace(os.sep, "/") for d in _ORGANIZED_DIRS):
        return _filename_title(filepath)

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()
        start = 0
        if lines and lines[0].strip() == "---":
            for i, line in enumerate(lines[1:], 1):
                if line.strip() == "---":
                    start = i + 1
                    break
        for line in lines[start:start + 5]:
            stripped = line.strip()
            if stripped.startswith("```"):
                break  # Don't look inside code blocks for titles
            if stripped.startswith("# "):
                return stripped[2:].strip()
            # Aspark-style plain title (first non-empty, non-rating line)
            if stripped and not any(stripped.startswith(p) for p in _RATING_PREFIXES):
                if not stripped.startswith("-") and not stripped.startswith("*"):
                    # Reject lines that look like metadata: dates (2024/2025年, 2024.xx),
                    # score fractions (3/4), or URLs – these are not titles.
                    if not re.search(r"\d{4}[./年]|\d/\d|http", stripped):
                        return stripped
    except Exception:
        pass
    return _filename_title(filepath)


def _encode_rel(filepath):
    """Return a URL-safe relative path for use in Docsify sidebar links.

    Each path segment is percent-encoded individually (``safe=""``), and then
    the segments are re-joined with ``/`` so the separators stay un-encoded.
    """
    rel = os.path.relpath(filepath, ROOT).replace(os.sep, "/")
    return "/".join(quote(part, safe="") for part in rel.split("/"))


def make_link(filepath, indent=0):
    """Return a Docsify sidebar list item string for a file."""
    _MAX_TITLE_LENGTH = 60
    _TRUNCATE_AT = 57
    title = get_file_title(filepath)
    if len(title) > _MAX_TITLE_LENGTH:
        title = title[:_TRUNCATE_AT] + "…"
    return f"{'  ' * indent}- [{title}]({_encode_rel(filepath)})\n"


def list_dir_files(directory, indent, sidebar, max_depth=1, current_depth=0):
    """Append sidebar entries for all .md files in a directory (non-recursive by default)."""
    if not os.path.isdir(directory):
        return
    entries = sorted(os.scandir(directory), key=lambda e: (e.is_dir(), e.name))
    for entry in entries:
        if entry.name.startswith(".") or entry.name.startswith("_"):
            continue
        if entry.is_file() and entry.name.endswith(".md"):
            sidebar.append(make_link(entry.path, indent))
        elif entry.is_dir() and current_depth < max_depth:
            sidebar.append(f"{'  ' * indent}- **{entry.name}**\n")
            list_dir_files(entry.path, indent + 1, sidebar, max_depth, current_depth + 1)


def main():
    sidebar = [
        "- [首页](Readme.md)\n",
        "- [网站部署说明](网站部署说明.md)\n",
        "\n",
    ]

    bgs_dir = os.path.join(ROOT, "Blind-Guess-Senior")
    aspark_review_dir = os.path.join(ROOT, "Aspark", "小众变态测评")

    # ── 游戏 ──────────────────────────────────────────────────────────────────
    sidebar.append("- **游戏**\n")

    # Aspark game reviews
    if os.path.exists(aspark_review_dir):
        sidebar.append("  - **Aspark 的评测**\n")
        standards = os.path.join(aspark_review_dir, "★评测标准食用与使用说明书✰.md")
        if os.path.exists(standards):
            sidebar.append(make_link(standards, indent=2))

        games_dir = os.path.join(aspark_review_dir, "游戏")
        if os.path.exists(games_dir):
            sidebar.append("    - **完成评测 · 游戏**\n")
            list_dir_files(games_dir, indent=3, sidebar=sidebar)

        gacha_dir = os.path.join(aspark_review_dir, "二游与竞技")
        if os.path.exists(gacha_dir):
            sidebar.append("    - **完成评测 · 二游与竞技**\n")
            list_dir_files(gacha_dir, indent=3, sidebar=sidebar)

        unfinished_dir = os.path.join(aspark_review_dir, "未完成")
        if os.path.exists(unfinished_dir):
            sidebar.append("    - **进行中评测**\n")
            list_dir_files(unfinished_dir, indent=3, sidebar=sidebar)

    # BGS game reviews
    if os.path.exists(bgs_dir):
        game_dir = os.path.join(bgs_dir, "Game")
        if os.path.exists(game_dir):
            sidebar.append("  - **Blind-Guess-Senior 的评测**\n")
            # Standards docs
            for fname in sorted(os.listdir(game_dir)):
                fpath = os.path.join(game_dir, fname)
                if os.path.isfile(fpath) and fname.endswith(".md"):
                    sidebar.append(make_link(fpath, indent=2))
            # Reviews by name
            by_name = os.path.join(game_dir, "by-name")
            if os.path.exists(by_name):
                sidebar.append("    - **游戏评测（按名称）**\n")
                list_dir_files(by_name, indent=3, sidebar=sidebar, max_depth=2)

    sidebar.append("\n")

    # ── 动漫 ──────────────────────────────────────────────────────────────────
    sidebar.append("- **动漫**\n")

    if os.path.exists(bgs_dir):
        anime_dir = os.path.join(bgs_dir, "Anime")
        if os.path.exists(anime_dir):
            sidebar.append("  - **Blind-Guess-Senior 的评测**\n")
            for fname in sorted(os.listdir(anime_dir)):
                fpath = os.path.join(anime_dir, fname)
                if os.path.isfile(fpath) and fname.endswith(".md"):
                    sidebar.append(make_link(fpath, indent=2))
            by_year = os.path.join(anime_dir, "by-year")
            if os.path.exists(by_year):
                sidebar.append("    - **动漫评测（按年份）**\n")
                list_dir_files(by_year, indent=3, sidebar=sidebar, max_depth=2)

    sidebar.append("\n")

    # ── 书籍 ──────────────────────────────────────────────────────────────────
    sidebar.append("- **书籍**\n")

    if os.path.exists(bgs_dir):
        book_dir = os.path.join(bgs_dir, "Book")
        if os.path.exists(book_dir):
            sidebar.append("  - **Blind-Guess-Senior 的评测**\n")
            by_author = os.path.join(book_dir, "by-author")
            if os.path.exists(by_author):
                sidebar.append("    - **书评（按作者）**\n")
                list_dir_files(by_author, indent=3, sidebar=sidebar, max_depth=2)

    output = os.path.join(ROOT, "_sidebar.md")
    with open(output, "w", encoding="utf-8") as f:
        f.writelines(sidebar)
    print(f"Generated {output} ({len(sidebar)} lines)")


if __name__ == "__main__":
    main()
