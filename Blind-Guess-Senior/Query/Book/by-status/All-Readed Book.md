
# Non-Classic-Fin 非补完计划
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, year AS 年份, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
WHERE !contains(tags, "经典补完计划")
SORT file.name ASC
```

# Classic-Fin 经典补完计划

```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, year AS 年份, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
WHERE contains(tags, "经典补完计划")
SORT file.name ASC
```

# All Readed 所有
```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, year AS 年份, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
SORT file.name ASC
```

# 


