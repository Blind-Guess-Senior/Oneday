
# 2025
```dataview
TABLE file.name AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2025
WHERE contains(category, "书籍")
GROUP BY month AS 完成月份
SORT month ASC
```

# 