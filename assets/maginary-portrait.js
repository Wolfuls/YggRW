// One of the four original appearances is chosen on each page load.
(() => {
  const portrait = document.getElementById('maginary-portrait');
  if (!portrait) return;
  const candidates = ['npc_no_image.png', 'npc_maginary1.jpg', 'npc_maginary2.jpg', 'npc_maginary3.jpg'];
  const fallback = portrait.src;
  portrait.addEventListener('error', () => { portrait.src = fallback; }, { once: true });
  portrait.src = new URL(candidates[Math.floor(Math.random() * candidates.length)], fallback).href;
})();
