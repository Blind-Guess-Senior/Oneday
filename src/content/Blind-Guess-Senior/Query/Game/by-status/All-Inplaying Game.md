

```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, tags AS 标签
FROM "src/content/Blind-Guess-Senior/Game"
WHERE contains(category, "游戏")
WHERE status = "进行中"
SORT file.name ASC
```

# 
