import {
  ClassKind,
  ClassNode,
  Compartment,
  Diagram,
  Direction,
  HeadKind,
  LineStyle,
  Member,
  Note,
  Visibility,
  emptyDiagram,
} from './model';

const CLASS_KEYWORDS: Record<string, ClassKind> = {
  class: 'class',
  'abstract class': 'abstract',
  abstract: 'abstract',
  interface: 'interface',
  enum: 'enum',
  annotation: 'annotation',
  entity: 'entity',
  struct: 'struct',
  exception: 'exception',
  record: 'record',
  protocol: 'protocol',
  metaclass: 'metaclass',
  stereotype: 'stereotype',
  dataclass: 'class',
  object: 'object',
};

const GROUP_KEYWORDS = new Set([
  'package',
  'namespace',
  'folder',
  'frame',
  'cloud',
  'rectangle',
  'node',
  'database',
  'together',
  'component',
  'card',
  'storage',
  'artifact',
]);

const CLASS_DECL =
  /^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct|exception|record|protocol|metaclass|stereotype|dataclass|object)\s+(.+?)\s*(\{)?\s*$/;

const ARROW_RE =
  /^(<\|\||<\||<|\*|o|#|x|\}|\+|\^)?((?:[-.]+(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?)+[-.]*)(\|\||\|>|>|\*|o|#|x|\{|\+|\^)?$/;

const DIRECTION_WORDS: Record<string, Direction> = {
  left: 'left',
  le: 'left',
  l: 'left',
  right: 'right',
  ri: 'right',
  r: 'right',
  up: 'up',
  u: 'up',
  down: 'down',
  do: 'down',
  d: 'down',
};

function stripQuotes(s: string): string {
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function idFromName(name: string): string {
  return stripQuotes(name).replace(/\s+/g, '_');
}

/** Removes PlantUML creole/colour noise that we do not render. */
function cleanLabel(s: string): string {
  return s
    .replace(/<\/?[bi u]>/gi, '')
    .replace(/<color[^>]*>|<\/color>/gi, '')
    .replace(/<size[^>]*>|<\/size>/gi, '')
    .replace(/\\n/g, '\n')
    .trim();
}

export function parseVisibility(ch: string): Visibility {
  switch (ch) {
    case '+':
      return 'public';
    case '-':
      return 'private';
    case '#':
      return 'protected';
    case '~':
      return 'package';
    default:
      return 'none';
  }
}

export function parseMember(raw: string): Member {
  let text = raw.trim();
  let visibility: Visibility = 'none';
  let isStatic = false;
  let isAbstract = false;
  let forced: 'field' | 'method' | undefined;

  if (/^[-+#~]/.test(text)) {
    visibility = parseVisibility(text[0]);
    text = text.slice(1).trim();
  }

  // Modifiers can appear anywhere; strip them all.
  text = text.replace(/\{(static|abstract|field|method|classifier)\}/gi, (_, m: string) => {
    const mod = m.toLowerCase();
    if (mod === 'static' || mod === 'classifier') isStatic = true;
    else if (mod === 'abstract') isAbstract = true;
    else if (mod === 'field') forced = 'field';
    else if (mod === 'method') forced = 'method';
    return ' ';
  });
  text = text.replace(/\s+/g, ' ').trim();

  // Java-style modifiers in plain text.
  text = text.replace(/\b(static|abstract|final)\s+/g, (_, m: string) => {
    if (m === 'static') isStatic = true;
    if (m === 'abstract') isAbstract = true;
    return '';
  });

  const parenIdx = text.indexOf('(');
  const isMethod = forced ? forced === 'method' : parenIdx >= 0;

  if (isMethod && parenIdx >= 0) {
    const close = text.lastIndexOf(')');
    const before = text.slice(0, parenIdx).trim();
    const params = close > parenIdx ? text.slice(parenIdx + 1, close).trim() : '';
    const after = close > parenIdx ? text.slice(close + 1).trim() : '';
    let name = before;
    let type: string | undefined;
    if (after.startsWith(':')) {
      type = after.slice(1).trim() || undefined;
    }
    // Java style: "void foo" or "List<String> foo"
    const m = /^(.*\S)\s+([\w$]+)$/.exec(before);
    if (m && !type) {
      type = m[1];
      name = m[2];
    } else if (m) {
      name = m[2];
    }
    return { kind: 'method', visibility, name, params, type, isStatic, isAbstract, raw };
  }

  // Field
  let name = text;
  let type: string | undefined;
  const colon = splitTopLevel(text, ':');
  if (colon) {
    name = colon[0].trim();
    type = colon[1].trim() || undefined;
  } else {
    const m = /^(.*\S)\s+([\w$]+)$/.exec(text);
    if (m) {
      type = m[1];
      name = m[2];
    }
  }
  return { kind: isMethod ? 'method' : 'field', visibility, name, type, isStatic, isAbstract, raw };
}

/** Splits on the first `sep` outside of <> and () nesting. */
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

function headKind(token: string | undefined, side: 'from' | 'to'): HeadKind {
  if (!token) return 'none';
  switch (token) {
    case '<|':
    case '|>':
      return 'triangle';
    case '<||':
    case '||':
      return 'triangle';
    case '<':
    case '>':
      return 'arrow';
    case '*':
      return 'composition';
    case 'o':
      return 'aggregation';
    case 'x':
      return 'cross';
    case '}':
    case '{':
      return 'crowfoot';
    case '#':
      return 'square';
    case '+':
      return 'nest';
    case '^':
      return 'circle';
    default:
      return side === 'from' ? 'none' : 'none';
  }
}

interface ArrowInfo {
  fromHead: HeadKind;
  toHead: HeadKind;
  line: LineStyle;
  direction: Direction;
  length: number;
  hidden: boolean;
  color?: string;
}

export function parseArrow(token: string): ArrowInfo | null {
  const m = ARROW_RE.exec(token);
  if (!m) return null;
  const [, left, body, right] = m;
  if (!/[-.]/.test(body)) return null;

  let line: LineStyle = body.includes('.') ? 'dashed' : 'solid';
  let direction: Direction = 'down';
  let hidden = false;
  let color: string | undefined;

  const bracket = /\[([^\]]*)\]/.exec(body);
  if (bracket) {
    for (const part of bracket[1].split(/[,;]/)) {
      const p = part.trim();
      if (p === 'hidden') hidden = true;
      else if (p === 'bold') line = 'bold';
      else if (p === 'dashed') line = 'dashed';
      else if (p === 'dotted') line = 'dotted';
      else if (p.startsWith('#')) color = p;
    }
  }
  const stripped = body.replace(/\[[^\]]*\]/g, '');
  const dirMatch = /[a-z]+/.exec(stripped);
  if (dirMatch && DIRECTION_WORDS[dirMatch[0]]) direction = DIRECTION_WORDS[dirMatch[0]];
  const length = (stripped.match(/[-.]/g) || []).length;
  if (length === 1 && !dirMatch) direction = 'right';

  return {
    fromHead: headKind(left, 'from'),
    toHead: headKind(right, 'to'),
    line,
    direction,
    length,
    hidden,
    color,
  };
}

/** Finds the arrow token in a relation line and returns [lhs, arrow, rhs]. */
function splitRelation(line: string): [string, string, string] | null {
  // Tokenise, keeping quoted strings intact.
  const tokens: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (/\s/.test(ch) && !inQ) {
      if (cur) tokens.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) tokens.push(cur);

  for (let i = 1; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (!/[-.]/.test(t) || t.startsWith('"')) continue;
    if (parseArrow(t)) {
      return [tokens.slice(0, i).join(' '), t, tokens.slice(i + 1).join(' ')];
    }
  }
  return null;
}

function parseEndpoint(s: string): { id: string; label?: string } {
  s = s.trim();
  // forms: Name, "Name", Name "label", "label" Name
  let m = /^("[^"]+"|\S+)\s+"([^"]*)"$/.exec(s);
  if (m) return { id: idFromName(m[1]), label: m[2] };
  m = /^"([^"]*)"\s+("[^"]+"|\S+)$/.exec(s);
  if (m) return { id: idFromName(m[2]), label: m[1] };
  return { id: idFromName(s) };
}

export function parse(source: string): Diagram {
  const d = emptyDiagram();
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  const groupStack: string[] = [];
  let groupCounter = 0;
  let noteCounter = 0;
  let relCounter = 0;

  // Multi-line state
  let currentClass: ClassNode | null = null;
  let currentCompartments: Compartment[] | null = null;
  let pendingNote: (Note & { lines: string[] }) | null = null;
  let inBlockComment = false;
  let skipUntil: RegExp | null = null;

  // Packages act as namespaces, like PlantUML: an element declared inside a
  // package gets a qualified id ("pkg.Name"), so "Person" in two packages are
  // two elements. References look for the exact id first, then the current
  // scope, then any element with that simple name, and finally create one.
  const scopeQ = (): string | undefined => {
    const top = groupStack[groupStack.length - 1];
    return top ? d.groups.get(top)?.qname : undefined;
  };
  const declareId = (name: string): string => {
    const scope = scopeQ();
    return scope && !name.includes('.') ? `${scope}.${name}` : name;
  };
  const findId = (name: string): string | undefined => {
    if (d.classes.has(name)) return name;
    const scope = scopeQ();
    if (scope && d.classes.has(`${scope}.${name}`)) return `${scope}.${name}`;
    const simple = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    const matches = [...d.classes.keys()].filter((id) => id === simple || id.endsWith(`.${simple}`));
    if (name.includes('.')) return matches.find((id) => id.endsWith(name));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const resolveId = (name: string): string => findId(name) ?? declareId(name);

  const ensureClass = (id: string, line: number, kind: ClassKind = 'class'): ClassNode => {
    let c = d.classes.get(id);
    if (!c) {
      c = {
        id,
        name: id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id,
        kind,
        stereotypes: [],
        members: [],
        hidden: false,
        line,
        parent: groupStack[groupStack.length - 1],
      };
      d.classes.set(id, c);
    }
    return c;
  };

  const warn = (line: number, message: string) => d.warnings.push({ line, message });

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i];
    let line = raw.trim();

    if (inBlockComment) {
      if (line.includes("'/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/'")) {
      if (!line.includes("'/")) inBlockComment = true;
      continue;
    }
    if (skipUntil) {
      if (skipUntil.test(line)) skipUntil = null;
      continue;
    }
    if (pendingNote) {
      if (/^end\s*note$/i.test(line)) {
        pendingNote.text = pendingNote.lines.join('\n');
        const { lines: _l, ...note } = pendingNote;
        d.notes.push(note);
        pendingNote = null;
      } else pendingNote.lines.push(cleanLabel(raw.replace(/^\s{0,2}/, '')));
      continue;
    }

    if (!line || line.startsWith("'")) continue;
    if (/^@start\w*/.test(line) || /^@end\w*/.test(line)) continue;
    line = line.replace(/\/'.*?'\//g, ' ').trim();
    if (!line) continue;

    // One-line body: "class A { +x: int; +y() }"
    let inlineBody: string[] | null = null;
    const oneLine = /^(.*?)\{\s*(.*?)\s*\}\s*$/.exec(line);
    if (oneLine && !currentClass && CLASS_DECL.test(oneLine[1].trim() + ' {')) {
      inlineBody = oneLine[2] ? oneLine[2].split(/\s*;\s*/).filter(Boolean) : [];
      line = oneLine[1].trim() + (inlineBody.length ? ' {' : '');
    }

    // Inside a class body
    if (currentClass) {
      if (line === '}') {
        if (currentCompartments) {
          currentClass.compartments = currentCompartments.filter((c) => c.members.length || c.title);
          currentClass.members = currentCompartments.flatMap((c) => c.members);
        }
        currentClass = null;
        currentCompartments = null;
        continue;
      }
      const sep = /^(--|\.\.|==|__)\s*(.*?)\s*(?:--|\.\.|==|__)?$/.exec(line);
      if (sep && /^(--|\.\.|==|__)/.test(line) && !/^[-+#~]\s*\w/.test(line)) {
        if (!currentCompartments) currentCompartments = [{ members: [...currentClass.members] }];
        currentCompartments.push({ title: sep[2] || undefined, members: [] });
        continue;
      }
      const member = parseMember(line);
      if (currentCompartments) currentCompartments[currentCompartments.length - 1].members.push(member);
      else currentClass.members.push(member);
      continue;
    }

    // Directives
    if (/^(skinparam|skin|!|scale|caption|hide\s+empty\s+description|autonumber|allowmixing|set\s)/i.test(line)) {
      const lt = /^skinparam\s+linetype\s+(ortho|polyline)/i.exec(line);
      if (lt) d.linetype = lt[1].toLowerCase() as 'ortho' | 'polyline';
      if (/^skinparam\s*\{\s*$/i.test(line) || /^skinparam\s+\w+\s*\{\s*$/i.test(line)) skipUntil = /^\}$/;
      const cap = /^caption\s+(.*)$/i.exec(line);
      if (cap) d.caption = cleanLabel(cap[1]);
      continue;
    }
    if (/^left\s+to\s+right\s+direction/i.test(line)) {
      d.rankdir = 'LR';
      continue;
    }
    if (/^top\s+to\s+bottom\s+direction/i.test(line)) {
      d.rankdir = 'TB';
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/i.exec(line))) {
      d.title = cleanLabel(m[1]);
      continue;
    }
    if (/^title\s*$/i.test(line)) {
      const buf: string[] = [];
      while (++i < lines.length && !/^end\s*title$/i.test(lines[i].trim())) buf.push(cleanLabel(lines[i]));
      d.title = buf.join('\n');
      continue;
    }
    if ((m = /^(header|footer)\s+(.*)$/i.exec(line))) {
      if (m[1].toLowerCase() === 'header') d.header = cleanLabel(m[2]);
      else d.footer = cleanLabel(m[2]);
      continue;
    }
    if (/^(header|footer)\s*$/i.test(line)) {
      skipUntil = /^end\s*(header|footer)$/i;
      continue;
    }
    if (/^legend/i.test(line)) {
      const buf: string[] = [];
      while (++i < lines.length && !/^end\s*legend$/i.test(lines[i].trim())) buf.push(cleanLabel(lines[i]));
      d.legend = buf.join('\n');
      continue;
    }
    if ((m = /^(hide|show)\s+(.*)$/i.exec(line))) {
      const on = m[1].toLowerCase() === 'hide';
      const what = m[2].trim().toLowerCase();
      if (what === 'empty members') d.hideEmptyMembers = on;
      else if (what === 'empty fields' || what === 'empty attributes') d.hideEmptyFields = on;
      else if (what === 'empty methods') d.hideEmptyMethods = on;
      else if (what === 'circle' || what === 'circled character') d.hideCircle = on;
      else if (what === 'members') d.hideMembers = on;
      else if (what === 'fields' || what === 'attributes') d.hideFields = on;
      else if (what === 'methods') d.hideMethods = on;
      else if (what.startsWith('<<')) {
        const st = what.replace(/[<>]/g, '').trim();
        if (on) d.hideStereotypes.add(st);
        else d.hideStereotypes.delete(st);
      } else if (/^(class|interface|enum|abstract|annotation)\b/.test(what)) {
        // hide/show all of a kind: ignore
      } else {
        const id = resolveId(idFromName(m[2].trim()));
        const c = d.classes.get(id);
        if (c) c.hidden = on;
        else if (on) ensureClass(id, lineNo).hidden = true;
      }
      continue;
    }
    if ((m = /^remove\s+(.*)$/i.exec(line))) {
      const c = d.classes.get(findId(idFromName(m[1])) ?? '');
      if (c) c.hidden = true;
      continue;
    }

    // Notes
    if ((m = /^(?:h?note|rnote)\s+(left|right|top|bottom)\s+of\s+("[^"]+"|[\w.$]+)\s*(#\w+)?\s*(?::\s*(.*))?$/i.exec(line))) {
      const note: Note & { lines: string[] } = {
        id: `note_${noteCounter++}`,
        text: '',
        target: resolveId(idFromName(m[2])),
        position: undefined,
        color: m[3],
        parent: groupStack[groupStack.length - 1],
        lines: [],
      };
      const pos = m[1].toLowerCase();
      note.position = pos === 'top' ? 'up' : pos === 'bottom' ? 'down' : (pos as Direction);
      if (m[4] !== undefined) {
        note.text = cleanLabel(m[4]);
        const { lines: _l, ...n } = note;
        d.notes.push(n);
      } else pendingNote = note;
      continue;
    }
    if ((m = /^(?:h?note|rnote)\s+"([^"]*)"\s+as\s+([\w.$]+)\s*(#\w+)?$/i.exec(line))) {
      d.notes.push({
        id: idFromName(m[2]),
        text: cleanLabel(m[1]),
        color: m[3],
        parent: groupStack[groupStack.length - 1],
      });
      continue;
    }
    if ((m = /^(?:h?note|rnote)\s+as\s+([\w.$]+)\s*(#\w+)?$/i.exec(line))) {
      pendingNote = {
        id: idFromName(m[1]),
        text: '',
        color: m[2],
        parent: groupStack[groupStack.length - 1],
        lines: [],
      };
      continue;
    }
    if (/^(?:h?note|rnote)\s+on\s+link/i.test(line)) {
      // Note on the last relation
      const rel = d.relations[d.relations.length - 1];
      const inline = /:\s*(.*)$/.exec(line);
      if (inline && rel) rel.label = rel.label ? `${rel.label}\n${cleanLabel(inline[1])}` : cleanLabel(inline[1]);
      else if (rel) {
        const buf: string[] = [];
        while (++i < lines.length && !/^end\s*note$/i.test(lines[i].trim())) buf.push(cleanLabel(lines[i]));
        rel.label = rel.label ? `${rel.label}\n${buf.join('\n')}` : buf.join('\n');
      }
      continue;
    }
    if (/^(?:h?note|rnote)\b/i.test(line)) {
      // Unknown note form (e.g. sequence note); skip the block if multi-line.
      if (!line.includes(':')) pendingNote = { id: `note_${noteCounter++}`, text: '', lines: [] };
      continue;
    }

    // Group open
    if ((m = /^(\w+)\s*(.*?)\s*\{\s*$/.exec(line)) && GROUP_KEYWORDS.has(m[1].toLowerCase())) {
      const kind = m[1].toLowerCase();
      let rest = m[2];
      let stereotype: string | undefined;
      let color: string | undefined;
      const st = /<<\s*([^>]*?)\s*>>/.exec(rest);
      if (st) {
        stereotype = st[1];
        rest = rest.replace(st[0], '');
      }
      const col = /#[\w|\\/-]+/.exec(rest);
      if (col) {
        color = col[0];
        rest = rest.replace(col[0], '');
      }
      let name = rest.trim();
      let id: string;
      const asM = /^(.*?)\s+as\s+("[^"]+"|[\w.$]+)$/.exec(name);
      if (asM) {
        id = idFromName(asM[2]);
        name = stripQuotes(asM[1]);
      } else {
        name = stripQuotes(name);
        id = name ? `group_${idFromName(name)}` : `group_${groupCounter++}`;
      }
      if (kind === 'together') {
        groupStack.push(groupStack[groupStack.length - 1] ?? '');
        continue;
      }
      const parentGroup = d.groups.get(groupStack[groupStack.length - 1] ?? '');
      const own = idFromName(name) || id;
      d.groups.set(id, {
        id,
        name,
        qname: parentGroup ? `${parentGroup.qname}.${own}` : own,
        kind,
        stereotype,
        color,
        parent: groupStack[groupStack.length - 1] || undefined,
      });
      groupStack.push(id);
      continue;
    }
    if (line === '}') {
      if (groupStack.length) groupStack.pop();
      else warn(lineNo, 'Unexpected closing brace');
      continue;
    }

    // Class declaration
    if ((m = CLASS_DECL.exec(line))) {
      const kind = CLASS_KEYWORDS[m[1].toLowerCase().replace(/\s+/g, ' ')] ?? 'class';
      let rest = m[2];
      const opens = m[3] === '{';

      const stereotypes: string[] = [];
      let spot: ClassNode['spot'];
      rest = rest.replace(/<<\s*([^>]*?)\s*>>/g, (_, inner: string) => {
        const sp = /^\(\s*(\S)\s*(?:,\s*(#?\w+))?\s*\)\s*(.*)$/.exec(inner);
        if (sp) {
          spot = { letter: sp[1], color: sp[2] };
          if (sp[3]) stereotypes.push(sp[3].trim());
        } else if (inner) stereotypes.push(inner);
        return ' ';
      });

      let color: string | undefined;
      rest = rest.replace(/(^|\s)(#[\w|\\/;-]+)(?=\s|$)/, (_, pre, c: string) => {
        color = c.split(/[|\\/;]/)[0];
        return pre;
      });

      // Pull out the generic parameter list first so that "<T extends X>" is
      // not mistaken for an extends clause.
      let generics: string | undefined;
      rest = rest.replace(/^("[^"]+"|[\w.$]+)<((?:[^<>]|<[^<>]*>)*)>/, (_, n: string, gen: string) => {
        generics = gen.trim();
        return n;
      });

      let extendsList: string[] = [];
      let implementsList: string[] = [];
      rest = rest.replace(/\s+extends\s+([^\s,]+(?:\s*,\s*[^\s,]+)*)/, (_, l: string) => {
        extendsList = l.split(/\s*,\s*/);
        return ' ';
      });
      rest = rest.replace(/\s+implements\s+([^\s,]+(?:\s*,\s*[^\s,]+)*)/, (_, l: string) => {
        implementsList = l.split(/\s*,\s*/);
        return ' ';
      });
      rest = rest.trim();

      let name: string;
      let id: string;
      const asM = /^("[^"]+"|\S+)\s+as\s+("[^"]+"|\S+)$/.exec(rest);
      if (asM) {
        if (asM[1].startsWith('"')) {
          name = stripQuotes(asM[1]);
          id = declareId(idFromName(asM[2]));
        } else {
          name = stripQuotes(asM[2]);
          id = declareId(idFromName(asM[1]));
        }
      } else {
        name = stripQuotes(rest);
        id = declareId(idFromName(name));
        if (name.includes('.') && !name.includes(' ')) name = name.slice(name.lastIndexOf('.') + 1);
      }

      const existing = d.classes.get(id);
      const cls = existing ?? ensureClass(id, lineNo, kind);
      cls.kind = kind;
      cls.name = name;
      if (generics) cls.generics = generics;
      cls.stereotypes.push(...stereotypes);
      if (spot) cls.spot = spot;
      if (color) cls.color = color;
      cls.line = lineNo;
      if (!existing) cls.parent = groupStack[groupStack.length - 1] || undefined;

      for (const parent of extendsList) {
        const pid = resolveId(idFromName(parent));
        ensureClass(pid, lineNo, kind === 'interface' ? 'interface' : 'class');
        d.relations.push({
          id: `rel_${relCounter++}`,
          from: pid,
          to: id,
          fromHead: 'triangle',
          toHead: 'none',
          line: 'solid',
          direction: 'down',
          length: 2,
          hidden: false,
        });
      }
      for (const parent of implementsList) {
        const pid = resolveId(idFromName(parent));
        ensureClass(pid, lineNo, 'interface');
        d.relations.push({
          id: `rel_${relCounter++}`,
          from: pid,
          to: id,
          fromHead: 'triangle',
          toHead: 'none',
          line: 'dashed',
          direction: 'down',
          length: 2,
          hidden: false,
        });
      }
      if (inlineBody && inlineBody.length) {
        for (const m of inlineBody) cls.members.push(parseMember(m));
      } else if (opens) {
        currentClass = cls;
        currentCompartments = null;
      }
      continue;
    }

    // Relation
    const rel = splitRelation(line);
    if (rel) {
      const [lhs, arrowTok, rhsAll] = rel;
      const arrow = parseArrow(arrowTok)!;
      let rhs = rhsAll;
      let label: string | undefined;
      const colon = /^(.*?)\s*:\s*(.*)$/.exec(rhsAll);
      if (colon && !/^"[^"]*:[^"]*"$/.test(rhsAll)) {
        rhs = colon[1];
        label = cleanLabel(colon[2]).replace(/^[<>]\s*|\s*[<>]$/g, '');
      }
      // Association class: "(A, B) .. C" or "C .. (A, B)" hangs C off the A-B association.
      const pairRe = /^\(\s*("[^"]+"|[^,\s]+)\s*,\s*("[^"]+"|[^,\s)]+)\s*\)$/;
      const pairL = pairRe.exec(lhs.trim());
      const pairR = pairRe.exec(rhs.trim());
      if (pairL || pairR) {
        const pair = (pairL ?? pairR)!;
        const other = parseEndpoint(pairL ? rhs : lhs);
        const pa = resolveId(idFromName(pair[1]));
        const pb = resolveId(idFromName(pair[2]));
        ensureClass(pa, lineNo);
        ensureClass(pb, lineNo);
        other.id = resolveId(other.id);
        ensureClass(other.id, lineNo);
        let base = [...d.relations].reverse().find((x) => !x.anchor && !x.isNoteLink && ((x.from === pa && x.to === pb) || (x.from === pb && x.to === pa)));
        if (!base) {
          base = { id: `rel_${relCounter++}`, from: pa, to: pb, fromHead: 'none', toHead: 'none', line: 'solid', direction: 'down', length: 2, hidden: false };
          d.relations.push(base);
        }
        d.relations.push({
          id: `rel_${relCounter++}`,
          from: base.from,
          to: other.id,
          fromHead: 'none',
          toHead: 'none',
          line: arrow.line === 'solid' ? 'dashed' : arrow.line,
          direction: arrow.direction,
          length: arrow.length,
          label,
          color: arrow.color,
          hidden: arrow.hidden,
          anchor: base.id,
        });
        continue;
      }

      const a = parseEndpoint(lhs.replace(/::\w+$/, ''));
      const b = parseEndpoint(rhs.replace(/::\w+$/, ''));
      const isNote = (id: string) => d.notes.some((n) => n.id === id);
      for (const ep of [a, b]) if (!isNote(ep.id)) ep.id = resolveId(ep.id);
      const aNote = isNote(a.id);
      const bNote = isNote(b.id);
      if (!aNote) ensureClass(a.id, lineNo);
      if (!bNote) ensureClass(b.id, lineNo);
      if (aNote || bNote) {
        const note = d.notes.find((n) => n.id === (aNote ? a.id : b.id))!;
        if (!note.target) {
          note.target = aNote ? b.id : a.id;
          note.position = aNote
            ? arrow.direction === 'down'
              ? 'up'
              : arrow.direction === 'up'
                ? 'down'
                : arrow.direction === 'left'
                  ? 'right'
                  : 'left'
            : arrow.direction;
          continue;
        }
      }
      d.relations.push({
        id: `rel_${relCounter++}`,
        from: a.id,
        to: b.id,
        fromHead: arrow.fromHead,
        toHead: arrow.toHead,
        line: arrow.line,
        direction: arrow.direction,
        length: arrow.length,
        label,
        fromLabel: a.label,
        toLabel: b.label,
        color: arrow.color,
        hidden: arrow.hidden,
        isNoteLink: aNote || bNote,
      });
      continue;
    }

    // Member attached via "Class : member"
    if ((m = /^("[^"]+"|[\w.$<>]+)\s*:\s*(.+)$/.exec(line))) {
      const id = resolveId(idFromName(m[1].replace(/<[^>]*>$/, '')));
      const cls = ensureClass(id, lineNo);
      cls.members.push(parseMember(m[2]));
      continue;
    }

    // Bare class reference with alias "class Foo as Bar" handled above; bare "Foo" lines ignored.
    warn(lineNo, `Unrecognised line: ${line.length > 60 ? line.slice(0, 57) + '…' : line}`);
  }

  if (currentClass) warn(lines.length, `Class "${(currentClass as ClassNode).name}" is missing a closing brace`);
  if (pendingNote) warn(lines.length, 'Note is missing "end note"');

  // Stereotype-based hiding
  for (const c of d.classes.values()) {
    if (c.stereotypes.some((s) => d.hideStereotypes.has(s.toLowerCase()))) c.hidden = true;
  }
  return d;
}
