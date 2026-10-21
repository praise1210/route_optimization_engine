const $ = (id) => document.getElementById(id);
let network = { locations: [], roads: [] };

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Cannot connect to the server. Check that Flask is running.');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

function jsonOptions(data) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function showMessage(message = '') { $('feedback').textContent = message; }

function setSelect(id, names) {
  const select = $(id);
  const previous = select.value;
  select.replaceChildren();
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  if (names.includes(previous)) select.value = previous;
}

async function refresh() {
  network = await api('/api/graph');
  $('locations-list').textContent = network.locations.length ? network.locations.join(' · ') : 'No locations yet.';
  for (const id of ['road-from', 'road-to', 'route-start', 'route-destination']) setSelect(id, network.locations);
  const container = $('roads-list');
  container.replaceChildren();
  if (!network.roads.length) container.textContent = 'No roads yet. Add one above.';
  for (const road of network.roads) {
    const row = document.createElement('div');
    row.className = 'road';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${road.from} ↔ ${road.to}`;
    const detail = document.createElement('div');
    detail.className = 'muted';
    detail.textContent = `${road.distance} km · ${road.blocked ? 'Blocked' : 'Open'}`;
    info.append(title, detail);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = road.blocked ? 'Unblock' : 'Block';
    if (road.blocked) button.className = 'unblock';
    button.addEventListener('click', async () => {
      try {
        await api(`/api/roads/${road.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocked: !road.blocked }) });
        showMessage();
        $('route-result').textContent = 'Road status changed. Calculate again to see the updated route.';
        await refresh();
      } catch (error) { showMessage(error.message); }
    });
    row.append(info, button);
    container.append(row);
  }
}

$('location-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/locations', jsonOptions({ name: $('location-name').value }));
    $('location-name').value = '';
    showMessage();
    await refresh();
  } catch (error) { showMessage(error.message); }
});

$('road-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/roads', jsonOptions({ start: $('road-from').value, end: $('road-to').value, distance: Number($('road-distance').value) }));
    $('road-distance').value = '';
    showMessage();
    await refresh();
  } catch (error) { showMessage(error.message); }
});

$('route-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = $('route-result');
  try {
    const result = await api('/api/routes', jsonOptions({ start: $('route-start').value, destination: $('route-destination').value }));
    showMessage();
    output.textContent = `Shortest route: ${result.route.join(' → ')} | Total distance: ${result.distance_km} km`;
  } catch (error) { output.textContent = error.message; }
});

refresh().catch((error) => showMessage(error.message));
