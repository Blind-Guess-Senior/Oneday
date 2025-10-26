

```dataviewjs
const pages = dv.pages('"Blind-Guess-Senior/Book"')
  .where(p => p.status == "已完成")
  .where(p => p.category.contains("书籍"))
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
      row.country,
      row.author,
      row.score,
      row.tags
    ]);
  
  dv.table(["书名", "国家", "作者", "评分", "标签"], tableData);
  dv.paragraph("");
}
```


# 