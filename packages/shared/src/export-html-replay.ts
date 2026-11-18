import { Tokenizer } from 'parse5';

type Fields = Record<string, string | boolean | null>;
interface ReplayTokenizer {
  state: number;
  returnState: number;
  inForeignNode: boolean;
  lastStartTagName: string;
  currentAttr: Fields;
  currentToken: Fields;
  runStart: number;
  runEnd: number;
  preprocessor: { html: string };
  _createAttr(first: string): void;
  _leaveAttrName(): void;
  _leaveAttrValue(): void;
  _ensureCharacterToken(type: number): void;
  _flushRun(text: string): void;
  write(value: string, last: boolean): void;
  pause(): void;
  _callState(codePoint: number): void;
}
type Target = 'currentAttr' | 'currentToken';
type Operation =
  | { kind: 'append'; object: Target; field: string; parts: string[]; value: string; names?: Map<string, string> }
  | { kind: 'set'; object: Target; field: string; value: string | boolean | null }
  | { kind: 'createAttr'; first: string }
  | { kind: 'leaveAttrName' | 'leaveAttrValue' }
  | { kind: 'characterType'; type: number }
  | { kind: 'text'; parts: string[]; value: string };
interface Plan {
  state: number;
  returnState: number;
  operations: Operation[];
}

// Generated attribute values have no literal angle brackets or double quotes.
// Replay their tokenizer operations, rather than expanding a shared definition
// into the HTML buffer once per reference. Tree construction still runs on the
// real parser, in its current context; duplicate attributes are resolved there.
export class AttributeReplay {
  private readonly plans = new Map<string, Map<number, Plan>>();
  analyses = 0;
  bytes = 0;

  apply(tokenizer: Tokenizer, value: string) {
    // parse5 is pinned to 8.1.1. Keep its protected tokenizer interop here;
    // the differential replay matrix checks this boundary against full parsing.
    const target = tokenizer as unknown as ReplayTokenizer;
    let contexts = this.plans.get(value);
    if (!contexts) {
      contexts = new Map();
      this.plans.set(value, contexts);
    }
    const context = target.state * 256 + target.returnState * 2 + Number(target.inForeignNode);
    let plan = contexts.get(context);
    if (!plan) {
      this.analyses++;
      this.bytes += value.length;
      const operations: Operation[] = [];
      // parse5 buffers attribute values, comment data and character tokens as
      // a run of input offsets. Record each flushed run as text: the offsets
      // mean nothing in the real tokenizer's buffer, which never holds the value.
      const flushRun = (text: string) => {
        const run = compiler.preprocessor.html.slice(compiler.runStart, compiler.runEnd) + text;
        compiler.runStart = compiler.runEnd;
        if (!run) return;
        const previous = operations.at(-1);
        if (previous?.kind === 'text') previous.parts.push(run);
        else operations.push({ kind: 'text', parts: [run], value: '' });
      };
      const record = (operation: Operation) => {
        flushRun('');
        operations.push(operation);
      };
      const append = (object: Target, field: string, value: string) => {
        flushRun('');
        const previous = operations.at(-1);
        if (previous?.kind === 'append' && previous.object === object && previous.field === field) previous.parts.push(value);
        else operations.push({ kind: 'append', object, field, parts: [value], value: '' });
      };
      const recorded = (object: Target): Fields => {
        const reads = new Set<string>();
        return new Proxy<Fields>(
          {},
          {
            get: (_object, field: string | symbol) => {
              reads.add(String(field));
              return '';
            },
            set: (_object, property: string | symbol, value: string | boolean | null) => {
              const field = String(property);
              if (typeof value === 'string' && reads.delete(field)) append(object, field, value);
              else record({ kind: 'set', object, field, value });
              return true;
            },
          },
        );
      };
      const noop = () => {
        /* Compilation records operations without building a tree. */
      };
      const compiler = new Tokenizer(
        { sourceCodeLocationInfo: false },
        {
          onStartTag: noop,
          onEndTag: noop,
          onComment: noop,
          onDoctype: noop,
          onCharacter: noop,
          onWhitespaceCharacter: noop,
          onNullCharacter: noop,
          onEof: noop,
        },
      ) as unknown as ReplayTokenizer;
      compiler.state = target.state;
      compiler.returnState = target.returnState;
      compiler.inForeignNode = target.inForeignNode;
      compiler.lastStartTagName = target.lastStartTagName;
      compiler.currentAttr = recorded('currentAttr');
      compiler.currentToken = recorded('currentToken');
      compiler._createAttr = (first: string) => {
        record({ kind: 'createAttr', first });
        compiler.currentAttr = recorded('currentAttr');
      };
      compiler._leaveAttrName = () => record({ kind: 'leaveAttrName' });
      compiler._leaveAttrValue = () => record({ kind: 'leaveAttrValue' });
      compiler._flushRun = flushRun;
      // The compiler never holds a character token, so parse5 asks for one at
      // every code point. Only a change of type reaches the real tokenizer.
      let characterType: number | undefined;
      compiler._ensureCharacterToken = (type: number) => {
        if (type === characterType) return;
        characterType = type;
        record({ kind: 'characterType', type });
      };
      // Finish a trailing surrogate without executing the EOF state. Values
      // are HTML-escaped, so an unfinished character reference cannot cross
      // this boundary; the real render follows it with a closing quote.
      const callState = compiler._callState.bind(compiler);
      compiler._callState = (codePoint) => {
        if (codePoint === -1) compiler.pause();
        else callState(codePoint);
      };
      compiler.write(value, true);
      flushRun('');
      for (const operation of operations) {
        if ('parts' in operation) {
          operation.value = operation.parts.join('');
          operation.parts = [];
        }
        if (operation.kind === 'append' && operation.field === 'name') operation.names = new Map();
      }
      plan = { state: compiler.state, returnState: compiler.returnState, operations };
      contexts.set(context, plan);
    }
    // Input already consumed comes first, whatever the plan writes next.
    target._flushRun('');
    for (const operation of plan.operations) {
      switch (operation.kind) {
        case 'append': {
          const object = target[operation.object];
          const prefix = String(object[operation.field] ?? '');
          if (operation.names) {
            let combined = operation.names.get(prefix);
            if (combined === undefined) {
              combined = prefix + operation.value;
              operation.names.set(prefix, combined);
            }
            object[operation.field] = combined;
          } else object[operation.field] = prefix + operation.value;
          break;
        }
        case 'set':
          target[operation.object][operation.field] = operation.value;
          break;
        case 'createAttr':
          target._createAttr(operation.first);
          break;
        case 'leaveAttrName':
          target._leaveAttrName();
          break;
        case 'leaveAttrValue':
          target._leaveAttrValue();
          break;
        case 'characterType':
          target._ensureCharacterToken(operation.type);
          break;
        case 'text':
          target._flushRun(operation.value);
          break;
        default:
          break;
      }
    }
    target.state = plan.state;
    target.returnState = plan.returnState;
  }
}
