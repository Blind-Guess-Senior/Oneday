/**
 * 内容仓库的扫描与索引。
 *
 * 这里不依赖任何 Astro API，纯 node + 配置：loader 和 markdown 插件都从这里取数据。
 * 所有结果都带 memo，构建期内每个进程只扫一次盘。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CONTENT_ROOT,
  gitDatesFor,
  loadTagConfig,
  readReviewerConfigs,
  type CategoryConfig,
  type ReviewerConfig,
} from "./config";
import { note } from "./report";
import { toSlug } from "./site";

export interface ReviewRecord {
  /** collection entry id，同时也是 URL 的 `/<author>/<slug>/` 两段。 */
  id: string;
  reviewer: string;
  slug: string;
  title: string;
  /** 绝对路径。 */
  filePath: string;
  /** 仓库相对路径，例如 `src/content/Aspark/…/xxx.md`。 */
  relPath: string;
  /** 内容根相对路径，例如 `Aspark/…/xxx.md`。 */
  contentRel: string;
  category: string[];
  data: Record<string, unknown>;
  /** 已剥掉 frontmatter 与 sub_scores 代码块的正文。 */
  body: string;
  subScores: string[];
}

export interface StandardRecord {
  id: string;
  reviewer: string;
  slug: string;
  title: string;
  category: string;
  filePath: string;
  relPath: string;
  contentRel: string;
  published: string;
  modified: string;
}

export interface LinkIndex {
  /** 内容根相对路径（不含 .md）→ 评测。只此一张表，没有按文件名/标题的兜底。 */
  byPath: Map<string, ReviewRecord>;
}

let fileListCache: string[] | null = null;

/** 内容根下的全部文件，POSIX 相对路径，跳过点开头的目录。 */
export async function listFiles(): Promise<string[]> {
  if (fileListCache) return fileListCache;
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk(CONTENT_ROOT, "");
  fileListCache = files;
  return files;
}

function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(source.replace(/^\uFEFF/, ""));
  if (!match) return { meta: {}, body: source };
  let meta: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    }
  } catch {
    meta = {};
  }
  return { meta, body: source.slice(match[0].length).replace(/^\r?\n/, "") };
}

/** 正文第一个 fenced code block —— 按约定它是 sub_scores。 */
const FIRST_CODE_BLOCK = /^```[^\n]*\r?\n([\s\S]*?)\r?\n```[ \t]*(\r?\n)?/m;

function extractSubScores(body: string): { lines: string[]; body: string } {
  const match = FIRST_CODE_BLOCK.exec(body);
  if (!match) return { lines: [], body };
  const lines = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stripped = body.slice(0, match.index) + body.slice(match.index + match[0].length);
  return { lines, body: stripped };
}

/**
 * frontmatter 里显式写的更新日期（`updated: 2026-03-08`），没写或写坏了返回空串。
 * 理由：重构批量改写过内容文件，提交时间不再能反映更新日期。发布日期不受影响。
 */
function explicitUpdated(value: unknown): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(NaN);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function toStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && String(v).trim() !== "").map(String);
  const single = String(value).trim();
  return single ? [single] : [];
}

function titleFor(authorRel: string, reviewer: string, meta: Record<string, unknown>): string {
  const explicit = typeof meta["title"] === "string" ? meta["title"].trim() : "";
  if (explicit) return explicit;
  const stem = path.basename(authorRel).replace(/\.md$/i, "").trim();
  // Aspark 的评分（★）会出现在文件名末尾，不进标题。其余作者原样使用文件名。
  return reviewer.toLowerCase() === "aspark" ? stem.replace(/★+$/, "").trim() : stem;
}

function slugFor(title: string, authorRel: string, contentRel: string): string {
  const fromTitle = toSlug(title);
  if (fromTitle) return fromTitle;
  const fromFile = toSlug(path.basename(authorRel).replace(/\.md$/i, ""));
  if (fromFile) return fromFile;
  const hash = createHash("sha1").update(contentRel).digest("hex").slice(0, 8);
  note(contentRel, `标题无法生成 slug，已回落到 entry-${hash}`);
  return `entry-${hash}`;
}

/**
 * 一个文件属于哪些分类。命中任意一个 include glob 就算。
 * **没有任何 include 命中 = 这个文件不存在**，这是「正面清单」的全部含义。
 */
function categoriesFor(config: ReviewerConfig, authorRel: string): CategoryConfig[] {
  return config.categories.filter((category) =>
    category.include.some((pattern) => path.matchesGlob(authorRel, pattern)),
  );
}

function matchesScoreOnly(meta: Record<string, unknown>, rules: Array<[string, string]> | null): boolean {
  if (rules === null) return true;
  for (const [key, value] of rules) {
    const actual = meta[key];
    if (actual !== undefined && actual !== null && String(actual).trim() === value) return true;
  }
  return false;
}

async function buildReviews(): Promise<ReviewRecord[]> {
  const [configs, files] = await Promise.all([readReviewerConfigs(), listFiles()]);
  const tagConfig = loadTagConfig();
  const records: ReviewRecord[] = [];

  for (const config of configs) {
    const prefix = `${config.reviewer}/`;
    for (const contentRel of files) {
      if (!contentRel.startsWith(prefix) || !isMarkdown(contentRel)) continue;
      const authorRel = contentRel.slice(prefix.length);

      const matched = categoriesFor(config, authorRel);
      if (matched.length === 0) continue;
      const category = matched.map((entry) => entry.name);

      const filePath = path.join(CONTENT_ROOT, contentRel);
      const raw = await readFile(filePath, "utf8");
      const { meta, body } = splitFrontmatter(raw);

      const completed = meta["completed"] === true;
      if (!completed && !matchesScoreOnly(meta, config.scoreOnly)) continue;

      const title = titleFor(authorRel, config.reviewer, meta);
      const slug = slugFor(title, authorRel, contentRel);
      const primaryCategory = matched[0];
      const id = `${config.reviewer}/${primaryCategory?.idName ?? ""}/${slug}`;

      const scoreValue = meta["score"];
      const scoreRaw = scoreValue === undefined || scoreValue === null ? "" : String(scoreValue).trim();

      const rawTags = toStringList(meta["tags"]);
      const seenTags = new Set<string>();
      const tags: string[] = [];
      for (const tag of rawTags) {
        const canonical = tagConfig.aliases.get(tag) ?? tag;
        if (seenTags.has(canonical)) continue;
        seenTags.add(canonical);
        tags.push(canonical);
      }

      const subScores = extractSubScores(body);

      const relPath = path.posix.join("src/content", contentRel);
      const dates = gitDatesFor(relPath);

      const rankIndex = config.scoreOrder.indexOf(scoreRaw);
      const tierIndex = config.scoreTiers.findIndex((tier) => tier.includes(scoreRaw));

      const data: Record<string, unknown> = {
        ...meta,
        path: contentRel,
        reviewer: config.reviewer,
        category,
        title,
        score_raw: scoreRaw,
        score_rank: rankIndex === -1 ? null : rankIndex + 1,
        score_tier: tierIndex === -1 ? null : tierIndex + 1,
        tags,
        aka: toStringList(meta["aka"]),
        sub_scores: subScores.lines,
        score_only: !completed,
        published: dates.published,
        modified: explicitUpdated(meta["updated"]) || dates.updated,
      };

      records.push({
        id,
        reviewer: config.reviewer,
        slug,
        title,
        filePath,
        relPath,
        contentRel,
        category,
        data,
        body: subScores.body,
        subScores: subScores.lines,
      });
    }
  }

  detectIdCollisions(records);
  return records;
}

function detectIdCollisions(records: ReviewRecord[]): void {
  const groups = new Map<string, ReviewRecord[]>();
  for (const record of records) {
    const list = groups.get(record.id);
    if (list) list.push(record);
    else groups.set(record.id, [record]);
  }

  const collisions = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length === 0) return;

  const detail = collisions
    .map(([id, list]) => `  ${id}\n${list.map((r) => `      ${r.relPath}`).join("\n")}`)
    .join("\n");

  if (process.env["ONEDAY_ALLOW_SLUG_COLLISION"] === "1") {
    for (const [id, list] of collisions) {
      list.forEach((record, index) => {
        if (index === 0) return;
        const suffix = `-${index + 1}`;
        record.slug += suffix;
        record.id = `${record.reviewer}/${record.slug}`;
        note(record.relPath, `slug 与 ${list[0]?.relPath ?? "?"} 冲突，临时改为 ${record.id}`);
      });
    }
    return;
  }

  throw new Error(
    `slug 冲突：${collisions.length} 组 entry id 对应多个文件。\n${detail}\n\n` +
      `修法：改文件名，或实现 slug 覆盖表。临时绕过：ONEDAY_ALLOW_SLUG_COLLISION=1`,
  );
}

let reviewsPromise: Promise<ReviewRecord[]> | null = null;

export function getReviews(): Promise<ReviewRecord[]> {
  reviewsPromise ??= buildReviews();
  return reviewsPromise;
}

async function buildStandards(): Promise<StandardRecord[]> {
  const [configs, files] = await Promise.all([readReviewerConfigs(), listFiles()]);
  const records: StandardRecord[] = [];

  for (const config of configs) {
    const prefix = `${config.reviewer}/`;
    for (const contentRel of files) {
      if (!contentRel.startsWith(prefix) || !isMarkdown(contentRel)) continue;
      const authorRel = contentRel.slice(prefix.length);

      const category = config.categories.find((c) =>
        c.standard.some((pattern) => path.matchesGlob(authorRel, pattern)),
      );
      if (!category) continue;

      const stem = path.basename(authorRel).replace(/\.md$/i, "").trim();
      const slug = toSlug(stem) || toSlug(authorRel.replace(/\.md$/i, "").replace(/\//g, "-"));
      const relPath = path.posix.join("src/content", contentRel);
      const dates = gitDatesFor(relPath);

      records.push({
        id: `${config.reviewer}/${category.idName}/${slug}`,
        reviewer: config.reviewer,
        slug,
        title: stem,
        category: category.name,
        filePath: path.join(CONTENT_ROOT, contentRel),
        relPath,
        contentRel,
        published: dates.published,
        modified: dates.updated,
      });
    }
  }

  return records;
}

let standardsPromise: Promise<StandardRecord[]> | null = null;

export function getStandards(): Promise<StandardRecord[]> {
  standardsPromise ??= buildStandards();
  return standardsPromise;
}

/** 去掉 `.md`、前导 `/`、`./`，反斜杠转正斜杠。 */
export function normalizeWikiPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "");
}

let linkIndexPromise: Promise<LinkIndex> | null = null;
let linkIndexSync: LinkIndex | null = null;

export function getLinkIndex(): Promise<LinkIndex> {
  linkIndexPromise ??= (async (): Promise<LinkIndex> => {
    const reviews = await getReviews();
    const index: LinkIndex = { byPath: new Map() };
    for (const review of reviews) {
      index.byPath.set(normalizeWikiPath(review.contentRel), review);
    }
    linkIndexSync = index;
    return index;
  })();
  return linkIndexPromise;
}

export function resolveWikiTargetSync(target: string): ReviewRecord | null {
  const index = linkIndexSync;
  if (!index) return null;
  const normalized = normalizeWikiPath(target);
  if (!normalized) return null;
  return index.byPath.get(normalized) ?? null;
}

/** 预热所有索引，让访问器可以走同步路径。插件的 `before` 钩子调用它。 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([getReviews(), getLinkIndex(), listFiles()]);
}

export interface AttachmentLookup {
  /** 内容根相对路径；找不到就是 null。 */
  rel: string | null;
}

export function findAttachmentSync(target: string): AttachmentLookup {
  const normalized = normalizeWikiPath(target);
  if (!normalized) return { rel: null };
  const files = fileListCache;
  if (!files) return { rel: null };
  return { rel: files.includes(normalized) ? normalized : null };
}

