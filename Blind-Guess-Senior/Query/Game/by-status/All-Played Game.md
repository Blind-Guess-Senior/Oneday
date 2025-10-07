

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, year AS 年份, score AS 评分, status AS 状态, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE status = "全成就" OR status = "已完成"
SORT year ASC, month ASC
```

# 
