

```dataview
TABLE WITHOUT ID
 file.link AS 番名, year AS 年份
FROM "Blind-Guess-Senior"
WHERE contains(category, "动漫")
WHERE score >= 1 AND score <= 5
SORT score DESC, year ASC, file.name ASC
```

# 
