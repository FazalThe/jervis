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
        const result = await agent.run({
        startUrl: "https://search.brave.com/?lang=en-in",
        goal: instruction,
        maxSteps: 50,
        headless: false,
        });

        if (result.status === "success") {
        await ctx.reply(result.answer);
        return;
        }

        await ctx.reply(
        `JEV couldn't complete the task.\n\n${result.reason}`,
        );
    } catch (error) {
        console.error("Agent error:", error);

        await ctx.reply(
        "An unexpected error occurred while running JEV.",
        );
    }
    });

    bot.start({
        onStart: (botInfo) => {
            console.log(`Telegram bot started as @${botInfo.username}`);
        },
    });
}
