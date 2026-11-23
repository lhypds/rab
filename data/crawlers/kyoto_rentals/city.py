"""Kyoto City Tourism Association listings for rentals and bookable services."""
from urllib.parse import parse_qs, urljoin, urlsplit
import re

from crawl import LABEL, address_point, page, photos

BASE = 'https://ja.kyoto.travel/tourism/'
KINDS = {'bike': 'item', 'clothing': 'item', 'photography': 'service',
         'guide': 'service', 'driver': 'service', 'teaching': 'service',
         'studio': 'space', 'workspace': 'space', 'event-space': 'space'}


def classify(section, title, description):
    if re.search(r'梨花和服|レンタル和楽$', title):
        return None  # the original crawler imports the branch/brand record
    if 'セルフ写真館' in title:
        return 'studio'
    if re.search('撮影|変身スタジオ|STUDIO KOKORO', title) and re.search('撮影|写真', description):
        return 'photography'
    if re.search(r'(着物|きもの|浴衣).*レンタル|レンタル.*(着物|きもの)|京あるき', title):
        return 'clothing'
    if section == 12 and re.search('レンタサイクル|自転車レンタル|自転車貸出', title + description):
        return 'bike'
    if section == 14 and re.search('貸切|観光タクシー|観光ハイヤー', title + description) and re.search('タクシー|自動車|バス|交通', title):
        return 'driver'
    if section == 14 and 'ガイド' in title and re.search('ガイド|案内士', description):
        return 'guide'
    if section == 14 and 'rental office' in title.lower():
        return 'workspace'
    if section == 3 and re.search('教室|指導|講師|レッスン|職人が教|丁寧に教', title + description):
        return 'teaching'
    if section == 2 and re.search('貸館|ホールの貸|貸しホール|ホールを貸', description):
        return 'event-space'
    return None


def city_candidates():
    seen = set()
    for section in (12, 14, 3, 2):
        index = page(BASE + 'search.php?category_id=' + str(section))
        cards = index.select('a[href*="single01.php?"]')
        if not cards:
            raise ValueError(f'missing city directory section {section}')
        for card in cards:
            if not card.get_text(strip=True):
                continue
            url = urljoin(BASE, card['href'])
            spot = parse_qs(urlsplit(url).query).get('tourism_id', [''])[0]
            if not spot.isdigit() or (section, spot) in seen:
                continue
            seen.add((section, spot))
            yield url, (section, spot)


def city_offer(url, row):
    section, spot = row
    html = page(url)
    detail = html.select_one('article#detail')
    if not detail or not detail.h1:
        raise ValueError('missing city listing')
    title = detail.h1.get_text(' ', strip=True)
    summary = ' '.join(e.get_text(' ', strip=True) for e in detail.select('.mod_txt01, .mod_txt02'))
    category = classify(section, title, summary)
    if not category:
        raise ValueError('outside supported rental/service types')
    fields = {}
    for tr in detail.select('tr'):
        if tr.th and tr.td:
            fields.setdefault(tr.th.get_text(strip=True), tr.td)
    if not all(k in fields for k in ('TEL', 'ホームページ', '住所・所在地')):
        raise ValueError('missing contact or address')
    link = fields['ホームページ'].find('a', href=True)
    if not link or not link['href'].startswith(('https://', 'http://')):
        raise ValueError('missing operator homepage')
    gallery = photos(detail, f'.detailGallery img[src*="/tourism/{spot}-"]', url)
    if len(gallery) < 2:
        raise ValueError('insufficient photos')
    addr = fields['住所・所在地'].get_text(' ', strip=True)
    frame = detail.select_one('iframe[src*="/maps/embed/"]')
    query = parse_qs(urlsplit(frame['src']).query).get('q', [''])[0] if frame else ''
    pin = re.fullmatch(r'\s*([\d.]+)\s*,\s*([\d.]+)\s*', query)
    label = LABEL[category]
    if category == 'driver' and 'バス' in title:
        label = '貸切観光バス'
    elif category == 'photography':
        label = '撮影'
    return dict(label=label, source=url, homepage=link['href'], category=category, title=title, kind=KINDS[category],
                photos=gallery, phone=fields['TEL'].get_text(' ', strip=True),
                location=address_point(addr, pin.groups() if pin else None))
