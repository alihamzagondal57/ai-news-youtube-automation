import type { JobStore } from "@ai-news/shared";
import { z } from "zod";
import { config } from "./config.js";

/**
 * Job-independent state, same pattern as state/theme-rotation.json
 * (infra/render-server/src/themeSelection.ts): a bare R2 key, read-modify-write
 * with no lock — safe because this pipeline renders one video at a time.
 *
 * Unlike theme rotation this isn't a strict "never repeat" invariant — it's
 * soft guidance fed into the ranking prompt (see prompt.ts), because news
 * topics don't come from a fixed catalog the way themes do; the LLM has to
 * judge "substantially the same story" itself.
 */
export const TOPIC_HISTORY_KEY = "state/topic-history.json";

const topicHistorySchema = z.object({
  /** Most recent first. */
  recentTopics: z.array(z.string()),
});
export type TopicHistory = z.infer<typeof topicHistorySchema>;

export const EMPTY_TOPIC_HISTORY: TopicHistory = { recentTopics: [] };

export async function readTopicHistory(store: JobStore): Promise<TopicHistory> {
  return (await store.getJsonIfExists(TOPIC_HISTORY_KEY, topicHistorySchema)) ?? EMPTY_TOPIC_HISTORY;
}

export async function recordTopic(store: JobStore, history: TopicHistory, topic: string): Promise<void> {
  const next: TopicHistory = {
    recentTopics: [topic, ...history.recentTopics].slice(0, config.recentTopicsWindow),
  };
  await store.putJson(TOPIC_HISTORY_KEY, next);
}
