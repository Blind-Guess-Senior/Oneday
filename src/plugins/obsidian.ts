

import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug as slugify } from "github-slugger";
import type { MdastNode, MdastPluginDefinition, MdastVisitorContext, PluginFactoryContext } from "satteri";
import { CONTENT_ROOT } from "../lib/config";
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
  const fileDir = contentRel ? path.posix.dirname(contentRel) : "";

  function makeImage(target: string): MdastNode[] | null {
    const lookup = findAttachmentSync(target);
    if (!lookup.rel) return null;
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
    if (!found) return null;

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
