from routes import shortest_path


def test_shortest_path_and_same_location():
    graph = {'A': {'B': 10, 'C': 15}, 'B': {'A': 10, 'D': 25}, 'C': {'A': 15, 'D': 10}, 'D': {'B': 25, 'C': 10}}
    assert shortest_path(graph, 'A', 'D') == {'route': ['A', 'C', 'D'], 'distance_km': 25}
    assert shortest_path(graph, 'A', 'A') == {'route': ['A'], 'distance_km': 0}


def test_unreachable():
    assert shortest_path({'A': {}, 'B': {}}, 'A', 'B') is None
