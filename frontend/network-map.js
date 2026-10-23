/**
 * Render the application's own weighted road graph with native SVG.
 * Coordinates are diagram positions, not latitude/longitude or a live map.
 * No names or API values are inserted as HTML: all user text uses textContent.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SAMPLE_POSITIONS = new Map([
  ['Port Harcourt', { x: -245, y: 145 }],
  ['Eleme', { x: -225, y: -150 }],
  ['Oyigbo', { x: 15, y: 100 }],
  ['Aba', { x: 245, y: -130 }],
]);
let mapInstanceCount = 0;

/** Create one accessible SVG graph and expose rendering and camera controls. */
export function createNetworkMap({ svg, onNodeActivate = () => {} }) {
  if (!svg || svg.namespaceURI !== SVG_NS) {
    throw new TypeError('createNetworkMap requires an SVG element.');
  }

  const document = svg.ownerDocument;
  const instanceId = `routefinder-map-${++mapInstanceCount}`;
  const positions = new Map();
  const nodeElements = new Map();
  const roadElements = [];
  let currentNetwork = { locations: [], roads: [] };
  let selected = { route: [], start: '', destination: '' };
  let allocationIndex = 0;
  let nodeId = 0;
  let camera = { x: -450, y: -260, width: 900, height: 520 };
  let fittedWidth = 900;
  let nodeScale = 1;
  let weightScale = 1;
  let cameraWasFit = true;
  let rendered = false;
  let previousLocations = '';
  let pointer = null;
  let ignoreClickBefore = 0;
  let destroyed = false;

  // Preserve existing accessible names; the module adds its own descriptions.
  const originalAttributes = new Map(['role', 'tabindex', 'aria-labelledby', 'viewBox'].map((name) => [name, svg.getAttribute(name)]));
  const originalTouchAction = svg.style.touchAction;
  const originalUserSelect = svg.style.userSelect;
  const createdDescriptions = [];
  const title = ensureDescription('title', `${instanceId}-title`);
  const description = ensureDescription('desc', `${instanceId}-description`);
  const labelIds = new Set((svg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean));
  labelIds.add(title.id);
  labelIds.add(description.id);
  svg.setAttribute('aria-labelledby', [...labelIds].join(' '));
  svg.setAttribute('role', 'group');
  svg.setAttribute('tabindex', '0');
  svg.style.touchAction = 'none';
  svg.style.userSelect = 'none';

  const roadLayer = element('g', { class: 'map-roads' });
  const nodeLayer = element('g', { class: 'map-nodes' });
  const emptyLayer = element('g', { class: 'map-empty', 'pointer-events': 'none' });
  svg.append(roadLayer, nodeLayer, emptyLayer);

  /** Create SVG elements with explicit attributes, never HTML interpolation. */
  function element(tag, attributes = {}, text = null) {
    const result = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, String(value));
    if (text !== null) result.textContent = String(text);
    return result;
  }

  /** Reuse a supplied SVG title/description or create one with a unique ID. */
  function ensureDescription(tag, fallbackId) {
    let result = [...svg.children].find((child) => child.localName === tag);
    if (!result) {
      result = element(tag);
      svg.prepend(result);
      createdDescriptions.push(result);
    }
    if (!result.id) result.id = fallbackId;
    return result;
  }

  /** Produce a deterministic small hash to gently vary generic layout angles. */
  function hashName(name) {
    let hash = 2166136261;
    for (const character of name) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /** Allocate a new position while retaining every existing or dragged location. */
  function positionFor(name) {
    if (positions.has(name)) return positions.get(name);
    const sample = SAMPLE_POSITIONS.get(name);
    if (sample) {
      positions.set(name, { ...sample });
      return positions.get(name);
    }
    let candidate;
    let crowded;
    do {
      // A golden-angle spiral spreads arbitrary networks without randomness.
      // Reserve sample slots even before their nodes are added to avoid collisions.
      const slot = ++allocationIndex;
      const angle = slot * GOLDEN_ANGLE + (hashName(name) % 31) / 100;
      const radius = 165 * Math.sqrt(slot);
      candidate = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      const occupied = [...positions.values(), ...SAMPLE_POSITIONS.values()];
      crowded = occupied.some((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < 165);
    } while (crowded);
    positions.set(name, candidate);
    return candidate;
  }

  /** Wrap full location names, including long unbroken names, into short lines. */
  function wrapLabel(name, maximum = 19) {
    const lines = [];
    let line = '';
    for (const word of name.split(/\s+/u).filter(Boolean)) {
      const characters = Array.from(word);
      if (characters.length > maximum) {
        if (line) lines.push(line);
        line = '';
        while (characters.length > maximum) lines.push(characters.splice(0, maximum).join(''));
        line = characters.join('');
      } else if (line && Array.from(`${line} ${word}`).length > maximum) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['Unnamed location'];
  }

  /** Use an unambiguous undirected edge key even when names contain punctuation. */
  function edgeKey(from, to) {
    return JSON.stringify(from < to ? [from, to] : [to, from]);
  }

  /** Keep large and tiny positive weights readable without showing tiny values as zero. */
  function formatDistance(distance) {
    if (!Number.isFinite(distance)) return String(distance);
    if (distance >= 1e6 || (distance > 0 && distance < 0.001)) return `${distance.toExponential(2)} km`;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(distance)} km`;
  }

  /** Rebuild diagram layers from the latest network and route without changing data. */
  function render(network, { route = [], start = '', destination = '' } = {}) {
    if (destroyed) return;
    const locations = [...new Set((network?.locations || []).filter((name) => typeof name === 'string'))];
    const locationSet = new Set(locations);
    const roads = (network?.roads || []).filter((road) => road && locationSet.has(road.from) && locationSet.has(road.to));
    currentNetwork = { locations, roads };
    selected = { route: Array.isArray(route) ? route : [], start, destination };
    // Sorting only new names makes fresh layouts deterministic without moving old nodes.
    locations.filter((name) => !positions.has(name)).sort().forEach(positionFor);
    const activeNode = document.activeElement;
    const focusedName = svg.contains(activeNode) ? activeNode?.getAttribute('data-map-node') : null;
    const routeEdges = new Set();
    for (let index = 1; index < selected.route.length; index++) {
      routeEdges.add(edgeKey(selected.route[index - 1], selected.route[index]));
    }
    const routeNodes = new Set(selected.route);
    roadLayer.replaceChildren();
    nodeLayer.replaceChildren();
    emptyLayer.replaceChildren();
    nodeElements.clear();
    roadElements.length = 0;

    // Draw route edges last so their highlighted strokes remain visible at crossings.
    const orderedRoads = [...roads].sort((left, right) => Number(routeEdges.has(edgeKey(left.from, left.to))) - Number(routeEdges.has(edgeKey(right.from, right.to))));
    for (const road of orderedRoads) drawRoad(road, routeEdges);
    for (const name of locations) drawNode(name, routeNodes);
    title.textContent = 'Your road network';
    description.textContent = locations.length
      ? `${locations.length} locations and ${roads.length} roads. Blue lines show the calculated route; red dashed lines are blocked roads. Activate a location to choose a destination. Drag locations to rearrange the diagram. Drag the background to pan; use the zoom and fit controls to change the view. This is a network diagram, not a geographic map.`
      : 'Your network is empty. Add a location to begin building your road network.';
    if (!locations.length) drawEmptyState();

    const locationSignature = JSON.stringify([...locations].sort());
    if (!rendered || previousLocations !== locationSignature) fit();
    else updateScaleStyles();
    previousLocations = locationSignature;
    rendered = true;
    if (focusedName !== null && nodeElements.has(focusedName)) nodeElements.get(focusedName).group.focus({ preventScroll: true });
  }

  /** Draw a road and its weight, with blocked state taking precedence over a route. */
  function drawRoad(road, routeEdges) {
    const blocked = Boolean(road.blocked);
    const isRoute = !blocked && routeEdges.has(edgeKey(road.from, road.to));
    const color = blocked ? '#df6666' : isRoute ? '#087ff5' : '#b8cad9';
    const group = element('g', {
      class: `map-road${blocked ? ' is-blocked' : ''}${isRoute ? ' is-route' : ''}`,
      'data-road-id': road.id,
    });
    group.append(element('title', {}, `${road.from} to ${road.to}: ${formatDistance(road.distance)}${blocked ? ', blocked' : isRoute ? ', shortest route' : ''}`));
    const line = element('line', {
      class: 'map-road-line', stroke: color, 'stroke-width': isRoute ? 5 : 3,
      'stroke-linecap': 'round', 'stroke-dasharray': blocked ? '8 7' : 'none',
      'vector-effect': 'non-scaling-stroke',
    });
    const weight = formatDistance(road.distance);
    const weightGroup = element('g', { class: 'map-road-weight', 'pointer-events': 'none' });
    const labelWidth = Math.max(54, Array.from(weight).length * 7 + 18);
    const weightRect = element('rect', { x: -labelWidth / 2, y: -12, width: labelWidth, height: 24, rx: 12, fill: '#fff', stroke: isRoute ? '#d5e9ff' : '#e2eaf0' });
    const weightText = element('text', { 'text-anchor': 'middle', y: 4, fill: blocked ? '#b54f4f' : isRoute ? '#076bcf' : '#637d91', 'font-size': 10, 'font-family': 'inherit', 'font-weight': 650 }, weight);
    weightGroup.append(weightRect, weightText);
    group.append(line, weightGroup);
    roadLayer.append(group);
    const entry = { road, line, weightGroup, weightRect, weightText, labelWidth };
    roadElements.push(entry);
    updateRoadGeometry(entry);
  }

  /** Place a road and offset its distance pill perpendicular to its midpoint. */
  function updateRoadGeometry({ road, line, weightGroup }) {
    const from = positions.get(road.from);
    const to = positions.get(road.to);
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const offset = 15 * weightScale;
    const x = (from.x + to.x) / 2 - ((to.y - from.y) / length) * offset;
    const y = (from.y + to.y) / 2 + ((to.x - from.x) / length) * offset;
    weightGroup.setAttribute('transform', `translate(${x} ${y})`);
  }

  /** Draw a keyboard-accessible location, including a distinct same-place route marker. */
  function drawNode(name, routeNodes) {
    const isStart = name === selected.start;
    const isDestination = name === selected.destination;
    const isRoute = routeNodes.has(name);
    const samePlace = isStart && isDestination;
    const classes = ['map-node', isStart && 'is-start', isDestination && 'is-destination', isRoute && 'is-route'].filter(Boolean).join(' ');
    const status = samePlace ? 'start and destination' : isStart ? 'starting location' : isDestination ? 'destination' : isRoute ? 'on the shortest route' : 'location';
    const group = element('g', {
      id: `${instanceId}-node-${++nodeId}`, class: classes, tabindex: 0, role: 'button',
      'data-map-node': name, 'data-node-id': name,
      'aria-label': `${name}, ${status}. Choose as destination.`,
      'aria-pressed': isDestination ? 'true' : 'false',
      cursor: 'grab',
    });
    group.append(element('title', {}, `${name} - ${status}. Click or press Enter to choose as destination; drag to rearrange.`));
    const active = isStart || isDestination || isRoute;
    const color = isDestination ? '#0bb18b' : active ? '#087ff5' : '#8098ac';
    const halo = active ? element('circle', { class: 'map-node-halo', r: 24, fill: color, opacity: 0.12, 'pointer-events': 'none' }) : null;
    if (halo) group.append(halo);
    const marker = element('circle', {
      class: 'map-node-marker', r: isStart || isDestination ? 15 : 10,
      fill: active ? color : '#fff', stroke: samePlace ? '#087ff5' : active ? '#fff' : '#93aabe',
      'stroke-width': samePlace ? 4 : 3, 'vector-effect': 'non-scaling-stroke',
    });
    group.append(marker);
    const symbol = isStart || isDestination ? element('text', {
      class: 'map-node-symbol', 'text-anchor': 'middle', y: 4, fill: '#fff', 'font-size': 11, 'font-weight': 750,
      'font-family': 'inherit', 'pointer-events': 'none',
    }, samePlace ? 'A/B' : isStart ? 'A' : 'B') : null;
    if (symbol) group.append(symbol);
    const lines = wrapLabel(name);
    const label = element('text', {
      class: 'map-node-label', 'text-anchor': 'middle', fill: '#183b58', 'font-size': 12,
      'font-weight': 650, 'font-family': 'inherit', stroke: '#fff', 'stroke-width': 5,
      'stroke-linejoin': 'round', 'paint-order': 'stroke fill',
    });
    lines.forEach((line, index) => label.append(element('tspan', { x: 0, y: 36 + index * 17 }, line)));
    group.append(label);
    nodeLayer.append(group);
    nodeElements.set(name, { group, lines, marker, halo, symbol, label, emphasized: isStart || isDestination });
    updateNodeGeometry(name);
  }

  /** Update only the moved node's transform; labels travel with its marker. */
  function updateNodeGeometry(name) {
    const point = positions.get(name);
    nodeElements.get(name)?.group.setAttribute('transform', `translate(${point.x} ${point.y})`);
  }

  /** Show instructions inside the SVG when there are no locations to draw. */
  function drawEmptyState() {
    emptyLayer.append(element('circle', { cx: 0, cy: -28, r: 26, fill: '#e9f4ff' }));
    emptyLayer.append(element('text', { x: 0, y: -20, 'text-anchor': 'middle', fill: '#087ff5', 'font-size': 25, 'font-family': 'inherit' }, '+'));
    emptyLayer.append(element('text', { x: 0, y: 27, 'text-anchor': 'middle', fill: '#244763', 'font-size': 17, 'font-weight': 700, 'font-family': 'inherit' }, 'Your network starts here'));
    emptyLayer.append(element('text', { x: 0, y: 54, 'text-anchor': 'middle', fill: '#748a9d', 'font-size': 12, 'font-family': 'inherit' }, 'Add a location, then connect it with a road.'));
  }

  /** Determine the displayed canvas aspect ratio, including initially hidden SVGs. */
  function aspectRatio() {
    const rectangle = svg.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0 ? rectangle.width / rectangle.height : 900 / 520;
  }

  /** Keep labels readable in screen pixels while preserving meaningful graph zoom. */
  function updateScaleStyles() {
    const rectangle = svg.getBoundingClientRect();
    const unitsPerPixel = camera.width / (rectangle.width || 900);
    // At fit/zoom-out, text has a screen-size floor. At zoom-in, its original
    // world size takes over so it grows naturally with the rest of the graph.
    nodeScale = Math.max(1, unitsPerPixel * 11 / 12);
    weightScale = Math.max(1, unitsPerPixel);
    for (const entry of nodeElements.values()) {
      entry.marker.setAttribute('r', (entry.emphasized ? 15 : 10) * nodeScale);
      if (entry.halo) entry.halo.setAttribute('r', 24 * nodeScale);
      if (entry.symbol) {
        entry.symbol.style.fontSize = `${11 * nodeScale}px`;
        entry.symbol.setAttribute('y', 4 * nodeScale);
      }
      // Inline styles intentionally override the dashboard's fixed SVG font
      // sizes; CSS pixel units inside an SVG still scale with its viewBox.
      entry.label.style.fontSize = `${12 * nodeScale}px`;
      entry.label.style.strokeWidth = `${5 * nodeScale}px`;
      [...entry.label.children].forEach((line, index) => line.setAttribute('y', (36 + index * 17) * nodeScale));
    }
    for (const entry of roadElements) {
      entry.weightRect.setAttribute('x', -entry.labelWidth * weightScale / 2);
      entry.weightRect.setAttribute('y', -12 * weightScale);
      entry.weightRect.setAttribute('width', entry.labelWidth * weightScale);
      entry.weightRect.setAttribute('height', 24 * weightScale);
      entry.weightRect.setAttribute('rx', 12 * weightScale);
      entry.weightText.style.fontSize = `${10 * weightScale}px`;
      entry.weightText.setAttribute('y', 3.5 * weightScale);
      updateRoadGeometry(entry);
    }
  }

  /** Write viewBox and refresh responsive geometry after every camera change. */
  function applyCamera() {
    svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
    updateScaleStyles();
  }

  /** Measure actual wrapped labels, with an estimate for hidden/test SVGs. */
  function nodeBounds(name) {
    const point = positions.get(name);
    const entry = nodeElements.get(name);
    if (entry && typeof entry.group.getBBox === 'function') {
      try {
        const bounds = entry.group.getBBox();
        if (bounds.width > 0 && bounds.height > 0) {
          const padding = 4 * nodeScale;
          return { left: point.x + bounds.x - padding, right: point.x + bounds.x + bounds.width + padding, top: point.y + bounds.y - padding, bottom: point.y + bounds.y + bounds.height + padding };
        }
      } catch { /* Detached or display:none SVGs may not expose text bounds yet. */ }
    }
    const lines = entry?.lines || wrapLabel(name);
    const halfLabel = Math.max(28, ...lines.map((line) => Array.from(line).length * 3.8)) * nodeScale;
    return { left: point.x - halfLabel, right: point.x + halfLabel, top: point.y - 30 * nodeScale, bottom: point.y + (42 + lines.length * 17) * nodeScale };
  }

  /** Fit the network, iterating because readable labels grow as viewBox widens. */
  function fit() {
    if (destroyed) return;
    const ratio = aspectRatio();
    let centerX = 0;
    let centerY = 0;
    let width = 700;
    let height = 410;
    if (currentNetwork.locations.length) {
      // A few converging passes resolve the dependency between camera scale
      // and label bounds. Reading actual SVG bounds avoids mobile clipping.
      for (let pass = 0; pass < 6; pass++) {
        updateScaleStyles();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (const name of currentNetwork.locations) {
          const bounds = nodeBounds(name);
          left = Math.min(left, bounds.left);
          right = Math.max(right, bounds.right);
          top = Math.min(top, bounds.top);
          bottom = Math.max(bottom, bounds.bottom);
        }
        centerX = (left + right) / 2;
        centerY = (top + bottom) / 2;
        width = Math.max(360, right - left + 100);
        height = Math.max(260, bottom - top + 90);
        if (width / height < ratio) width = height * ratio;
        else height = width / ratio;
        camera = { x: centerX - width / 2, y: centerY - height / 2, width, height };
        applyCamera();
      }
    } else {
      if (width / height < ratio) width = height * ratio;
      else height = width / ratio;
      camera = { x: -width / 2, y: -height / 2, width, height };
      applyCamera();
    }
    fittedWidth = camera.width;
    cameraWasFit = true;
  }

  /** Zoom around an optional graph point while keeping useful scale limits. */
  function zoom(factor, anchor = null) {
    if (destroyed) return;
    const oldWidth = camera.width;
    const width = Math.max(100, Math.min(Math.max(6000, fittedWidth * 8), oldWidth * factor));
    const scale = width / oldWidth;
    const point = anchor || { x: camera.x + oldWidth / 2, y: camera.y + camera.height / 2 };
    camera = { x: point.x - (point.x - camera.x) * scale, y: point.y - (point.y - camera.y) * scale, width, height: camera.height * scale };
    cameraWasFit = false;
    applyCamera();
  }

  /** Move one zoom step closer; called by the dashboard's zoom button. */
  function zoomIn() { zoom(0.8); }

  /** Move one zoom step farther away; called by the dashboard's zoom button. */
  function zoomOut() { zoom(1.25); }

  /** Convert screen coordinates using a current or captured inverse SVG matrix. */
  function eventPoint(event, inverse = null) {
    const matrix = inverse || svg.getScreenCTM()?.inverse();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix);
  }

  /** Find a node by a fixed selector without ever interpolating its user-supplied name. */
  function eventNode(event) {
    const group = event.target?.closest?.('[data-map-node]');
    return group && svg.contains(group) ? group : null;
  }

  /** Begin a node drag or background pan and remember the original camera matrix. */
  function pointerDown(event) {
    if (destroyed || pointer || event.button !== 0 || event.isPrimary === false) return;
    const inverse = svg.getScreenCTM()?.inverse();
    const point = eventPoint(event, inverse);
    if (!point) return;
    const group = eventNode(event);
    const name = group?.getAttribute('data-map-node') ?? null;
    pointer = {
      id: event.pointerId, name, inverse, point, clientX: event.clientX, clientY: event.clientY,
      origin: name !== null ? { ...positions.get(name) } : { x: camera.x, y: camera.y }, moved: false,
    };
    if (group) group.focus({ preventScroll: true });
    try { svg.setPointerCapture(event.pointerId); } catch { /* Detached SVGs cannot capture a pointer. */ }
    event.preventDefault();
  }

  /** Drag a location or pan using the original matrix to avoid movement feedback. */
  function pointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = eventPoint(event, pointer.inverse);
    if (!point) return;
    if (!pointer.moved && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) < 4) return;
    pointer.moved = true;
    cameraWasFit = false;
    const deltaX = point.x - pointer.point.x;
    const deltaY = point.y - pointer.point.y;
    if (pointer.name !== null) {
      positions.set(pointer.name, { x: pointer.origin.x + deltaX, y: pointer.origin.y + deltaY });
      updateNodeGeometry(pointer.name);
      for (const road of roadElements) updateRoadGeometry(road);
    } else {
      camera.x = pointer.origin.x - deltaX;
      camera.y = pointer.origin.y - deltaY;
      applyCamera();
    }
    event.preventDefault();
  }

  /** Finish a gesture; a drag never also chooses a destination. */
  function pointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const finished = pointer;
    pointer = null;
    try { svg.releasePointerCapture(event.pointerId); } catch { /* Capture may already have ended. */ }
    // Capturing to SVG retargets native clicks, so activate once on pointerup.
    ignoreClickBefore = performance.now() + 400;
    if (!finished.moved && finished.name !== null && event.type !== 'pointercancel') onNodeActivate(finished.name);
  }

  /** Support assistive-technology clicks, while pointer gestures activate on pointerup. */
  function click(event) {
    if (event.detail !== 0 || performance.now() < ignoreClickBefore) return;
    const group = eventNode(event);
    if (group) onNodeActivate(group.getAttribute('data-map-node'));
  }

  /** Activate nodes with Enter/Space; offer camera shortcuts on the SVG itself. */
  function keyDown(event) {
    const group = eventNode(event);
    if (group && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (!event.repeat) onNodeActivate(group.getAttribute('data-map-node'));
      return;
    }
    if (group || event.target !== svg) return;
    if (event.key === '+' || event.key === '=') zoomIn();
    else if (event.key === '-') zoomOut();
    else if (event.key === '0' || event.key === 'Home') fit();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const step = camera.width * 0.08;
      if (event.key === 'ArrowLeft') camera.x -= step;
      if (event.key === 'ArrowRight') camera.x += step;
      if (event.key === 'ArrowUp') camera.y -= step;
      if (event.key === 'ArrowDown') camera.y += step;
      cameraWasFit = false;
      applyCamera();
    } else return;
    event.preventDefault();
  }

  /** Wheel zoom follows the pointer instead of always zooming at the center. */
  function wheel(event) {
    event.preventDefault();
    const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.002)));
    zoom(factor, eventPoint(event));
  }

  /** Keep a fitted graph framed when the responsive canvas changes dimensions. */
  function resize() {
    if (destroyed) return;
    if (cameraWasFit) fit();
    else {
      const centerY = camera.y + camera.height / 2;
      camera.height = camera.width / aspectRatio();
      camera.y = centerY - camera.height / 2;
      applyCamera();
    }
  }

  /** Remove listeners and owned layers if the dashboard disposes of this map. */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const [type, listener] of listeners) svg.removeEventListener(type, listener);
    resizeObserver?.disconnect();
    roadLayer.remove();
    nodeLayer.remove();
    emptyLayer.remove();
    for (const node of createdDescriptions) node.remove();
    for (const [name, value] of originalAttributes) {
      if (value === null) svg.removeAttribute(name);
      else svg.setAttribute(name, value);
    }
    svg.style.touchAction = originalTouchAction;
    svg.style.userSelect = originalUserSelect;
    pointer = null;
  }

  const listeners = [
    ['pointerdown', pointerDown], ['pointermove', pointerMove], ['pointerup', pointerUp],
    ['pointercancel', pointerUp], ['click', click], ['keydown', keyDown], ['wheel', wheel],
  ];
  for (const [type, listener] of listeners) svg.addEventListener(type, listener, type === 'wheel' ? { passive: false } : undefined);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(svg);
  applyCamera();

  return { render, zoomIn, zoomOut, fit, destroy };
}
