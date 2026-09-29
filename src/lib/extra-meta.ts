/**
 * 评测页额外元信息（`metadata_maps`）。
 *
 * 规则来自作者配置：分类 id 作用域，单 key 直接取值，多 key 按 separator 拼接。
 * 没被这里声明、也不是预定义字段的 metadata 不显示。
 */

import { readReviewerConfigs, type MetadataMapEntry } from "./config";

export interface MetaItem {
  label: string;
  value: string;
}

/** 取一个 frontmatter 值并拉平成显示文本；数组按 ` / ` 拼。取不到就是空串。 */
function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" / ");
  if (value === undefined || value === null) return "";
  return String(value);
}

export async function extraMeta(
  reviewer: string,
  categoryIds: string[],
  data: Record<string, unknown>,
): Promise<MetaItem[]> {
  const config = (await readReviewerConfigs()).find((entry) => entry.reviewer === reviewer);
  if (!config) return [];

  let entries: MetadataMapEntry[] | undefined;
  for (const id of categoryIds) {
    entries = config.metadataMaps[id];
    if (entries) break;
  }
  if (!entries) return [];

  const items: MetaItem[] = [];
  for (const entry of entries) {
    const parts = entry.keys.map((key) => flatten(data[key])).filter((text) => text !== "");
    if (parts.length === 0) continue;
    items.push({ label: entry.label, value: parts.join(entry.separator) });
  }
  return items;
}
