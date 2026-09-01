const TELEGRAM_API = 'https://api.telegram.org';

type LeadBody = {
  name?: unknown;
  contact?: unknown;
  comment?: unknown;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return Response.json({ error: 'Telegram is not configured' }, { status: 500 });
  }

  let body: LeadBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = asText(body.name);
  const contact = asText(body.contact);
  const comment = asText(body.comment);
  if (!name || !contact) {
    return Response.json({ error: 'name and contact are required' }, { status: 400 });
  }

  const lines = [
    'Заявка iCITY 113Н',
    `Имя: ${name}`,
    `Контакт: ${contact}`,
  ];
  if (comment) lines.push(`Комментарий: ${comment}`);

  const telegramResponse = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') }),
  });

  if (!telegramResponse.ok) {
    return Response.json({ error: 'Telegram delivery failed' }, { status: 502 });
  }

  return Response.json({ ok: true });
}
