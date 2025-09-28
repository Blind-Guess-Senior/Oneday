

```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE contains(category, "动漫")
WHERE score >= 1 AND score <= 5
SORT score DESC, file.name ASC
```

# 
