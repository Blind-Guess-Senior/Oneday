/**
 * 筛选与排序的语义测试。
 *
 * 这套逻辑是旧前端 `homeList` / `compareScore` 的移植，行为必须逐条对齐，
 * 所以把边界固定下来：`node --test src/lib/filter.test.ts`（或 `npm test`）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Card, type Filters, emptyFilters, filterCards, pageWindow, sortCards } from "./filter.ts";

function card(overrides: Partial<Card>): Card {
  return {
    url: "/u",
    title: "T",
    aka: [],
    reviewer: "A",
    category: ["游戏"],
    tags: [],
    score: "",
    rank: null,
    tier: null,
    scoreOnly: false,
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
