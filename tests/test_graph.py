import pytest
from graph import add_location, add_road, build_graph, update_road


def test_add_location_and_road():
    network = {'locations': [], 'roads': []}
    add_location(network, 'A')
    add_location(network, 'B')
    road = add_road(network, 'A', 'B', 3.5)
    assert build_graph(network)['A']['B'] == 3.5
    update_road(network, road['id'], True)
    assert build_graph(network)['A'] == {}


def test_reject_duplicates_and_negative_distance():
    network = {'locations': ['A', 'B'], 'roads': []}
    with pytest.raises(ValueError):
        add_location(network, 'a')
    with pytest.raises(ValueError):
        add_road(network, 'A', 'B', -1)
    add_road(network, 'A', 'B', 3)
    with pytest.raises(ValueError):
        add_road(network, 'B', 'A', 7)
