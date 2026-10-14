import { deflateRaw } from 'pako';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6bit(b: number): string {
  return ALPHABET[b & 0x3f];
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

/** Encodes PlantUML source using the server's deflate + custom base64 scheme. */
export function encodePlantUml(source: string): string {
  let text = source.trim();
  if (!/^@start/m.test(text)) text = `@startuml\n${text}\n@enduml`;
  const bytes = deflateRaw(new TextEncoder().encode(text), { level: 9 });
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += append3bytes(b1, b2, b3);
  }
  return out;
}

export function plantUmlUrl(server: string, source: string, format: 'svg' | 'png' = 'svg'): string {
  const base = server.replace(/\/+$/, '');
  return `${base}/${format}/${encodePlantUml(source)}`;
}
