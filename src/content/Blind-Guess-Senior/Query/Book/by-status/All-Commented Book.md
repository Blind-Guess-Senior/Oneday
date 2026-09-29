

```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior/Book"
WHERE contains(category, "书籍")
WHERE completed = true
SORT release ASC, file.name ASC
```

# 
