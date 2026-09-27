/**
 * 评测页额外元信息（`metadata_maps`）。
 *
 * 规则来自作者配置：分类作用域，单 key 直接取值，多 key 按 separator 拼接。
 * 没被这里声明、也不是预定义字段的 metadata 不显示。
 */

import { readReviewerConfigs, type MetadataMapEntry } from "./config";

export interface MetaItem {
  label: string;
  value: string;
}

export async function extraMeta(
  reviewer: string,
  category: string[],
  data: Record<string, unknown>,
): Promise<MetaItem[]> {
  const config = (await readReviewerConfigs()).find((entry) => entry.reviewer === reviewer);
  if (!config) return [];

  let entries: MetadataMapEntry[] | undefined;
  for (const name of category) {
    entries = config.metadataMaps[name];
    if (entries) break;
  }
  if (!entries) return [];

  const items: MetaItem[] = [];
  for (const entry of entries) {
    if (entry.keys.length === 1) {
      const key = entry.keys[0] ?? "";
      const value = data[key];
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      items.push({
        label: entry.label,
        value: Array.isArray(value) ? value.map(String).join(" / ") : String(value),
      });
      continue;
    }
    const parts = entry.keys
      .map((key) => data[key])
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map(String);
    if (parts.length === 0) continue;
    items.push({ label: entry.label, value: parts.join(entry.separator) });
  }
  return items;
}
