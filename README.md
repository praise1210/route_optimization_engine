# Route Optimization Engine

A simple web application in which users add locations and bidirectional road distances, calculate the shortest route using Dijkstra's algorithm, and block/unblock roads to recalculate another available route.

## Project structure and roles

| File | Owner | Responsibility |
| --- | --- | --- |
| `data.json`, `graph.py` | Person 1 | Graph model, locations, distances, blocked roads |
| `routes.py` | Person 2 | Dijkstra shortest path |
| `app.py`, `requirements.txt` | Person 3 | Flask API, integration and validation |
| `frontend/` | Person 4 | HTML, CSS and JavaScript interface |
| `tests/`, `README.md` | Person 5 | Testing, documentation, deployment |

## Requirements

- Python 3.10+
- pip

## Set up locally

```bash
python -m venv .venv
```

Activate on Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Or on macOS/Linux:

```bash
source .venv/bin/activate
```

Install packages:

```bash
python -m pip install -r requirements.txt
```

Run the web app:

```bash
python app.py
```

Open http://127.0.0.1:5000/ in a browser.

## API reference

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/api/health` | `{"status":"ok"}` |
| GET | `/api/graph` | Returns locations and roads |
| POST | `/api/locations` | `{"name":"Owerri"}` |
| POST | `/api/roads` | `{"start":"Owerri","end":"Aba","distance":32}` |
| PATCH | `/api/roads/1` | `{"blocked":true}` or `{"blocked":false}` |
| POST | `/api/routes` | `{"start":"Port Harcourt","destination":"Aba"}` |

Successful route response:

```json
{"route":["Port Harcourt","Oyigbo","Aba"],"distance_km":25}
```

Invalid inputs return HTTP 400 with an `error` message, missing roads return HTTP 404, and unreachable journeys return HTTP 404 with `No available route`.

## Tests

```bash
python -m pytest -v
```

The tests cover adding locations and roads, duplicates, negative distances, shortest paths, blocked roads, unreachable destinations, and API errors.

## How the engine works

- Locations are vertices (nodes) in a graph.
- Roads are undirected edges with positive weights representing kilometres.
- `graph.py` converts stored roads to an adjacency dictionary and excludes blocked roads.
- `routes.py` runs Dijkstra using a minimum-priority queue (`heapq`) to find the minimum-distance path.
- `app.py` validates HTTP requests, updates network state, and calls the algorithm.
- `frontend/script.js` sends HTTP requests and renders the responses.

For a graph with `V` nodes and `E` roads, the algorithm takes approximately `O((V+E) log V)` time using a binary heap.

## Important limitations / tradeoffs

- Sample road distances are fictional/illustrative, not live GPS distances.
- Users enter **road distances between locations**, not a geometric perimeter.
- User-added locations, new roads, and blocked states are **in memory only**. They reset whenever the Flask server restarts, and they are shared by users connected to the same server process. For persistence or multi-instance hosting, add SQLite/PostgreSQL and concurrency handling.
- This demo calculates the shortest available route **after a road is blocked**. It does not compute a ranked second-shortest route before any road is blocked.
- There are no accounts or permissions; it is a supervised/demo MVP, not suitable for use as a public editable transport database.

## Deployment example

A Python web host such as Render can run the application with:

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- Required environment variables: none for this MVP

Use one server worker if demonstrating in-memory edits; restart/deploy resets changes. Make sure to test the actual public URL after deploying. Free-plan availability varies by provider.

## Demo script (2–3 minutes)

1. Show the four sample locations and roads.
2. Calculate Port Harcourt → Aba. Show Port Harcourt → Oyigbo → Aba (25 km).
3. Block the Oyigbo–Aba road. Recalculate; show Port Harcourt → Eleme → Aba (35 km).
4. Add a new location and connect it to existing locations using custom road distances; calculate a new route.
5. Disconnect a destination and show `No available route`.
6. Explain how the frontend, Flask API, graph model, and Dijkstra algorithm connect.

## Security/validation

The API validates non-empty location names, unique names (case-insensitively), positive finite distances, existing locations, duplicate undirected roads, boolean blocked statuses, and missing/unreachable routes. User-provided text is displayed as text rather than HTML.

 deplyment link: https://routefinder-lah9.onrender.com/
