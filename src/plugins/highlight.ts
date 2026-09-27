

import type { MdastNode, MdastPluginDefinition, MdastVisitorContext } from "satteri";

const HIGHLIGHT_PATTERN = /==([^=\r\n]+)==/g;

export function highlightPlugin(): MdastPluginDefinition {
  return {
    name: "oneday-highlight",
    text(node: Readonly<{ value: string }>, ctx: MdastVisitorContext) {
      const value = node.value;
      if (!value.includes("==")) return;

      const parts: MdastNode[] = [];
      let last = 0;
      let changed = false;

      HIGHLIGHT_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = HIGHLIGHT_PATTERN.exec(value)) !== null) {
        if (match.index > last) parts.push({ type: "text", value: value.slice(last, match.index) });
        const mark: MdastNode = {
          type: "mark",
          data: { hName: "mark", hProperties: { class: "hl" } },
          children: [{ type: "text", value: match[1] ?? "" }],
        };
        parts.push(mark);
        changed = true;
        last = match.index + match[0].length;
      }

      if (!changed) return;
      if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
      ctx.replaceNode(node as never, parts);
    },
  };
}
