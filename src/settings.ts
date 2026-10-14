export type ThemeName = 'intellij' | 'light' | 'dark' | 'darcula' | 'contrast' | 'sepia';
export type RendererMode = 'auto' | 'native' | 'server';
export type EdgeStyle = 'orthogonal' | 'straight' | 'curved';
export type VisibilityStyle = 'icons' | 'symbols' | 'text' | 'both';
export type ParamStyle = 'full' | 'types' | 'names' | 'none';
export type TypeAlign = 'right' | 'inline';
export type LayoutDir = 'auto' | 'TB' | 'LR';
export type Spacing = 'compact' | 'normal' | 'relaxed';
export type FontFamily = 'sans' | 'mono';

export interface Settings {
  theme: ThemeName;
  renderer: RendererMode;
  edgeStyle: EdgeStyle;
  lineJumps: boolean;
  visibility: VisibilityStyle;
  layout: LayoutDir;
  spacing: Spacing;
  font: FontFamily;
  fontSize: number;
  showTypes: boolean;
  params: ParamStyle;
  typeAlign: TypeAlign;
  showMemberKind: boolean;
  rowDividers: boolean;
  showKindBadge: boolean;
  showStereotypes: boolean;
  separateCompartments: boolean;
  plantumlServer: string;
  editorWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'intellij',
  renderer: 'auto',
  edgeStyle: 'orthogonal',
  lineJumps: true,
  visibility: 'icons',
  layout: 'auto',
  spacing: 'normal',
  font: 'sans',
  fontSize: 13,
  showTypes: true,
  params: 'types',
  typeAlign: 'right',
  showMemberKind: true,
  rowDividers: true,
  showKindBadge: true,
  showStereotypes: true,
  separateCompartments: true,
  plantumlServer: 'https://www.plantuml.com/plantuml',
  editorWidth: 42,
};

const KEY = 'uml-viewer.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings> & { showParams?: boolean };
      if (parsed.showParams !== undefined && parsed.params === undefined) parsed.params = parsed.showParams ? 'full' : 'none';
      delete parsed.showParams;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Colours used by the diagram renderer, resolved per theme so exports are self-contained. */
export interface Palette {
  canvas: string;
  grid: string;
  nodeFill: string;
  nodeHeaderFill: string;
  nodeStroke: string;
  nodeShadow: string;
  text: string;
  textMuted: string;
  separator: string;
  edge: string;
  edgeLabel: string;
  groupFill: string;
  groupStroke: string;
  groupText: string;
  noteFill: string;
  noteStroke: string;
  noteText: string;
  vis: { public: string; private: string; protected: string; package: string; none: string };
  memberName: string;
  typeName: string;
  keywordType: string;
  methodIcon: string;
  fieldIcon: string;
  rowDivider: string;
  kind: {
    class: string;
    abstract: string;
    interface: string;
    enum: string;
    annotation: string;
    entity: string;
    other: string;
  };
  kindText: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  intellij: {
    canvas: '#1e1f22',
    grid: '#2b2d31',
    nodeFill: '#2b2d30',
    nodeHeaderFill: '#2b2d30',
    nodeStroke: '#4e5157',
    nodeShadow: 'rgba(0,0,0,0.45)',
    text: '#bcbec4',
    textMuted: '#8c8f98',
    separator: '#4e5157',
    edge: '#a8abb3',
    edgeLabel: '#bcbec4',
    groupFill: 'rgba(255,255,255,0.025)',
    groupStroke: '#4e5157',
    groupText: '#bcbec4',
    noteFill: '#3a3826',
    noteStroke: '#8f7f2a',
    noteText: '#d9d2a3',
    vis: { public: '#5fb865', private: '#e8646a', protected: '#d9a343', package: '#8c8f98', none: '#6f737a' },
    memberName: '#56a8f5',
    typeName: '#bcbec4',
    keywordType: '#cf8e6d',
    methodIcon: '#e8646a',
    fieldIcon: '#b58cf0',
    rowDivider: '#3d3f44',
    kind: {
      class: '#3574f0',
      abstract: '#8a5cf5',
      interface: '#5fb865',
      enum: '#d9a343',
      annotation: '#d9a343',
      entity: '#3fa7a2',
      other: '#8c8f98',
    },
    kindText: '#ffffff',
  },
  light: {
    canvas: '#f7f8fa',
    grid: '#e6e8ec',
    nodeFill: '#ffffff',
    nodeHeaderFill: '#f3f5f8',
    nodeStroke: '#aab2bf',
    nodeShadow: 'rgba(15, 23, 42, 0.08)',
    text: '#1f2328',
    textMuted: '#6b7280',
    separator: '#d9dee6',
    edge: '#4b5563',
    edgeLabel: '#374151',
    groupFill: 'rgba(99, 110, 130, 0.06)',
    groupStroke: '#b8c0cc',
    groupText: '#4b5563',
    noteFill: '#fff8c5',
    noteStroke: '#d4b106',
    noteText: '#3b3b1f',
    vis: { public: '#3fa552', private: '#d64545', protected: '#d9a400', package: '#3b7dd8', none: '#9ca3af' },
    kind: {
      class: '#3b82c4',
      abstract: '#7c6bc4',
      interface: '#3fa552',
      enum: '#d08a1f',
      annotation: '#b58a1a',
      entity: '#4b8f8c',
      other: '#6b7280',
    },
    memberName: '#2f6fd0',
    typeName: '#6b7280',
    keywordType: '#c2410c',
    methodIcon: '#d64545',
    fieldIcon: '#7c3aed',
    rowDivider: 'rgba(15, 23, 42, 0.07)',
    kindText: '#ffffff',
  },
  dark: {
    canvas: '#1e2024',
    grid: '#2a2d33',
    nodeFill: '#2b2e34',
    nodeHeaderFill: '#33373e',
    nodeStroke: '#4b515b',
    nodeShadow: 'rgba(0,0,0,0.35)',
    text: '#e5e7eb',
    textMuted: '#9aa3af',
    separator: '#3f444d',
    edge: '#b4bbc6',
    edgeLabel: '#d1d5db',
    groupFill: 'rgba(255,255,255,0.03)',
    groupStroke: '#4b515b',
    groupText: '#b4bbc6',
    noteFill: '#3b3a2a',
    noteStroke: '#9c8a2a',
    noteText: '#e8e2b8',
    vis: { public: '#5fbf6f', private: '#ef6b6b', protected: '#e3b94a', package: '#5c9ced', none: '#6b7280' },
    kind: {
      class: '#5b9fe0',
      abstract: '#9b8ae0',
      interface: '#5fbf6f',
      enum: '#e0a34a',
      annotation: '#d0b04a',
      entity: '#5faaa6',
      other: '#8b93a1',
    },
    memberName: '#6fb3f5',
    typeName: '#9aa3af',
    keywordType: '#e0a34a',
    methodIcon: '#ef6b6b',
    fieldIcon: '#b388ff',
    rowDivider: 'rgba(255,255,255,0.07)',
    kindText: '#15171b',
  },
  darcula: {
    canvas: '#2b2b2b',
    grid: '#353535',
    nodeFill: '#3c3f41',
    nodeHeaderFill: '#45494a',
    nodeStroke: '#5e6060',
    nodeShadow: 'rgba(0,0,0,0.4)',
    text: '#a9b7c6',
    textMuted: '#808080',
    separator: '#515151',
    edge: '#a9b7c6',
    edgeLabel: '#bbbbbb',
    groupFill: 'rgba(255,255,255,0.03)',
    groupStroke: '#5e6060',
    groupText: '#a9b7c6',
    noteFill: '#4a4530',
    noteStroke: '#8a7a2a',
    noteText: '#d8d2a8',
    vis: { public: '#6a8759', private: '#cc7832', protected: '#ffc66d', package: '#6897bb', none: '#808080' },
    kind: {
      class: '#6897bb',
      abstract: '#9876aa',
      interface: '#6a8759',
      enum: '#cc7832',
      annotation: '#bbb529',
      entity: '#5faaa6',
      other: '#808080',
    },
    memberName: '#589df6',
    typeName: '#a9b7c6',
    keywordType: '#cc7832',
    methodIcon: '#e06c75',
    fieldIcon: '#9876aa',
    rowDivider: 'rgba(255,255,255,0.07)',
    kindText: '#2b2b2b',
  },
  contrast: {
    canvas: '#ffffff',
    grid: '#eeeeee',
    nodeFill: '#ffffff',
    nodeHeaderFill: '#ffffff',
    nodeStroke: '#000000',
    nodeShadow: 'rgba(0,0,0,0)',
    text: '#000000',
    textMuted: '#333333',
    separator: '#000000',
    edge: '#000000',
    edgeLabel: '#000000',
    groupFill: 'rgba(0,0,0,0.02)',
    groupStroke: '#000000',
    groupText: '#000000',
    noteFill: '#ffffcc',
    noteStroke: '#000000',
    noteText: '#000000',
    vis: { public: '#007a1f', private: '#c00000', protected: '#9a6b00', package: '#0040c0', none: '#555555' },
    kind: {
      class: '#0040c0',
      abstract: '#5a2ea6',
      interface: '#007a1f',
      enum: '#9a4a00',
      annotation: '#7a6500',
      entity: '#006060',
      other: '#333333',
    },
    memberName: '#0040c0',
    typeName: '#333333',
    keywordType: '#9a4a00',
    methodIcon: '#c00000',
    fieldIcon: '#5a2ea6',
    rowDivider: 'rgba(0,0,0,0.2)',
    kindText: '#ffffff',
  },
  sepia: {
    canvas: '#f4ecd8',
    grid: '#e6dcc4',
    nodeFill: '#fbf5e6',
    nodeHeaderFill: '#f1e8d2',
    nodeStroke: '#b8a98a',
    nodeShadow: 'rgba(80, 60, 20, 0.1)',
    text: '#3d3225',
    textMuted: '#7a6c58',
    separator: '#dccfb2',
    edge: '#5e5040',
    edgeLabel: '#4a3f30',
    groupFill: 'rgba(120, 100, 60, 0.06)',
    groupStroke: '#c2b394',
    groupText: '#5e5040',
    noteFill: '#f9edc0',
    noteStroke: '#c3a23a',
    noteText: '#4a3f20',
    vis: { public: '#4e8a3f', private: '#b84a3a', protected: '#b78a12', package: '#3f6fb0', none: '#9a8c74' },
    kind: {
      class: '#4f7fb3',
      abstract: '#7a65a8',
      interface: '#4e8a3f',
      enum: '#b87a24',
      annotation: '#a88a1a',
      entity: '#4f8a86',
      other: '#7a6c58',
    },
    memberName: '#3f6fb0',
    typeName: '#7a6c58',
    keywordType: '#b87a24',
    methodIcon: '#b84a3a',
    fieldIcon: '#7a65a8',
    rowDivider: 'rgba(80, 60, 20, 0.08)',
    kindText: '#fbf5e6',
  },
};

export const FONT_STACKS: Record<FontFamily, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};
