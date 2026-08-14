import { PostgresStore } from '@mastra/pg';

export class RetryablePostgresStore extends PostgresStore {
  async init(): Promise<void> {
    try {
      await super.init();
    } catch (error) {
      // PostgresStore resets its private isInitialized flag on failure, but
      // MastraCompositeStore otherwise retains the rejected initialization
      // promise. Clear the protected cache so the same store and pool can retry.
      this.hasInitialized = null;
      throw error;
    }
  }
}

export const pStore = new RetryablePostgresStore({
  id: 'postiz-store',
  connectionString: process.env.DATABASE_URL!,
});
