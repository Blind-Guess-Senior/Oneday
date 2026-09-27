/**
 * 站点级常量。astro.config.ts 也 import 这里，所以本文件必须保持零依赖。
 */

/** GitHub Pages 上的站点根。 */
export const SITE = "https://blind-guess-senior.github.io";

/** 项目站点的子路径。改动这里 = 改动整站 URL。 */
export const BASE = "/Oneday";

/** 把站点内路径拼上 base，返回以 `/` 开头的绝对路径。 */
export function withBase(pathname: string): string {
  const clean = pathname.replace(/^\/+/, "");
  return clean ? `${BASE}/${clean}` : `${BASE}/`;
}

/** 一篇评测/标准的页面 URL，参数是 collection entry id。 */
export function entryUrl(id: string): string {
  return withBase(`${id.replace(/^\/+|\/+$/g, "")}/`);
}

/**
 * 生成 URL 用的 slug。
 *
 * 只剔除 URL / 文件系统里真正危险的字符，其余（CJK、全角标点、Unicode 符号）原样保留。
 * **不要换成 github-slugger**：它是为「标题锚点」设计的，会剥掉 `∬` `？` 这类有意义的字符，
 * 曾经导致 `五等分的花嫁∬` 与 `五等分的花嫁` 撞成同一个 URL。
 * （标题锚点仍然用 github-slugger，因为必须和 Astro 生成的标题 id 一致。）
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
