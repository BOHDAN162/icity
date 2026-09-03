import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';
import { RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA } from '@/lib/maxTrustedCa';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_API_HOST = 'platform-api2.max.ru';
const MAX_CA_LIST = [...rootCertificates, RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA];

function postJsonOverHttps(host: string, path: string, headers: Record<string, string>, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      { host, path, method: 'POST', headers, ca: MAX_CA_LIST },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      },
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

type LeadBody = {
  name?: unknown;
  contact?: unknown;
  comment?: unknown;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return response.ok;
}

async function sendMax(text: string): Promise<boolean> {
  const token = process.env.MAX_BOT_TOKEN;
  const chatId = process.env.MAX_CHAT_ID;
  if (!token || !chatId) return false;

  const body = JSON.stringify({ text, notify: true });
  return postJsonOverHttps(
    MAX_API_HOST,
    `/messages?chat_id=${chatId}`,
    {
      Authorization: token,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  );
}

export async function POST(request: Request) {
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const maxConfigured = Boolean(process.env.MAX_BOT_TOKEN && process.env.MAX_CHAT_ID);
  if (!telegramConfigured && !maxConfigured) {
    return Response.json({ error: 'No delivery channel is configured' }, { status: 500 });
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
  const text = lines.join('\n');

  const [telegramOk, maxOk] = await Promise.all([
    telegramConfigured ? sendTelegram(text) : Promise.resolve(false),
    maxConfigured ? sendMax(text) : Promise.resolve(false),
  ]);

  if (!telegramOk && !maxOk) {
    return Response.json({ error: 'Delivery failed on every configured channel' }, { status: 502 });
  }

  return Response.json({ ok: true });
}
