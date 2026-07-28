

```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior/Game"
WHERE contains(category, "游戏")
WHERE completed = true
SORT release ASC, file.name ASC
```

# 
