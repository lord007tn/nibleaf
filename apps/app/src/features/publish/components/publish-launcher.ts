import { createContext, useContext } from 'react';

/** Opens the site top bar's publish sheet from a page of the site shell
 *  (Overview's activity line, the Publishes page's draft row). Null outside
 *  the shell, or before the site has loaded; callers then link to
 *  `editor?publish=true` instead. Provided by `ProjectLayout`. */
export const PublishLauncherContext = createContext<(() => void) | null>(null);
export const usePublishLauncher = () => useContext(PublishLauncherContext);
