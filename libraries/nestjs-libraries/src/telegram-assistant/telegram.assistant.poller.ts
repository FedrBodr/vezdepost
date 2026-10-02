import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import type { TelegramAssistantRouter } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.router';

const LOCK_KEY = 'tg-assistant:poller';
const LOCK_TTL_MS = 60_000;
const LONG_POLL_SECONDS = 25;
const IDLE_MS = 30_000;
const ERROR_BACKOFF_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long-polls @vezde_post_bot. A Redis lock keeps a single consumer even if
 * several backend processes run.
 */
export class TelegramAssistantPoller {
  private offset: number | undefined;
  private running = false;

  constructor(
    private readonly api: Pick<TelegramAssistantApi, 'getUpdates'>,
    private readonly router: Pick<TelegramAssistantRouter, 'handle'>,
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
    const updates = await this.api.getUpdates(this.offset, LONG_POLL_SECONDS);
    for (const update of updates) {
      try {
        await this.router.handle(update);
      } catch (error) {
        console.error('[telegram-assistant] update failed:', error);
      }
      this.offset = update.update_id + 1;
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
        console.error('[telegram-assistant] polling failed:', error);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  stop() {
    this.running = false;
  }
}
