import { Bot } from "grammy";
import "dotenv/config";
import { JevAgent } from "./agent";

export function startTelegramBot(agent: JevAgent) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        throw new Error("TELEGRAM_BOT_TOKEN is missing");
    }

    const bot = new Bot(token);

    bot.on("message:text", async (ctx) => {
        const instruction = ctx.message.text;

        console.log("Received:", instruction);

        try {
            await agent.run({
                startUrl: "https://search.brave.com/?lang=en-in",
                goal: instruction,
                maxSteps: 50,
                headless: false,
            });

            await ctx.reply("Finished.");
        } catch (error) {
            console.error("Agent error:", error);
            await ctx.reply("JEV encountered an error.");
        }
    });

    bot.start({
        onStart: (botInfo) => {
            console.log(`Telegram bot started as @${botInfo.username}`);
        },
    });
}
