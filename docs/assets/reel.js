// Plays the starter deck on the landing page's LED panel, drawn like the
// editor's LED view, with a timeline strip underneath that follows along.
const W = 64;
const H = 32;

export async function playReel(root, name = "reel") {
  const panel = root.querySelector("[data-panel]");
  const glow = root.querySelector("[data-glow]");
  const track = root.querySelector("[data-track]");
  const head = root.querySelector("[data-playhead]");
  const toggle = root.querySelector("[data-toggle]");
  const base = new URL(".", import.meta.url);

  const [meta, sheet] = await Promise.all([fetch(new URL(`${name}.json`, base)).then((r) => r.json()), loadImage(new URL(`${name}.png`, base))]);
  const pixels = readPixels(sheet);
  const starts = [];
  meta.delays.reduce((t, d) => (starts.push(t), t + d), 0);
  const total = meta.durationMs;

  // The timeline strip: one block per slide, as long as it plays.
  track.innerHTML = "";
  const blocks = meta.slides.map((s, i) => {
    const end = meta.slides[i + 1]?.start ?? total;
    const b = document.createElement("button");
    b.className = "reel-slide";
    b.style.flexGrow = String(end - s.start);
    b.innerHTML = `<span class="reel-name">${s.name}</span>${s.transition ? `<span class="reel-tr">${s.transition}</span>` : ""}`;
    b.title = `Jump to ${s.name}`;
    b.addEventListener("click", () => seek(s.start + 1));
    track.append(b);
    return b;
  });
  track.append(head);

  const ctx = panel.getContext("2d");
  const gctx = glow.getContext("2d");
  glow.width = W;
  glow.height = H;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !still;
  let offset = 0; // ms into the reel when paused, or the clock time playback started from
  let startedAt = performance.now();
  let shown = -1;

  function size() {
    const r = panel.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    panel.width = Math.round(r.width * dpr);
    panel.height = Math.round(r.width * dpr * (H / W));
    shown = -1;
  }
  new ResizeObserver(size).observe(panel);
  size();

  function now() {
    return playing ? (offset + performance.now() - startedAt) % total : offset;
  }
  function seek(t) {
    offset = t;
    startedAt = performance.now();
    shown = -1;
    if (!playing) draw(t);
  }
  toggle.addEventListener("click", () => {
    if (playing) offset = now();
    else startedAt = performance.now();
    playing = !playing;
    toggle.setAttribute("aria-pressed", String(!playing));
    toggle.textContent = playing ? "Pause" : "Play";
  });
  toggle.textContent = playing ? "Pause" : "Play";

  function frameAt(t) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function draw(t) {
    const n = frameAt(t);
    head.style.left = `${(t / total) * 100}%`;
    const current = meta.slides.findLastIndex((s) => s.start <= t);
    blocks.forEach((b, i) => b.classList.toggle("on", i === current));
    if (n === shown) return;
    shown = n;
    paint(n);
  }

  function paint(n) {
    const ox = (n % meta.cols) * W;
    const oy = Math.floor(n / meta.cols) * H;
    const zoom = panel.width / W;
    const r = zoom * 0.31;
    ctx.fillStyle = "#07080a";
    ctx.fillRect(0, 0, panel.width, panel.height);
    const lit = [];
    ctx.fillStyle = "#15181d";
    ctx.beginPath();
    const glowImg = gctx.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = ((oy + y) * sheet.width + ox + x) * 4;
        const R = pixels[i];
        const G = pixels[i + 1];
        const B = pixels[i + 2];
        const cx = x * zoom + zoom / 2;
        const cy = y * zoom + zoom / 2;
        const o = (y * W + x) * 4;
        glowImg.data[o] = R;
        glowImg.data[o + 1] = G;
        glowImg.data[o + 2] = B;
        glowImg.data[o + 3] = 255;
        if (R + G + B < 24) {
          ctx.moveTo(cx + r, cy);
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else lit.push([cx, cy, R, G, B]);
      }
    ctx.fill();
    for (const [cx, cy, R, G, B] of lit) {
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    gctx.putImageData(glowImg, 0, 0);
  }

  function loop() {
    draw(now());
    requestAnimationFrame(loop);
  }
  if (still) seek(meta.slides[1]?.start + 2500 || 0);
  loop();
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function readPixels(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}
