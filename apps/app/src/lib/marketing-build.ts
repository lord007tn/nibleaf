// Replaced by Vite once per build, shared by SSR and hydration. Unit tests use
// the fixed fallback rather than their wall clock.
declare const __MARKETING_BUILD__: { year: number; stars: number };
export const MARKETING_BUILD = typeof __MARKETING_BUILD__ === 'undefined' ? { year: 2026, stars: 0 } : __MARKETING_BUILD__;
