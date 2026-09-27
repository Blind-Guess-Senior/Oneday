/**
 * 全站/作者配置的读取。
 *
 * 两个来源：
 *   - `src/config/site.toml`            全站配置（tag 分排与别名）
 *   - `src/content/<作者>/reviewer_config.toml`  作者配置（什么算评测）
 *
 * 设计原则：**正面清单**。作者配置里 include 命中的文件才是「评测候选」，
 * 没被任何 include 命中的文件一律不存在——不需要任何全局文件名黑名单。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

/** 仓库根（Oneday/）。 */
export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** 内容根（Oneday/src/content/），同时也是 Obsidian vault 根。 */
export const CONTENT_ROOT = fileURLToPath(new URL("../content/", import.meta.url));

const SITE_CONFIG_PATH = fileURLToPath(new URL("../config/site.toml", import.meta.url));

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CategoryConfig {
  /** 显示用的分类名，例如「游戏」。 */
  name: string;
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

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 作者配置
// ---------------------------------------------------------------------------

function normalizeReviewerConfig(reviewer: string, dir: string, raw: Record<string, unknown>): ReviewerConfig {
  const categories: CategoryConfig[] = [];
  for (const item of Array.isArray(raw["categories"]) ? raw["categories"] : []) {
    const record = asRecord(item);
    if (!record) continue;
    const name = asString(record["name"]);
    const include = asStringArray(record["include"]);
    if (!name || include.length === 0) continue;
    categories.push({ name, include, standard: asStringArray(record["standard"]) });
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

// ---------------------------------------------------------------------------
// 全站配置（tag 分排）
// ---------------------------------------------------------------------------

let tagConfigCache: TagConfig | null = null;

/**
 * 读 `src/config/site.toml`。
 *
 * `[tag_rows.N]` 的语义是「第 N 排」，每个分类一张有序列表：
 *   - 数组顺序 = 该分类下 tag 的显示顺序
 *   - 同一个 tag 在不同分类下可以落在不同排（例如「战斗」动漫第 2 排、书籍第 3 排）
 *   - `"主名+别名"` 表示别名并入主名
 */
export function loadTagConfig(): TagConfig {
  if (tagConfigCache) return tagConfigCache;

  const aliases = new Map<string, string>();
  const rows: Array<Record<string, string[]>> = [];

  const raw = asRecord(parseToml(readFileSync(SITE_CONFIG_PATH, "utf8"))) ?? {};
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

// ---------------------------------------------------------------------------
// git 提交时间
// ---------------------------------------------------------------------------

let gitDatesCache: Map<string, string> | null = null;

/**
 * 一次 `git log` 拿到所有文件的最近提交时间（仓库相对路径 → ISO 字符串）。
 *
 * 旧 Python 对每个文件跑一次 `git log -1`（约 1300 次子进程），这里改成一次。
 * git log 是新→旧，所以首次出现的就是最近一次提交。合并提交没有文件列表，跳过即可。
 * CI 里必须 `fetch-depth: 0`。
 */
export function loadGitDates(): Map<string, string> {
  if (gitDatesCache) return gitDatesCache;

  const dates = new Map<string, string>();
  try {
    const output = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "log", "--pretty=format:%ct", "--name-only"],
      { cwd: PROJECT_ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    );
    let timestamp = "";
    for (const line of output.split("\n")) {
      const value = line.trim();
      if (!value) continue;
      if (/^\d{9,11}$/.test(value)) {
        timestamp = value;
        continue;
      }
      if (timestamp && !dates.has(value)) {
        dates.set(value, new Date(Number(timestamp) * 1000).toISOString());
      }
    }
  } catch {
    // 没有 git 或没有历史：modified 全部留空，页面照样能构建
  }

  gitDatesCache = dates;
  return dates;
}
