// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import vue from "@astrojs/vue";
import { defineConfig } from "astro/config";
import { BASE, SITE } from "./src/lib/site";
import { highlightPlugin } from "./src/plugins/highlight";
import { obsidianPlugin } from "./src/plugins/obsidian";

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // 项目站点：整站挂在 https://blind-guess-senior.github.io/Oneday/ 下
  base: BASE,
  // 只有首页那一个筛选岛屿用 Vue；文章页和标准页是零 JS 的静态页
  integrations: [vue()],
  markdown: {
    // Astro 7 的 markdown 管线是 satteri，扩展点是 mdast/hast 插件而不是 remark/rehype。
    // 内置的图片收集、标题 id、图片打标插件会自动附加在用户插件之后，不会被顶掉。
    processor: satteri({
      mdastPlugins: [obsidianPlugin, highlightPlugin],
    }),
  },
});
