import { config } from "./config.js";
import type { AIInput } from "./types.js";

const WORKER_PATH = new URL("./ai-worker.ts", import.meta.url).href;
const POOL_SIZE = 8;

export interface AIResult {
  targetAngle: number | null;
  error: string | null;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  resolve: ((result: AIResult) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const pool: PooledWorker[] = [];

function createPooledWorker(): PooledWorker {
  const pw: PooledWorker = {
    worker: new Worker(WORKER_PATH),
    busy: false,
    resolve: null,
    timer: null,
  };

  pw.worker.onmessage = (event: MessageEvent) => {
    if (pw.timer) clearTimeout(pw.timer);
    const res = pw.resolve;
    pw.resolve = null;
    pw.busy = false;
    res?.({
      targetAngle: event.data.targetAngle ?? null,
      error: event.data.error ?? null,
    });
  };

  pw.worker.onerror = (e) => {
    if (pw.timer) clearTimeout(pw.timer);
    const res = pw.resolve;
    pw.resolve = null;
    pw.busy = false;
    res?.({ targetAngle: null, error: String(e.message ?? e).slice(0, 200) });

    // Replace broken worker
    const idx = pool.indexOf(pw);
    if (idx !== -1) {
      pw.worker.terminate();
      pool[idx] = createPooledWorker();
    }
  };

  return pw;
}

// Initialize pool
for (let i = 0; i < POOL_SIZE; i++) {
  pool.push(createPooledWorker());
}

function getWorker(): PooledWorker | null {
  return pool.find(pw => !pw.busy) ?? null;
}

function runAI(aiFunction: string, input: AIInput): Promise<AIResult> {
  return new Promise((resolve) => {
    const pw = getWorker();
    if (!pw) {
      resolve({ targetAngle: null, error: null }); // go straight silently
      return;
    }

    pw.busy = true;
    pw.resolve = resolve;

    pw.timer = setTimeout(() => {
      pw.timer = null;
      const res = pw.resolve;
      pw.resolve = null;
      pw.busy = false;
      res?.({ targetAngle: null, error: "AI timed out (>50ms)" });

      // Replace timed-out worker (it may be stuck)
      const idx = pool.indexOf(pw);
      if (idx !== -1) {
        pw.worker.terminate();
        pool[idx] = createPooledWorker();
      }
    }, config.aiTimeoutMs);

    pw.worker.postMessage({ aiFunction, input });
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
