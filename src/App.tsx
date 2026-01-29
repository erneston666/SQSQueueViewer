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

const getQueueType = (queueName: string): string => {
  return queueName.toLowerCase().includes('.fifo') ? 'FIFO' : 'Standard'
}
type SortField = 'name' | 'type' | 'visible' | 'total' | 'invisible'
type SortOrder = 'asc' | 'desc'
type FilterType = 'all' | 'standard' | 'fifo' | 'withMessages'

function App() {
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [sortField, setSortField] = useState<SortField>('visible')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [filterText, setFilterText] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')

  const sortQueues = (data: Queue[], field: SortField, order: SortOrder) => {
    return [...data].sort((a, b) => {
      let valueA: number | string
      let valueB: number | string
      
      switch (field) {
        case 'name':
          valueA = a.name.toLowerCase()
          valueB = b.name.toLowerCase()
          break
        case 'type':
          valueA = getQueueType(a.name)
          valueB = getQueueType(b.name)
          break
        case 'visible':
          valueA = a.statistics.approximateNumberOfVisibleMessages
          valueB = b.statistics.approximateNumberOfVisibleMessages
          break
        case 'total':
          valueA = a.statistics.approximateNumberOfVisibleMessages + a.statistics.approximateNumberOfMessagesDelayed + a.statistics.approximateNumberOfInvisibleMessages
          valueB = b.statistics.approximateNumberOfVisibleMessages + b.statistics.approximateNumberOfMessagesDelayed + b.statistics.approximateNumberOfInvisibleMessages
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
    let filtered = data
    
    // Apply type filter
    switch (filterType) {
      case 'standard':
        filtered = filtered.filter(queue => getQueueType(queue.name) === 'Standard')
        break
      case 'fifo':
        filtered = filtered.filter(queue => getQueueType(queue.name) === 'FIFO')
        break
      case 'withMessages':
        filtered = filtered.filter(queue => {
          const total = queue.statistics.approximateNumberOfVisibleMessages + 
                       queue.statistics.approximateNumberOfMessagesDelayed + 
                       queue.statistics.approximateNumberOfInvisibleMessages
          return total > 0
        })
        break
      case 'all':
      default:
        // No additional filtering
        break
    }
    
    // Apply text filter
    if (!filterText.trim()) return filtered
    
    // Split by comma and trim each term
    const filterTerms = filterText.split(',').map(term => term.trim().toLowerCase()).filter(term => term.length > 0)
    
    return filtered.filter(queue => {
      const queueNameLower = queue.name.toLowerCase()
      // Return true if queue name includes any of the filter terms
      return filterTerms.some(term => queueNameLower.includes(term))
    })
  }

  const getFilteredAndSortedQueues = () => {
    const filtered = filterQueues(queues)
    return sortQueues(filtered, sortField, sortOrder)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const handleFilterTypeChange = (type: FilterType) => {
    setFilterType(type)
  }

  const fetchQueues = async () => {
    try {
      const response = await fetch('http://localhost:9325/statistics/queues')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: Queue[] = await response.json()
      
      setQueues(data)
      setError(null)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQueues()
  }, [])

  useEffect(() => {
    // Set up polling interval - refresh every second
    const interval = setInterval(fetchQueues, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [])


  return (
    <div className="app">
      <header className="app-header">
        <h1>Local SQS Queue Viewer</h1>
        <p className="header-subtitle">Monitoring local SQS queues on localhost:9325</p>
      </header>
      
      {loading && <div className="loading">Loading...</div>}
      
      {error && (
        <div className="error">
          Error connecting to local SQS: {error}
        </div>
      )}

      <div className="controls-section">
        <div className="filter-section">
          <div className="filter-types">
            <label className="filter-type">
              <input
                type="radio"
                checked={filterType === 'all'}
                onChange={() => handleFilterTypeChange('all')}
              />
              <span>All</span>
            </label>
            <label className="filter-type">
              <input
                type="radio"
                checked={filterType === 'standard'}
                onChange={() => handleFilterTypeChange('standard')}
              />
              <span>Standard</span>
            </label>
            <label className="filter-type">
              <input
                type="radio"
                checked={filterType === 'fifo'}
                onChange={() => handleFilterTypeChange('fifo')}
              />
              <span>FIFO</span>
            </label>
            <label className="filter-type">
              <input
                type="radio"
                checked={filterType === 'withMessages'}
                onChange={() => handleFilterTypeChange('withMessages')}
              />
              <span>With Messages</span>
            </label>
          </div>
          <div className="search-section">
            <input
              type="text"
              placeholder="Search queues..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        {lastUpdate && (
          <div className="last-update">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      <div className="table-container">
        <table className="queues-table">
          <thead>
            <tr>
              <th 
                className={`sortable ${sortField === 'name' ? 'active' : ''}`}
                onClick={() => handleSort('name')}
              >
                Queue Name
                <span className="sort-indicator">
                  {sortField === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable type-header ${sortField === 'type' ? 'active' : ''}`}
                onClick={() => handleSort('type')}
              >
                Type
                <span className="sort-indicator">
                  {sortField === 'type' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable visible-header ${sortField === 'visible' ? 'active' : ''}`}
                onClick={() => handleSort('visible')}
              >
                Visible
                <span className="sort-indicator">
                  {sortField === 'visible' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable invisible-header ${sortField === 'invisible' ? 'active' : ''}`}
                onClick={() => handleSort('invisible')}
              >
                Not Visible
                <span className="sort-indicator">
                  {sortField === 'invisible' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
              <th 
                className={`sortable total-header ${sortField === 'total' ? 'active' : ''}`}
                onClick={() => handleSort('total')}
              >
                Total
                <span className="sort-indicator">
                  {sortField === 'total' && (sortOrder === 'asc' ? '▲' : '▼')}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {getFilteredAndSortedQueues().map((queue) => {
              const total = queue.statistics.approximateNumberOfVisibleMessages + queue.statistics.approximateNumberOfMessagesDelayed + queue.statistics.approximateNumberOfInvisibleMessages
              return (
                <tr key={queue.name}>
                  <td className="queue-name-cell">{queue.name}</td>
                  <td className="type-cell">{getQueueType(queue.name)}</td>
                  <td className="visible-cell">{queue.statistics.approximateNumberOfVisibleMessages}</td>
                  <td className="invisible-cell">{queue.statistics.approximateNumberOfInvisibleMessages}</td>
                  <td className="total-cell">{total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && !error && getFilteredAndSortedQueues().length === 0 && (
        <div className="no-queues">
          {queues.length === 0 ? 'No queues found' : 'No queues match the filter'}
        </div>
      )}
    </div>
  )
}

export default App
