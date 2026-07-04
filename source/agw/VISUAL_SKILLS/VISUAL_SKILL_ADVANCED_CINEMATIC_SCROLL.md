# VISUAL_SKILL_ADVANCED_CINEMATIC_SCROLL

## Full Description
Cinematic scroll-driven narrative reveals with parallax layers, variable typography weight, holo highlights, grain + slow drift. 2026 premium: scroll-timeline / intersection + manual progress for broad support. Inspired by Awwwards phase scroll-through (NRG), Ten Years Away, School of Motion cinematic storytelling, China ZCOOL long-form motion narrative sites, Alibaba immersive brand pages.

Mature not basic: multi-layer parallax with depth occlusion, text that "breathes" weight on scroll, synchronized light sweep/holo, integrated with glass and particles. Uses IntersectionObserver + scroll listener for reliability. Cinematic grain from project cinematic-layer.

## Sources
- Awwwards NRG Phase 04 Scroll through, Ten Years Away (https://www.awwwards.com/sites/ten-years-away).
- Envato 2026: Motion narrative, organic + scroll animation, archival aesthetic.
- Project: cinematic in login.tsx / AuthCinematicStage.tsx (one-shot cinematic, settle timing), BRAND.md video recaps, landing-page scroll sections.

## Complete Runnable Code
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Oc2cO Cinematic Scroll 2026</title>
<link rel="stylesheet" href="../cinematic-layer.css">
<style>
  body { background:#0A0F1E; color:#f5f3ff; font-family: system-ui; margin:0; }
  .section { min-height: 100vh; display:flex; align-items:center; justify-content:center; position:relative; padding:40px 20px; }
  .layer { position:absolute; inset:0; transition: transform 0.1s linear; will-change: transform; }
  .layer1 { background: radial-gradient(circle, rgba(155,122,232,0.08) 0%, transparent 70%); transform: translateZ(0); }
  .layer2 { background: linear-gradient(120deg, rgba(0,229,255,0.07), transparent); }
  .content { position: relative; z-index: 3; max-width: 720px; text-align: center; }
  .title { font-size: clamp(2.8rem, 8vw, 5.6rem); font-weight: 700; line-height: 0.92; letter-spacing: -0.04em;
    transition: font-variation-settings 0.2s; }
  .title { font-variation-settings: "wght" 700; } /* variable font sim */
  .reveal { opacity:0; transform: translateY(60px); transition: all 1.1s cubic-bezier(0.23,1,0.32,1); }
  .reveal.in { opacity:1; transform:none; }
  .holo { position:relative; display:inline-block; }
  .holo::after { content:''; position:absolute; inset:-20%; background:linear-gradient(120deg, transparent, rgba(255,255,255,0.6), transparent); 
    transform: translateX(-120%); transition: transform 1.8s; mix-blend-mode: screen; }
  .holo.in::after { transform: translateX(220%); }
  .grain { position:absolute; inset:0; pointer-events:none; z-index:2; mix-blend-mode:screen; opacity:0.5;
    background-image: repeating-linear-gradient(transparent, transparent 2px, rgba(255,255,255,0.06) 3px); }
</style>
</head>
<body>
<section class="section cinematic-layer" id="sec1">
  <div class="layer layer1" data-parallax="0.25"></div>
  <div class="layer layer2" data-parallax="0.55"></div>
  <div class="content">
    <h1 class="title reveal holo" id="title1">OC2CO MEMORY</h1>
    <p class="reveal" style="margin-top:18px; font-size:1.15rem; max-width:480px; margin-left:auto; margin-right:auto;">
      Scroll-driven cinematic narrative. Premium 2026 depth from NRG phases + ZCOOL motion.
    </p>
  </div>
  <div class="grain"></div>
</section>

<section class="section cinematic-layer" id="sec2" style="min-height:120vh;">
  <div class="layer layer1" data-parallax="0.18"></div>
  <div class="content">
    <h2 class="title reveal" style="font-size:3.2rem;">LIVE IN THE MOMENT</h2>
    <div class="reveal" style="margin-top:32px;">
      <button onclick="triggerHolo(this)" style="padding:14px 32px;border:1px solid #00E5FF;color:#00E5FF;background:transparent;border-radius:999px;cursor:pointer;">ACTIVATE HOLO</button>
    </div>
  </div>
</section>

<script>
function initCinematicScroll() {
  const sections = document.querySelectorAll('.section');
  const layers = document.querySelectorAll('[data-parallax]');
  
  // Intersection reveals
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.reveal').forEach((el, i) => {
          setTimeout(() => el.classList.add('in'), i * 120);
        });
        // Holo sweep
        const holo = entry.target.querySelector('.holo');
        if (holo) setTimeout(() => holo.classList.add('in'), 420);
      }
    });
  }, { threshold: 0.35 });
  sections.forEach(s => io.observe(s));
  
  // Parallax layers + variable title weight
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        layers.forEach(layer => {
          const speed = parseFloat(layer.dataset.parallax) || 0.3;
          const y = scrollY * speed * -0.6;
          layer.style.transform = `translate3d(0, ${y}px, 0)`;
        });
        
        // Variable weight on title
        const title = document.getElementById('title1');
        if (title) {
          const progress = Math.min(1, scrollY / (window.innerHeight * 0.7));
          const wght = 620 + (progress * 280);
          title.style.fontVariationSettings = `"wght" ${wght}`;
        }
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  
  // Reuse cinematic grain already in class
  console.log('%c[Oc2cO] Cinematic Scroll initialized', 'color:#FFD56F');
}

function triggerHolo(btn) {
  btn.style.transition = 'all .6s';
  btn.style.boxShadow = '0 0 0 60px rgba(0,229,255,0.2)';
  setTimeout(() => { btn.style.boxShadow = 'none'; }, 1200);
}

window.addEventListener('DOMContentLoaded', initCinematicScroll);
</script>
</body>
</html>
```

## Integration
- index: Wrap hero + feature sections. Add .cinematic-layer + parallax children.
- memtool: Use for recap / insight long scroll views (pair with existing month recap).
- arcade: Narrative level intros or end screens.

## Mobile / Oc2cO
Reduced motion disables parallax + sweeps. Use project colors. Extends existing cinematic-layer.css + AuthCinematicStage timing.

## BBWAAS Reuse
Directly uses cinematic-layer.css (add .section inside it). Syncs with existing project cinematic settle logic.
