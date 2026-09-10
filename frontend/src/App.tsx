import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type Product = {
  id: number
  name: string
  sku: string
  price: number
  quantity: number
}

type ImportRecord = {
  id: number
  filename: string
  row_count: number
  imported_at: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [imports, setImports] = useState<ImportRecord[]>([])

  const fileName = useMemo(() => selectedFile?.name ?? 'No file selected', [selectedFile])

  async function refreshData() {
    const [productsResponse, importsResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/products`),
      fetch(`${API_BASE_URL}/api/imports`),
    ])

    if (!productsResponse.ok || !importsResponse.ok) {
      throw new Error('Failed to refresh imported data')
    }

    const [productsData, importsData] = await Promise.all([
      productsResponse.json() as Promise<Product[]>,
      importsResponse.json() as Promise<ImportRecord[]>,
    ])

    setProducts(productsData)
    setImports(importsData)
  }

  useEffect(() => {
    void refreshData().catch((refreshError: unknown) => {
      setError(
        refreshError instanceof Error ? refreshError.message : 'Failed to load imported data',
      )
    })
  }, [])

  async function handleImport() {
    if (!selectedFile) {
      setError('Please choose an Excel file to import.')
      setRowCount(null)
      return
    }

    setIsLoading(true)
    setError('')
    setRowCount(null)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch(`${API_BASE_URL}/api/import`, {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json()) as { rowCount?: number; error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Import failed')
      }

      setRowCount(data.rowCount ?? 0)
      setSelectedFile(null)
      await refreshData()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed')
    } finally {
      setIsLoading(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    setError('')
  }

  return (
    <main className="app-shell">
      <section className="panel hero-panel">
        <p className="eyebrow">Tauri + Express</p>
        <h1>Smart Importer</h1>
        <p className="subtitle">
          Import an Excel spreadsheet and turn it into a searchable products database.
        </p>

        <div className="import-controls">
          <label className="file-picker" htmlFor="spreadsheet-upload">
            Choose Excel File
          </label>
          <input
            id="spreadsheet-upload"
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
          />
          <span className="file-name">{fileName}</span>
          <button type="button" onClick={handleImport} disabled={isLoading || !selectedFile}>
            {isLoading ? 'Importing…' : 'Import'}
          </button>
        </div>

        {rowCount !== null ? (
          <p className="message success">Successfully imported {rowCount} rows.</p>
        ) : null}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      <section className="data-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Recent Imports</h2>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void refreshData().catch((refreshError: unknown) => {
                  setError(
                    refreshError instanceof Error
                      ? refreshError.message
                      : 'Failed to load imported data',
                  )
                })
              }
            >
              Refresh
            </button>
          </div>
          {imports.length ? (
            <ul className="list">
              {imports.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.filename}</strong>
                  <span>{entry.row_count} rows</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No imports yet.</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Products</h2>
            <span>{products.length} loaded</span>
          </div>
          {products.length ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Price</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.sku || '—'}</td>
                      <td>${product.price.toFixed(2)}</td>
                      <td>{product.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">No products imported yet.</p>
          )}
        </article>
      </section>
    </main>
  )
}

export default App
