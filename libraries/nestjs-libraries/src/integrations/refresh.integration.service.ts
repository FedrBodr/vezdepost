import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(
    integration: Integration,
    cause = '',
    options: { scheduled?: boolean } = {}
  ): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(
      integration,
      socialProvider,
      cause,
      options
    );

    if (!refresh) {
      return false as const;
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      !!socialProvider.oneTimeToken,
      integration.organizationId,
      integration.name,
      integration.picture!,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn
    );

    return refresh;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    await this._integrationService.setBetweenRefreshSteps(integration.id);
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(
    orgId: string,
    id: string,
    integration: SocialProvider
  ) {
    if (!integration.refreshCron) {
      return false;
    }

    const client = this._temporalService.client.getRawClient();
    if (!client) {
      throw new Error('Temporal client is unavailable');
    }

    return client.workflow.start(`refreshTokenWorkflow`, {
      workflowId: `refresh_${id}`,
      args: [{ integrationId: id, organizationId: orgId }],
      taskQueue: 'main',
      workflowIdConflictPolicy: 'TERMINATE_EXISTING',
    });
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = '',
    options: { scheduled?: boolean } = {}
  ): Promise<AuthTokenDetails | false> {
    let refreshError: unknown;
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken)
      .catch((err) => {
        refreshError = err;
        return false as const;
      });

    if (!refresh || !refresh.accessToken) {
      console.error(
        `Refresh failed for ${integration.providerIdentifier} (${
          integration.id
        }): ${describeRefreshError(refreshError)}`
      );

      // The scheduled refresh runs before anything rejected the token, so a
      // provider-reported transient failure is rethrown for the activity
      // retry instead of disconnecting a channel whose token may still work.
      if (options.scheduled && isTransientRefreshError(refreshError)) {
        throw refreshError;
      }

      await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id
      );

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        cause
      );

      await this._integrationService.disconnectChannel(
        integration.organizationId,
        integration
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    const reConnect = await socialProvider.reConnect(
      integration.rootInternalId,
      integration.internalId,
      refresh.accessToken
    );

    return {
      ...refresh,
      ...reConnect,
    };
  }
}

const isTransientRefreshError = (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  (error as { transient?: unknown }).transient === true;

// Only the message and the provider's response body: the error details can
// also carry the token request body with the refresh token.
const describeRefreshError = (error: unknown) => {
  if (!error) {
    return 'no access token returned';
  }
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  const json = (error as { details?: Array<{ json?: unknown }> }).details?.[0]
    ?.json;
  return `${error.name}: ${error.message}${
    typeof json === 'string' && json !== '{}'
      ? ` response=${json.slice(0, 300)}`
      : ''
  }`;
};
