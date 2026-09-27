/**
 * 作者自定义的评分档位配色。
 *
 * 每个作者可以在自己目录下放 `reviewer_style.css`。这里只提取
 * `.score-tier-N { … }` 规则，并加上 `[data-reviewer="<作者>"]` 作用域，
 * 避免作者之间互相影响；其它选择器一律忽略（一个写坏的样式表不该泄漏成全局样式）。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readReviewerConfigs } from "./config";

function scope(reviewer: string, css: string): string {
  const escaped = reviewer.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const prefix = `[data-reviewer="${escaped}"]`;
  const rules: string[] = [];
  for (const match of css.matchAll(/(\.score-tier-\d+\s*)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    const declarations = (match[2] ?? "").trim();
    if (selector && declarations) rules.push(`${prefix}${selector} {\n${declarations}\n}`);
  }
  return rules.join("\n\n");
}

let cached: string | null = null;

export async function reviewerStyles(): Promise<string> {
  if (cached !== null) return cached;

  const parts: string[] = [];
  for (const config of await readReviewerConfigs()) {
    const file = path.join(config.dir, "reviewer_style.css");
    if (!existsSync(file)) continue;
    const css = readFileSync(file, "utf8").trim();
    if (!css) continue;
    const scoped = scope(config.reviewer, css);
    if (scoped) parts.push(`/* ${config.reviewer} */\n${scoped}`);
  }

  cached = parts.join("\n\n");
  return cached;
}
