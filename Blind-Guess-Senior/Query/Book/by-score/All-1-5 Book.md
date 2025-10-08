

```dataview
TABLE WITHOUT ID
 file.link AS 书名, country AS 国家, author AS 作者, year AS 年份, tags AS 标签
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE score >= 1 AND score <= 5
SORT score DESC, year ASC, file.name ASC
```

# 
