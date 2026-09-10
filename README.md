# Smart Importer

Smart Importer is a Tauri + React desktop frontend with an Express + SQLite backend that imports Excel spreadsheets into a products database.

## Requirements

- Node.js 22+
- Rust/Cargo (for Tauri desktop development)

### Linux-only Tauri system packages

If you are running the desktop shell on Linux, install the required GTK/WebKit packages first:

```bash
sudo apt-get update
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev
```

## Install

```bash
npm install
```

## Run the backend

```bash
npm run dev:backend
```

The backend runs on `http://localhost:3001` and exposes:

- `POST /api/import`
- `GET /api/products`
- `GET /api/imports`

## Run the frontend in the browser

```bash
npm run dev:frontend
```

The frontend defaults to `http://localhost:3001` and can be pointed elsewhere with `VITE_API_BASE_URL`.

## Run the Tauri desktop app

Tauri development starts both the Vite frontend and Express backend automatically:

```bash
npm run tauri:dev
```

## Import spreadsheet expectations

The importer reads the first sheet in `.xlsx` or `.xls` files and accepts these headers case-insensitively (for example `name` or `Name`):

- `name` / `Name`
- `sku` / `SKU`
- `price` / `Price`
- `quantity` / `Quantity`
