import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useMemo } from 'react';
import { scalarOpenApiConfiguration } from '@/lib/openapi-reference';

/** Scalar owns endpoint/schema rendering and the browser-only try-it client.
 *  No proxy or authentication defaults are provided, and persistAuth is false,
 *  so reader credentials never reach Nibleaf storage or server logs. */
export function OpenApiReferenceView({ projectId }: { projectId: string }) {
  const configuration = useMemo(() => scalarOpenApiConfiguration(projectId), [projectId]);
  return (
    <div className="-mx-4 sm:-mx-6 lg:-ms-10" data-testid="openapi-reference">
      <ApiReferenceReact configuration={configuration} />
    </div>
  );
}
