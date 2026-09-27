/**
 * 首页筛选岛屿需要的数据。
 *
 * 在构建期算好，一次性内联进首页（约 90KB，gzip 后二十几 KB），
 * 浏览器端不再需要额外请求。
 */

import { loadTagConfig, readReviewerConfigs } from "./config";
import type { Card } from "./filter";
import { note } from "./report";
import { entryUrl } from "./site";
import { getReviews, getStandards } from "./vault";

export interface StandardCard {
  url: string;
  title: string;
  reviewer: string;
  category: string;
}

export interface IndexPayload {
  reviews: Card[];
  standards: StandardCard[];
  /** 有评测的分类，顺序按作者配置里的书写顺序。id 是 URL/徽章用的 ASCII 名 */
  categories: Array<{ name: string; id: string }>;
  reviewers: string[];
  /** 评测者 → 有序的分数选项（来自该作者的 [score].order，未列出的按字典序补在后面） */
  scoreOptions: Record<string, string[]>;
  /** 分类 → 分排的 tag（顺序来自 src/config/site.toml，未声明的追加到最后一排） */
  tagRows: Record<string, string[][]>;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * 按 `[tag_rows.N][分类]` 排出该分类的 tag 行。
 *
 * 只保留该分类下真实出现过的 tag；数据里出现但 site.toml 没声明的，
 * 追加到最后一排末尾并记进构建日志（既不静默消失，又能暴露拼写错误）。
 */
function buildTagRows(cards: Card[], categories: string[]): Record<string, string[][]> {
  const config = loadTagConfig();
  const result: Record<string, string[][]> = {};

  for (const category of categories) {
    const used = new Set<string>();
    for (const card of cards) {
      if (card.category.includes(category)) card.tags.forEach((tag) => used.add(tag));
    }

    const declared = new Set<string>();
    const rows: string[][] = config.rows.map((row) =>
      (row[category] ?? []).filter((tag) => {
        if (!used.has(tag) || declared.has(tag)) return false;
        declared.add(tag);
        return true;
      }),
    );

    const undeclared = [...used].filter((tag) => !declared.has(tag)).sort((a, b) => a.localeCompare(b, "zh"));
    if (undeclared.length > 0) {
      if (rows.length === 0) rows.push([]);
      rows[rows.length - 1]?.push(...undeclared);
      note(
        "src/config/site.toml",
        `分类「${category}」有 ${undeclared.length} 个 tag 没声明，已排在最后一排：${undeclared.join("、")}`,
      );
    }

    result[category] = rows;
  }

  return result;
}

let cached: Promise<IndexPayload> | null = null;

export function buildIndexPayload(): Promise<IndexPayload> {
  cached ??= (async (): Promise<IndexPayload> => {
    const [reviews, standards, configs] = await Promise.all([
      getReviews(),
      getStandards(),
      readReviewerConfigs(),
    ]);

    // 分类顺序 = 作者配置里的书写顺序，去重；同时记下 name → id_name
    const categories: Array<{ name: string; id: string }> = [];
    const categoryIds = new Map<string, string>();
    for (const config of configs) {
      for (const category of config.categories) {
        if (categoryIds.has(category.name)) continue;
        categoryIds.set(category.name, category.idName);
        categories.push({ name: category.name, id: category.idName });
      }
    }

    const cards: Card[] = reviews.map((review) => {
      const names = asList(review.data["category"]);
      return {
        url: entryUrl(review.id),
        title: review.title,
        aka: asList(review.data["aka"]),
        reviewer: review.reviewer,
        category: names,
        categoryIds: names.map((name) => categoryIds.get(name) ?? name),
        tags: asList(review.data["tags"]),
        score: String(review.data["score_raw"] ?? ""),
        rank: typeof review.data["score_rank"] === "number" ? review.data["score_rank"] : null,
        tier: typeof review.data["score_tier"] === "number" ? review.data["score_tier"] : null,
        scoreOnly: review.data["score_only"] === true,
        published: String(review.data["published"] ?? ""),
        modified: String(review.data["modified"] ?? ""),
      };
    });

    const reviewers = [...new Set(cards.map((card) => card.reviewer))].sort((a, b) =>
      a.localeCompare(b, "zh"),
    );

    const scoreOptions: Record<string, string[]> = {};
    for (const config of configs) {
      const seen = new Set(
        cards.filter((card) => card.reviewer === config.reviewer && card.score).map((card) => card.score),
      );
      const ordered = config.scoreOrder.filter((score) => seen.has(score));
      const rest = [...seen].filter((score) => !ordered.includes(score)).sort((a, b) =>
        a.localeCompare(b, "zh"),
      );
      if (ordered.length + rest.length > 0) scoreOptions[config.reviewer] = [...ordered, ...rest];
    }

    return {
      reviews: cards,
      standards: standards.map((standard) => ({
        url: entryUrl(`standard/${standard.id}`),
        title: standard.title,
        reviewer: standard.reviewer,
        category: standard.category,
      })),
      categories,
      reviewers,
      scoreOptions,
      tagRows: buildTagRows(cards, categories.map((category) => category.name)),
    };
  })();

  return cached;
}
