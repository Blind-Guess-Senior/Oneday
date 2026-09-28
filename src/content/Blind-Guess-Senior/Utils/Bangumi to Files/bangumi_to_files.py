import hashlib
from datetime import datetime
import os
import sys
import requests
import json

with open("bangumi_user_info.json") as user_file:
    user_info = json.load(user_file)

headers = {
    "User-Agent": "Blind-Guess-Senior/Oneday (https://github.com/Blind-Guess-Senior/Oneday)"
}

# access_token get: https://next.bgm.tv/demo/access-token
if user_info.keys().__contains__("access_token"):
    headers["Authorization"] = f"Bearer {user_info['access_token']}"

'''
var define
'''
script_dir = user_info['Anime_store_pos']

stop_at = 9999
if user_info.keys().__contains__("stop_at"):
     stop_at = user_info['stop_at']

limit = 30
# Type 123 for ttodo done doing
params = {"subject_type": 2, "limit": limit}
url = f"https://api.bgm.tv/v0/users/{user_info['username']}/collections"

status = user_info['status']
mediaType = user_info['mediaType']
type_mapping = {'TV': 'TV', 'OVA': 'OVA', '剧场版': '剧场版'}

series_tags = user_info["series_tags"]  # Series tag

score_alias = ["", "精神污染", "有害垃圾", "不可回收", "实在一般", "不尽人意", "差强人意", "不虚此行", "强烈推荐",
               "此生难忘", "神"]

'''
utils
'''

update_record_file = os.path.join(script_dir, "update_records.json")


def load_update_records():
    if os.path.exists(update_record_file):
        with open(update_record_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_update_records(records):
    with open(update_record_file, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


# only use for compare
def parse_iso_date(date_str):
    try:
        # only keep date and time
        date_part = date_str.split('+')[0].split('T')[0]
        return datetime.fromisoformat(date_part.replace('T', ' ').split('+')[0])
    except:
        return datetime.min


def get_file_hash(file_path):
    return hashlib.md5(file_path.encode('utf-8')).hexdigest()


def write_yaml(write_data):
    global update_records

    if write_data["filename"] == "":
        return

    if write_data["series"] != "":
        dir_path = os.path.join(script_dir, 'by-series', str(write_data["series"]))
    else:
        dir_path = os.path.join(script_dir, 'by-year',
                                str(write_data["release"]) if write_data["release"] != "" else "Unknown")

    file_path = os.path.join(dir_path, write_data['filename'] + ".md")
    file_key = get_file_hash(file_path)

    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            f.readline()
            exist_status = f.readline().split(':')[-1].strip()
            # If an entry has been finished, never change it again
            if exist_status == status[2]:
                print(f"File {write_data['filename']} had been fin, skipping.")
                return
        # current time updated
        current_update = parse_iso_date(write_data["updated_at"])
        # last time updated
        recorded_update = parse_iso_date(update_records.get(file_key, '1970-01-01T00:00:00+08:00'))

        if current_update <= recorded_update:
            print(f"{file_path} already exists and is up-to-date, skipping.")
            return
        else:
            print(f"{file_path} exists but has newer data, updating...")
    else:
        print(f"{file_path} does not exist, creating...")

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

    if write_data["score"] != "":
        writelines.append(f"{write_data['score']}/10 {score_alias[int(write_data['score'])]}\n")

    if write_data["comment"]:
        writelines.append(f"{write_data['comment']}")
    file.writelines(writelines)
    file.close()

    update_records[file_key] = write_data["updated_at"]
    save_update_records(update_records)


'''
main script
'''
update_records = load_update_records()

for CollectionType in range(1, 6):
    # Set CollectionType
    params["type"] = CollectionType

    entriesCnt = 0

    while True:
        params['offset'] = entriesCnt

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
                "series": "",
                "updated_at": "",
            }

            tags = entry['tags']
            subject = entry['subject']

            # updated_at
            towrite_data["updated_at"] = entry['updated_at']
            # filename
            towrite_data['filename'] = subject['name_cn'].replace('/', '_').replace(':', '-') \
                if subject['name_cn'] != "" else subject['name']

            towrite_data['release'] = subject['date'].split("-")[0] if subject['date'] is not None else ""
            # type
            tag_count = {tag['name']: tag['count'] for tag in subject['tags']
                         if tag['name'] in mediaType}

            towrite_data['type'] = type_mapping[max(tag_count, key=tag_count.get)] if tag_count else ""
            # normal tag
            convertFromTag = [tag for tag in tags if tag.endswith('改')]
            toWatchTag = [tag for tag in tags if tag.endswith('类')]

            series_tags_found = [tag for tag in tags if tag in series_tags]
            series_found = len(series_tags_found) > 0
            if series_found:
                towrite_data['series'] = series_tags_found[0]

            # to watch: tag
            if CollectionType == 1:
                if toWatchTag != "":
                    towrite_data['tags'].extend(toWatchTag)

            if convertFromTag:
                towrite_data['tags'].extend(convertFromTag)

            towrite_data['tags'].extend(tag for tag in tags
                                        if tag not in series_tags
                                        and not tag.endswith(('改', '类'))
                                        and not tag == "原创"
                                        and not tag.isdigit())

            # watched: score & year & month & comment
            if CollectionType == 2:
                towrite_data['score'] = entry['rate']
                towrite_data['year'] = entry['updated_at'].split('-')[0]
                towrite_data['month'] = entry['updated_at'].split('-')[1]
                towrite_data['comment'] = entry['comment']

            write_yaml(towrite_data)

        if data["total"] <= entriesCnt or stop_at <= entriesCnt:
            break

save_update_records(update_records)
