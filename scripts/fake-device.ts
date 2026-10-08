// Mimics the tronbyt firmware's WebSocket behaviour for testing without hardware:
// images are queued, the queued one replaces any older queued one, and each
// image plays whole loops until its dwell has elapsed.
//
//   npx tsx scripts/fake-device.ts ws://localhost:8000/device/ws [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import WebSocket from "ws";

const url = process.argv[2] ?? "ws://localhost:8000/device/ws";
const outDir = process.argv[3];
if (outDir) mkdirSync(outDir, { recursive: true });

let dwell = 5;
let counter = 0;
let queued: { buf: Buffer; dwell: number; n: number } | null = null;
let interrupt = false;

const ws = new WebSocket(url);
ws.on("open", () => {
  console.log("connected");
  ws.send(JSON.stringify({ client_info: { firmware_version: "fake", firmware_type: "ESP32", protocol_version: 1 } }));
});
ws.on("message", async (data, isBinary) => {
  if (!isBinary) {
    const msg = JSON.parse(String(data));
    if (msg.dwell_secs) dwell = msg.dwell_secs;
    if (msg.immediate) interrupt = true;
    if (msg.brightness !== undefined) console.log("brightness", msg.brightness);
    return;
  }
  const buf = data as Buffer;
  counter++;
  if (queued) console.log(`  dropped queued #${queued.n}`);
  queued = { buf, dwell, n: counter };
  ws.send(JSON.stringify({ queued: counter }));
});

async function loop() {
  for (;;) {
    if (!queued) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const cur = queued;
    queued = null;
    interrupt = false;
    ws.send(JSON.stringify({ displaying: cur.n }));
    const meta = await sharp(cur.buf, { animated: true }).metadata();
    const loopMs = (meta.delay ?? [0]).reduce((a, b) => a + b, 0) || 0;
    console.log(`displaying #${cur.n}: ${cur.buf.length} bytes, ${meta.pages ?? 1} frames, loop ${loopMs}ms, dwell ${cur.dwell}s`);
    if (outDir) writeFileSync(`${outDir}/${String(cur.n).padStart(3, "0")}.webp`, cur.buf);
    const start = Date.now();
    // Firmware: loop whole animations until dwell passes (static: hold for dwell).
    do {
      const step = loopMs || cur.dwell * 1000;
      const until = Date.now() + step;
      while (Date.now() < until && !interrupt) await new Promise((r) => setTimeout(r, 20));
      if (interrupt) break;
    } while (Date.now() - start < cur.dwell * 1000 && loopMs > 0);
    if (!queued) queued = cur; // keep looping the same image until a new one arrives
  }
}
void loop();
