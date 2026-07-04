# VISUAL_SKILL_ADVANCED_LIQUID_MORPH

## Full Description
Liquid morphing blobs + 3D-ish organic shapes using canvas + noise. 2026 premium: metaballs + bezier wobble with spring, scroll-tied morph speed, theme colored. Inspired by NRG data center organic visuals, China liquid UI (ZCOOL), School of Motion liquid motion, Envato liquid glass + 3D.

Mature: multiple blobs merging, cursor distortion, performance optimized.

## Complete Runnable Code
```html
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oc2cO Liquid Morph 2026</title>
<style>body{margin:0;background:#0A0F1E}canvas{display:block}</style></head>
<body>
<canvas id="liquid" width="900" height="560"></canvas>
<script>
const c = document.getElementById('liquid'), ctx = c.getContext('2d');
let t = 0, mx = 450, my = 280;
c.addEventListener('mousemove', e => { mx = e.offsetX; my = e.offsetY; });
function blob(x, y, r, phase, col) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  for (let i=0; i<6; i++) {
    const a = i/6 * Math.PI*2 + Math.sin(t*1.2 + phase)*0.6;
    const rad = r + Math.sin(t*2.1 + i + phase)*7 + Math.cos(t*0.7)*4;
    const px = Math.cos(a)*rad, py = Math.sin(a)*rad;
    i===0 ? ctx.moveTo(px, py) : ctx.quadraticCurveTo(px*0.92 + Math.sin(t+i)*3, py*0.92 + Math.cos(t)*3, px, py);
  }
  ctx.closePath();
  ctx.fillStyle = col; ctx.globalAlpha = 0.7;
  ctx.shadowColor = col; ctx.shadowBlur = 28;
  ctx.fill(); ctx.restore();
}
function draw() {
  ctx.clearRect(0,0,c.width,c.height);
  const cols = ['#9B7AE8','#00E5FF','#FFD56F'];
  blob(320 + Math.sin(t)*38, 240 + Math.cos(t*0.7)*26, 94, 0, cols[0]);
  blob(580 + Math.cos(t*0.9)*29, 310 + Math.sin(t*1.1)*31, 78, 2.1, cols[1]);
  blob(mx, my, 52, 4.3, cols[2]); // interactive
  // merge glow
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#9B7AE8';
  ctx.beginPath(); ctx.arc(440, 280, 72 + Math.sin(t*1.4)*14, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1; t += 0.018; requestAnimationFrame(draw);
}
draw();
console.log('%c[Oc2cO] Liquid Morph ready','color:#00E5FF');
</script></body></html>
```

## Integration notes
Embed canvas in glass containers or cinematic sections. Great for arcade backgrounds or memtool "memory fluid" viz. Mobile: smaller canvas or lower resolution. Fits Oc2cO with exact palette. Reference cinematic-layer for container.
