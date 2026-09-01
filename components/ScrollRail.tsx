'use client';

/* iCITY 113Н — рейл прокрутки.
   Путь в проекте: components/ScrollRail.tsx

   ЧТО ЭТО. Тонкая вертикальная линия в пустой pad-x-полосе справа —
   встроена в поток документа (position: absolute от .afterHero,
   не fixed), а не летает поверх блоков. Тянется от верха «Цифр»
   (#landing) до низа «Вопросов» (#faq); Офис/Вид/Контакт вне диапазона.
   Раз это не fixed-оверлей, отдельная видимость не нужна: выше «Цифр»
   и ниже «Вопросов» рейл сам уезжает за пределы экрана вместе с
   документом — ровно как любой другой блок на странице.

   ГЕОМЕТРИЯ СЧИТАЕТСЯ ДВАЖДЫ РАЗНЫМИ ПУТЯМИ. Позиция и высота обёртки
   (relative к её offsetParent, `.afterHero`) — величины layout, меняются
   только от реальной перекомпоновки: считаются на монтировании и на
   resize, пишутся прямо в style (без setState, без ре-рендера).
   Прогресс чтения и активная секция — величины scroll, меняются на
   каждый кадр колеса мыши: один rAF-дросселированный слушатель,
   единственная запись — scaleY на полосе заливки. Активный индекс
   уходит в setState, но только когда значение реально меняется. */

import { useEffect, useRef, useState } from 'react';
import styles from './ScrollRail.module.css';

const SECTIONS = [
  { id: 'landing', label: 'Цифры' },
  { id: 'economics', label: 'Экономика' },
  { id: 'complex', label: 'Комплекс' },
  { id: 'location', label: 'Локация' },
  { id: 'faq', label: 'Вопросы' },
] as const;

type Tick = { id: string; label: string; top: number };

type Bounds = {
  /** Абсолютные (document) координаты — вход для прогресса по скроллу. */
  railTopAbs: number;
  railBottomAbs: number;
  sectionAbsTops: number[];
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export default function ScrollRail() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const activeIndexRef = useRef<number | null>(null);

  const [ticks, setTicks] = useState<Tick[] | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    let raf = 0;

    /* Layout: где рейл стоит и какой он высоты. Ancestor — offsetParent
       (.afterHero, position: relative) — поэтому top/height считаем
       разницей rect'ов, а не document.scrollY: не зависит от прокрутки. */
    const measure = () => {
      const els = SECTIONS.map((s) => document.getElementById(s.id));
      if (els.some((e) => !e)) return;
      const parent = (wrap.offsetParent as HTMLElement | null) ?? document.body;

      const parentTop = parent.getBoundingClientRect().top;
      const rects = els.map((e) => e!.getBoundingClientRect());
      const scrollY = window.scrollY;

      const top = rects[0].top - parentTop;
      const height = Math.max(0, rects[rects.length - 1].bottom - rects[0].top);
      wrap.style.top = `${top}px`;
      wrap.style.height = `${height}px`;

      setTicks(
        SECTIONS.map((s, i) => ({ id: s.id, label: s.label, top: rects[i].top - rects[0].top })),
      );

      boundsRef.current = {
        railTopAbs: rects[0].top + scrollY,
        railBottomAbs: rects[rects.length - 1].bottom + scrollY,
        sectionAbsTops: rects.map((r) => r.top + scrollY),
      };
    };

    /* Scroll: прогресс чтения (заливка) и активная секция — из тех же
       абсолютных координат, без повторных getBoundingClientRect. */
    const updateScroll = () => {
      const b = boundsRef.current;
      if (!b || !fillRef.current) return;

      const center = window.scrollY + window.innerHeight / 2;
      const span = b.railBottomAbs - b.railTopAbs;
      const progress = span > 0 ? clamp01((center - b.railTopAbs) / span) : 0;
      fillRef.current.style.transform = `scaleY(${progress.toFixed(4)})`;

      let next: number | null = null;
      for (let i = 0; i < b.sectionAbsTops.length; i += 1) {
        if (center >= b.sectionAbsTops[i]) next = i;
      }
      if (next !== activeIndexRef.current) {
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateScroll();
      });
    };
    const onResize = () => {
      measure();
      updateScroll();
    };

    measure();
    updateScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.rail}>
      <nav className={styles.nav} aria-label="Разделы страницы">
        <div className={styles.line} aria-hidden="true">
          <div ref={fillRef} className={styles.fill} />
        </div>
        {ticks?.map((t, i) => {
          const active = i === activeIndex;
          return (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={styles.item}
              style={{ top: t.top }}
              data-active={active}
              aria-current={active ? 'location' : undefined}
            >
              <span className={`label ${styles.text}`}>{t.label}</span>
              <span className={styles.dot} aria-hidden="true" />
            </a>
          );
        })}
      </nav>
    </div>
  );
}
