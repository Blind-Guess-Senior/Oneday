

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/** 分类配置根：`src/config/by_category_id/<分类 id>/{tags,title_names,aka}.toml`。 */
const CATEGORY_CONFIG_ROOT = path.join(PROJECT_ROOT, "src", "config", "by_category_id");

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
  /** 分类 id → 额外元信息。 */
  metadataMaps: Record<string, MetadataMapEntry[]>;
}

/** `src/config/by_category_id/<分类 id>/` 下三个文件的内容。 */
export interface CategoryFiles {
  /** 别名 → 主名。 */
  aliases: Map<string, string>;
  /** rows[0] 就是第 1 排。 */
  rows: string[][];
  /** `[tag_rows] 0`：只声明、不进筛选区和搜索的 tag。 */
  row0: string[];
  /** 文件名里可能出现的写法 → entry id。 */
  titleNames: Map<string, string>;
  /** entry id → 别名。 */
  aka: Map<string, string[]>;
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

  // 分类配置目录按分类 id 命名，对不上任何 id 的目录是死配置
  const knownIds = new Set(configs.flatMap((config) => config.categories.map((category) => category.id)));
  for (const id of listCategoryConfigIds()) {
    if (!knownIds.has(id)) note(`src/config/by_category_id/${id}`, "没有作者声明这个分类 id，目录里的配置不会生效");
  }

  return configs.sort((a, b) => a.reviewer.localeCompare(b.reviewer));
}

/** `src/config/by_category_id/` 下的目录名 = 已经配过的分类 id。 */
export function listCategoryConfigIds(): string[] {
  if (!existsSync(CATEGORY_CONFIG_ROOT)) return [];
  return readdirSync(CATEGORY_CONFIG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function readCategoryFile(categoryId: string, name: string): Record<string, unknown> {
  const file = path.join(CATEGORY_CONFIG_ROOT, categoryId, name);
  if (!existsSync(file)) return {};
  return asRecord(parseToml(readFileSync(file, "utf8"))) ?? {};
}

const categoryFilesCache = new Map<string, CategoryFiles>();

/**
 * 一个分类的全站配置。三个文件都可以缺，缺了当空。
 *
 * `tags.toml` 的 `[tag_rows]` 用数字键：`0` 是彻底不进站点的第 0 排，`1..N` 是筛选区里的排。
 * 每一项要么直接写 tag 名，要么写 `{ "主名" = ["别名", …] }`（别名列表里再写一遍主名也无妨）。
 * `title_names.toml` 左边是 entry id，右边是文件名里可能出现的写法，一多对。
 */
export function loadCategoryFiles(categoryId: string): CategoryFiles {
  const cached = categoryFilesCache.get(categoryId);
  if (cached) return cached;

  const aliases = new Map<string, string>();
  const rows: string[][] = [];
  let row0: string[] = [];

  const rawRows = asRecord(readCategoryFile(categoryId, "tags.toml")["tag_rows"]) ?? {};
  const rowKeys = Object.keys(rawRows).sort((a, b) => Number(a) - Number(b));
  for (const rowKey of rowKeys) {
    const tags: string[] = [];
    for (const entry of Array.isArray(rawRows[rowKey]) ? rawRows[rowKey] : []) {
      if (typeof entry === "string") {
        const name = entry.trim();
        if (name) tags.push(name);
        continue;
      }
      for (const [key, spellings] of Object.entries(asRecord(entry) ?? {})) {
        const name = key.trim();
        if (!name) continue;
        tags.push(name);
        for (const spelling of asStringArray(spellings)) {
          const alias = spelling.trim();
          if (alias && alias !== name) aliases.set(alias, name);
        }
      }
    }
    if (rowKey === "0") row0 = tags;
    else rows.push(tags);
  }

  const titleNames = new Map<string, string>();
  const rawTitles = asRecord(readCategoryFile(categoryId, "title_names.toml")["title_names"]) ?? {};
  for (const [id, variants] of Object.entries(rawTitles)) {
    const entryId = asString(id);
    if (!entryId) continue;
    for (const variant of asStringArray(variants)) titleNames.set(variant, entryId);
  }

  const aka = new Map<string, string[]>();
  const rawAka = asRecord(readCategoryFile(categoryId, "aka.toml")["aka"]) ?? {};
  for (const [id, names] of Object.entries(rawAka)) {
    const entryId = asString(id);
    const list = asStringArray(names);
    if (entryId && list.length) aka.set(entryId, list);
  }

  const files: CategoryFiles = { aliases, rows, row0, titleNames, aka };
  categoryFilesCache.set(categoryId, files);
  return files;
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
