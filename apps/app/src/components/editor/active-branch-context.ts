import { createContext, useContext } from 'react';

/** The docs version (branch) the editor is working on. Page lookups inside the
 *  editor (link picker…) read it so they search the same version as the page tree.
 *  `undefined` outside the editor, which the API treats as the default version. */
export const ActiveBranchContext = createContext<string | undefined>(undefined);

export const useActiveBranchId = () => useContext(ActiveBranchContext);
