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
  loadGitDates,
  loadTagConfig,
  readReviewerConfigs,
  type ReviewerConfig,
} from "./config";
import { note, noteBrokenImage, noteUnresolvedLink } from "./report";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

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
}

export interface LinkIndex {
  byPath: Map<string, ReviewRecord>;
  byStem: Map<string, ReviewRecord[]>;
  byTitle: Map<string, ReviewRecord[]>;
}

// ---------------------------------------------------------------------------
// 文件遍历
// ---------------------------------------------------------------------------

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

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"]);

// ---------------------------------------------------------------------------
// frontmatter / 正文解析
// ---------------------------------------------------------------------------

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

/**
 * 生成 URL 用的 slug。
 *
 * 不用 github-slugger：它是为「标题锚点」设计的，会把 `∬`、`？` 这类**有意义的字符**
 * 一并剥掉，导致 `五等分的花嫁∬` 与 `五等分的花嫁`、`…告白？～…` 与 `…告白～…`
 * 撞成同一个 slug。这里只剔除 URL / 文件系统里真正危险的字符，
 * 其余（CJK、全角标点、Unicode 符号）原样保留。
 */
const SLUG_DENY = /[/\\?#%&=+<>|*:"'`]/g;

export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(SLUG_DENY, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
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

// ---------------------------------------------------------------------------
// 收录规则
// ---------------------------------------------------------------------------

/**
 * 一个文件属于哪些分类。命中任意一个 include glob 就算。
 * **没有任何 include 命中 = 这个文件不存在**，这是「正面清单」的全部含义。
 */
function categoriesFor(config: ReviewerConfig, authorRel: string): string[] {
  const matched: string[] = [];
  for (const category of config.categories) {
    if (category.include.some((pattern) => path.matchesGlob(authorRel, pattern))) {
      matched.push(category.name);
    }
  }
  return matched;
}

function matchesScoreOnly(meta: Record<string, unknown>, rules: Array<[string, string]> | null): boolean {
  if (rules === null) return true;
  for (const [key, value] of rules) {
    const actual = meta[key];
    if (actual !== undefined && actual !== null && String(actual).trim() === value) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 评测
// ---------------------------------------------------------------------------

async function buildReviews(): Promise<ReviewRecord[]> {
  const [configs, files] = await Promise.all([readReviewerConfigs(), listFiles()]);
  const gitDates = loadGitDates();
  const tagConfig = loadTagConfig();
  const records: ReviewRecord[] = [];

  for (const config of configs) {
    const prefix = `${config.reviewer}/`;
    for (const contentRel of files) {
      if (!contentRel.startsWith(prefix) || !isMarkdown(contentRel)) continue;
      const authorRel = contentRel.slice(prefix.length);

      const category = categoriesFor(config, authorRel);
      if (category.length === 0) continue;

      const filePath = path.join(CONTENT_ROOT, contentRel);
      const raw = await readFile(filePath, "utf8");
      const { meta, body } = splitFrontmatter(raw);

      const completed = meta["completed"] === true;
      if (!completed && !matchesScoreOnly(meta, config.scoreOnly)) continue;

      const title = titleFor(authorRel, config.reviewer, meta);
      const slug = slugFor(title, authorRel, contentRel);
      // URL = /<author>/<category>/<slug>/。分类进路径之后，
      // 「轻小说 + 它的动画」这类同作者同名作品就不再撞车。
      const primaryCategory = category[0] ?? "";
      const id = `${config.reviewer}/${primaryCategory}/${slug}`;

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
        modified: gitDates.get(contentRel) ?? "",
      };

      records.push({
        id,
        reviewer: config.reviewer,
        slug,
        title,
        filePath,
        relPath: path.posix.join("src/content", contentRel),
        contentRel,
        category,
        data,
        // 代码块在 loader 里就剥掉。注意剥完正文很可能以一行破折号开头
        // （sub_scores 后面通常跟一条分隔线），loader 会把它归一化成 `***`。
        body: subScores.body,
        subScores: subScores.lines,
      });
    }
  }

  detectIdCollisions(records);
  return records;
}

/**
 * 同一作者下两个文件落到同一个 slug = 构建硬失败。
 *
 * 不给自动 `-2`：静默变化的 URL 比构建失败糟糕得多。
 * 临时绕过（spike 用）：`ONEDAY_ALLOW_SLUG_COLLISION=1`，此时后者加 `-2` 后缀并记入报告。
 */
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

// ---------------------------------------------------------------------------
// 评分标准
// ---------------------------------------------------------------------------

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

      records.push({
        id: `${config.reviewer}/${category.name}/${slug}`,
        reviewer: config.reviewer,
        slug,
        title: stem,
        category: category.name,
        filePath: path.join(CONTENT_ROOT, contentRel),
        relPath: path.posix.join("src/content", contentRel),
        contentRel,
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

// ---------------------------------------------------------------------------
// 链接索引
// ---------------------------------------------------------------------------

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
    const index: LinkIndex = { byPath: new Map(), byStem: new Map(), byTitle: new Map() };
    for (const review of reviews) {
      index.byPath.set(normalizeWikiPath(review.contentRel), review);

      const stem = normalizeWikiPath(path.basename(review.contentRel));
      const stemList = index.byStem.get(stem);
      if (stemList) stemList.push(review);
      else index.byStem.set(stem, [review]);

      const titleList = index.byTitle.get(review.title);
      if (titleList) titleList.push(review);
      else index.byTitle.set(review.title, [review]);
    }
    linkIndexSync = index;
    return index;
  })();
  return linkIndexPromise;
}

/**
 * 解析 `[[目标]]`。行为对齐旧前端：
 *   - 目标含 `/`  → 按内容根相对路径精确匹配
 *   - 否则        → 先按文件名 stem，再按 title
 */
export async function resolveWikiTarget(target: string): Promise<ReviewRecord | null> {
  await getLinkIndex();
  return resolveWikiTargetSync(target);
}

/**
 * 同步版本。
 *
 * satteri 的访问器是**并发派发**的：同一个文档里多个 text 节点会同时进入 JS，
 * 异步访问器里的 `ctx.replaceNode()` 因此会互相干扰（实测同一张图片被插入 4 次）。
 * 所以索引必须在访问器之前预热好（插件的 `before` 钩子 await `ensureIndexes()`），
 * 访问器本身保持同步。
 */
export function resolveWikiTargetSync(target: string): ReviewRecord | null {
  const index = linkIndexSync;
  if (!index) return null;
  const normalized = normalizeWikiPath(target);
  if (!normalized) return null;
  if (normalized.includes("/")) return index.byPath.get(normalized) ?? null;
  return index.byStem.get(normalized)?.[0] ?? index.byTitle.get(normalized)?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// 附件（`![[图片]]`）索引
// ---------------------------------------------------------------------------

let attachmentIndexPromise: Promise<Map<string, string[]>> | null = null;
let attachmentIndexSync: Map<string, string[]> | null = null;

/** basename → 内容根相对路径列表。 */
export function getAttachmentIndex(): Promise<Map<string, string[]>> {
  attachmentIndexPromise ??= (async () => {
    const files = await listFiles();
    const index = new Map<string, string[]>();
    for (const rel of files) {
      if (!IMAGE_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
      const base = path.basename(rel);
      const list = index.get(base);
      if (list) list.push(rel);
      else index.set(base, [rel]);
    }
    attachmentIndexSync = index;
    return index;
  })();
  return attachmentIndexPromise;
}

/** 预热所有索引，让访问器可以走同步路径。插件的 `before` 钩子调用它。 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([getReviews(), getLinkIndex(), getAttachmentIndex()]);
}

export interface AttachmentLookup {
  /** 内容根相对路径；找不到就是 null。 */
  rel: string | null;
  /** 所有同名候选（用于报告歧义）。 */
  candidates: string[];
}

/**
 * 找一个附件。Obsidian 的规则是全库按文件名解析，这里照做：
 *   - 目标含 `/`：当作内容根相对路径
 *   - 否则：按 basename 全库查；同名多个时优先与引用文件同目录/最近公共祖先的那个
 */
export function findAttachmentSync(target: string, fromContentRel: string): AttachmentLookup {
  const normalized = normalizeWikiPath(target);
  if (!normalized) return { rel: null, candidates: [] };

  const files = fileListCache;
  const index = attachmentIndexSync;
  if (!files || !index) return { rel: null, candidates: [] };

  if (normalized.includes("/")) {
    const hit = files.find((rel) => rel === normalized);
    return hit ? { rel: hit, candidates: [hit] } : { rel: null, candidates: [] };
  }

  const candidates = index.get(normalized) ?? [];
  if (candidates.length === 0) return { rel: null, candidates: [] };
  if (candidates.length === 1) return { rel: candidates[0] ?? null, candidates };

  const fromDir = path.posix.dirname(fromContentRel);
  const score = (candidate: string): number => {
    const dir = path.posix.dirname(candidate);
    if (dir === fromDir) return Number.MAX_SAFE_INTEGER;
    const a = dir.split("/");
    const b = fromDir.split("/");
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
    return common;
  };
  const sorted = [...candidates].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  return { rel: sorted[0] ?? null, candidates };
}

export async function findAttachment(target: string, fromContentRel: string): Promise<AttachmentLookup> {
  await ensureIndexes();
  return findAttachmentSync(target, fromContentRel);
}

// ---------------------------------------------------------------------------
// 全量链接审计
// ---------------------------------------------------------------------------

const AUDIT_PATTERN = /!?\[\[([^\]\r\n]+)\]\]/g;

export interface AuditResult {
  /** 正文里出现的 wikilink 总数。 */
  links: number;
  /** 其中「只写文件名」而非完整路径的数量（待迁移项）。 */
  slashless: number;
  /** 正文里出现的图片嵌入总数。 */
  embeds: number;
  /** 其中「只写文件名」而非完整路径的数量（待迁移项）。 */
  bareEmbeds: number;
}

/**
 * 扫描**所有**评测正文里的 wikilink 与图片嵌入，解析不到的记进报告。
 *
 * 只审计渲染过的文档是不够的：354 篇里只有 73 篇完整评测会渲染，
 * 而 `[[The Blind Award 2025#游戏]]` 这类链接恰好都在仅评分评测的正文里，
 * 旧站从来不渲染它们，所以这个问题此前完全不可见。
 */
export async function auditContent(): Promise<AuditResult> {
  const reviews = await getReviews();
  await ensureIndexes();

  let links = 0;
  let slashless = 0;
  let embeds = 0;
  let bareEmbeds = 0;

  for (const review of reviews) {
    const source = review.relPath;
    AUDIT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AUDIT_PATTERN.exec(review.body)) !== null) {
      const inner = match[1] ?? "";
      if (match[0].startsWith("!")) {
        embeds += 1;
        if (!inner.includes("/")) bareEmbeds += 1;
        if (!findAttachmentSync(inner, review.contentRel).rel) noteBrokenImage(source, inner);
        continue;
      }
      const destination = inner.split("|")[0] ?? "";
      const target = (destination.split("#")[0] ?? "").trim();
      if (!target) continue;
      links += 1;
      if (!target.includes("/")) slashless += 1;
      if (!resolveWikiTargetSync(target)) noteUnresolvedLink(source, inner);
    }
  }

  return { links, slashless, embeds, bareEmbeds };
}
