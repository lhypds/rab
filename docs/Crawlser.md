# 京都分类爬虫

爬虫从京都府观光目录、市体育设施目录和商家分店目录发现详情页。每次选择来源前，它统计本地各账号中已启用、未删除的条目，按大类和分类从少到多排序。默认每个分类补到 5 条后暂停。有来源可查但搜索结果为空的分类会在后续轮次重试。

舞蹈排练室按使用场地归入「工作室」，单独出租的乐器归入物品的「乐器」。商家明确提供现场音响人员的方案归入服务的「活动协助」。这三类来源均由常驻任务按分类数量调度。

## 运行

以下命令从项目根目录执行。需要 Python 3.10 或更新版本。新检出的仓库可以先按下节说明恢复脚本。

```sh
python3 -m pip install -r data/crawlers/kyoto_rentals/requirements.txt
python3 data/crawlers/kyoto_rentals/scarce.py --status
```

`--once` 处理一个到期来源后退出。`--target N` 设置分类目标数量。`--data PATH` 或环境变量 `RAB_DATA` 指定与服务端共用的数据根目录，默认为项目的 `data/`。

首次启动常驻任务及查看日志：

```sh
pm2 start data/crawlers/kyoto_rentals/scarce.py --name rab-kyoto-scarce --interpreter "$(command -v python3)" --time
pm2 logs rab-kyoto-scarce
```

爬虫核验地点、联系电话和至少两张不同的图片，再将完整条目作为 spot（据点）写入数据根目录的 `users/_public/spots/`（`spot.json`，`spot: true`，`itemIds` 为空）。名称后不加分类标签，标签（或名称末尾的〈一棟貸し町家〉）写入 `what`；地址只写在 `place`，不再放在说明开头。之前写入的条目可用 `node server/tidy-spots.js --write` 整理。来源网址与分类用于去重。低于目标的分类在来源扫描成功后 24 小时再查；来源访问失败后 1 小时再试。详情页单独记录退避时间。调度和重试状态保存在数据根目录的 `crawlers/priority-state/`，重启后继续使用。

## 在新检出的仓库恢复爬虫

下方收录调度入口、采集模块、商家目录配置及依赖。以下命令只创建缺失的文件，已有的本地修改会保留。

```sh
python3 - <<'RESTORE'
from pathlib import Path
import re

doc = Path("docs/Crawlser.md").read_text()
root = Path("data/crawlers/kyoto_rentals")
root.mkdir(parents=True, exist_ok=True)
for name, content in re.findall(r"^### `([\w.]+)`\n\n````\w+\n(.*?)^````$", doc, re.M | re.S):
    target = root / name
    if not target.exists():
        target.write_text(content)
RESTORE
```

## 源码与配置

新增商家目录时，可参照 `chains.py` 的字段说明编辑本地 `sources.json`。常驻任务会重新读取配置。如需在其他检出中恢复相同配置，也要更新本文对应的代码块。

### `scarce.py`

````python
"""Continuously discover Kyoto listings, starting with the least populated categories."""
import argparse
from collections import Counter
from contextlib import contextmanager
import fcntl
from functools import partial
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit

import crawl
from chains import chains, chain_index, chain_offer

SPORTS = 'https://www.kyoto-sports.or.jp/facilities/'
DAY = 86400

# Search the live Kyoto tourism directory. Only accept results whose own
# title identifies the offering; mentions of nearby services are insufficient.
SEARCHES = [
    ('item', 'game-console', 'ゲーム機レンタル', 'ゲーム機レンタル|ゲーム機貸出', 'ゲーム機レンタル'),
    ('service', 'other', 'ナレーション', 'ナレーション収録|ナレーター派遣', 'ナレーション'),
    ('service', 'guide', '観光ガイド', 'ガイドツアー|観光ガイド', '観光ガイド'),
    ('item', 'camping', 'キャンプ用品', 'キャンプ用品レンタル', 'キャンプ用品レンタル'),
    ('item', 'camera', 'カメラレンタル', 'カメラレンタル|レンタルカメラ', 'カメラレンタル'),
    ('item', 'projector', 'プロジェクターレンタル', 'プロジェクターレンタル', 'プロジェクターレンタル'),
    ('item', 'sports', 'スキーレンタル', 'スキーレンタル|レンタルスキー', 'スキーレンタル'),
    ('space', 'studio', '撮影スタジオ', 'レンタル撮影スタジオ|貸撮影スタジオ', 'スタジオレンタル'),
    ('service', 'cooking', '出張料理', '出張料理|出張割烹', '出張料理'),
    ('service', 'translation', '通訳ガイド', '通訳ガイド|通訳案内士', '通訳ガイド'),
    ('service', 'videography', '動画撮影', '動画撮影サービス|映像制作', '動画撮影'),
]


def sports_index():
    cards = crawl.page(SPORTS).select('.facilities_list_box')
    if not cards:
        raise ValueError('facility directory layout not recognized')
    for card in cards:
        name = card.select_one('h3 a[href]')
        ward = card.find_previous('h2')
        if name and ward and re.fullmatch(r'.{1,3}区', ward.get_text(strip=True)):
            yield urljoin(SPORTS, name['href']), ward.get_text(strip=True)


def sports_offer(url, ward):
    doc = crawl.page(url)
    facility = doc.select_one('h1.t1').get_text(strip=True)
    for section in doc.select('#article_inside section'):
        title = section.select_one('h2.ts')
        if not title or not re.search('体育館|テニスコート|フットサル', title.get_text(strip=True)):
            continue
        contact = section.find('th', string=re.compile('連絡先'))
        if not contact:
            continue
        gallery = [urljoin(url, a['href']) for a in section.select('.fancybox a[href*="/upImage/"]')]
        gallery += crawl.photos(section, '.fancybox img[src*="/upImage/"]', url)
        if len(set(gallery)) < 2:
            continue
        frame = doc.select_one('iframe[src*="www.google.com/maps/embed"]')
        if not frame or urlsplit(frame['src']).hostname != 'www.google.com':
            raise ValueError('missing facility map')
        # The embed URL contains the viewport centre. The response supplies
        # the marked facility and its coordinates separately.
        marker = re.search(r'"([^"\n]+)",\[(3[45]\.\d+),(13[56]\.\d+)\]', crawl.fetch(frame['src']).decode())
        if not marker:
            raise ValueError('missing facility marker')
        place = f'京都市{ward} {facility}'
        return dict(source=url, homepage=url, kind='space', category='other', title=facility,
                    label=title.get_text(strip=True), photos=gallery, phone=contact.find_next_sibling('td').get_text(' ', strip=True),
                    location=crawl.address_point(place, marker.groups()[1:]))
    raise ValueError('no supported bookable court with a photo gallery')


def tourism_index(keyword, pattern):
    for url in crawl.directory_links(keyword, pattern):
        yield url, None


def tourism_offer(kind, category, label, url, _):
    offer = crawl.directory_offer(url, kind, category)
    return dict(offer, label=label)


def studio_index(home, detail):
    links = {urljoin(home, a['href']) for a in crawl.page(home).select('a[href]')}
    if detail not in links:
        raise ValueError('studio rental page no longer listed')
    yield detail, None


def studio_offer(name, access, selector, url, _):
    doc = crawl.page(url)
    if 'レンタル' not in doc.title.get_text():
        raise ValueError('missing studio rental offer')
    info = doc if access == url else crawl.page(access)
    frame = info.select_one('iframe[src*="www.google.com/maps/embed"]')
    if not frame or urlsplit(frame['src']).hostname != 'www.google.com':
        raise ValueError('missing studio map')
    marker = re.search(r'"([^"\n]+)",\[(3[45]\.\d+),(13[56]\.\d+)\]', crawl.fetch(frame['src']).decode())
    if not marker:
        raise ValueError('no marked studio address')
    # Read the Japanese facility address rather than the viewport centre.
    address = json.loads('"' + marker[1] + '"')
    address = address[address.index('京都府京都市'):]
    phone = crawl.phone_digits(doc.get_text(' ', strip=True))
    return dict(source=url, homepage=url, kind='space', category='studio', title=name,
                label='ダンススタジオレンタル', phone=phone, photos=crawl.photos(doc, selector, url),
                location=crawl.address_point(address, marker.groups()[1:]))


KINKO = 'https://rental.kinkomusic.com/'


def kinko_index(category):
    directory = crawl.page(KINKO)
    wanted = {'キーボード', 'ドラム'} if category == 'musical-instrument' else {'オペレーター付きPAレンタル'}
    pages = {a.get_text(strip=True): a['href'] for a in directory.select('a[href]')
             if a.get_text(strip=True) in wanted and urlsplit(a['href']).hostname == 'rental.kinkomusic.com'}
    if not pages:
        raise ValueError('rental catalogue sections not found')
    yield KINKO if category == 'musical-instrument' else next(iter(pages.values())), pages


def kinko_offer(category, url, pages):
    shop = crawl.page('https://www.kinkomusic.com/').select_one('.shop-item:has(.shop-sub:-soup-contains("Rockstore"))')
    if not shop or '機材レンタル受付' not in shop.get_text(strip=True):
        raise ValueError('missing Kyoto rental counter')
    address = shop.select_one('.shop-address-ja').get_text(' ', strip=True)
    address = re.search(r'京都市\S+', address)[0]
    phone = crawl.phone_digits(shop.select_one('.shop-mail').get_text(' ', strip=True))
    # The official short link redirects to a Google place. Use its place marker.
    link = shop.select_one('a[href^="https://maps.app.goo.gl/"]')['href']
    with crawl.session.get(link, stream=True, timeout=(7, 20)) as response:
        response.raise_for_status()
        marker = re.search(r'!3d([\d.]+)!4d([\d.]+)', response.url)
    if not marker:
        raise ValueError('missing Kyoto rental counter marker')
    gallery = []
    for section, detail in pages.items():
        doc = crawl.page(detail)
        contents = doc.get_text(' ', strip=True)
        if phone not in re.sub(r'[- ]', '', contents) or '税込' not in contents:
            raise ValueError('missing rental terms or contact')
        if category == 'event-help' and not re.search(r'オペレーター[（(].{1,12}名', contents):
            raise ValueError('operator not included')
        products = crawl.photos(doc, 'img[src*="static.wixstatic.com/media/"][alt]', detail)
        gallery.extend(photo.split('/v1/')[0] for photo in products[:2])
    instrument = category == 'musical-instrument'
    return dict(source=url, homepage=url, title='きんこう楽器', kind='item' if instrument else 'service',
                category=category, label='楽器レンタル' if instrument else '音響オペレーター付きPA',
                note='取扱い：' + '、'.join(pages) + '。' if instrument else '機材と音響スタッフを含むイベント向けプランです。',
                phone=phone, photos=gallery, location=crawl.address_point(address, marker.groups()))


def sources():
    for kind, category in [('item', 'musical-instrument'), ('service', 'event-help')]:
        yield 'きんこう楽器 ' + category, (kind, category), partial(kinko_index, category), partial(kinko_offer, category)
    for name, home, detail, access, images in [
        ('STUDIO KFA', 'https://flamenca.jp/', 'rental/', 'access/', 'img[src^="/rental/image/img"]'),
        ('Lily & Walk', 'https://lilyandwalk.com/', 'rental.html', 'rental.html', 'img[src^="img/studio"]:not([src*="-sp"])'),
    ]:
        yield name, ('space', 'studio'), partial(studio_index, home, home + detail), partial(studio_offer, name, home + access, images)
    yield '京都市スポーツ施設', ('space', 'other'), sports_index, sports_offer
    for kind, category, keyword, pattern, label in SEARCHES:
        yield keyword, (kind, category), partial(tourism_index, keyword, pattern), partial(tourism_offer, kind, category, label)
    for spec in chains():
        # A programming school offers lessons; its directory does not
        # establish that the branch accepts software development contracts.
        if spec['name'] == 'Winスクール':
            spec = dict(spec, category='teaching')
        yield spec['name'], (spec['kind'], spec['category']), partial(chain_index, spec), partial(chain_offer, spec)


def inventory(root):
    counts, keys, branches = Counter(), set(), set()
    for file in [*root.parent.parent.glob('*/items/[0-9]*/item.json'), *root.parent.parent.glob('*/spots/[0-9]*/spot.json')]:
        item = json.loads(file.read_text())
        category = (item.get('kind'), item.get('category'))
        if not item.get('deletedAt') and item.get('active', True):
            counts[category] += 1
            if item.get('located'):
                for contact in item.get('contacts', []):
                    if contact.get('type') == 'phone':
                        branches.add((category, contact['value'], item.get('place')))
        if file.parent.parent == root:
            source = file.with_name('source.json')
            if source.exists():
                key = json.loads(source.read_text()).get('key')
                if isinstance(key, list) and len(key) == 2:
                    keys.add(tuple(key))
    return counts, keys, branches


@contextmanager
def lock(file, nonblocking=False):
    with file.open('a') as handle:
        flags = fcntl.LOCK_EX | (fcntl.LOCK_NB if nonblocking else 0)
        fcntl.flock(handle, flags)
        yield


def run_source(source, root, target, retry):
    name, category, discover, extract = source
    counts, keys, branches = inventory(root)
    report = Counter(discovered=0, created=0)
    for url, data in discover():
        if counts[category] >= target:
            break
        key = (url, category[1])
        report['discovered'] += 1
        if key in keys:
            report['existing'] += 1
            continue
        if retry.waiting(url, name):
            report['backoff'] += 1
            continue
        try:
            offer = extract(url, data)
            if (offer['kind'], offer['category']) != category:
                raise ValueError('source returned a different category')
            branch = (category, crawl.phone_digits(offer['phone']), offer['location'][0])
            if branch in branches:
                report['duplicate'] += 1
                continue
            _, ident = crawl.publish(offer, root, {})
            keys.add(key)
            branches.add(branch)
            counts[category] += 1
            report['created'] += 1
            print('created', ident, *category, url, flush=True)
        except crawl.ERRORS as error:
            retry.note(url, name, error)
            report['skipped'] += 1
            print('skipped', url, str(error), flush=True)
    return dict(report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='run one due source and exit')
    parser.add_argument('--status', action='store_true', help='show counts and source schedules')
    parser.add_argument('--target', type=int, default=5, help='pause a category at this many active listings')
    parser.add_argument('--data', type=Path, default=Path(os.environ.get('RAB_DATA', crawl.HERE.parents[1])))
    args = parser.parse_args()
    if args.target < 1:
        parser.error('--target must be positive')
    root = args.data.resolve() / crawl.OUTPUT
    root.mkdir(parents=True, exist_ok=True)
    folder = args.data.resolve() / 'crawlers/priority-state'
    folder.mkdir(parents=True, exist_ok=True)
    state_file = folder / 'sources.json'
    def queue(state):
        counts, _, _ = inventory(root)
        return sorted(((counts[s[1]], state.get(s[0], {}).get('next', 0), s) for s in sources()),
                      key=lambda row: (row[0], row[1], row[2][0]))
    if args.status:
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        for count, due, source in queue(state):
            print(*source[1], count, source[0], 'target reached' if count >= args.target else
                  time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(due)) if due else 'due')
        return
    with lock(folder / 'worker.lock', nonblocking=True):
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        retry = crawl.Retry(folder / 'retry.json')
        while True:
            row = next((r for r in queue(state) if r[0] < args.target and r[1] <= time.time()), None)
            if row:
                count, _, source = row
                name = source[0]
                print('begin', name, *source[1], count, flush=True)
                try:
                    with lock(root / '.kyoto-rentals.lock'):
                        report = run_source(source, root, args.target, retry)
                    delay = DAY
                except crawl.ERRORS as error:
                    report, delay = {'error': str(error)}, 3600
                retry.save()
                state[name] = dict(next=time.time() + delay, report=report)
                tmp = state_file.with_suffix('.tmp')
                tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2))
                tmp.replace(state_file)
                print('finished', name, report, flush=True)
            if args.once:
                return
            if not row:
                time.sleep(60)


if __name__ == '__main__':
    main()
````

### `crawl.py`

````python
"""Discover Kyoto rental offers and import complete new listings into RAB."""
import argparse
import hashlib
import io
import json
import os
import re
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageOps
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

HERE = Path(__file__).resolve().parent
INDEX = 'https://www.kyoto-kankou.or.jp/info_search'
SHOPS = 'https://ewha-yifu.com/shops/'
PHOTO = SHOPS + 'kyoto-area/planlist-kyoto/camera-plan/'
WARD = r'京都市(?:北|上京|左京|中京|東山|下京|南|右京|伏見|山科|西京)区'
# Every listing is a spot of the public account — a collection of items, kept
# apart (see server/files.js): its own folder under users/_public/spots/,
# with spot.json in it — an item with `spot: true` and the ids of the items
# on it, none to start with.
OUTPUT = 'users/_public/spots'
RECORD = 'spot.json'

REGION = dict(name='Kyoto', detail='Kyoto, Japan', bbox=[135.5591, 34.8752, 135.8787, 35.3213])
# Broad keywords need positive evidence on the result, especially for hotels
# which mention other venues nearby.
SEARCH = [
    ('item', 'clothing', '着物レンタル', r'着物レンタル'),
    ('item', 'bike', 'レンタサイクル', r'レンタサイクル|サイクリングツアープロジェクト|イワイサイクル'),
    ('space', 'parking', '駐車場', r'駐車場$'),
    ('space', 'meeting-room', '会議室', r'京都テルサ|島津アリーナ京都|京都市国際交流会館|京都府立文化芸術会館'),
    ('space', 'event-space', 'テルサホール', r'京都テルサ'),
    ('service', 'driver', '観光タクシー', r'タクシー|ハイヤー'),
]
CAR_INDEX = 'https://www.2525r.com/kyoto/kyoto/'
LABEL = {'adult': '風俗店', 'music-studio': '音楽スタジオ', 'massage': 'もみほぐし', 'tools': 'レンタル工具', 'storage': '貸倉庫', 'guide': 'ガイド', 'teaching': '体験教室', 'studio': 'レンタルスタジオ', 'workspace': 'レンタルオフィス', 'home': '一棟貸し', 'car': 'レンタカー', 'clothing': '着物レンタル', 'bike': 'レンタサイクル', 'parking': '時間貸し駐車場', 'event-space': '貸ホール',
         'meeting-room': '貸会議室', 'driver': '観光タクシー', 'photography': 'プロカメラマン撮影プラン'}
session = requests.Session()
session.headers['User-Agent'] = 'RAB-Kyoto-Rental-Directory/1.0'
session.mount('https://', HTTPAdapter(max_retries=Retry(total=2, backoff_factor=1, status_forcelist=[429, 502, 503, 504])))
last_request = {}
# A page whose layout has changed raises one of the last three; a run goes on
# to the next record or source whichever it is.
ERRORS = (ValueError, KeyError, OSError, requests.RequestException, AttributeError, TypeError, IndexError)
DAY = 86400


class Retry:
    """When a skipped source is next worth fetching again.

    Without a file nothing is remembered and every source is due on every run,
    as for a single run. forever.py gives it a file, so that a round does not
    fetch again the hundreds of pages that were skipped by the round before: a
    record that failed for what it says waits a day, then two, up to thirty; one
    that could not be reached waits an hour, up to a day.
    """

    def __init__(self, file=None):
        self.file, self.seen = file, {}
        self.ignore = False  # set while a source is run again because somebody asked
        if file and file.exists():
            try:
                self.seen = json.loads(file.read_text())
            except ValueError:
                self.seen = {}

    def waiting(self, url, group):
        if self.ignore:
            return None
        entry = self.seen.get(f'{group} {url}')
        return entry['reason'] if entry and entry['after'] > time.time() else None

    def note(self, url, group, error):
        if not self.file:
            return
        brief = isinstance(error, (requests.RequestException, OSError))
        first, longest = (3600, DAY) if brief else (DAY, 30 * DAY)
        wait = min(max(self.seen.get(f'{group} {url}', {}).get('wait', 0) * 2, first), longest)
        self.seen[f'{group} {url}'] = dict(reason=str(error), wait=wait, after=time.time() + wait)

    def save(self):
        if self.file:
            partial = self.file.with_suffix('.partial')
            partial.write_text(json.dumps(self.seen, ensure_ascii=False, indent=1) + '\n')
            partial.replace(self.file)


retry = Retry()


def fetch(url, limit=16_000_000):
    host = urlsplit(url).hostname
    time.sleep(max(0, last_request.get(host, 0) + .4 - time.monotonic()))
    last_request[host] = time.monotonic()
    with session.get(url, stream=True, timeout=(7, 20)) as response:
        response.raise_for_status()
        data = bytearray()
        for block in response.iter_content(65536):
            data.extend(block)
            if len(data) > limit:
                raise ValueError('response exceeds size limit')
        return bytes(data)


def page(url):
    return BeautifulSoup(fetch(url), 'html.parser', from_encoding='utf-8')


def photos(html, selector, url):
    return list(dict.fromkeys(urljoin(url, e['src']) for e in html.select(selector) if e.get('src')))


def directory_links(keyword, pattern):
    params = [('q[name_or_description_cont]', keyword)] + [('q[areas_id_in][]', i) for i in range(27, 39)]
    url = INDEX + '?' + urlencode(params)
    seen = set()
    while url and url not in seen:
        seen.add(url)
        html = page(url)
        cards = html.select('a.spotArticle__link')
        if not cards and not re.search(r'(?<!\d)0\s*件中', html.get_text(' ', strip=True)):
            raise ValueError('unrecognized tourism directory response')
        for card in cards:
            title = card.select_one('.spotArticle__title').get_text(strip=True)
            if re.search(pattern, title):
                yield urljoin(INDEX, card['href'])
        more = html.select_one('a[rel=next]')
        url = urljoin(url, more['href']) if more else None


@lru_cache(maxsize=512)
def point_ward(lat, lng):
    url = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?' + urlencode({'lat': lat, 'lon': lng})
    code = json.loads(fetch(url)).get('results', {}).get('muniCd')
    wards = ['北', '上京', '左京', '中京', '東山', '下京', '南', '右京', '伏見', '山科', '西京']
    return {str(26101 + i): '京都市' + ward + '区' for i, ward in enumerate(wards)}.get(code)


def address_point(address, point):
    address = re.sub(r'^(〒?\s*\d{3})[−‐‑–](\d{4})', r'\1-\2', unicodedata.normalize('NFKC', address))
    if not re.match(r'^(?:〒?\s*\d{3}-?\d{4}\s*)?(?:京都府)?' + WARD, address):
        raise ValueError('address outside Kyoto City or ambiguous')
    method = 'facility map'
    if not point:
        # Accept only an exact address match, never a ward or street centroid.
        query = re.sub(r'^〒?\s*\d{3}-?\d{4}\s*', '', address)
        url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?' + urlencode({'q': query})
        matches = [r for r in json.loads(fetch(url)) if r['properties']['title'].removeprefix('京都府') == query.removeprefix('京都府')]
        if len(matches) != 1:
            raise ValueError('address has no unambiguous point')
        lng, lat = matches[0]['geometry']['coordinates']
        point, method = (lat, lng), 'GSI exact address'
    lat, lng = map(float, point)
    if not (34.85 < lat < 35.33 and 135.55 < lng < 135.90):
        raise ValueError('point outside Kyoto extent')
    ward = point_ward(lat, lng)
    if not ward or ward not in address:
        raise ValueError('map point and address disagree on Kyoto ward')
    return address, lat, lng, method


def directory_offer(url, kind, category):
    html = page(url)
    header = html.select_one('.showArticle__title')
    for ruby in header.select('rt'):
        ruby.decompose()
    title = header.get_text(strip=True)
    rows = {r.th.get_text(strip=True): r.td for r in html.select('.u-basicTable tr') if r.th and r.td}
    contact = rows.get('お問い合わせ')
    phone = contact.select_one('a[href^="tel:"]') if contact else None
    website = rows.get('Webサイト')
    website = website.a['href'] if website and website.a else ''
    gallery = photos(html, '.showArticle__mainView img', url)
    desc = html.select_one('.showArticle__description')
    frame = html.select_one('.showArticle__mapContainer iframe')
    pin_url = frame['src'] if frame else ''
    address = rows['住所'].get_text(' ', strip=True) if '住所' in rows else ''
    if category == 'parking':
        parking = re.search(r'https://www\.kyotopublic\.or\.jp/parking/search/detail/[a-f0-9-]{36}', website + ' ' + (desc.get_text() if desc else ''))
        if parking:
            website = parking[0]
            facility = page(website)
            details = {r.th.get_text(strip=True): r.td for r in facility.select('.detail_fig tr') if r.th and r.td}
            contact = details.get('電話')
            if contact and re.search(r'0[0-9()-]+', contact.get_text(strip=True)):
                phone = contact
            street = details.get('住所')
            map_link = facility.select_one('.gmap a[href*="maps?q="]')
            if street and street.p and map_link:
                address = street.p.get_text(' ', strip=True)
                pin_url = map_link['href']
            gallery += photos(facility, '.swiper-slide img[src^="/parking/files/"]', website)
    if url.endswith('/3529'):
        website = 'https://www.kyoto-terrsa.or.jp/terrsahalllp/'
        selector = ('img[alt*="会議室（"]' if category == 'meeting-room'
                    else 'img[alt="テルサホール内"], img[alt="控室"], img[alt="専用ロビー"]')
        gallery = photos(page(website), selector, website) + gallery
    if url.endswith('/6743'):
        bikes = 'https://kctp.net/tour/bicycle'
        gallery += photos(page(bikes), 'img[alt$="写真"]', bikes)
    if not phone or not website.startswith(('https://', 'http://')) or not address:
        raise ValueError('missing phone, homepage or address')
    pin = re.search(r'[?&]q=([\d.]+),([\d.]+)', pin_url)
    return dict(source=url, title=title, kind=kind, category=category, homepage=website,
                phone=phone.get_text(strip=True), location=address_point(address, pin.groups() if pin else None),
                photos=gallery)


def car_offer(url):
    html = page(url)
    prefix = 'window.__INITIAL_STORE__ ='
    node = next((s for s in html.select('script') if s.get_text(strip=True).startswith(prefix)), None)
    if not node:
        raise ValueError('missing store details')
    shop, _ = json.JSONDecoder().raw_decode(node.get_text(strip=True)[len(prefix):].strip())
    if not shop.get('phone_num') or not shop.get('call_ok_flg'):
        raise ValueError('no public branch telephone')
    gallery = [shop.get(key) for key in ('photo_url1', 'photo_url2', 'original_img_pass')]
    return dict(source=url, title='ニコニコレンタカー ' + shop['store_name'], homepage=url,
                kind='item', category='car', phone=shop['phone_num'],
                location=address_point(shop['address'], (shop['latval'], shop['lngval'])),
                photos=[u for u in gallery if u and '/store/' in u and '/common' not in u])


def branch_offer(url):
    html = page(url)
    records = [json.loads(node.get_text()) for node in html.select('script[type="application/ld+json"]')]
    shop = next((r for r in records if isinstance(r, dict) and r.get('@type') == 'LocalBusiness'), None)
    if not shop:
        raise ValueError('missing branch record')
    addr = shop['address']
    geo = shop.get('geo')
    point = (geo['latitude'], geo['longitude']) if geo else None
    return dict(source=url, title=shop['name'], homepage=url, kind='item', category='clothing', phone=shop['telephone'],
                location=address_point(addr['addressRegion'] + addr['addressLocality'] + addr['streetAddress'], point),
                photos=photos(html, 'img[src*="/img/shops/shop_"]', url))


def save_image(folder, img, size):
    copy = img.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    copy.save(buf, 'WEBP', quality=80, method=5)
    data = buf.getvalue()
    name = hashlib.sha256(data).hexdigest()[:32] + '.webp'
    (folder / name).write_bytes(data)
    return name, copy.width, copy.height


def phone_digits(text):
    # Stop at the end of the number; operator cells can append "(8:00–18:00)".
    phone = re.sub(r'[‐‑–−]', '-', unicodedata.normalize('NFKC', text))
    phone = re.sub(r'\((\d{1,4})\)(?=\d)', r'-\1-', phone)
    number = re.search(r'(?:\+81[- ]?|0)(?:\d{1,4}[- ]\d{1,4}[- ]\d{3,4}|\d{9,10})(?!\d)', phone)
    digits = re.sub(r'\D', '', number[0]) if number else ''
    if number and number[0].startswith('+81'):
        digits = '0' + digits[2:]
    if not re.fullmatch(r'0\d{9,10}', digits):
        raise ValueError('invalid phone')
    return digits


def larger(url):
    """The addresses a picture may be had at full size, best first, and then
    the one given: sites hand out small copies by a resize query (ホットペッパー,
    風俗じゃぱん) or by the size written into a WordPress file name."""
    parts = urlsplit(url)
    tries = []
    if parts.query and re.search(r'(^|&)(w|h|width|height|impolicy|resize|size)=', parts.query):
        tries.append(parts._replace(query='').geturl())
    sized = re.sub(r'-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)', '', parts.path, flags=re.I)
    if sized != parts.path:
        tries.append(parts._replace(path=sized, query='').geturl())
    return list(dict.fromkeys(tries + [url]))


def picture(url):
    """A picture as an image, from the largest copy of it that can be had."""
    last = None
    for each in larger(url):
        try:
            with Image.open(io.BytesIO(fetch(each))) as original:
                return ImageOps.exif_transpose(original).convert('RGB')
        except (requests.RequestException, ValueError, OSError) as error:
            last = error
    raise last


def publish(offer, root, stored):
    """Write one offer as a new item. An offer whose `location` is None has no
    address of its own (a business that comes to you): it gets no pin and is
    listed for anywhere in Kyoto City instead. `min_photos` (2 unless said)
    is how many photographs it needs."""
    # A source can have two offers (kimono rental and photographer hire).
    key = [offer['source'], offer['category']]
    digits = phone_digits(offer['phone'])
    least = offer.get('min_photos', 2)
    if len(set(offer['photos'])) < least:
        raise ValueError('fewer than two distinct facility photos')
    with tempfile.TemporaryDirectory(prefix='.kyoto-', dir=root) as tmp:
        folder = Path(tmp)
        images, urls = [], []
        for url in dict.fromkeys(offer['photos']):
            try:
                img = picture(url)
                if min(img.size) < 120:
                    continue
                name, width, height = save_image(folder, img, 1280)
                if any(r['name'] == name for r in images):
                    continue
                thumb, _, _ = save_image(folder, img, 320)
                images.append(dict(name=name, thumb=thumb, width=width, height=height))
                urls.append(url)
            except (requests.RequestException, ValueError, OSError) as error:
                print('image:', error, flush=True)
            if len(images) == 3:
                break
        if len(images) < least:
            raise ValueError('fewer than two distinct facility photos')
        address, lat, lng, method = offer['location'] or (None, 0, 0, 'service area')
        ident = str(time.time_ns() // 1_000_000)
        while any(root.parent.parent.glob(f'*/items/{ident}')) or any(root.parent.parent.glob(f'*/spots/{ident}')):
            ident = str(int(ident) + 1)
        now = datetime.fromtimestamp(int(ident)/1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        label = offer.get('label') or LABEL[offer['category']]
        # What it is goes in `what`, not after the name: the label, where the
        # name does not already say it, or the 〈一棟貸し町家〉 a name ends with.
        title = offer['title'].strip()
        what = label if label not in title else None
        tagged = re.search(r'\s*〈([^〈〉]+)〉$', title)
        if tagged:
            title, what = title[:tagged.start()].strip(), tagged.group(1).strip()
        # The address is the spot's `place`, shown on its own, so the
        # description does not start with it.
        item = dict(id=ident, spot=True, itemIds=[], title=title, **({'what': what} if what else {}),
                    description='料金・利用条件は公式サイトでご確認ください。' + offer.get('note', ''),
                    kind=offer['kind'], category=offer['category'], active=True, shared=True, mode='inquiry',
                    contacts=[dict(type='phone', code='+81', value=digits)], homepage=offer['homepage'],
                    located=bool(address), latitude=lat, longitude=lng, place=address, region=REGION,
                    currency='JPY', price=None, rates=[], hours=[], days=[], images=images, createdAt=now, updatedAt=now)
        for file, obj in [(RECORD, item), ('source.json', dict(key=key, coordinates=method, photos=urls))]:
            (folder / file).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
        folder.rename(root / ident)
        stored[tuple(key)] = ident
        return 'created', ident


def run(root):
    root.mkdir(parents=True, exist_ok=True)
    stored = {}
    for file in root.glob('*/source.json'):
        record = json.loads(file.read_text())
        if 'key' in record:
            stored[tuple(record['key'])] = file.parent.name
    report = []

    def attempt(url, category, callback):
        try:
            existing = stored.get((url, category))
            waiting = None if existing else retry.waiting(url, category)
            if existing:
                status, result = 'existing', existing
            elif waiting:
                status, result = 'waiting', waiting
            else:
                status, result = publish(callback(), root, stored)
        except ERRORS as error:
            status, result = 'skipped', str(error)
            retry.note(url, category, error)
        report.append(dict(source=url, category=category, status=status, result=result))
        print(status, url, result, flush=True)

    def directory():
        for kind, category, keyword, pattern in SEARCH:
            for url in dict.fromkeys(directory_links(keyword, pattern)):
                # Branches below supersede the aggregate entry. Ranbura closed
                # per its operator: https://www.kyotoarashiyama.jp/archives/5564
                if url.endswith(('/9745', '/8195')):
                    reason = 'covered by individual branch records' if url.endswith('/9745') else 'operator announced closure'
                    report.append(dict(source=url, category=category, status='skipped', result=reason))
                    continue
                attempt(url, category, lambda: directory_offer(url, kind, category))

    def kimono():
        shops = page(SHOPS)
        plan = page(PHOTO)
        terms = next((p.get_text(strip=True) for p in plan.select('p') if '限定' in p.get_text() and 'プロカメラマン' in p.get_text()), '')
        for url in sorted({urljoin(SHOPS, a['href']) for a in shops.select('a[href]')}):
            if not re.fullmatch(re.escape(SHOPS) + r'kyoto-area/(?:arashiyama|ekimae|gion|kiyomizudera)/', url):
                continue
            try:
                shop = branch_offer(url)
            except ERRORS as error:
                report.append(dict(source=url, status='skipped', result=str(error)))
                continue
            attempt(url, 'clothing', lambda: shop)
            if shop['title'].split()[-1] in terms:
                attempt(url, 'photography', lambda: dict(shop, kind='service', category='photography', homepage=PHOTO,
                                          photos=photos(plan, 'img[alt="梨花和服の撮影プラン"]', PHOTO)))

    def cars():
        car_list = page(CAR_INDEX)
        for url in sorted({urljoin(CAR_INDEX, a['href']) for a in car_list.select('a[href]')}):
            if re.fullmatch(re.escape(CAR_INDEX) + r'[a-z-]+/store-[0-9-]+\.html', url):
                attempt(url, 'car', lambda: car_offer(url))

    # One source that cannot be read, or whose pages have changed, does not
    # keep the others from being looked at.
    for name, section in [(INDEX, directory), (SHOPS, kimono), (CAR_INDEX, cars)]:
        try:
            section()
        except ERRORS as error:
            report.append(dict(source=name, status='failed', result=str(error)))
            print('failed', name, error, flush=True)
    return report


if __name__ == '__main__':
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('RAB_DATA', HERE.parents[1])) / OUTPUT)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / '.kyoto-rentals.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        report = run(args.output)
        (HERE / 'last-run.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
````

### `chains.py`

````python
"""Branch directories of chains, described in sources.json rather than in code.

A chain's Kyoto page lists its branches and each branch has a page of its own.
One entry of sources.json is enough to follow such a chain:

    name      what the reports, done.json and `forever.py --rerun` call it
    index     the page that links to the Kyoto branches, or a list of such pages
    link      a regular expression a branch page's address matches
    kind      item | space | service
    category  one of src/utils/kinds.js
    label     what is put after a title that does not say what is on offer

and optionally:

    within    CSS selector for the part of the index page the branch links are
              in, where the pattern alone would take in other pages
    next      CSS selector for the index's link to its next page
    require   a regular expression the branch page's text must match, for a
              chain where only some branches have the thing on offer
    title     CSS selector for the branch's name
    prefix    put before a name that does not say whose branch it is
    address   CSS selector for the street address
    phone     CSS selector for the telephone number (its text, or a tel: link)
    point     a regular expression with two groups, latitude and longitude,
              looked for in the page's source
    photos    CSS selector for the photographs (img) on the branch page
    exclude   a regular expression; photographs whose address matches it are
              left out (banners, a picture of the telephone number)
    note      a sentence added to the description

Without the selectors the page's schema.org JSON-LD is read: name, address,
telephone, geo and image. A branch whose address is not in Kyoto City, has no
telephone, or has fewer than two photographs is skipped, as everywhere else.

RAB_SOURCES names another file to read instead, for trying an entry out:

    RAB_SOURCES=/tmp/try.json python3 operators.py --source chain --output /tmp/try/items
"""
import json
import os
import re
import unicodedata
from functools import partial
from pathlib import Path
from urllib.parse import urldefrag, urljoin

from crawl import HERE, address_point, page

FILE = Path(os.environ.get('RAB_SOURCES', HERE / 'sources.json'))


def records(html):
    """Every JSON-LD object on a page, those inside @graph and lists as well."""
    for node in html.select('script[type="application/ld+json"]'):
        try:
            stack = [json.loads(node.get_text(), strict=False)]
        except ValueError:
            continue
        while stack:
            data = stack.pop()
            if isinstance(data, list):
                stack.extend(data)
            elif isinstance(data, dict):
                yield data
                stack.extend(data.get('@graph') or [])


def chain_index(chain):
    queue = [chain['index']] if isinstance(chain['index'], str) else list(chain['index'])
    seen, found = set(), {}
    while queue:
        index = queue.pop(0)
        if index in seen or len(seen) >= 60:
            continue
        seen.add(index)
        html = page(index)
        for scope in html.select(chain.get('within', 'body')):
            for a in scope.select('a[href]'):
                url = urldefrag(urljoin(index, a['href']))[0]
                if re.search(chain['link'], url):
                    found[url] = None
        if chain.get('next'):
            queue += [urldefrag(urljoin(index, a['href']))[0] for a in html.select(chain['next']) if a.get('href')]
    if not found:
        raise ValueError(f"no branches listed for {chain['name']}")
    for url in found:
        yield url, None


def text_of(html, selector):
    node = html.select_one(selector) if selector else None
    return re.sub(r'\s+', ' ', node.get_text(' ', strip=True)) if node else ''


def street(text):
    """The address in a piece of text, written as address_point reads it."""
    text = re.sub(r'(京都府|京都市)\s+', r'\1', unicodedata.normalize('NFKC', text))
    found = re.search(r'(?:〒?\s*\d{3}-?\d{4}\s*)?(?:京都府)?京都市.+', text)
    return (found[0] if found else text).strip()


def chain_offer(chain, url, _):
    html = page(url)
    if chain.get('require') and not re.search(chain['require'], html.get_text(' ', strip=True)):
        raise ValueError('branch does not list the offer')
    shop = next((r for r in records(html) if r.get('name') and r.get('address')), {})
    title = text_of(html, chain.get('title')) or (shop.get('name') or '').strip()
    if not title:
        raise ValueError('missing branch record')
    if chain.get('prefix') and chain['prefix'] not in title:
        title = chain['prefix'] + ' ' + title
    address = text_of(html, chain.get('address'))
    if not address:
        address = shop.get('address') or ''
        if isinstance(address, dict):
            address = ''.join(address.get(k) or '' for k in ('addressRegion', 'addressLocality', 'streetAddress'))
    geo = shop.get('geo') or {}
    point = (geo['latitude'], geo['longitude']) if geo.get('latitude') and geo.get('longitude') else None
    if not point:
        # The branch's own map, where the record has no point. The ward the
        # point is in must still be the address's (see address_point).
        pin = re.search(chain.get('point') or r'\b(3[45]\.\d{4,})\D{1,40}?(13[56]\.\d{4,})', str(html))
        point = pin.groups() if pin else None
    call = html.select_one(chain['phone']) if chain.get('phone') else None
    if call:
        phone = call['href'] if call.get('href', '').startswith('tel:') else call.get_text(' ', strip=True)
    else:
        call = html.select_one('a[href^="tel:"]')
        phone = shop.get('telephone') or (call['href'] if call else '')
    if chain.get('photos'):
        gallery = [urljoin(url, path) for img in html.select(chain['photos'])
                   if (path := img.get('data-src') or img.get('src')) and not path.startswith('data:')]
    else:
        images = shop.get('image') or []
        images = [images] if isinstance(images, (str, dict)) else images
        gallery = [urljoin(url, i.get('url', '') if isinstance(i, dict) else i) for i in images]
    return dict(source=url, homepage=url, title=title, kind=chain['kind'], category=chain['category'],
                label=chain['label'], phone=phone, location=address_point(street(address), point),
                photos=[u for u in dict.fromkeys(gallery) if not re.search(r'\.svg(?:$|\?)|logo|ogp', u)
                        and not (chain.get('exclude') and re.search(chain['exclude'], u))],
                note=chain.get('note', ''))


def chains():
    try:
        return json.loads(FILE.read_text())
    except (OSError, ValueError) as error:
        print(f'{FILE.name}:', error, flush=True)
        return []


def chain_sources():
    """One source per chain, named after it."""
    return [(c['name'], 'chain', partial(chain_index, c), partial(chain_offer, c)) for c in chains()]
````

### `sources.json`

````json
[
  {
    "name": "エニタイムフィットネス",
    "index": "https://www.anytimefitness.co.jp/kyoto/",
    "link": "^https://www\\.anytimefitness\\.co\\.jp/[a-z0-9-]+/$",
    "within": ".prefList",
    "kind": "service",
    "category": "fitness",
    "label": "フィットネス",
    "note": "見学・入会は各店舗にお問い合わせください。"
  },
  {
    "name": "スタジオアリス",
    "index": "https://www.studio-alice.co.jp/shop/26/",
    "link": "^https://www\\.studio-alice\\.co\\.jp/shop/26/\\d+/$",
    "kind": "service",
    "category": "photography",
    "label": "写真スタジオ",
    "photos": "img[src*=\"/shop/img/menu_\"]",
    "note": "写真は運営元の撮影メニュー例です。電話は共通の予約窓口です。"
  },
  {
    "name": "ゴールドジム",
    "index": "https://www.goldsgym.jp/shop-area/kyoto/",
    "link": "^https://www\\.goldsgym\\.jp/shop/kyoto-[a-z0-9-]+/$",
    "kind": "service",
    "category": "fitness",
    "label": "フィットネス",
    "title": "h1.shop-mv__heading-main",
    "prefix": "ゴールドジム",
    "address": "p.shop-information__text:-soup-contains(\"〒\")",
    "phone": "a.shop-information__tel",
    "point": "(?=!2d[\\d.]+!3d(3\\d\\.\\d+))!2d(13\\d\\.\\d+)",
    "photos": ".shop-mv__visual img, .shop-facility__swiper img",
    "note": "見学・入会は各店舗にお問い合わせください。"
  },
  {
    "name": "おそうじ本舗",
    "index": "https://www.osoujihonpo.com/shop/kinki/kyoto/",
    "link": "^https://www\\.osoujihonpo\\.com/shop/detail/\\d+/$",
    "next": "a[href*=\"offset=\"]",
    "kind": "service",
    "category": "cleaning",
    "label": "ハウスクリーニング",
    "title": "h1.c-heading-level-1",
    "address": ".shop-info-list__item:-soup-contains(\"活動拠点\") dd",
    "phone": ".shop-info-list a[href^=\"tel:\"]",
    "photos": ".shop-photo img"
  },
  {
    "name": "NOVA",
    "index": "https://www.nova.co.jp/schools/kinki/kyoto.html",
    "link": "^https://www\\.nova\\.co\\.jp/schools/kinki/kyotoshi/[a-z0-9_-]+\\.html$",
    "kind": "service",
    "category": "teaching",
    "label": "英会話教室",
    "address": "dd.address",
    "phone": "dd.tel a[href^=\"tel:\"]",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "figure.photo_box img",
    "note": "体験レッスン・入会は各校にお問い合わせください。"
  },
  {
    "name": "スマホスピタル",
    "index": "https://smahospital.jp/shop/",
    "link": "^https://smahospital\\.jp/shop/kyoto[a-z0-9_-]+/$",
    "kind": "service",
    "category": "repair",
    "label": "スマホ修理",
    "title": ".s-shop-home-shopdata__col:-soup-contains(\"店舗名\") td",
    "address": ".s-shop-home-shopdata__col:-soup-contains(\"住所\") td",
    "phone": ".s-shop-home-shopdata__table-desc a[href^=\"tel:\"]",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".s-shop-home-introduction__img img, .p-slider-route__img img",
    "note": "写真には店舗までの道順案内を含みます。修理料金は機種・症状により異なります。"
  },
  {
    "name": "ECC外語学院",
    "index": "https://www.ecc.jp/school/kansai/kyoto/",
    "link": "^https://www\\.ecc\\.jp/school/kyoto/[a-z0-9_-]+/$",
    "kind": "service",
    "category": "teaching",
    "label": "英会話教室",
    "title": "h1.school-title",
    "photos": ".info-swiper img[src*=\"/school/photo/\"]",
    "note": "体験レッスン・入学は各校にお問い合わせください。"
  },
  {
    "name": "明光義塾",
    "index": "https://www.meikogijuku.jp/school/kyoto/",
    "link": "^https://www\\.meikogijuku\\.jp/school/kyoto/kyoto-shi-[a-z-]+/S\\d+/$",
    "kind": "service",
    "category": "teaching",
    "label": "個別指導塾",
    "title": "h1.title .text02",
    "prefix": "明光義塾",
    "address": "h1.title .text03",
    "phone": "a[href^=\"tel:0\"]:not([href*=\"0120\"])",
    "point": "maps/search/\\?api=1&(?:amp;)?query=(3[45]\\.\\d+)%2C(13[56]\\.\\d+)",
    "photos": ".media-item img",
    "note": "無料体験・入会は各教室にお問い合わせください。"
  },
  {
    "name": "BIZcomfort",
    "index": "https://bizcomfort.jp/kyoto/",
    "link": "^https://bizcomfort\\.jp/kyotofu/[a-z0-9-]+\\.html$",
    "kind": "space",
    "category": "workspace",
    "label": "コワーキングスペース",
    "title": "h1",
    "address": ".top_info_table td",
    "photos": "li > img[src*=\"672x504\"]",
    "note": "電話は運営元の共通窓口です。"
  },
  {
    "name": "リージャス",
    "index": "https://www.regus-office.jp/kyoto-area/",
    "link": "^https://www\\.regus-office\\.jp/kyoto-area/[a-z0-9-]+/$",
    "kind": "space",
    "category": "workspace",
    "label": "レンタルオフィス",
    "point": "(?=!2d13[56]\\.\\d+!3d(3[45]\\.\\d+))!2d(13[56]\\.\\d+)",
    "photos": ".single-slider .swiper-slide img",
    "note": "電話は運営元の共通窓口です。"
  },
  {
    "name": "TKP貸会議室",
    "index": "https://www.kashikaigishitsu.net/area/kansai/p-kyoto/",
    "link": "^https://www\\.kashikaigishitsu\\.net/facilitys/[a-z0-9-]+/$",
    "kind": "space",
    "category": "meeting-room",
    "label": "貸会議室",
    "point": "(?=!2d13[56]\\.\\d+!3d(3[45]\\.\\d+))!2d(13[56]\\.\\d+)",
    "exclude": "tel"
  },
  {
    "name": "京都着物レンタルwargo",
    "index": "https://kyotokimonorental.com/shop",
    "link": "^https://kyotokimonorental\\.com/shop/\\d+$",
    "kind": "item",
    "category": "clothing",
    "label": "着物レンタル"
  },
  {
    "name": "レンタル着物岡本",
    "index": "https://www.okamoto-kimono.com/storeinfo/",
    "link": "^https://www\\.okamoto-kimono\\.com/storeinfo/(?!kirakuan)[a-z]+\\.html$",
    "kind": "item",
    "category": "clothing",
    "label": "着物レンタル",
    "point": "!2d(?=13[56]\\.\\d+!3d(3[45]\\.\\d+))(13[56]\\.\\d+)",
    "photos": ".okk-store__slider img, .okk-store-detail__pic img"
  },
  {
    "name": "愛和服",
    "index": "https://aiwafuku.com/shop",
    "link": "^https://aiwafuku\\.com/shop/(?!asakusa)[a-z]+$",
    "kind": "item",
    "category": "clothing",
    "label": "着物レンタル",
    "prefix": "愛和服",
    "photos": "#shop a > img.attachment-large",
    "note": "写真には着物の着用例が含まれます。"
  },
  {
    "name": "オリックスレンタカー",
    "index": "https://car.orix.co.jp/search_towns/?towns_pk=212",
    "link": "^https://car\\.orix\\.co\\.jp/shops/\\?shops_pk=\\d+$",
    "within": "main",
    "kind": "item",
    "category": "car",
    "label": "レンタカー",
    "address": ".list-cmn-detail-item dd.list-cmn-detail-data p.txt-cmn",
    "photos": "img.nav-cmn-global-submenu-car-image",
    "note": "写真は貸出車種の例です。"
  },
  {
    "name": "スタジオラグ",
    "index": "https://www.ragnet.co.jp/studiorag/studio/index.html",
    "link": "^https://www\\.ragnet\\.co\\.jp/studiorag/[a-z]+ten/access\\.html$",
    "kind": "space",
    "category": "music-studio",
    "label": "音楽スタジオ",
    "title": "#breadcrumb li:last-child",
    "prefix": "スタジオラグ",
    "address": "article p:-soup-contains(\"〒\")",
    "point": "[?&](?:amp;)?ll=(3[45]\\.\\d+),(13[56]\\.\\d+)",
    "photos": "img[src*=\"/studiorag/images/\"][src*=\"/studio_\"]"
  },
  {
    "name": "JEUGIA",
    "index": "https://www.jeugia.co.jp/studio/rental-room.html",
    "link": "^https://www\\.jeugia\\.co\\.jp/hall_(?:5|7|8|9|17|20|78|89)/category-list\\.html$",
    "kind": "space",
    "category": "music-studio",
    "label": "ピアノ練習室",
    "title": ".block .info h3",
    "prefix": "JEUGIA",
    "address": ".block .info p",
    "phone": ".block .info p.tel",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".block img[src*=\"/hall/\"]",
    "note": "ピアノ・ドラム等の練習室をレッスンの空き時間に貸し出しています。写真は会場の様子です。"
  },
  {
    "name": "京都創造ガレージ",
    "index": "https://kyoto-creative-garage.studio/",
    "link": "^https://kyoto-creative-garage\\.studio/$",
    "kind": "space",
    "category": "studio",
    "label": "撮影スタジオ",
    "title": "title",
    "address": "p.adress",
    "phone": "p.contact-num",
    "point": "!2d(?=13[56]\\.\\d+!3d(3[45]\\.\\d+))(13[56]\\.\\d+)",
    "photos": "img[src*=\"top_studio_img\"]",
    "note": "撮影用の照明・カメラ機材のレンタルもあります。"
  },
  {
    "name": "field STUDIO",
    "index": "https://kyotofield.com/studio.html",
    "link": "^https://kyotofield\\.com/studio\\.html$",
    "kind": "space",
    "category": "music-studio",
    "label": "音楽スタジオ",
    "title": "a[href=\"studio.html\"] > p",
    "address": "div.text9:-soup-contains(\"京都市\")",
    "phone": "div.footerif",
    "photos": "img[src*=\"picture/studio_\"]"
  },
  {
    "name": "La Muse",
    "index": "https://lamusek.com/",
    "link": "^https://lamusek\\.com/$",
    "kind": "space",
    "category": "music-studio",
    "label": "音楽サロン",
    "title": "h2",
    "address": "p.wp-block-paragraph:-soup-contains(\"〒\")",
    "phone": "a[href^=\"tel:0\"]",
    "point": "!2d(?=13[56]\\.\\d+!3d(3[45]\\.\\d+))(13[56]\\.\\d+)",
    "photos": "img[src*=\"スライド\"], img[src*=\"/2023/03/S__\"]"
  },
  {
    "name": "スタジオブル",
    "index": "http://www.studio-buru.com/",
    "link": "^https?://www\\.studio-buru\\.com/(?:index\\.php)?$",
    "kind": "space",
    "category": "music-studio",
    "label": "音楽スタジオ",
    "title": "h1",
    "address": "#tail p:-soup-contains(\"〒\")",
    "phone": "#tail p:-soup-contains(\"TEL\")",
    "point": "!2d(?=13[56]\\.\\d+!3d(3[45]\\.\\d+))(13[56]\\.\\d+)",
    "photos": "img[src*=\"mainvisual\"]"
  },
  {
    "name": "コーダ音楽スタジオ",
    "index": "https://www.skycoda.co.jp/studio/",
    "link": "^https://www\\.skycoda\\.co\\.jp/studio/$",
    "kind": "space",
    "category": "music-studio",
    "label": "音楽スタジオ",
    "title": "title",
    "address": "p.wp-block-paragraph:-soup-contains(\"〒\")",
    "phone": "a[href^=\"tel:\"]",
    "point": "!2d(?=13[56]\\.\\d+!3d(3[45]\\.\\d+))(13[56]\\.\\d+)",
    "photos": "img[src*=\"スタジオ-\"][src$=\"-scaled.jpg\"]"
  },
  {
    "name": "JEUGIA 音楽教室",
    "index": "https://jeugia.co.jp/studio/",
    "link": "^https://jeugia\\.co\\.jp/hall_\\d+/service-top_1\\.html$",
    "kind": "service",
    "category": "music",
    "label": "音楽教室",
    "title": "div.info h3",
    "prefix": "JEUGIA",
    "address": "div.info p:-soup-contains(\"京都市\")",
    "phone": "div.info p.tel",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".hall-title img[src*=\"/hall/\"], .block img[src*=\"/hall/\"]",
    "note": "体験レッスン・入会は各センターにお問い合わせください。電話は一部の教室で共通の窓口です。"
  },
  {
    "name": "京都福祉サービス協会",
    "index": "https://www.kyoto-fukushi.org/office/",
    "link": "^https://www\\.kyoto-fukushi\\.org/office/detail/(?!(?:hnb|jzk|mtz|mrz|sht|tnsj)/)[a-z]+/$",
    "kind": "service",
    "category": "care",
    "label": "介護サービス",
    "title": "main h3",
    "prefix": "京都福祉サービス協会",
    "address": "p.add",
    "point": "LatLng\\((3[45]\\.\\d+),\\s*(13[56]\\.\\d+)\\)",
    "photos": ".officeImg img",
    "note": "ホームヘルプ・ケアプラン作成などの提供サービスは事業所ごとに異なります。ご利用は各事業所にご相談ください。",
    "exclude": "/all-scaled\\.jpg$"
  },
  {
    "name": "京都福祉サービス協会 児童館",
    "index": "https://www.kyoto-fukushi.org/office/",
    "link": "^https://www\\.kyoto-fukushi\\.org/office/detail/(?:mtz|mrz|sht|tnsj)/$",
    "kind": "service",
    "category": "childcare",
    "label": "児童館",
    "title": "main h3",
    "prefix": "京都福祉サービス協会",
    "address": "p.add",
    "point": "LatLng\\((3[45]\\.\\d+),\\s*(13[56]\\.\\d+)\\)",
    "photos": ".officeImg img",
    "note": "利用・行事は各児童館にお問い合わせください。"
  },
  {
    "name": "健光園",
    "index": "https://www.kenkouen.jp/shisetsu",
    "link": "^https://www\\.kenkouen\\.jp/shisetsu/(?![a-z0-9]+_jidokan)[a-z0-9]+$",
    "kind": "service",
    "category": "care",
    "label": "介護サービス",
    "title": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dl.list-type03 dd",
    "prefix": "健光園",
    "address": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dd:-soup-contains(\"〒\")",
    "phone": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dd:-soup-contains(\"075\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[src*=\"/assets/img/shisetsu_\"]",
    "note": "デイサービス・ショートステイ・訪問介護などの提供サービスは施設ごとに異なります。ご利用は各施設にご相談ください。"
  },
  {
    "name": "健光園 児童館",
    "index": "https://www.kenkouen.jp/shisetsu",
    "link": "^https://www\\.kenkouen\\.jp/shisetsu/[a-z0-9]+_jidokan$",
    "kind": "service",
    "category": "childcare",
    "label": "児童館",
    "title": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dl.list-type03 dd",
    "address": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dd:-soup-contains(\"〒\")",
    "phone": "div.area-shisetsu_page-box02:-soup-contains(\"施設概要\") dd:-soup-contains(\"075\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[src*=\"/assets/img/shisetsu_\"]",
    "note": "利用・行事は各児童館にお問い合わせください。"
  },
  {
    "name": "ワンルーク",
    "index": "https://oneluke.net/shop",
    "link": "^https://oneluke\\.net/[a-z0-9-]+/$",
    "within": "div.bl_shop_item:-soup-contains(\"京都市\")",
    "kind": "service",
    "category": "pet-care",
    "label": "トリミング・ペットホテル",
    "title": ".bl_info_listItem:-soup-contains(\"店舗名\") dd",
    "address": ".bl_info_listItem:-soup-contains(\"住所\") dd",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".swiper-slide img[src*=\"/kv0\"]",
    "note": "トリミング・ペットホテルの予約は店舗にお問い合わせください。"
  },
  {
    "name": "青木農園",
    "index": "https://www.aokinouen-kyoto.com/",
    "link": "^https://www\\.aokinouen-kyoto\\.com/?$",
    "kind": "service",
    "category": "gardening",
    "label": "造園・庭木剪定",
    "address": "p:-soup-contains(\"〒616-8192\")",
    "photos": "img.gallery-item",
    "note": "写真は施工事例です。剪定・造園の見積もりはお問い合わせください。"
  },
  {
    "name": "ペットサロンくんくん",
    "index": "https://pet-hoteltoinkyoto.com/",
    "link": "^https://pet-hoteltoinkyoto\\.com/pet-salon$",
    "kind": "service",
    "category": "pet-care",
    "label": "トリミングサロン",
    "title": "h1",
    "address": "a.link---cd-item:-soup-contains(\"京都市\")",
    "phone": "a.link---cd-item[href^=\"tel:\"]",
    "photos": "img.image-cover-fw",
    "note": "ホテルトーイン京都1階の小型犬専用サロンです。予約は電話でお問い合わせください。"
  },
  {
    "name": "自転車のきゅうべえ",
    "index": "https://qbei.co.jp/shop/",
    "link": "^https://qbei\\.co\\.jp/shop/(?!service)[a-z]+\\.html$",
    "kind": "service",
    "category": "repair",
    "label": "自転車修理",
    "title": "h2.page__title",
    "prefix": "自転車のきゅうべえ",
    "address": ".shop__address__wrapper dd:-soup-contains(\"京都市\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[src*=\"/images/shop/shop_\"]:not([src*=\"staff\"]):not([src*=\"shopimg\"])",
    "note": "他店購入の自転車の修理にも対応しています。修理料金は店舗にお問い合わせください。"
  },
  {
    "name": "パソコン修理PCバル",
    "index": "https://www.smaphodock24.jp/shop/index.php",
    "link": "^https://www\\.smaphodock24\\.jp/shop/[a-z_]+\\.php$",
    "within": "table.searchshopbox_tbl2 tr:-soup-contains(\"京都府京都市\")",
    "kind": "service",
    "category": "it-support",
    "label": "パソコン修理",
    "title": "title",
    "address": "td p:-soup-contains(\"京都府京都市\"), td span:-soup-contains(\"京都府京都市\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[alt^=\"外観写真\"]",
    "note": "パソコン・スマホの修理、データ復旧に対応しています。料金は機種・症状により異なります。"
  },
  {
    "name": "天理楽器 音楽教室",
    "index": "https://tenrigakki.com/school/",
    "link": "^https://tenrigakki\\.com/school/kyoto/$",
    "kind": "service",
    "category": "music",
    "label": "音楽教室",
    "photos": ".p-shop-hero__thumbnail img, .swiper-slide img[src*=\"/uploads/2021/06/lesson_\"]",
    "note": "写真には教室とレッスンの様子を含みます。体験レッスンは教室にお問い合わせください。"
  },
  {
    "name": "人力車 忍者屋",
    "index": "https://ninjaya.travel/",
    "link": "^https://ninjaya\\.travel/gion/$",
    "kind": "service",
    "category": "guide",
    "label": "人力車",
    "photos": ".hero img, .vehicle img",
    "note": "一組ずつ貸切で俥夫が案内する人力車ツアーです。乗り場は八坂の塔周辺など複数あります。予約は公式サイトから。"
  },
  {
    "name": "アート引越センター",
    "index": "https://www.the0123.com/siten/kyoto.html",
    "link": "^https://www\\.the0123\\.com/siten/kyoto[a-z]*\\.html$",
    "kind": "service",
    "category": "moving",
    "label": "引越し",
    "prefix": "アート引越センター",
    "photos": ".p-shop-information__image-main img, img[src*=\"/common/img/index/img_pack-basic\"], img[src*=\"/common/img/index/img_pack-half\"]",
    "note": "写真には引越プランの紹介画像を含みます。"
  },
  {
    "name": "Winスクール",
    "index": "https://www.winschool.jp/map/kinki/kyoto/kyoto.html",
    "link": "^https://www\\.winschool\\.jp/map/kinki/kyoto/[a-z]+\\.html$",
    "kind": "service",
    "category": "programming",
    "label": "パソコン教室",
    "title": "h1",
    "address": "td p.el_text:-soup-contains(\"京都市\")",
    "phone": "td p.el_text:-soup-contains(\"075-\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[src*=\"_classroom_overview_\"], img[src*=\"_building_1\"]",
    "note": "プログラミング・Webデザイン・Officeなどの個人レッスン制スクールです。無料カウンセリングは各校にお問い合わせください。"
  },
  {
    "name": "EYS音楽教室",
    "index": "https://www.eys-musicschool.com/access/area_kansai.php",
    "link": "^https://www\\.eys-musicschool\\.com/access/[a-z]+\\.php$",
    "kind": "service",
    "category": "music",
    "label": "音楽教室",
    "title": "ul.topicPath_md li:last-child span",
    "prefix": "EYS音楽教室",
    "address": "span.daikanyama_studio_access_schedule_info:-soup-contains(\"京都市\")",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".mlc_present_slides img",
    "note": "電話は運営元の共通窓口です。無料体験レッスンは公式サイトから予約できます。"
  },
  {
    "name": "ほけんの相談ショップ",
    "index": "https://lifesalon.jp/reserve/kyoto.html",
    "link": "^https://lifesalon\\.jp/shop/\\d+\\.html$",
    "kind": "service",
    "category": "consulting",
    "label": "保険相談",
    "title": "h1",
    "address": "dl.info dd:-soup-contains(\"京都市\")",
    "phone": "#sec-name-tel",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": "img[src*=\"/hokenWeb/shop/\"], img[data-src*=\"/hokenWeb/shop/\"]:not([data-src*=\"Staff\"])",
    "note": "保険の見直し・相談を無料で受け付ける来店型ショップです。予約は電話または公式サイトから。",
    "exclude": "/Pic2\\."
  },
  {
    "name": "エステティック ミス・パリ",
    "index": "https://www.miss-paris.co.jp/salon/area/kinki/",
    "link": "^https://www\\.miss-paris\\.co\\.jp/salon/kinki/details/[a-z0-9_-]+\\.html$",
    "within": ".pref_box:has(#kyoto)",
    "kind": "service",
    "category": "beauty",
    "label": "エステ",
    "photos": ".thumbnails.pcthum img"
  },
  {
    "name": "男のエステ ダンディハウス",
    "index": "https://www.dandy-house.co.jp/salon/area/kinki/",
    "link": "^https://www\\.dandy-house\\.co\\.jp/salon/kinki/details/[a-z0-9_-]+\\.html$",
    "within": ".pref_box:has(#kyoto)",
    "kind": "service",
    "category": "beauty",
    "label": "メンズエステ",
    "photos": ".thumbnails.pcthum img"
  },
  {
    "name": "ストラッシュ",
    "index": "https://stlassh.com/salons/",
    "link": "^https://stlassh\\.com/salons/[a-z0-9-]+/$",
    "within": "li#kansai",
    "kind": "service",
    "category": "beauty",
    "label": "脱毛サロン",
    "title": "h1.bl_lower_mv_ttl",
    "address": "dd.bl_info_ditem:-soup-contains(\"京都市\")",
    "phone": "a[href^=\"tel:\"]",
    "point": "maps/embed\\?pb=(?=[^\"]*?!3d(3[45]\\.\\d+))[^\"]*?!2d(13[56]\\.\\d+)",
    "photos": ".bl_photo_list img",
    "note": "電話は運営元の共通予約窓口です。"
  },
  {
    "name": "Bodysh",
    "index": "https://www.bodysh.net/shop/",
    "link": "^https://www\\.bodysh\\.net/shop/[a-z0-9_-]+/?$",
    "within": "li.item:-soup-contains(\"京都市\")",
    "kind": "service",
    "category": "massage",
    "label": "リラクゼーション",
    "title": "h2.wp-block-heading:not(:-soup-contains(\"。\"))",
    "address": ".item_detail p:-soup-contains(\"【住所】\")",
    "phone": "a[href^=\"tel:075\"]",
    "point": "maps/place/[^\"]*?@(3[45]\\.\\d+),(13[56]\\.\\d+)",
    "photos": ".feature_box img",
    "note": "写真は運営元の施術イメージです。"
  },
  {
    "name": "てもみん",
    "index": "https://map.global-sports.co.jp/%E4%BA%AC%E9%83%BD%E5%BA%9C/",
    "link": "^https://map\\.global-sports\\.co\\.jp/detail/\\d+/$",
    "kind": "service",
    "category": "massage",
    "label": "もみほぐし",
    "title": "h1",
    "address": "div:has(> h2:-soup-contains(\"住所\")) div.text-text",
    "photos": ".swiper-slide img",
    "note": "写真は運営元の施術メニュー紹介写真です。鍼灸・整体のグローバル治療院を併設しています。",
    "exclude": "%E7%B5%B1%E5%90%88%E6%B2%BB%E7%99%82"
  },
  {
    "name": "ビューステージ アイブロウサロン",
    "index": "https://shop.beaustage.com/%E4%BA%AC%E9%83%BD%E5%BA%9C/",
    "link": "^https://shop\\.beaustage\\.com/detail/[A-Z0-9]+/$",
    "kind": "service",
    "category": "beauty",
    "label": "眉毛サロン",
    "title": "h1",
    "address": "div:has(> h2:-soup-contains(\"住所\")) div.text-text",
    "photos": ".swiper-slide img[src*=\"/stores/\"][alt=\"\"]",
    "exclude": "%E5%85%AC%E5%BC%8FHP",
    "note": "写真には施術例を含みます。"
  },
  {
    "name": "メンズ脱毛RINX",
    "index": "https://www.mens-rinx.jp/salon/",
    "link": "^https://www\\.mens-rinx\\.jp/salon/[a-z0-9-]+$",
    "within": ".p-salon-list-area:-soup-contains(\"関西\")",
    "kind": "service",
    "category": "beauty",
    "label": "メンズ脱毛",
    "phone": "a[href^=\"tel:075\"]",
    "photos": ".swiper-slide img[src*=\"/uploads/shop/info/\"]"
  }
]
````

### `requirements.txt`

````text
beautifulsoup4>=4.12,<5
Pillow>=10,<13
requests>=2.31,<3
pyproj>=3.7,<4
````
