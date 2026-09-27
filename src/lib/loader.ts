/**
 * 两个自定义 Content Layer loader。
 *
 * 为什么不用内置的 `glob()`：**哪些文件算评测由各作者目录的 reviewer_config.toml 决定**，
 * 静态 glob pattern 表达不了「正面清单 + 仅评分收录规则」这套逻辑。
 * 自定义 loader 还能顺便把 score_rank / score_tier / tag 别名 / sub_scores 一次算好，
 * 保持「改 toml 就能加作者/分类/tag，不用碰代码」这个性质。
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Loader } from "astro/loaders";
import { note, renderReports } from "./report";
import { auditContent, splitFrontmatter, getReviews, getStandards } from "./vault";

interface Reporter {
  info: (message: string) => void;
}

/**
 * Astro 的 `parseFrontmatter()` 用 `/(?:^\uFEFF?|^\s*\n)(?:---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/`
 * 找 frontmatter，并且**不做 try/catch**：正文开头只要出现破折号行，它就会把后面
 * 一直到下一个破折号行之间的所有内容丢给 `yaml.load()`，解析失败直接炸掉构建。
 *
 * 而剥掉 sub_scores 代码块之后，正文**经常**正好以一条分隔线开头，所以这条不是边角情况。
 * `---` 和 `***` 在 markdown 里都是分隔线，渲染结果完全一致，换成 `***` 是零副作用的规避。
 */
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
        // 它们正文里的链接/图片由 auditContent() 单独审计。
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
          // digest 必须覆盖**渲染产物**：store.set() 在 digest 与已有条目相同时会
          // 直接跳过写入（mutable-data-store.js 的 `existing.digest === digest`），
          // 只哈希 body+data 的话，改了插件/渲染逻辑也不会重新渲染，
          // 会一直吃 node_modules/.astro/data-store.json 里的旧 HTML。
          digest: generateDigest(review.body + JSON.stringify(review.data) + (rendered?.html ?? "")),
          ...(rendered ? { rendered } : {}),
          // 关键：声明正文里引用了哪些本地图片。缺了这条，<img> 会永远停在
          // `__ASTRO_IMAGE_` 中间态，永远不会被替换成处理后的资源。
          assetImports: rendered?.metadata?.imagePaths,
        });
      }

      logger.info(`评测 ${reviews.length} 篇（完整 ${reviews.filter((r) => r.data["score_only"] === false).length} 篇，仅评分 ${reviews.filter((r) => r.data["score_only"] === true).length} 篇）`);

      // 只审计渲染过的正文不够：大部分评测是「仅评分」，正文从不渲染
      const audit = await auditContent();
      logger.info(
        `正文里 wikilink ${audit.links} 处（裸文件名 ${audit.slashless}）、图片嵌入 ${audit.embeds} 处（裸文件名 ${audit.bareEmbeds}）—— 裸文件名待迁移为完整路径`,
      );
      printReports(logger);

      if (process.env["ONEDAY_DATA_DUMP"]) {
        await writeFile(
          process.env["ONEDAY_DATA_DUMP"],
          JSON.stringify(reviews.map((review) => review.data)),
          "utf8",
        );
      }
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
          title: standard.title,
        };
        store.set({
          id: standard.id,
          data,
          body: raw,
          filePath: standard.relPath,
          digest: generateDigest(raw),
          rendered,
          assetImports: rendered?.metadata?.imagePaths,
        });
      }

      logger.info(`评分标准 ${standards.length} 份`);
      printReports(logger);
    },
  };
}
