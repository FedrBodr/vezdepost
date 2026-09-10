import { describe, expect, it, vi } from 'vitest';
import { IntegrationRepository } from './integration.repository';

describe('IntegrationRepository VK Group finalization', () => {
  it('soft-retires the temporary row and transfers its OAuth root to a duplicate legacy row', async () => {
    const existingLegacyIntegration = {
      id: 'existing-signed-group-fixture',
      internalId: '-123',
      rootInternalId: '-123',
      organizationId: 'organization-fixture',
      providerIdentifier: 'vk-group',
      deletedAt: null,
    };
    const findUnique = vi.fn().mockResolvedValue(existingLegacyIntegration);
    const update = vi
      .fn()
      .mockResolvedValueOnce({ id: 'temporary-integration-fixture' })
      .mockResolvedValueOnce({
        ...existingLegacyIntegration,
        rootInternalId: 'vk-group-oauth:42',
      });
    const postsUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const integrationPrisma = {
      model: {
        integration: {
          findUnique,
          update,
        },
      },
    };
    const postsPrisma = {
      model: { post: { updateMany: postsUpdateMany } },
    };
    const repository = new IntegrationRepository(
      integrationPrisma as never,
      postsPrisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await repository.updateIntegration('temporary-integration-fixture', {
      organizationId: 'organization-fixture',
      internalId: '-123',
      rootInternalId: 'vk-group-oauth:42',
      providerIdentifier: 'vk-group',
      inBetweenSteps: false,
    });

    expect(postsUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { integrationId: 'temporary-integration-fixture' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'temporary-integration-fixture' },
        data: expect.objectContaining({
          internalId: expect.stringMatching(/^deleted_-123_/),
          deletedAt: expect.any(Date),
        }),
      })
    );
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'existing-signed-group-fixture' },
      data: {
        organizationId: 'organization-fixture',
        internalId: '-123',
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
        inBetweenSteps: false,
        disabled: false,
        deletedAt: null,
      },
    });
  });

  it('fails closed before mutating a duplicate row owned by another provider', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'unrelated-telegram-integration-fixture',
      internalId: '-123',
      organizationId: 'organization-fixture',
      providerIdentifier: 'telegram',
      deletedAt: null,
    });
    const update = vi.fn();
    const postsUpdateMany = vi.fn();
    const repository = new IntegrationRepository(
      {
        model: { integration: { findUnique, update } },
      } as never,
      {
        model: { post: { updateMany: postsUpdateMany } },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      repository.updateIntegration('temporary-integration-fixture', {
        organizationId: 'organization-fixture',
        internalId: '-123',
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
        inBetweenSteps: false,
      })
    ).rejects.toMatchObject({
      code: 'INTEGRATION_PROVIDER_CONFLICT',
    });

    expect(postsUpdateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('resolves an active finalized row by OAuth root, provider, and selected signed id', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'selected-signed-group-fixture',
    });
    const repository = new IntegrationRepository(
      {
        model: { integration: { findFirst } },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await repository.getIntegrationByRootInternalId(
      'organization-fixture',
      'vk-group-oauth:42',
      'vk-group',
      '-123'
    );

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: 'organization-fixture',
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
        internalId: '-123',
        deletedAt: null,
      },
    });
  });
});
