
# 2025
```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2025
WHERE contains(category, "动漫")
SORT month ASC, release ASC
```

# 2024
```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2024
WHERE contains(category, "动漫")
SORT month ASC, release ASC
```

# 2023
```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2023
WHERE contains(category, "动漫")
SORT month ASC, release ASC
```

# Unknown Year
```dataview
TABLE WITHOUT ID
 file.link AS 番名, release AS 年份, type AS 形式, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE !year
WHERE contains(category, "动漫")
SORT release ASC
```

# 