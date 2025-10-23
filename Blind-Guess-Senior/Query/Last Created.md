
```dataviewjs
const pages = dv.pages('"Blind-Guess-Senior"')
  .groupBy(p => p.file.cday);

const sortedGroups = pages
  .sort(g => g.key, 'desc')
  .slice(0, 3);

for (let group of sortedGroups) {
  dv.header(3, group.key);
  
  const tableData = group.rows
    .sort(b => b.file.ctime, 'desc')
    .map(row => [
      row.file.link,
      row.file.ctime?.toFormat("HH:mm") || "Unknown"
    ]);
  
  dv.table(["Link", "Last Created"], tableData);
  dv.paragraph("");
}
```
