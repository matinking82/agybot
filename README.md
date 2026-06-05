# Antigravity Agent Telegram Bot

This project is a Telegram bot designed to command the Antigravity AI Agent (agy) directly from Telegram and run on your server. It allows you to manage projects, execute commands, and interact with the AI via a conversational interface.

## Features

- **Telegram Interface**: Interact with the Antigravity AI agent seamlessly through Telegram.
- **Project Management**: Create, view, and manage agent workspaces.
- **Command Execution**: Send instructions to the agent to be executed securely on the server.
- **Access Control**: Includes authentication with an initial admin account.
- **Persistent Data**: Utilizes MariaDB and Prisma ORM to store data.
- **Dockerized Deployment**: Easy deployment and setup using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed on your server.
- A Telegram Bot Token from [@BotFather](https://t.me/botfather).

## Setup & Installation

### Using Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd agybot
   ```

2. **Environment Configuration:**
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```
   Open the `.env` file and configure the following important variables:
   - `BOT_TOKEN`: Your Telegram bot token obtained from @BotFather.
   - `JWT_SECRET`: Change this to a secure random string for production.
   - `INITUSERNAME`: Set your initial admin username (default is `admin`).
   - `INITPASSWORD`: Set your initial admin password (default is `admin`).
   - `AGENT_WORKSPACE`: The directory where the agent's projects will be stored (default is `/tmp/agent-workspace`).

3. **Start the application:**
   Run the following command to build the app and start the database and bot containers in the background:
   ```bash
   docker-compose up -d --build
   ```
   The bot should now be running and connected to the database.

### Local Development Setup

If you wish to develop or run the Node.js application locally (requires Node.js and a running MySQL/MariaDB server):

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Configuration:**
   Copy `.env.example` to `.env` and configure `BOT_TOKEN` and `DATABASE_URL` (point it to your local or remote database).

3. **Database Setup:**
   Generate the Prisma client and push the schema to your database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the Bot in Development Mode:**
   ```bash
   npm run dev
   ```

## Usage

1. Open Telegram and search for your bot using its username.
2. Start the conversation with `/start`.
3. Log in using the credentials specified in your `.env` file (`INITUSERNAME` and `INITPASSWORD`).
4. Once authenticated, you can send text prompts or commands to manage your server and projects through the AI agent.
