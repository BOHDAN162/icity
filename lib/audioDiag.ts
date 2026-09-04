/* iCITY 113Н — ВРЕМЕННАЯ панель замера звука.
   Путь в проекте: lib/audioDiag.ts

   ЗАЧЕМ. Звуковые правила первого экрана держатся на поведении, которого
   нет ни в одном доступном здесь браузере: на iOS громкость медиаэлемента
   может не доходить до выхода, а AudioContext стартует suspended даже
   внутри жеста. Симуляторов iOS на машине нет (проверено: xcrun simctl
   отдаёт пустые списки устройств и рантаймов), значит единственный
   измерительный прибор — телефон заказчика. Панель показывает на нём
   четыре числа, по которым видно, какой из путей отработал.

   ЖИВЁТ ТОЛЬКО ПРИ ?adiag В АДРЕСЕ. Обычный зритель её не увидит никогда,
   в разметку она не попадает, на вес первого экрана не влияет.

   МОНТИРУЕТСЯ В BODY, а не в дерево React, по той же причине, что и хвост
   амбиента: через миг после свапа первый экран снимается целиком, а самое
   интересное происходит как раз после него. Снимает себя сама.

   УБРАТЬ, когда вопрос со звуком на iPhone закрыт. */

const LIFE_MS = 25000;
const TICK_MS = 250;

type Gain = { ctx: AudioContext; gain: GainNode } | null;

export const audioDiag = (a: HTMLAudioElement, readGain: () => Gain) => {
  if (typeof location === 'undefined' || !location.search.includes('adiag')) return;

  const el = document.createElement('pre');
  el.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:9999', 'margin:0',
    'padding:6px 8px', 'background:rgba(0,0,0,.78)', 'color:#fff',
    'font:11px/1.45 ui-monospace,monospace', 'white-space:pre',
    'pointer-events:none', 'border-radius:4px',
  ].join(';');
  document.body.appendChild(el);

  const t0 = performance.now();
  const id = window.setInterval(() => {
    const g = readGain();
    el.textContent = [
      `граф:    ${g ? 'есть' : 'НЕТ'}`,
      `ctx:     ${g ? g.ctx.state : '—'}`,
      `gain:    ${g ? g.gain.gain.value.toFixed(3) : '—'}`,
      `volume:  ${a.volume.toFixed(2)}`,
      `loop:    ${a.loop}`,
      `t:       ${a.currentTime.toFixed(1)} / пауза ${a.paused}`,
    ].join('\n');
    if (performance.now() - t0 > LIFE_MS) {
      window.clearInterval(id);
      el.remove();
    }
  }, TICK_MS);
};
