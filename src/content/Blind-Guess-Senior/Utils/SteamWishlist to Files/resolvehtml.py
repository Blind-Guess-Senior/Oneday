import re

def extract_steam_app_ids(html_string):
    """
    从HTML字符串中提取Steam应用ID

    参数:
        html_string: 包含Steam链接的HTML字符串

    返回:
        包含所有找到的Steam应用ID的列表
    """
    # 方法1: 直接匹配class="oVvbc-NOBF8-"前面的链接中的app ID
    # class需要根据实际情况改
    pattern1 = r'href="https://store\.steampowered\.com/app/(\d+)/[^"]*"[^>]*class="oVvbc-NOBF8-"'

    # 使用方法1进行匹配
    matches = re.findall(pattern1, html_string)

    return matches


# 使用示例
html_string = open("html.ignoredtxt", "r", encoding="utf-8").read()

app_ids = extract_steam_app_ids(html_string)
print(f"找到的应用ID: {app_ids}")  # 输出: 找到的应用ID: ['1206070']
print(len(set(app_ids)))

with open("appids.ignoredtxt", "w", encoding="utf-8") as f:
    f.write("\n".join(set(app_ids)))

