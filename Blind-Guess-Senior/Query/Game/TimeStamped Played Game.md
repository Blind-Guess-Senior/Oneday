
# 2025
```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, status AS 状态, score AS 评分, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成" OR status = "全成就"
WHERE year = 2025
WHERE contains(category, "游戏")
SORT month ASC
```

# 2024
```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, status AS 状态, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成" OR status = "全成就"
WHERE year = 2024
WHERE contains(category, "游戏")
SORT month ASC
```

# Unknown Year
```dataview
TABLE WITHOUT ID
 file.link AS 游戏名, status AS 状态, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成" OR status = "全成就"
WHERE !year
WHERE contains(category, "游戏")
SORT month ASC
```

# 