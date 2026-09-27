/**
 * 筛选与排序。纯函数，不依赖任何框架 —— 这样这套语义可以脱离 UI 单独验证。
 */

export interface Card {
  url: string;
  title: string;
  aka: string[];
  reviewer: string;
  category: string[];
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

/** 分类徽章的配色：按分类名映射到旧站已有的 badge-* 类。 */
export function categoryBadgeClass(category: string[]): string {
  if (category.includes("游戏")) return "badge-game";
  if (category.includes("动漫")) return "badge-anime";
  if (category.includes("书籍")) return "badge-book";
  return "badge-default";
}
