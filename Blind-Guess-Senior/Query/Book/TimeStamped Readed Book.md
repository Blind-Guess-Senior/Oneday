
# 2025
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2025
WHERE contains(category, "书籍")
SORT month ASC
```

# 2024
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2024
WHERE contains(category, "书籍")
SORT month ASC
```

# 2023
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2023
WHERE contains(category, "书籍")
SORT month ASC
```

# 2022
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE year = 2022
WHERE contains(category, "书籍")
SORT month ASC
```

# Unknown Year
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE status = "已完成"
WHERE !year
WHERE contains(category, "书籍")
SORT file.name ASC
```

# 