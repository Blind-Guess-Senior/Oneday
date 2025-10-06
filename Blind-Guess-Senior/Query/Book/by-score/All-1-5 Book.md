

```dataview
TABLE WITHOUT ID
 file.link AS 书名, year AS 年份
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE score >= 1 AND score <= 5
GROUP BY score
SORT score DESC, year ASC, file.name ASC
```

# 
