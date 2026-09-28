

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { note } from "./report";
import { toSlug } from "./site";

function findProjectRoot(): string {
  const candidates = [process.cwd()];
  try {
    candidates.push(fileURLToPath(new URL("../../", import.meta.url)));
  } catch {
    // import.meta.url 不可用时忽略
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "src", "config", "site.toml"))) return candidate;
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();

/** 内容根（Oneday/src/content/），同时也是 Obsidian vault 根。 */
export const CONTENT_ROOT = path.join(PROJECT_ROOT, "src", "content");

const TAGS_CONFIG_PATH = path.join(PROJECT_ROOT, "src", "config", "tags.toml");
const TITLE_NAMES_CONFIG_PATH = path.join(PROJECT_ROOT, "src", "config", "title_names.toml");
const AKA_CONFIG_PATH = path.join(PROJECT_ROOT, "src", "config", "aka.toml");

export interface CategoryConfig {
  /** 显示用的分类名，例如「游戏」。 */
  name: string;
  /** URL 里用的分类段，例如「Game」。和显示名分开，URL 才能保持 ASCII。 */
  id: string;
  /** 评测的 glob，相对作者目录。`**` 匹配零层或多层目录。 */
  include: string[];
  /** 评分标准的 glob，相对作者目录。没有标准就留空。 */
  standard: string[];
}

export interface MetadataMapEntry {
  /** 取自 frontmatter 的哪些键。多个键按 separator 拼接。 */
  keys: string[];
  /** 显示用的标签名。 */
  label: string;
  separator: string;
}

export interface ReviewerConfig {
  /** 作者目录名，同时也是 URL 里的 author 段。 */
  reviewer: string;
  /** 作者目录绝对路径。 */
  dir: string;
  categories: CategoryConfig[];
  /**
   * 仅评分评测的收录条件。`null` 表示没有 `[score_only]` 表 → 全部收录。
   * 否则任一 (key, value) 命中即收录。
   */
  scoreOnly: Array<[string, string]> | null;
  scoreOrder: string[];
  scoreTiers: string[][];
  metadataMaps: Record<string, MetadataMapEntry[]>;
}

export interface TagConfig {
  /** 别名 → 主名。 */
  aliases: Map<string, string>;
  /** rows[0] 就是第 1 排；每个元素是「分类名 → 有序 tag 列表」。 */
  rows: Array<Record<string, string[]>>;
}

function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.trim() !== "");
  }
  const single = String(value).trim();
  return single ? [single] : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeReviewerConfig(reviewer: string, dir: string, raw: Record<string, unknown>): ReviewerConfig {
  const categories: CategoryConfig[] = [];
  for (const item of Array.isArray(raw["categories"]) ? raw["categories"] : []) {
    const record = asRecord(item);
    if (!record) continue;
    const name = asString(record["name"]);
    const include = asStringArray(record["include"]);
    if (!name || include.length === 0) continue;
    const declaredId = asString(record["id"]);
    if (!declaredId) {
      note(
        `src/content/${reviewer}/reviewer_config.toml`,
        `分类「${name}」没写 id，URL 段回落到「${toSlug(name)}」（建议显式写一个 ASCII 名）`,
      );
    }
    categories.push({
      name,
      id: declaredId || toSlug(name),
      include,
      standard: asStringArray(record["standard"]),
    });
  }

  let scoreOnly: Array<[string, string]> | null = null;
  const rawScoreOnly = asRecord(raw["score_only"]);
  if (rawScoreOnly) {
    scoreOnly = [];
    for (const [key, values] of Object.entries(rawScoreOnly)) {
      for (const value of asStringArray(values)) scoreOnly.push([key, value]);
    }
  }

  const rawScore = asRecord(raw["score"]) ?? {};
  const scoreOrder = asStringArray(rawScore["order"]);
  const scoreTiers: string[][] = [];
  for (const tier of Array.isArray(rawScore["tiers"]) ? rawScore["tiers"] : []) {
    const record = asRecord(tier);
    if (!record) continue;
    const values = asStringArray(record["values"]);
    if (values.length) scoreTiers.push(values);
  }

  const metadataMaps: Record<string, MetadataMapEntry[]> = {};
  const rawMaps = asRecord(raw["metadata_maps"]);
  if (rawMaps) {
    for (const [category, entries] of Object.entries(rawMaps)) {
      if (!Array.isArray(entries)) continue;
      const list: MetadataMapEntry[] = [];
      for (const entry of entries) {
        const record = asRecord(entry);
        if (!record) continue;
        const keys = asStringArray(record["keys"]);
        const label = asString(record["label"]);
        if (!keys.length || !label) continue;
        const separator = record["separator"] === undefined ? "." : String(record["separator"]);
        list.push({ keys, label, separator });
      }
      if (list.length) metadataMaps[category] = list;
    }
  }

  return { reviewer, dir, categories, scoreOnly, scoreOrder, scoreTiers, metadataMaps };
}

/**
 * 扫描内容根，返回所有作者配置。
 *
 * 「这个目录是作者目录」的唯一判据就是它含有 `reviewer_config.toml`——
 * 这条约定要保住：新增作者 = 新增一个带这个文件的文件夹，不用碰任何代码。
 */
export async function readReviewerConfigs(): Promise<ReviewerConfig[]> {
  const entries = await readdir(CONTENT_ROOT, { withFileTypes: true });
  const configs: ReviewerConfig[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(CONTENT_ROOT, entry.name);
    const configPath = path.join(dir, "reviewer_config.toml");
    if (!existsSync(configPath)) continue;
    const raw = asRecord(parseToml(readFileSync(configPath, "utf8")));
    if (!raw) continue;
    configs.push(normalizeReviewerConfig(entry.name, dir, raw));
  }
  return configs.sort((a, b) => a.reviewer.localeCompare(b.reviewer));
}

let tagConfigCache: TagConfig | null = null;

export function loadTagConfig(): TagConfig {
  if (tagConfigCache) return tagConfigCache;

  const aliases = new Map<string, string>();
  const rows: Array<Record<string, string[]>> = [];

  const raw = asRecord(parseToml(readFileSync(TAGS_CONFIG_PATH, "utf8"))) ?? {};
  const rawRows = asRecord(raw["tag_rows"]) ?? {};

  const rowKeys = Object.keys(rawRows).sort((a, b) => Number(a) - Number(b));
  for (const rowKey of rowKeys) {
    const rowRecord = asRecord(rawRows[rowKey]);
    if (!rowRecord) continue;
    const row: Record<string, string[]> = {};
    for (const [category, expressions] of Object.entries(rowRecord)) {
      const tags: string[] = [];
      for (const expression of asStringArray(expressions)) {
        const parts = expression.split("+").map((p) => p.trim()).filter(Boolean);
        const canonical = parts[0];
        if (!canonical) continue;
        for (const alias of parts.slice(1)) aliases.set(alias, canonical);
        tags.push(canonical);
      }
      row[category] = tags;
    }
    rows.push(row);
  }

  tagConfigCache = { aliases, rows };
  return tagConfigCache;
}

let titleNamesCache: Map<string, string> | null = null;

/**
 * title_names.toml 的 `[title_names]`：显示标题 → 文件里可能出现的名字（多对一）。
 * 返回反过来的索引：文件里的名字 → 显示标题。
 *
 * 文件名不能带 `/ \ : * ? " < > |`，只能用替代字符写，所以需要这一层映射。
 */
export function loadTitleNames(): Map<string, string> {
  if (titleNamesCache) return titleNamesCache;
  const raw = asRecord(parseToml(readFileSync(TITLE_NAMES_CONFIG_PATH, "utf8"))) ?? {};
  const table = asRecord(raw["title_names"]) ?? {};
  const names = new Map<string, string>();
  for (const [title, aliases] of Object.entries(table)) {
    const display = asString(title);
    if (!display) continue;
    for (const name of asStringArray(aliases)) names.set(name, display);
  }
  titleNamesCache = names;
  return titleNamesCache;
}

let akaCache: Map<string, Map<string, string[]>> | null = null;

/**
 * aka.toml 的 `[aka.<分类>]`：显示标题 → 别名列表。
 * 标题是过完 title_names 的显示标题，分类用 reviewer_config.toml 里的分类名。
 */
export function loadAka(): Map<string, Map<string, string[]>> {
  if (akaCache) return akaCache;
  const raw = asRecord(parseToml(readFileSync(AKA_CONFIG_PATH, "utf8"))) ?? {};
  const byCategory = new Map<string, Map<string, string[]>>();
  for (const [category, titles] of Object.entries(asRecord(raw["aka"]) ?? {})) {
    const entries = new Map<string, string[]>();
    for (const [title, aliases] of Object.entries(asRecord(titles) ?? {})) {
      const list = asStringArray(aliases);
      if (title && list.length) entries.set(title, list);
    }
    if (entries.size) byCategory.set(category, entries);
  }
  akaCache = byCategory;
  return akaCache;
}

export interface GitDates {
  /** 这篇内容最早一次提交 = 发布。 */
  published: string;
  /** 最近一次提交 = 更新。 */
  updated: string;
}

const EMPTY_DATES: GitDates = { published: "", updated: "" };
const memoryDates = new Map<string, GitDates>();

/**
 * 逐文件的日期按 HEAD 缓存到磁盘。
 *
 * 为什么要缓存：vault.ts / index-data.ts / 插件 / 各个页面会被 Astro 打成好几个
 * 模块实例，模块内的 memo 不跨实例，实测一次构建里同一个文件会被问 4 遍
 * （1434 次 git 调用，构建从 3 秒变 31 秒）。缓存的键是 HEAD —— 日期只取决于
 * 提交历史，工作区改没改不影响，所以 HEAD 没变就可以直接复用。
 */
const DATES_CACHE = path.join(PROJECT_ROOT, "node_modules", ".cache", "oneday-git-dates.json");

process.once("exit", () => {
  if (pendingSaves > 0) saveDiskDates();
});

let diskDates: Record<string, GitDates> | null = null;
let diskHead = "";

function loadDiskDates(): Record<string, GitDates> {
  if (diskDates) return diskDates;
  diskDates = {};
  try {
    diskHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
    const parsed = JSON.parse(readFileSync(DATES_CACHE, "utf8")) as {
      head?: string;
      dates?: Record<string, GitDates>;
    };
    if (parsed.head === diskHead && parsed.dates) diskDates = parsed.dates;
  } catch {
    // 没有缓存（或没有 git）：照常逐文件算
  }
  return diskDates;
}

let pendingSaves = 0;

/** 攒够一批再落盘：每算一条就写一次 JSON 会让冷构建多花十几秒。 */
function saveDiskDates(): void {
  pendingSaves = 0;
  try {
    mkdirSync(path.dirname(DATES_CACHE), { recursive: true });
    writeFileSync(DATES_CACHE, JSON.stringify({ head: diskHead, dates: diskDates }));
  } catch {
    // 写不进去不影响构建，下次重算而已
  }
}

function scheduleSave(): void {
  pendingSaves += 1;
  if (pendingSaves >= 32) saveDiskDates();
}

/**
 * 某个文件的发布/更新日期。
 *
 * 命令跟参考站 blind-guess-senior.github.io 一致：`git log --follow`。
 * 必须带 `--follow` —— vault 备份提交会把文件在目录之间反复搬（历史上有近两千条
 * 重命名/复制），不带的话只能看到搬过来之后的提交，发布日期会变成搬动那天。
 * `git log` 是新到旧，所以第一行是更新、最后一行是发布。
 */
function computeGitDates(relPath: string): GitDates {
  try {
    const output = execFileSync("git", ["log", "--follow", "--pretty=format:%ct", "--", relPath], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const stamps = output.split("\n").map((line) => line.trim()).filter(Boolean);
    const newest = stamps[0];
    const oldest = stamps[stamps.length - 1];
    if (!newest || !oldest) return EMPTY_DATES;
    const iso = (stamp: string) => new Date(Number(stamp) * 1000).toISOString();
    return { published: iso(oldest), updated: iso(newest) };
  } catch {
    // 没有 git 或没有历史：两个日期都留空，页面照样能构建
    return EMPTY_DATES;
  }
}

export function gitDatesFor(relPath: string): GitDates {
  const remembered = memoryDates.get(relPath);
  if (remembered) return remembered;

  const disk = loadDiskDates();
  const cached = disk[relPath];
  if (cached) {
    memoryDates.set(relPath, cached);
    return cached;
  }

  const dates = computeGitDates(relPath);
  memoryDates.set(relPath, dates);
  disk[relPath] = dates;
  scheduleSave();
  return dates;
}
