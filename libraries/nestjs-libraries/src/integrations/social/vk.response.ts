import { BadBody, RefreshToken } from '../social.abstract';

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string };
};

export function unwrapVkResponse<T>(payload: unknown, method: string): T {
  const envelope = (payload || {}) as VkEnvelope<T>;
  if (envelope.error) {
    const code = Number(envelope.error.error_code || 0);
    const message = `VK ${method} failed with error ${code}`;
    if (code === 5) {
      throw new RefreshToken(
        'vk',
        JSON.stringify({ code }),
        {} as BodyInit,
        message
      );
    }
    throw new BadBody('vk', JSON.stringify({ code }), {} as BodyInit, message);
  }
  if (envelope.response === undefined || envelope.response === null) {
    throw new BadBody(
      'vk',
      '{}',
      {} as BodyInit,
      `VK ${method} returned no response`
    );
  }
  return envelope.response;
}

export function parseVkPositiveIntegerId(
  value: unknown,
  method: string,
  field: string
): string {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value)) {
    return value;
  }

  throw new BadBody(
    'vk',
    '{}',
    {} as BodyInit,
    `VK ${method} returned invalid ${field}`
  );
}
