'use client';

/* iCITY 113Н — первый акт: облака, башня, вход в офис.
   Путь в проекте: components/ActOne.tsx

   Здесь живёт одно состояние — открыт офис или нет — и блокировка
   скролла страницы, пока он открыт. Больше этот файл ничего не делает:
   секвенцией занимается TowerSequence, зонами — OfficeHub.

   БЛОКИРОВКА СКРОЛЛА. overflow: hidden на body в iOS Safari не держит,
   поэтому body фиксируется с отрицательным top. Смещение запоминаем и
   возвращаем ровно на место при выходе — иначе страница прыгает в начало.
   Офис перекрывает экран целиком, так что перестановка не видна. */

import { useCallback, useEffect, useRef, useState } from 'react';
import TowerSequence from './TowerSequence';
import OfficeHub from './OfficeHub';

export default function ActOne() {
  const [officeOpen, setOfficeOpen] = useState(false);
  const [returnRequestId, setReturnRequestId] = useState(0);
  const lockedAtRef = useRef(0);

  const enterOffice = useCallback(() => setOfficeOpen(true), []);

  const exitOffice = useCallback(() => {
    setOfficeOpen(false);
    // сигнал секвенции: плавно отвести камеру назад, к 90 % секции
    setReturnRequestId((n) => n + 1);
  }, []);

  useEffect(() => {
    const body = document.body;
    if (officeOpen) {
      lockedAtRef.current = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `${-lockedAtRef.current}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';
      return () => {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        // возвращаем страницу туда, где её застали, до анимации возврата
        window.scrollTo(0, lockedAtRef.current);
      };
    }
    return undefined;
  }, [officeOpen]);

  return (
    <>
      <TowerSequence onEnterOffice={enterOffice} returnRequestId={returnRequestId} />
      <OfficeHub open={officeOpen} onExit={exitOffice} />
    </>
  );
}
