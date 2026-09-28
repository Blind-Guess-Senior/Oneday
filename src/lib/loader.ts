

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Loader } from "astro/loaders";
import { note, renderReports } from "./report";
import { buildIndexPayload } from "./index-data";
import { splitFrontmatter, getReviews, getStandards } from "./vault";

interface Reporter {
  info: (message: string) => void;
}

function neutralizeLeadingRule(body: string, source: string): string {
  const neutralized = body.replace(/^((?:\s*\r?\n)*[ \t]*)-{3,}[ \t]*(?=\r?\n|$)/, "$1***");
  if (/^(?:\s*\r?\n)*[ \t]*(?:---|\+\+\+)/.test(neutralized)) {
    note(source, "正文开头是破折号/加号行，Astro 会把它当 frontmatter 解析（构建报 YAML 错误就是这里）");
  }
  return neutralized;
}

/** 报告是「排空式」的：谁先跑完谁打印，后跑的只打印新增部分。 */
function printReports(logger: Reporter): void {
  for (const line of renderReports()) logger.info(line);
}

export function reviewsLoader(): Loader {
  return {
    name: "oneday:reviews",
    async load({ store, logger, generateDigest, renderMarkdown }) {
      const reviews = await getReviews();

      for (const review of reviews) {
        // 仅评分评测不渲染正文（旧站也是这样：只看得到元信息）。
        const scoreOnly = review.data["score_only"] === true;
        const rendered = scoreOnly
          ? undefined
          : await renderMarkdown(neutralizeLeadingRule(review.body, review.relPath), {
              fileURL: pathToFileURL(review.filePath),
            });
        store.set({
          id: review.id,
          data: review.data,
          // 相对站点根，Astro 靠它把正文里的相对图片解析成真实资源
          filePath: review.relPath,
          digest: generateDigest(review.body + JSON.stringify(review.data) + (rendered?.html ?? "")),
          ...(rendered ? { rendered } : {}),
          assetImports: rendered?.metadata?.imagePaths ?? [],
        });
      }

      logger.info(`评测 ${reviews.length} 篇（完整 ${reviews.filter((r) => r.data["score_only"] === false).length} 篇，仅评分 ${reviews.filter((r) => r.data["score_only"] === true).length} 篇）`);

      // 首页岛屿的数据在这里先算一次：tag 分排的提示要在打印报告之前记进 report
      await buildIndexPayload();

      printReports(logger);

    },
  };
}

export function standardsLoader(): Loader {
  return {
    name: "oneday:standards",
    async load({ store, logger, generateDigest, renderMarkdown }) {
      const standards = await getStandards();

      for (const standard of standards) {
        const raw = await readFile(standard.filePath, "utf8");
        const rendered = await renderMarkdown(neutralizeLeadingRule(splitFrontmatter(raw).body, standard.relPath), {
          fileURL: pathToFileURL(standard.filePath),
        });
        const data: Record<string, unknown> = {
          path: standard.contentRel,
          reviewer: standard.reviewer,
          category: standard.category,
          category_id: standard.categoryId,
          title: standard.title,
          published: standard.published,
          modified: standard.modified,
        };
        store.set({
          id: standard.id,
          data,
          body: raw,
          filePath: standard.relPath,
          digest: generateDigest(raw + JSON.stringify(data)),
          rendered,
          assetImports: rendered?.metadata?.imagePaths ?? [],
        });
      }

      logger.info(`评分标准 ${standards.length} 份`);
      printReports(logger);
    },
  };
}
