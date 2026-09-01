'use client';

/* iCITY 113Н — область счёта чисел.
   Путь в проекте: components/CountUpScope.tsx

   Тонкая клиентская обёртка вокруг useCountUpOnView: любой элемент
   с `data-count` внутри неё прокручивается от нуля к своему значению,
   когда область появляется в кадре. Ровно один раз.

   ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Landing — серверный компонент, и делать его
   клиентским ради счётчика значило бы утащить в бандл всю секцию.
   Обёртка клиентская, содержимое приезжает пропсом children и остаётся
   отрисованным на сервере. Секции, которые и так 'use client'
   (Economics), берут хук напрямую и в этой обёртке не нуждаются. */

import {
  useRef, type ComponentType, type ReactNode, type Ref,
} from 'react';
import { useCountUpOnView } from '@/lib/countUp';

type Props = {
  /** тег обёртки: она обязана быть настоящим элементом раскладки секции */
  as?: 'div' | 'dl' | 'p' | 'section';
  className?: string;
  /** сколько идёт счёт, мс */
  duration?: number;
  /** пауза перед стартом: под уже занятое чем-то другим начало */
  delay?: number;
  /** доля области в кадре, после которой счёт начинается */
  threshold?: number;
  children: ReactNode;
};

export default function CountUpScope({
  as = 'div', className, duration, delay, threshold, children,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  useCountUpOnView(ref, { duration, delay, threshold });
  /* Приведение к одному типу пропсов, а не союз тегов: под союзом
     TypeScript пересекает пропсы всех четырёх элементов, и общего
     у них не остаётся — ref и className вырождаются в never. */
  const Tag = as as unknown as ComponentType<{
    ref: Ref<HTMLElement>;
    className?: string;
    children: ReactNode;
  }>;
  return <Tag ref={ref} className={className}>{children}</Tag>;
}
