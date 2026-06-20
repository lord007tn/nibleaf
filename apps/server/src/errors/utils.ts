import type { DescribeRouteOptions } from 'hono-openapi';

/** Reusable OpenAPI error responses to spread into route configs. */
export const errorResponses: DescribeRouteOptions['responses'] = {
  400: { description: 'Bad request' },
  401: { description: 'Unauthorized' },
  403: { description: 'Forbidden' },
  404: { description: 'Not found' },
  422: { description: 'Validation failed' },
  429: { description: 'Rate limited' },
  500: { description: 'Internal server error' },
};
