/**
 * Routefinder planner controller.
 * The existing Flask API remains the source of truth. This module renders forms,
 * route summaries and an SVG map without calculating a second shortest path here.
 */
import { createNetworkMap } from '/network-map.js';

/** Find a stable HTML ID shared by the forms and this controller. */
const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const kilometers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
let network = { locations: [], roads: [] };
let activeRoute = null;
let networkLoaded = false;
let networkLoading = false;
let mutationPending = false;
let routePending = false;
// Revisions prevent slow, older HTTP responses from restoring an outdated route.
let networkRevision = 0;
let graphRequestId = 0;
let routeRequestId = 0;

const map = createNetworkMap({ svg: $('network-map'), onNodeActivate: chooseMapDestination });

/** Create text nodes safely: location names must never be interpreted as HTML. */
function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Reuse a local symbol for an icon; all symbol names come from our own code. */
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

/** Format distances consistently while preserving the valid value zero. */
function formatKm(value) {
  return kilometers.format(value);
}

/** Use the correct singular/plural label in metrics and route details. */
function countLabel(value, word) {
  return `${value} ${word}${value === 1 ? '' : 's'}`;
}

/** Send JSON to Flask and turn network, HTTP and invalid-response failures into useful messages. */
async function api(path, { method = 'GET', data } = {}) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Cannot connect to the server. Check your connection and refresh the network.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}). Try refreshing the network.`);
  }
  if (!response.ok) {
    const error = new Error(body?.error || `The request failed (${response.status}). Please try again.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/** Announce form feedback without stealing focus from the user's current control. */
function showMessage(message = '', tone = 'info') {
  const feedback = $('feedback');
  feedback.textContent = message;
  feedback.dataset.tone = tone;
  feedback.hidden = !message;
}

/** Read the selected endpoints once so a route request uses a consistent pair. */
function selection() {
  return { start: $('route-start').value, destination: $('route-destination').value };
}

/** Remember the initiating control before it is disabled or its generated row is replaced. */
function captureFocus() {
  const control = document.activeElement;
  if (!control || control === document.body) return null;
  return { control, roadId: control.classList?.contains('road-toggle') ? control.dataset.roadId : null };
}

/** Restore lost focus after async work, without stealing focus if the user moved elsewhere. */
function restoreFocus(saved) {
  if (!saved) return;
  const current = document.activeElement;
  if (current && current !== document.body && current !== saved.control && current.isConnected) return;
  const target = saved.roadId
    ? [...document.querySelectorAll('.road-toggle')].find((button) => button.dataset.roadId === saved.roadId)
    : saved.control;
  if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
}

/** Refill a dropdown, keeping its selection if that location still exists. */
function setSelect(id, names, defaultIndex = 0) {
  const select = $(id);
  const previous = select.value;
  const options = names.map((name) => {
    const option = element('option', '', name);
    option.value = name;
    return option;
  });
  select.replaceChildren(...options);
  select.value = names.includes(previous) ? previous : (names[defaultIndex] || names[0] || '');
}

/** Disable incompatible actions during updates, while still allowing refresh after a failure. */
function syncControls() {
  const busy = mutationPending || networkLoading;
  const hasLocations = networkLoaded && network.locations.length > 0;
  $('route-start').disabled = busy || !hasLocations;
  $('route-destination').disabled = busy || !hasLocations;
  $('swap-locations').disabled = busy || !hasLocations || network.locations.length < 2;
  $('route-submit').disabled = busy || routePending || !hasLocations;
  $('route-submit').setAttribute('aria-busy', String(routePending));
  $('route-submit-label').textContent = routePending ? 'Finding your route...' : 'Find shortest route';
  for (const control of $('location-form').elements) control.disabled = busy || !networkLoaded;
  for (const control of $('road-form').elements) control.disabled = busy || !networkLoaded || network.locations.length < 2;
  for (const button of document.querySelectorAll('.road-toggle')) button.disabled = busy || !networkLoaded;
  $('refresh-network').disabled = busy;
  $('refresh-network').setAttribute('aria-busy', String(networkLoading));
  $('road-form-hint').textContent = network.locations.length < 2
    ? 'Add at least two locations before connecting a road.'
    : 'Roads connect both ways. Enter a positive distance.';
}

/** Synchronize the diagram with the current route and the user's selected endpoints. */
function renderMap() {
  map.render(network, { ...selection(), route: activeRoute?.route || [] });
}

/** Show loading, ready, empty or failed states without retaining an old distance. */
function renderRouteMessage(state, heading, message) {
  const panel = $('result-panel');
  panel.dataset.state = state;
  panel.setAttribute('aria-busy', String(state === 'loading'));
  const content = element('div', 'result-empty');
  content.append(element('p', 'result-eyebrow', 'ROUTE SUMMARY'), element('h2', '', heading), element('p', '', message));
  $('route-result').replaceChildren(content);
}

/** Clear stale highlights as soon as endpoints or the graph change, including during a pending request. */
function invalidateRoute(message = 'Choose your stops and find the shortest available route.') {
  routeRequestId += 1;
  activeRoute = null;
  routePending = false;
  renderRouteMessage('ready', 'Your next route, made clear.', message);
  renderMap();
  syncControls();
}

/** Build an accessible result with the exact API path, distance and road count. */
function renderRouteResult(result) {
  const panel = $('result-panel');
  panel.dataset.state = 'success';
  panel.setAttribute('aria-busy', 'false');
  const heading = element('div', 'result-heading');
  const title = element('div');
  title.append(element('p', 'result-eyebrow', 'SHORTEST AVAILABLE ROUTE'), element('h2', '', 'A clearer way to your destination.'));
  const total = element('div', 'route-distance');
  total.id = 'route-distance';
  total.setAttribute('aria-label', `Total distance: ${formatKm(result.distance_km)} kilometers`);
  total.append(element('strong', 'distance-number', formatKm(result.distance_km)), element('span', '', 'km'));
  heading.append(title, total);

  const path = element('ol', 'route-stops');
  path.id = 'route-path';
  path.setAttribute('aria-label', 'Locations in route order');
  result.route.forEach((name, index) => {
    const stop = element('li', `route-stop${index === 0 ? ' is-start' : ''}${index === result.route.length - 1 ? ' is-destination' : ''}`);
    stop.append(element('span', 'route-stop-marker'), element('span', 'route-stop-name', name));
    path.append(stop);
  });
  const details = element('div', 'route-details');
  details.append(element('span', 'detail-item', countLabel(result.route.length, 'location')), element('span', 'detail-item', countLabel(Math.max(0, result.route.length - 1), 'road')));
  if (result.route.length === 1) details.append(element('span', 'detail-item', 'You are already at your destination.'));
  $('route-result').replaceChildren(heading, path, details);
}

/** Render every stored road, keeping blocked ones visible and available to unblock. */
function renderRoads() {
  const list = $('roads-list');
  list.replaceChildren();
  $('road-count-badge').textContent = countLabel(network.roads.length, 'road');
  if (!network.roads.length) {
    list.append(element('p', 'empty-state', 'No roads yet. Connect two locations to build your first route.'));
    return;
  }
  for (const road of network.roads) {
    const row = element('div', `road${road.blocked ? ' is-blocked' : ''}`);
    row.dataset.roadId = String(road.id);
    const info = element('div', 'road-info');
    const connection = element('div', 'road-connection');
    const arrow = element('span', 'road-arrow', '\u2194');
    arrow.setAttribute('aria-label', 'to');
    connection.append(element('strong', '', road.from), arrow, element('strong', '', road.to));
    const meta = element('div', 'road-meta');
    meta.append(element('span', 'road-distance', `${formatKm(road.distance)} km`), element('span', `road-status${road.blocked ? ' is-blocked' : ''}`, road.blocked ? 'Blocked' : 'Open'));
    info.append(connection, meta);
    const button = element('button', `road-toggle${road.blocked ? ' unblock is-blocked' : ''}`, road.blocked ? 'Unblock road' : 'Block road');
    button.type = 'button';
    button.dataset.roadId = String(road.id);
    button.setAttribute('aria-label', `${road.blocked ? 'Unblock' : 'Block'} road between ${road.from} and ${road.to}`);
    button.addEventListener('click', () => toggleRoad(road));
    const actions = element('div', 'road-actions');
    actions.append(button);
    row.append(info, actions);
    list.append(row);
  }
}

/** Refresh counts, dropdowns and tags from one accepted network snapshot. */
function renderNetwork() {
  setSelect('route-start', network.locations);
  setSelect('route-destination', network.locations, network.locations.length - 1);
  setSelect('road-from', network.locations);
  setSelect('road-to', network.locations, 1);
  const tags = network.locations.map((name) => {
    const tag = element('span', 'location-tag', name);
    tag.setAttribute('role', 'listitem');
    return tag;
  });
  $('locations-list').replaceChildren(...tags);
  if (!tags.length) $('locations-list').append(element('p', 'form-hint', 'Add a place to get started.'));
  $('location-count').textContent = network.locations.length;
  $('road-count').textContent = network.roads.length;
  $('open-road-count').textContent = network.roads.filter((road) => !road.blocked).length;
  $('network-status').dataset.state = 'ready';
  $('network-status-text').textContent = network.locations.length ? 'Your network is ready' : 'Ready for your first location';
  renderRoads();
  renderMap();
  syncControls();
}

/** Load the latest graph; older GET responses must not overwrite newer snapshots. */
async function refreshNetwork(message = 'Network refreshed. Find a route to explore your connections.') {
  const requestId = ++graphRequestId;
  networkLoading = true;
  invalidateRoute(message);
  $('network-status').dataset.state = 'loading';
  $('network-status-text').textContent = 'Refreshing your network';
  syncControls();
  try {
    const latest = await api('/api/graph');
    if (requestId !== graphRequestId) return false;
    if (!Array.isArray(latest?.locations) || !Array.isArray(latest?.roads)) throw new Error('The network response is incomplete. Please refresh and try again.');
    network = latest;
    networkLoaded = true;
    networkRevision += 1;
    renderNetwork();
    if (!network.locations.length) renderRouteMessage('ready', 'Every route starts with a place.', 'Add your first location to begin building your network.');
    return true;
  } catch (error) {
    if (requestId !== graphRequestId) return false;
    networkLoaded = false;
    $('network-status').dataset.state = 'error';
    $('network-status-text').textContent = 'Network unavailable';
    renderRouteMessage('error', 'Let\'s reconnect your network.', 'Use Refresh network above the map to load your locations again.');
    showMessage(error.message, 'error');
    return false;
  } finally {
    if (requestId === graphRequestId) {
      networkLoading = false;
      syncControls();
    }
  }
}

/** Calculate on the server, then accept the result only if both selections and graph are still current. */
async function calculateRoute() {
  if (!networkLoaded || networkLoading || mutationPending || routePending || !network.locations.length) return;
  const endpoints = selection();
  if (!endpoints.start || !endpoints.destination) return;
  const savedFocus = captureFocus();
  const requestId = ++routeRequestId;
  const revision = networkRevision;
  routePending = true;
  activeRoute = null;
  showMessage();
  renderMap();
  renderRouteMessage('loading', 'Finding your shortest route...', 'Checking the available connections in your network.');
  syncControls();
  try {
    const result = await api('/api/routes', { method: 'POST', data: endpoints });
    if (requestId !== routeRequestId || revision !== networkRevision) return;
    if (!Array.isArray(result?.route) || !result.route.length || !Number.isFinite(result.distance_km) || result.distance_km < 0) throw new Error('The server returned an incomplete route. Please try again.');
    activeRoute = result;
    renderRouteResult(result);
    renderMap();
  } catch (error) {
    if (requestId !== routeRequestId || revision !== networkRevision) return;
    activeRoute = null;
    renderMap();
    renderRouteMessage('error', error.status === 404 ? 'No available route just yet.' : 'We couldn\'t calculate that route.', `${error.message}${error.status === 404 ? '. Connect a road or unblock a connection, then try again.' : ''}`);
  } finally {
    if (requestId === routeRequestId) {
      routePending = false;
      syncControls();
      restoreFocus(savedFocus);
    }
  }
}

/** Serialize graph writes so duplicate clicks cannot submit conflicting changes. */
async function mutateNetwork(path, data, method, successMessage, onSuccess) {
  if (mutationPending || networkLoading || !networkLoaded) return;
  const savedFocus = captureFocus();
  mutationPending = true;
  showMessage();
  invalidateRoute('Your network is changing. Calculate again after the update.');
  syncControls();
  try {
    await api(path, { method, data });
    onSuccess?.();
    const loaded = await refreshNetwork('Network updated. Calculate again to see the shortest available route.');
    showMessage(loaded ? successMessage : 'Your change was saved, but the latest network could not be loaded. Use Refresh network to reconnect.', loaded ? 'success' : 'error');
  } catch (error) {
    // A lost response does not prove a write failed: reload before allowing more work.
    // Validation errors (4xx) do not change the graph and can be corrected in place.
    if (!error.status || error.status >= 500) {
      const recovered = await refreshNetwork('The network was reloaded after an interrupted update. Review your connections before trying again.');
      showMessage(`${error.message} ${recovered ? 'The network was reloaded; check whether your change was saved before retrying.' : 'Refresh the network before trying again.'}`, 'error');
    } else {
      showMessage(error.message, 'error');
    }
  } finally {
    mutationPending = false;
    syncControls();
    restoreFocus(savedFocus);
  }
}

/** Toggle only the selected road; its row and the diagram update from a fresh graph. */
function toggleRoad(road) {
  return mutateNetwork(`/api/roads/${road.id}`, { blocked: !road.blocked }, 'PATCH', `${road.from} to ${road.to} is now ${road.blocked ? 'open' : 'blocked'}.`);
}

/** Select a destination from a map node without unexpectedly submitting the form. */
function chooseMapDestination(name) {
  if (!networkLoaded || networkLoading || mutationPending || !network.locations.includes(name)) return;
  if ($('route-destination').value !== name) {
    $('route-destination').value = name;
    invalidateRoute('Destination updated. Find your shortest route when you are ready.');
  }
  showMessage(`Destination set to ${name}.`, 'info');
}

/** Clear the old route immediately when either dropdown changes. */
function handleEndpointChange() {
  showMessage();
  invalidateRoute('Stops updated. Find the shortest route for your new journey.');
}

/** Swap the chosen stops; bidirectional roads still use the same backend algorithm. */
function handleSwapLocations() {
  const { start, destination } = selection();
  $('route-start').value = destination;
  $('route-destination').value = start;
  handleEndpointChange();
}

/** Validate and submit a location, clearing the input only after Flask accepts it. */
function handleLocationSubmit(event) {
  event.preventDefault();
  if (!$('location-form').reportValidity()) return;
  return mutateNetwork('/api/locations', { name: $('location-name').value }, 'POST', 'Location added. Connect it with a road to include it in your routes.', () => { $('location-name').value = ''; });
}

/** Convert the numeric input to a JSON number before sending the road to Flask. */
function handleRoadSubmit(event) {
  event.preventDefault();
  if (!$('road-form').reportValidity()) return;
  return mutateNetwork('/api/roads', { start: $('road-from').value, end: $('road-to').value, distance: Number($('road-distance').value) }, 'POST', 'Road added. Your map now includes the new connection.', () => { $('road-distance').value = ''; });
}

/** Keep native form validation and submit a route without reloading the page. */
function handleRouteSubmit(event) {
  event.preventDefault();
  if ($('route-form').reportValidity()) return calculateRoute();
}

/** Allow recovery after a server outage without requiring a full page reload. */
async function handleRefresh() {
  const savedFocus = captureFocus();
  showMessage();
  const loaded = await refreshNetwork();
  if (loaded) showMessage('Network refreshed. Your connections are up to date.', 'success');
  restoreFocus(savedFocus);
}

/** Load the graph, then show a real initial route between the first and last locations. */
async function initialize() {
  syncControls();
  const loaded = await refreshNetwork('Choose your starting point and destination.');
  if (loaded && network.locations.length >= 2) await calculateRoute();
}

// Bind each UI action once; graph updates replace only the generated rows and SVG content.
$('route-form').addEventListener('submit', handleRouteSubmit);
$('location-form').addEventListener('submit', handleLocationSubmit);
$('road-form').addEventListener('submit', handleRoadSubmit);
$('route-start').addEventListener('change', handleEndpointChange);
$('route-destination').addEventListener('change', handleEndpointChange);
$('swap-locations').addEventListener('click', handleSwapLocations);
$('refresh-network').addEventListener('click', handleRefresh);
$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('fit-map').addEventListener('click', () => map.fit());
initialize();
