/**
 * 构建期提示。
 *
 * 只用来把「配置和数据对不上」这类事情说出来（例如分类没写 id_name、
 * 数据里出现了 site.toml 没声明的 tag）。**不检查内容怎么写**——
 * 作者爱怎么写就怎么写。
 */

type Notes = Map<string, Set<string>>;

const notes: Notes = new Map();

/** 记一条提示。`source` 用来指明是哪个文件/配置的问题。 */
export function note(source: string, detail: string): void {
  let set = notes.get(source);
  if (!set) {
    set = new Set();
    notes.set(source, set);
  }
  set.add(detail);
}

function format(limit: number): string[] {
  if (notes.size === 0) return [];
  const total = [...notes.values()].reduce((n, set) => n + set.size, 0);
  const lines = [`[提示]（${total} 处，涉及 ${notes.size} 个文件）`];
  if (limit <= 0) return lines;
  let shown = 0;
  for (const [source, details] of [...notes.entries()].sort()) {
    for (const detail of [...details].sort()) {
      if (shown >= limit) {
        lines.push(`  … 其余 ${total - limit} 处省略`);
        return lines;
      }
      lines.push(`  ${source}  →  ${detail}`);
      shown += 1;
    }
  }
  return lines;
}

/**
 * 生成提示文本并清空；没有新问题时返回空数组。
 *
 * 默认只打汇总行，明细用 `ONEDAY_REPORT=full`。
 */
export function renderReports(): string[] {
  const full = process.env["ONEDAY_REPORT"] === "full";
  const lines = format(full ? 200 : 0);
  if (!full && lines.length > 0) lines.push("  （明细：ONEDAY_REPORT=full npm run build）");
  notes.clear();
  return lines;
}
