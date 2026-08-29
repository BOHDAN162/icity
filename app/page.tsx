/* iCITY 113Н — главная.
   Путь в проекте: app/page.tsx

   Три экрана подряд, все три — обычные секции одной прокручиваемой
   страницы. Ни один из них ничего не блокирует: прежний ActOne
   фиксировал body, пока открыт офис, и офис был тупиком — выйти
   можно было только кнопкой. Файл удалён.

   1. TowerSequence — облака и подъём вдоль башни, `id="tower"`.
   2. OfficeStop — офис-остановка и кадр вида из окна, один липкий
      экран на две сцены со швом между ними.
   3. Landing — ряд чисел, абзац и кнопки. Над ним липкая панель:
      она в потоке и прилипает к верху своей области, поэтому
      появляется ровно тогда, когда верх Landing переходит нижнюю
      кромку экрана, и за пределы области не выходит. */

import TowerSequence from '@/components/TowerSequence';
import OfficeStop from '@/components/OfficeStop';
import StickyBar from '@/components/StickyBar';
import Landing from '@/components/Landing';
import styles from './page.module.css';

export default function Home() {
  return (
    <main>
      <TowerSequence />
      <OfficeStop />
      <div className={styles.afterHero}>
        <StickyBar />
        <Landing />
      </div>
    </main>
  );
}
