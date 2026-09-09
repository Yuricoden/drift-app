import { env } from '../env';
import { getStore, type Store } from '../db';
import { gateway, LlmError, type ChatOptions, type ChatResult, type Gateway } from './openrouter';
import { ResearchError } from '../research/errors';

/** Shares the monthly spending ledger with Trend Research. Unknown costs keep
 * the conservative reservation. Every paid attempt, including retry, reserves. */
export async function analysisChat(options: ChatOptions, deps: { gateway?: Gateway; store?: () => Promise<Store> } = {}): Promise<ChatResult> {
  const store = await (deps.store ?? getStore)();
  const gw = deps.gateway ?? gateway;
  for (let attempt = 0; ; attempt++) {
    const month = new Date().toISOString().slice(0, 7);
    const reserve = 50000;
    const limit = Math.floor(env.researchMonthlyBudget * 1000000);
    await store.trendUsage.insertIfAbsent({ month }, { month, charged: 0 });
    for (;;) {
      const usage = await store.trendUsage.findOne({ month });
      if (!Number.isFinite(limit) || usage.charged + reserve > limit) throw new ResearchError('budget', 'Monthly research and analysis budget reached. Saved results are unchanged.');
      if (await store.trendUsage.compareAndSet({ month, charged: usage.charged }, { charged: usage.charged + reserve })) break;
    }
    try {
      const result = await gw.chat({ ...options, retry: false });
      if (result.cost !== null && Number.isFinite(result.cost) && result.cost >= 0) {
        const adjustment = Math.ceil(result.cost * 1000000) - reserve;
        for (;;) {
          const usage = await store.trendUsage.findOne({ month });
          if (await store.trendUsage.compareAndSet({ month, charged: usage.charged }, { charged: usage.charged + adjustment })) break;
        }
      }
      return result;
    } catch (error) {
      if (attempt === 0 && error instanceof LlmError && ['timeout', 'transient'].includes(error.kind)) continue;
      throw error;
    }
  }
}
