export type Visibility = 'public' | 'private' | 'protected' | 'package' | 'none';

export type ClassKind =
  | 'class'
  | 'abstract'
  | 'interface'
  | 'enum'
  | 'annotation'
  | 'entity'
  | 'struct'
  | 'exception'
  | 'record'
  | 'protocol'
  | 'metaclass'
  | 'stereotype'
  | 'object';

export interface Member {
  kind: 'field' | 'method';
  visibility: Visibility;
  name: string;
  /** Parameter list, methods only (raw text without the parentheses). */
  params?: string;
  /** Field type or method return type. */
  type?: string;
  isStatic: boolean;
  isAbstract: boolean;
  raw: string;
}

export interface Compartment {
  title?: string;
  members: Member[];
}

export interface ClassNode {
  id: string;
  name: string;
  kind: ClassKind;
  generics?: string;
  stereotypes: string[];
  /** Custom spot: letter and optional colour, e.g. << (S,#FF7700) Singleton >> */
  spot?: { letter: string; color?: string };
  color?: string;
  /** Explicit compartments when the body contains separators; otherwise undefined. */
  compartments?: Compartment[];
  members: Member[];
  parent?: string;
  hidden: boolean;
  /** Line number where the class was declared (for diagnostics). */
  line: number;
}

export type HeadKind =
  | 'none'
  | 'arrow'
  | 'triangle'
  | 'composition'
  | 'aggregation'
  | 'cross'
  | 'crowfoot'
  | 'square'
  | 'nest'
  | 'circle';

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'bold';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Relation {
  id: string;
  from: string;
  to: string;
  fromHead: HeadKind;
  toHead: HeadKind;
  line: LineStyle;
  direction: Direction;
  /** Number of dash characters; 1 means horizontal in PlantUML. */
  length: number;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
  color?: string;
  hidden: boolean;
  isNoteLink?: boolean;
  /** Association class link: this relation starts at the middle of the relation with this id. */
  anchor?: string;
}

export interface Group {
  id: string;
  name: string;
  /** Dotted namespace path, e.g. "com.example.person". */
  qname: string;
  kind: string;
  parent?: string;
  stereotype?: string;
  color?: string;
}

export interface Note {
  id: string;
  text: string;
  /** Element the note is attached to, if any. */
  target?: string;
  position?: Direction;
  parent?: string;
  color?: string;
}

export interface Diagram {
  classes: Map<string, ClassNode>;
  relations: Relation[];
  groups: Map<string, Group>;
  notes: Note[];
  title?: string;
  caption?: string;
  header?: string;
  footer?: string;
  legend?: string;
  rankdir: 'TB' | 'LR';
  hideEmptyMembers: boolean;
  hideEmptyFields: boolean;
  hideEmptyMethods: boolean;
  hideCircle: boolean;
  hideMembers: boolean;
  hideFields: boolean;
  hideMethods: boolean;
  hideStereotypes: Set<string>;
  linetype?: 'ortho' | 'polyline';
  warnings: { line: number; message: string }[];
}

export function emptyDiagram(): Diagram {
  return {
    classes: new Map(),
    relations: [],
    groups: new Map(),
    notes: [],
    rankdir: 'TB',
    hideEmptyMembers: false,
    hideEmptyFields: false,
    hideEmptyMethods: false,
    hideCircle: false,
    hideMembers: false,
    hideFields: false,
    hideMethods: false,
    hideStereotypes: new Set(),
    warnings: [],
  };
}
