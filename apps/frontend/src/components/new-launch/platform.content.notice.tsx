import React from 'react';
import type { EditorCapabilityDiagnosticV2 } from './platform.editor.capabilities';

export const PlatformContentNotice = ({
  diagnostics,
  onCustomize,
}: {
  diagnostics: readonly EditorCapabilityDiagnosticV2[];
  onCustomize?: (targetIntegrationId: string) => void;
}) => {
  const occurrences = new Map<string, number>();
  const keyedDiagnostics = diagnostics.map((diagnostic) => {
    const identity = JSON.stringify([
      diagnostic.targetIntegrationId || diagnostic.destination,
      diagnostic.variant,
      diagnostic.field,
      diagnostic.severity,
      diagnostic.code,
      diagnostic.message,
    ]);
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return { key: `${identity}-${occurrence}`, diagnostic };
  });

  return (
    <div className="flex flex-col gap-2">
      {keyedDiagnostics.map(({ key, diagnostic }) => {
        const isRecommendation =
          diagnostic.code === 'recommended-limit-exceeded';
        return (
          <div
            key={key}
            role={diagnostic.severity === 'error' ? 'alert' : 'status'}
            className={
              diagnostic.severity === 'error'
                ? 'rounded-md border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200'
                : diagnostic.severity === 'warning'
                ? 'rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200'
                : 'rounded-md border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-200'
            }
          >
            {isRecommendation && (
              <span className="me-1 font-semibold">Recommended:</span>
            )}
            {diagnostic.targetIntegrationId && `${diagnostic.destination}: `}
            {diagnostic.message}
            {diagnostic.targetIntegrationId &&
              diagnostic.severity === 'warning' &&
              onCustomize && (
                <button
                  type="button"
                  className="ms-2 underline"
                  onClick={() => onCustomize(diagnostic.targetIntegrationId!)}
                >
                  Customize for {diagnostic.destination}
                </button>
              )}
          </div>
        );
      })}
    </div>
  );
};
