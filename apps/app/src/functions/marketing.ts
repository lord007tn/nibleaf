import { createServerFn } from '@tanstack/react-start';
import { MARKETING_BUILD } from '@/lib/marketing-build';

// Loader state must be identical across requests, including a cold process.
export const getGithubStars = async () => MARKETING_BUILD.stars;
export const getGithubStarsFn = createServerFn({ method: 'GET' }).handler(getGithubStars);
