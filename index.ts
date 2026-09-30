import { JevAgent } from "./src/agent.ts";
import { startTelegramBot } from "./src/tgbot.ts";

const agent = new JevAgent();

startTelegramBot(agent);