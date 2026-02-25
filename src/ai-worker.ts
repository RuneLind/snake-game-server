/// <reference lib="webworker" />

declare var self: Worker;

const FORBIDDEN = ["fetch", "require", "import", "process", "Bun", "Deno", "globalThis.process"];

// Helper functions injected into AI sandbox scope
const HELPERS = `
function angleTo(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}
function distTo(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
function distFromCenter(x, y) {
  return Math.sqrt(x * x + y * y);
}
`;

// Cache compiled functions by source
const fnCache = new Map<string, Function>();

function getOrCompile(aiFunction: string): Function {
  let fn = fnCache.get(aiFunction);
  if (fn) return fn;

  let sanitized = aiFunction;
  for (const word of FORBIDDEN) {
    if (sanitized.includes(word)) {
      sanitized = sanitized.replaceAll(word, `/* blocked: ${word} */`);
    }
  }
  fn = new Function("state", HELPERS + sanitized + "\nreturn move(state);");
  fnCache.set(aiFunction, fn);
  return fn;
}

function runOne(aiFunction: string, input: any): { targetAngle: number | null; error: string | null } {
  try {
    const fn = getOrCompile(aiFunction);
    const result = fn(input);

    if (typeof result === "number" && isFinite(result)) {
      return { targetAngle: result, error: null };
    }

    if (result && typeof result === "object" && typeof result.x === "number" && typeof result.y === "number") {
      const angle = Math.atan2(result.y - input.you.y, result.x - input.you.x);
      return { targetAngle: angle, error: null };
    }

    const got = result === null ? "null" : typeof result === "object" ? JSON.stringify(result).slice(0, 50) : String(result);
    return { targetAngle: null, error: `Invalid return: ${got}. Return a number (angle) or {x, y} (target point).` };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return { targetAngle: null, error: msg.slice(0, 200) };
  }
}

self.onmessage = (event: MessageEvent) => {
  const { batch } = event.data;
  if (batch) {
    // Batch mode: run all AIs and return all results
    const results: Array<{ id: string; targetAngle: number | null; error: string | null }> = [];
    for (const { id, aiFunction, input } of batch) {
      const r = runOne(aiFunction, input);
      results.push({ id, ...r });
    }
    self.postMessage({ batch: results });
    return;
  }

  // Legacy single mode
  const { aiFunction, input } = event.data;
  const r = runOne(aiFunction, input);
  self.postMessage(r);
};
