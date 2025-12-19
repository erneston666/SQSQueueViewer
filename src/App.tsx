import { useState, useEffect } from 'react'
import './App.css'

interface QueueStatistics {
  approximateNumberOfInvisibleMessages: number
  approximateNumberOfMessagesDelayed: number
  approximateNumberOfVisibleMessages: number
}

interface Queue {
  name: string
  statistics: QueueStatistics
}

type SortField = 'name' | 'visible' | 'delayed' | 'invisible'
type SortOrder = 'asc' | 'desc'

function App() {
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [sortField, setSortField] = useState<SortField>('visible')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [filterText, setFilterText] = useState('')

  const sortQueues = (data: Queue[], field: SortField, order: SortOrder) => {
    return [...data].sort((a, b) => {
      let valueA: number | string
      let valueB: number | string
      
      switch (field) {
        case 'name':
          valueA = a.name.toLowerCase()
          valueB = b.name.toLowerCase()
          break
        case 'visible':
          valueA = a.statistics.approximateNumberOfVisibleMessages
          valueB = b.statistics.approximateNumberOfVisibleMessages
          break
        case 'delayed':
          valueA = a.statistics.approximateNumberOfMessagesDelayed
          valueB = b.statistics.approximateNumberOfMessagesDelayed
          break
        case 'invisible':
          valueA = a.statistics.approximateNumberOfInvisibleMessages
          valueB = b.statistics.approximateNumberOfInvisibleMessages
          break
      }
      
      if (typeof valueA === 'string') {
        return order === 'asc' 
          ? valueA.localeCompare(valueB as string)
          : (valueB as string).localeCompare(valueA)
      } else {
        return order === 'asc' 
          ? (valueA as number) - (valueB as number)
          : (valueB as number) - (valueA as number)
      }
    })
  }

  const filterQueues = (data: Queue[]) => {
    if (!filterText.trim()) return data
    return data.filter(queue => 
      queue.name.toLowerCase().includes(filterText.toLowerCase().trim())
    )
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const fetchQueues = async () => {
    try {
      const response = await fetch('http://localhost:9325/statistics/queues')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: Queue[] = await response.json()
      
      const sortedQueues = sortQueues(data, sortField, sortOrder)
      
      setQueues(sortedQueues)
      setError(null)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch inicial
    fetchQueues()

    // Configurar intervalo para hacer fetch cada 10 segundos
    const interval = setInterval(fetchQueues, 5000)

    // Limpiar intervalo cuando el componente se desmonte
    return () => clearInterval(interval)
  }, [])

  // Reordenar cuando cambien los criterios de ordenación
  useEffect(() => {
    if (queues.length > 0) {
      const sortedQueues = sortQueues(queues, sortField, sortOrder)
      setQueues(sortedQueues)
    }
  }, [sortField, sortOrder])

  return (
    <div className="app">
      <h1>SQS Queue Viewer</h1>
      
      {lastUpdate && (
        <p className="last-update">
          Última actualización: {lastUpdate.toLocaleTimeString()}
        </p>
      )}

      {loading && <div className="loading">Cargando...</div>}
      
      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      <div className="filter-container">
        <input
          type="text"
          placeholder="Filtrar colas por nombre..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="filter-input"
        />
      </div>

      <div className="table-container">
        <table className="queues-table">
          <thead>
            <tr>
              <th 
                className={`sortable ${sortField === 'name' ? 'active' : ''}`}
                onClick={() => handleSort('name')}
              >
                Nombre de la Cola
                <span className="sort-indicator">
                  {sortField === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable visible-header ${sortField === 'visible' ? 'active' : ''}`}
                onClick={() => handleSort('visible')}
              >
                Visibles
                <span className="sort-indicator">
                  {sortField === 'visible' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable delayed-header ${sortField === 'delayed' ? 'active' : ''}`}
                onClick={() => handleSort('delayed')}
              >
                Retrasados
                <span className="sort-indicator">
                  {sortField === 'delayed' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable invisible-header ${sortField === 'invisible' ? 'active' : ''}`}
                onClick={() => handleSort('invisible')}
              >
                No Visibles
                <span className="sort-indicator">
                  {sortField === 'invisible' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filterQueues(queues).map((queue) => (
              <tr key={queue.name}>
                <td className="queue-name-cell">{queue.name}</td>
                <td className="visible-cell">{queue.statistics.approximateNumberOfVisibleMessages}</td>
                <td className="delayed-cell">{queue.statistics.approximateNumberOfMessagesDelayed}</td>
                <td className="invisible-cell">{queue.statistics.approximateNumberOfInvisibleMessages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && !error && filterQueues(queues).length === 0 && (
        <div className="no-queues">
          {queues.length === 0 ? 'No se encontraron colas' : 'No hay colas que coincidan con el filtro'}
        </div>
      )}
    </div>
  )
}

export default App
