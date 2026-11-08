import { createContext, useContext } from 'react';

/** What a marketing page's `load` receives: its path parameters (`slug`). */
export interface MarketingLoadInput {
  params: Record<string, string>;
}

export interface MarketingPageContext {
  data: unknown;
  params: Record<string, string>;
}

export const MarketingDataContext = createContext<MarketingPageContext>({ data: undefined, params: {} });

/** The data the page's `load` returned (`useMarketingData<typeof load>()`). */
export const useMarketingData = <Load extends (input: MarketingLoadInput) => Promise<unknown>>(): Awaited<ReturnType<Load>> =>
  useContext(MarketingDataContext).data as Awaited<ReturnType<Load>>;

/** The page's path parameters, such as a blog article's `slug`. */
export const useMarketingParams = (): Record<string, string> => useContext(MarketingDataContext).params;
