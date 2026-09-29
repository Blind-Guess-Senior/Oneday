A Collection for some people's OneDay.

Website: https://blind-guess-senior.github.io/Oneday/

## How This Project Works

This project will automatically convert your markdown-typed article into a static webpage.

### Article Files

Firstly let's focus on an article file. An article file should be a markdown file (.md).

An article file should have a YAML frontmatter, which is a metadata part at the very front of the file, wrapped by `---`. e.g.
```yaml
---
status: 已完成
developer:
  - Sense Games
publisher:
  - CE-Asia
score: 8
year: 2025
month: 8
category:
  - 游戏
tags:
  - ARPG
  - 类魂
  - 末日
completed: true
updated: 2026-06-29
---
```

It's a sample from author *Blind-Guess-Senior*. The frontmatter contains reserved fields, custom fields and source-code-only fields. 

Some of the fields are predefined, while others can be custom. We will cover custom fields below.

The reserved fields are `completed` `tags` `score` `updated` `aka`.  
`completed` shows whether this article is finished. If this field isn't true, the article will be included as score only, or will not be included at all. Which is declared in `score_only` below.  
As the name suggests, `tags` shows which tags the work (the article's subject) has. It will be used in filtering and searching.  
`score` is your judgement on this work. It will be shown on the website and will be used in filtering.  
`updated` is used to keep the updated time of the article right. Generally, this is not necessary, because we still use the commit date to recognize the update time.  
`aka` defines this work's alias which will be used in searching. We will cover more in [akas](#akas).

The others are custom fields. You can let them show on the website, or just keep them there for yourself. We will cover them below. You can find `developer` `publisher` `year` `month` below.  
And it should be added that `category` is a useless field. It has nothing to do with the category we mentioned; category is not defined here; it is just a field for self-reference.

We will cover more about `tags` and `score` below.

Your filename should be the title of the work (which your article is about). Sometimes the work name contains symbols like `:` `?` which are not suitable for a filename. Don't worry. Just use another symbol to replace it. And you can refer to [entry-ids](#entry-ids) to find out how to make your article display correctly.

And in the main text, you can refer to all files under `src/content` folder (including articles, images and so on). Wikilink is supported, but you should make sure that the link's URL is path from `src/content`. Otherwise the link will be broken.

### Reviewer Configurations

To make yourself a reviewer (or an article author), just create a folder under `src/content/` named after your id.

Then put a `reviewer_definition.toml` in it. The program will find this file to recognize authors.

#### `reviewer_definition.toml`

The `[[categories]]` parts define how your article will be treated.

A category part should contain an `id` field, which you can find in `src/config/site.toml`, to declare which category the articles matched by the rules below belong to. It also needs an `include` field to declare where our website should go to find articles. Which means, you can organize your folder in any way you like.

For articles written by different authors, they may be judged by different standards. So you can also declare a `standard` field to refer to markdown files that contain your judgement standard.

Then, in the `score_only` part you can declare which unfinished articles should still be included. An article without `completed: true` will be included only if it matches one of the pairs here. e.g.
```toml
[score_only]
status = ["已完成", "全成就"]
```
An article whose `status` is `已完成` or `全成就` will be included as a score-only article. A score-only article has its card and metadata on the website, but its main text is not rendered at all, so the links and images in it will never show.

An unfinished article which matches nothing here does not exist on the website. If you don't declare `score_only` at all, every article matched by `include` will be included as score only.

Then in the `score` part you can define your own score system. The `order` field is an array. Just put all your score representations in ascending order. The `tiers` field defines how your score should be treated. This is only for custom CSS right now, which will be covered below.

Finally, in the `metadata_maps` part you can define your own frontmatter fields' display style. It can convert a key to a label which will be displayed on the website. If a frontmatter field is neither a reserved field nor mapped metadata, it won't show on the website.

A sample map is below
```toml
[[metadata_maps]]
category_id = "Game"
rules = [
  { keys = ["developer"], label = "开发商" },
  { keys = ["publisher"], label = "发行商" },
  { keys = ["year", "month"], separator = ".", label = "游玩时间" },
]
```

This will only work for your articles that belong to the `Game` category. The `developer` key will be displayed as `开发商` on the website's metadata card. The `year` and `month` keys will be displayed as `游玩时间` while its value will be `year.month`.

Currently, there are only these two types of rules. If you want more, please just contact me or (better) make a PR.

#### entry-ids

Sometimes a work's name contains illegal characters like `:` `?`. In that case our filename cannot be the same as the work's name.

Our repo contains a site-level mapping (`src/config/by-category-id/<category>/entry-ids/`) to map filenames to the work's name. The work's name is recognized as `entry-id` in source code. The display name on the website is also the same as it.

To add an entry-id's mapping, you can directly edit `src/config/by-category-id/<category>/entry-ids/<first-letter>/entry-ids.toml`. Or, if you think this work is not popular, you can edit your own `<author>/config/by-category-id/<category>/entry-ids/<first-letter>/entry-ids.toml`. In that case, this mapping will only apply to your articles in that category, and never influence other authors'.  
Although it is recommended to put config under a first-letter folder, the sub folder won't affect anything. But you still need exactly one sub folder.

Please note that your config will override the site config. Which means if site config and your config both mapped a filename, your config will eventually take effect. e.g.
```toml
# site config in src/config/by-category-id/Game/entry-ids/A/entry-ids.toml
entry-ids = [
  { id = "ACE COMBAT 7: SKIES UNKNOWN", files = [
    "ACE COMBAT 7- SKIES UNKNOWN",
  ] },
]
```
```toml
# author config in src/content/<author>/config/by-category-id/Game/entry-ids/A/entry-ids.toml
entry-ids = [
  { id = "AAAAACE COMBAT 7: SKIES UNKNOWN", files = [
    "ACE COMBAT 7- SKIES UNKNOWN",
  ] },
]
```
Then your "ACE COMBAT 7- SKIES UNKNOWN" will be recognized and displayed as `AAAAACE COMBAT 7: SKIES UNKNOWN`. (Won't affect other authors' "ACE COMBAT 7- SKIES UNKNOWN". Theirs will still be `ACE COMBAT 7: SKIES UNKNOWN`.)  
And it should be added that `aka` is mapped by `entry-id`, so if you override `entry-id`, `aka` will not work with your special work.

If your filenames do not need any mapping, just leave them alone. Their `entry-id` will be the same as their filenames.

#### akas

Many times we want a work to be found by different names, like translations or aliases. So we have a.k.a.

That is similar to [entry-ids](#entry-ids). We still have global config and per-author config. But the difference is that since akas are not unique, these two won't override each other. That means your own aka definitions will work with global aka definitions well.  
And like `entry-ids` does, the per-author aka definitions won't affect other authors' articles.

Additionally, you can make a per-article aka with the `aka` field in frontmatter. This will only work for this single article and never pollute any others. Sometimes this is easier to write.  
The most important use of this is to change the order. In our index page, only the first aka will be shown. The order of akas is defined as `<per-article> -> <site config> -> <author config>`. So if you want a special aka to show in the index page, you need to use this.

#### tags

Tags are shown in the index page's filter area, row by row. The rows are defined in `src/config/by-category-id/<category>/tags.toml`. e.g.
```toml
[tag_rows]
Ignored = ["剧透"]
1 = [
  "ARPG",
  { "类银河城" = ["类银恶"] },
]
2 = ["模拟经营", "像素"]
```
Every numeric key is a row, and its value is the list of tags of this row, in the same order. Writing a tag as `{ "类银河城" = ["类银恶"] }` means `类银恶` in the frontmatter is the same as `类银河城` and they will all be displayed as `类银河城`. It should be added that `类银恶` will also be unsearchable.

Only tags which are used by some article are shown. A used tag which isn't declared in any row will be put into a new row at the bottom.

`Ignored` is not a row. A tag in `Ignored` is dropped from the whole website. It won't show in cards, in the filter area, or in searching.

In your own `<author>/config/by-category-id/<category>/tags.toml`, only `Ignored` works. It will be appended to the site's list, and will never influence other authors'.

#### Custom CSS

Unfinished.

## Get Involved

You can directly contact me to be a collaborator, or you can use the method described below.

### Auto PR Merge

Unfinished.
