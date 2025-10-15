import json
import os

import requests
from soupsieve.util import lower

'''
Pre info
'''
with open("appids.ignoredtxt") as f:
    appids = [int(appid) for appid in f.read().splitlines()]

with open("steam_user_info.json") as f:
    user_info = json.load(f)

store_dir = user_info['Game_store_pos']
url = f'https://api.steampowered.com/ISteamApps/GetAppList/v2/'

'''
utils
'''


def write_yaml(appname):
    filename = appname.replace('/', '_').replace(':', '-') + '.md'
    first_letter = filename.upper()[0]
    if filename.startswith('The '):
        first_letter = filename[len('The '):].upper()[0]
    if first_letter.isdigit():
        first_letter = "-"
    dir_path = os.path.join(store_dir, 'by-name', str(first_letter))
    file_path = os.path.join(dir_path, filename)

    os.makedirs(dir_path, exist_ok=True)
    print('Writing to', file_path)
    print(appname)
    file = open(file_path, "w", encoding="utf-8")

    writelines = [
        "---\n",
        "status: 未完成\n"
        "score:\n",
        "year:\n",
        "month:\n",
        "category:\n",
        "  - 游戏\n",
        "tags:\n"
        "---\n"
    ]
    file.writelines(writelines)
    file.close()


'''
Request
'''
response = requests.get(url)
allApps = response.json()['applist']['apps']

for app in allApps:
    appid, appname = app['appid'], app['name']
    if appid in appids:
        write_yaml(appname)
