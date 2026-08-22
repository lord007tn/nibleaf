declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
}

declare module 'turndown/lib/turndown.browser.es.js' {
  import TurndownService from 'turndown';

  export default TurndownService;
}
