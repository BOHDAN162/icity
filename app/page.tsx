/* iCITY 113Н — главная.
   Путь в проекте: app/page.tsx

   Экран 1 — герой с секвенцией: сам занимает 100svh и держит свой rAF,
   обёрток с высотой, скроллом или пиннингом вокруг него быть не должно.

   Всё, что ниже героя, лежит внутри .afterHero. Липкая панель — первый
   элемент этой области, поэтому она появляется ровно с экрана 2
   и никакого JS для «появиться начиная с…» не требуется. */

import TowerSequence from '@/components/TowerSequence';
import StickyBar from '@/components/StickyBar';
import Landing from '@/components/Landing';
import styles from './page.module.css';

export default function Home() {
  return (
    <main>
      <TowerSequence />
      <div className={styles.afterHero}>
        <StickyBar />
        <Landing />
      </div>
    </main>
  );
}
