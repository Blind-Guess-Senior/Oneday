// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
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
  integrations: [vue(), sitemap()],
  markdown: {
    processor: satteri({
      mdastPlugins: [obsidianPlugin, highlightPlugin],
    }),
  },
});
