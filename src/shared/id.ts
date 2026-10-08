// crypto.randomUUID is unavailable on plain-http LAN origins, so roll our own.
export function uid(prefix = ""): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return prefix + s;
}
