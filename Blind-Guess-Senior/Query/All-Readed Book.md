
# Non-Classic-Fin 非补完计划
```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
WHERE !contains(tags, "经典补完计划")
SORT file.name ASC
```

# Classic-Fin 经典补完计划

```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
WHERE contains(tags, "经典补完计划")
SORT file.name ASC
```

# All Readed 所有
```dataview
LIST
FROM "Blind-Guess-Senior"
WHERE contains(category, "书籍")
WHERE status = "已完成"
SORT file.name ASC
```

# 


