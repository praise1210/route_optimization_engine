"""Dijkstra shortest-path calculation for non-negative weighted graphs."""
import heapq
import math


def shortest_path(graph, start, destination):
    if start not in graph or destination not in graph:
        raise ValueError('Starting point or destination does not exist')
    distances = {node: math.inf for node in graph}
    previous = {}
    distances[start] = 0
    queue = [(0, start)]

    while queue:
        current_distance, node = heapq.heappop(queue)
        if current_distance > distances[node]:
            continue
        if node == destination:
            break
        for neighbor, weight in graph[node].items():
            new_distance = current_distance + weight
            if new_distance < distances[neighbor]:
                distances[neighbor] = new_distance
                previous[neighbor] = node
                heapq.heappush(queue, (new_distance, neighbor))

    if math.isinf(distances[destination]):
        return None
    path = []
    current = destination
    while current != start:
        path.append(current)
        current = previous[current]
    path.append(start)
    path.reverse()
    return {'route': path, 'distance_km': round(distances[destination], 3)}
