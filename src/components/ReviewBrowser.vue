<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildFilterSearch,
  categoryBadgeClass,
  filterCards,
  pageWindow,
  parseFilterSearch,
  sortCards,
  type Filters,
  type SortKey,
} from "../lib/filter";
import type { IndexPayload } from "../lib/index-data";
import { formatDate } from "../lib/site";

const props = defineProps<{ payload: IndexPayload }>();

const PAGE_SIZE = 30;
const TAG_LIMIT = 30;

const query = ref("");
const category = ref("");
const reviewers = ref<string[]>([]);
const scores = ref<Record<string, string[]>>({});
const tags = ref<string[]>([]);
const showScoreOnly = ref(false);
const showStandardsOnly = ref(false);
const showAllTags = ref(false);
const sidebarOpen = ref(false);
const sortBy = ref<SortKey>("modified");
const page = ref(1);

const filters = computed<Filters>(() => ({
  query: query.value,
  categoryId: category.value,
  reviewers: reviewers.value,
  scores: scores.value,
  tags: tags.value,
  showScoreOnly: showScoreOnly.value,
}));

/** 分类一律按 id 认，显示名只用来渲染。 */
function hasCategory(card: { categoryIds: string[] }, id: string): boolean {
  return card.categoryIds.includes(id);
}

/** 选了分类之后，只列该分类下有评测的评测者 */
const reviewersInCategory = computed(() => {
  if (!category.value) return props.payload.reviewers;
  return props.payload.reviewers.filter((reviewer) =>
    props.payload.reviews.some((card) => card.reviewer === reviewer && hasCategory(card, category.value)),
  );
});

const categoryTagRows = computed(() => (category.value ? props.payload.tagRows[category.value] ?? [] : []));
const allCategoryTags = computed(() => categoryTagRows.value.flat());
const visibleTags = computed(() =>
  showAllTags.value ? allCategoryTags.value : allCategoryTags.value.slice(0, TAG_LIMIT),
);
const visibleTagRows = computed(() =>
  categoryTagRows.value
    .map((row) => row.filter((tag) => visibleTags.value.includes(tag)))
    .filter((row) => row.length > 0),
);

const list = computed(() => {
  if (showStandardsOnly.value) {
    const needle = query.value.trim().toLowerCase();
    const matched = props.payload.standards.filter((standard) => {
      if (category.value && standard.categoryId !== category.value) return false;
      if (reviewers.value.length > 0 && !reviewers.value.includes(standard.reviewer)) return false;
      if (!needle) return true;
      return (
        standard.title.toLowerCase().includes(needle) || standard.reviewer.toLowerCase().includes(needle)
      );
    });
    return [...matched].sort((a, b) => a.title.localeCompare(b.title, "zh"));
  }
  return sortCards(filterCards(props.payload.reviews, filters.value), sortBy.value);
});

const totalPages = computed(() => Math.max(1, Math.ceil(list.value.length / PAGE_SIZE)));
const paged = computed(() => list.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageRange = computed(() => pageWindow(totalPages.value, page.value));

watch(list, () => {
  if (page.value > totalPages.value) page.value = 1;
});

// 取消勾选评测者时顺手丢掉它的分数选择，免得再勾回来时状态莫名其妙地"复活"
watch(reviewers, (selected) => {
  const kept: Record<string, string[]> = {};
  for (const [reviewer, chosen] of Object.entries(scores.value)) {
    if (selected.includes(reviewer)) kept[reviewer] = chosen;
  }
  scores.value = kept;
});

// 评分标准没有分数可排，切过去时把评分排序退回默认
watch(showStandardsOnly, (standardsOnly) => {
  if (standardsOnly && sortBy.value !== "title" && sortBy.value !== "modified") {
    sortBy.value = "modified";
  }
});

function scoreOptions(reviewer: string): string[] {
  return props.payload.scoreOptions[reviewer] ?? [];
}

function isScoreSelected(reviewer: string, score: string): boolean {
  return (scores.value[reviewer] ?? []).includes(score);
}

function toggleScore(reviewer: string, score: string): void {
  const current = scores.value[reviewer] ?? [];
  scores.value = {
    ...scores.value,
    [reviewer]: current.includes(score) ? current.filter((s) => s !== score) : [...current, score],
  };
  page.value = 1;
}

/**
 * 切换分类。
 *
 * 旧版这里会把评测者、分数、tag 全部清空，切一下就白选了。
 * 现在只做必要的清理：tag 池是按分类算的所以清掉；
 * 新分类下没有任何内容的评测者才取消勾选，其余的连同分数选择一起保留。
 */
function selectCategory(id: string): void {
  const next = category.value === id ? "" : id;
  category.value = next;
  tags.value = [];
  showAllTags.value = false;
  if (next) {
    reviewers.value = reviewers.value.filter((reviewer) =>
      props.payload.reviews.some((card) => card.reviewer === reviewer && hasCategory(card, next)),
    );
  }
  page.value = 1;
}

function toggleTag(tag: string): void {
  tags.value = tags.value.includes(tag) ? tags.value.filter((t) => t !== tag) : [...tags.value, tag];
  page.value = 1;
}

function resetFilters(): void {
  query.value = "";
  category.value = "";
  reviewers.value = [];
  scores.value = {};
  tags.value = [];
  showScoreOnly.value = false;
  showStandardsOnly.value = false;
  showAllTags.value = false;
  sortBy.value = "modified";
  page.value = 1;
}

/**
 * 把筛选状态同步到地址栏（用 replaceState，所以不会污染后退历史）。
 *
 * 好处：刷新不丢筛选、筛选结果可以直接分享、从评测页按后退能回到原来的筛选状态
 * （静态站的后退是一次真正的页面加载，读取地址栏即可）。
 */
function readUrlState(): void {
  const state = parseFilterSearch(window.location.search);
  query.value = state.query;
  category.value = props.payload.categories.some((entry) => entry.id === state.categoryId)
    ? state.categoryId
    : "";
  reviewers.value = state.reviewers;
  scores.value = state.scores;
  tags.value = state.tags;
  showScoreOnly.value = state.showScoreOnly;
  showStandardsOnly.value = state.showStandardsOnly;
  sortBy.value = state.sort;
  page.value = state.page;
}

function writeUrlState(): void {
  const search = buildFilterSearch({
    query: query.value,
    categoryId: category.value,
    reviewers: reviewers.value,
    scores: scores.value,
    tags: tags.value,
    showScoreOnly: showScoreOnly.value,
    showStandardsOnly: showStandardsOnly.value,
    sort: sortBy.value,
    page: page.value,
  });
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

watch([query, category, reviewers, scores, tags, showScoreOnly, showStandardsOnly, sortBy, page], writeUrlState, {
  deep: true,
});

onMounted(readUrlState);
</script>

<template>
  <div class="layout">
    <div class="sidebar-overlay" :class="{ open: sidebarOpen }" @click="sidebarOpen = false" />

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="filter-panel filter-left">
        <div class="filter-section">
          <div class="filter-title">分类</div>
          <div class="filter-options">
            <button
              v-for="entry in payload.categories"
              :key="entry.id"
              type="button"
              class="filter-option"
              :class="{ selected: category === entry.id }"
              @click="selectCategory(entry.id)"
            >
              {{ entry.name }}
            </button>
          </div>
        </div>

        <div v-if="reviewersInCategory.length" class="filter-section">
          <div class="filter-title">评测者</div>
          <div class="filter-options">
            <label v-for="reviewer in reviewersInCategory" :key="reviewer" class="filter-option">
              <input v-model="reviewers" type="checkbox" :value="reviewer" @change="page = 1" />
              {{ reviewer }}
            </label>
          </div>
        </div>

        <div v-if="!showStandardsOnly" class="filter-section">
          <div class="filter-title">分数筛选</div>
          <template v-if="reviewers.length">
            <div v-for="reviewer in reviewers" :key="reviewer">
              <div class="score-reviewer-label">{{ reviewer }}</div>
              <div class="score-chips">
                <button
                  v-for="score in scoreOptions(reviewer)"
                  :key="score"
                  type="button"
                  class="score-chip"
                  :class="{ selected: isScoreSelected(reviewer, score) }"
                  @click="toggleScore(reviewer, score)"
                >
                  {{ score }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="filter-panel filter-right">
        <div v-if="!showStandardsOnly && category && visibleTags.length" class="filter-section">
          <div class="filter-title">标签</div>
          <div v-for="(row, index) in visibleTagRows" :key="index" class="tag-group">
            <div class="tag-cloud">
              <button
                v-for="tag in row"
                :key="tag"
                type="button"
                class="tag-chip"
                :class="{ selected: tags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
          <button v-if="allCategoryTags.length > TAG_LIMIT" type="button" class="tag-toggle" @click="showAllTags = !showAllTags">
            {{ showAllTags ? "收起" : "显示更多标签" }}
          </button>
        </div>

        <div class="filter-section">
          <div class="filter-title">显示选项</div>
          <label class="filter-option">
            <input v-model="showScoreOnly" type="checkbox" @change="page = 1" />
            显示仅评分评测
          </label>
          <label class="filter-option">
            <input v-model="showStandardsOnly" type="checkbox" @change="page = 1" />
            显示评分标准
          </label>
        </div>

        <button type="button" class="filter-reset" @click="resetFilters">重置筛选</button>
      </div>
    </aside>

    <div class="main">
      <div class="toolbar">
        <button type="button" class="btn-filter-toggle" @click="sidebarOpen = !sidebarOpen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="16" y2="12" />
            <line x1="4" y1="18" x2="12" y2="18" />
          </svg>
          筛选
        </button>

        <div class="search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="query" placeholder="搜索标题、别名、标签…" @input="page = 1" />
        </div>

        <span class="toolbar-count">共 {{ list.length }} 条结果</span>
        <select v-model="sortBy" class="sort-select" @change="page = 1">
          <option value="modified">最近更新</option>
          <option v-if="!showStandardsOnly" value="score_desc">评分从高到低</option>
          <option v-if="!showStandardsOnly" value="score_asc">评分从低到高</option>
          <option value="title">标题</option>
        </select>
      </div>

      <div v-if="paged.length" class="cards-grid">
        <template v-if="showStandardsOnly">
          <a v-for="standard in paged" :key="standard.url" class="card" :href="standard.url">
            <div class="card-top">
              <span class="badge badge-default">评分标准</span>
            </div>
            <div class="card-title">{{ standard.title }}</div>
            <div class="card-meta">
              <span class="reviewer-name">{{ standard.reviewer }}</span>
              <span class="meta-dot">·</span>
              <span class="score-display">{{ standard.category }}</span>
            </div>
          </a>
        </template>

        <template v-else>
          <a v-for="card in paged" :key="card.url" class="card" :href="card.url">
            <div class="card-top">
              <span class="badge" :class="categoryBadgeClass(card.categoryIds)">
                {{ card.category[0] ?? "其他" }}
              </span>
            </div>
            <div class="card-title">{{ card.title }}</div>
            <div v-if="card.aka.length" class="card-aka">{{ card.aka[0] }}</div>
            <div class="card-meta">
              <span class="reviewer-name">{{ card.reviewer }}</span>
              <span class="meta-dot">·</span>
              <span
                class="score-display"
                :class="card.tier ? `score-tier-${card.tier}` : ''"
                :data-reviewer="card.reviewer"
              >
                {{ card.score || "未评分" }}
              </span>
              <span v-if="card.published" class="card-date">
                <time :datetime="card.published">{{ formatDate(card.published) }}</time>
              </span>
            </div>
            <div v-if="card.tags.length" class="card-tags">
              <span v-for="tag in card.tags.slice(0, 4)" :key="tag" class="card-tag">{{ tag }}</span>
              <span v-if="card.tags.length > 4" class="card-tag">+{{ card.tags.length - 4 }}</span>
            </div>
          </a>
        </template>
      </div>

      <div v-if="!paged.length" class="state-center">
        <div class="icon">🔍</div>
        <p>没有符合条件的结果</p>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button type="button" class="page-btn" :disabled="page === 1" @click="page--">‹</button>
        <template v-for="item in pageRange" :key="String(item)">
          <button v-if="item === '…'" type="button" class="page-btn" disabled>…</button>
          <button
            v-else
            type="button"
            class="page-btn"
            :class="{ active: item === page }"
            @click="page = Number(item)"
          >
            {{ item }}
          </button>
        </template>
        <button type="button" class="page-btn" :disabled="page === totalPages" @click="page++">›</button>
      </div>
    </div>
  </div>
</template>
