import { useCallback, useRef } from 'react';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';

export type ConnectionType =
  | 'oauth'
  | 'web3'
  | 'external'
  | 'custom_fields'
  | 'browser_extension';

export type ConnectionStage = 'start' | 'callback' | 'two_step_save';

type ConnectionContext = {
  platform: string;
  connectionType: ConnectionType;
  invite: boolean;
  onboarding?: boolean;
  mobile?: boolean;
};

export type RequestSource =
  | 'channel_picker'
  | 'connection_error'
  | 'unavailable_channel';

export const useChannelConnectAnalytics = () => {
  const fireEvents = useFireEvents();
  const terminalCaptured = useRef(false);

  const captureConnection = useCallback(
    (
      event: 'channel_connect_clicked' | 'channel_connect_started',
      context: ConnectionContext
    ) => {
      fireEvents(event, {
        platform: context.platform,
        connection_type: context.connectionType,
        invite: context.invite,
        onboarding: context.onboarding ?? false,
        mobile: context.mobile ?? false,
      });
    },
    [fireEvents]
  );

  const clicked = useCallback(
    (context: ConnectionContext) =>
      captureConnection('channel_connect_clicked', context),
    [captureConnection]
  );

  const started = useCallback(
    (context: ConnectionContext) =>
      captureConnection('channel_connect_started', context),
    [captureConnection]
  );

  const failed = useCallback(
    (
      platform: string,
      stage: ConnectionStage,
      error: string,
      onboarding = false,
      mobile = false
    ) => {
      if (terminalCaptured.current) {
        return;
      }
      terminalCaptured.current = true;
      fireEvents('channel_connect_failed', {
        platform,
        stage,
        error,
        onboarding,
        mobile,
      });
    },
    [fireEvents]
  );

  const completed = useCallback(
    (platform: string, onboarding = false) => {
      if (terminalCaptured.current) {
        return;
      }
      terminalCaptured.current = true;
      fireEvents('channel_connect_completed', { platform, onboarding });
    },
    [fireEvents]
  );

  const requestClicked = useCallback(
    (platform: string, source: RequestSource) => {
      fireEvents('platform_request_clicked', { platform, source });
    },
    [fireEvents]
  );

  const resetTerminal = useCallback(() => {
    terminalCaptured.current = false;
  }, []);

  return { clicked, started, failed, completed, requestClicked, resetTerminal };
};
