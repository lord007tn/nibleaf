import { Tokenizer } from 'parse5';

type Fields = Record<string, string | boolean | null>;
interface ReplayTokenizer {
  state: number;
  returnState: number;
  inForeignNode: boolean;
  lastStartTagName: string;
  currentAttr: Fields;
  currentToken: Fields;
  _createAttr(first: string): void;
  _leaveAttrName(): void;
  _leaveAttrValue(): void;
  _appendCharToCurrentCharacterToken(type: number, value: string): void;
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
  | { kind: 'characters'; type: number; parts: string[]; value: string };
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
  private plans = new Map<string, Map<number, Plan>>();
  analyses = 0;
  bytes = 0;

  apply(tokenizer: Tokenizer, value: string) {
    // parse5 is pinned to 7.3.0. Keep its protected tokenizer interop here;
    // the differential replay matrix checks this boundary against full parsing.
    const target = tokenizer as unknown as ReplayTokenizer;
    let contexts = this.plans.get(value);
    if (!contexts) this.plans.set(value, (contexts = new Map()));
    const context = target.state * 256 + target.returnState * 2 + Number(target.inForeignNode);
    let plan = contexts.get(context);
    if (!plan) {
      this.analyses++;
      this.bytes += value.length;
      const operations: Operation[] = [];
      const append = (object: Target, field: string, value: string) => {
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
              else operations.push({ kind: 'set', object, field, value });
              return true;
            },
          },
        );
      };
      const noop = () => {};
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
        operations.push({ kind: 'createAttr', first });
        compiler.currentAttr = recorded('currentAttr');
      };
      compiler._leaveAttrName = () => operations.push({ kind: 'leaveAttrName' });
      compiler._leaveAttrValue = () => operations.push({ kind: 'leaveAttrValue' });
      compiler._appendCharToCurrentCharacterToken = (type: number, chars: string) => {
        const previous = operations.at(-1);
        if (previous?.kind === 'characters' && previous.type === type) previous.parts.push(chars);
        else operations.push({ kind: 'characters', type, parts: [chars], value: '' });
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
    for (const operation of plan.operations) {
      switch (operation.kind) {
        case 'append': {
          const object = target[operation.object];
          const prefix = String(object[operation.field] ?? '');
          if (operation.names) {
            let combined = operation.names.get(prefix);
            if (combined === undefined) operation.names.set(prefix, (combined = prefix + operation.value));
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
        case 'characters':
          target._appendCharToCurrentCharacterToken(operation.type, operation.value);
          break;
      }
    }
    target.state = plan.state;
    target.returnState = plan.returnState;
  }
}
