/**
 * 构建期报告。
 *
 * 旧站在浏览器里静默降级：解析不到的 `[[wikilink]]` 渲染成灰掉的 span、
 * 找不到的 `![[图片]]` 变成一个 404 的 <img>，构建者永远不知道。
 * 现在这些都由 remark 插件在构建期记录下来，由 loader 打印到构建日志。
 */

type Issues = Map<string, Set<string>>;

const unresolvedLinks: Issues = new Map();
const brokenImages: Issues = new Map();
const ambiguousImages: Issues = new Map();
const notes: Issues = new Map();

function add(store: Issues, source: string, detail: string): void {
  let set = store.get(source);
  if (!set) {
    set = new Set();
    store.set(source, set);
  }
  set.add(detail);
}

/** `[[目标]]` 找不到对应评测。 */
export function noteUnresolvedLink(source: string, target: string): void {
  add(unresolvedLinks, source, target);
}

/** `![[图片]]` 在仓库里找不到文件。 */
export function noteBrokenImage(source: string, target: string): void {
  add(brokenImages, source, target);
}

/** `![[图片]]` 命中多个同名文件，已按就近原则选了一个。 */
export function noteAmbiguousImage(source: string, target: string, chosen: string, others: string[]): void {
  add(ambiguousImages, source, `${target} → 选中 ${chosen}（另有 ${others.join("、")}）`);
}

/** 一般性提示，由调用方决定要不要显示。 */
export function note(source: string, detail: string): void {
  add(notes, source, detail);
}

function format(title: string, store: Issues, limit = 200): string[] {
  if (store.size === 0) return [];
  const total = [...store.values()].reduce((n, set) => n + set.size, 0);
  const lines = [`${title}（${total} 处，涉及 ${store.size} 个文件）`];
  let shown = 0;
  for (const [source, details] of [...store.entries()].sort()) {
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

/** 排空一个 store，返回快照。两个 loader 都会打印报告，排空保证不重复。 */
function drain(store: Issues): Issues {
  const snapshot: Issues = new Map(store);
  store.clear();
  return snapshot;
}

/** 生成报告文本并清空；没有新问题时返回空数组。 */
export function renderReports(): string[] {
  return [
    ...format("[报告] 解析不到的 [[wikilink]]", drain(unresolvedLinks)),
    ...format("[报告] 找不到文件的 ![[图片]]", drain(brokenImages)),
    ...format("[提示] 图片同名、已按就近原则选择", drain(ambiguousImages), 10),
    ...format("[提示]", drain(notes), 40),
  ];
}

/** 供 loader 判断要不要打印。 */
export function hasReports(): boolean {
  return unresolvedLinks.size + brokenImages.size + ambiguousImages.size + notes.size > 0;
}
