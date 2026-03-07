# Ian's Support Bot

A personal Telegram assistant built with Node.js.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in your credentials
3. Start the server: `npm start` (or `npm run dev` for development)
4. Register the webhook: `npm run setup-webhook -- <your-public-url>/webhook`

## Requirements

- Node.js 20+
- A Telegram bot token from @BotFather
- Google API credentials (Calendar, Tasks, Gmail)
- Anthropic API key
