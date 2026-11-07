/**
 * 评测页额外元信息（`metadata_maps`）。
 *
 * 规则来自作者配置：分类 id 作用域，label 和 value 模板通过 `{字段名}` 引用 frontmatter。
 * 没被这里声明、也不是预定义字段的 metadata 不显示。
 */

import { readReviewerConfigs, type MetadataMapEntry } from "./config";

export interface MetaItem {
  label: string;
  value: string;
}

/** 取一个 frontmatter 值并拉平成显示文本；数组按 ` / ` 拼。 */
function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" / ");
  return String(value);
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{([^{}]+)\}/g, (_, key: string) => flatten(data[key]));
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

  return entries.map((entry) => ({
    label: renderTemplate(entry.label, data),
    value: renderTemplate(entry.value, data),
  }));
}
