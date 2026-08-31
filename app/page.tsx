/* iCITY 113Н — главная.
   Путь в проекте: app/page.tsx

   Первый экран — HeroVideo: постер облаков, кнопка «Войти», ролик полёта
   к башне. Пока он жив, HeroGate держит скролл и inert на контенте;
   в финале ролика контент выезжает снизу, hero размонтируется, и дальше
   страница — обычная прокрутка. Возврат к hero — только перезагрузка.

   1. HeroVideo — постер → ролик полёта, внутри HeroGate.
   2. OfficeStop — офис-остановка и кадр вида из окна, один липкий
      экран на две сцены со швом между ними.
   3. Landing — ряд чисел, абзац и кнопки. Над ним липкая панель:
      она в потоке и прилипает к верху своей области, поэтому
      появляется ровно тогда, когда верх Landing переходит нижнюю
      кромку экрана, и за пределы области не выходит. */

import HeroGate from '@/components/HeroGate';
import OfficeStop from '@/components/OfficeStop';
import StickyBar from '@/components/StickyBar';
import Landing from '@/components/Landing';
import Economics from '@/components/Economics';
import Complex from '@/components/Complex';
import Location from '@/components/Location';
import Faq from '@/components/Faq';
import Contact from '@/components/Contact';
import Footer from '@/components/Footer';
import styles from './page.module.css';

export default function Home() {
  return (
    <main>
      <HeroGate>
        <OfficeStop />
        <div className={styles.afterHero}>
          <StickyBar />
          <Landing />
          {/* 4. Economics — экономика сделки, сразу за рядом чисел 113Н:
                шкала «рынок против нашей ставки» и полоса фактов. */}
          <Economics />
          {/* 5. Complex — комплекс iCITY: список удобств этажами ниже
                и кадр, который открывается из растра фритты. */}
          <Complex />
          {/* 6. Location — локация: схема района чертёжной графикой
                и таблица времени в пути с точечным выносом. */}
          <Location />
          {/* 7. Faq — вопросы до просмотра: аккордеон-оглавление,
                единственный открытый пункт держит браузер сам. */}
          <Faq />
          {/* 8. Contact — запись на просмотр: последняя секция страницы,
                её эмоциональная кульминация. После неё только тихий Footer. */}
          <Contact />
        </div>
        <Footer />
      </HeroGate>
    </main>
  );
}
