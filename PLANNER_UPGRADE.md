# Routefinder planner and map upgrade

Updated 23 October 2026. This upgrade restyles the existing route planner to match the landing page and draws the real network in SVG. All implementation files contain explanatory comments.

## Exact file changes

| File | Change |
| --- | --- |
| `frontend/index.html` | Replaced the stacked demo layout with a branded planner dashboard: route controls, network editor, interactive SVG area, route summary, and road management. Uses native JavaScript modules. Existing form field IDs and API payloads remain compatible. |
| `frontend/style.css` | Replaced the planner styles with the landing-page color palette, responsive columns, clear form states, graph styling, readable mobile controls, and visible keyboard focus. |
| `frontend/script.js` | Reworked the frontend controller: updates counts/forms/roads/map, requests routes from Flask, builds route summaries safely, clears stale highlights, ignores outdated HTTP responses, recovers after interrupted writes, and restores keyboard focus. |
| `frontend/network-map.js` | New commented SVG renderer: lays out locations, draws weighted roads, highlights the actual route, marks blocked roads, wraps names, keeps labels readable, and handles selection, dragging, pan, zoom, and fit. |
| `PLANNER_UPGRADE.md` | This file, with usage, architecture, validation, and sharing instructions. |
| `ROUTEFINDER_HANDOFF.md` | Added a dated note pointing to this upgrade. Its remaining content documents the earlier landing-page addition. |

The Flask endpoints, `app.py`, `graph.py`, `routes.py`, `data.json`, `requirements.txt`, `run_routefinder.py`, and landing-page source/assets were not changed by this upgrade.

## How to run on Windows

From the folder containing `app.py`, using your existing virtual environment:

```powershell
.\.venv\Scripts\python.exe run_routefinder.py
```

Open `http://127.0.0.1:5000/` for the landing page, then use its button to open `/planner`. The original `app.py` entry point also works and opens the redesigned planner directly at `/`.

Stop an older server with Ctrl+C before starting a different entry point on the same port. After replacing frontend files, hard refresh the browser with Ctrl+Shift+R. Serve the files through Flask; opening index.html directly from the filesystem cannot call the API or import the module correctly.

On Render, the existing welcome-first entry point is `run_routefinder:app`. Its start command can remain:

```text
gunicorn --workers 1 --bind 0.0.0.0:$PORT run_routefinder:app
```

Commit/push the changed and added files to the branch connected to Render, then deploy that version. This local upgrade does not publish changes to the hosted service automatically.

## How the map works

1. `script.js` fetches `/api/graph` and passes the returned locations and roads to `createNetworkMap()`.
2. `network-map.js` assigns stable drawing positions. It preserves existing and dragged positions when new locations are added. The supplied four-location example uses a familiar layout; other locations are spaced using a deterministic spiral.
3. Every road becomes an SVG line with its entered distance. Blocked roads remain visible as red dashed lines.
4. The controller asks Flask's existing `/api/routes` endpoint for the shortest path. The renderer highlights only consecutive road pairs from that returned path, treating roads as bidirectional.
5. Changing endpoints, adding a road/location, refreshing, or blocking a road immediately clears an older route. This prevents stale distances and highlights from being presented as current.

This is a schematic network, not a geographic map. The data has no latitude/longitude, and positions do not indicate actual road direction or scale. Distances are the numbers entered for each road; moving a node changes only its on-screen position.

## Map controls

- Click or tap a location to make it the destination, then calculate the route.
- Focus a location with the keyboard and press Enter or Space to select it.
- Drag a location to rearrange the diagram; dragging does not also select it.
- Drag the background to pan, or use the zoom and fit buttons.
- When the SVG itself has keyboard focus, use arrow keys to pan, + / - to zoom, and Home or 0 to fit.
- A blue A marks the start; a green B marks the destination. A same-location trip is valid and shows 0 km.

The initial view calculates between the first and last stored locations when at least two exist. Subsequent user changes require an explicit calculation so an old result is never mistaken for an updated one.

## Where to read the explanatory comments

`index.html` explains the page regions, module loading, and accessible live regions. `style.css` groups rules by purpose and explains responsive layout and readability choices.

Each controller and map function has a comment explaining its responsibility. Pay particular attention to request revisions in `script.js`, `mutateNetwork()` recovery, safe `textContent` rendering, and the map's undirected edge matching, wrapped labels, camera scaling, and pointer-gesture handling.

## Verification

- Six existing pytest tests passed.
- Nineteen browser checks passed, covering: the 25 km sample route, 35 km blocked-road alternative, highlighting only the correct road pairs, reverse routes, swapping endpoints, graph selection/dragging/zoom, new locations and roads, a valid 0 km trip, unreachable destinations, safe HTML-like and 80-character names, stale-response protection, interrupted-write recovery, empty and single-location networks, and unreadable-response recovery.
- Layout checks passed at 320, 390, 768, 1024, and 1440 pixels with no horizontal overflow. Graph labels stay readable on small screens.
- The browser reported no uncaught JavaScript exceptions.
- Backend and landing-page file hashes were checked against the pre-upgrade copies.

Run the Python suite with:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Test details are saved in `output/planner-upgrade-validation.json` in the workspace. Desktop/mobile screenshots and an alternative-route screenshot are also in `output/`.

## Team handoff

`output/routefinder-planner-upgrade.zip` contains the three replacement planner files, the new renderer, this guide, the updated landing handoff guide, and the existing landing assets/launcher needed for a complete frontend. Extract it into the project folder containing `app.py`, preserving paths. No backend files or sample data are included for replacement.

For an exact review, see `output/planner-upgrade.diff`. The three pre-upgrade planner files were saved under `output/planner-upgrade-originals/frontend/` in this workspace.

The sample distances and in-memory behavior are unchanged. Network edits reset on server restart or deployment; custom node positions reset when the page is reloaded.
