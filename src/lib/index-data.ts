/**
 * 首页筛选岛屿需要的数据。
 *
 * 在构建期算好，一次性内联进首页（约 90KB，gzip 后二十几 KB），
 * 浏览器端不再需要额外请求。
 */

import { categoryRows, readReviewerConfigs } from "./config";
import type { Card, StandardCard } from "./filter";
import { entryUrl } from "./site";
import { getReviews, getStandards } from "./vault";

export interface IndexPayload {
  reviews: Card[];
  standards: StandardCard[];
  /** 有评测的分类 id，顺序按作者配置里的书写顺序 */
  categories: string[];
  /** 分类 id → 显示名。只在渲染的时候查，任何判断都不用它 */
  categoryNames: Record<string, string>;
  reviewers: string[];
  /** 评测者 → 有序的分数选项（来自该作者的 [score].order，未列出的按字典序补在后面） */
  scoreOptions: Record<string, string[]>;
  /** 分类 id → 分排的 tag（顺序来自 by_category_id/<id>/tags.toml） */
  tagRows: Record<string, string[][]>;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * 按 `[tag_rows]` 排出该分类的 tag 行。
 *
 * 只列真有卡片在用的 tag；没在 tags.toml 里出现过的 tag 自动接成新的一排。
 */
function buildTagRows(cards: Card[], categories: string[]): Record<string, string[][]> {
  const result: Record<string, string[][]> = {};

  for (const id of categories) {
    const used = new Set<string>();
    for (const card of cards) {
      if (card.categoryIds.includes(id)) card.tags.forEach((tag) => used.add(tag));
    }

    const declared = new Set<string>();
    const rows = categoryRows(id).map((row) =>
      row.filter((tag) => {
        if (!used.has(tag) || declared.has(tag)) return false;
        declared.add(tag);
        return true;
      }),
    );

    const rest = [...used].filter((tag) => !declared.has(tag)).sort((a, b) => a.localeCompare(b, "zh"));
    if (rest.length > 0) rows.push(rest);

    result[id] = rows;
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

    // 分类顺序 = 作者配置里的书写顺序，按 id 去重；显示名单独记一张表
    const categories: string[] = [];
    const categoryNames: Record<string, string> = {};
    for (const config of configs) {
      for (const category of config.categories) {
        if (category.id in categoryNames) continue;
        categoryNames[category.id] = category.name;
        categories.push(category.id);
      }
    }

    const cards: Card[] = reviews.map((review) => {
      return {
        url: entryUrl(review.id),
        title: review.title,
        aka: asList(review.data["aka"]),
        reviewer: review.reviewer,
        categoryIds: asList(review.data["category_ids"]),
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
        categoryId: standard.categoryId,
      })),
      categories,
      categoryNames,
      reviewers,
      scoreOptions,
      tagRows: buildTagRows(cards, categories),
    };
  })();

  return cached;
}
