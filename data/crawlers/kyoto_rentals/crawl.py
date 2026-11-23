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
LABEL = {'storage': '貸倉庫', 'guide': 'ガイド', 'teaching': '体験教室', 'studio': 'レンタルスタジオ', 'workspace': 'レンタルオフィス', 'home': '一棟貸し', 'car': 'レンタカー', 'clothing': '着物レンタル', 'bike': 'レンタサイクル', 'parking': '時間貸し駐車場', 'event-space': '貸ホール',
         'meeting-room': '貸会議室', 'driver': '観光タクシー', 'photography': 'プロカメラマン撮影プラン'}
session = requests.Session()
session.headers['User-Agent'] = 'RAB-Kyoto-Rental-Directory/1.0'
session.mount('https://', HTTPAdapter(max_retries=Retry(total=2, backoff_factor=1, status_forcelist=[429, 502, 503, 504])))
last_request = {}


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
        for card in html.select('a.spotArticle__link'):
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


def publish(offer, root, stored):
    # A source can have two offers (kimono rental and photographer hire).
    key = [offer['source'], offer['category']]
    digits = phone_digits(offer['phone'])
    if len(set(offer['photos'])) < 2:
        raise ValueError('fewer than two distinct facility photos')
    with tempfile.TemporaryDirectory(prefix='.kyoto-', dir=root) as tmp:
        folder = Path(tmp)
        images, urls = [], []
        for url in dict.fromkeys(offer['photos']):
            try:
                with Image.open(io.BytesIO(fetch(url))) as original:
                    img = ImageOps.exif_transpose(original).convert('RGB')
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
        if len(images) < 2:
            raise ValueError('fewer than two distinct facility photos')
        address, lat, lng, method = offer['location']
        ident = str(time.time_ns() // 1_000_000)
        while any(root.parent.parent.glob(f'*/items/{ident}')):
            ident = str(int(ident) + 1)
        now = datetime.fromtimestamp(int(ident)/1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        label = offer.get('label', LABEL[offer['category']])
        title = offer['title']
        if label not in title:
            title += '（' + label + '）'
        item = dict(id=ident, title=title, description=f'{address}。料金・利用条件は公式サイトでご確認ください。' + offer.get('note', ''),
                    kind=offer['kind'], category=offer['category'], active=True, shared=True, mode='inquiry',
                    contacts=[dict(type='phone', code='+81', value=digits)], homepage=offer['homepage'],
                    located=True, latitude=lat, longitude=lng, place=address, region=REGION,
                    currency='JPY', price=None, rates=[], hours=[], days=[], images=images, createdAt=now, updatedAt=now)
        for file, obj in [('item.json', item), ('source.json', dict(key=key, coordinates=method, photos=urls))]:
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
            if existing:
                status, result = 'existing', existing
            else:
                status, result = publish(callback(), root, stored)
        except (ValueError, requests.RequestException, KeyError, OSError) as error:
            status, result = 'skipped', str(error)
        report.append(dict(source=url, category=category, status=status, result=result))
        print(status, url, result, flush=True)

    for kind, category, keyword, pattern in SEARCH:
        for url in dict.fromkeys(directory_links(keyword, pattern)):
            # Branches below supersede the aggregate entry. Ranbura closed
            # per its operator: https://www.kyotoarashiyama.jp/archives/5564
            if url.endswith(('/9745', '/8195')):
                reason = 'covered by individual branch records' if url.endswith('/9745') else 'operator announced closure'
                report.append(dict(source=url, category=category, status='skipped', result=reason))
                continue
            attempt(url, category, lambda: directory_offer(url, kind, category))
    shops = page(SHOPS)
    plan = page(PHOTO)
    terms = next((p.get_text(strip=True) for p in plan.select('p') if '限定' in p.get_text() and 'プロカメラマン' in p.get_text()), '')
    for url in sorted({urljoin(SHOPS, a['href']) for a in shops.select('a[href]')}):
        if not re.fullmatch(re.escape(SHOPS) + r'kyoto-area/(?:arashiyama|ekimae|gion|kiyomizudera)/', url):
            continue
        try:
            shop = branch_offer(url)
        except (ValueError, requests.RequestException, KeyError) as error:
            report.append(dict(source=url, status='skipped', result=str(error)))
            continue
        attempt(url, 'clothing', lambda: shop)
        if shop['title'].split()[-1] in terms:
            attempt(url, 'photography', lambda: dict(shop, kind='service', category='photography', homepage=PHOTO,
                                      photos=photos(plan, 'img[alt="梨花和服の撮影プラン"]', PHOTO)))
    car_list = page(CAR_INDEX)
    for url in sorted({urljoin(CAR_INDEX, a['href']) for a in car_list.select('a[href]')}):
        if re.fullmatch(re.escape(CAR_INDEX) + r'[a-z-]+/store-[0-9-]+\.html', url):
            attempt(url, 'car', lambda: car_offer(url))
    return report


if __name__ == '__main__':
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('RAB_DATA', HERE.parents[1])) / 'users/_public/items')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / '.kyoto-rentals.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        report = run(args.output)
        (HERE / 'last-run.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
