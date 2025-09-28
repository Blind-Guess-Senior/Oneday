

```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE score >= 1 AND score <= 5
GROUP BY score
SORT score DESC, file.name ASC
```

# 
