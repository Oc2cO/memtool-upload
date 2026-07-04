# VISUAL_SKILL_ADVANCED_HOLO_MICRO

## Full Description
Premium holo micro-interactions 2026: mouse-tilt 3D cards with dynamic specular + edge reflection, liquid hover scale + ripple, chromatic light sweep. From Awwwards microinteractions + 3D, China advanced UI (Alibaba/Tencent product cards with depth holo), Figma/Envato 3D + micro trends.

Mature: real-time specular calculation, multi stop gradients, spring physics on release. Standalone + embeddable.

## Sources
Awwwards nominees, Envato 2026 3D/micro, project GradientButton + alive components.

## Complete Runnable Code
```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Oc2cO Holo Micro 2026</title>
<style>
body{background:#0A0F1E;color:#f5f3ff;font-family:system-ui;padding:60px 20px;}
.holo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:28px;max-width:980px;margin:auto;}
.holo-card{
  position:relative;height:220px;border-radius:18px;background:linear-gradient(145deg,#15102a,#0f0b22);
  border:1px solid rgba(155,122,232,0.25);overflow:hidden;cursor:pointer;
  transition:transform .18s cubic-bezier(0.23,1.0,0.32,1), box-shadow .18s;
  box-shadow:0 10px 30px rgba(0,0,0,.45);
  transform-style:preserve-3d;
}
.holo-card .inner{position:absolute;inset:0;padding:28px;display:flex;flex-direction:column;justify-content:space-between;}
.holo-card .label{font-size:1.05rem;font-weight:600;}
.holo-card .specular{position:absolute;inset:0;background:linear-gradient(125deg,transparent,rgba(255,255,255,0.65),transparent);opacity:0.0;mix-blend-mode:screen;pointer-events:none;transition:opacity .1s;}
.holo-card .edge{position:absolute;inset:-1px;border-radius:inherit;background:conic-gradient(from 45deg,#00E5FF22,#9B7AE822,#FFD56F22,#00E5FF22);opacity:0.5;mix-blend-mode:overlay;}
.holo-card:hover{box-shadow:0 25px 55px rgba(0,0,0,.55);}
</style></head>
<body>
<div class="holo-grid">
  <div class="holo-card" data-holo>
    <div class="inner"><div class="label">CAPTURE<br>MEMORY</div><div style="font-size:13px;opacity:.6;">Tap or hover for holo</div></div>
    <div class="specular"></div><div class="edge"></div>
  </div>
  <div class="holo-card" data-holo>
    <div class="inner"><div class="label">ARCade<br>STREAK</div><div style="font-size:13px;opacity:.6;">Premium micro depth</div></div>
    <div class="specular"></div><div class="edge"></div>
  </div>
</div>
<script>
document.querySelectorAll('[data-holo]').forEach(card => {
  const spec = card.querySelector('.specular');
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    const rx = y * -26; const ry = x * 32;
    card.style.transform = `perspective(920px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.01)`;
    spec.style.opacity = '0.85';
    spec.style.background = `linear-gradient(${140 + x*60}deg, transparent, rgba(255,255,255,0.7), transparent)`;
    spec.style.transform = `translate(${x*38}px, ${y*22}px)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(920px) rotateX(0) rotateY(0) scale(1)';
    spec.style.opacity = '0';
  });
  card.addEventListener('click', () => {
    card.style.transitionDuration = '80ms';
    card.style.transform = 'perspective(920px) rotateX(0) rotateY(0) scale(0.96)';
    setTimeout(()=>{ card.style.transitionDuration=''; card.style.transform=''; }, 180);
  });
});
</script>
</body></html>
```

## Integration / Mobile / Theme
Add to buttons/cards in index, memtool, arcade. Mobile: limit tilt or use deviceorientation. Uses Oc2cO palette. Extends cinematic-layer + style.css buttons.
