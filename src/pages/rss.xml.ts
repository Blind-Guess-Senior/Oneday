/**
 * RSS 2.0 feed（`/Oneday/rss.xml`）。
 *
 * 条目走首页默认视图那一套 filterCards + sortCards：按更新倒序，不含「仅评分」。
 * `modified` 优先取 frontmatter 的 `updated`，没写才回落 git（见 vault.ts 的 explicitUpdated）。
 */

import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { categoryNames } from "../lib/config";
import { emptyFilters, filterCards, sortCards } from "../lib/filter";
import { buildIndexPayload } from "../lib/index-data";
import { withBase } from "../lib/site";

function describe(card: { score: string; tags: string[]; aka: string[] }, categoryText: string): string {
  const parts: string[] = [];
  if (card.score) parts.push(`评分 ${card.score}`);
  if (categoryText) parts.push(categoryText);
  if (card.aka.length) parts.push(`别名 ${card.aka.join("、")}`);
  if (card.tags.length) parts.push(card.tags.join("、"));
  return parts.join(" · ");
}

export async function GET(context: APIContext) {
  const payload = await buildIndexPayload();
  const names = categoryNames();

  // 频道自身的地址要带 base，否则指到账号根而不是这个站
  const site = context.site ? new URL(withBase(""), context.site).href : "";

  const items = sortCards(filterCards(payload.reviews, emptyFilters()), "modified").map((card) => ({
    title: card.title,
    link: card.url,
    pubDate: card.modified ? new Date(card.modified) : undefined,
    description: describe(card, card.categoryIds.map((id) => names.get(id) ?? id).join(" / ")),
    categories: card.tags,
    author: card.reviewer,
  }));

  return rss({
    title: "Oneday",
    description: `评测站：${payload.reviewers.join("、")}`,
    site,
    items,
    customData: `<language>zh-cn</language>`,
  });
}
