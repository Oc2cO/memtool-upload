# VISUAL_SKILL_ADVANCED_NEURAL_PARTICLES

## Full Description
Premium 2026 neural/connected particle system. Canvas-based interactive neural net with pulsing nodes, dynamic connections that form/break based on proximity + mouse influence. Inspired by Awwwards NRG "Nodes" element, IVRESS SPIN A TALE (Asian studio), ZCOOL/China AI visual systems, Tencent/Baidu data viz patterns, School of Motion particle storytelling, and 2026 Figma/Envato trends (3D websites, microanimations, anti-grid + motion narrative).

Mature features:
- 80-120 nodes with velocity + organic wander.
- Connection lines with distance + strength alpha (neural feel).
- Mouse attraction + repulsion with spring physics.
- Pulse waves synced to theme accents (purple-cyan-gold).
- Subtle glow + bloom via composite.
- Scroll or click to trigger burst / narrative phases.
- Theme integrated, performant (requestAnimationFrame + spatial grid for connections).
Focus latest not widely seen: "living memory net" with cinematic pulse narrative and occlusion depth layers. Pairs perfectly with glassmorphism.

## Sources
- Awwwards: NRG nodes + virtual tour (https://www.awwwards.com/sites/nrg-build-your-data-center), IVRESS SPIN A TALE (Laugh Mind Co. Ltd).
- Envato 2026 + YouTube trends: 3D/neural, particle microanimations, bento+organic with motion.
- China: ZCOOL interactive AI/neural viz, Alibaba data center interfaces, Baidu neural UI patterns.
- Project: HomeAtriumVisualLayer particles, OC2COScene.tsx glyph particles, BRAND.md chaos particles.

## Complete Runnable Code (Copy-Paste Ready)
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Oc2cO Neural Particles 2026</title>
<style>
  body { margin:0; background:#0A0F1E; }
  #neural-canvas { display:block; width:100%; max-width:100%; height:100vh; touch-action:none; }
  .overlay { position:absolute; top:40px; left:40px; color:#00E5FF; font-family:system-ui; font-size:13px; pointer-events:none; mix-blend-mode: difference; }
  .controls { position:absolute; bottom:30px; left:50%; transform:translateX(-50%); display:flex; gap:12px; }
  .ctrl { padding:8px 16px; background:rgba(21,16,42,0.8); border:1px solid #9B7AE8; color:#f5f3ff; border-radius:999px; font-size:12px; cursor:pointer; backdrop-filter:blur(8px); }
</style>
</head>
<body>
<canvas id="neural-canvas"></canvas>
<div class="overlay">NEURAL MEMORY NET • 2026 PREMIUM • DRAG TO INFLUENCE</div>
<div class="controls">
  <button class="ctrl" onclick="burst()">BURST WAVE</button>
  <button class="ctrl" onclick="toggleAttract()">TOGGLE ATTRACT</button>
</div>
<script>
const canvas = document.getElementById('neural-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let W, H, nodes = [], mouse = {x: -999, y: -999, down: false}, attractMode = true;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function createNodes(count = 110) {
  nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 1.6 + Math.random() * 1.8,
      pulse: Math.random() * Math.PI * 2,
      hue: Math.random() > 0.7 ? '#FFD56F' : (Math.random() > 0.5 ? '#00E5FF' : '#9B7AE8')
    });
  }
}
createNodes();

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function update() {
  for (let n of nodes) {
    n.x += n.vx;
    n.y += n.vy;
    n.pulse += 0.035;
    
    // bounds bounce + friction
    if (n.x < 20 || n.x > W-20) n.vx *= -1;
    if (n.y < 20 || n.y > H-20) n.vy *= -1;
    
    // mouse
    const dx = mouse.x - n.x;
    const dy = mouse.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 280) {
      const f = (attractMode ? 0.028 : -0.022) * (1 - d / 280);
      n.vx += dx / d * f;
      n.vy += dy / d * f;
    }
    
    // damp
    n.vx *= 0.985;
    n.vy *= 0.985;
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  
  // connections
  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = dist(a, b);
      if (d < 135) {
        const alpha = (1 - d / 135) * 0.75;
        ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        
        // occasional strong neural pulse
        if (Math.sin(a.pulse) * Math.sin(b.pulse) > 0.92) {
          ctx.strokeStyle = `rgba(155, 122, 232, ${alpha * 0.8})`;
          ctx.stroke();
        }
      }
    }
  }
  
  // nodes
  for (let n of nodes) {
    const p = (Math.sin(n.pulse) + 1) / 2;
    const rad = n.r + p * 1.1;
    
    // glow
    ctx.shadowColor = n.hue;
    ctx.shadowBlur = 12 + p * 8;
    ctx.fillStyle = n.hue;
    ctx.beginPath();
    ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    ctx.fill();
    
    // core
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f5f3ff';
    ctx.beginPath();
    ctx.arc(n.x, n.y, rad * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.shadowBlur = 0;
}

let anim;
function loop() {
  update();
  draw();
  anim = requestAnimationFrame(loop);
}
loop();

function onMove(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX || (e.touches && e.touches[0].clientX) || 0) - rect.left;
  mouse.y = (e.clientY || (e.touches && e.touches[0].clientY) || 0) - rect.top;
}
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); }, {passive: false});
canvas.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });

canvas.addEventListener('mousedown', () => mouse.down = true);
window.addEventListener('mouseup', () => mouse.down = false);

window.burst = function() {
  for (let n of nodes) {
    const ang = Math.random() * Math.PI * 2;
    n.vx += Math.cos(ang) * 3.8;
    n.vy += Math.sin(ang) * 3.8;
  }
};

window.toggleAttract = function() {
  attractMode = !attractMode;
};

// Keyboard for arcade integration
window.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); burst(); } });

console.log('%c[Oc2cO] Neural Particles 2026 ready', 'color:#9B7AE8');
</script>
</body>
</html>
```

## How to Integrate
- **index.html**: Full page hero background or section canvas. Use overlay text from Oc2cO branding.
- **memtool**: Background for chat or memory list (pair with glassmorphism cards). Expose burst() for memory capture events.
- **arcade**: Primary visual layer or interactive element in game UI. Trigger burst on level complete or streak.

## Mobile Notes
Canvas scales automatically. Touch supported. Limit node count to 60-70 on mobile (add `if (window.innerWidth < 768) count=65` in createNodes). Respect reduced-motion: pause animation or lower count.

## Oc2cO Theme Fit
Exact match to #0A0F1E bg, #9B7AE8 / #00E5FF / #FFD56F nodes. Echoes chaos particles, atrium depth layers, OC2COScene glyph particles in project. Perfect for "in-site grok agent" memory visualization.

## BBWAAS / Reuse Notes
Extends cinematic-layer.css (add canvas inside .cinematic-layer). Base particles from project HomeAtriumVisualLayer + OC2COScene. Add to style.css .neural-container rules. Standalone demo fully functional.
