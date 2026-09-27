/**
 * 构建期报告。
 *
 * 旧站在浏览器里静默降级：解析不到的 `[[wikilink]]` 渲染成灰掉的 span、
 * 找不到的 `![[图片]]` 变成一个 404 的 <img>，构建者永远不知道。
 * 现在这些都在构建期扫出来。
 *
 * **链接和图片一律只认「内容根相对的完整路径」，不做任何兜底**，
 * 所以「非完整路径」是一类必须为 0 的错误，专门单列。
 */

type Issues = Map<string, Set<string>>;

/** 非完整路径的 wiki 目标（`[[裸名]]` / `![[裸名.png]]`）。合进 main 前必须为 0。 */
const bareTargets: Issues = new Map();
/** 写的是完整路径，但仓库里没有这个文件。 */
const missingTargets: Issues = new Map();
/** 图片路径是完整的，但文件不存在。 */
const brokenImages: Issues = new Map();
/** 目标文件存在，但它没有被 reviewer_config.toml 收录（所以不会成为页面）。 */
const unpublishedTargets: Issues = new Map();
const notes: Issues = new Map();

function add(store: Issues, source: string, detail: string): void {
  let set = store.get(source);
  if (!set) {
    set = new Set();
    store.set(source, set);
  }
  set.add(detail);
}

/** `[[裸名]]` —— 没写完整路径。 */
export function noteBareTarget(source: string, target: string): void {
  add(bareTargets, source, target);
}

/** 完整路径但没有对应文件。 */
export function noteMissingTarget(source: string, target: string): void {
  add(missingTargets, source, target);
}

/** 图片的完整路径没有对应文件。 */
export function noteBrokenImage(source: string, target: string): void {
  add(brokenImages, source, target);
}

/** 目标文件存在但没被收录（`status: 未完成` 之类），页面不会生成。 */
export function noteUnpublishedTarget(source: string, target: string): void {
  add(unpublishedTargets, source, target);
}

/** 一般性提示，由调用方决定要不要显示。 */
export function note(source: string, detail: string): void {
  add(notes, source, detail);
}

function format(title: string, store: Issues, limit: number): string[] {
  if (store.size === 0) return [];
  const total = [...store.values()].reduce((n, set) => n + set.size, 0);
  const header = `${title}（${total} 处，涉及 ${store.size} 个文件）`;
  if (limit <= 0) return [header];
  const lines = [header];
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

/**
 * 生成报告文本并清空；没有新问题时返回空数组。
 *
 * 默认只打**汇总行**：日常构建刷几十行明细没有意义。需要明细时 `ONEDAY_REPORT=full`。
 */
export function renderReports(): string[] {
  const full = process.env["ONEDAY_REPORT"] === "full";
  const limit = full ? 500 : 0;
  const lines = [
    ...format("[报告] 非完整路径的 wiki 目标（应当为 0）", drain(bareTargets), limit),
    ...format("[报告] 目标文件不存在的链接", drain(missingTargets), limit),
    ...format("[报告] 目标文件不存在的图片", drain(brokenImages), limit),
    ...format("[提示] 目标存在但未被收录", drain(unpublishedTargets), full ? 200 : 0),
    ...format("[提示]", drain(notes), full ? 200 : 0),
  ];
  if (!full && lines.length > 0) {
    lines.push("  （明细：ONEDAY_REPORT=full npm run build）");
  }
  return lines;
}

/** 供 loader 判断要不要打印。 */
export function hasReports(): boolean {
  return (
    bareTargets.size + missingTargets.size + brokenImages.size + unpublishedTargets.size + notes.size > 0
  );
}
