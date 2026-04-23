# VAM System

This is a monorepo for the VAM System, built with pnpm and Turborepo.

## Architecture

- **apps/web**: Next.js frontend application
- **apps/api**: NestJS backend API
- **apps/bot**: Discord bot using discord.js
- **apps/worker**: Background job processing with BullMQ
- **packages/db**: Database schema with Prisma
- **packages/shared**: Shared DTOs and utilities
- **packages/ui**: Reusable UI components
- **packages/config**: Shared configuration files

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up the database:
   ```bash
   cd packages/db
   pnpm migrate
   ```

3. Start the development servers:
   ```bash
   pnpm dev
   ```

## Scripts

- `pnpm dev`: Run all apps in development mode
- `pnpm build`: Build all apps
- `pnpm test`: Run tests for all packages