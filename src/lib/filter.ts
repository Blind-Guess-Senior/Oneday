/**
 * 筛选与排序。纯函数，不依赖任何框架 —— 这样这套语义可以脱离 UI 单独验证。
 */

export interface Card {
  url: string;
  title: string;
  aka: string[];
  reviewer: string;
  category: string[];
  /** 分类的 id_name，用于徽章配色（与显示名解耦，加分类不用改代码） */
  categoryIds: string[];
  tags: string[];
  score: string;
  /** 在作者 [score].order 里的位置，用于排序；没配置 order 时为 null */
  rank: number | null;
  /** 评分档位，用于样式（score-tier-N）；没配置 tiers 时为 null */
  tier: number | null;
  scoreOnly: boolean;
  modified: string;
}

export interface Filters {
  query: string;
  /** 单选，空字符串表示不限 */
  category: string;
  /** 多选，需全部满足 */
  reviewers: string[];
  /** 每个评测者各自的分数选择：reviewer → 选中的分数 */
  scores: Record<string, string[]>;
  /** 多选，需全部满足 */
  tags: string[];
  showScoreOnly: boolean;
}

export function emptyFilters(): Filters {
  return { query: "", category: "", reviewers: [], scores: {}, tags: [], showScoreOnly: false };
}

function matchesReviewer(card: Card, filters: Filters): boolean {
  return filters.reviewers.length === 0 || filters.reviewers.includes(card.reviewer);
}

function matchesScore(card: Card, filters: Filters): boolean {
  // 只有被选中的评测者才参与分数筛选；没给它选分数 = 它的全部评测都显示
  const selected = filters.scores[card.reviewer];
  if (!selected || selected.length === 0) return true;
  return selected.includes(card.score);
}

function matchesQuery(card: Card, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    card.title.toLowerCase().includes(q) ||
    card.aka.some((name) => name.toLowerCase().includes(q)) ||
    card.tags.some((tag) => tag.toLowerCase().includes(q)) ||
    card.reviewer.toLowerCase().includes(q)
  );
}

export function filterCards(cards: Card[], filters: Filters): Card[] {
  return cards.filter((card) => {
    if (!filters.showScoreOnly && card.scoreOnly) return false;
    if (filters.category && !card.category.includes(filters.category)) return false;
    if (!matchesReviewer(card, filters)) return false;
    if (!matchesScore(card, filters)) return false;
    if (filters.tags.length > 0 && !filters.tags.every((tag) => card.tags.includes(tag))) return false;
    return matchesQuery(card, filters.query);
  });
}

export type SortKey = "modified" | "score_desc" | "score_asc" | "title";

function compareScore(a: Card, b: Card, direction: "asc" | "desc"): number {
  const factor = direction === "desc" ? -1 : 1;
  if (a.rank != null && b.rank != null) return (a.rank - b.rank) * factor;
  if (a.rank != null) return -1;
  if (b.rank != null) return 1;
  // 作者没配 [score].order 时的兜底：
  // 纯字符串比较会把 "10" 排在 "9" 前面，所以两边都是数字就按数值比。
  const left = Number(a.score);
  const right = Number(b.score);
  if (a.score !== "" && b.score !== "" && Number.isFinite(left) && Number.isFinite(right)) {
    return (left - right) * factor;
  }
  return a.score.localeCompare(b.score, "zh") * factor;
}

export function sortCards(cards: Card[], key: SortKey): Card[] {
  const sorted = [...cards];
  sorted.sort((a, b) => {
    if (key === "modified") return b.modified.localeCompare(a.modified);
    if (key === "score_desc") return compareScore(a, b, "desc");
    if (key === "score_asc") return compareScore(a, b, "asc");
    return a.title.localeCompare(b.title, "zh");
  });
  return sorted;
}

/** 分页页码窗口：两端 + 当前页附近，中间用省略号。 */
export function pageWindow(total: number, current: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const picked = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...picked].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  let previous = 0;
  for (const page of sorted) {
    if (page - previous > 1) result.push("…");
    result.push(page);
    previous = page;
  }
  return result;
}

/**
 * 分类徽章的配色类名。
 *
 * 旧代码是按中文分类名硬编码 `游戏/动漫/书籍 → badge-game/anime/book`，
 * 结果是「加一个分类就悄悄变成默认样式，还得改代码」。
 * 现在按分类的 `id_name` 生成，加分类只要在 toml 里写个 ASCII 名，
 * 想单独配色就在 global.css 里加一条 `.badge-<id_name 小写>`。
 */
export function categoryBadgeClass(categoryIds: string[]): string {
  const id = categoryIds[0]?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return id ? `badge-${id}` : "badge-default";
}

// ---------------------------------------------------------------------------
// 地址栏状态
// ---------------------------------------------------------------------------

export interface UrlState {
  query: string;
  /** 分类的 id_name；空串表示不限 */
  categoryId: string;
  reviewers: string[];
  scores: Record<string, string[]>;
  tags: string[];
  showScoreOnly: boolean;
  showStandardsOnly: boolean;
  sort: SortKey;
  page: number;
}

export function defaultUrlState(): UrlState {
  return {
    query: "",
    categoryId: "",
    reviewers: [],
    scores: {},
    tags: [],
    showScoreOnly: false,
    showStandardsOnly: false,
    sort: "modified",
    page: 1,
  };
}

const SORT_KEYS: SortKey[] = ["modified", "score_desc", "score_asc", "title"];

/**
 * 解析地址栏。参数名：`q` 搜索 / `c` 分类 id_name / `r` 评测者（可重复）/
 * `s` `评测者:分数`（可重复）/ `t` tag（可重复）/ `only=1` / `std=1` / `sort` / `page`。
 * 认不出的值一律忽略，回落默认值。
 */
export function parseFilterSearch(search: string): UrlState {
  const params = new URLSearchParams(search);
  const state = defaultUrlState();

  state.query = params.get("q") ?? "";
  state.categoryId = params.get("c") ?? "";
  state.reviewers = params.getAll("r");
  state.tags = params.getAll("t");
  state.showScoreOnly = params.get("only") === "1";
  state.showStandardsOnly = params.get("std") === "1";

  for (const raw of params.getAll("s")) {
    const separator = raw.indexOf(":");
    if (separator <= 0) continue;
    const reviewer = raw.slice(0, separator);
    const score = raw.slice(separator + 1);
    if (!reviewer || !score) continue;
    (state.scores[reviewer] ??= []).push(score);
  }

  const sort = params.get("sort") as SortKey | null;
  if (sort && SORT_KEYS.includes(sort)) state.sort = sort;

  const page = Number(params.get("page") ?? "1");
  state.page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  return state;
}

/** 反向：只写出与默认值不同的项，URL 尽量干净。 */
export function buildFilterSearch(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.categoryId) params.set("c", state.categoryId);
  state.reviewers.forEach((reviewer) => params.append("r", reviewer));
  for (const [reviewer, chosen] of Object.entries(state.scores)) {
    chosen.forEach((score) => params.append("s", `${reviewer}:${score}`));
  }
  state.tags.forEach((tag) => params.append("t", tag));
  if (state.showScoreOnly) params.set("only", "1");
  if (state.showStandardsOnly) params.set("std", "1");
  if (state.sort !== "modified") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  return params.toString();
}
