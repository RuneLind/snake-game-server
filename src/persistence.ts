import { resolve } from "path";

const STATE_PATH = resolve(import.meta.dir, "../data/state.json");

export async function saveState(state: unknown): Promise<void> {
  try {
    await Bun.write(STATE_PATH, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

export async function loadSavedState(): Promise<unknown | null> {
  try {
    const file = Bun.file(STATE_PATH);
    if (!(await file.exists())) return null;
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.error("Failed to load state:", err);
    return null;
  }
}
