"""Verify imported records, their actual WebP files, and optionally the running map."""
import argparse
import hashlib
import io
import json
import os
import re
from collections import Counter
from pathlib import Path

from PIL import Image
from crawl import HERE, address_point
import requests


def map_items(origin):
    # The map endpoint returns at most 300 items per viewport. Query smaller
    # viewports just as the client does when the user zooms into Kyoto.
    mapped = {}
    boxes = [(34.85, 35.33, 135.55, 135.90)]
    while boxes:
        south, north, west, east = boxes.pop()
        response = requests.get(origin + '/api/items', params=dict(south=south, north=north, west=west, east=east), timeout=10)
        response.raise_for_status()
        items = response.json()['items']
        mapped.update((item['id'], item) for item in items)
        if len(items) >= 300:
            if north - south < .00001:
                raise ValueError('map limit reached at one location')
            lat, lng = (south + north) / 2, (west + east) / 2
            boxes.extend((s, n, w, e) for s, n in ((south, lat), (lat, north))
                         for w, e in ((west, lng), (lng, east)))
    return mapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('RAB_DATA', HERE.parents[1])) / 'users/_public/items')
    parser.add_argument('--api', help='RAB server origin, e.g. http://localhost:3016')
    parser.add_argument('--wards', action='store_true', help='verify every coordinate against the GSI ward')
    args = parser.parse_args()
    mapped = map_items(args.api) if args.api else {}
    counts, keys, photo_count = Counter(), set(), 0
    for file in sorted(args.output.glob('*/source.json')):
        source = json.loads(file.read_text())
        if 'key' not in source:
            continue
        directory = file.parent
        item = json.loads((directory / 'item.json').read_text())
        key = tuple(source['key'])
        assert key not in keys and key[1] == item['category'], key
        keys.add(key)
        assert item['id'] == directory.name and item['active'] and item['shared'] and item['located'], key
        assert item['homepage'].startswith(('https://', 'http://')) and item['contacts'][0]['code'] == '+81', key
        digits = item['contacts'][0]['value']
        assert re.fullmatch(r'0\d{9,10}', digits) and (not digits.startswith('075') or len(digits) == 10), (key, digits)
        if args.wards:
            address_point(item['place'], (item['latitude'], item['longitude']))
        if args.api:
            pin = mapped[item['id']]
            for field in ('title', 'category', 'homepage', 'contacts', 'latitude', 'longitude'):
                assert pin[field] == item[field], (key, field)
        assert 2 <= len(item['images']) == len(source['photos']) <= 3, key
        for image in item['images']:
            for field, maximum in [('name', 1280), ('thumb', 320)]:
                name = image[field]
                data = (directory / name).read_bytes()
                assert name == hashlib.sha256(data).hexdigest()[:32] + '.webp'
                with Image.open(io.BytesIO(data)) as img:
                    assert img.format == 'WEBP' and max(img.size) <= maximum
                    if field == 'name':
                        assert img.size == (image['width'], image['height'])
                    img.verify()
                if args.api:
                    response = requests.get(args.api + '/api/images/' + name, timeout=10)
                    response.raise_for_status()
                    assert response.content == data
        counts[item['kind'], item['category']] += 1
        photo_count += len(item['images'])
    assert keys, 'No imported listings'
    print(f'{len(keys)} listings, {photo_count} photos', dict(counts))


if __name__ == '__main__':
    main()
