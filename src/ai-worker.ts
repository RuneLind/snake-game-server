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

    if (typeof result === "number" && isFinite(result)) {
      self.postMessage({ targetAngle: result });
    } else {
      self.postMessage({ targetAngle: null });
    }
  } catch {
    self.postMessage({ targetAngle: null });
  }
};
