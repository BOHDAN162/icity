/* iCITY 113Н — отправка заявки с формы записи на просмотр.
   Путь в проекте: lib/submitLead.ts

   TODO(бэкенд): сейчас это заглушка — резолвится через 900ms без
   сетевого запроса. Заменить на реальный API-роут или интеграцию
   (Telegram/почта), когда бэкенд для лида появится. */

export type LeadPayload = {
  name: string;
  contact: string;
  comment: string;
};

export async function submitLead(payload: LeadPayload): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 900));
}
