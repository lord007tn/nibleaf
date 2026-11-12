import { oauthAssistantSetup } from './setup';

/** The apps the Connect card offers, in the order shown. */
export const ASSISTANT_CLIENTS = ['chatgpt', 'claude', 'claudeCode', 'cursor', 'vscode'] as const;
export type AssistantClient = (typeof ASSISTANT_CLIENTS)[number];

/** Product names stay in Latin script in every language. */
export const CLIENT_NAMES: Record<AssistantClient, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  claudeCode: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code',
};

/** ChatGPT and the claude.ai / Claude Desktop connectors can only sign in; they never take a key. */
const SIGN_IN_ONLY: ReadonlySet<AssistantClient> = new Set(['chatgpt', 'claude']);

export type ClientChoice = { client: AssistantClient; disabledReason: 'needsHttps' | null };

export const clientChoices = (signIn: boolean): ClientChoice[] =>
  ASSISTANT_CLIENTS.map((client) => ({ client, disabledReason: !signIn && SIGN_IN_ONLY.has(client) ? 'needsHttps' : null }));

export const defaultClient = (signIn: boolean): AssistantClient => (signIn ? 'chatgpt' : 'claudeCode');

/** The clients a personal key can be set up for, with the key setup panel's ids. */
export const KEY_CLIENTS = ['claudeCode', 'desktop', 'cursor', 'vscode'] as const;
export type KeyClient = (typeof KEY_CLIENTS)[number];
export const KEY_CLIENT_NAMES: Record<KeyClient, string> = {
  claudeCode: 'Claude Code',
  desktop: 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
};
/** The key panel opens on the app chosen in Connect when it takes a key. */
export const keyClientFor = (client: AssistantClient): KeyClient =>
  client === 'cursor' || client === 'vscode' || client === 'claudeCode' ? client : 'claudeCode';

type StepText =
  | 'chatgptMenu'
  | 'chatgptCreate'
  | 'claudeMenu'
  | 'claudePaste'
  | 'claudeCodeRun'
  | 'claudeCodeAuth'
  | 'cursorInstall'
  | 'vscodeInstall'
  | 'editorConfig'
  | 'signIn'
  | 'useKey';

/**
 * One numbered step. `text` names its sentence. A menu path is never put
 * inside the sentence: in Arabic the bidi algorithm reorders English menu
 * names and arrows around it. `menu` is drawn as its own left-to-right line.
 */
export interface ConnectStep {
  text: StepText;
  menu?: readonly string[];
  copy?: { kind: 'url' | 'command' | 'config'; value: string; file?: string };
  install?: { href: string; client: 'cursor' | 'vscode' };
  /** The step's button opens the personal-key dialog. */
  createKey?: true;
}

/** How to connect `client`: sign-in steps when the server can sign apps in, otherwise the personal-key route. */
export function connectSteps(client: AssistantClient, input: { endpoint: string; signIn: boolean }): ConnectStep[] {
  const { endpoint, signIn } = input;
  if (!signIn) return SIGN_IN_ONLY.has(client) ? [] : [{ text: 'useKey', createKey: true }];
  const setup = oauthAssistantSetup(endpoint);
  const url = { kind: 'url' as const, value: endpoint };
  switch (client) {
    case 'chatgpt':
      return [{ text: 'chatgptMenu', menu: ['Settings', 'Apps & Connectors'] }, { text: 'chatgptCreate', copy: url }, { text: 'signIn' }];
    case 'claude':
      return [
        { text: 'claudeMenu', menu: ['Settings', 'Connectors', 'Add custom connector'] },
        { text: 'claudePaste', copy: url },
        { text: 'signIn' },
      ];
    case 'claudeCode':
      return [
        { text: 'claudeCodeRun', copy: { kind: 'command', value: setup.claudeCode } },
        { text: 'claudeCodeAuth', menu: ['/mcp', 'nibleaf', 'Authenticate'] },
        { text: 'signIn' },
      ];
    case 'cursor':
      return [
        { text: 'cursorInstall', install: { href: setup.cursorLink, client: 'cursor' } },
        { text: 'editorConfig', copy: { kind: 'config', value: setup.editors, file: '.cursor/mcp.json' } },
        { text: 'signIn' },
      ];
    default:
      // vscode: the last client, so the switch stays exhaustive.
      return [
        { text: 'vscodeInstall', install: { href: setup.vscodeLink, client: 'vscode' } },
        { text: 'editorConfig', copy: { kind: 'config', value: setup.vscode, file: '.vscode/mcp.json' } },
        { text: 'signIn' },
      ];
  }
}
