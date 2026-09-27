import { defineCollection } from "astro:content";
import { reviewsLoader, standardsLoader } from "./lib/loader";

// 两个集合都由自定义 loader 填充，所以不声明 schema：
// frontmatter 的键是开放集合（`metadata_maps` 可以引用任意键），
// 用严格 schema 收口只会让写评测的人被类型系统卡住。
export const collections = {
  reviews: defineCollection({ loader: reviewsLoader() }),
  standards: defineCollection({ loader: standardsLoader() }),
};
