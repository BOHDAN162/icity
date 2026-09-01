/* iCITY 113Н — экран 9. Запись на просмотр (вариант F2: колонка по центру).
   Путь в проекте: components/Contact.tsx

   Последняя секция страницы, её эмоциональная кульминация — после неё
   только тихий Footer. Данные менеджера — lib/contacts.ts, единственный
   источник; здесь их не подставлять руками.

   Валидация тихая: только по blur двух обязательных полей, снимается
   при вводе. Кнопка отправки не меняет размер между idle/loading —
   меняется только содержимое. Успех — не тост и не редирект, а замена
   формы: чек собирается из точек растра фритты на холсте, тот же язык,
   что у растра по всему сайту, только покадрово через canvas.

   TODO(бэкенд): lib/submitLead.ts — заглушка на 900ms, реального
   эндпоинта в проекте ещё нет. */

'use client';

import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import styles from './Contact.module.css';
import { contacts } from '@/lib/contacts';
import { submitLead } from '@/lib/submitLead';

type FieldName = 'name' | 'contact';
type FieldErrors = Partial<Record<FieldName, string>>;
type Status = 'idle' | 'loading' | 'success';

const REQUIRED_MESSAGES: Record<FieldName, string> = {
  name: 'Как к вам обращаться?',
  contact: 'Нужен контакт для ответа',
};

/* Презентации в public/ нет — ссылка временная, см. отчёт задачи. */
const PDF_HREF = '#';
/* Страницы политики обработки персональных данных в проекте нет —
   легал-строка и подвал ссылаются сюда же, до появления реальной страницы. */
export const POLICY_HREF = '#';

const MAX_HREF = contacts.maxUrl === 'VERIFY_WITH_BOGDAN' ? '#' : contacts.maxUrl;

/* Чек собирается из точек вдоль той же ломаной, что рисует галочку:
   (0.16,0.55) → (0.42,0.78) → (0.86,0.24), нормировано на сторону холста. */
const CHECK_POINTS: [number, number][] = [
  [0.16, 0.55],
  [0.42, 0.78],
  [0.86, 0.24],
];

function sampleCheckDots(count: number, size: number): [number, number][] {
  const pts = CHECK_POINTS.map(([x, y]) => [x * size, y * size] as [number, number]);
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    segLens.push(Math.hypot(x2 - x1, y2 - y1));
  }
  const total = segLens.reduce((a, b) => a + b, 0);

  const dots: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    let d = t * total;
    let seg = 0;
    while (seg < segLens.length - 1 && d > segLens[seg]) {
      d -= segLens[seg];
      seg += 1;
    }
    const segT = segLens[seg] === 0 ? 0 : d / segLens[seg];
    const [x1, y1] = pts[seg];
    const [x2, y2] = pts[seg + 1];
    dots.push([x1 + (x2 - x1) * segT, y1 + (y2 - y1) * segT]);
  }
  return dots;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export default function Contact() {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function validate(field: FieldName, value: string) {
    setErrors((prev) => ({
      ...prev,
      [field]: value.trim() === '' ? REQUIRED_MESSAGES[field] : undefined,
    }));
  }

  function handleBlur(field: FieldName) {
    return (event: FocusEvent<HTMLInputElement>) => validate(field, event.target.value);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nameEmpty = name.trim() === '';
    const contactEmpty = contact.trim() === '';
    if (nameEmpty || contactEmpty) {
      setErrors({
        name: nameEmpty ? REQUIRED_MESSAGES.name : undefined,
        contact: contactEmpty ? REQUIRED_MESSAGES.contact : undefined,
      });
      return;
    }
    setStatus('loading');
    await submitLead({ name, contact, comment });
    setStatus('success');
  }

  useEffect(() => {
    if (status !== 'success') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 64;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fill = getComputedStyle(document.documentElement).getPropertyValue('--frit-deep').trim() || '#C4141C';
    const dots = sampleCheckDots(16, size);
    const DOT_R = 6.5;
    const DUR = 240;
    const STAGGER = 38;

    if (reduceMotion) {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = fill;
      dots.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    let raf = 0;
    const start = performance.now();

    function frame(now: number) {
      if (!ctx) return;
      const elapsed = now - start;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = fill;
      let animating = false;
      dots.forEach(([x, y], i) => {
        const localT = Math.min(Math.max((elapsed - i * STAGGER) / DUR, 0), 1);
        if (localT < 1) animating = true;
        if (localT <= 0) return;
        const eased = easeOutCubic(localT);
        ctx.globalAlpha = eased;
        ctx.beginPath();
        ctx.arc(x, y, DOT_R * eased, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (animating) raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  return (
    <section className={styles.section} id="contact" aria-labelledby="contact-eyebrow">
      <div className={styles.inner}>
        <p className={`label ${styles.eyebrow}`} id="contact-eyebrow">
          ЗАПИСЬ НА ПРОСМОТР
        </p>

        {status === 'success' ? (
          <div className={styles.success} role="status">
            <canvas ref={canvasRef} className={styles.successCanvas} width={64} height={64} aria-hidden="true" />
            <div>
              <p className={styles.successTitle}>Заявка у Оксаны</p>
              <p className={styles.successNote}>Перезвоним в течение 15 минут в рабочее время.</p>
            </div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <input
                id="contact-name"
                className={errors.name ? `${styles.input} ${styles.invalid}` : styles.input}
                type="text"
                placeholder=" "
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (errors.name) validate('name', event.target.value);
                }}
                onBlur={handleBlur('name')}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'contact-name-error' : undefined}
                required
              />
              <label className={styles.floatLabel} htmlFor="contact-name">
                Имя
              </label>
              {errors.name && (
                <p className={styles.error} id="contact-name-error">
                  {errors.name}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <input
                id="contact-contact"
                className={errors.contact ? `${styles.input} ${styles.invalid}` : styles.input}
                type="text"
                placeholder=" "
                value={contact}
                onChange={(event) => {
                  setContact(event.target.value);
                  if (errors.contact) validate('contact', event.target.value);
                }}
                onBlur={handleBlur('contact')}
                aria-invalid={Boolean(errors.contact)}
                aria-describedby={errors.contact ? 'contact-contact-error' : undefined}
                required
              />
              <label className={styles.floatLabel} htmlFor="contact-contact">
                Телефон или почта
              </label>
              {errors.contact && (
                <p className={styles.error} id="contact-contact-error">
                  {errors.contact}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <textarea
                id="contact-comment"
                className={styles.textarea}
                placeholder=" "
                rows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <label className={styles.floatLabel} htmlFor="contact-comment">
                Комментарий
              </label>
            </div>

            <button className={styles.submit} type="submit" disabled={status === 'loading'} aria-busy={status === 'loading'}>
              {status === 'loading' ? (
                <span className={styles.loading}>
                  <span aria-hidden="true">
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                  </span>
                  <span className={styles.loadingText}>Отправляем…</span>
                </span>
              ) : (
                'Записаться на просмотр'
              )}
            </button>

            <p className={styles.legal}>
              Нажимая «Записаться», вы соглашаетесь с{' '}
              <a className={styles.dottedLink} href={POLICY_HREF}>
                политикой обработки персональных данных
              </a>
              .
            </p>
          </form>
        )}

        <div className={styles.info}>
          <p className={styles.managerName}>{contacts.managerName}</p>
          <p className={`label ${styles.managerRole}`}>{contacts.managerRole}</p>

          <a className={styles.phone} href={contacts.phoneHref}>
            {contacts.phoneDisplay}
          </a>

          <div className={styles.links}>
            <a className={styles.dottedLink} href={`mailto:${contacts.email}`}>
              {contacts.email}
            </a>
            <a className={styles.dottedLink} href={MAX_HREF}>
              Написать в Max
            </a>
            <a className={styles.dottedLink} href={PDF_HREF}>
              Презентация <span className={styles.pdfTag}>PDF</span>
            </a>
          </div>

          <p className={styles.quiet}>Прямая аренда от собственника. Без посредников.</p>
        </div>
      </div>
    </section>
  );
}
