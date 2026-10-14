import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, StringStream, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

// Keywords that start a statement (case-sensitive, like PlantUML itself).
const LINE_KEYWORDS = new Set([
  'class', 'interface', 'enum', 'abstract', 'annotation', 'entity', 'struct', 'exception', 'record', 'protocol',
  'metaclass', 'stereotype', 'object', 'package', 'namespace', 'folder', 'frame', 'cloud', 'rectangle', 'node',
  'database', 'together', 'note', 'hnote', 'rnote', 'end', 'endnote', 'hide', 'show', 'remove', 'skinparam',
  'title', 'caption', 'header', 'footer', 'legend', 'endlegend', 'left', 'top', 'participant', 'actor',
  'boundary', 'control', 'collections', 'queue', 'activate', 'deactivate', 'destroy', 'return', 'alt', 'else',
  'opt', 'loop', 'par', 'break', 'critical', 'group', 'box', 'autonumber', 'start', 'stop', 'if', 'elseif',
  'endif', 'while', 'endwhile', 'repeat', 'fork', 'split', 'state', 'usecase', 'component', 'artifact', 'card',
  'storage', 'set', 'scale', 'allowmixing', 'newpage', 'ref', 'kill', 'detach', 'switch', 'case', 'endswitch',
  'partition', 'backward', 'floating',
]);
// Keywords that may appear after other tokens on the same line.
const INLINE_KEYWORDS = new Set([
  'as', 'of', 'to', 'extends', 'implements', 'left', 'right', 'top', 'bottom', 'direction', 'on', 'link',
  'then', 'else', 'again', 'while', 'members', 'empty', 'fields', 'methods', 'circle', 'attributes', 'linetype',
  'ortho', 'polyline', 'over', 'note', 'end',
]);

interface State {
  inBlockComment: boolean;
  inNote: boolean;
  afterColon: boolean;
  lineStart: boolean;
}

const plantUml = StreamLanguage.define<State>({
  name: 'plantuml',
  startState: () => ({ inBlockComment: false, inNote: false, afterColon: false, lineStart: true }),
  token(stream: StringStream, state: State): string | null {
    if (stream.sol()) {
      state.afterColon = false;
      state.lineStart = true;
    }
    if (state.inBlockComment) {
      if (stream.match(/^.*?'\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;

    if (state.inNote) {
      if (stream.match(/^end\s*note\b/i)) {
        state.inNote = false;
        return 'keyword';
      }
      stream.skipToEnd();
      return 'string';
    }

    if (stream.match(/^\/'/)) {
      state.inBlockComment = true;
      if (stream.match(/^.*?'\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (state.lineStart && stream.peek() === "'") {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^@(start|end)\w*/)) return 'meta';
    if (state.lineStart && stream.match(/^!\w+.*$/)) return 'meta';
    if (state.lineStart && stream.match(/^(hnote|rnote|note)\s+(left|right|top|bottom)\s+of\s+("[^"]+"|\S+)\s*$/i)) {
      state.inNote = true;
      return 'keyword';
    }
    if (state.lineStart && stream.match(/^(hnote|rnote|note)\s+as\s+\S+\s*$/i)) {
      state.inNote = true;
      return 'keyword';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^<<[^>]*>>/)) return 'annotation';
    if (stream.match(/^\{(static|abstract|field|method|classifier)\}/)) return 'modifier';
    if (stream.match(/^#[\w|\\/;-]+/)) return 'atom';

    // Compartment separators: "--", "-- title --", "==", "..", "__"
    if (state.lineStart && stream.match(/^(--|\.\.|==|__)(\s+.*?\s+(--|\.\.|==|__))?\s*$/)) {
      state.lineStart = false;
      return 'separator';
    }
    // Visibility marker at the start of a member line
    if (state.lineStart && stream.match(/^[-+#~](?=\s*[\w{<"])/)) {
      state.lineStart = false;
      return 'operator';
    }
    // Arrows / relations
    if (stream.match(/^(<\|\||<\||<|\*|o|#|x|\}|\+|\^)?(?:[-.]+(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?)+[-.]*(\|\||\|>|>|\*|o|#|x|\{|\+|\^)?(?=\s|$)/)) {
      state.lineStart = false;
      return 'operator';
    }
    if (stream.match(/^[{}()\[\]]/)) return 'bracket';
    if (stream.match(/^:/)) {
      state.afterColon = true;
      state.lineStart = false;
      return 'punctuation';
    }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^[\w$.]+/)) {
      const word = stream.current();
      const wasStart = state.lineStart;
      state.lineStart = false;
      if (state.afterColon) return 'typeName';
      if (wasStart ? LINE_KEYWORDS.has(word) : INLINE_KEYWORDS.has(word)) return 'keyword';
      return 'variableName';
    }
    stream.next();
    state.lineStart = false;
    return null;
  },
  languageData: { commentTokens: { line: "'" } },
  tokenTable: {
    separator: t.separator,
    typeName: t.typeName,
    variableName: t.variableName,
    annotation: t.annotation,
    modifier: t.modifier,
    atom: t.atom,
    meta: t.meta,
    operator: t.operator,
    keyword: t.keyword,
    string: t.string,
    comment: t.comment,
    number: t.number,
    bracket: t.bracket,
    punctuation: t.punctuation,
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.meta, color: 'var(--syn-meta)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.annotation, color: 'var(--syn-annotation)' },
  { tag: t.modifier, color: 'var(--syn-annotation)' },
  { tag: t.operator, color: 'var(--syn-operator)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.variableName, color: 'var(--syn-name)' },
  { tag: t.atom, color: 'var(--syn-atom)' },
  { tag: t.number, color: 'var(--syn-atom)' },
  { tag: t.separator, color: 'var(--syn-comment)' },
  { tag: t.bracket, color: 'var(--syn-bracket)' },
  { tag: t.punctuation, color: 'var(--syn-bracket)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--editor-selection-inactive)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--editor-selection)' },
  '.cm-gutters, .cm-gutter, .cm-gutterElement': { userSelect: 'none', WebkitUserSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', paddingRight: '10px', paddingLeft: '4px' },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: 'none',
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent)',
    textDecorationThickness: '2px',
    textUnderlineOffset: '3px',
  },
  '&.cm-focused .cm-nonmatchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: 'none',
    textDecoration: 'underline wavy',
    textDecorationColor: 'var(--vis-private)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'inherit' },
});

export function createEditor(parent: HTMLElement, doc: string, onChange: (text: string) => void): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      bracketMatching(),
      plantUml,
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}

export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
