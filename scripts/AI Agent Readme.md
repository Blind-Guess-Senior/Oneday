# AI Agent Readme

如果你是一个AI Agent，请你阅读这个文档，这个文档将会向你描述Oneday这一网站是如何根据仓库中的评测文本和配置文件运作的。

## 项目思路

Oneday是一个评测网站，它包含游戏、动漫、书籍等等很多可自定义的领域内的评测，有多位评测者提供评测原稿。每份原稿都隶属于其评测者的文件夹内，并由一些特定的配置文件来决定它所属的领域等。

网站提供根据领域、评测者、分数、tag等的分类筛选功能。

github action将通过读取仓库根目录下的各种文件夹和文件来构建网站。构建网站的核心脚本是 `scripts/build_site.py`.

仓库通过评测作者来组织，每个评测作者都有一个自己的文件夹，位于根目录。例如 `Blind-Guess-Senior/` `Aspark/`.

根目录下除了 `.git` `.github` `.obsidian` `assets` `scripts` 这几个特殊文件夹，其他文件夹都是潜在的评测作者文件夹。

### 评测作者文件夹内的重要文件

- **reviewer_config.toml**

  位于评测作者文件夹顶层。
  
  这个文件标识了该评测作者文件夹内的子文件夹中，哪些属于哪个领域。被这个文件标识的文件夹内的文件都被视为 **评测** 。

  特别地，如果一个潜在评测作者文件夹内不存在这个文件，说明这不是一个潜在作者文件夹。这一判断方法有助于避免在构建脚本中写过多的特判。

  同时，如果一个文件不包含在 `reviewer_config.toml` 的 `[categories]` 指示的文件夹内，说明这个文件与网站构建无关，它应该被忽略。
  
  这个文件的格式形如：

  ```toml
  [categories]
  "CategoryName1" = ["FolderName1"]
  "CategoryName2" = ["FolderName2"]
  "CategoryName3" = ["FolderName3", "FolderName4"]
  ```
  
  其中 `CategoryName` 是最终显示在网站分类中的分类名，`FolderName` 是文件夹名字，标明这个文件夹应当属于等号前的分类。一个分类可以包含多个文件夹。

  一个示例：

  ```toml
  [categories]
  "动漫" = ["Anime"]
  "书籍" = ["Book"]
  "游戏" = [
    "小众变态测评/二游与竞技",
    "小众变态测评/游戏",
    "小众变态测评/未完成",
  ]
  ```

  其中 `游戏` 分类表明该分类包含 `评测者文件夹/小众变态测评/二游与竞技` 和 `评测者文件夹/小众变态测评/游戏` 和 `评测者文件夹/小众变态测评/未完成` 三个文件夹。

  这个文件还可以配置仅评分文件的收录规则：

  ```toml
  [score_only]
  status = ["已完成", "全成就"]
  ```

  所有的 **评测** 文件分为两类：已完成和仅评分。已完成的文件仅用一种方法区分：metadata 中是否存在 `completed: true`。含有 `completed: true` 的就是已完成的文件。已完成的文件将会得到完整的渲染(后面细讲)。

  如果一个文件不是已完成文件，并且满足 `[score_only]` 的任意判定，则文件属于仅评分文件，不渲染正文，只渲染标记数据。上面的示例表示如果一个文件的 `status` metadata的值为 `已完成` 或 `全成就`，那么这满足仅评分文件的判定。

  如果 `[score_only]` 不存在，视为判定始终满足。

  这个文件还可以配置评分排序和评分阶层：

  ```toml
  [score]
  order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  tiers = [
    { values = [10, 9, 8, 7] },
    { values = [6, 5] },
    { values = [4, 3, 2, 1] },
  ]
  ```

  `score` metadata会被视为字符串显示。`order` 决定评分筛选选项的顺序和按评分排序时的顺序。如果没有 `order`，评分会按字符串排序。

  `tiers` 用于决定评分显示样式。第一项对应 `score-tier-1`，第二项对应 `score-tier-2`，以此类推。如果没有配置 `tiers`，评分不应用评分阶层样式。

- **reviewer_style.css**

  位于评测作者文件夹顶层。

  这个文件用于定义该评测作者自己的评分阶层样式。构建脚本会读取所有评测作者的 `reviewer_style.css`，生成 `generated/reviewer_styles.css`，并自动给样式加上评测作者作用域，避免不同评测作者之间的样式互相影响。

  示例：

  ```css
  .score-tier-1 {
    color: #16a34a;
  }

  .score-tier-2 {
    color: #cccc99;
  }

  .score-tier-3 {
    color: #dc2626;
  }
  ```

- **评测文本**

  一般地，评测文本是位于评测者文件内的markdown文件。markdown文件将被解析，提取出特殊标记数据(标记见下描述)和正文后渲染在网站上。

  评测页面大致长这样：

  ```text
  标题

  标记数据(若干行)
  形如：
  标记名 标记值 | 标记名 标记值 | ...
  标记名 标记值 | 标记名 标记值 | ...
  ----------
  正文
  ```
  
  这个markdown文件的典型结构如下：

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
  一些其他的自定义metadata: value
  ---
  正文
  ```

  其中被 `---` 包裹的是markdown的metadata。
  
  标题来自于文件名。

  如果正文开头存在第一个 fenced code block（形如被三个反引号包裹的代码块），它会被视为 `sub_scores`，在文章元信息下方单独渲染，不再作为正文的一部分渲染。
  
  标记数据中，有三项特殊的预定义标记数据：
  1. 评测者。标记名为 `评测者` 标记值为评测者文件夹的名字
  2. 评分。标记名为 `评分` 标记值为 `score` metadata的值
  3. tags。标记名为空 标记值为 `tags` metadata的值
  
  除了评测者一定存在外，另外两个可能不存在。

  另外，有两个保留metadata不会作为普通自定义标记数据处理：
  1. `completed`。bool值。`completed: true` 表示该评测是已完成文件，将渲染完整正文。
  2. `aka`。列表。表示作品标题的别名。首页卡片会在作品名称下方显示第一个别名；进入文章页后，会在标题下方显示所有别名。

- **评测文本的自定义标记数据** & **reviewer_config.toml 的 metadata_maps**

  评测文本支持自定义标记数据。自定义标记数据规则存储于评测作者文件夹顶层的 `reviewer_config.toml` 中，位于 `[metadata_maps]` 下。
  
  `metadata_maps` 以分类名为作用域。同一个分类只有一套自定义标记数据规则，即使这个分类包含多个文件夹，也使用同一套规则。如果某个分类没有配置 metadata map，说明没有自定义标记数据。

  不是预定义标记数据且没有被自定义的metadata值会被忽略。

  格式如下：

  ```toml
  [metadata_maps]
  "游戏" = [
    { keys = ["developer"], label = "开发商" },
    { keys = ["publisher"], label = "发行商" },
    { keys = ["year", "month"], separator = ".", label = "游玩时间" },
  ]
  ```

  其中 `keys` 表明标记值来自哪些 metadata。单个 key 会直接显示该 metadata 的值；多个 key 会按 `separator` 组合。如果未提供 `separator`，默认使用 `.`。例如 `游玩时间` 标记名的标记值将是metadata的 `year` 和 `month` 项以 `.` 组合，例如 `2026.3`.

- **Standard**

  位于评测作者文件夹顶层，其下结构为 `Standard/分类名/`.

  该文件夹用于存放评分标准页面，作用于该评测者的对应分类。一个分类下可以有多个评分标准文件。

  评分标准文件的全部内容都视为正文, 不读取metadata。

### scripts文件夹

`scripts` 文件夹存储构建网站需要的东西，主要是 `build_site.py`. 但其中还有配置文件需要特别提到。

- **site_config.toml**

  位于 `scripts/site_config.toml`.

  这个文件用于存储全站配置。目前它用于标识tags都属于哪种类型。tags所属的类型没有实际意义，仅用于在网站首页显示tags筛选的时候排的好看一点。

  格式示例：

  ```toml
  [tag_types.1]
  "游戏" = ["ARPG", "类银河城"]
  "动漫" = ["漫改", "轻改"]
  "书籍" = ["科幻", "奇幻"]

  [tag_types.2]
  "游戏" = ["解谜", "类魂"]
  "动漫" = []
  "书籍" = ["自然+动物"]
  ```

  `自然+动物` 这样的写法表示tag别名：`动物` 会被合并为 `自然`。

### 网站的筛选

  网站提供若干方法来筛选评测。

- 分类筛选
  
  根据 `reviewer_config.toml` 给定的分类来筛选评测。

  单选。

- 评测者筛选

  根据评测者来筛选评测。

  多选则需都满足。

- 评分筛选

  根据评分来筛选评测。

  选定至少一个评测者后才出现，每个评测者会有自己的一条评分筛选。例如评测者选定 `Blind-Guess-Senior` 和 `Aspark`, 分数选定 `Blind-Guess-Senior` 的 `10` 分，那么将会显示 `Blind-Guess-Senior` 的 `10` 分评测和 `Aspark` 的所有评测。

  多选则都显示。

- tags筛选

  根据tags来筛选评测。

  选定分类后才出现。

  多选则需满足所有tags才显示。

### Aspark 特判

  Aspark 的评分（★）会直接出现在文件名中，尽管 metadata 中已经有 `score` 字段。当处理 Aspark 的评测时，需要清理掉末尾的★，不使其进入评测标题。
