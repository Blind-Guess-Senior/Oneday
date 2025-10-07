

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, year AS 年份, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE score = 6
SORT year ASC, file.name ASC
```

# 
