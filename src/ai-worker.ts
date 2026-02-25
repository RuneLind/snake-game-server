/// <reference lib="webworker" />

// This file runs inside a Bun Worker.
// It receives an AI function string + game state, executes it, and posts back the direction.

const FORBIDDEN = ["fetch", "require", "import", "process", "Bun", "Deno", "globalThis.process"];

declare var self: Worker;

self.onmessage = (event: MessageEvent) => {
  const { aiFunction, input } = event.data;
  try {
    // Strip dangerous globals
    let sanitized = aiFunction;
    for (const word of FORBIDDEN) {
      if (sanitized.includes(word)) {
        sanitized = sanitized.replaceAll(word, `/* blocked: ${word} */`);
      }
    }

    const safeInput = JSON.parse(JSON.stringify(input));
    const fn = new Function("state", sanitized + "\nreturn move(state);");
    const result = fn(safeInput);

    const validDirections = ["UP", "DOWN", "LEFT", "RIGHT"];
    if (validDirections.includes(result)) {
      self.postMessage({ direction: result });
    } else {
      self.postMessage({ direction: null });
    }
  } catch {
    self.postMessage({ direction: null });
  }
};
