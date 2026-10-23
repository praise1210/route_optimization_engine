> **Planner update - 23 October 2026:** The planner frontend now has a redesigned dashboard and an interactive network graph. See [PLANNER_UPGRADE.md](PLANNER_UPGRADE.md) for the current file changes, comments, tests, and setup. The guide below documents the earlier landing-page addition.
# Routefinder landing page handoff

The landing page adds a branded front page that opens the existing route planner. **No existing project files were edited.** The original planner, styles, JavaScript, route algorithm, data, dependencies, and API endpoints remain unchanged.

## Added files

| File | Purpose |
| --- | --- |
| `run_routefinder.py` | Adds the landing page at `/` and serves the original planner at `/planner` and `/planner/`. Exposes `create_routefinder_app()` and `app`. |
| `frontend/landing/index.html` | Landing page content, route illustration, and links to the planner. |
| `frontend/landing/landing.css` | Landing page layout, colors, responsive styling, and logo framing. |
| `frontend/landing/routefinder-logo.png` | The supplied logo, copied unchanged. CSS hides the surrounding white padding. |
| `ROUTEFINDER_HANDOFF.md` | This setup and handoff guide. |

The landing page uses local assets and has no external fonts, CDNs, or third-party asset requests.

## Run on Ubuntu

From the project folder containing `app.py` and `run_routefinder.py`, with the existing dependencies installed:

```bash
python3 run_routefinder.py
```

If using a virtual environment:

```bash
./.venv/bin/python run_routefinder.py
```

## Run on Windows

From the same project folder, using the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe run_routefinder.py
```

Open `http://127.0.0.1:5000/` for the landing page. Select the main route-finding button to open the existing planner at `http://127.0.0.1:5000/planner`.

Keep the terminal open while using the app. Press **Ctrl+C** to stop it. The dependency list has not changed; use the existing `requirements.txt` if installing on a new machine.

## Keep using the original entry point

The original startup command still opens the original planner directly at `/`:

```bash
python3 app.py
```

Run one entry point at a time when using the default port 5000.

For an optional Gunicorn deployment on Ubuntu, use a single worker so the existing in-memory network state is shared by all requests:

```bash
gunicorn --workers 1 --bind 0.0.0.0:5000 run_routefinder:app
```

## Share with team members

Copy the five added files listed above into an existing copy of this project, preserving their relative paths. Alternatively, extract `output/routefinder-landing-page.zip` into the project folder containing `app.py`. The ZIP contains those same five additions.

There are no edits for teammates to merge into `app.py`, the current planner frontend, the algorithm, or `requirements.txt`. Start the new launcher to use the landing page; start `app.py` to use the original entry point.

## Verification commands

Run the existing test suite from the project folder:

```bash
python3 -m pytest
```

On Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

With `run_routefinder.py` running, check `/`, `/planner`, `/planner/`, and `/api/health` in the browser. Confirm the landing page button opens the planner and that the planner can calculate routes, add locations and roads, and block/unblock roads.

The existing sample distances and in-memory behavior are unchanged: distances are demo values, and changes reset when the server restarts. The landing-page illustration is an example, not a live map.
## Checks completed for this addition

- All 13 original project files match their SHA-256 hashes from before this work.
- The copied PNG matches the supplied logo byte for byte.
- All six existing pytest tests pass.
- The landing page and planner endpoints respond successfully; the planner HTML matches the original page exactly.
- Backend checks confirm the sample 25 km route, the 35 km alternative after blocking road 4, and the unreachable-route response.
- Browser checks passed at 320, 390, 768, 1024, and 1440 pixels with no horizontal overflow and no JavaScript exceptions.
- Clicking the landing page button opened the original planner, which calculated Port Harcourt -> Oyigbo -> Aba (25 km).

