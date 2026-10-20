// Composizione delle route API.
import * as settings from "./settings.mjs";
import * as library from "./library.mjs";
import * as conversations from "./conversations.mjs";
import * as chat from "./chat.mjs";

const handlers = [settings, library, conversations, chat];

export function handleApi(req, res, url, ctx) {
  for (const h of handlers) if (h.handle(req, res, url, ctx)) return true;
  return false;
}
