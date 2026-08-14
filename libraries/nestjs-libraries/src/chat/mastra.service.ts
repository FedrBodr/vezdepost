import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { Injectable } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class MastraService {
  static mastra?: Mastra;
  private static mastraPromise?: Promise<Mastra>;

  constructor(private _loadToolsService: LoadToolsService) {}

  async mastra(): Promise<Mastra> {
    if (MastraService.mastra) {
      return MastraService.mastra;
    }

    if (!MastraService.mastraPromise) {
      const attempt = this.createMastra();
      MastraService.mastraPromise = attempt;
      void attempt.catch(() => {
        if (MastraService.mastraPromise === attempt) {
          MastraService.mastraPromise = undefined;
        }
      });
    }

    return MastraService.mastraPromise!;
  }

  private async createMastra(): Promise<Mastra> {
    await pStore.init();
    const mastra = new Mastra({
      storage: pStore,
      agents: {
        postiz: await this._loadToolsService.agent(),
      },
      logger: new ConsoleLogger({
        level: 'info',
      }),
    });
    MastraService.mastra = mastra;
    return mastra;
  }
}
