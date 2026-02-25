import { config } from "./config.js";
import type { AIInput } from "./types.js";

const WORKER_PATH = new URL("./ai-worker.ts", import.meta.url).href;

export interface AIResult {
  targetAngle: number | null;
  error: string | null;
}

// Use a small pool of batch workers (round-robin)
const POOL_SIZE = 4;

interface BatchWorker {
  worker: Worker;
  busy: boolean;
  resolve: ((results: Map<string, AIResult>) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const pool: BatchWorker[] = [];
let nextWorker = 0;

function createBatchWorker(): BatchWorker {
  const bw: BatchWorker = {
    worker: new Worker(WORKER_PATH),
    busy: false,
    resolve: null,
    timer: null,
  };

  bw.worker.onmessage = (event: MessageEvent) => {
    if (bw.timer) clearTimeout(bw.timer);
    const res = bw.resolve;
    bw.resolve = null;
    bw.busy = false;

    const results = new Map<string, AIResult>();
    if (event.data.batch) {
      for (const r of event.data.batch) {
        results.set(r.id, { targetAngle: r.targetAngle ?? null, error: r.error ?? null });
      }
    }
    res?.(results);
  };

  bw.worker.onerror = (e) => {
    if (bw.timer) clearTimeout(bw.timer);
    const res = bw.resolve;
    bw.resolve = null;
    bw.busy = false;
    res?.(new Map());

    // Replace broken worker
    const idx = pool.indexOf(bw);
    if (idx !== -1) {
      bw.worker.terminate();
      pool[idx] = createBatchWorker();
    }
  };

  return bw;
}

// Initialize pool
for (let i = 0; i < POOL_SIZE; i++) {
  pool.push(createBatchWorker());
}

export async function runAllAIs(
  snakes: Array<{ id: string; aiFunction: string; input: AIInput }>,
): Promise<Map<string, AIResult>> {
  if (snakes.length === 0) return new Map();

  // Split snakes across workers
  const chunks: Array<typeof snakes> = Array.from({ length: POOL_SIZE }, () => []);
  for (let i = 0; i < snakes.length; i++) {
    chunks[i % POOL_SIZE].push(snakes[i]);
  }

  const allResults = new Map<string, AIResult>();

  const promises = chunks.map((chunk, i) => {
    if (chunk.length === 0) return Promise.resolve();
    const bw = pool[i];

    // If worker is still busy from a stuck tick, skip it
    if (bw.busy) {
      for (const s of chunk) {
        allResults.set(s.id, { targetAngle: null, error: "Worker busy" });
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      bw.busy = true;
      bw.resolve = (results) => {
        for (const [id, r] of results) allResults.set(id, r);
        resolve();
      };

      bw.timer = setTimeout(() => {
        bw.timer = null;
        const res = bw.resolve;
        bw.resolve = null;
        bw.busy = false;
        // Return empty results for timed-out snakes
        for (const s of chunk) {
          allResults.set(s.id, { targetAngle: null, error: "AI batch timed out" });
        }
        res?.(new Map());

        // Replace stuck worker
        const idx = pool.indexOf(bw);
        if (idx !== -1) {
          bw.worker.terminate();
          pool[idx] = createBatchWorker();
        }
      }, config.aiTimeoutMs * 2 + 50); // Allow time for all AIs in batch

      bw.worker.postMessage({
        batch: chunk.map(s => ({ id: s.id, aiFunction: s.aiFunction, input: s.input })),
      });
    });
  });

  await Promise.all(promises);
  return allResults;
}
