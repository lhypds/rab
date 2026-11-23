"""Additional Kyoto operators. Run from this directory or the project root."""
import argparse
import fcntl
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode, urljoin

import requests
from city import city_candidates, city_offer
from crawl import HERE, address_point, fetch, page, phone_digits, photos, publish

PARK = 'https://www.kyotopublic.or.jp/parking'
INNS = 'https://www.kyoto-machiya-inn.com/jp'
ERRORS = (ValueError, KeyError, OSError, requests.RequestException)


def parking_index():
    number = 1
    seen = set()
    while True:
        query = urlencode(dict(type=10, mode='list', sort='near', latitude=34.983243,
                               longitude=135.760213, page=number))
        result = json.loads(fetch(PARK + '/search/search?' + query))['result']
        rows = result['items']
        if not rows or not any(r['id'] not in seen for r in rows):
            raise ValueError(f'parking pagination stalled on page {number}')
        for row in rows:
            if row['id'] not in seen:
                seen.add(row['id'])
                yield PARK + '/search/detail/' + row['id'], row
        if number * 10 >= int(result['count']):
            break
        number += 1


def parking_offer(url, row):
    title = re.sub(r'^【[^】]*】', '', row['name']).strip()
    if re.search('営業終了|閉鎖中|閉鎖しました', title):
        raise ValueError('closed')
    address = row['address']
    if '京都市' not in address:
        raise ValueError('outside Kyoto City')
    gallery = [PARK + f['file_path'] for f in row['files'] if f.get('file_path', '').startswith('/files/')]
    if len(set(gallery)) < 2:
        raise ValueError('insufficient photos')
    phone = row.get('tel') or ''
    note = ''
    if not phone.strip() and 'くるっとパーク' in title:
        office = parking_office()
        phone = office
        note = '電話は運営元・京都市都市整備公社の総務駐車場部です。'
    phone_digits(phone)
    return dict(source=url, homepage=url, title=title, category='parking', kind='space',
                location=address_point(address, (row['latitude1'], row['longitude1'])),
                photos=gallery, phone=phone, note=note)


@lru_cache
def parking_office():
    text = page(PARK + '/pages/soudan').get_text(' ', strip=True)
    number = re.search(r'総務駐車場部.{0,120}?TEL[：:]\s*([0-9-]+)', text)
    if not number:
        raise ValueError('no operator telephone')
    return number[1]


def inn_index():
    records = json.loads(fetch(INNS + '/machiya_json/'))
    for row in records:
        if row.get('post_status') == 'publish' and '一棟貸し' in row['post_title']:
            yield row['detail_url'], row


def inn_offer(url, row):
    book = page(url)
    title_node = book.select_one('h1 strong')
    address = next((d.get_text(strip=True) for d in book.select('.tabContent dd') if '京都市' in d.get_text() and '〒' in d.get_text()), '')
    if not title_node or '一棟貸し' not in title_node.get_text():
        raise ValueError('not a whole-house rental')
    title = title_node.get_text(' ', strip=True)
    phone = book.find(string=re.compile(r'ご予約・お問い合わせ[：:]'))
    # The property's own map search publishes coordinates keyed by detail URL.
    pin = (row['lat'], row['lng']) if row.get('lat') and row.get('lng') else None
    return dict(source=url, homepage=url, title=title, category='home', kind='space',
                location=address_point(address, pin), phone=str(phone or ''),
                photos=photos(book, '.detailMainVisual img[src*="/uploads/"]', url),
                note='電話は町家レジデンスイン京都の共通予約窓口です。')


STORAGE = 'https://www.kyoto-life.co.jp/container/index.html'


def storage_index():
    index = page(STORAGE)
    for url in sorted({urljoin(STORAGE, a['href']) for a in index.select('a[href*="container_shop_code="]')}):
        yield url, None


def storage_offer(url, _):
    facility = page(url)
    title = facility.h1.get_text(strip=True) if facility.h1 else ''
    if not title or title.startswith('BB') or 'バイク専用' in title:
        raise ValueError('not a storage unit')
    label = facility.find('dt', string=re.compile(r'^所在地$'))
    street = label.find_next_sibling('dd') if label else None
    address = next(street.stripped_strings, '') if street else ''
    contact = facility.select_one('main .mod-tell-text, .info .mod-tell-text')
    frame = facility.select_one('iframe[src*="maps/embed/v1/place"]')
    coord = re.search(r'[?&]q=([\d.]+),([\d.]+)', frame['src']) if frame else None
    gallery = photos(facility, '.image-thumbnail img[src*="/container/"]', url)
    return dict(source=url, homepage=url, title='京都ライフ ' + title, category='storage', kind='space',
                location=address_point(address, coord.groups() if coord else None),
                photos=[u for u in gallery if '/cp_' not in u], phone=contact.get_text(strip=True) if contact else '',
                note='電話は京都ライフの貸倉庫お問い合わせ窓口です。')


def run(root, sources):
    entries = {}
    known = []
    for file in root.glob('*/item.json'):
        item = json.loads(file.read_text())
        key_file = file.with_name('source.json')
        if key_file.exists():
            entries[tuple(json.loads(key_file.read_text())['key'])] = item['id']
        known.append(item)
    report = []
    for group, index, offer in sources:
        for url, row in index():
            category = group
            try:
                prior = next((v for (source, cat), v in entries.items()
                              if source == url and (group == 'city' or cat == group)), None)
                if prior:
                    status, detail = 'existing', prior
                elif group == 'parking' and any(i.get('homepage') == url and i['category'] == group for i in known):
                    status, detail = 'existing', 'already imported from tourism directory'
                else:
                    listing = offer(url, row)
                    category = listing['category']
                    _, lat, lon, _ = listing['location']
                    phone = phone_digits(listing['phone'])
                    # Different branches often share an operator URL/telephone.
                    # Require proximity as well, and never merge separate houses.
                    duplicate = next((i for i in known if group == 'city' and i['category'] == category
                                      and i.get('located') and abs(i['latitude'] - lat) < .00055
                                      and abs(i['longitude'] - lon) < .00065
                                      and (i.get('homepage') == listing['homepage'] or
                                           any(c.get('value') == phone for c in i.get('contacts', [])))), None)
                    if duplicate:
                        status, detail = 'existing', duplicate['id']
                    else:
                        status, detail = publish(listing, root, entries)
                        known.append(json.loads((root / detail / 'item.json').read_text()))
            except ERRORS as error:
                status, detail = 'skipped', str(error)
            report.append(dict(source=url, category=category, status=status, result=detail))
            print(status, url, detail, flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('RAB_DATA', HERE.parents[1])) / 'users/_public/items')
    parser.add_argument('--source', choices=['all', 'city', 'home', 'parking', 'storage'], default='all')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / '.kyoto-rentals.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sources = [('home', inn_index, inn_offer), ('parking', parking_index, parking_offer),
                   ('city', city_candidates, city_offer), ('storage', storage_index, storage_offer)]
        results = run(args.output, [s for s in sources if args.source in ('all', s[0])])
        (HERE / f'operators-{args.source}-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
