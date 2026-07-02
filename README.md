# SQS Queue Viewer

Angular 21 + PrimeNG dashboard for monitoring local ElasticMQ/SQS queues.

## Features

- Polls `http://localhost:9325/statistics/queues` every second.
- Filters by queue type, message presence, favorites, and comma-separated text terms.
- Sorts by queue name, type, visible messages, invisible messages, and total messages.
- Stores favorites and light/dark theme preference in `localStorage`.
- Purges and deletes queues through the ElasticMQ SQS endpoint at `http://localhost:9324/`.

## Development

```bash
npm install
npm start
```

The app will be served by Angular CLI, usually at `http://localhost:4200/`.

## Build

```bash
npm run build
```

Production builds keep the previous deployment base path: `/SQSQueueViewer/`.

## Test

```bash
npm test
```
