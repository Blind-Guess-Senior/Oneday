

```dataviewjs
const pages = dv.pages('"Blind-Guess-Senior/Game"')
  .where(p => p.status == "已完成" || p.status == "全成就")
  .where(p => p.category.contains("游戏"))
  .groupBy(p => p.year);

const sortedGroups = pages
  .sort(g => g.key, 'desc')

for (let group of sortedGroups) {
  const groupName = group.key ? group.key : "Unknown Year";
  dv.header(1, groupName);
  
  const tableData = group.rows
    .sort(b => b.month, 'desc')
    .map(row => [
      row.file.link,
      row.status,
      row.score,
      row.tags
    ]);
  
  dv.table(["游戏名", "状态", "评分", "标签"], tableData);
  dv.paragraph("");
}
```


# 