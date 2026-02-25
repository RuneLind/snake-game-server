import { config } from "./config.js";
import type { Direction, AIInput } from "./types.js";

const WORKER_PATH = new URL("./ai-worker.ts", import.meta.url).href;

export async function runAI(
  aiFunction: string,
  input: AIInput,
): Promise<Direction | null> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);

    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, config.aiTimeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data.direction ?? null);
    };

    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };

    worker.postMessage({ aiFunction, input });
  });
}

export async function runAllAIs(
  snakes: Array<{ id: string; aiFunction: string; input: AIInput }>,
): Promise<Map<string, Direction | null>> {
  const results = new Map<string, Direction | null>();
  const promises = snakes.map(async ({ id, aiFunction, input }) => {
    const direction = await runAI(aiFunction, input);
    results.set(id, direction);
  });
  await Promise.all(promises);
  return results;
}
