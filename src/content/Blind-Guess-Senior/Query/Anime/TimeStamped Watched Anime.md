

```dataviewjs
const pages = dv.pages('"Blind-Guess-Senior/Anime"')
  .where(p => p.status == "已完成")
  .where(p => p.category.contains("动漫"))
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
      row.release,
      row.type,
      row.score,
      row.tags
    ]);
  
  dv.table(["番名", "年份", "形式", "评分", "标签"], tableData);
  dv.paragraph("");
}
```


# 