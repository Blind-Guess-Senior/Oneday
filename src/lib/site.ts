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

/**
 * ISO 时间 → 页面上显示的 `YYYY-MM-DD`；解析不出来就返回空串。
 *
 * 用 UTC 取值：提交时间本身是 UTC，按本地时区取会让同一次提交在不同机器上
 * （CI 是 UTC，本地是 +8）显示成不同的日期。
 */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
