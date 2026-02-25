import { config } from "./config.js";
import type { AIInput } from "./types.js";

const WORKER_PATH = new URL("./ai-worker.ts", import.meta.url).href;

export interface AIResult {
  targetAngle: number | null;
  error: string | null;
}

export async function runAI(
  aiFunction: string,
  input: AIInput,
): Promise<AIResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ targetAngle: null, error: "AI timed out (>50ms)" });
    }, config.aiTimeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({
        targetAngle: event.data.targetAngle ?? null,
        error: event.data.error ?? null,
      });
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ targetAngle: null, error: String(e.message ?? e).slice(0, 200) });
    };

    worker.postMessage({ aiFunction, input });
  });
}

export async function runAllAIs(
  snakes: Array<{ id: string; aiFunction: string; input: AIInput }>,
): Promise<Map<string, AIResult>> {
  const results = new Map<string, AIResult>();
  const promises = snakes.map(async ({ id, aiFunction, input }) => {
    const result = await runAI(aiFunction, input);
    results.set(id, result);
  });
  await Promise.all(promises);
  return results;
}
