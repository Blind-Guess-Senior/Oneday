
```dataviewjs
const pages = dv.pages('"Blind-Guess-Senior"')
  .groupBy(p => p.file.mday);

const sortedGroups = pages
  .sort(g => g.key, 'desc')
  .slice(0, 5);

for (let group of sortedGroups) {
  dv.header(3, group.key);
  
  const tableData = group.rows
    .sort(b => b.file.mtime, 'desc')
    .map(row => [
      row.file.link,
      row.file.mtime?.toFormat("HH:mm") || "Unknown"
    ]);
  
  dv.table(["Link", "Last Modified"], tableData);
  dv.paragraph("");
}
```
