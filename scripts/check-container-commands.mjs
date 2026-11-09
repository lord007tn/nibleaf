import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeServices = new Set(['server', 'worker', 'app', 'admin', 'migrate', 'analytics-migrate']);
// These executables come from the Node/Alpine base or the Dockerfile's apk list.
// runtime-image-audit also resolves every documented executable in the final image.
const runtimeExecutables = new Set(['node', 'sh', 'curl', 'git', 'openssl', '/bin/sh', '/usr/local/bin/node']);
const backingExecutables = { postgres: new Set(['psql', 'pg_dump', 'pg_restore']), dragonfly: new Set(['redis-cli']), maxio: new Set(['maxio']) };
const valuedOptions = new Set([
  '-e',
  '--env',
  '-u',
  '--user',
  '-w',
  '--workdir',
  '--index',
  '--detach-keys',
  '--entrypoint',
  '-p',
  '--publish',
  '-v',
  '--volume',
  '--name',
]);
const packageManager = /\b(?:pnpm|pnpx|npm|npx|corepack|yarn|yarnpkg)\b/;

const markdownFiles = (directory) =>
  existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = join(directory, entry.name);
        return entry.isDirectory() ? markdownFiles(file) : /\.mdx?$/.test(entry.name) ? [file] : [];
      })
    : [];

const shellWords = (line) =>
  [...line.matchAll(/(?:[^\s"'\\]+|\\.|"(?:\\.|[^"\\])*"|'[^']*')+/g)].map(([word]) => (/^(['"])[\s\S]*\1$/.test(word) ? word.slice(1, -1) : word));

export function checkContainerCommands(root = resolve(import.meta.dirname, '..')) {
  const entrypoint = readFileSync(join(root, 'docker-entrypoint.sh'), 'utf8');
  const subcommands = new Set([...entrypoint.matchAll(/^ {2}([a-z][a-z-]*)\)/gm)].map((match) => match[1]));
  const files = [
    join(root, 'README.md'),
    ...markdownFiles(join(root, 'docs')),
    ...markdownFiles(join(root, 'operations')),
    join(root, 'CHANGELOG.md'),
  ];
  const errors = [];
  const runtimeCommands = new Set();
  const documentedSubcommands = new Set();
  let checked = 0;
  for (const file of files) {
    const name = relative(root, file).replaceAll('\\', '/');
    // Published release instructions describe their retained images, which include pnpm.
    if (/^docs\/(?:ar\/)?releases\/v0-2-1\.mdx$/.test(name)) continue;
    let source = readFileSync(file, 'utf8');
    if (name === 'CHANGELOG.md') {
      const start = source.indexOf('## Unreleased');
      const end = source.indexOf('\n## ', start + 1);
      if (start < 0) errors.push(`${name}: missing Unreleased section`);
      source = start < 0 ? '' : source.slice(start, end < 0 ? undefined : end);
    }
    const lines = source
      .replace(/\\\r?\n\s*/g, ' ')
      .replaceAll('`', ' ')
      .split(/\r?\n/);
    for (const line of lines) {
      const start = line.search(/\bdocker\s+compose\s/);
      if (start < 0) continue;
      const words = shellWords(line.slice(start));
      const operation = words.findIndex((word) => word === 'exec' || word === 'run');
      if (operation < 0) continue;
      let position = operation + 1;
      while (words[position]?.startsWith('-')) {
        const option = words[position++];
        if (valuedOptions.has(option)) position++;
      }
      const service = words[position++];
      const command = words[position];
      if (!runtimeServices.has(service) && !Object.hasOwn(backingExecutables, service)) {
        errors.push(`${name}: unknown Compose service ${service}`);
        continue;
      }
      if (!command && words[operation] === 'run') continue;
      checked++;
      const fail = (reason) => errors.push(`${name}: ${service} ${command ?? '(missing command)'}: ${reason}`);
      if (!runtimeServices.has(service)) {
        if (!backingExecutables[service].has(command)) fail('not a declared backing-image executable');
        continue;
      }
      if (command === '/app/docker-entrypoint.sh') {
        const subcommand = words[position + 1];
        if (!subcommands.has(subcommand)) fail(`unknown entrypoint subcommand ${subcommand}`);
        else documentedSubcommands.add(subcommand);
        runtimeCommands.add(command);
      } else if (words[operation] === 'run' && subcommands.has(command)) {
        // Compose run passes this command to the image's ENTRYPOINT.
        runtimeCommands.add('/app/docker-entrypoint.sh');
        documentedSubcommands.add(command);
      } else if (!runtimeExecutables.has(command)) {
        fail('executable is not shipped; use /app/docker-entrypoint.sh with a supported subcommand');
      } else {
        runtimeCommands.add(command);
        if ((command === 'sh' || command === '/bin/sh') && packageManager.test(words.slice(position + 1).join(' '))) {
          fail('shell snippets must not invoke an unshipped package manager');
        }
      }
    }
  }
  return { errors, checked, runtimeCommands: [...runtimeCommands].sort(), documentedSubcommands: [...documentedSubcommands].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkContainerCommands();
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.checked} documented container commands.`);
  }
}
