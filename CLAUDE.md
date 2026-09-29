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
│  ├─ config/                 全站配置（site.toml、by-category-id/<分类 id>/*.toml）
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
- 文章页的标签链接指向 `/?c=<分类 id>&t=<tag>`，岛屿启动后读取并预选。
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

分类定义在 `src/config/site.toml`（见第 6 节），作者配置只写分类 `id`：

```toml
[[categories]]
id = "Game"                                    # 必须是 site.toml 声明过的分类
include = ["Game/**/*.md"]                     # 评测候选。** 匹配零层或多层目录
standard = ["Standard/Game/**/*.md"]           # 可选。评分标准
```

- `id` 是分类唯一的身份：URL 段、`by-category-id/<id>/` 目录、`[metadata_maps]` 的
  `category_id` 都用它。显示名只在渲染时按 `id` 去 `site.toml` 查。
- 没有被任何 include 命中的文件一律不存在。
- `site.toml` 里 `[[categories]]` 的书写顺序 = 首页侧栏的分类顺序。
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

一条规则显式写明它作用于哪个分类；命中多个分类文件夹也用同一套。

```toml
[[metadata_maps]]
category_id = "Game"
keys = ["developer"]
label = "开发商"

[[metadata_maps]]
category_id = "Game"
keys = ["year", "month"]
separator = "."
label = "游玩时间"
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

- entry 的 id = 该分类 `entry-ids/<首字母>/entry-ids.toml` 里的 `id`；没写进去就是文件名本身
  （`Aspark` 作者目录下末尾的 `★` 先剥掉）。标题、URL 都取这个 id。
- 正文开头的第一个 fenced code block 按约定是 `sub_scores`，抽出来渲染在元信息下方。
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

`site.toml` 定义全站分类，顺序也是首页分类的顺序：

```toml
[[categories]]
id = "Game"
name = "游戏"
```

其余配置按分类放，一个分类一个目录：

```
by-category-id/<分类 id>/
├─ tags.toml
├─ akas/<首字母>/akas.toml
└─ entry-ids/<首字母>/entry-ids.toml
```

分桶只看 id 的第一个字符：字母归大写 `A`–`Z`，数字归 `0-9`，其余（CJK、假名……）归 `_`；
桶名不参与校验，放错桶照样读得到。文件缺了当空。

**分类之间完全隔离**：配置、tag、别名、entry id、aka 都只在本分类内成立，名字一样不代表有关系。

```toml
# by-category-id/Game/tags.toml
[tag_rows]
Ignored = ["剧透"]
1 = [
  "ARPG",
  { "类银河城" = ["类银恶"] },
]
2 = ["模拟经营", "像素"]
```

```toml
# by-category-id/Game/entry-ids/N/entry-ids.toml：id 同时就是显示名和 URL 的 slug
entry-ids = [
  { id = "NieR: Automata", files = ["NieR-Automata™"] },
]
```

```toml
# by-category-id/Game/akas/N/akas.toml
akas = [
  { id = "NieR: Automata", akas = ["尼尔：机械纪元"] },
]
```

作者可以在自己目录里放一份同结构的配置：
`src/content/<作者>/config/by-category-id/<分类 id>/{tags.toml, akas/…, entry-ids/…}`。
规则是**全站配置打底、作者的叠加，而且只对这个作者生效**：

- `tags.toml` 只能写 `[tag_rows] Ignored = [...]`，追加自己的忽略列表；写别的排不生效
  （构建日志里会提醒）。所以作者 A 忽略掉的 tag，作者 B 照样能用。
- `entry-ids` / `akas` 是补充和覆盖：同一个文件名（entry-ids）或同一个 `id`（akas）
  以作者的为准，别的作者不受影响。

- 目录名必须是 `site.toml` 里声明过的分类 id；对不上的目录是死配置，构建日志里会提醒。
- `entry-ids`：`id` 是 entry 的身份，同时也直接当显示名；没写进去的条目，id 就是文件名。
  `files` 列文件名里可能出现的写法（文件名不能带 `/ \ : * ? " < > |`）。
- `akas`：`id` → 别名。卡片显示第一个，文章页显示全部，搜索也匹配别名。
- `[tag_rows]`：数字键是筛选区里的第 N 排；`Ignored` 不是一排，里面的 tag 彻底不进站点
  （不上卡片、不进筛选、不参与搜索）。
- 每项要么直接写 tag 名，要么写 `{ "主名" = ["别名", …] }`：卡片上写别名也算主名。别名只在
  这张卡命中的分类里生效，和别的分类无关。
- 筛选区只列真有卡片在用的 tag；没在 `tags.toml` 里出现过的 tag 自动接成新的一排。
- 数组顺序 = 显示顺序。

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
- 构建期的提示（`note()`）只用于「配置本身有问题」：`site.toml` 的分类缺 `id` 或 `name`、
  `reviewer_config.toml` 引用了 `site.toml` 里没有的分类 `id`、`[metadata_maps]` 的
  `category_id` 不是 `site.toml` 里的分类、`by-category-id/` 下有对不上任何分类 `id` 的目录、
  作者的 `tags.toml` 写了 `Ignored` 以外的排。它不检查内容怎么写。

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
- `<分类>` = 第一个命中的分类的 `id`（`Game` / `Anime` / `Book`），
  进路径是为了让同作者同名作品不撞车。
- `<slug>` 由 entry id 生成：只剔除 URL / 文件系统危险字符（`/ \ ? # % & = + < > | * : " ' \``），
  空白转 `-`，折叠连续 `-`，ASCII 转小写；CJK、全角标点、`∬`、`？` 一律保留。
  不要换成 `github-slugger`（会剥掉 `∬` `？`，曾导致 `五等分的花嫁∬` 与 `五等分的花嫁` 撞 URL）。
- 同一 `<作者>/<分类>` 下 slug 撞车 = 构建硬失败并点名两个文件。
  临时绕过：`ONEDAY_ALLOW_SLUG_COLLISION=1`（后者加 `-2` 后缀并记入报告）。
- 改站点 URL 前缀 = 改 `src/lib/site.ts` 的 `BASE`（`astro.config.ts` 也从这里读）。

---

## 9. 本地开发与部署

```bash
npm install
npm run dev        # 本地开发
npm run build      # 产出 dist/
npm run preview    # 预览 dist/
```

部署由 `.github/workflows/pages.yml` 完成：`withastro/action@v5` + `node-version: 24`。
**`fetch-depth: 0` 是必须的**——loader 用 `git log` 取每篇评测的提交时间。

### 环境注意

正常机器上不需要任何环境变量，`npm install && npm run dev` / `npm run build` 直接可用。
下面这几条只在受限环境（agent 沙箱：`$HOME` 只读、外部注入了 `NODE_ENV=production`）里才需要：

- Node ≥ 24（用了内置的 `path.matchesGlob`）。
- `NODE_ENV=production` 会让 dev server 以生产模式启动（`/_image` 直接 500、HMR 失效），
  也会让 `npm install` 跳过 devDependencies。绕过：`npm install --include=dev`、
  `NODE_ENV=development npx astro dev`。
- `$HOME` 不可写时，Astro 遥测会在 `~/.config/astro` 上 `mkdirSync` 失败、CLI 直接崩，
  要加 `ASTRO_TELEMETRY_DISABLED=1`；npm 缓存同理要 `--cache <可写目录>`。
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
6. **改了 entry id（slug 规则、路由结构、分类 `id`）之后必须删 `node_modules/.astro`**：
   内容存储只按 key 更新，旧 id 的条目会残留在集合里，
   表现为 `dist/` 下同时出现新旧两套目录。

### 调试开关

| 环境变量 | 作用 |
|---|---|
| `ONEDAY_ALLOW_SLUG_COLLISION=1` | slug 撞车时不报错，后者加 `-2` 后缀 |
| `ONEDAY_REPORT=full` | 构建报告打印逐条明细，而不只是汇总行 |
