/**
 * RSS 2.0 feed（`/Oneday/rss.xml`）。
 *
 * 条目按最近修改时间倒序；`modified` 来自 git（见 config.ts 的 loadGitDates），
 * 也就是「这篇评测最后一次被改动」的时间，不是 frontmatter 里手写的。
 */

import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { categoryNames } from "../lib/config";
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

  const items = [...payload.reviews]
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .map((card) => ({
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
