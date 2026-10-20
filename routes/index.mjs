// Composizione delle route API.
import * as settings from "./settings.mjs";
import * as backup from "./backup.mjs";
import * as kb from "./kb.mjs";
import * as profile from "./profile.mjs";
import * as review from "./review.mjs";
import * as study from "./study.mjs";
import * as compute from "./compute.mjs";
import * as conversations from "./conversations.mjs";
import * as chat from "./chat.mjs";

const handlers = [settings, backup, kb, profile, review, study, compute, conversations, chat];

export function handleApi(req, res, url, ctx) {
  for (const h of handlers) if (h.handle(req, res, url, ctx)) return true;
  return false;
}
