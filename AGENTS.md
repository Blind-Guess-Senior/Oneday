# AI Agent Readme

如果你是 AI Agent，请先读这份文档。它描述 Oneday 这个评测网站现在是怎么运作的。
网站是 Astro 静态站点：构建期读仓库、渲染 markdown、产出 `dist/`。

---

## 0. 绝对准则

禁止对简单任务做测试。

禁止对UI做测试。

禁止在用户需求/设计还未确定时深入探究数据。

禁止随意衍生用户要求。

绝对遵循用户要求。

禁止随意push.

当这个commit是因为上个commit做错而对其的修正，应当合并这两个commit.

修改此文档时，禁止增添无意义描述。包括但不限于防呆式声明、对 deprecated 写法的 diff 描述等。

## 1. 总览

仓库同时是**内容仓库**和**站点工程**：

- `src/content/<作者>/…` 是内容，由作者用 Obsidian 维护；
- `src/` 其余部分是 Astro 工程（页面、布局、loader、插件、配置）；
- GitHub Actions 每次 push 到 `main` 就 `astro build`，把 `dist/` 发布到
  <https://blind-guess-senior.github.io/Oneday/>。

**加作者、加分类、加 tag、写评测，都不需要改任何代码**：「什么算评测」「怎么显示」
由 TOML 配置和 frontmatter 决定。

---

## 2. 仓库结构

```
├─ astro.config.ts            站点配置（base = /Oneday，markdown 插件、vue 集成）
├─ src/
│  ├─ content/                ← 内容根，同时也是 Obsidian vault 根
│  │  └─ <作者>/              ← 作者目录
│  ├─ config/                 全站配置（site.toml、tags.toml、title_names.toml）
│  ├─ content.config.ts       两个集合：reviews / standards
│  ├─ styles/global.css       全站样式
│  ├─ lib/
│  │  ├─ config.ts            读 TOML、读 git 提交时间
│  │  ├─ vault.ts             扫描内容、收录判定、链接/附件索引
│  │  ├─ loader.ts            两个自定义 Content Layer loader
│  │  ├─ index-data.ts        首页岛屿要的数据，构建期算好
│  │  ├─ filter.ts            筛选 / 排序 / 分页，纯函数（有 .test.ts）
│  │  ├─ reviewer-styles.ts   作者评分档位配色 → 带作用域的 CSS
│  │  ├─ extra-meta.ts        metadata_maps → 额外元信息
│  │  ├─ report.ts            构建期报告收集与打印
│  │  └─ site.ts              SITE / BASE / URL 拼接 / slug 生成
│  ├─ plugins/
│  │  ├─ obsidian.ts          ![[图片]] 与 [[链接#小节|别名]]
│  │  └─ highlight.ts         ==高亮== → <mark class="hl">
│  ├─ components/ReviewBrowser.vue   首页那个筛选岛屿
│  ├─ layouts/Layout.astro
│  └─ pages/
│     ├─ index.astro          首页（Vue 岛屿）
│     ├─ [...slug].astro      评测页（零 JS）
│     └─ standard/[...slug].astro  评分标准页（零 JS）
└─ Utils/                     与站点无关的辅助脚本（Bangumi/Steam 转 md 等）
```

### 2.1 前端只有一处 JS

- 全站唯一的客户端 JS 是首页岛屿 `src/components/ReviewBrowser.vue`，`client:idle` 挂载：
  构建时先渲染成真 HTML，浏览器空闲后才由 Vue 接管。
- 岛屿要的数据由 `src/lib/index-data.ts` 构建期算好，通过 props 内联进页面，
  浏览器端不需要额外请求。
- 筛选/排序/分页的语义在 `src/lib/filter.ts` 的纯函数里，边界由 `src/lib/filter.test.ts`
  固定（`npm test`）。**改筛选逻辑请同时改测试。**
- 文章页的标签链接指向 `/?tag=xxx`，岛屿启动后读取并预选。
- 样式在 `src/styles/global.css`。

`src/content/` 以外的目录（`Utils/`、`node_modules/`、`dist/` 等）不参与内容扫描。

---

## 3. 作者目录

**判据只有一个：这个目录里有没有 `reviewer_config.toml`。** 有就是作者目录，没有就当它不存在。

```
src/content/<作者>/
├─ reviewer_config.toml   必须，见第 4 节
├─ reviewer_style.css     可选，见第 4.4 节
├─ Standard/<分类>/*.md   可选，见第 4.3 节
└─ …作者的任意目录结构…   评测正文，由 include 决定收哪些
```

作者目录内部怎么组织（`by-name/`、`by-year/`、`by-series/`……）完全自由。

---

## 4. `reviewer_config.toml` 规格

### 4.1 「什么算评测」是正面清单

```toml
[[categories]]
name = "游戏"                                  # 显示名，用在筛选区和卡片徽章上
id_name = "Game"                               # URL 里用的分类段，保持 ASCII
include = ["Game/**/*.md"]                     # 评测候选。** 匹配零层或多层目录
standard = ["Standard/游戏/**/*.md"]           # 可选。评分标准

[[categories]]
name = "动漫"
id_name = "Anime"
include = ["Anime/**/*.md"]
standard = ["Standard/动漫/**/*.md"]
```

- `name` 显示用（中文），`id_name` URL 用（ASCII）。`id_name` 省略时回落到 slug 化的 `name`，
  并在构建日志的 `[提示]` 里提醒。
- 没有被任何 include 命中的文件一律不存在。
- `[[categories]]` 的书写顺序 = 首页侧栏的分类顺序。
- 一个文件可以同时命中多个分类（`category` 是数组，URL 用第一个）。

### 4.2 收录规则（候选 → 实际收录）

| 情况 | 结果 |
|---|---|
| 命中 include，且 frontmatter 有 `completed: true` | **完整收录**，渲染正文 |
| 命中 include，没有 `completed`，但命中 `[score_only]` 任一条件 | **仅评分收录**，只渲染元信息 |
| 其余 | 不算评测，完全忽略 |

```toml
[score_only]
status = ["已完成", "全成就"]
```

没有配 `[score_only]` 的分类，视为「全部收录为仅评分」。
「仅评分」不渲染正文，正文里的链接/图片不会出现在页面上。

### 4.3 评分标准页

`Standard/<分类>/*.md` 由 `standard` glob 收进来，渲染成 `/standard/<作者>/<分类>/<slug>/`。
没被 `standard` 命中的文件就是不存在。标准页 frontmatter 会被 Astro 剥掉。

### 4.4 `reviewer_style.css`

构建期只提取 `.score-tier-N { … }` 规则，并加上 `[data-reviewer="<作者>"]` 作用域：

```css
.score-tier-1 { color: #16a34a; }
```

### 4.5 评分顺序与档位

```toml
[score]
order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
tiers = [
  { values = [10, 9, 8, 7] },   # → score-tier-1
  { values = [6, 5] },          # → score-tier-2
  { values = [4, 3, 2, 1] },    # → score-tier-3
]
```

`score` 的值一律当字符串处理。`order` 决定筛选顺序和排序；`tiers` 决定套哪个档位样式。

### 4.6 自定义元信息（`metadata_maps`）

分类作用域：一个分类一套规则，命中多个文件夹也用同一套。

```toml
[metadata_maps]
"游戏" = [
  { keys = ["developer"], label = "开发商" },
  { keys = ["year", "month"], separator = ".", label = "游玩时间" },
]
```

- 单 key 直接显示该值；多 key 按 `separator`（默认 `.`）拼接。
- 没被预定义、也没在这里声明的 metadata 不显示（仍存在 entry 的 data 里）。

---

## 5. 评测 md 的格式

```markdown
---
score: 8
tags:
  - ARPG
  - 类魂
completed: true
aka:
  - Another Title
  - 另一个标题
year: 2026
month: 3
---

```
玩法★★★★
叙事★★★★
```

-----------------------------------------------------------

## 前言
正文……
```

- 标题来自文件名，再经 `title_names.toml` 的 `[title_names]` 映射（除非 frontmatter 写了 `title`）。
  `Aspark` 作者目录下末尾的 `★` 会被剥掉。
- 正文开头的第一个 fenced code block 按约定是 `sub_scores`，抽出来渲染在元信息下方。
- `aka` 是别名列表（卡片显示第一个，文章页显示全部）。
- `updated: 2026-03-08` 可选：写了就用它当「更新于」，不写取该文件 `git log --follow`
  的最近一次提交。只认 `YYYY-MM-DD`，写坏了当没写。

### 5.1 `[[wikilink]]`

路径必须**相对内容根、写全、不带 `.md`**，且精确匹配仓库里的文件；
解析不到就渲染成灰掉的 span 并在构建日志里列出。

```markdown
[[Blind-Guess-Senior/Book/by-series/冰菓/冰菓]]
[[Blind-Guess-Senior/Book/by-series/冰菓/冰菓|冰菓]]
[[Blind-Guess-Senior/TBA/The Blind Award 2025#游戏]]
```

`#小节` 转成标题锚点；显示文本缺省是路径最后一段，不一样就写 `|显示文本`。

### 5.2 `![[图片]]`

路径相对内容根、写全、带扩展名。

```markdown
![[Blind-Guess-Senior/Game/by-name/C/attachments/Cris Tales - 图1.png]]
```

图片走 Astro 图片管线；找不到文件时不渲染，并在构建日志里列为报告。

### 5.3 `==高亮==`

```markdown
这作 **==年度作品==**
```

渲染成 `<mark class="hl">`。

---

## 6. `src/config/` 规格

`site.toml` 是空的；配置按用途各占一个文件。

```toml
# tags.toml
[tag_rows.1]
"游戏" = ["ARPG", "类银河城+类银恶", "平台跳跃"]
"动漫" = ["漫改", "小说改+轻改"]
"书籍" = ["文集+短篇集+随笔集", "科幻"]

[tag_rows.2]
"游戏" = ["模拟经营", "像素"]
```

```toml
# title_names.toml：显示标题 = [文件里可能出现的名字, …]
[title_names]
"NieR:Automata™" = ["NieR-Automata™", "NieR Automata"]
```

- `[title_names]` 是多对一的：左边是页面上显示的标题，右边是文件名里可能出现的写法。
  标题、卡片、RSS、搜索都取映射后的标题；URL 的 slug 仍由文件里的名字生成。
- `[tag_rows.N]` 是第 N 排，只影响首页 tag 筛选区的排布。
- 分类名必须和 `reviewer_config.toml` 里的分类名一致：分排按分类生效，
  同一个 tag 在不同分类下可以落在不同排。
- 数组顺序 = 该分类下 tag 的显示顺序。
- `"主名+别名"` 表示别名并入主名（`"类银河城+类银恶"` → 写 `类银恶` 的评测会被当成 `类银河城`）。
- 数据里出现、但这里没声明的 tag 仍然会显示，追加在最后一排末尾，并在构建日志里用
  `[提示]` 列出来。

---

## 7. 构建管线

```
astro build
 └─ Content Layer
     ├─ reviewsLoader()    扫 src/content/*/reviewer_config.toml → 收录判定 → 渲染正文 → store
     └─ standardsLoader()  同上，收 standard glob 命中的文件
 └─ 页面渲染 → dist/
```

- 正文渲染走 Astro 7 的 markdown 管线（**satteri**，不是 remark/rehype），
  插件注册在 `astro.config.ts` 的 `markdown.processor`。
- 构建期的提示（`note()`）只用于「配置和数据对不上」：分类没写 `id_name`、
  数据里出现了 `tags.toml` 没声明的 tag。它不检查内容怎么写。

构建日志里你会看到：

```
[oneday:reviews] 评测 354 篇（完整 73 篇，仅评分 281 篇）
[oneday:reviews] [提示]（N 处，涉及 M 个文件）
  （明细：ONEDAY_REPORT=full npm run build）
[oneday:standards] 评分标准 6 份
```

---

## 8. URL 规则

```
评测    /Oneday/<作者>/<分类>/<slug>/
标准    /Oneday/standard/<作者>/<分类>/<slug>/
```

- `<作者>` = 作者目录名原样。
- `<分类>` = 第一个命中的分类的 `id_name`（`Game` / `Anime` / `Book`），
  进路径是为了让同作者同名作品不撞车。
- `<slug>` 由标题生成：只剔除 URL / 文件系统危险字符（`/ \ ? # % & = + < > | * : " ' \``），
  空白转 `-`，折叠连续 `-`，ASCII 转小写；CJK、全角标点、`∬`、`？` 一律保留。
  不要换成 `github-slugger`（会剥掉 `∬` `？`，曾导致 `五等分的花嫁∬` 与 `五等分的花嫁` 撞 URL）。
- 同一 `<作者>/<分类>` 下 slug 撞车 = 构建硬失败并点名两个文件。
  临时绕过：`ONEDAY_ALLOW_SLUG_COLLISION=1`（后者加 `-2` 后缀并记入报告）。
- 改站点 URL 前缀 = 改 `src/lib/site.ts` 的 `BASE`（`astro.config.ts` 也从这里读）。

---

## 9. 本地开发与部署

```bash
npm install
npm run dev        # 本地开发（注意下面 NODE_ENV 那条）
npm run build      # 产出 dist/
npm run preview    # 预览 dist/
```

部署由 `.github/workflows/pages.yml` 完成：`withastro/action@v5` + `node-version: 24`。
**`fetch-depth: 0` 是必须的**——loader 用 `git log` 取每篇评测的提交时间。

### 环境注意

- Node ≥ 24（用了内置的 `path.matchesGlob`）。
- Astro 遥测会往 `~/.config/astro` 写文件；受限环境里加 `ASTRO_TELEMETRY_DISABLED=1`。
- 受限环境里 npm 缓存要指到可写目录：`npm install --cache <可写目录>`。
- **`NODE_ENV` 不能是 `production`**：Astro 的 dev server 会以生产模式启动，`/_image`
  端点直接 500（`The dev image endpoint can only be used in dev mode.`），热更新也失效。
  本仓库开发环境预置了 `NODE_ENV=production`，本地起服务要用 `NODE_ENV=development npx astro dev`。
- 在 AI agent 里跑 `astro dev` 时它会自动后台化并写 `.astro/dev.json` 锁文件。
  想让它跑在前台，加 `--ignore-lock`（代价是 `astro dev stop/status/logs` 不管它）。

---

## 10. 已知的坑（改代码前务必读）

1. **内容缓存藏在 `node_modules/.astro/data-store.json`**（不是 `.astro/`）。
   `store.set()` 在 digest 与已有条目相同时会跳过写入
   （`node_modules/astro/dist/content/mutable-data-store.js` 里 `existing.digest === digest`）。
   所以 loader 的 `digest` 必须覆盖渲染产物，否则构建会一直吃旧 HTML。
   **改了渲染逻辑但行为没变，先删 `node_modules/.astro`。**
2. **Astro 的 `parseFrontmatter()` 没有 try/catch**。`renderMarkdown(content)` 会先对入参跑它，
   正则 `/(?:^\uFEFF?|^\s*\n)(?:---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/` 只认前三个字符，
   正文开头只要出现破折号行，后面全被当 YAML 解析，失败就炸掉整个构建。
   所以 `loader.ts` 的 `neutralizeLeadingRule()` 会把正文开头的 `-{3,}` 换成 `***`
   （两者在 markdown 里都是 `<hr>`）。
3. **satteri 的访问器是并发派发的**（`node_modules/satteri/dist/mdast/mdast-visitor.js` 的
   `visitMdastHandle` 一次性把所有匹配节点调进 JS），而 `ctx.replaceNode()` 是排队到命令缓冲区
   最后统一应用的。**异步访问器会让命令互相叠加**（实测一张图片被插入 4 次）。
   索引必须在插件的 `before` 钩子里预热（`ensureIndexes()`），访问器保持同步。
4. **不要给 entry 存 `body`**：同时提供 `body` 会让 Astro 用自己的管线重渲染 body、
   忽略 loader 提供的 `rendered`。图片相对 URL 要按「相对当前 md 文件所在目录」写，
   Astro 按 `entry.filePath` 的目录解析。
5. `store.set()` 必须显式传 `assetImports: rendered.metadata.imagePaths`，
   否则 `<img>` 会永远停在 `__ASTRO_IMAGE_` 中间态。
6. **改了 entry id（slug 规则、路由结构、分类 `id_name`）之后必须删 `node_modules/.astro`**：
   内容存储只按 key 更新，旧 id 的条目会残留在集合里，
   表现为 `dist/` 下同时出现新旧两套目录。

### 调试开关

| 环境变量 | 作用 |
|---|---|
| `ONEDAY_ALLOW_SLUG_COLLISION=1` | slug 撞车时不报错，后者加 `-2` 后缀 |
| `ONEDAY_REPORT=full` | 构建报告打印逐条明细，而不只是汇总行 |
