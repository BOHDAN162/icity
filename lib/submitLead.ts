/* iCITY 113Н — отправка заявки с формы записи на просмотр.
   Путь в проекте: lib/submitLead.ts

   Уходит на app/api/lead/route.ts, который пересылает заявку в Telegram-группу
   и в группу MAX — оба канала независимы, best-effort: заявка считается
   отправленной, если сработал хотя бы один. Токены и chat_id — переменные
   окружения TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID и MAX_BOT_TOKEN /
   MAX_CHAT_ID, серверные, без NEXT_PUBLIC_. */

export type LeadPayload = {
  name: string;
  contact: string;
  comment: string;
};

export async function submitLead(payload: LeadPayload): Promise<void> {
  const response = await fetch('/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Lead submission failed');
  }
}
