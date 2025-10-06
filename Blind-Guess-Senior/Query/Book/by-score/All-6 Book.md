

```dataview
TABLE WITHOUT ID
 file.link AS 书名, year AS 年份
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE score = 6
SORT year ASC, file.name ASC
```

# 
