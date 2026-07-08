# App

This directory contains the local VideoFlow web app.

## Structure

- `server.js`: Node HTTP server for projects, settings, script cleanup, storyboard generation, MiniMax voiceover generation, and FFmpeg rendering.
- `server/`: shared server helpers.
- `client/`: Vite, React, TypeScript, Tailwind CSS frontend.

The server serves the built frontend from `app/client/dist/`.
