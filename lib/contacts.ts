/* iCITY 113Н — контакт менеджера, единственный источник.
   Путь в проекте: lib/contacts.ts

   Значения сверены с docs/facts.md §«Контакт» и docs/copy.md §8.

   MAX: ССЫЛКИ ПО НОМЕРУ ТЕЛЕФОНА У МЕССЕНДЖЕРА НЕТ. Это не пробел
   в реализации, а устройство самого MAX: аналога wa.me/79… там не
   существует, и найти человека по номеру можно только внутри
   приложения, вручную. Работает ровно один формат — личная ссылка
   профиля вида https://max.ru/u/<хеш>, и снять её может только сам
   владелец аккаунта: профиль → «Поделиться».

   Поэтому здесь `string | null`, а не заглушка-строка: пока ссылки
   Оксаны нет, кнопка «Написать в Max» не рисуется вовсе. Мёртвая
   кнопка на экране переговоров хуже её отсутствия. Приедет ссылка —
   вписать сюда, и она появится сама. */

export type ContactInfo = {
  managerName: string;
  managerRole: string;
  phoneDisplay: string;
  phoneHref: string;
  email: string;
  /** личная ссылка профиля max.ru/u/…; null — кнопки нет */
  maxUrl: string | null;
  /** личный чат в Telegram; null — кнопки нет */
  telegramUrl: string | null;
};

export const contacts: ContactInfo = {
  managerName: 'Оксана Арензон',
  managerRole: 'Управляющая объектом',
  phoneDisplay: '+7 909 379-80-15',
  phoneHref: 'tel:+79093798015',
  email: 'kryakushina@arenda-34.ru',
  maxUrl: 'https://max.ru/u/f9LHodD0cOJotcTW8qhH3B549kRNTt5FGw6Rs1KC85ZM2K10Mqh_NL25Rvw',
  telegramUrl: 'https://t.me/OksanaArenzon',
};
