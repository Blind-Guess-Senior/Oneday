

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, year AS 年份, score AS 评分, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE status = "全成就"
SORT year DESC, month DESC
```

# 
