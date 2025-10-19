

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "游戏")
WHERE status = "未完成"
SORT file.name ASC
```

# 
