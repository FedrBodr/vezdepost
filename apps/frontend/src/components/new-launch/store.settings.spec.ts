import { beforeEach, describe, expect, it } from 'vitest';
import { useLaunchStore } from './store';

const selectedIntegration = (
  id: string,
  settings: Record<string, unknown>
) => ({
  integration: { id } as never,
  settings,
});

describe('launch store selected integration settings', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
    useLaunchStore.setState({
      selectedIntegrations: [
        selectedIntegration('pinterest-account', {}),
        selectedIntegration('linkedin-account', { visibility: 'public' }),
      ],
    });
  });

  it('updates settings for only the matching selected destination', () => {
    useLaunchStore
      .getState()
      .setSelectedIntegrationSettings('pinterest-account', {
        board: 'board-1',
      });

    expect(useLaunchStore.getState().selectedIntegrations).toEqual([
      selectedIntegration('pinterest-account', { board: 'board-1' }),
      selectedIntegration('linkedin-account', { visibility: 'public' }),
    ]);
  });
});
