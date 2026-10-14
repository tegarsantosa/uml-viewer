import dagre from '@dagrejs/dagre';
import { ClassKind, ClassNode, Diagram, HeadKind, Member, Note, Relation, Visibility } from './model';
import { FONT_STACKS, Palette, Settings } from './settings';

const NS = 'http://www.w3.org/2000/svg';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number }; // top-left based

export interface RenderResult {
  content: SVGGElement;
  width: number;
  height: number;
  stats: { classes: number; relations: number; notes: number; groups: number };
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  ...children: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  for (const c of children) e.append(c);
  return e;
}

class Measurer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  constructor(private family: string) {
    this.ctx = document.createElement('canvas').getContext('2d')!;
  }
  font(size: number, bold = false, italic = false): string {
    return `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}${size}px ${this.family}`;
  }
  width(text: string, size: number, bold = false, italic = false): number {
    const key = `${size}|${bold ? 1 : 0}|${italic ? 1 : 0}|${text}`;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.ctx.font = this.font(size, bold, italic);
      w = this.ctx.measureText(text).width;
      this.cache.set(key, w);
    }
    return w;
  }
}

interface RowLayout {
  member: Member;
  name: string;
  params?: string;
  type?: string;
  /** Width of icons + name + parameters (+ inline type). */
  leftW: number;
  /** Width of the right-aligned type column. */
  rightW: number;
}

interface CompartmentLayout {
  title?: string;
  rows: RowLayout[];
  height: number;
}

interface BoxLayout {
  cls: ClassNode;
  width: number;
  height: number;
  headerHeight: number;
  stereoLine?: string;
  nameText: string;
  genericsText?: string;
  compartments: CompartmentLayout[];
}

interface NoteLayout {
  note: Note;
  lines: string[];
  width: number;
  height: number;
}

const KIND_LETTER: Record<ClassKind, string> = {
  class: 'C',
  abstract: 'A',
  interface: 'I',
  enum: 'E',
  annotation: '@',
  entity: 'E',
  struct: 'S',
  exception: 'X',
  record: 'R',
  protocol: 'P',
  metaclass: 'M',
  stereotype: 'S',
  object: 'O',
};

function kindColor(kind: ClassKind, p: Palette): string {
  switch (kind) {
    case 'class':
    case 'record':
    case 'struct':
    case 'object':
      return p.kind.class;
    case 'abstract':
    case 'protocol':
      return p.kind.abstract;
    case 'interface':
      return p.kind.interface;
    case 'enum':
      return p.kind.enum;
    case 'annotation':
      return p.kind.annotation;
    case 'entity':
      return p.kind.entity;
    default:
      return p.kind.other;
  }
}

const VIS_CHAR: Record<Visibility, string> = { public: '+', private: '-', protected: '#', package: '~', none: '' };

const SPACING = {
  compact: { nodesep: 28, ranksep: 44, edgesep: 12 },
  normal: { nodesep: 44, ranksep: 64, edgesep: 16 },
  relaxed: { nodesep: 72, ranksep: 96, edgesep: 24 },
};

export function renderDiagram(diagram: Diagram, settings: Settings, palette: Palette): RenderResult {
  const family = FONT_STACKS[settings.font];
  const fs = settings.fontSize;
  const measurer = new Measurer(family);
  const rankdir = settings.layout === 'auto' ? diagram.rankdir : settings.layout;
  const edgeStyle = diagram.linetype === 'ortho' ? 'orthogonal' : diagram.linetype === 'polyline' ? 'straight' : settings.edgeStyle;

  // Metrics derived from font size
  const rowH = Math.round(fs * (settings.rowDividers ? 1.95 : 1.7));
  const padX = Math.round(fs * 0.9);
  const badge = Math.round(fs * 1.45);
  const symSize = Math.round(fs * 0.7);
  const iconD = Math.round(fs * 1.15);
  const lockW = Math.round(fs * 0.85);
  const headerH = rowH + 10;
  const visW =
    settings.visibility === 'icons'
      ? lockW + 8
      : settings.visibility === 'symbols'
        ? symSize + 8
        : settings.visibility === 'both'
          ? symSize + 8 + measurer.width('+', fs) + 4
          : measurer.width('+', fs) + 6;
  const symW = (settings.showMemberKind ? iconD + 7 : 0) + visW;
  const typeGap = Math.round(fs * 2);

  // ---------- Build node layouts ----------
  const visible = [...diagram.classes.values()].filter((c) => !c.hidden);
  const boxes = new Map<string, BoxLayout>();
  for (const cls of visible) boxes.set(cls.id, layoutClass(cls));

  const noteLayouts = new Map<string, NoteLayout>();
  for (const n of diagram.notes) {
    if (n.target && !boxes.has(n.target) && !noteLayouts.has(n.target)) continue;
    noteLayouts.set(n.id, layoutNote(n));
  }

  const relations = diagram.relations.filter(
    (r) => !r.anchor && (boxes.has(r.from) || noteLayouts.has(r.from)) && (boxes.has(r.to) || noteLayouts.has(r.to)),
  );
  // Association-class links: drawn from the middle of another relation.
  const anchored = diagram.relations.filter((r) => r.anchor && boxes.has(r.to) && relations.some((b) => b.id === r.anchor));

  // ---------- Dagre layout ----------
  const sp = SPACING[settings.spacing];
  const hasGroups = [...boxes.values()].some((b) => b.cls.parent) || [...noteLayouts.values()].some((n) => n.note.parent);
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  // Compound layouts gain extra ranks for cluster borders, so tighten ranksep to compensate.
  g.setGraph({ rankdir, nodesep: sp.nodesep, ranksep: hasGroups ? Math.round(sp.ranksep * 0.55) : sp.ranksep, edgesep: sp.edgesep, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizeOf = (id: string): { w: number; h: number } => {
    const b = boxes.get(id);
    if (b) return { w: b.width, h: b.height };
    const n = noteLayouts.get(id)!;
    return { w: n.width, h: n.height };
  };
  const parentOf = (id: string): string | undefined => boxes.get(id)?.cls.parent ?? noteLayouts.get(id)?.note.parent;

  // dagre has no "same rank" constraint (minlen 0 breaks its layout), so
  // elements that must sit side by side are merged into one layout node and
  // split back into their own rectangles afterwards.
  const memberSuper = new Map<string, string>();
  const supers = new Map<string, { members: string[]; before: [string, string][] }>();
  let superCount = 0;
  const sideBySide = (left: string, right: string) => {
    const sa = memberSuper.get(left);
    const sb = memberSuper.get(right);
    if (sa && sb && sa === sb) {
      supers.get(sa)!.before.push([left, right]);
      return;
    }
    const id = sa ?? sb ?? `__super_${superCount++}`;
    const target = supers.get(id) ?? { members: [], before: [] };
    supers.set(id, target);
    const absorb = (sid: string | undefined, member: string) => {
      if (sid && sid !== id) {
        const other = supers.get(sid)!;
        for (const m of other.members) {
          target.members.push(m);
          memberSuper.set(m, id);
        }
        target.before.push(...other.before);
        supers.delete(sid);
      } else if (!sid) {
        target.members.push(member);
        memberSuper.set(member, id);
      }
    };
    absorb(sa, left);
    absorb(sb, right);
    target.before.push([left, right]);
  };

  for (const r of relations) {
    if (r.from === r.to || r.direction === 'up' || r.direction === 'down') continue;
    if (r.direction === 'right') sideBySide(r.from, r.to);
    else sideBySide(r.to, r.from);
  }
  for (const n of noteLayouts.values()) {
    if (!n.note.target || (!boxes.has(n.note.target) && !noteLayouts.has(n.note.target))) continue;
    const pos = n.note.position ?? 'right';
    if (pos === 'left') sideBySide(n.note.id, n.note.target);
    else if (pos === 'right') sideBySide(n.note.target, n.note.id);
  }

  // Order members of each merged node using the before/after constraints.
  const superOrder = new Map<string, string[]>();
  for (const [sid, sup] of supers) {
    const members = sup.members;
    const indeg = new Map(members.map((m) => [m, 0]));
    const out = new Map<string, string[]>(members.map((m) => [m, []]));
    for (const [a, b] of sup.before) {
      if (!indeg.has(a) || !indeg.has(b)) continue;
      out.get(a)!.push(b);
      indeg.set(b, indeg.get(b)! + 1);
    }
    const order: string[] = [];
    const queue = members.filter((m) => indeg.get(m) === 0);
    while (queue.length) {
      const m = queue.shift()!;
      order.push(m);
      for (const nxt of out.get(m)!) {
        indeg.set(nxt, indeg.get(nxt)! - 1);
        if (indeg.get(nxt) === 0) queue.push(nxt);
      }
    }
    for (const m of members) if (!order.includes(m)) order.push(m);
    superOrder.set(sid, order);
  }

  const L = (id: string): string => memberSuper.get(id) ?? id;
  const usedGroups = new Set<string>();
  const groupPadTop = rowH + 8;
  const markGroups = (p: string | undefined) => {
    while (p) {
      usedGroups.add(p);
      p = diagram.groups.get(p)?.parent;
    }
  };
  const layoutNodes = new Set<string>();
  for (const id of [...boxes.keys(), ...noteLayouts.keys()]) {
    markGroups(parentOf(id));
    const sid = memberSuper.get(id);
    if (!sid) {
      const { w, h } = sizeOf(id);
      g.setNode(id, { width: w, height: h });
      layoutNodes.add(id);
    } else if (!layoutNodes.has(sid)) {
      const order = superOrder.get(sid)!;
      const sizes = order.map(sizeOf);
      const gap = sp.nodesep;
      const w = rankdir === 'TB' ? sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1) : Math.max(...sizes.map((s) => s.w));
      const h = rankdir === 'TB' ? Math.max(...sizes.map((s) => s.h)) : sizes.reduce((a, s) => a + s.h, 0) + gap * (sizes.length - 1);
      g.setNode(sid, { width: w, height: h });
      layoutNodes.add(sid);
    }
  }
  for (const gid of usedGroups) g.setNode(gid, { width: 0, height: 0 });
  for (const gid of usedGroups) {
    const grp = diagram.groups.get(gid);
    if (grp?.parent && usedGroups.has(grp.parent)) g.setParent(gid, grp.parent);
  }
  for (const id of [...boxes.keys(), ...noteLayouts.keys()]) {
    const p = parentOf(id);
    if (!p || !usedGroups.has(p)) continue;
    const lid = L(id);
    if (lid !== id) {
      // Only nest a merged node when all of its members share the parent.
      const all = superOrder.get(lid)!.every((m) => parentOf(m) === p);
      if (!all) continue;
    }
    g.setParent(lid, p);
  }

  relations.forEach((r, i) => {
    const u = L(r.from);
    const v = L(r.to);
    if (u === v) return;
    const labelW = r.label ? measurer.width(r.label.split('\n')[0], fs - 1) + 8 : 0;
    const labelH = r.label ? (fs + 4) * r.label.split('\n').length : 0;
    const base = { width: labelW, height: labelH, labelpos: 'c' as const };
    if (r.direction === 'up') g.setEdge(v, u, { ...base, minlen: Math.max(1, r.length - 1) }, `e${i}`);
    else if (r.direction === 'down') g.setEdge(u, v, { ...base, minlen: Math.max(1, r.length - 1) }, `e${i}`);
    else g.setEdge(u, v, { ...base, minlen: 1 }, `e${i}`);
  });
  anchored.forEach((r, i) => {
    const base = relations.find((b) => b.id === r.anchor)!;
    const upper = base.direction === 'up' ? base.to : base.from;
    const u = L(upper);
    const v = L(r.to);
    if (u === v || r.hidden) return;
    g.setEdge(u, v, { minlen: Math.max(1, base.length - 1), weight: 1 }, `ac${i}`);
  });
  noteLayouts.forEach((n) => {
    if (!n.note.target) return;
    const u = L(n.note.target);
    const v = L(n.note.id);
    if (u === v || !g.hasNode(u) || !g.hasNode(v)) return;
    const pos = n.note.position ?? 'right';
    if (pos === 'up') g.setEdge(v, u, { minlen: 1, weight: 3 }, 'n' + n.note.id);
    else if (pos === 'down') g.setEdge(u, v, { minlen: 1, weight: 3 }, 'n' + n.note.id);
  });

  dagre.layout(g);

  // Final rectangles: plain nodes straight from dagre, merged nodes split
  // along the cross axis in their constrained order.
  const placed = new Map<string, Rect>();
  for (const id of layoutNodes) {
    const n = g.node(id);
    if (!n) continue;
    const order = superOrder.get(id);
    if (!order) {
      placed.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
      continue;
    }
    let cursor = rankdir === 'TB' ? n.x - n.width / 2 : n.y - n.height / 2;
    for (const m of order) {
      const { w, h } = sizeOf(m);
      if (rankdir === 'TB') {
        placed.set(m, { x: cursor, y: n.y - h / 2, w, h });
        cursor += w + sp.nodesep;
      } else {
        placed.set(m, { x: n.x - w / 2, y: cursor, w, h });
        cursor += h + sp.nodesep;
      }
    }
  }

  const rectOf = (id: string): Rect => placed.get(id)!;

  // Bounds (including group padding)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (r: Rect) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };
  const groupRects = new Map<string, Rect>();
  const groupDepth = (id: string): number => {
    let d = 0;
    let p = diagram.groups.get(id)?.parent;
    while (p) {
      d++;
      p = diagram.groups.get(p)?.parent;
    }
    return d;
  };
  // Group rectangles are the union of their members (deepest groups first so
  // that parents can wrap their child groups).
  const groupPad = 14;
  for (const gid of [...usedGroups].sort((a, b) => groupDepth(b) - groupDepth(a))) {
    let gx0 = Infinity,
      gy0 = Infinity,
      gx1 = -Infinity,
      gy1 = -Infinity;
    const add = (r: Rect) => {
      gx0 = Math.min(gx0, r.x);
      gy0 = Math.min(gy0, r.y);
      gx1 = Math.max(gx1, r.x + r.w);
      gy1 = Math.max(gy1, r.y + r.h);
    };
    for (const b of boxes.values()) if (b.cls.parent === gid) add(rectOf(b.cls.id));
    for (const n of noteLayouts.values()) if (n.note.parent === gid) add(rectOf(n.note.id));
    for (const [cid, cr] of groupRects) if (diagram.groups.get(cid)?.parent === gid) add(cr);
    if (!isFinite(gx0)) continue;
    const grp = diagram.groups.get(gid)!;
    const labelW = measurer.width(grp.name || grp.kind, fs, true) + padX * 2 + 8;
    groupRects.set(gid, {
      x: gx0 - groupPad,
      y: gy0 - groupPad - groupPadTop,
      w: Math.max(gx1 - gx0 + groupPad * 2, labelW),
      h: gy1 - gy0 + groupPad * 2 + groupPadTop,
    });
  }
  for (const r of groupRects.values()) include(r);
  for (const id of boxes.keys()) include(rectOf(id));
  for (const id of noteLayouts.keys()) include(rectOf(id));
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 10;
    maxY = 10;
  }

  // ---------- Drawing ----------
  const root = el('g', { 'font-family': family, 'font-size': fs });
  const gGroups = el('g', { class: 'groups' });
  const gEdges = el('g', { class: 'edges' });
  const gNodes = el('g', { class: 'nodes' });
  const gLabels = el('g', { class: 'labels' });
  root.append(gGroups, gEdges, gNodes, gLabels);

  // Title / caption
  const margin = 24;
  let titleH = 0;
  if (diagram.title) {
    const lines = diagram.title.split('\n');
    const t = el('text', { x: (minX + maxX) / 2, y: minY - 16, 'text-anchor': 'middle', fill: palette.text, 'font-size': fs + 4, 'font-weight': 600 });
    lines.forEach((ln, i) => t.append(el('tspan', { x: (minX + maxX) / 2, dy: i === 0 ? -(lines.length - 1) * (fs + 8) : fs + 8 }, ln)));
    root.append(t);
    titleH = (fs + 8) * lines.length + 12;
  }
  if (diagram.caption) {
    root.append(el('text', { x: (minX + maxX) / 2, y: maxY + 20, 'text-anchor': 'middle', fill: palette.textMuted, 'font-size': fs }, diagram.caption));
    maxY += fs + 16;
  }

  // Groups
  for (const gid of [...usedGroups].sort((a, b) => groupDepth(a) - groupDepth(b))) {
    const grp = diagram.groups.get(gid);
    const r = groupRects.get(gid);
    if (!grp || !r) continue;
    const label = grp.name || grp.kind;
    const tabW = Math.max(measurer.width(label, fs, true) + padX * 2, 60);
    const tabH = groupPadTop - 4;
    const group = el('g', { class: 'group' });
    // Folder-tab shape
    group.append(
      el('path', {
        d: `M${r.x},${r.y + tabH} V${r.y + 3} a3,3 0 0 1 3,-3 H${r.x + tabW - 3} a3,3 0 0 1 3,3 V${r.y + tabH} Z`,
        fill: palette.groupFill,
        stroke: palette.groupStroke,
        'stroke-width': 1,
      }),
      el('rect', { x: r.x, y: r.y + tabH, width: r.w, height: r.h - tabH, rx: 3, fill: palette.groupFill, stroke: palette.groupStroke, 'stroke-width': 1 }),
      el('text', { x: r.x + padX, y: r.y + tabH / 2 + fs * 0.36, fill: palette.groupText, 'font-size': fs, 'font-weight': 600 }, label),
    );
    if (grp.stereotype && settings.showStereotypes) {
      group.append(el('text', { x: r.x + r.w - 8, y: r.y + tabH + fs + 6, 'text-anchor': 'end', fill: palette.textMuted, 'font-size': fs - 2 }, `«${grp.stereotype}»`));
    }
    gGroups.append(group);
  }

  // Edge routing: distribute ports along node sides
  type Side = 'top' | 'bottom' | 'left' | 'right';
  interface EdgeGeom {
    rel: Relation;
    from: Rect;
    to: Rect;
    fromSide: Side;
    toSide: Side;
    fromPort: Pt;
    toPort: Pt;
    points: Pt[];
    /** True when the edge runs straight between its ports. */
    straight?: boolean;
    /** Line points after shortening for arrowheads. */
    linePts?: Pt[];
    /** Segment index -> distances along that segment where this line hops over another. */
    jumps?: Map<number, number[]>;
  }
  const geoms: EdgeGeom[] = [];
  const sideOf = (a: Rect, b: Rect): [Side, Side] => {
    const gapY = b.y - (a.y + a.h);
    const gapYr = a.y - (b.y + b.h);
    const gapX = b.x - (a.x + a.w);
    const gapXr = a.x - (b.x + b.w);
    const vertical = Math.max(gapY, gapYr);
    const horizontal = Math.max(gapX, gapXr);
    if (rankdir === 'TB' ? vertical >= Math.min(horizontal, 0) && vertical > -Math.min(a.h, b.h) / 2 : horizontal < vertical && vertical > -Math.min(a.h, b.h) / 2) {
      return gapY >= gapYr ? ['bottom', 'top'] : ['top', 'bottom'];
    }
    return gapX >= gapXr ? ['right', 'left'] : ['left', 'right'];
  };
  for (const r of relations) {
    if (r.hidden) continue;
    const from = rectOf(r.from);
    const to = rectOf(r.to);
    if (r.from === r.to) {
      geoms.push({ rel: r, from, to, fromSide: 'right', toSide: 'right', fromPort: { x: 0, y: 0 }, toPort: { x: 0, y: 0 }, points: [] });
      continue;
    }
    const [fs1, ts1] = sideOf(from, to);
    geoms.push({ rel: r, from, to, fromSide: fs1, toSide: ts1, fromPort: { x: 0, y: 0 }, toPort: { x: 0, y: 0 }, points: [] });
  }
  // Note connectors
  interface NoteGeom {
    note: NoteLayout;
    target: Rect;
    rect: Rect;
  }
  const noteGeoms: NoteGeom[] = [];
  for (const n of noteLayouts.values()) {
    if (!n.note.target || !placed.has(n.note.target)) continue;
    noteGeoms.push({ note: n, target: rectOf(n.note.target), rect: rectOf(n.note.id) });
  }

  // Port assignment per (node, side). Straight connections come first: when
  // the two nodes overlap along the side, the edge uses one coordinate at both
  // ends and runs straight, provided no other node sits in that corridor.
  // Remaining edges are spread into free slots on their side.
  const portKey = (id: string, side: Side) => `${id}|${side}`;
  const minGap = fs * 1.3;
  const sidePad = Math.max(8, fs * 0.6);
  const taken = new Map<string, number[]>();
  const isFree = (key: string, v: number) => (taken.get(key) ?? []).every((t) => Math.abs(t - v) >= minGap);
  const take = (key: string, v: number) => (taken.get(key) ?? taken.set(key, []).get(key)!).push(v);
  const allRects = [...boxes.keys(), ...noteLayouts.keys()].map((id) => ({ id, r: rectOf(id) }));
  const portGroups = new Map<string, { geom: EdgeGeom; end: 'from' | 'to'; other: Rect }[]>();
  for (const ge of geoms) {
    if (ge.rel.from === ge.rel.to) continue;
    const kf = portKey(ge.rel.from, ge.fromSide);
    const kt = portKey(ge.rel.to, ge.toSide);
    (portGroups.get(kf) ?? portGroups.set(kf, []).get(kf)!).push({ geom: ge, end: 'from', other: ge.to });
    (portGroups.get(kt) ?? portGroups.set(kt, []).get(kt)!).push({ geom: ge, end: 'to', other: ge.from });
  }
  const portAt = (rect: Rect, side: Side, v: number): Pt => {
    if (side === 'top') return { x: v, y: rect.y };
    if (side === 'bottom') return { x: v, y: rect.y + rect.h };
    if (side === 'left') return { x: rect.x, y: v };
    return { x: rect.x + rect.w, y: v };
  };
  const corridorFree = (ge: EdgeGeom, v: number): boolean => {
    const horizontalSide = ge.fromSide === 'top' || ge.fromSide === 'bottom';
    const a = horizontalSide ? (ge.fromSide === 'bottom' ? ge.from.y + ge.from.h : ge.from.y) : ge.fromSide === 'right' ? ge.from.x + ge.from.w : ge.from.x;
    const b = horizontalSide ? (ge.toSide === 'top' ? ge.to.y : ge.to.y + ge.to.h) : ge.toSide === 'left' ? ge.to.x : ge.to.x + ge.to.w;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return allRects.every(({ id, r }) => {
      if (id === ge.rel.from || id === ge.rel.to) return true;
      if (horizontalSide) return !(v >= r.x - 2 && v <= r.x + r.w + 2 && r.y < hi && r.y + r.h > lo);
      return !(v >= r.y - 2 && v <= r.y + r.h + 2 && r.x < hi && r.x + r.w > lo);
    });
  };

  // 1. Straight candidates, tightest overlap first so they get their slot.
  const candidates = geoms
    .filter((ge) => ge.rel.from !== ge.rel.to)
    .map((ge) => {
      const horizontalSide = ge.fromSide === 'top' || ge.fromSide === 'bottom';
      const lo = horizontalSide ? Math.max(ge.from.x, ge.to.x) + sidePad : Math.max(ge.from.y, ge.to.y) + sidePad;
      const hi = horizontalSide ? Math.min(ge.from.x + ge.from.w, ge.to.x + ge.to.w) - sidePad : Math.min(ge.from.y + ge.from.h, ge.to.y + ge.to.h) - sidePad;
      const narrow = (horizontalSide ? ge.from.w <= ge.to.w : ge.from.h <= ge.to.h) ? ge.from : ge.to;
      const preferred = horizontalSide ? narrow.x + narrow.w / 2 : narrow.y + narrow.h / 2;
      return { ge, lo, hi, preferred: Math.min(hi, Math.max(lo, preferred)) };
    })
    .filter((c) => c.hi >= c.lo)
    .sort((c1, c2) => c1.hi - c1.lo - (c2.hi - c2.lo));
  for (const c of candidates) {
    const kf = portKey(c.ge.rel.from, c.ge.fromSide);
    const kt = portKey(c.ge.rel.to, c.ge.toSide);
    const ok = (v: number) => v >= c.lo && v <= c.hi && isFree(kf, v) && isFree(kt, v) && corridorFree(c.ge, v);
    let chosen: number | undefined;
    const stepOut = minGap / 2;
    for (let k = 0; chosen === undefined && k * stepOut <= c.hi - c.lo; k++) {
      for (const v of k === 0 ? [c.preferred] : [c.preferred + k * stepOut, c.preferred - k * stepOut]) {
        if (ok(v)) {
          chosen = v;
          break;
        }
      }
    }
    if (chosen === undefined) continue;
    const v = Math.round(chosen);
    c.ge.straight = true;
    c.ge.fromPort = portAt(c.ge.from, c.ge.fromSide, v);
    c.ge.toPort = portAt(c.ge.to, c.ge.toSide, v);
    take(kf, v);
    take(kt, v);
  }

  // 2. Spread the remaining edges into free slots, ordered by where they go.
  for (const [key, list] of portGroups) {
    const [id, side] = key.split('|') as [string, Side];
    const rest = list.filter((item) => !item.geom.straight);
    if (!rest.length) continue;
    const rect = rectOf(id);
    const horizontalSide = side === 'top' || side === 'bottom';
    rest.sort((p, q) => (horizontalSide ? p.other.x + p.other.w / 2 - (q.other.x + q.other.w / 2) : p.other.y + p.other.h / 2 - (q.other.y + q.other.h / 2)));
    const start = (horizontalSide ? rect.x : rect.y) + sidePad;
    const end = (horizontalSide ? rect.x + rect.w : rect.y + rect.h) - sidePad;
    const center = (start + end) / 2;
    const step = Math.max(minGap, Math.min(fs * 1.8, (end - start) / (rest.length + 1)));
    const slots: number[] = [];
    for (let k = 0; slots.length < rest.length && k * step <= (end - start) / 2 + step; k++) {
      for (const v of k === 0 ? [center] : [center + k * step, center - k * step]) {
        if (v >= start && v <= end && isFree(key, v) && !slots.some((sl) => Math.abs(sl - v) < minGap)) slots.push(v);
      }
    }
    if (slots.length < rest.length) {
      // Not enough room: fall back to even spacing across the side.
      slots.length = 0;
      const even = (end - start) / (rest.length + 1);
      for (let i = 0; i < rest.length; i++) slots.push(start + even * (i + 1));
    }
    slots.sort((p, q) => p - q);
    rest.forEach((item, i) => {
      const v = Math.round(slots[i]);
      take(key, v);
      const pt = portAt(rect, side, v);
      if (item.end === 'from') item.geom.fromPort = pt;
      else item.geom.toPort = pt;
    });
  }

  // Build point lists
  for (const ge of geoms) {
    if (ge.rel.from === ge.rel.to) {
      const r = ge.from;
      const y0 = r.y + r.h * 0.3;
      const y1 = r.y + r.h * 0.7;
      const out = 28;
      ge.fromPort = { x: r.x + r.w, y: y0 };
      ge.toPort = { x: r.x + r.w, y: y1 };
      ge.points = [ge.fromPort, { x: r.x + r.w + out, y: y0 }, { x: r.x + r.w + out, y: y1 }, ge.toPort];
      continue;
    }
    const idx = relations.indexOf(ge.rel);
    const forward = ge.rel.direction !== 'up';
    const dagreEdge = g.edge(L(forward ? ge.rel.from : ge.rel.to), L(forward ? ge.rel.to : ge.rel.from), `e${idx}`);
    let inner: Pt[] = dagreEdge?.points ? dagreEdge.points.slice(1, -1) : [];
    if (!forward) inner = inner.slice().reverse();
    // Only keep dummy points that lie clearly between the two nodes
    inner = inner.filter((p) => !inside(p, ge.from, 4) && !inside(p, ge.to, 4));
    // A straight edge has a verified clear corridor: no detours needed.
    if (ge.straight) inner = [];

    if (edgeStyle === 'orthogonal') {
      ge.points = orthogonal(ge.fromPort, ge.toPort, ge.fromSide, ge.toSide, inner, rankdir);
    } else {
      ge.points = [ge.fromPort, ...inner, ge.toPort];
    }
  }

  if (edgeStyle === 'orthogonal') staggerTracks();

  // Draw edges: compute the final line points first so crossings between
  // edges can be turned into jumps, then draw.
  for (const ge of geoms) prepareEdge(ge);
  if (settings.lineJumps && edgeStyle !== 'curved') computeJumps();
  for (const ge of geoms) drawEdge(ge);
  for (const r of anchored) {
    if (r.hidden) continue;
    const base = geoms.find((ge) => ge.rel.id === r.anchor);
    if (!base || base.points.length < 2) continue;
    const m = midpoint(base.linePts ?? base.points);
    const t = rectOf(r.to);
    const color = r.color && !isWord(r.color) ? r.color : palette.edge;
    let pts: Pt[];
    if (edgeStyle === 'orthogonal') {
      if (m.y >= t.y && m.y <= t.y + t.h) pts = [m, { x: m.x < t.x ? t.x : t.x + t.w, y: m.y }];
      else if (m.x >= t.x && m.x <= t.x + t.w) pts = [m, { x: m.x, y: m.y < t.y ? t.y : t.y + t.h }];
      else {
        const cx = t.x + t.w / 2;
        pts = [m, { x: cx, y: m.y }, { x: cx, y: m.y < t.y ? t.y : t.y + t.h }];
      }
    } else pts = [m, borderPoint(t, m)];
    const dash = r.line === 'dotted' ? '2 3' : r.line === 'solid' ? undefined : '6 4';
    gEdges.append(
      el('path', {
        d: pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)},${fmt(p.y)}`).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': 1.3,
        'stroke-dasharray': dash,
        'stroke-linejoin': 'round',
      }),
    );
    if (r.label) {
      const lm = midpoint(pts);
      drawLabel(r.label, lm.x, lm.y, 'middle', palette.edgeLabel);
    }
  }
  for (const ng of noteGeoms) {
    const a = center(ng.rect);
    const b = center(ng.target);
    const p0 = borderPoint(ng.rect, b);
    const p1 = borderPoint(ng.target, a);
    gEdges.append(el('path', { d: `M${p0.x},${p0.y} L${p1.x},${p1.y}`, stroke: palette.noteStroke, 'stroke-width': 1, 'stroke-dasharray': '3 3', fill: 'none' }));
  }

  // Draw nodes
  for (const b of boxes.values()) gNodes.append(drawClass(b, rectOf(b.cls.id)));
  for (const n of noteLayouts.values()) gNodes.append(drawNote(n, rectOf(n.note.id)));

  // Legend
  if (diagram.legend) {
    const lines = diagram.legend.split('\n').filter((l) => l.trim());
    const w = Math.max(...lines.map((l) => measurer.width(l, fs - 1))) + padX * 2;
    const h = lines.length * (fs + 4) + 12;
    const x = minX;
    const y = maxY + 16;
    const lg = el('g');
    lg.append(el('rect', { x, y, width: w, height: h, rx: 3, fill: palette.nodeFill, stroke: palette.nodeStroke }));
    lines.forEach((l, i) => lg.append(el('text', { x: x + padX, y: y + 6 + (i + 1) * (fs + 4) - 3, fill: palette.text, 'font-size': fs - 1 }, l)));
    root.append(lg);
    maxY = y + h;
  }

  // Normalise coordinates so the content starts at (margin, margin)
  const offX = -minX + margin;
  const offY = -minY + margin + titleH;
  root.setAttribute('transform', `translate(${offX},${offY})`);
  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2 + titleH;

  return {
    content: root,
    width,
    height,
    stats: { classes: boxes.size, relations: relations.length + anchored.length, notes: noteLayouts.size, groups: usedGroups.size },
  };

  // ==================================================================
  // Layout helpers
  // ==================================================================

  function formatParams(params: string | undefined): string {
    if (!params) return '';
    if (settings.params === 'none') return '…';
    if (settings.params === 'full') return params;
    return splitTopLevelAll(params, ',')
      .map((raw) => {
        const p = raw.trim();
        const colon = splitTopLevel(p, ':');
        if (colon) return settings.params === 'types' ? colon[1].trim() : colon[0].trim();
        const m = /^(.*\S)\s+([\w$]+)$/.exec(p);
        if (m) return settings.params === 'types' ? m[1] : m[2];
        return p;
      })
      .join(', ');
  }

  function typeColor(t: string): string {
    return /^(void|int|long|double|float|boolean|bool|char|byte|short|string|number|any|unit|none|null)(\[\])?$/i.test(t.trim()) ? palette.keywordType : palette.typeName;
  }

  function layoutClass(cls: ClassNode): BoxLayout {
    const nameText = cls.name;
    const genericsText = cls.generics ? `<${cls.generics}>` : undefined;
    const stereo: string[] = [];
    if (settings.showStereotypes) {
      if (diagram.hideCircle || !settings.showKindBadge) {
        if (cls.kind === 'interface') stereo.push('interface');
        else if (cls.kind === 'abstract') stereo.push('abstract');
        else if (cls.kind === 'enum') stereo.push('enumeration');
        else if (cls.kind === 'annotation') stereo.push('annotation');
      }
      stereo.push(...cls.stereotypes);
    }
    const stereoLine = stereo.length ? stereo.map((s) => `«${s}»`).join(' ') : undefined;

    const nameSize = fs + 3;
    const nameW = measurer.width(nameText, nameSize, true, cls.kind === 'abstract' || cls.kind === 'interface') + (genericsText ? measurer.width(genericsText, fs) + 2 : 0);
    const badgeW = settings.showKindBadge && !diagram.hideCircle ? badge + 8 : 0;
    let width = nameW + badgeW + padX * 2;
    if (stereoLine) width = Math.max(width, measurer.width(stereoLine, fs - 1) + padX * 2);

    let headerHeight = headerH;
    if (stereoLine) headerHeight += fs + 2;

    let members = cls.members;
    if (diagram.hideMembers) members = [];
    if (diagram.hideFields) members = members.filter((m) => m.kind !== 'field');
    if (diagram.hideMethods) members = members.filter((m) => m.kind !== 'method');

    let compartments: CompartmentLayout[] = [];
    const makeRows = (ms: Member[]): RowLayout[] =>
      ms.map((m) => {
        const params = m.kind === 'method' ? formatParams(m.params) : undefined;
        const type = settings.showTypes ? m.type : undefined;
        let leftW = symW + measurer.width(m.name, fs, false, m.isAbstract);
        if (m.kind === 'method') leftW += measurer.width('()', fs, true) + (params ? measurer.width(params, fs) : 0);
        let rightW = 0;
        if (type) {
          if (settings.typeAlign === 'right') rightW = measurer.width(type, fs);
          else leftW += measurer.width(`: ${type}`, fs);
        }
        return { member: m, name: m.name, params, type, leftW, rightW };
      });

    if (cls.compartments && cls.compartments.length) {
      compartments = cls.compartments
        .map((c) => ({ title: c.title, rows: makeRows(c.members.filter((m) => members.includes(m))), height: 0 }))
        .filter((c) => c.rows.length || c.title);
    } else if (settings.separateCompartments && cls.kind !== 'object' && !diagram.hideMembers) {
      // Standard UML notation: name / attributes / operations. Empty
      // compartments stay visible unless the source hides them.
      const fields = members.filter((m) => m.kind === 'field');
      const methods = members.filter((m) => m.kind === 'method');
      const showFields = !diagram.hideFields && (fields.length > 0 || !(diagram.hideEmptyMembers || diagram.hideEmptyFields));
      const showMethods = !diagram.hideMethods && (methods.length > 0 || !(diagram.hideEmptyMembers || diagram.hideEmptyMethods));
      if (showFields) compartments.push({ rows: makeRows(fields), height: 0 });
      if (showMethods) compartments.push({ rows: makeRows(methods), height: 0 });
    } else if (members.length) {
      compartments.push({ rows: makeRows(members), height: 0 });
    }
    let leftMax = 0;
    let rightMax = 0;
    for (const c of compartments) {
      c.height = c.rows.length ? c.rows.length * rowH + (settings.rowDividers ? 0 : 8) + (c.title ? fs + 4 : 0) : Math.round(rowH * 0.6) + (c.title ? fs + 4 : 0);
      for (const r of c.rows) {
        leftMax = Math.max(leftMax, r.leftW);
        rightMax = Math.max(rightMax, r.rightW);
      }
      if (c.title) width = Math.max(width, measurer.width(c.title, fs - 1) + padX * 2);
    }
    if (leftMax) width = Math.max(width, leftMax + (rightMax ? typeGap + rightMax : 0) + padX * 2);
    width = Math.max(Math.ceil(width), 90);
    const height = headerHeight + compartments.reduce((a, c) => a + c.height, 0);
    return { cls, width, height, headerHeight, stereoLine, nameText, genericsText, compartments };
  }

  function layoutNote(note: Note): NoteLayout {
    const lines: string[] = [];
    for (const raw of note.text.split('\n')) {
      const words = raw.split(/\s+/);
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (measurer.width(next, fs - 1) > 260 && cur) {
          lines.push(cur);
          cur = w;
        } else cur = next;
      }
      lines.push(cur);
    }
    if (!lines.length) lines.push('');
    const width = Math.max(...lines.map((l) => measurer.width(l, fs - 1))) + padX * 2 + 10;
    const height = lines.length * (fs + 5) + 14;
    return { note, lines, width, height };
  }

  // ==================================================================
  // Drawing helpers
  // ==================================================================

  function drawClass(b: BoxLayout, r: Rect): SVGGElement {
    const node = el('g', { class: 'node', 'data-id': b.cls.id });
    const rx = 4;
    if (palette.nodeShadow && !/rgba\([^)]*,\s*0\)$/.test(palette.nodeShadow)) {
      node.append(el('rect', { x: r.x + 1, y: r.y + 2, width: r.w, height: r.h, rx, fill: palette.nodeShadow }));
    }
    const stroke = b.cls.color && !isWord(b.cls.color) ? b.cls.color : palette.nodeStroke;
    node.append(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx, fill: palette.nodeFill, stroke, 'stroke-width': 1 }));
    // Header background
    node.append(
      el('path', {
        d: roundedTop(r.x, r.y, r.w, b.headerHeight, rx),
        fill: palette.nodeHeaderFill,
        stroke: 'none',
      }),
    );
    node.append(el('line', { x1: r.x, y1: r.y + b.headerHeight, x2: r.x + r.w, y2: r.y + b.headerHeight, stroke, 'stroke-width': 1 }));

    // Header content
    let hy = r.y;
    if (b.stereoLine) {
      node.append(el('text', { x: r.x + r.w / 2, y: hy + fs + 3, 'text-anchor': 'middle', fill: palette.textMuted, 'font-size': fs - 1 }, b.stereoLine));
      hy += fs + 2;
    }
    const nameSize = fs + 3;
    const italic = b.cls.kind === 'abstract' || b.cls.kind === 'interface';
    const nameW = measurer.width(b.nameText, nameSize, true, italic);
    const genW = b.genericsText ? measurer.width(b.genericsText, fs) + 2 : 0;
    const showBadge = settings.showKindBadge && !diagram.hideCircle;
    const badgeW = showBadge ? badge + 8 : 0;
    const total = badgeW + nameW + genW;
    let x = r.x + (r.w - total) / 2;
    const cy = Math.round(hy + headerH / 2);
    if (showBadge) {
      const color = b.cls.spot?.color && !isWord(b.cls.spot.color) ? b.cls.spot.color : kindColor(b.cls.kind, palette);
      const letter = b.cls.spot?.letter ?? KIND_LETTER[b.cls.kind];
      node.append(el('circle', { cx: x + badge / 2, cy, r: badge / 2, fill: color }));
      node.append(
        el('text', { x: x + badge / 2, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: palette.kindText, 'font-size': fs - 1, 'font-weight': 700 }, letter),
      );
      x += badgeW;
    }
    const name = el('text', { x, y: cy, 'dominant-baseline': 'central', fill: palette.text, 'font-size': nameSize, 'font-weight': 600, 'font-style': italic ? 'italic' : undefined });
    name.append(b.nameText);
    if (b.genericsText) name.append(el('tspan', { fill: palette.textMuted, 'font-weight': 400, 'font-size': fs, 'font-style': 'normal' }, ' ' + b.genericsText.trim()));
    node.append(name);
    if (b.cls.kind === 'object') {
      // Object names are underlined by UML convention
      name.setAttribute('text-decoration', 'underline');
    }

    // Compartments
    let y = r.y + b.headerHeight;
    b.compartments.forEach((c, ci) => {
      if (ci > 0) node.append(el('line', { x1: r.x, y1: y, x2: r.x + r.w, y2: y, stroke: palette.separator, 'stroke-width': 1 }));
      let ry = y + (settings.rowDividers ? 0 : 4);
      if (c.title) {
        node.append(el('text', { x: r.x + r.w / 2, y: ry + fs, 'text-anchor': 'middle', fill: palette.textMuted, 'font-size': fs - 1, 'font-style': 'italic' }, c.title));
        ry += fs + 4;
      }
      c.rows.forEach((row, ri) => {
        const m = row.member;
        if (settings.rowDividers && (ri > 0 || c.title)) {
          node.append(el('line', { x1: r.x, y1: ry, x2: r.x + r.w, y2: ry, stroke: palette.rowDivider, 'stroke-width': 1 }));
        }
        const rowCy = Math.round(ry + rowH / 2);
        let tx = r.x + padX;
        if (settings.showMemberKind) {
          node.append(kindIcon(m.kind, tx + iconD / 2, rowCy, iconD, palette, fs));
          tx += iconD + 7;
        }
        if (settings.visibility === 'icons') {
          node.append(visibilityIcon(m.visibility, tx + lockW / 2, rowCy, lockW, palette));
          tx += lockW + 8;
        } else if (settings.visibility !== 'text') {
          node.append(visibilitySymbol(m.visibility, tx + symSize / 2, rowCy));
          tx += symSize + 8;
        }
        if (settings.visibility === 'text' || settings.visibility === 'both') {
          const ch = VIS_CHAR[m.visibility] || ' ';
          node.append(
            el('text', { x: tx, y: rowCy, 'dominant-baseline': 'central', fill: palette.vis[m.visibility], 'font-size': fs, 'font-weight': 700, 'font-family': FONT_STACKS.mono }, ch),
          );
          tx += measurer.width('+', fs) + (settings.visibility === 'both' ? 4 : 6);
        }
        const t = el('text', {
          x: tx,
          y: rowCy,
          'dominant-baseline': 'central',
          fill: palette.memberName,
          'font-size': fs,
          'font-style': m.isAbstract ? 'italic' : undefined,
          'text-decoration': m.isStatic ? 'underline' : undefined,
        });
        t.append(row.name);
        if (m.kind === 'method') {
          t.append(el('tspan', { fill: palette.text, 'font-weight': 600, 'text-decoration': 'none' }, '('));
          if (row.params) t.append(el('tspan', { fill: palette.textMuted, 'text-decoration': 'none' }, row.params));
          t.append(el('tspan', { fill: palette.text, 'font-weight': 600, 'text-decoration': 'none' }, ')'));
        }
        if (row.type && settings.typeAlign === 'inline') t.append(el('tspan', { fill: typeColor(row.type), 'text-decoration': 'none' }, `: ${row.type}`));
        node.append(t);
        if (row.type && settings.typeAlign === 'right') {
          node.append(el('text', { x: r.x + r.w - padX, y: rowCy, 'dominant-baseline': 'central', 'text-anchor': 'end', fill: typeColor(row.type), 'font-size': fs }, row.type));
        }
        ry += rowH;
      });
      y += c.height;
    });
    return node;
  }

  function visibilitySymbol(v: Visibility, cx: number, cy: number): SVGElement {
    const s = symSize / 2;
    const color = palette.vis[v];
    switch (v) {
      case 'public':
        return el('circle', { cx, cy, r: s, fill: color });
      case 'private':
        return el('rect', { x: cx - s + 0.5, y: cy - s + 0.5, width: s * 2 - 1, height: s * 2 - 1, rx: 1, fill: color });
      case 'protected':
        return el('path', { d: `M${cx},${cy - s - 1} L${cx + s + 1},${cy} L${cx},${cy + s + 1} L${cx - s - 1},${cy} Z`, fill: color });
      case 'package':
        return el('path', { d: `M${cx},${cy - s} L${cx + s + 0.5},${cy + s - 0.5} L${cx - s - 0.5},${cy + s - 0.5} Z`, fill: color });
      default:
        return el('circle', { cx, cy, r: s - 1.5, fill: 'none', stroke: color, 'stroke-width': 1.2 });
    }
  }

  function drawNote(n: NoteLayout, r: Rect): SVGGElement {
    const node = el('g', { class: 'note' });
    const fold = 10;
    const fill = n.note.color && !isWord(n.note.color) ? n.note.color : palette.noteFill;
    node.append(
      el('path', {
        d: `M${r.x},${r.y} H${r.x + r.w - fold} L${r.x + r.w},${r.y + fold} V${r.y + r.h} H${r.x} Z`,
        fill,
        stroke: palette.noteStroke,
        'stroke-width': 1,
      }),
      el('path', { d: `M${r.x + r.w - fold},${r.y} V${r.y + fold} H${r.x + r.w}`, fill: 'none', stroke: palette.noteStroke, 'stroke-width': 1 }),
    );
    n.lines.forEach((l, i) => {
      node.append(el('text', { x: r.x + padX, y: r.y + 8 + (i + 1) * (fs + 5) - 4, fill: palette.noteText, 'font-size': fs - 1 }, l));
    });
    return node;
  }

  /**
   * Orthogonal routes put their cross segment in the middle of the gap between
   * two rows, so several edges end up collinear and merge into one line. Spread
   * overlapping cross segments onto separate tracks inside that gap.
   */
  function staggerTracks(): void {
    const vertical = rankdir === 'TB'; // cross segments are horizontal in TB layouts
    interface Seg {
      ge: EdgeGeom;
      i: number; // index of the segment start point
      pos: number; // current cross-axis coordinate (y in TB)
      lo: number; // free range along the cross axis
      hi: number;
      a: number; // extent along the main axis (x in TB)
      b: number;
    }
    const segs: Seg[] = [];
    const margin = Math.max(6, fs * 0.5);
    for (const ge of geoms) {
      const p = ge.points;
      if (ge.rel.from === ge.rel.to || p.length < 4) continue;
      for (let i = 1; i < p.length - 2; i++) {
        const cross = vertical ? Math.abs(p[i].y - p[i + 1].y) < 0.01 : Math.abs(p[i].x - p[i + 1].x) < 0.01;
        if (!cross) continue;
        const before = vertical ? p[i - 1].y : p[i - 1].x;
        const after = vertical ? p[i + 2].y : p[i + 2].x;
        const lo = Math.min(before, after) + margin;
        const hi = Math.max(before, after) - margin;
        if (hi - lo < 2) continue;
        const a = vertical ? Math.min(p[i].x, p[i + 1].x) : Math.min(p[i].y, p[i + 1].y);
        const b = vertical ? Math.max(p[i].x, p[i + 1].x) : Math.max(p[i].y, p[i + 1].y);
        segs.push({ ge, i, pos: vertical ? p[i].y : p[i].x, lo, hi, a, b });
      }
    }
    if (segs.length < 2) return;

    // Cluster segments that share a gap (their free ranges overlap).
    segs.sort((s1, s2) => s1.pos - s2.pos);
    const clusters: { lo: number; hi: number; segs: Seg[] }[] = [];
    for (const sg of segs) {
      const c = clusters[clusters.length - 1];
      if (c && Math.min(c.hi, sg.hi) - Math.max(c.lo, sg.lo) > fs) {
        c.lo = Math.max(c.lo, sg.lo);
        c.hi = Math.min(c.hi, sg.hi);
        c.segs.push(sg);
      } else clusters.push({ lo: sg.lo, hi: sg.hi, segs: [sg] });
    }

    for (const c of clusters) {
      if (c.segs.length < 2) continue;
      // Greedy interval colouring: segments that overlap along the main axis
      // get different tracks; disjoint ones may share a track.
      const pad = fs * 0.9;
      const ordered = c.segs.slice().sort((s1, s2) => s1.a - s2.a || s2.b - s1.b);
      const trackEnd: number[] = [];
      const trackOf = new Map<Seg, number>();
      for (const sg of ordered) {
        let t = trackEnd.findIndex((end) => end + pad <= sg.a);
        if (t < 0) {
          t = trackEnd.length;
          trackEnd.push(sg.b);
        } else trackEnd[t] = sg.b;
        trackOf.set(sg, t);
      }
      const n = trackEnd.length;
      if (n < 2) continue;
      const mid = (c.lo + c.hi) / 2;
      const spacing = Math.min((c.hi - c.lo) / n, fs * 1.1);
      for (const sg of c.segs) {
        const t = trackOf.get(sg)!;
        const pos = Math.round(mid + (t - (n - 1) / 2) * spacing);
        const p = sg.ge.points;
        if (vertical) {
          p[sg.i].y = pos;
          p[sg.i + 1].y = pos;
        } else {
          p[sg.i].x = pos;
          p[sg.i + 1].x = pos;
        }
      }
    }
  }

  function headLen(h: HeadKind): number {
    return h === 'triangle' ? fs * 1.05 : h === 'composition' || h === 'aggregation' ? fs * 1.25 : h === 'square' || h === 'circle' ? fs * 0.7 : 0;
  }

  function prepareEdge(ge: EdgeGeom): void {
    const pts = ge.points;
    if (pts.length < 2) return;
    // Shorten the line for heads that have a base (triangle/diamond)
    const startDir = unit(pts[0], pts[1]);
    const endDir = unit(pts[pts.length - 1], pts[pts.length - 2]);
    const fromHeadLen = headLen(ge.rel.fromHead);
    const toHeadLen = headLen(ge.rel.toHead);
    const lineStart = { x: pts[0].x + startDir.x * fromHeadLen, y: pts[0].y + startDir.y * fromHeadLen };
    const lineEnd = { x: pts[pts.length - 1].x + endDir.x * toHeadLen, y: pts[pts.length - 1].y + endDir.y * toHeadLen };
    ge.linePts = [lineStart, ...pts.slice(1, -1), lineEnd];
  }

  /** Finds crossings between all edge segments; the more horizontal line jumps. */
  function computeJumps(): void {
    const eps = 0.5;
    for (let i = 0; i < geoms.length; i++) {
      const A = geoms[i].linePts;
      if (!A) continue;
      for (let j = i + 1; j < geoms.length; j++) {
        const B = geoms[j].linePts;
        if (!B) continue;
        for (let si = 0; si < A.length - 1; si++) {
          const a0 = A[si];
          const a1 = A[si + 1];
          for (let sj = 0; sj < B.length - 1; sj++) {
            const b0 = B[sj];
            const b1 = B[sj + 1];
            const hit = segmentIntersection(a0, a1, b0, b1);
            if (!hit) continue;
            const lenA = Math.hypot(a1.x - a0.x, a1.y - a0.y);
            const lenB = Math.hypot(b1.x - b0.x, b1.y - b0.y);
            const dA = hit.t * lenA;
            const dB = hit.u * lenB;
            // Ignore touching at the very ends (shared ports, junctions).
            if (dA < eps || lenA - dA < eps || dB < eps || lenB - dB < eps) continue;
            const horizA = Math.abs(a1.y - a0.y) / (lenA || 1);
            const horizB = Math.abs(b1.y - b0.y) / (lenB || 1);
            const jumper = horizA <= horizB ? geoms[i] : geoms[j];
            const seg = horizA <= horizB ? si : sj;
            const dist = horizA <= horizB ? dA : dB;
            jumper.jumps ??= new Map();
            const list = jumper.jumps.get(seg) ?? [];
            list.push(dist);
            jumper.jumps.set(seg, list);
          }
        }
      }
    }
  }

  /** Polyline path with semicircular hops at the recorded crossings. */
  function jumpPath(pts: Pt[], jumps: Map<number, number[]> | undefined): string {
    const r = Math.max(4, fs * 0.42);
    let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const list = jumps?.get(i);
      if (!list || !len) {
        d += ` L${fmt(b.x)},${fmt(b.y)}`;
        continue;
      }
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // Bulge upwards for horizontal lines, to the right for vertical ones.
      const n1 = { x: dir.y, y: -dir.x };
      const sweep = Math.abs(n1.y) > 1e-6 ? (n1.y < 0 ? 1 : 0) : n1.x > 0 ? 1 : 0;
      const sorted = list.slice().sort((p, q) => p - q);
      // Merge crossings that are too close for separate hops.
      const groups: [number, number][] = [];
      for (const c of sorted) {
        const g2 = groups[groups.length - 1];
        if (g2 && c - g2[1] < r * 2.2) g2[1] = c;
        else groups.push([c, c]);
      }
      for (const [s0, s1] of groups) {
        const start = s0 - r;
        const end = s1 + r;
        if (start < 1 || end > len - 1) continue; // too close to a corner: draw straight
        const p0 = { x: a.x + dir.x * start, y: a.y + dir.y * start };
        const p1 = { x: a.x + dir.x * end, y: a.y + dir.y * end };
        d += ` L${fmt(p0.x)},${fmt(p0.y)} A${fmt((end - start) / 2)},${fmt(r)} 0 0 ${sweep} ${fmt(p1.x)},${fmt(p1.y)}`;
      }
      d += ` L${fmt(b.x)},${fmt(b.y)}`;
    }
    return d;
  }

  function drawEdge(ge: EdgeGeom): void {
    const r = ge.rel;
    const color = r.color && !isWord(r.color) ? r.color : palette.edge;
    const pts = ge.points;
    const linePts = ge.linePts;
    if (pts.length < 2 || !linePts) return;
    const startDir = unit(pts[0], pts[1]); // pointing away from source
    const endDir = unit(pts[pts.length - 1], pts[pts.length - 2]); // pointing away from target

    let d: string;
    if (edgeStyle === 'curved' && linePts.length > 2) d = smoothPath(linePts);
    else d = jumpPath(linePts, ge.jumps);

    const dash = r.line === 'dashed' ? '6 4' : r.line === 'dotted' ? '2 3' : undefined;
    const width = r.line === 'bold' ? 2.2 : 1.3;
    const edge = el('g', { class: 'edge' });
    edge.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }));
    edge.append(drawHead(r.fromHead, pts[0], startDir, color));
    edge.append(drawHead(r.toHead, pts[pts.length - 1], endDir, color));
    gEdges.append(edge);

    // Labels
    if (r.label) {
      const mid = midpoint(pts);
      drawLabel(r.label, mid.x, mid.y, 'middle', palette.edgeLabel);
    }
    if (r.fromLabel) {
      const p = offsetAlong(pts[0], startDir, fs * 1.3, ge.fromSide);
      drawLabel(r.fromLabel, p.x, p.y, p.anchor, palette.edgeLabel);
    }
    if (r.toLabel) {
      const p = offsetAlong(pts[pts.length - 1], endDir, fs * 1.3, ge.toSide);
      drawLabel(r.toLabel, p.x, p.y, p.anchor, palette.edgeLabel);
    }
  }

  function offsetAlong(p: Pt, dir: Pt, dist: number, side: Side): { x: number; y: number; anchor: string } {
    // Place cardinality beside the line, just outside the node
    const base = { x: p.x + dir.x * dist, y: p.y + dir.y * dist };
    if (side === 'top' || side === 'bottom') return { x: base.x + 6, y: base.y + fs * 0.35, anchor: 'start' };
    return { x: base.x, y: base.y - 6, anchor: 'middle' };
  }

  function drawLabel(text: string, x: number, y: number, anchor: string, color: string): void {
    const lines = text.split('\n');
    const size = fs - 1;
    const w = Math.max(...lines.map((l) => measurer.width(l, size))) + 8;
    const h = lines.length * (size + 3) + 4;
    const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x - 4;
    const top = y - h / 2 - (anchor === 'middle' ? 0 : size * 0.35);
    const lg = el('g', { class: 'edge-label' });
    lg.append(el('rect', { x: left, y: top, width: w, height: h, rx: 2, fill: palette.canvas, 'fill-opacity': 0.92 }));
    const t = el('text', { x: left + w / 2, y: top + size + 2, 'text-anchor': 'middle', fill: color, 'font-size': size });
    lines.forEach((l, i) => t.append(el('tspan', { x: left + w / 2, dy: i === 0 ? 0 : size + 3 }, l)));
    lg.append(t);
    gLabels.append(lg);
  }

  function drawHead(kind: HeadKind, tip: Pt, dir: Pt, color: string): SVGElement {
    // dir points from the tip back along the line (away from the node)
    const g2 = el('g');
    if (kind === 'none') return g2;
    const nx = -dir.y;
    const ny = dir.x;
    const L = (k: number) => ({ x: tip.x + dir.x * k, y: tip.y + dir.y * k });
    const P = (k: number, s: number) => {
      const b = L(k);
      return { x: b.x + nx * s, y: b.y + ny * s };
    };
    const poly = (pts: Pt[], fill: string) => el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)},${fmt(p.y)}`).join(' ') + ' Z', fill, stroke: color, 'stroke-width': 1.3, 'stroke-linejoin': 'round' });
    switch (kind) {
      case 'triangle': {
        const len = fs * 1.05;
        const half = fs * 0.6;
        g2.append(poly([tip, P(len, half), P(len, -half)], palette.nodeFill));
        break;
      }
      case 'arrow': {
        const len = fs * 0.85;
        const half = fs * 0.42;
        const a = P(len, half);
        const b = P(len, -half);
        g2.append(el('path', { d: `M${fmt(a.x)},${fmt(a.y)} L${fmt(tip.x)},${fmt(tip.y)} L${fmt(b.x)},${fmt(b.y)}`, fill: 'none', stroke: color, 'stroke-width': 1.3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        break;
      }
      case 'composition':
      case 'aggregation': {
        const len = fs * 1.25;
        const half = fs * 0.42;
        g2.append(poly([tip, P(len / 2, half), L(len), P(len / 2, -half)], kind === 'composition' ? color : palette.nodeFill));
        break;
      }
      case 'cross': {
        const k = fs * 0.5;
        const c = L(k);
        g2.append(
          el('path', {
            d: `M${fmt(c.x - k * 0.5)},${fmt(c.y - k * 0.5)} L${fmt(c.x + k * 0.5)},${fmt(c.y + k * 0.5)} M${fmt(c.x + k * 0.5)},${fmt(c.y - k * 0.5)} L${fmt(c.x - k * 0.5)},${fmt(c.y + k * 0.5)}`,
            stroke: color,
            'stroke-width': 1.3,
          }),
        );
        break;
      }
      case 'crowfoot': {
        const len = fs * 0.9;
        const half = fs * 0.5;
        const b = L(len);
        const a1 = P(0, half);
        const a2 = P(0, -half);
        g2.append(el('path', { d: `M${fmt(a1.x)},${fmt(a1.y)} L${fmt(b.x)},${fmt(b.y)} L${fmt(a2.x)},${fmt(a2.y)} M${fmt(tip.x)},${fmt(tip.y)} L${fmt(b.x)},${fmt(b.y)}`, fill: 'none', stroke: color, 'stroke-width': 1.3 }));
        break;
      }
      case 'square': {
        const s = fs * 0.35;
        const c = L(s);
        g2.append(el('rect', { x: c.x - s, y: c.y - s, width: s * 2, height: s * 2, fill: palette.nodeFill, stroke: color, 'stroke-width': 1.3, transform: `rotate(${(Math.atan2(dir.y, dir.x) * 180) / Math.PI} ${fmt(c.x)} ${fmt(c.y)})` }));
        break;
      }
      case 'circle': {
        const s = fs * 0.35;
        const c = L(s);
        g2.append(el('circle', { cx: c.x, cy: c.y, r: s, fill: palette.nodeFill, stroke: color, 'stroke-width': 1.3 }));
        break;
      }
      case 'nest': {
        const s = fs * 0.4;
        const c = L(s);
        g2.append(el('circle', { cx: c.x, cy: c.y, r: s, fill: palette.nodeFill, stroke: color, 'stroke-width': 1.3 }));
        g2.append(el('path', { d: `M${fmt(c.x - s)},${fmt(c.y)} H${fmt(c.x + s)} M${fmt(c.x)},${fmt(c.y - s)} V${fmt(c.y + s)}`, stroke: color, 'stroke-width': 1.3 }));
        break;
      }
    }
    return g2;
  }
}

// ======================================================================
// Icons (shared with the legend)
// ======================================================================

/** Padlock-style visibility icon: open = public, closed = private, keyhole = protected, ring = package. */
export function visibilityIcon(v: Visibility, cx: number, cy: number, size: number, palette: Palette): SVGElement {
  const color = palette.vis[v];
  const g2 = el('g');
  if (v === 'none') return g2;
  if (v === 'package') {
    g2.append(el('circle', { cx: fmt(cx), cy: fmt(cy), r: fmt(size * 0.27), fill: 'none', stroke: color, 'stroke-width': fmt(size * 0.13) }));
    return g2;
  }
  // Geometry in a box of `size` height centred on (cx, cy):
  //   shackle occupies the top 45%, body the bottom 50%.
  const bodyW = size * 0.8;
  const bodyH = size * 0.5;
  const bodyTop = cy + size * 0.5 - bodyH;
  const stroke = size * 0.13;
  const r = size * 0.21; // shackle outer radius (to stroke centre)
  const arcCy = bodyTop - size * 0.24; // centre of the shackle arc
  const rx = size * 0.1;

  g2.append(el('rect', { x: fmt(cx - bodyW / 2), y: fmt(bodyTop), width: fmt(bodyW), height: fmt(bodyH), rx: fmt(rx), fill: color }));

  const shackle = (dx: number, leftLegEnd: number, rightLegEnd: number) =>
    el('path', {
      d: `M${fmt(cx + dx - r)},${fmt(leftLegEnd)} V${fmt(arcCy)} A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(cx + dx + r)},${fmt(arcCy)} V${fmt(rightLegEnd)}`,
      fill: 'none',
      stroke: color,
      'stroke-width': fmt(stroke),
      'stroke-linecap': 'round',
    });

  if (v === 'public') {
    // Open: the shackle is shifted right and its left leg is lifted clear of the body.
    g2.append(shackle(size * 0.14, bodyTop - size * 0.14, bodyTop + stroke));
  } else {
    g2.append(shackle(0, bodyTop + stroke, bodyTop + stroke));
    if (v === 'protected') {
      // Keyhole
      const kc = bodyTop + bodyH * 0.42;
      g2.append(el('circle', { cx: fmt(cx), cy: fmt(kc), r: fmt(size * 0.09), fill: palette.nodeFill }));
      g2.append(el('rect', { x: fmt(cx - size * 0.045), y: fmt(kc), width: fmt(size * 0.09), height: fmt(bodyH * 0.38), fill: palette.nodeFill }));
    }
  }
  return g2;
}

/** Circled letter: m for methods, f for fields. */
export function kindIcon(kind: Member['kind'], cx: number, cy: number, size: number, palette: Palette, _fontSize: number): SVGElement {
  const color = kind === 'method' ? palette.methodIcon : palette.fieldIcon;
  const g2 = el('g');
  g2.append(el('circle', { cx: fmt(cx), cy: fmt(cy), r: fmt(size / 2 - 0.6), fill: 'none', stroke: color, 'stroke-width': 1.2 }));
  g2.append(
    el(
      'text',
      {
        x: fmt(cx),
        y: fmt(cy),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: color,
        'font-size': fmt(size * 0.72),
        'font-weight': 600,
        'font-family': FONT_STACKS.sans,
      },
      kind === 'method' ? 'm' : 'f',
    ),
  );
  return g2;
}

function splitTopLevel(s: string, sep: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    else if (c === sep && depth <= 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return null;
}

function splitTopLevelAll(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    else if (c === sep && depth <= 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.filter((p) => p.trim());
}

// ======================================================================
// Geometry utilities
// ======================================================================

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function isWord(color: string): boolean {
  // PlantUML allows named colours like #red; pass those straight through.
  return /^#?[a-zA-Z]+$/.test(color) ? false : !/^#[0-9a-fA-F]{3,8}$/.test(color);
}

function center(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function inside(p: Pt, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Intersection of the segment from the rect centre toward `toward` with the rect border. */
function borderPoint(r: Rect, toward: Pt): Pt {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = r.w / 2 / Math.abs(dx || 1e-9);
  const sy = r.h / 2 / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Proper intersection of segments p0-p1 and q0-q1, as parameters t (on p) and u (on q). */
function segmentIntersection(p0: Pt, p1: Pt, q0: Pt, q1: Pt): { t: number; u: number } | null {
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel or collinear
  const qx = q0.x - p0.x;
  const qy = q0.y - p0.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

function midpoint(pts: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg) {
      const t = seg ? half / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= seg;
  }
  return pts[pts.length - 1];
}

function smoothPath(pts: Pt[]): string {
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    const mx = (p.x + next.x) / 2;
    const my = (p.y + next.y) / 2;
    d += ` Q${fmt(p.x)},${fmt(p.y)} ${fmt(mx)},${fmt(my)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${fmt(last.x)},${fmt(last.y)}`;
  return d;
}

type SideT = 'top' | 'bottom' | 'left' | 'right';

/** Builds an axis-aligned route from `a` to `b` through the given waypoints. */
function orthogonal(a: Pt, b: Pt, aSide: SideT, bSide: SideT, inner: Pt[], rankdir: 'TB' | 'LR'): Pt[] {
  const verticalExit = aSide === 'top' || aSide === 'bottom';
  const verticalEnter = bSide === 'top' || bSide === 'bottom';
  const pts: Pt[] = [a];

  if (verticalExit && verticalEnter) {
    // Staircase through inner points: vertical, horizontal, vertical ...
    const way = [...inner, b];
    let cur = a;
    for (let i = 0; i < way.length; i++) {
      const next = way[i];
      if (Math.abs(next.x - cur.x) > 0.5) {
        const midY = i === way.length - 1 && inner.length === 0 ? (cur.y + next.y) / 2 : i === way.length - 1 ? (cur.y + next.y) / 2 : (cur.y + next.y) / 2;
        pts.push({ x: cur.x, y: midY }, { x: next.x, y: midY });
      }
      pts.push(next);
      cur = next;
    }
  } else if (!verticalExit && !verticalEnter) {
    const way = [...inner, b];
    let cur = a;
    for (let i = 0; i < way.length; i++) {
      const next = way[i];
      if (Math.abs(next.y - cur.y) > 0.5) {
        const midX = (cur.x + next.x) / 2;
        pts.push({ x: midX, y: cur.y }, { x: midX, y: next.y });
      }
      pts.push(next);
      cur = next;
    }
  } else if (verticalExit) {
    // Exit vertically, enter horizontally: one bend
    pts.push({ x: a.x, y: b.y }, b);
  } else {
    pts.push({ x: b.x, y: a.y }, b);
  }
  void rankdir;
  return simplify(pts);
}

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.01 && Math.abs(prev.y - p.y) < 0.01) continue;
    out.push({ ...p });
  }
  // Remove collinear middle points
  for (let i = 1; i < out.length - 1; ) {
    const p = out[i - 1];
    const q = out[i];
    const r = out[i + 1];
    const collinear = (Math.abs(p.x - q.x) < 0.01 && Math.abs(q.x - r.x) < 0.01) || (Math.abs(p.y - q.y) < 0.01 && Math.abs(q.y - r.y) < 0.01);
    if (collinear) out.splice(i, 1);
    else i++;
  }
  return out;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h} Z`;
}
