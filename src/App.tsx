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

function App() {
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchQueues = async () => {
    try {
      const response = await fetch('http://localhost:9325/statistics/queues')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: Queue[] = await response.json()
      
      // Ordenar por número de mensajes visibles (de mayor a menor)
      const sortedQueues = data.sort((a, b) => 
        b.statistics.approximateNumberOfVisibleMessages - a.statistics.approximateNumberOfVisibleMessages
      )
      
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
    const interval = setInterval(fetchQueues, 10000)

    // Limpiar intervalo cuando el componente se desmonte
    return () => clearInterval(interval)
  }, [])

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

      <div className="queues-container">
        {queues.map((queue, index) => (
          <div key={queue.name} className="queue-card">
            <h3 className="queue-name">{queue.name}</h3>
            <div className="queue-stats">
              <div className="stat visible">
                <span className="stat-label">Mensajes Visibles:</span>
                <span className="stat-value">{queue.statistics.approximateNumberOfVisibleMessages}</span>
              </div>
              <div className="stat invisible">
                <span className="stat-label">Mensajes Invisibles:</span>
                <span className="stat-value">{queue.statistics.approximateNumberOfInvisibleMessages}</span>
              </div>
              <div className="stat delayed">
                <span className="stat-label">Mensajes Retrasados:</span>
                <span className="stat-value">{queue.statistics.approximateNumberOfMessagesDelayed}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && queues.length === 0 && (
        <div className="no-queues">No se encontraron colas</div>
      )}
    </div>
  )
}

export default App
