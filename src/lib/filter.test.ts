

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Card,
  type Filters,
  buildFilterSearch,
  categoryBadgeClass,
  defaultUrlState,
  emptyFilters,
  filterCards,
  pageWindow,
  parseFilterSearch,
  sortCards,
} from "./filter.ts";

function card(overrides: Partial<Card>): Card {
  return {
    url: "/u",
    title: "T",
    aka: [],
    reviewer: "A",
    category: ["游戏"],
    categoryIds: ["Game"],
    tags: [],
    score: "",
    rank: null,
    tier: null,
    scoreOnly: false,
    published: "",
    modified: "",
    ...overrides,
  };
}

function filters(overrides: Partial<Filters>): Filters {
  return { ...emptyFilters(), ...overrides };
}

const cards: Card[] = [
  card({ title: "甲", reviewer: "A", score: "9", rank: 9, tier: 1, tags: ["恐怖", "解谜"], modified: "2026-01-01", aka: ["alpha"] }),
  card({ title: "乙", reviewer: "A", score: "3", rank: 3, tier: 3, tags: ["恐怖"], modified: "2026-02-01" }),
  card({ title: "丙", reviewer: "B", category: ["书籍"], score: "5", rank: 5, tier: 2, tags: ["恐怖"], modified: "2025-01-01" }),
  card({ title: "丁", reviewer: "B", scoreOnly: true, modified: "2026-03-01" }),
];

const titles = (list: Card[]): string[] => list.map((entry) => entry.title);

test("默认隐藏仅评分评测", () => {
  assert.deepEqual(titles(filterCards(cards, filters({}))), ["甲", "乙", "丙"]);
});

test("打开开关后包含仅评分评测", () => {
  assert.deepEqual(titles(filterCards(cards, filters({ showScoreOnly: true }))), ["甲", "乙", "丙", "丁"]);
});

test("分类是单选", () => {
  assert.deepEqual(titles(filterCards(cards, filters({ category: "书籍" }))), ["丙"]);
});

test("评测者多选取并集", () => {
  assert.deepEqual(titles(filterCards(cards, filters({ reviewers: ["A", "B"] }))), ["甲", "乙", "丙"]);
});

test("标签多选需全部满足", () => {
  assert.deepEqual(titles(filterCards(cards, filters({ tags: ["恐怖", "解谜"] }))), ["甲"]);
});

test("搜索覆盖标题、别名、标签、评测者", () => {
  assert.deepEqual(titles(filterCards(cards, filters({ query: "丙" }))), ["丙"]);
  assert.deepEqual(titles(filterCards(cards, filters({ query: "ALPHA" }))), ["甲"]);
  assert.deepEqual(titles(filterCards(cards, filters({ query: "解谜" }))), ["甲"]);
  assert.deepEqual(titles(filterCards(cards, filters({ query: "b" }))), ["丙"]);
});

test("分数筛选只对被选中的评测者生效，没选分数的评测者照常显示全部", () => {
  assert.deepEqual(
    titles(filterCards(cards, filters({ reviewers: ["A", "B"], scores: { A: ["9"] } }))),
    ["甲", "丙"],
  );
});

test("排序：最近更新（新→旧）", () => {
  assert.deepEqual(titles(sortCards(cards, "modified")), ["丁", "乙", "甲", "丙"]);
});

test("排序：评分用 order 里的排名，而不是档位；没排名的恒排最后", () => {
  assert.deepEqual(titles(sortCards(cards, "score_desc")), ["甲", "丙", "乙", "丁"]);
  assert.deepEqual(titles(sortCards(cards, "score_asc")), ["乙", "丙", "甲", "丁"]);
});

test("分页窗口两端 + 当前页附近，中间省略", () => {
  assert.deepEqual(pageWindow(3, 2), [1, 2, 3]);
  assert.deepEqual(pageWindow(20, 10), [1, "…", 9, 10, 11, "…", 20]);
  assert.deepEqual(pageWindow(20, 1), [1, 2, "…", 20]);
});

test("没配 order 时评分按数值比，\"10\" 不该排在 \"9\" 前面", () => {
  const numeric = [
    card({ title: "九", score: "9" }),
    card({ title: "十", score: "10" }),
    card({ title: "二", score: "2" }),
  ];
  assert.deepEqual(titles(sortCards(numeric, "score_desc")), ["十", "九", "二"]);
  assert.deepEqual(titles(sortCards(numeric, "score_asc")), ["二", "九", "十"]);
});

test("非数字评分退回字符串比较（星号等）", () => {
  const stars = [
    card({ title: "三星", score: "★★★" }),
    card({ title: "五星", score: "★★★★★" }),
  ];
  assert.deepEqual(titles(sortCards(stars, "score_desc")), ["五星", "三星"]);
});

test("徽章类名由分类 id 派生，加分类不用改代码", () => {
  assert.equal(categoryBadgeClass(["Game"]), "badge-game");
  assert.equal(categoryBadgeClass(["Anime"]), "badge-anime");
  assert.equal(categoryBadgeClass(["Book"]), "badge-book");
  assert.equal(categoryBadgeClass(["Visual Novel"]), "badge-visualnovel");
  assert.equal(categoryBadgeClass([]), "badge-default");
});

test("地址栏状态往返：默认值不写进 URL", () => {
  assert.equal(buildFilterSearch(defaultUrlState()), "");
});

test("地址栏状态往返：多值参数能来回", () => {
  const search = buildFilterSearch({
    ...defaultUrlState(),
    query: "恐怖",
    categoryId: "Game",
    reviewers: ["Aspark", "Blind-Guess-Senior"],
    scores: { Aspark: ["9", "8"] },
    tags: ["恐怖", "解谜"],
    showScoreOnly: true,
    sort: "score_desc",
    page: 3,
  });
  assert.deepEqual(parseFilterSearch(search), {
    query: "恐怖",
    categoryId: "Game",
    reviewers: ["Aspark", "Blind-Guess-Senior"],
    scores: { Aspark: ["9", "8"] },
    tags: ["恐怖", "解谜"],
    showScoreOnly: true,
    showStandardsOnly: false,
    sort: "score_desc",
    page: 3,
  });
});

test("地址栏状态：认不出的值回落默认，脏数据不炸", () => {
  const state = parseFilterSearch("?sort=nonsense&page=-4&s=缺冒号&s=:空评测者&only=0");
  assert.equal(state.sort, "modified");
  assert.equal(state.page, 1);
  assert.deepEqual(state.scores, {});
  assert.equal(state.showScoreOnly, false);
});
