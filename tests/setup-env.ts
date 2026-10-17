/**
 * Global Jest setup: hard-isolate the unit test suite from live external
 * channels.
 *
 * The orchestrator falls back to `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from
 * the environment when a pipeline run does not receive explicit notification
 * options. Developers commonly export the real bot credentials in their shell
 * (and `src/cli.ts` loads the project `.env`), which caused "mock failure"
 * unit tests to talk to the production Telegram chat.
 *
 * Removing those variables here guarantees that no test can accidentally reach
 * the live Telegram API, even if the credentials are present in the shell
 * environment. Tests that need to exercise the Telegram channel inject their own
 * adapter/token explicitly.
 */
process.env.NODE_ENV = 'test';

delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
