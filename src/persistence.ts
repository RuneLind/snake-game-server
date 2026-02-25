import { resolve, dirname } from "path";
import { mkdirSync } from "fs";

const STATE_PATH = resolve(import.meta.dir, "../data/state.json");

// Ensure data directory exists on module load
mkdirSync(dirname(STATE_PATH), { recursive: true });

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
