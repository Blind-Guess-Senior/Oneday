

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, year AS 年份
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE status = "全成就"
SORT year ASC, month ASC
```

# 
