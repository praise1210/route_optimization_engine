import pytest
from app import create_app


@pytest.fixture
def client():
    app = create_app({'locations': [], 'roads': []})
    app.config['TESTING'] = True
    return app.test_client()


def test_create_and_route_then_block(client):
    for name in ['A', 'B', 'C', 'D']:
        assert client.post('/api/locations', json={'name': name}).status_code == 201
    for start, end, distance in [('A', 'B', 10), ('A', 'C', 15), ('B', 'D', 25), ('C', 'D', 10)]:
        assert client.post('/api/roads', json={'start': start, 'end': end, 'distance': distance}).status_code == 201
    body = {'start': 'A', 'destination': 'D'}
    result = client.post('/api/routes', json=body)
    assert result.status_code == 200
    assert result.json == {'route': ['A', 'C', 'D'], 'distance_km': 25}
    # Road 4 is C-D.
    assert client.patch('/api/roads/4', json={'blocked': True}).status_code == 200
    result = client.post('/api/routes', json=body)
    assert result.json == {'route': ['A', 'B', 'D'], 'distance_km': 35}
    client.patch('/api/roads/1', json={'blocked': True})
    client.patch('/api/roads/2', json={'blocked': True})
    assert client.post('/api/routes', json=body).status_code == 404


def test_bad_requests(client):
    assert client.post('/api/locations', json={'name': ''}).status_code == 400
    assert client.post('/api/roads', json={'start': 'A', 'end': 'B', 'distance': -2}).status_code == 400
    assert client.patch('/api/roads/999', json={'blocked': True}).status_code == 404
    assert client.post('/api/routes', json={'start': 'Unknown', 'destination': 'A'}).status_code == 400
