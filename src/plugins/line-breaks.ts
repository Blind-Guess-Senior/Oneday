
import type { HastNode, HastPluginDefinition, HastVisitorContext } from "satteri";

/** `<br>` 每次现造一个，避免多个位置共用同一个节点对象。 */
function lineBreak(): HastNode {
  return { type: "element", tagName: "br", properties: {}, children: [] };
}

/** 代码块和行内代码里的换行是内容本身，不能变成 `<br>`。 */
function insideCode(node: Readonly<HastNode>, ctx: HastVisitorContext): boolean {
  let parent = ctx.parent(node);
  while (parent) {
    if (parent.type === "element" && (parent.tagName === "pre" || parent.tagName === "code")) return true;
    parent = ctx.parent(parent);
  }
  return false;
}

/**
 * 旧站是 `marked.parse(src, { breaks: true })`：段落里的单个换行就渲染成一次换行。
 * 放在 HAST 阶段做，这样 mdast 上的 wikilink / 高亮插件已经改完文本节点，不会抢同一个节点。
 */
export function lineBreakPlugin(): HastPluginDefinition {
  return {
    name: "oneday-line-breaks",
    text(node: Readonly<{ value: string }>, ctx: HastVisitorContext) {
      const value = node.value;
      if (!value.includes("\n")) return;
      if (insideCode(node as never, ctx)) return;

      const parts: HastNode[] = [];
      value.split("\n").forEach((line, index) => {
        if (index > 0) parts.push(lineBreak());
        if (line) parts.push({ type: "text", value: line });
      });
      if (!parts.length) return;
      ctx.replaceNode(node as never, parts);
    },
  };
}
