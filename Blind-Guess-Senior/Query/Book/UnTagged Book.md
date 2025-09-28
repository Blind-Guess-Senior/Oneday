
# Without Country Book
```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE !country
WHERE contains(category, "书籍") OR contains(category, "漫画")
```

# Without Author Book

```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE !author
WHERE contains(category, "书籍") OR contains(category, "漫画")
```

# Without Tags Book

```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE !tags
WHERE contains(category, "书籍") OR contains(category, "漫画")
```
# 