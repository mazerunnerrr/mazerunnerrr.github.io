# Приёмник формы

Воркер принимает заявку с сайта и пересылает её в Telegram. Токен бота остаётся
на стороне Cloudflare: в коде сайта его нет, поэтому прочитать его из браузера
нельзя.

## Что нужно один раз

1. Создать бота у `@BotFather` (`/newbot`) — он выдаст токен.
2. Написать своему боту любое сообщение, затем открыть
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и взять оттуда `chat.id`.
3. Из папки `worker`:

   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TG_BOT_TOKEN
   npx wrangler secret put TG_CHAT_ID
   ```

4. Адрес вида `https://helias-contact.<аккаунт>.workers.dev` вписать в админке
   в поле «Адрес приёмника формы» — форма на сайте появится сама.

Токен нигде не печатать и не коммитить. Если он утёк — `/revoke` у BotFather
и заново `wrangler secret put`.
