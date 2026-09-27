# AI Agent Readme

如果你是 AI Agent，请先读这份文档。它描述 Oneday 这个评测网站现在是怎么运作的。
**站点已经不再是「把整个仓库原样发布出去 + 浏览器里现渲染 markdown」**，
现在是 Astro 静态站点：构建期读仓库、渲染 markdown、产出 `dist/`。

（这份文档取代了旧的 `scripts/AI Agent Readme.md`，旧文档描述的 Python 构建脚本已删除。）

---

## 1. 一句话总览

仓库同时是**内容仓库**和**站点工程**：

- `src/content/<作者>/…` 是内容，由作者用 Obsidian 维护；
- `src/` 其余部分是 Astro 工程（页面、布局、loader、插件、配置）；
- GitHub Actions 每次 push 到 `main` 就 `astro build`，把 `dist/` 发布到
  <https://blind-guess-senior.github.io/Oneday/>。

**设计原则：加作者、加分类、加 tag、写评测，都不需要改任何代码。**
一切「什么算评测」「怎么显示」都由 TOML 配置和 frontmatter 决定。

---

## 2. 仓库结构

```
├─ astro.config.ts            站点配置（base = /Oneday，markdown 插件、vue 集成）
├─ src/
│  ├─ content/                ← 内容根，同时也是 Obsidian vault 根
│  │  └─ <作者>/              ← 作者目录，见下
│  ├─ config/site.toml        全站配置（tag 分排与别名）
│  ├─ content.config.ts       两个集合：reviews / standards
│  ├─ styles/global.css       全站样式（沿用了旧站的 class 命名）
│  ├─ lib/
│  │  ├─ config.ts            读 TOML、读 git 提交时间
│  │  ├─ vault.ts             扫描内容、收录判定、链接/附件索引、全量审计
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
│     ├─ index.astro          首页（一个 Vue 岛屿，见第 7.1 节）
│     ├─ [...slug].astro      评测页（零 JS）
│     └─ standard/[...slug].astro  评分标准页（零 JS）
└─ Utils/                     与站点无关的辅助脚本（Bangumi/Steam 转 md 等）
```

### 2.1 前端只有一处 JS

整站只有**首页**有客户端 JavaScript，就是 `src/components/ReviewBrowser.vue` 这一个岛屿：

- 用 `client:idle` 挂载：构建时先被渲染成真 HTML（默认视图 30 张卡片），
  浏览器空闲后才加载 Vue 接管，所以没 JS 也能看、也能被搜索引擎抓。
- 岛屿要的数据由 `src/lib/index-data.ts` 在构建期算好，通过 props 内联进页面，
  浏览器端**不需要额外请求**。
- 筛选/排序/分页的语义全在 `src/lib/filter.ts` 的纯函数里，不依赖框架；
  边界由 `src/lib/filter.test.ts` 固定（`npm test`）。
  **改筛选逻辑请同时改测试。**
- 文章页和标准页是零 JS 的：评分标准面板用原生 `<details>`，
  文章页的标签是普通链接（指向 `/?tag=xxx`，岛屿启动后读取并预选）。
- 样式在 `src/styles/global.css`，**class 命名沿用旧站**（`.card`、`.sidebar`、
  `.article-meta-bar`、`.md-body`…），改样式时对着它改就行。

`src/content/` 以外的目录（`Utils/`、`node_modules/`、`dist/` 等）都不参与内容扫描。

---

## 3. 作者目录

**判据只有一个：这个目录里有没有 `reviewer_config.toml`。** 有就是作者目录，没有就当它不存在。

```
src/content/<作者>/
├─ reviewer_config.toml   必须。见第 4 节
├─ reviewer_style.css     可选。这个作者的评分档位配色，见第 4.4 节
├─ Standard/<分类>/*.md   可选。评分标准页，见第 4.3 节
└─ …作者的任意目录结构…   评测正文，由 reviewer_config.toml 的 include 决定收哪些
```

作者目录内部怎么组织（`by-name/`、`by-year/`、`by-series/`……）完全自由，
只要被 `include` 命中就行。新增作者 = 新建一个带 `reviewer_config.toml` 的目录，**不用改代码**。

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

- **`name` 和 `id_name` 是分开的**：显示用 `name`（中文），URL 用 `id_name`（ASCII，
  例如 动漫↔Anime、游戏↔Game）。`id_name` 省略时会回落到 slug 化的 `name`，
  并在构建日志的 `[提示]` 里提醒你补上。
- **没有任何 include 命中的文件一律不存在**——不需要、也不提供全局文件名黑名单。
- `[[categories]]` 的书写顺序 = 首页侧栏的分类顺序。
- 一个文件可以同时命中多个分类（`category` 是数组，URL 用第一个）。
- 想收一个以前不收的目录，加一行 `include` 就行，不要写代码特判。

### 4.2 收录规则（候选 → 实际收录）

| 情况 | 结果 |
|---|---|
| 命中 include，且 frontmatter 有 `completed: true` | **完整收录**，渲染正文 |
| 命中 include，没有 `completed`，但命中 `[score_only]` 任一条件 | **仅评分收录**，只渲染元信息，不显示正文 |
| 其余 | 不算评测，完全忽略 |

```toml
[score_only]
status = ["已完成", "全成就"]
```

如果一个分类没有配 `[score_only]`，视为「全部收录为仅评分」。

> 注意「仅评分」的评测正文**不会被渲染**，所以正文里的链接/图片不会出现在页面上；
> 它们仍然会被全量审计（第 7 节），所以写坏了照样能在构建日志里看到。

### 4.3 评分标准页

`Standard/<分类>/*.md` 由 `standard` glob 收进来，渲染成 `/standard/<作者>/<分类>/<slug>/`。
标准页的正文被渲染，frontmatter 会被 Astro 剥掉。
**没被 `standard` 命中的文件（例如 `Sub/` 下没声明的）就是不存在**，不要指望它自动出现。

### 4.4 `reviewer_style.css`

定义这个作者的评分档位样式。构建期只提取 `.score-tier-N { … }` 规则，
并自动加上 `[data-reviewer="<作者>"]` 作用域，避免作者之间互相影响。

```css
.score-tier-1 { color: #16a34a; }
.score-tier-2 { color: #cccc99; }
.score-tier-3 { color: #dc2626; }
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

分类作用域。一个分类一套规则，命中多个文件夹也用同一套。

```toml
[metadata_maps]
"游戏" = [
  { keys = ["developer"], label = "开发商" },
  { keys = ["year", "month"], separator = ".", label = "游玩时间" },
]
```

- 单 key 直接显示该值；多 key 按 `separator`（默认 `.`）拼接。
- **没被预定义、也没被这里声明的 metadata 会被忽略**（但仍然存在 entry 的 data 里）。

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

- **标题来自文件名**（除非 frontmatter 写了 `title`）。`Aspark` 作者目录下末尾的 `★` 会被剥掉，不进标题。
- **正文开头的第一个 fenced code block 按约定是 `sub_scores`**，会被抽出来单独渲染在元信息下方，不再作为正文的一部分。
- `completed: true` 表示完整收录；`aka` 是别名列表（首页卡片显示第一个，文章页显示全部）。
- 其余 frontmatter 键都是自由的，是否显示由 `metadata_maps` 决定。

### 5.1 `[[wikilink]]` 必须写完整路径

**只写文件名是不行的，解析器不做任何兜底。** 目标必须是**相对内容根的完整路径**，
精确匹配仓库里的文件；写成裸文件名一律当成坏链接，在构建报告里单列成
「非完整路径的 wiki 目标（应当为 0）」。

理由：按文件名/标题兜底会随内容重名而**默默指向另一个页面**（仓库里就有
`约会大作战` 的动画和轻小说两篇），而链接是内容，应该一眼能看出它指向哪个文件。

```markdown
[[Blind-Guess-Senior/Book/by-series/冰菓/冰菓]]           ← 对
[[Blind-Guess-Senior/Book/by-series/冰菓/冰菓|冰菓]]      ← 带显示文本
[[Blind-Guess-Senior/TBA/The Blind Award 2025#游戏]]      ← 带小节锚点
[[Hollow Knight]]                                        ← 错，裸文件名
```

- 路径是**相对内容根**的，不带 `.md`。
- `#小节` 会转成标题锚点（标题 id 由 Astro 自动生成，同一个 slugger）。
- 显示文本缺省是路径的最后一段。如果那和你想显示的不一样，就写 `|显示文本`。
- 解析不到的链接会渲染成灰掉的 span，**并在构建日志里列出**。

### 5.2 `![[图片]]` 也必须写完整路径

```markdown
![[Blind-Guess-Senior/Game/by-name/C/attachments/Cris Tales - 图1.png]]
```

- 同样是**相对内容根**的路径，带扩展名。
- **不要假定附件一定在 `attachments/` 目录下**：这个约定在仓库里本来就不统一
  （BGS 用 `<目录>/attachments/`，Aspark 用 `<目录>/游戏测评附件/` 等）。
  写之前先确认真实位置。
- 图片会被 Astro 的图片管线处理（sharp 转 webp、带 `width/height`、懒加载）。
- 找不到文件时图片不会渲染，并且**会在构建日志里列为报告**。

### 5.3 `==高亮==`

```markdown
这作 **==年度作品==**
```

渲染成 `<mark class="hl">`。

---

## 6. `src/config/site.toml` 规格

只放全站配置。目前只有 tag 的**分排与顺序**：

```toml
[tag_rows.1]
"游戏" = ["ARPG", "类银河城+类银恶", "平台跳跃"]
"动漫" = ["漫改", "小说改+轻改"]
"书籍" = ["文集+短篇集+随笔集", "科幻"]

[tag_rows.2]
"游戏" = ["模拟经营", "像素"]
```

- `[tag_rows.N]` 就是「第 N 排」，纯粹为了首页 tag 筛选区排得好看。
- **分类名必须和 `reviewer_config.toml` 里的分类名一致**，因为顺序和分排是**按分类生效**的
  （同一个 tag 在不同分类下可以落在不同排，例如 `战斗`：动漫第 2 排、书籍第 3 排）。
- 数组顺序 = 该分类下 tag 的显示顺序。
- `"主名+别名"` 表示别名并入主名（`"类银河城+类银恶"` → 写 `类银恶` 的评测会被当成 `类银河城`）。
- **数据里出现、但这里没声明的 tag 仍然会显示**，追加在最后一排末尾，
  并在构建日志里用 `[提示]` 列出来。这是刻意的：既不静默消失，又能暴露 frontmatter 里的拼写错误。

---

## 7. 构建管线

```
astro build
 └─ Content Layer
     ├─ reviewsLoader()    扫 src/content/*/reviewer_config.toml → 收录判定 → 渲染正文 → store
     └─ standardsLoader()  同上，收 standard glob 命中的文件
 └─ 页面渲染 → dist/
```

- **两个 loader 都是自定义的**，因为「什么算评测」由 TOML 决定，静态 glob 表达不了。
- 正文渲染走 Astro 7 的 markdown 管线（**satteri**，不是 remark/rehype），
  插件注册在 `astro.config.ts` 的 `markdown.processor`。
- 渲染完，`auditContent()` 会**扫描 vault 里所有 md**（不只被收录的评测，
  也包括 `Query/`、`TBA/`、`Templates/` 与未收录的评测），打成报告。
  必须扫全集：链接不做兜底，所以「非完整路径」是硬错误，得一个不漏。

构建日志里你会看到：

```
[oneday:reviews] 评测 354 篇（完整 73 篇，仅评分 281 篇）
[oneday:reviews] 全 vault 共 wikilink 622 处、图片嵌入 15 处；其中没写完整路径的 11 处
[oneday:reviews] [报告] 非完整路径的 wiki 目标（应当为 0）（N 处，涉及 M 个文件）
[oneday:reviews] [报告] 目标文件不存在的链接（N 处，涉及 M 个文件）
[oneday:reviews] [报告] 目标文件不存在的图片（N 处，涉及 M 个文件）
[oneday:reviews] [提示] 目标存在但未被收录（N 处，涉及 M 个文件）
  （明细：ONEDAY_REPORT=full npm run build）
[oneday:standards] 评分标准 6 份
```

**报告默认只打汇总行**，要看逐条清单就加 `ONEDAY_REPORT=full`。

> **合并进 main 的门槛**：「非完整路径的 wiki 目标」必须是 **0**。
> 目前还有 11 处（12 个出现位置），它们的**目标在仓库里根本不存在**，
> 所以没法改写成完整路径，需要内容侧决定（补文件 / 删链接）：
> - `Aspark/小众变态测评/游戏/未完成/Everlasting Summer★★.md` → `Pasted image 20260908162546.png`
> - `Aspark/小众变态测评/游戏/未完成/Rance02 -反逆の少女たち-★★.md` → `d11fc70a4d490d77f0ea42fb0e7c4e64.png`
> - `Aspark/小众变态测评/游戏/未完成/Rance03 -リーザス陥落-★★★★.md` → `ac64c49f…png`、`624131bf…png`
> - `Blind-Guess-Senior/Book/by-author/阿加莎·克里斯蒂/寓所谜案.md` → `[[七面钟之谜]]`、`[[死亡草]]`、`[[神秘的奎因先生]]`
> - `Blind-Guess-Senior/Book/by-author/阿加莎·克里斯蒂/蓝色列车之谜.md` → `[[犯罪团伙]]`、`[[悬崖山庄奇案]]`
> - `Blind-Guess-Senior/TBA/The Blind Award 2025.md` → `[[Terraria★★★★★]]`（两处）、`[[Eternal Senia★★★]]`
>   （TBA 那份的格式是「作品 | BGS 评测 | Aspark 评测」，★ 那侧指 Aspark 的评测，而 Aspark 没写过）
>
> 「目标存在但未被收录」是预期内的（TBA 不收录、`status: 未完成` 不补），看数量有没有突变即可。

---

## 8. URL 规则

```
评测    /Oneday/<作者>/<分类>/<slug>/
标准    /Oneday/standard/<作者>/<分类>/<slug>/
```

- `<作者>` = 作者目录名原样。
- `<分类>` = 第一个命中的分类的 **`id_name`**（ASCII，例如 `Game` / `Anime` / `Book`）。
  分类进路径让「轻小说 + 它的动画」这类同作者同名作品不再撞车，
  例如 `/Oneday/Blind-Guess-Senior/Anime/约会大作战/` 与
  `/Oneday/Blind-Guess-Senior/Book/约会大作战/`。
- `<slug>` 由标题生成：只剔除 URL / 文件系统危险字符（`/ \ ? # % & = + < > | * : " ' \``），
  空白转 `-`，折叠连续 `-`，ASCII 转小写；**CJK、全角标点、`∬`、`？` 等一律保留**。
  > 不要换回 `github-slugger`：它是为「标题锚点」设计的，会剥掉 `∬` `？` 这类有意义的字符，
  > 曾经导致 `五等分的花嫁∬` 与 `五等分的花嫁` 撞成同一个 URL。
- 同一 `<作者>/<分类>` 下 slug 撞车 = **构建硬失败**并点名两个文件。
  临时绕过：`ONEDAY_ALLOW_SLUG_COLLISION=1`（后者加 `-2` 后缀并记入报告）。
  正规修法是改标题/文件名。（覆盖表尚未实现。）

---

## 9. 本地开发与部署

```bash
npm install
npm run dev        # 本地开发
npm run build      # 产出 dist/
npm run preview    # 预览 dist/
```

部署由 `.github/workflows/pages.yml` 完成：`withastro/action@v5` + `node-version: 24`。
**`fetch-depth: 0` 是必须的**——loader 用 `git log` 取每篇评测的最近提交时间（用于「最近更新」排序）。

### 环境注意

- Node ≥ 24（用了内置的 `path.matchesGlob`）。
- Astro 遥测会往 `~/.config/astro` 写文件；受限环境里加 `ASTRO_TELEMETRY_DISABLED=1`。
- 受限环境里 npm 缓存要指到可写目录：`npm install --cache <可写目录>`。
- **`NODE_ENV` 不能是 `production`**，否则 Astro 的 dev server 会以生产模式启动：
  `/_image` 图片端点直接 500（日志：`The dev image endpoint can only be used in dev mode.`），
  热更新也失效。本仓库的开发环境预置了 `NODE_ENV=production`，所以本地起服务要用
  `NODE_ENV=development npx astro dev`。
- 在 AI agent 里跑 `astro dev` 时它会**自动把服务后台化**并写 `.astro/dev.json` 锁文件，
  杀不掉也停不干净。想让它老实跑在前台，加 `--ignore-lock`（代价是
  `astro dev stop/status/logs` 不管它）。

---

## 10. 已知的坑（改代码前务必读）

1. **内容缓存藏在 `node_modules/.astro/data-store.json`**（不是 `.astro/`）。
   `store.set()` 在 digest 与已有条目相同时会**跳过写入**
   （`node_modules/astro/dist/content/mutable-data-store.js` 里 `existing.digest === digest`）。
   所以 loader 的 `digest` **必须覆盖渲染产物**，否则改了插件/渲染逻辑也不会重新渲染，
   构建会一直吃旧 HTML。**改了渲染逻辑但行为没变，先删 `node_modules/.astro`。**
2. **Astro 的 `parseFrontmatter()` 没有 try/catch**。`renderMarkdown(content)` 会先对入参跑它，
   正则 `/(?:^\uFEFF?|^\s*\n)(?:---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/` 只认前三个字符，
   所以正文开头只要出现破折号行，后面全被当 YAML 解析，失败就**炸掉整个构建**。
   剥掉 sub_scores 代码块后正文经常正好以分隔线开头，因此 `loader.ts` 的
   `neutralizeLeadingRule()` 会把开头的 `-{3,}` 换成 `***`（两者在 markdown 里都是 `<hr>`）。
3. **satteri 的访问器是并发派发的**（`node_modules/satteri/dist/mdast/mdast-visitor.js` 的
   `visitMdastHandle` 一次性把所有匹配节点调进 JS），而 `ctx.replaceNode()` 是排队到命令缓冲区
   最后统一应用的。**异步访问器会让命令互相叠加**——实测一张图片被插入 4 次。
   所以索引必须在插件的 `before` 钩子里预热（`ensureIndexes()`），访问器保持同步。
4. **不要给 entry 存 `body`**。同时提供 `body` 会让 Astro 用自己的管线重渲染 body、
   忽略 loader 提供的 `rendered`。同理，图片相对 URL 要按「相对当前 md 文件所在目录」写，
   Astro 是按 `entry.filePath` 的目录解析的。
5. `store.set()` 必须显式传 `assetImports: rendered.metadata.imagePaths`，
   否则 `<img>` 会永远停在 `__ASTRO_IMAGE_` 中间态。
6. **改了 entry id（slug 规则、路由结构、分类 `id_name`）之后必须删 `node_modules/.astro`。**
   内容存储只按 key 更新，不会清理旧 key——旧 id 的条目会**残留在集合里**，
   于是同一篇评测会同时生成新旧两个页面。表现为 `dist/` 下同时出现两套目录，很迷惑。

### 调试开关

| 环境变量 | 作用 |
|---|---|
| `ONEDAY_DATA_DUMP=<路径>` | 把全部评测的 data 导出成 JSON（做行为对齐比对用） |
| `ONEDAY_ALLOW_SLUG_COLLISION=1` | slug 撞车时不报错，后者加 `-2` 后缀 |
| `ONEDAY_REPORT=full` | 构建报告打印逐条明细，而不只是汇总行 |

---

## 11. 常见任务

| 想做的事 | 怎么做 |
|---|---|
| 加一个评测 | 在作者目录里被 `include` 命中的位置新建 md，写好 frontmatter |
| 加一个作者 | 新建 `src/content/<作者>/` 并放一个 `reviewer_config.toml` |
| 加一个分类 | 在作者的 `reviewer_config.toml` 里加一个 `[[categories]]`（`name` + `id_name`） |
| 改分类的 URL 段 | 改该分类的 `id_name`（改完记得删 `node_modules/.astro`，见第 10 节第 6 条） |
| 收一个以前不收的目录 | 在对应的 `[[categories]]` 的 `include` 里加一条 glob |
| 加一个 tag | 直接在评测 frontmatter 里写；想控制排序就加进 `src/config/site.toml` |
| 改评分档位配色 | 改作者的 `reviewer_style.css` |
| 加评分标准 | 放进 `Standard/<分类>/`，确认被 `standard` glob 命中 |
| 改站点 URL 前缀 | `src/lib/site.ts` 的 `BASE`（`astro.config.ts` 也从这里读） |
