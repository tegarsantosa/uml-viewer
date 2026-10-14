import './style.css';
import { deflateRaw, inflateRaw } from 'pako';
import { createEditor, setEditorText } from './editor';
import { EXAMPLES } from './examples';
import { detectDiagramType, isNativeType } from './detect';
import { parse } from './parser';
import { plantUmlUrl } from './remote';
import { RenderResult, kindIcon, renderDiagram, visibilityIcon } from './render';
import { DEFAULT_SETTINGS, PALETTES, Settings, ThemeName, loadSettings, saveSettings } from './settings';

const SOURCE_KEY = 'uml-viewer.source';
const NS = 'http://www.w3.org/2000/svg';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------- State ----------
let settings = loadSettings();
let source = '';
let lastResult: RenderResult | null = null;
let lastMode: 'native' | 'server' = 'native';
let renderTimer: number | undefined;
let serverTimer: number | undefined;

const view = { scale: 1, x: 0, y: 0 };
let autoFit = true;

// ---------- Elements ----------
const editorPane = $('editor-pane');
const canvas = $('canvas');
const viewport = $('viewport');
const message = $('diagram-message');
const statusMode = $('status-mode');
const statusStats = $('status-stats');
const statusWarnings = $<HTMLButtonElement>('status-warnings');
const warningsList = $('warnings-list');
const settingsPanel = $('settings-panel');
const settingsBody = $('settings-body');
const zoomLabel = $<HTMLButtonElement>('btn-zoom-reset');

// ---------- Source persistence / sharing ----------
function encodeShare(text: string): string {
  const bytes = deflateRaw(new TextEncoder().encode(text), { level: 9 });
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(hash: string): string | null {
  try {
    const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(inflateRaw(bytes));
  } catch {
    return null;
  }
}

function initialSource(): string {
  const m = /[#&]src=([^&]+)/.exec(location.hash);
  if (m) {
    const decoded = decodeShare(m[1]);
    if (decoded !== null) {
      history.replaceState(null, '', location.pathname + location.search);
      return decoded;
    }
  }
  try {
    const saved = localStorage.getItem(SOURCE_KEY);
    if (saved !== null) return saved;
  } catch {
    /* ignore */
  }
  return EXAMPLES[0].source;
}

let saveTimer: number | undefined;
function persistSource(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SOURCE_KEY, source);
    } catch {
      /* ignore */
    }
  }, 400);
}

// ---------- Theme ----------
function applyTheme(): void {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--editor-width', `${settings.editorWidth}%`);
}

// ---------- Rendering ----------
// Called on every keystroke. Native rendering is cheap, so it follows typing closely;
// server rendering waits for a longer pause (see renderServer).
function scheduleRender(): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => render(true), 120);
}

function showMessage(text: string, isError = false): void {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle('error', isError);
}

function hideMessage(): void {
  message.hidden = true;
}

function render(typing = false): void {
  const type = detectDiagramType(source);
  const useNative = settings.renderer === 'native' || (settings.renderer === 'auto' && isNativeType(type));

  if (!source.trim()) {
    viewport.replaceChildren();
    lastResult = null;
    showMessage('Start typing PlantUML on the left. The diagram updates as you type.');
    statusMode.textContent = '';
    statusStats.textContent = '';
    setWarnings([]);
    return;
  }

  if (useNative) {
    window.clearTimeout(serverTimer);
    renderNative();
  } else {
    renderServer(type, typing ? SERVER_TYPING_DELAY : SERVER_ACTION_DELAY);
  }
}

function renderNative(): void {
  const diagram = parse(source);
  const palette = PALETTES[settings.theme];
  let result: RenderResult;
  try {
    result = renderDiagram(diagram, settings, palette);
  } catch (err) {
    console.error(err);
    showMessage(`Could not lay out the diagram: ${(err as Error).message}`, true);
    return;
  }
  lastResult = result;
  lastMode = 'native';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', String(result.width));
  svg.setAttribute('height', String(result.height));
  svg.setAttribute('viewBox', `0 0 ${result.width} ${result.height}`);
  svg.append(result.content);
  viewport.replaceChildren(svg);

  if (result.stats.classes === 0 && result.stats.notes === 0) {
    showMessage('No classes found. Declare one with "class Name { }" or add a relation like "A --> B".');
  } else hideMessage();

  statusMode.textContent = 'Native renderer';
  const parts: string[] = [];
  parts.push(`${result.stats.classes} ${result.stats.classes === 1 ? 'class' : 'classes'}`);
  parts.push(`${result.stats.relations} ${result.stats.relations === 1 ? 'relation' : 'relations'}`);
  if (result.stats.groups) parts.push(`${result.stats.groups} ${result.stats.groups === 1 ? 'package' : 'packages'}`);
  if (result.stats.notes) parts.push(`${result.stats.notes} ${result.stats.notes === 1 ? 'note' : 'notes'}`);
  statusStats.textContent = parts.join(' · ');
  setWarnings(diagram.warnings);

  if (autoFit) fitToView();
  else applyView();
}

// Idle time after the last keystroke before the PlantUML server is asked for a render.
// Keystrokes within this window collapse into one request.
const SERVER_TYPING_DELAY = 1000;
// Delay for deliberate actions (example loaded, setting changed): just enough to coalesce bursts.
const SERVER_ACTION_DELAY = 100;

let serverShownUrl = '';          // URL of the image currently in the viewport
let serverInFlightUrl: string | null = null; // URL of the request currently loading
let serverPendingType: string | null = null; // a newer render is wanted once the current one lands

function renderServer(type: string, delay: number): void {
  window.clearTimeout(serverTimer);
  statusMode.textContent = `PlantUML server · ${type} diagram`;
  setWarnings([]);
  serverTimer = window.setTimeout(() => requestServerRender(type), delay);
}

function requestServerRender(type: string): void {
  const url = plantUmlUrl(settings.plantumlServer, source, 'svg');

  // Nothing new to show: the exact same diagram is already on screen.
  if (lastMode === 'server' && url === serverShownUrl) return;

  // Only one request at a time. If one is loading, remember that a newer render is wanted
  // and fire it when the current one finishes, instead of stacking requests on the server.
  if (serverInFlightUrl !== null) {
    if (url !== serverInFlightUrl) serverPendingType = type;
    return;
  }

  serverInFlightUrl = url;
  statusStats.textContent = 'Rendering…';
  const img = new Image();
  img.alt = 'Diagram rendered by PlantUML server';
  const finish = () => {
    serverInFlightUrl = null;
    const pending = serverPendingType;
    serverPendingType = null;
    if (pending !== null) requestServerRender(pending);
  };
  img.onload = () => {
    viewport.replaceChildren(img);
    serverShownUrl = url;
    lastResult = null;
    lastMode = 'server';
    hideMessage();
    statusStats.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    if (autoFit) fitToView();
    else applyView();
    finish();
  };
  img.onerror = () => {
    showMessage('The PlantUML server could not be reached. Check your connection or the server URL in Settings.', true);
    statusStats.textContent = 'Failed';
    finish();
  };
  img.src = url;
}

// ---------- Warnings ----------
let currentWarnings: { line: number; message: string }[] = [];
function setWarnings(ws: { line: number; message: string }[]): void {
  currentWarnings = ws;
  if (!ws.length) {
    statusWarnings.hidden = true;
    warningsList.hidden = true;
    return;
  }
  statusWarnings.hidden = false;
  statusWarnings.textContent = `${ws.length} ${ws.length === 1 ? 'line' : 'lines'} skipped`;
  warningsList.replaceChildren(
    ...ws.map((w) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ln = document.createElement('span');
      ln.className = 'line';
      ln.textContent = `L${w.line}`;
      const msg = document.createElement('span');
      msg.textContent = w.message;
      b.append(ln, msg);
      b.addEventListener('click', () => {
        const line = editor.state.doc.line(Math.min(w.line, editor.state.doc.lines));
        editor.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
        editor.focus();
        warningsList.hidden = true;
      });
      return b;
    }),
  );
}
statusWarnings.addEventListener('click', () => {
  warningsList.hidden = !warningsList.hidden || !currentWarnings.length;
});

// ---------- Pan & zoom ----------
function contentSize(): { w: number; h: number } | null {
  const child = viewport.firstElementChild as HTMLElement | SVGSVGElement | null;
  if (!child) return null;
  if (child instanceof HTMLImageElement) return { w: child.naturalWidth, h: child.naturalHeight };
  return { w: lastResult?.width ?? 0, h: lastResult?.height ?? 0 };
}

function applyView(): void {
  viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
}

function fitToView(): void {
  const size = contentSize();
  if (!size || !size.w || !size.h) return;
  const rect = canvas.getBoundingClientRect();
  const pad = 24;
  const scale = Math.min((rect.width - pad * 2) / size.w, (rect.height - pad * 2) / size.h, 1.5);
  view.scale = Math.max(0.1, scale);
  view.x = (rect.width - size.w * view.scale) / 2;
  view.y = (rect.height - size.h * view.scale) / 2;
  autoFit = true;
  applyView();
}

function zoomAt(factor: number, cx: number, cy: number): void {
  const next = Math.min(6, Math.max(0.1, view.scale * factor));
  const k = next / view.scale;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.scale = next;
  autoFit = false;
  applyView();
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.01), cx, cy);
    } else if (e.shiftKey && e.deltaX === 0) {
      view.x -= e.deltaY;
      autoFit = false;
      applyView();
    } else {
      // Trackpads send precise deltas; mouse wheels zoom by default.
      const isTrackpad = Math.abs(e.deltaY) < 50 && Number.isInteger(e.deltaY) === false;
      if (isTrackpad || e.deltaX !== 0) {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        autoFit = false;
        applyView();
      } else zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
    }
  },
  { passive: false },
);

let panStart: { x: number; y: number; vx: number; vy: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('panning');
});
canvas.addEventListener('pointermove', (e) => {
  if (!panStart) return;
  view.x = panStart.vx + (e.clientX - panStart.x);
  view.y = panStart.vy + (e.clientY - panStart.y);
  autoFit = false;
  applyView();
});
const endPan = () => {
  panStart = null;
  canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', endPan);
canvas.addEventListener('pointercancel', endPan);
canvas.addEventListener('dblclick', () => fitToView());

$('btn-fit').addEventListener('click', () => fitToView());
$('btn-zoom-in').addEventListener('click', () => {
  const r = canvas.getBoundingClientRect();
  zoomAt(1.25, r.width / 2, r.height / 2);
});
$('btn-zoom-out').addEventListener('click', () => {
  const r = canvas.getBoundingClientRect();
  zoomAt(1 / 1.25, r.width / 2, r.height / 2);
});
zoomLabel.addEventListener('click', () => {
  const r = canvas.getBoundingClientRect();
  zoomAt(1 / view.scale, r.width / 2, r.height / 2);
});

new ResizeObserver(() => {
  if (autoFit) fitToView();
}).observe(canvas);

// ---------- Export ----------
function standaloneSvg(): string | null {
  if (lastMode !== 'native' || !lastResult) return null;
  const palette = PALETTES[settings.theme];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', String(lastResult.width));
  svg.setAttribute('height', String(lastResult.height));
  svg.setAttribute('viewBox', `0 0 ${lastResult.width} ${lastResult.height}`);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', palette.canvas);
  svg.append(bg, lastResult.content.cloneNode(true));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function diagramName(): string {
  const m = /^\s*(?:abstract\s+)?(?:class|interface|enum)\s+("[^"]+"|[\w.$]+)/m.exec(source);
  const base = m ? m[1].replace(/"/g, '') : 'diagram';
  return base.replace(/[^\w.-]+/g, '_');
}

$('btn-export-svg').addEventListener('click', async () => {
  const svg = standaloneSvg();
  if (svg) {
    download(new Blob([svg], { type: 'image/svg+xml' }), `${diagramName()}.svg`);
    return;
  }
  if (lastMode === 'server') {
    try {
      const res = await fetch(plantUmlUrl(settings.plantumlServer, source, 'svg'));
      download(await res.blob(), `${diagramName()}.svg`);
    } catch {
      window.open(plantUmlUrl(settings.plantumlServer, source, 'svg'), '_blank');
    }
  }
});

$('btn-export-png').addEventListener('click', async () => {
  const svg = standaloneSvg();
  if (!svg) {
    if (lastMode === 'server') {
      try {
        const res = await fetch(plantUmlUrl(settings.plantumlServer, source, 'png'));
        download(await res.blob(), `${diagramName()}.png`);
      } catch {
        window.open(plantUmlUrl(settings.plantumlServer, source, 'png'), '_blank');
      }
    }
    return;
  }
  const scale = 2;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = lastResult!.width * scale;
    c.height = lastResult!.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => blob && download(blob, `${diagramName()}.png`), 'image/png');
  };
  img.src = url;
});

$('btn-copy-link').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#src=${encodeShare(source)}`;
  const btn = $('btn-copy-link');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied';
  } catch {
    prompt('Copy this link', url);
  }
  setTimeout(() => (btn.textContent = 'Link'), 1200);
});

// ---------- Renderer segmented control ----------
const rendererSeg = $('renderer-seg');
function syncRendererSeg(): void {
  rendererSeg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.value === settings.renderer));
  });
}
rendererSeg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  settings.renderer = b.dataset.value as Settings['renderer'];
  saveSettings(settings);
  syncRendererSeg();
  render();
});

// ---------- Legend ----------
const legend = $('legend');
const legendBtn = $('btn-legend');

function buildLegend(): void {
  const palette = PALETTES[settings.theme];
  legend.replaceChildren();
  const title = (text: string) => {
    const d = document.createElement('div');
    d.className = 'legend-title';
    d.textContent = text;
    legend.append(d);
  };
  const rowWith = (icon: SVGElement | null, label: string, style?: string) => {
    const d = document.createElement('div');
    d.className = 'legend-row';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    if (icon) svg.append(icon);
    const span = document.createElement('span');
    span.textContent = label;
    if (style) span.setAttribute('style', style);
    d.append(svg, span);
    legend.append(d);
  };
  const vis: ('public' | 'private' | 'protected' | 'package')[] = ['public', 'private', 'protected', 'package'];
  title('Visibility');
  for (const v of vis) {
    let icon: SVGElement;
    if (settings.visibility === 'icons') icon = visibilityIcon(v, 8, 8, 12, palette);
    else {
      icon = document.createElementNS(NS, 'text');
      icon.setAttribute('x', '8');
      icon.setAttribute('y', '12');
      icon.setAttribute('text-anchor', 'middle');
      icon.setAttribute('fill', palette.vis[v]);
      icon.setAttribute('font-weight', '700');
      icon.textContent = { public: '+', private: '−', protected: '#', package: '~' }[v];
      if (settings.visibility !== 'text') {
        const shape = document.createElementNS(NS, v === 'public' ? 'circle' : 'rect');
        shape.setAttribute('fill', palette.vis[v]);
        if (v === 'public') {
          shape.setAttribute('cx', '8');
          shape.setAttribute('cy', '8');
          shape.setAttribute('r', '5');
        } else {
          shape.setAttribute('x', '3');
          shape.setAttribute('y', '3');
          shape.setAttribute('width', '10');
          shape.setAttribute('height', '10');
          if (v === 'protected') shape.setAttribute('transform', 'rotate(45 8 8)');
          if (v === 'package') shape.setAttribute('rx', '5');
        }
        icon = shape;
      }
    }
    rowWith(icon, v);
  }
  title('Members');
  if (settings.showMemberKind) {
    rowWith(kindIcon('field', 8, 8, 14, palette, 12), 'field');
    rowWith(kindIcon('method', 8, 8, 14, palette, 12), 'method');
  }
  rowWith(null, 'static', 'text-decoration: underline');
  rowWith(null, 'abstract', 'font-style: italic');
}

legendBtn.addEventListener('click', () => {
  if (legend.hidden) buildLegend();
  legend.hidden = !legend.hidden;
  legendBtn.setAttribute('aria-pressed', String(!legend.hidden));
});

// ---------- Settings panel ----------
type Opt<T extends string> = { value: T; label: string };

function buildSettings(): void {
  settingsBody.replaceChildren();

  const section = (title: string) => {
    const h = document.createElement('div');
    h.className = 'settings-section';
    h.textContent = title;
    settingsBody.append(h);
  };

  const row = (label: string, control: HTMLElement) => {
    const r = document.createElement('label');
    r.className = 'setting';
    const s = document.createElement('span');
    s.textContent = label;
    r.append(s, control);
    settingsBody.append(r);
  };

  const select = <K extends keyof Settings>(key: K, options: Opt<Settings[K] & string>[], rerender = true) => {
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = settings[key] === o.value;
      sel.append(opt);
    }
    sel.addEventListener('change', () => {
      (settings as unknown as Record<string, unknown>)[key] = sel.value;
      saveSettings(settings);
      buildLegend();
      if (rerender) render();
    });
    return sel;
  };

  const toggle = <K extends keyof Settings>(key: K) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'switch';
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      (settings as unknown as Record<string, unknown>)[key] = input.checked;
      saveSettings(settings);
      buildLegend();
      render();
    });
    return input;
  };

  const range = <K extends keyof Settings>(key: K, min: number, max: number, step: number, suffix = '') => {
    const wrap = document.createElement('div');
    wrap.className = 'setting-range';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(settings[key]);
    const val = document.createElement('span');
    val.className = 'range-value';
    val.textContent = `${settings[key]}${suffix}`;
    input.addEventListener('input', () => {
      (settings as unknown as Record<string, unknown>)[key] = Number(input.value);
      val.textContent = `${input.value}${suffix}`;
      saveSettings(settings);
      scheduleRender();
    });
    wrap.append(input, val);
    return wrap;
  };

  // Theme swatches
  section('Appearance');
  const grid = document.createElement('div');
  grid.className = 'theme-grid';
  grid.setAttribute('role', 'radiogroup');
  const themes: Opt<ThemeName>[] = [
    { value: 'intellij', label: 'IntelliJ' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'darcula', label: 'Darcula' },
    { value: 'contrast', label: 'Contrast' },
    { value: 'sepia', label: 'Sepia' },
  ];
  for (const t of themes) {
    const p = PALETTES[t.value];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.theme === t.value));
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = p.canvas;
    sw.style.setProperty('--sw-node', p.nodeFill);
    sw.style.setProperty('--sw-stroke', p.nodeStroke);
    const lbl = document.createElement('span');
    lbl.textContent = t.label;
    b.append(sw, lbl);
    b.addEventListener('click', () => {
      settings.theme = t.value;
      saveSettings(settings);
      applyTheme();
      buildLegend();
      grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      render();
    });
    grid.append(b);
  }
  settingsBody.append(grid);

  row(
    'Diagram font',
    select('font', [
      { value: 'sans', label: 'Sans-serif' },
      { value: 'mono', label: 'Monospace' },
    ]),
  );
  row('Font size', range('fontSize', 10, 20, 1, 'px'));

  section('Layout');
  row(
    'Direction',
    select('layout', [
      { value: 'auto', label: 'From source' },
      { value: 'TB', label: 'Top to bottom' },
      { value: 'LR', label: 'Left to right' },
    ]),
  );
  row(
    'Spacing',
    select('spacing', [
      { value: 'compact', label: 'Compact' },
      { value: 'normal', label: 'Normal' },
      { value: 'relaxed', label: 'Relaxed' },
    ]),
  );
  row(
    'Edge style',
    select('edgeStyle', [
      { value: 'orthogonal', label: 'Orthogonal' },
      { value: 'straight', label: 'Straight' },
      { value: 'curved', label: 'Curved' },
    ]),
  );
  row('Jump over crossing lines', toggle('lineJumps'));

  section('Members');
  row(
    'Visibility',
    select('visibility', [
      { value: 'icons', label: 'Lock icons' },
      { value: 'symbols', label: 'Shapes' },
      { value: 'text', label: '+ − # ~' },
      { value: 'both', label: 'Shapes and text' },
    ]),
  );
  row('Member kind icon (m / f)', toggle('showMemberKind'));
  row(
    'Parameters',
    select('params', [
      { value: 'types', label: 'Types only' },
      { value: 'names', label: 'Names only' },
      { value: 'full', label: 'As written' },
      { value: 'none', label: 'Hidden' },
    ]),
  );
  row('Show types', toggle('showTypes'));
  row(
    'Type position',
    select('typeAlign', [
      { value: 'right', label: 'Right column' },
      { value: 'inline', label: 'After name' },
    ]),
  );
  row('Row dividers', toggle('rowDividers'));
  row('Attributes / operations compartments', toggle('separateCompartments'));
  row('Class kind badge', toggle('showKindBadge'));
  row('Stereotypes', toggle('showStereotypes'));

  section('PlantUML server');
  const url = document.createElement('input');
  url.type = 'text';
  url.value = settings.plantumlServer;
  url.spellcheck = false;
  url.placeholder = DEFAULT_SETTINGS.plantumlServer;
  url.addEventListener('change', () => {
    settings.plantumlServer = url.value.trim() || DEFAULT_SETTINGS.plantumlServer;
    url.value = settings.plantumlServer;
    saveSettings(settings);
    render();
  });
  row('Server URL', url);
  const hint = document.createElement('div');
  hint.style.color = 'var(--muted)';
  hint.style.fontSize = '12px';
  hint.style.marginTop = '4px';
  hint.textContent = 'Used for sequence, activity, state and other non-class diagrams, or when the renderer is set to Server.';
  settingsBody.append(hint);
}

const settingsBtn = $<HTMLButtonElement>('btn-settings');
function toggleSettings(open?: boolean): void {
  const show = open ?? settingsPanel.hidden;
  settingsPanel.hidden = !show;
  settingsBtn.setAttribute('aria-expanded', String(show));
  if (show) buildSettings();
}
settingsBtn.addEventListener('click', () => toggleSettings());
$('btn-settings-close').addEventListener('click', () => toggleSettings(false));
$('btn-settings-reset').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS, editorWidth: settings.editorWidth };
  saveSettings(settings);
  applyTheme();
  syncRendererSeg();
  buildSettings();
  buildLegend();
  render();
});
document.addEventListener('pointerdown', (e) => {
  if (settingsPanel.hidden) return;
  const t = e.target as Node;
  if (!settingsPanel.contains(t) && !settingsBtn.contains(t)) toggleSettings(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    toggleSettings(false);
    warningsList.hidden = true;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') e.preventDefault();
});

// ---------- Examples ----------
const examplesSel = $<HTMLSelectElement>('examples');
{
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose…';
  examplesSel.append(placeholder);
  EXAMPLES.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = ex.name;
    examplesSel.append(o);
  });
  examplesSel.addEventListener('change', () => {
    const ex = EXAMPLES[Number(examplesSel.value)];
    if (!ex) return;
    const isExample = EXAMPLES.some((e) => e.source === source.trim()) || !source.trim();
    if (!isExample && !confirm('Replace the current text with this example?')) {
      examplesSel.value = '';
      return;
    }
    setEditorText(editor, ex.source);
    autoFit = true;
    examplesSel.value = '';
  });
}

// ---------- Split divider ----------
const divider = $('divider');
divider.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  const split = $('split');
  const onMove = (ev: PointerEvent) => {
    const rect = split.getBoundingClientRect();
    const pct = Math.min(80, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
    settings.editorWidth = Math.round(pct * 10) / 10;
    document.documentElement.style.setProperty('--editor-width', `${settings.editorWidth}%`);
  };
  const onUp = () => {
    divider.classList.remove('dragging');
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', onUp);
    saveSettings(settings);
    if (autoFit) fitToView();
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', onUp);
});

// ---------- Boot ----------
applyTheme();
syncRendererSeg();
source = initialSource();
const editor = createEditor(editorPane, source, (text) => {
  source = text;
  persistSource();
  scheduleRender();
});
render();
