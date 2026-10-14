export type DiagramType =
  | 'class'
  | 'sequence'
  | 'activity'
  | 'state'
  | 'usecase'
  | 'component'
  | 'deployment'
  | 'object'
  | 'mindmap'
  | 'gantt'
  | 'wbs'
  | 'json'
  | 'yaml'
  | 'salt'
  | 'timing'
  | 'network'
  | 'er'
  | 'other';

const START_TAGS: Record<string, DiagramType> = {
  startmindmap: 'mindmap',
  startgantt: 'gantt',
  startwbs: 'wbs',
  startjson: 'json',
  startyaml: 'yaml',
  startsalt: 'salt',
  startnwdiag: 'network',
  startditaa: 'other',
  startdot: 'other',
  startmath: 'other',
  startlatex: 'other',
  startregex: 'other',
  startebnf: 'other',
  startchronology: 'other',
  startboard: 'other',
  startchen: 'er',
  startfiles: 'other',
  startcreole: 'other',
  startgit: 'other',
};

/**
 * Guesses the diagram type from the source. Class and object diagrams are
 * rendered natively; everything else is delegated to a PlantUML server.
 */
export function detectDiagramType(source: string): DiagramType {
  const text = source.replace(/\r/g, '');
  const tag = /^@(start\w+)/m.exec(text);
  if (tag && START_TAGS[tag[1].toLowerCase()]) return START_TAGS[tag[1].toLowerCase()];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("'") && !l.startsWith('@') && !/^skinparam/i.test(l) && !l.startsWith('!'));

  let classScore = 0;
  let seqScore = 0;
  let actScore = 0;
  let stateScore = 0;
  let useScore = 0;
  let compScore = 0;
  let objScore = 0;

  for (const l of lines) {
    if (/^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct|exception|record|protocol|metaclass|dataclass)\s+/i.test(l)) classScore += 3;
    if (/^object\s+/i.test(l)) objScore += 3;
    if (/^(participant|actor|boundary|control|collections|queue|database)\s+/i.test(l)) seqScore += 3;
    if (/^(activate|deactivate|destroy|autonumber|return\b|alt\b|opt\b|loop\b|par\b|else\b|group\b|ref\s+over|box\b|end\s*box|\|\|\||\.\.\.)/i.test(l)) seqScore += 3;
    if (/^\S+\s*-{1,2}>{1,2}\s*\S+\s*:/.test(l) && !/^\S+\s+"/.test(l) && !/-[-.]/.test(l.split(/\s+/)[1] || '')) seqScore += 1;
    if (/^[\w"]+\s*(-+>|<-+|-+>>|<<-+|->x|\\-|-\\|\/\/-+|-+\/\/)\s*[\w"]+\s*:\s*\S/.test(l) && !/--|\.\./.test(l.split(':')[0])) seqScore += 2;
    if (/^(start$|stop$|end$|kill$|detach$|fork$|fork\s+again|end\s+fork|end\s+merge|repeat$|repeat\s+while|while\s*\(|endwhile|if\s*\(|elseif\s*\(|endif|switch\s*\(|case\s*\(|endswitch|split$|end\s+split|partition\s|floating\s+note|backward|:[^:]*;$)/i.test(l)) actScore += 3;
    if (/^:.*[;|<>\]\}]$/.test(l)) actScore += 3;
    if (/^\[\*\]\s*-+>|-+>\s*\[\*\]/.test(l)) stateScore += 4;
    if (/^state\s+/i.test(l)) stateScore += 3;
    if (/^(usecase|actor)\s+/i.test(l) || /\(\s*[^)]+\s*\)\s*(as\s+\w+)?$/.test(l) && !/[-.]/.test(l)) useScore += 2;
    if (/^(:[^:]+:|\([^)]+\))\s*-+>?\s*(:[^:]+:|\([^)]+\))/.test(l)) useScore += 3;
    if (/^(component|interface\s+"|\[[^\]]+\]\s*(as\s+\w+)?$|\(\)\s)/i.test(l)) compScore += 2;
    if (/^\[[^\]]+\]\s*[-.]+>?\s*\[?[^\]]*\]?/.test(l)) compScore += 2;
    if (/^(node|artifact|cloud|storage|hexagon|agent|boundary|card|collections|file|folder|frame|label|person|queue|stack)\s+/i.test(l)) compScore += 1;
  }

  const scores: [DiagramType, number][] = [
    ['class', classScore],
    ['object', objScore],
    ['sequence', seqScore],
    ['activity', actScore],
    ['state', stateScore],
    ['usecase', useScore],
    ['component', compScore],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [best, score] = scores[0];
  if (score === 0) {
    // No signal: lines of the form "A -- B" or "A : member" are class-ish.
    if (lines.some((l) => /\s(<\||\|>|\*--|--\*|o--|--o|-->|<--|--|\.\.>|<\.\.|\.\.\|>|<\|\.\.)\s/.test(l) || /^[\w"]+\s*:\s*[-+#~]/.test(l))) {
      return 'class';
    }
    return lines.length ? 'other' : 'class';
  }
  if (best === 'object') return 'class';
  return best;
}

export function isNativeType(t: DiagramType): boolean {
  return t === 'class' || t === 'object';
}
