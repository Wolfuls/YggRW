(() => {
  'use strict';
  const panel = document.querySelector('.ender-legend');
  if (!panel) return;
  const voices = [...panel.querySelectorAll('.ender-voice')];
  const button = panel.querySelector('.ender-toggle');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const distortions = ['size-crush', 'size-small', 'size-large', 'size-surge'];
  const originals = new Map(voices.map(v => [v, v.querySelector('.ender-ink').textContent]));
  let paused = false, visible = false, next = 0, restore = 0;
  const enabled = () => panel.open && visible && !document.hidden && !motion.matches && !paused;
  function clear() {
    clearTimeout(next); clearTimeout(restore);
    panel.classList.remove('signal-burst', 'signal-tear');
    voices.forEach(v => { v.classList.remove('is-glitch', 'shift-left', 'shift-cut', 'shift-right', 'is-scrambled', ...distortions); v.querySelector('.ender-noise').textContent = '';  });
  }
  function schedule() {
    if (!enabled()) return;
    next = setTimeout(pulse, 850 + Math.random() * 1850);
  }
  function pulse() {
    if (!enabled()) return;
    const visibleVoices = voices.filter(v => { const box = v.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; });
    if (!visibleVoices.length) { schedule(); return; }
    panel.classList.add('signal-burst');
    panel.classList.toggle('signal-tear', Math.random() < .55);
    // Usually disrupt several different visible voices at once.
    const pool = [...visibleVoices];
    const count = Math.min(pool.length, Math.random() < .72 ? 2 + Math.floor(Math.random() * 4) : 1);
    const selected = [];
    for (let i = 0; i < count; i++) selected.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const full = Math.random() < .24 ? selected[Math.floor(Math.random() * selected.length)] : null;
    const glyphs = Array.from('縺繧譁�░▒▓零偽観測螟鬘驟蜃');
    for (const voice of selected) {
      const chars = Array.from(originals.get(voice));
      if (voice === full) {
        // The entire utterance is temporarily unreadable; brackets and spacing stay.
        for (let i = 1; i < chars.length - 1; i++) {
          if (!/\s/u.test(chars[i])) chars[i] = glyphs[Math.floor(Math.random() * glyphs.length)];
        }
      } else if (Math.random() < .85) {
        const positions = chars.map((_, i) => i).slice(1, -1).filter(i => !/\s/u.test(chars[i]));
        const changed = Math.min(positions.length, 7, Math.max(1, Math.ceil(chars.length / 5)));
        for (let i = 0; i < changed; i++) {
          const at = positions.splice(Math.floor(Math.random() * positions.length), 1)[0];
          chars[at] = glyphs[Math.floor(Math.random() * glyphs.length)];
        }
      }
      voice.querySelector('.ender-noise').textContent = chars.join('');
      voice.classList.add('is-glitch', ['shift-left', 'shift-cut', 'shift-right'][Math.floor(Math.random() * 3)]);
      voice.classList.add(distortions[Math.floor(Math.random() * distortions.length)]);
      if (voice === full) voice.classList.add('is-scrambled');
    }
    restore = setTimeout(() => { clear(); schedule(); }, full ? 420 + Math.random() * 340 : 220 + Math.random() * 220);
  }
  function sync() {
    clear();
    panel.classList.toggle('signal-running', enabled());
    button.hidden = motion.matches;
    button.textContent = paused ? '演出を再開' : '演出を停止';
    button.setAttribute('aria-pressed', String(paused));
    schedule();
  }
  button.addEventListener('click', () => { paused = !paused; sync(); });
  panel.addEventListener('toggle', sync);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(panel);
  sync();
})();
