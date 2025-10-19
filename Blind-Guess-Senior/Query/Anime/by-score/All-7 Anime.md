

```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, year AS 观看年, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "动漫")
WHERE score = 7
SORT year DESC, release ASC, file.name ASC
```

# 
