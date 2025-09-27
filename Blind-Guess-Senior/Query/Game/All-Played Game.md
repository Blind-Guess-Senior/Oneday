

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, status AS 状态
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE status = "全成就" OR status = "已完成"
SORT year ASC, month ASC
```

# 
