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
type FilterType = 'all' | 'standard' | 'fifo' | 'withMessages' | 'favorites'

function App() {
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [sortField, setSortField] = useState<SortField>('visible')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [filterText, setFilterText] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [operationInProgress, setOperationInProgress] = useState<{[queueName: string]: 'purging' | 'deleting'}>({})  
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Load favorites from localStorage on component mount
  useEffect(() => {
    const savedFavorites = localStorage.getItem('sqsQueueViewerFavorites')
    console.log('Loading favorites from localStorage:', savedFavorites)
    if (savedFavorites) {
      try {
        const favoritesArray = JSON.parse(savedFavorites)
        console.log('Parsed favorites:', favoritesArray)
        setFavorites(new Set(favoritesArray))
      } catch (err) {
        console.error('Failed to load favorites from localStorage:', err)
      }
    }
  }, [])

  // Save favorites to localStorage whenever favorites change
  useEffect(() => {
    const favoritesArray = Array.from(favorites)
    console.log('Saving favorites to localStorage:', favoritesArray)
    localStorage.setItem('sqsQueueViewerFavorites', JSON.stringify(favoritesArray))
  }, [favorites])

  const toggleFavorite = (queueName: string) => {
    console.log('Toggling favorite for:', queueName)
    setFavorites(prev => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(queueName)) {
        newFavorites.delete(queueName)
        console.log('Removed from favorites:', queueName)
      } else {
        newFavorites.add(queueName)
        console.log('Added to favorites:', queueName)
      }
      console.log('New favorites:', Array.from(newFavorites))
      return newFavorites
    })
  }

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
      case 'favorites':
        filtered = filtered.filter(queue => favorites.has(queue.name))
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

  const purgeQueue = async (queueName: string) => {
    if (!confirm(`Are you sure you want to purge all messages from queue "${queueName}"? This action cannot be undone.`)) {
      return
    }

    setOperationInProgress(prev => ({ ...prev, [queueName]: 'purging' }))
    
    try {
      // ElasticMQ uses SQS interface - need to get queue URL first
      const queueUrl = `http://localhost:9324/000000000000/${queueName}`
      
      const response = await fetch('http://localhost:9324/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `Action=PurgeQueue&QueueUrl=${encodeURIComponent(queueUrl)}&Version=2012-11-05`
      })
      
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to purge queue: ${response.status} ${response.statusText} - ${text}`)
      }
      
      // Refresh queues after successful purge
      await fetchQueues()
    } catch (err) {
      setError(`Failed to purge queue "${queueName}": ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setOperationInProgress(prev => {
        const newState = { ...prev }
        delete newState[queueName]
        return newState
      })
    }
  }

  const deleteQueue = async (queueName: string) => {
    if (!confirm(`Are you sure you want to DELETE the queue "${queueName}"? This will permanently remove the queue and ALL its messages. This action cannot be undone.`)) {
      return
    }

    setOperationInProgress(prev => ({ ...prev, [queueName]: 'deleting' }))
    
    try {
      // ElasticMQ uses SQS interface - need to get queue URL first
      const queueUrl = `http://localhost:9324/000000000000/${queueName}`
      
      const response = await fetch('http://localhost:9324/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `Action=DeleteQueue&QueueUrl=${encodeURIComponent(queueUrl)}&Version=2012-11-05`
      })
      
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to delete queue: ${response.status} ${response.statusText} - ${text}`)
      }
      
      // Refresh queues after successful deletion
      await fetchQueues()
    } catch (err) {
      setError(`Failed to delete queue "${queueName}": ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setOperationInProgress(prev => {
        const newState = { ...prev }
        delete newState[queueName]
        return newState
      })
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
            <label className="filter-type">
              <input
                type="radio"
                checked={filterType === 'favorites'}
                onChange={() => handleFilterTypeChange('favorites')}
              />
              <span>⭐ Favorites</span>
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
              <th className="actions-header">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {getFilteredAndSortedQueues().map((queue) => {
              const total = queue.statistics.approximateNumberOfVisibleMessages + queue.statistics.approximateNumberOfMessagesDelayed + queue.statistics.approximateNumberOfInvisibleMessages
              const isOperationInProgress = operationInProgress[queue.name]
              
              return (
                <tr key={queue.name}>
                  <td className="queue-name-cell">
                    <div className="queue-name-container">
                      <button
                        className={`favorite-button ${favorites.has(queue.name) ? 'favorited' : ''}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleFavorite(queue.name)
                        }}
                        title={favorites.has(queue.name) ? 'Remove from favorites' : 'Add to favorites'}
                        type="button"
                      >
                        {favorites.has(queue.name) ? '⭐' : '☆'}
                      </button>
                      <span className="queue-name">{queue.name}</span>
                    </div>
                  </td>
                  <td className="type-cell">{getQueueType(queue.name)}</td>
                  <td className="visible-cell">{queue.statistics.approximateNumberOfVisibleMessages}</td>
                  <td className="invisible-cell">{queue.statistics.approximateNumberOfInvisibleMessages}</td>
                  <td className="total-cell">{total}</td>
                  <td className="actions-cell">
                    <div className="action-buttons">
                      <button
                        className="purge-button"
                        onClick={() => purgeQueue(queue.name)}
                        disabled={!!isOperationInProgress}
                        title="Purge all messages from this queue"
                      >
                        {isOperationInProgress === 'purging' ? '⏳' : '⚡'}
                        Purge
                      </button>
                      <button
                        className="delete-button"
                        onClick={() => deleteQueue(queue.name)}
                        disabled={!!isOperationInProgress}
                        title="Delete this queue permanently"
                      >
                        {isOperationInProgress === 'deleting' ? '⏳' : '🗑️'}
                        Delete
                      </button>
                    </div>
                  </td>
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
