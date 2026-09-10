const express = require('express');
const multer = require('multer');
const readXlsxFile = require('read-excel-file/node');
const Database = require('better-sqlite3');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const databasePath = path.join(dataDir, 'smart-importer.db');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== '.xlsx') {
      callback(new Error('Only .xlsx files are supported'));
      return;
    }

    callback(null, true);
  }
});

const db = new Database(databasePath);
console.log(`Connected to SQLite database at ${databasePath}`);

function createRateLimiter({ windowMs, maxRequests }) {
  const requests = new Map();

  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = requests.get(key);

    if (!entry || now - entry.startedAt >= windowMs) {
      requests.set(key, { count: 1, startedAt: now });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests, please try again later' });
      return;
    }

    entry.count += 1;
    next();
  };
}

const importRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
const readRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

async function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT,
      price REAL,
      quantity INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getCellValue(row, acceptedKeys) {
  const match = Object.keys(row).find((key) => {
    const normalizedKey = String(key).trim().toLowerCase();
    return acceptedKeys.includes(normalizedKey);
  });

  return match ? row[match] : undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProductRow(row) {
  return {
    name: String(getCellValue(row, ['name']) ?? '').trim(),
    sku: String(getCellValue(row, ['sku']) ?? '').trim(),
    price: toNumber(getCellValue(row, ['price'])),
    quantity: Math.trunc(toNumber(getCellValue(row, ['quantity'])))
  };
}

function resolveUploadedFilePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(uploadsDir, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid upload path');
  }

  return resolvedPath;
}

async function cleanupUploadedFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to remove uploaded file:', error);
    }
  }
}

async function readSpreadsheetRows(filePath) {
  const worksheetRows = await readXlsxFile(filePath);
  if (!worksheetRows.length) {
    throw new Error('The Excel file does not contain any sheets');
  }

  const [headerValues, ...dataValues] = worksheetRows;
  const headers = headerValues.map((value) => String(value ?? '').trim());

  if (!headers.some(Boolean)) {
    throw new Error('The Excel file does not contain any data rows');
  }

  const rawRows = dataValues.map((cells) => {
    const rowData = {};
    headers.forEach((header, index) => {
      if (!header) {
        return;
      }

      rowData[header] = cells[index] ?? '';
    });
    return rowData;
  });

  return rawRows.filter((row) => Object.values(row).some((value) => value !== ''));
}

app.post('/api/import', importRateLimit, upload.single('file'), async (req, res) => {
  console.log('POST /api/import');

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const rows = await readSpreadsheetRows(resolveUploadedFilePath(req.file.path));

    if (!rows.length) {
      res.status(400).json({ error: 'The Excel file does not contain any data rows' });
      return;
    }

    const products = rows
      .map(normalizeProductRow)
      .filter((product) => product.name.length > 0);

    if (!products.length) {
      res.status(400).json({ error: 'No valid product rows were found in the Excel file' });
      return;
    }

    const insertProduct = db.prepare(
      'INSERT INTO products (name, sku, price, quantity) VALUES (?, ?, ?, ?)'
    );
    const insertImport = db.prepare(
      'INSERT INTO imports (filename, row_count) VALUES (?, ?)'
    );

    const importProducts = db.transaction((items) => {
      for (const product of items) {
        insertProduct.run(product.name, product.sku, product.price, product.quantity);
      }

      insertImport.run(req.file.originalname, items.length);
    });

    importProducts(products);

    console.log(`Imported ${products.length} rows from ${req.file.originalname}`);
    res.json({
      success: true,
      message: `Imported ${products.length} rows successfully`,
      rowCount: products.length
    });
  } catch (error) {
    console.error('Import failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to import Excel file';
    const isUploadValidationError =
      error instanceof multer.MulterError ||
      errorMessage === 'Only .xlsx files are supported' ||
      errorMessage === 'Invalid upload path' ||
      errorMessage === 'The Excel file does not contain any sheets' ||
      errorMessage === 'The Excel file does not contain any data rows';
    res.status(isUploadValidationError ? 400 : 500).json({
      error: isUploadValidationError ? errorMessage : 'Failed to import Excel file'
    });
  } finally {
    await cleanupUploadedFile(req.file?.path);
  }
});

app.get('/api/products', readRateLimit, async (_req, res, next) => {
  try {
    const products = db
      .prepare('SELECT * FROM products ORDER BY created_at DESC, id DESC')
      .all();
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.get('/api/imports', readRateLimit, async (_req, res, next) => {
  try {
    const imports = db
      .prepare('SELECT * FROM imports ORDER BY imported_at DESC, id DESC')
      .all();
    res.json(imports);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const errorMessage = error instanceof Error ? error.message : 'Internal server error';
  const isClientError =
    error instanceof multer.MulterError ||
    errorMessage === 'Only .xlsx files are supported';

  if (isClientError) {
    console.warn('Request validation error:', errorMessage);
  } else {
    console.error('Unhandled server error:', error);
  }

  res.status(isClientError ? 400 : 500).json({
    error: isClientError ? errorMessage : 'Internal server error'
  });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Smart Importer backend running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
