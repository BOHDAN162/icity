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

   Отправка — lib/submitLead.ts → app/api/lead/route.ts → Telegram-группа.

   ДВА ОКНА ИЗ ПОДВАЛА. Рядом с почтой стоят «Чертёж» и «3D-модель» —
   те же самые PlanOverlay и PlanDollhouse, что открываются из офиса,
   без единой копии. Оба в position: fixed поверх страницы и оба уже
   умеют Esc, поэтому «нажал Esc — вернулся к форме» получается само:
   окно закрывается, страница под ним стоит там же, где стояла.
   Пока окно открыто, прокрутка страницы под ним заперта.

   Клик по зоне внутри модели ведёт зрителя в офис: страница мгновенно
   переезжает к секции офиса и переключает её на выбранную зону, пока
   экран ещё закрыт оверлеем. Канал — lib/officeZone.ts. */

'use client';

import {
  useCallback, useEffect, useRef, useState, type FocusEvent, type FormEvent,
} from 'react';
import dynamic from 'next/dynamic';
import styles from './Contact.module.css';
import { contacts } from '@/lib/contacts';
import { POLICY_HREF } from '@/lib/legal';
import { TOUR_URL } from '@/lib/tour';
import { prefetchPlan, type RenderKey } from '@/lib/interior';
import {
  requestZone, requestOfficeStep0, scrollToOffice, setOfficeReturn,
} from '@/lib/officeZone';
import { lockScroll, unlockScroll, CONTACT_LOCK } from '@/lib/scrollLock';
import { submitLead } from '@/lib/submitLead';

/* Оба окна — те же самые, что открываются из офиса, а не их копии.
   dynamic({ ssr: false }) обязателен обоим: за 3D-моделью едет чанк
   three.js, за чертежом — лист и геометрия. Ни то, ни другое не имеет
   права попасть в первый экран (AGENTS.md, «Бюджеты»); здесь они
   уезжают по клику, ровно как из офиса. */
const PlanDollhouse = dynamic(() => import('./PlanDollhouse'), { ssr: false });
const PlanOverlay = dynamic(() => import('./PlanOverlay'), { ssr: false });

type Overlay = null | 'sheet' | 'model';

type FieldName = 'name' | 'contact';
type FieldErrors = Partial<Record<FieldName, string>>;
type Status = 'idle' | 'loading' | 'success';

const SUBMIT_ERROR_MESSAGE = 'Не получилось отправить. Попробуйте ещё раз или позвоните.';

const REQUIRED_MESSAGES: Record<FieldName, string> = {
  name: 'Как к вам обращаться?',
  contact: 'Нужен контакт для ответа',
};

/* Якорь секции. На него ведёт кнопка «Записаться на просмотр» с Landing
   (href="#contact") и он же уезжает крошкой возврата в officeZone —
   поэтому не литерал в разметке, чтобы эти трое не разъехались. */
export const CONTACT_ID = 'contact';

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
  const [submitError, setSubmitError] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /* Цель возврата фокуса, когда зритель вернётся сюда из офиса по Esc.
     Кнопка переживает всю эту дорогу: Contact не размонтируется. */
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  /* Пока окно открыто, страница под ним не ездит. Иначе колесо над
     оверлеем уносило бы форму куда-нибудь в локацию, и Esc возвращал
     бы зрителя не туда, откуда он ушёл. Оверлеи — position: fixed
     во весь вьюпорт, поэтому пропажу полосы прокрутки под ними
     физически не видно, и компенсировать её нечем. */
  useEffect(() => {
    if (!overlay) return undefined;
    lockScroll(CONTACT_LOCK);
    return () => unlockScroll(CONTACT_LOCK);
  }, [overlay]);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  /* Клик по зоне внутри 3D-модели. Приходит за 400 мс до того, как
     оверлей закроется, — это его штатный шов (см. PlanDollhouse), и
     страницу мы переставляем именно в эту щель, пока экран закрыт.

     ЗАМОК СНИМАЕМ ПЕРВЫМ ДЕЛОМ: при overflow: hidden на body
     window.scrollTo не делает ровно ничего, и офис остался бы там,
     где был, а оверлей открылся бы над формой записи. */
  const enterZone = useCallback((key: RenderKey) => {
    /* Крошка возврата ставится ЗДЕСЬ, а не в onClick кнопки: открыть
       модель и закрыть её, не выбрав зону, — это не переход в офис,
       и обратной дороги после такого оставаться не должно. Тратит
       крошку OfficeHub, при закрытии плана по Esc или «Закрыть». */
    setOfficeReturn({ id: CONTACT_ID, focus: modelBtnRef.current });
    unlockScroll(CONTACT_LOCK);
    scrollToOffice();
    /* Кадры вида уходят вниз: зритель выбрал зону, ему нужен офис,
       а не панорама поверх него. */
    requestOfficeStep0();
    requestZone(key);
  }, []);

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
    setSubmitError(false);
    try {
      await submitLead({ name, contact, comment });
      setStatus('success');
    } catch {
      setStatus('idle');
      setSubmitError(true);
    }
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
    <section className={styles.section} id={CONTACT_ID} aria-labelledby="contact-eyebrow">
      <div className={styles.inner}>
        <p className={`label ${styles.eyebrow}`} id="contact-eyebrow">
          ЗАПИСЬ НА ПРОСМОТР
        </p>

        {status === 'success' ? (
          <div className={styles.success} role="status">
            <canvas ref={canvasRef} className={styles.successCanvas} width={64} height={64} aria-hidden="true" />
            <div>
              <p className={styles.successTitle}>Благодарим за Ваш интерес</p>
              <p className={styles.successNote}>Наш менеджер свяжется с Вами в самое ближайшее время.</p>
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

            {submitError && (
              <p className={styles.error} role="alert">
                {SUBMIT_ERROR_MESSAGE}
              </p>
            )}

            {/* Новая вкладка, а не переход: уход на политику в той же
                вкладке стёр бы уже введённые имя, телефон и комментарий —
                форма не восстанавливается, состояние живёт в React.
                rel — как у Kuula, Telegram и Max выше. Обычный <a>,
                не next/link: маршрут /privacy динамический (читает host
                из заголовков), префетч был бы холостым, да и при
                target="_blank" Link всё равно вырождается в анкор. */}
            <p className={styles.legal}>
              Нажимая «Записаться», вы соглашаетесь с{' '}
              <a
                className={styles.dottedLink}
                href={POLICY_HREF}
                target="_blank"
                rel="noopener noreferrer"
              >
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
            {contacts.telegramUrl && (
              <a
                className={styles.dottedLink}
                href={contacts.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Написать в Telegram
              </a>
            )}
            {/* Ссылки на профиль в Max может не быть — у мессенджера нет
                формата «чат по номеру», нужен личный max.ru/u/… самой
                Оксаны. Мёртвую кнопку на переговорах лучше не показывать
                вовсе, чем показать ведущей в никуда. */}
            {contacts.maxUrl && (
              <a
                className={styles.dottedLink}
                href={contacts.maxUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Написать в Max
              </a>
            )}
            {/* Чертёж и модель — те же окна, что в офисе. Esc внутри них
                уже реализован и закрывает ровно одно окно, поэтому
                возврат к форме получается сам собой. */}
            <button
              type="button"
              className={`${styles.dottedLink} ${styles.linkButton}`}
              onClick={() => setOverlay('sheet')}
            >
              Чертёж
            </button>
            <button
              ref={modelBtnRef}
              type="button"
              className={`${styles.dottedLink} ${styles.linkButton}`}
              onClick={() => setOverlay('model')}
              onPointerEnter={prefetchPlan}
              onFocus={prefetchPlan}
            >
              3D-модель
            </button>
            {/* Тур — единственная ссылка в этом ряду, ведущая наружу:
                панорама живёт на kuula.co. Отсюда новая вкладка и
                noopener, как у Telegram и Max выше. */}
            <a
              className={styles.dottedLink}
              href={TOUR_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              3D-тур
            </a>
          </div>

          <p className={styles.quiet}>Аренда от собственника.</p>
        </div>
      </div>

      {/* Монтируются по клику, а не прячутся пропом. У dynamic() чанк
          едет в момент ОТРИСОВКИ, а не в момент, когда компонент решит
          что-то показать: <PlanOverlay open={false}> отрисован, значит
          уже утащил бы свой код на первый экран. Поэтому оба стоят
          за условием, и у PlanOverlay `open` всегда true. */}
      {overlay === 'sheet' && <PlanOverlay open onClose={closeOverlay} />}
      {overlay === 'model' && (
        <PlanDollhouse onClose={closeOverlay} onEnterZone={enterZone} />
      )}
    </section>
  );
}
