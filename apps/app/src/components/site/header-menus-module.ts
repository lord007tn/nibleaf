import { intentModule } from '@/lib/intent-module';

/** The header's language and version menus. Their Base UI menu loads when a
 *  reader reaches for one (see lib/intent-module.ts). */
export const headerMenusModule = intentModule(() => import('./header-menus'));
