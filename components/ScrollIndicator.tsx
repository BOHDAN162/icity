'use client';

/* iCITY 113Н — индикатор прокрутки.
   Путь в проекте: components/ScrollIndicator.tsx

   ЧТО ЭТО. Вертикальная колонка чёрточек справа. Появляется, только
   когда пользователь долистал до «Цифр» (#landing), и исчезает обратно,
   если он проскроллил назад в офис или вниз в подвал после «Контакта» —
   видимость и есть activeId !== null, отдельного сентинела не нужно.

   «Офис» и «Вид» — первые два пункта развёрнутого списка. У них нет
   собственных id (офис — одна scroll-jacked секция, docs/office-flow.md),
   поэтому они никогда не подсвечиваются активными: пока пользователь
   внутри офиса, индикатор скрыт по определению. «Офис» — обычная ссылка
   на #office (попадает в дедзону p 0–0.08, офис полностью интерактивен).
   «Вид» целится в p = 0.5 той же формулой, что использует сам OfficeStop
   (p = -rect.top / travel) — фаза 0.45–0.62, кадр вида уже держится.

   АКТИВНАЯ СЕКЦИЯ — один rAF-дросселированный слушатель scroll/resize,
   без IntersectionObserver-гейта: здесь нет непрерывной CSS-анимации,
   только редкие чтения getBoundingClientRect шести секций. setState
   только при смене activeId, не на каждый кадр. */

import { useEffect, useRef, useState } from 'react';
import styles from './ScrollIndicator.module.css';

const JUMP_ITEMS = [
  { id: 'office', label: 'Офис', href: '#office' },
  /* У «Вида» нет собственного id — это фаза внутри той же секции
     #office (docs/office-flow.md). Ссылка на #office работает как
     честный фолбэк без JS, onClick целится точнее. */
  { id: 'view', label: 'Вид', href: '#office' },
] as const;

const SPY_SECTIONS = [
  { id: 'landing', label: 'Цифры' },
  { id: 'economics', label: 'Экономика' },
  { id: 'complex', label: 'Комплекс' },
  { id: 'location', label: 'Локация' },
  { id: 'faq', label: 'Вопросы' },
  { id: 'contact', label: 'Контакт' },
] as const;

const SPY_IDS = SPY_SECTIONS.map((s) => s.id);

/** Та же формула прогресса, что в OfficeStop.tsx: p = -rect.top / travel. */
const scrollToViewPhase = () => {
  const office = document.getElementById('office');
  if (!office) return;
  const rect = office.getBoundingClientRect();
  const travel = rect.height - window.innerHeight;
  if (travel <= 0) {
    office.scrollIntoView();
    return;
  }
  const targetTop = rect.top + window.scrollY + 0.5 * travel;
  window.scrollTo(0, targetTop);
};

export default function ScrollIndicator() {
  const navRef = useRef<HTMLElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  /* --- активная секция и видимость: один rAF-слушатель на весь показ -- */
  useEffect(() => {
    const els = SPY_IDS.map((id) => document.getElementById(id));
    let raf = 0;

    const measure = () => {
      const landing = els[0];
      const contact = els[els.length - 1];
      if (!landing || !contact) return;

      const center = window.innerHeight / 2;
      const landingTop = landing.getBoundingClientRect().top;
      const contactBottom = contact.getBoundingClientRect().bottom;
      const visible = landingTop <= center && contactBottom > center;

      if (!visible) {
        if (activeIdRef.current !== null) {
          activeIdRef.current = null;
          setActiveId(null);
        }
        return;
      }

      let next: string | null = activeIdRef.current;
      for (let i = 0; i < els.length; i += 1) {
        const el = els[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= center && r.bottom > center) {
          next = SPY_IDS[i];
          break;
        }
      }
      if (next !== activeIdRef.current) {
        activeIdRef.current = next;
        setActiveId(next);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    measure();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const handleViewClick = (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToViewPhase();
  };

  return (
    <nav
      ref={navRef}
      className={styles.nav}
      data-visible={activeId !== null}
      inert={activeId === null}
      aria-label="Разделы страницы"
    >
      <ul className={styles.list}>
        {JUMP_ITEMS.map((item) => (
          <li key={item.id} className={styles.item}>
            <a
              className={styles.link}
              href={item.href}
              onClick={item.id === 'view' ? handleViewClick : undefined}
            >
              <span className={`label ${styles.text}`}>{item.label}</span>
              <span className={styles.tick} aria-hidden="true" />
            </a>
          </li>
        ))}
        {SPY_SECTIONS.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className={styles.item} data-active={active}>
              <a
                className={styles.link}
                href={`#${item.id}`}
                aria-current={active ? 'location' : undefined}
              >
                <span className={`label ${styles.text}`}>{item.label}</span>
                <span className={styles.tick} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
