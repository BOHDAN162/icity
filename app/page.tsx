/* iCITY 113Н — главная.
   Путь в проекте: app/page.tsx

   Пока на странице ровно один экран — герой с секвенцией башни.
   TowerSequence сам занимает 100svh и сам держит свой rAF;
   обёрток с высотой, скроллом или пиннингом вокруг него быть не должно. */

import TowerSequence from '@/components/TowerSequence';

export default function Home() {
  return (
    <main>
      <TowerSequence />
    </main>
  );
}
