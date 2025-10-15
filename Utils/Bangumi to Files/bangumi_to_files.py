import os
import sys
import requests
import json

with open("bangumi_user_info.json") as user_file:
    user_info = json.load(user_file)

headers = {
    "User-Agent": "Blind-Guess-Senior/Oneday (https://github.com/Blind-Guess-Senior/Oneday)"
}

if user_info.keys().__contains__("access_token"):
    headers["Authorization"] = f"Bearer {user_info['access_token']}"

'''
var define
'''
limit = 30
entriesCnt = 0
currentPage = 0
# Type 123 for ttodo done doing
params = {"subject_type": 2, "limit": limit, "offset": currentPage}
url = f"https://api.bgm.tv/v0/users/{user_info['username']}/collections"

status = user_info['status']
mediaType = user_info['media_type']
type_mapping = {'TV': 'TV', 'OVA': 'OVA', '剧场版': '剧场版'}

series_tags = user_info["series_tags"]  # Series tag


def write_yaml(write_data):
    if write_data["filename"] == "":
        return

    if write_data["series"]:
        dir_path = os.path.join('by_series', write_data["series"])
        file_path = os.path.join('by_series', write_data["series"], write_data['filename'])
    else:
        dir_path = os.path.join('by_year', write_data["release"])
        file_path = os.path.join('by_year', write_data["release"], write_data['filename'])

    os.makedirs(dir_path, exist_ok=True)
    file = open(file_path, "w", encoding="utf-8")

    writelines = [
        "---\n",
        f"status: {write_data['status']}\n"
        f"release: {write_data['release']}\n"
        f"type: {write_data['type']}\n",
        f"score: {write_data['score']}\n",
        f"year: {write_data['year']}\n",
        f"month: {write_data['month']}\n",
        "category:\n",
        "  - 动漫\n",
        "tags:\n"
    ]
    for tag in write_data['tags']:
        writelines.append(f"  - {tag}\n")

    writelines.append("---\n")

    if write_data["comment"]:
        writelines.append(f"{write_data['comment']}")

    file.writelines(writelines)


'''
DO ToWatch List
'''
params["type"] = 1

for CollectionType in range(1, 6):
    # Set CollectionType
    params["type"] = CollectionType

    while True:

        params['page'] = currentPage

        toWatches = requests.get(url=url, headers=headers, params=params)

        if toWatches.status_code != 200:
            print("Something went wrong, We do not get page")
            input("Press any key to continue...")
            sys.exit()

        data = toWatches.json()
        entries = data['data']
        entriesCnt += len(data["data"])

        for entry in entries:
            towrite_data = {
                "filename": "",
                "status": status[CollectionType],
                "release": "",
                "type": "",
                "score": "",
                "year": "",
                "month": "",
                "tags": [],
                "comment": "",
                "series": ""
            }

            tags = entry['tags']
            subject = entry['subject']

            # filename
            towrite_data['filename'] = subject['name_cn']
            # release
            towrite_data['release'] = subject['date'].split('-')[0]
            # type
            tag_count = {tag['name']: tag['count'] for tag in subject['tags']
                         if tag['name'] in mediaType}

            towrite_data['type'] = type_mapping[max(tag_count, key=tag_count.get)]
            # normal tag
            category = None
            convertFromTag = [tag for tag in tags if tag.endswith('改')]
            toWatchTag = [tag for tag in tags if tag.endswith('类')]

            series_tags_found = [tag for tag in tags if tag in series_tags]
            series_found = len(series_tags_found) > 0
            if series_found:
                series = series_tags_found[0]

            # to watch: tag
            if CollectionType == 1:
                if toWatchTag != "":
                    towrite_data['tags'].extend(toWatchTag)

            if convertFromTag:
                towrite_data['tags'].extend(convertFromTag)

            # watched: score & year & month & comment
            if CollectionType == 2:
                towrite_data['score'] = entry['rate']
                towrite_data['year'] = entry['updated_at'].split('-')[0]
                towrite_data['month'] = entry['updated_at'].split('-')[1]
                towrite_data['comment'] = entry['comment']

        if data["total"] <= entriesCnt:
            break

    currentPage += 1

entriesCnt = 0
currentPage = 0

print(toWatches.json())
