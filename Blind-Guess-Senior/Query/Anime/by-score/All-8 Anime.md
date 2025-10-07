

```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "动漫")
WHERE score = 8
SORT year ASC, file.name ASC
```

# 
