import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/* iCITY 113Н — метка жёсткой перезагрузки для прелоадера.
   Путь в проекте: proxy.ts (Next 16: middleware.ts переименован в proxy.ts)

   ЗАЧЕМ. Обычная перезагрузка (Cmd/Ctrl+R) шлёт Cache-Control: max-age=0,
   жёсткая (Cmd/Ctrl+Shift+R, минуя кэш) — Cache-Control: no-cache. Разница
   держится в Chrome и Firefox; Safari её не гарантирует — там жёсткая
   перезагрузка просто ведёт себя как обычная, прелоадер не покажется
   повторно (деградация, не поломка).

   JS на клиенте эту разницу не видит вообще (тот же navigation.type
   'reload' для обеих), поэтому единственная точка, где её можно поймать, —
   заголовок запроса на сервере. Помечаем такой запрос кукой на один показ;
   Preloader.tsx читает её и один раз игнорирует sessionStorage. Страница
   остаётся статической — proxy лишь довешивает Set-Cookie поверх ответа. */
export function proxy(request: NextRequest) {
  const cacheControl = request.headers.get('cache-control') ?? '';
  const response = NextResponse.next();
  if (/no-cache/i.test(cacheControl)) {
    response.cookies.set('icity-hard-reload', '1', { path: '/', maxAge: 5 });
  }
  return response;
}

export const config = {
  matcher: '/',
};
