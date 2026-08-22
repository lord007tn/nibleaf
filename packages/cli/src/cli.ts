#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { CLI_VERSION, fetchMarkdown, inspectSite } from './index';

interface CliIo {
  out: (value: string) => void;
  error: (value: string) => void;
}

const HELP = `Nibleaf CLI ${CLI_VERSION}

Usage:
  nibleaf inspect <site-url> [--json]
  nibleaf fetch <page-url>

Commands:
  inspect  Check llms.txt, sitemap.xml, openapi.json, Markdown negotiation, and 404 behavior.
  fetch    Fetch a canonical public page with Accept: text/markdown.
`;

export async function runCli(args: string[], io: CliIo = { out: console.log, error: console.error }): Promise<number> {
  const [command, input, ...flags] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.out(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    io.out(CLI_VERSION);
    return 0;
  }
  if (!(input && ['inspect', 'fetch'].includes(command))) {
    io.error(HELP);
    return 2;
  }

  try {
    if (command === 'fetch') {
      const response = await fetchMarkdown(input);
      const body = await response.text();
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/markdown')) {
        io.error(`Expected Markdown but received HTTP ${response.status} (${response.headers.get('content-type') ?? 'unknown content type'}).`);
        return 1;
      }
      io.out(body.replace(/\n$/, ''));
      return 0;
    }

    const inspection = await inspectSite(input);
    if (flags.includes('--json')) {
      io.out(JSON.stringify(inspection, null, 2));
    } else {
      io.out(`Nibleaf agent-readiness inspection: ${inspection.baseUrl}`);
      for (const check of inspection.checks) {
        const detail = check.error ?? `HTTP ${check.status ?? 'unknown'}${check.contentType ? `, ${check.contentType}` : ''}`;
        io.out(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(9)} ${detail}`);
      }
    }
    return inspection.ok ? 0 : 1;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
