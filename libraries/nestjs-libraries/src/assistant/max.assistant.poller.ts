import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { MaxAssistantTransport } from '@gitroom/nestjs-libraries/assistant/max.assistant.transport';
import type { AssistantRouter } from '@gitroom/nestjs-libraries/assistant/assistant.router';
import { maxUpdateToEvent } from '@gitroom/nestjs-libraries/assistant/max.events';

const LOCK_KEY = 'max-assistant:poller';
const LOCK_TTL_MS = 60_000;
const LONG_POLL_SECONDS = 25;
const IDLE_MS = 5_000;
const ERROR_BACKOFF_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long-polls the MAX assistant bot. A Redis lock keeps a single consumer even
 * if several backend processes run; the key differs from the Telegram one.
 */
export class MaxAssistantPoller {
  private marker: number | undefined;
  private running = false;

  constructor(
    private readonly transport: Pick<MaxAssistantTransport, 'getUpdates'>,
    private readonly router: Pick<AssistantRouter, 'handle'>,
    private readonly store: KeyValueStore,
    private readonly instanceId: string
  ) {}

  private async holdLock() {
    const owner = await this.store.get(LOCK_KEY);
    if (owner && owner !== this.instanceId) {
      return false;
    }
    if (!owner) {
      const claimed = await this.store.set(
        LOCK_KEY,
        this.instanceId,
        'PX',
        LOCK_TTL_MS,
        'NX'
      );
      return claimed === 'OK';
    }
    await this.store.set(LOCK_KEY, this.instanceId, 'PX', LOCK_TTL_MS);
    return true;
  }

  /** One poll cycle; false when another instance owns the bot. */
  async runOnce() {
    if (!(await this.holdLock())) {
      return false;
    }
    const { updates, marker } = await this.transport.getUpdates(
      this.marker,
      LONG_POLL_SECONDS
    );
    for (const update of updates) {
      const event = maxUpdateToEvent(update);
      if (!event) {
        continue;
      }
      try {
        await this.router.handle(event);
      } catch (error) {
        console.error('[max-assistant] update failed:', error);
      }
    }
    if (marker !== undefined) {
      this.marker = marker;
    }
    return true;
  }

  async start() {
    this.running = true;
    while (this.running) {
      try {
        if (!(await this.runOnce())) {
          await sleep(IDLE_MS);
        }
      } catch (error) {
        console.error('[max-assistant] polling failed:', error);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  /** Stops polling and frees the lock for the next process (e.g. a deploy). */
  async stop() {
    this.running = false;
    if ((await this.store.get(LOCK_KEY)) === this.instanceId) {
      await this.store.del(LOCK_KEY);
    }
  }
}
