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
