"""Network validation and manipulation. Roads are undirected."""
import json
import math
from pathlib import Path

DATA_FILE = Path(__file__).with_name('data.json')


def load_data(path=DATA_FILE):
    with open(path, encoding='utf-8') as file:
        data = json.load(file)
    if not isinstance(data, dict) or not isinstance(data.get('locations'), list) or not isinstance(data.get('roads'), list):
        raise ValueError('Network file must contain locations and roads lists')
    return data


def add_location(data, name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise ValueError('Location name must be 1 to 80 characters')
    name = name.strip()
    if any(loc.casefold() == name.casefold() for loc in data['locations']):
        raise ValueError('Location already exists')
    data['locations'].append(name)
    return name


def add_road(data, start, end, distance):
    if not isinstance(start, str) or not isinstance(end, str) or start not in data['locations'] or end not in data['locations']:
        raise ValueError('Select two existing locations')
    if start == end:
        raise ValueError('A road must connect two different locations')
    if isinstance(distance, bool) or not isinstance(distance, (float, int)) or not math.isfinite(distance) or distance <= 0:
        raise ValueError('Distance must be a positive number')
    if any({r['from'], r['to']} == {start, end} for r in data['roads']):
        raise ValueError('A road already connects these locations')
    new_id = max((r['id'] for r in data['roads']), default=0) + 1
    road = {'id': new_id, 'from': start, 'to': end, 'distance': distance, 'blocked': False}
    data['roads'].append(road)
    return road


def update_road(data, road_id, blocked):
    if type(blocked) is not bool:
        raise ValueError('blocked must be true or false')
    for road in data['roads']:
        if road['id'] == road_id:
            road['blocked'] = blocked
            return road
    raise LookupError('Road not found')


def build_graph(data):
    graph = {name: {} for name in data['locations']}
    for road in data['roads']:
        if road['blocked']:
            continue
        start, end, distance = road['from'], road['to'], road['distance']
        graph[start][end] = distance
        graph[end][start] = distance
    return graph
