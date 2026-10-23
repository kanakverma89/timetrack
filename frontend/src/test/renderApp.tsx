import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../app/App';
import { createQueryClient } from '../app/queryClient';

export function renderApp(route = '/') {
  const client = createQueryClient();
  // Tests must not wait for retry back-off.
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <App client={client} />
    </MemoryRouter>,
  );
  return { client, ...view };
}
