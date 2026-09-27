/**
 * Obsidian 语法的构建期处理。
 *
 * 现在由构建期负责三件旧站在浏览器里用正则干的事：
 *   - `![[图片]]`  → 解析到仓库里真实的附件文件（全库按文件名查，同 Obsidian）
 *   - `[[目标]]` / `[[目标#小节|别名]]` → 指向对应评测页面的站内链接
 *   - 解析不到的链接/图片记入构建报告，而不是静默变成一个灰掉的 span
 *
 * 旧前端的行为在这里对齐：
 *   - 含 `/` 的目标按内容根相对路径精确匹配，否则先按文件名 stem、再按 title
 *   - 显示文本的默认值是目标的最后一段（去掉 `#小节`）
 *   - `#小节` 只用于锚点跳转，锚点 id 由 Astro 的 heading-ids 插件生成（同一个 slugger）
 *
 * 注意访问器必须是**同步**的：satteri 会并发派发同一个文档里的多个 text 节点，
 * 异步访问器里的 `ctx.replaceNode()` 会互相干扰（实测同一张图片被插入 4 次）。
 * 所以索引在 `before` 钩子里预热，访问器只读内存。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug as slugify } from "github-slugger";
import type { MdastNode, MdastPluginDefinition, MdastVisitorContext, PluginFactoryContext } from "satteri";
import { CONTENT_ROOT } from "../lib/config";
import { noteAmbiguousImage, noteBrokenImage, noteUnresolvedLink } from "../lib/report";
import { entryUrl } from "../lib/site";
import { ensureIndexes, findAttachmentSync, resolveWikiTargetSync } from "../lib/vault";

/** 一次匹配 `[[...]]` 与 `![[...]]`，`!` 前缀决定它是图片还是链接。 */
const WIKI_PATTERN = /!?\[\[([^\]\r\n]+)\]\]/g;

function splitOnce(value: string, separator: string): [string, string | null] {
  const index = value.indexOf(separator);
  if (index === -1) return [value, null];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

/** 生成相对当前文件目录的 URL —— Astro 的图片管线就是按这个基准解析的。 */
function relativeUrl(fromDir: string, targetRel: string): string {
  const rel = path.posix.relative(fromDir, targetRel);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function obsidianPlugin(factory: PluginFactoryContext): MdastPluginDefinition {
  const filePath = factory.fileURL ? fileURLToPath(factory.fileURL) : "";
  const contentRel = filePath ? path.relative(CONTENT_ROOT, filePath).split(path.sep).join("/") : "";
  const source = contentRel || filePath || "<unknown>";
  const fileDir = contentRel ? path.posix.dirname(contentRel) : "";

  function makeImage(target: string): MdastNode[] | null {
    const lookup = findAttachmentSync(target, contentRel);
    if (!lookup.rel) {
      noteBrokenImage(source, target);
      return null;
    }
    if (lookup.candidates.length > 1) {
      noteAmbiguousImage(
        source,
        target,
        lookup.rel,
        lookup.candidates.filter((candidate) => candidate !== lookup.rel),
      );
    }
    const image: MdastNode = { type: "image", url: relativeUrl(fileDir, lookup.rel), alt: "" };
    return [image];
  }

  function makeLink(inner: string): MdastNode[] | null {
    const [destination, alias] = splitOnce(inner, "|");
    const [rawTarget, heading] = splitOnce(destination, "#");
    const target = rawTarget.trim();

    // `[[#小节]]` 这类纯锚点：旧站直接显示文本，这里保持一致
    if (!target) return null;

    const found = resolveWikiTargetSync(target);
    if (!found) {
      noteUnresolvedLink(source, inner);
      return null;
    }

    const label = alias ?? destination.split("/").pop()?.split("#")[0]?.trim() ?? target;
    const anchor = heading ? `#${slugify(heading)}` : "";
    const link: MdastNode = {
      type: "link",
      url: `${entryUrl(found.id)}${anchor}`,
      children: [{ type: "text", value: label || target }],
    };
    return [link];
  }

  return {
    name: "oneday-obsidian",

    async before() {
      await ensureIndexes();
    },

    text(node: Readonly<{ value: string }>, ctx: MdastVisitorContext) {
      const value = node.value;
      if (!value.includes("[[")) return;

      // 不在链接内部再造链接
      const parent = ctx.parent(node as never);
      if (parent && (parent.type === "link" || parent.type === "linkReference")) return;

      const parts: MdastNode[] = [];
      let last = 0;
      let changed = false;

      WIKI_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKI_PATTERN.exec(value)) !== null) {
        const inner = match[1] ?? "";
        const replacement = match[0].startsWith("!") ? makeImage(inner) : makeLink(inner);
        if (match.index > last) parts.push({ type: "text", value: value.slice(last, match.index) });
        if (replacement) {
          parts.push(...replacement);
          changed = true;
        } else {
          parts.push({ type: "text", value: match[0] });
        }
        last = match.index + match[0].length;
      }

      if (!changed) return;
      if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
      ctx.replaceNode(node as never, parts);
    },
  };
}
