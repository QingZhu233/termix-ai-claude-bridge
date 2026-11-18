import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * Images the user pastes into the assistant.
 *
 * The Claude CLI runs on this machine, so it cannot receive bytes over the
 * wire: the files are written to a folder of our own, the prompt names them,
 * and the model reads each one with its own Read tool. The same files back the
 * conversation, so reopening a thread still shows the pictures.
 */

const MAX_IMAGES = 4;
const MAX_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;
const MARKER = /<!--ai-images:([^>]*)-->/;

export interface StoredImage {
  path: string;
  name: string;
}

export function imageDir(): string {
  const dir = join(homedir(), ".termix-ai", "images");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function persistImages(images: unknown): StoredImage[] {
  if (!Array.isArray(images)) return [];
  const dir = imageDir();

  const stored: StoredImage[] = [];
  for (const entry of images.slice(0, MAX_IMAGES)) {
    if (typeof entry !== "string") continue;
    const match = DATA_URL.exec(entry.trim());
    if (!match) continue;
    const bytes = Buffer.from(match[3], "base64");
    if (bytes.length === 0 || bytes.length > MAX_BYTES) continue;
    const ext = match[2].toLowerCase() === "jpg" ? "jpeg" : match[2].toLowerCase();
    const name = `${randomUUID()}.${ext}`;
    writeFileSync(join(dir, name), bytes);
    stored.push({ path: join(dir, name), name });
  }
  return stored;
}

/** Names the files in the prompt so the model knows where to look. */
export function withImages(message: string, images: StoredImage[]): string {
  if (images.length === 0) return message;
  const list = images.map((image) => `- ${image.path}`).join("\n");
  return `${message}\n\n[The user attached ${images.length} image(s), saved on this machine. Read each path with the Read tool before answering:\n${list}]`;
}

/** What gets stored: the words, plus the names so the thread can show them. */
export function storeContent(message: string, images: StoredImage[]): string {
  if (images.length === 0) return message;
  const names = images.map((image) => image.name).join(",");
  return `${message}\n\n<!--ai-images:${names}-->`;
}

export function splitImages(content: string): { text: string; names: string[] } {
  const match = MARKER.exec(content);
  if (!match) return { text: content, names: [] };
  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[0-9a-f-]{36}\.(png|jpeg|webp|gif)$/i.test(name));
  return { text: content.replace(MARKER, "").trim(), names };
}

/** The panel needs bytes it can put in an <img>, so these come back inline. */
export function readImageDataUrls(names: string[]): string[] {
  if (names.length === 0) return [];
  const dir = imageDir();
  const urls: string[] = [];
  for (const name of names) {
    try {
      const bytes = readFileSync(join(dir, name));
      const ext = name.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpeg" ? "jpeg" : ext;
      urls.push(`data:image/${mime};base64,${bytes.toString("base64")}`);
    } catch {
      // A deleted file simply drops out of the transcript.
    }
  }
  return urls;
}
