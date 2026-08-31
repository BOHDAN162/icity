/* iCITY 113Н — контакт менеджера, единственный источник.
   Путь в проекте: lib/contacts.ts

   Значения сверены с docs/facts.md §«Контакт» и docs/copy.md §8.
   maxUrl нигде в репозитории не найден — мессенджер Max упомянут
   только по имени, ссылки нет. Подставлено VERIFY_WITH_BOGDAN. */

export type ContactInfo = {
  managerName: string;
  managerRole: string;
  phoneDisplay: string;
  phoneHref: string;
  email: string;
  maxUrl: string;
};

export const contacts: ContactInfo = {
  managerName: 'Оксана Арензон',
  managerRole: 'Управляющая объектом',
  phoneDisplay: '+7 909 379-80-15',
  phoneHref: 'tel:+79093798015',
  email: 'kryakushina@arenda-34.ru',
  maxUrl: 'VERIFY_WITH_BOGDAN',
};
