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

self.onmessage = (event: MessageEvent) => {
  const { aiFunction, input } = event.data;
  try {
    let sanitized = aiFunction;
    for (const word of FORBIDDEN) {
      if (sanitized.includes(word)) {
        sanitized = sanitized.replaceAll(word, `/* blocked: ${word} */`);
      }
    }

    const safeInput = JSON.parse(JSON.stringify(input));
    const fn = new Function("state", HELPERS + sanitized + "\nreturn move(state);");
    const result = fn(safeInput);

    // Accept a number (angle in radians)
    if (typeof result === "number" && isFinite(result)) {
      self.postMessage({ targetAngle: result, error: null });
      return;
    }

    // Accept {x, y} target point — convert to angle from snake head
    if (result && typeof result === "object" && typeof result.x === "number" && typeof result.y === "number") {
      const angle = Math.atan2(result.y - input.you.y, result.x - input.you.x);
      self.postMessage({ targetAngle: angle, error: null });
      return;
    }

    // Invalid return value
    const got = result === null ? "null" : typeof result === "object" ? JSON.stringify(result).slice(0, 50) : String(result);
    self.postMessage({ targetAngle: null, error: `Invalid return: ${got}. Return a number (angle) or {x, y} (target point).` });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    self.postMessage({ targetAngle: null, error: msg.slice(0, 200) });
  }
};
