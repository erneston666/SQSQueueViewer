import { useState, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
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
type ColumnKey = 'name' | 'type' | 'visible' | 'invisible' | 'total' | 'actions'

const MIN_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  name: 260,
  type: 100,
  visible: 100,
  invisible: 130,
  total: 90,
  actions: 165,
}

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  name: 430,
  type: 110,
  visible: 115,
  invisible: 140,
  total: 100,
  actions: 175,
}

const getTotalMessages = (queue: Queue) => {
  return queue.statistics.approximateNumberOfVisibleMessages +
    queue.statistics.approximateNumberOfMessagesDelayed +
    queue.statistics.approximateNumberOfInvisibleMessages
}

const getTextWidth = (text: string, averageCharacterWidth = 8) => {
  return Math.ceil(text.length * averageCharacterWidth)
}

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
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false)
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(DEFAULT_COLUMN_WIDTHS)
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const hasAutoSizedInitialData = useRef(false)

  // Load favorites from localStorage on component mount
  useEffect(() => {
    const savedFavorites = localStorage.getItem('sqsQueueViewerFavorites')
    if (savedFavorites) {
      try {
        const favoritesArray = JSON.parse(savedFavorites)
        setFavorites(new Set(favoritesArray))
      } catch (err) {
        console.error('Failed to load favorites from localStorage:', err)
      }
    }
  }, [])

  // Save favorites to localStorage whenever favorites change
  useEffect(() => {
    const favoritesArray = Array.from(favorites)
    localStorage.setItem('sqsQueueViewerFavorites', JSON.stringify(favoritesArray))
  }, [favorites])

  // Load theme preference from localStorage on component mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('sqsQueueViewerTheme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    
    if (savedTheme) {
      const isDark = savedTheme === 'dark'
      setIsDarkMode(isDark)
    } else {
      setIsDarkMode(prefersDark)
    }
  }, [])

  // Save theme preference and apply to document
  useEffect(() => {
    const theme = isDarkMode ? 'dark' : 'light'
    localStorage.setItem('sqsQueueViewerTheme', theme)
    
    // Apply theme to document root
    if (isDarkMode) {
      document.documentElement.classList.add('dark-theme')
      document.documentElement.classList.remove('light-theme')
    } else {
      document.documentElement.classList.add('light-theme')
      document.documentElement.classList.remove('dark-theme')
    }
  }, [isDarkMode])

  const toggleTheme = () => {
    setIsDarkMode(prev => !prev)
  }

  const toggleFavorite = (queueName: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(queueName)) {
        newFavorites.delete(queueName)
      } else {
        newFavorites.add(queueName)
      }
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
          valueA = getTotalMessages(a)
          valueB = getTotalMessages(b)
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
          return getTotalMessages(queue) > 0
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

  const resizeColumn = (column: ColumnKey, nextWidth: number) => {
    setColumnWidths(prev => ({
      ...prev,
      [column]: Math.max(MIN_COLUMN_WIDTHS[column], Math.round(nextWidth)),
    }))
  }

  const startColumnResize = (event: ReactPointerEvent<HTMLSpanElement>, column: ColumnKey) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = columnWidths[column]

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeColumn(column, startWidth + moveEvent.clientX - startX)
    }

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.body.classList.remove('is-resizing-column')
    }

    document.body.classList.add('is-resizing-column')
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  const autoSizeColumns = () => {
    const visibleQueues = getFilteredAndSortedQueues()
    const longestQueueName = visibleQueues.reduce((longest, queue) => {
      return queue.name.length > longest.length ? queue.name : longest
    }, 'Queue Name')
    const longestVisible = visibleQueues.reduce((longest, queue) => {
      return Math.max(longest, String(queue.statistics.approximateNumberOfVisibleMessages).length)
    }, 'Visible'.length)
    const longestInvisible = visibleQueues.reduce((longest, queue) => {
      return Math.max(longest, String(queue.statistics.approximateNumberOfInvisibleMessages).length)
    }, 'Not Visible'.length)
    const longestTotal = visibleQueues.reduce((longest, queue) => {
      return Math.max(longest, String(getTotalMessages(queue)).length)
    }, 'Total'.length)

    setColumnWidths({
      name: Math.max(MIN_COLUMN_WIDTHS.name, getTextWidth(longestQueueName) + 76),
      type: Math.max(MIN_COLUMN_WIDTHS.type, getTextWidth('Standard') + 46),
      visible: Math.max(MIN_COLUMN_WIDTHS.visible, longestVisible * 10 + 46),
      invisible: Math.max(MIN_COLUMN_WIDTHS.invisible, longestInvisible * 10 + 46),
      total: Math.max(MIN_COLUMN_WIDTHS.total, longestTotal * 10 + 46),
      actions: Math.max(MIN_COLUMN_WIDTHS.actions, 170),
    })
  }

  const sizeColumnsToFit = () => {
    const containerWidth = tableContainerRef.current?.clientWidth ?? 0
    const minimumWidth = Object.values(MIN_COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0)
    const targetWidth = Math.max(containerWidth, minimumWidth)
    const preferredWidths = {
      ...DEFAULT_COLUMN_WIDTHS,
      name: Math.max(DEFAULT_COLUMN_WIDTHS.name, columnWidths.name),
    }
    const preferredTotal = Object.values(preferredWidths).reduce((sum, width) => sum + width, 0)
    const nextWidths = Object.entries(preferredWidths).reduce((next, [key, width]) => {
      const column = key as ColumnKey
      next[column] = Math.max(MIN_COLUMN_WIDTHS[column], Math.floor(width * targetWidth / preferredTotal))
      return next
    }, {} as Record<ColumnKey, number>)
    const nextTotal = Object.values(nextWidths).reduce((sum, width) => sum + width, 0)
    nextWidths.name += targetWidth - nextTotal

    setColumnWidths(nextWidths)
  }

  const renderSortIndicator = (field: SortField) => {
    return sortField === field ? (sortOrder === 'asc' ? '▲' : '▼') : ''
  }

  const renderResizeHandle = (column: ColumnKey) => (
    <span
      className="column-resize-handle"
      onPointerDown={(event) => startColumnResize(event, column)}
      role="separator"
      aria-label={`Resize ${column} column`}
      title="Resize column"
    />
  )

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

  useEffect(() => {
    if (!hasAutoSizedInitialData.current && queues.length > 0) {
      autoSizeColumns()
      hasAutoSizedInitialData.current = true
    }
  }, [queues])

  const filteredAndSortedQueues = getFilteredAndSortedQueues()
  const totalColumnWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Local SQS Queue Viewer</h1>
        <p className="header-subtitle">Monitoring local SQS queues on localhost:9325</p>
        <button 
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
          type="button"
        >
          {isDarkMode ? '☀️' : '🌙'}
        </button>
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
        <div className="table-tools-row">
          <div className="table-layout-controls" aria-label="Table layout controls">
            <button
              className="layout-button"
              onClick={autoSizeColumns}
              type="button"
              title="Set columns to their content width"
            >
              Auto size
            </button>
            <button
              className="layout-button"
              onClick={sizeColumnsToFit}
              type="button"
              title="Resize columns to fit the visible table width"
            >
              Size to fit
            </button>
          </div>
          {lastUpdate && (
            <div className="last-update">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      <div className="table-container" ref={tableContainerRef}>
        <table className="queues-table" style={{ minWidth: `${totalColumnWidth}px` }}>
          <colgroup>
            <col style={{ width: `${columnWidths.name}px` }} />
            <col style={{ width: `${columnWidths.type}px` }} />
            <col style={{ width: `${columnWidths.visible}px` }} />
            <col style={{ width: `${columnWidths.invisible}px` }} />
            <col style={{ width: `${columnWidths.total}px` }} />
            <col style={{ width: `${columnWidths.actions}px` }} />
          </colgroup>
          <thead>
            <tr>
              <th 
                className={`sortable ${sortField === 'name' ? 'active' : ''}`}
                onClick={() => handleSort('name')}
              >
                <span className="column-header-content">
                  Queue Name
                  <span className="sort-indicator">{renderSortIndicator('name')}</span>
                </span>
                {renderResizeHandle('name')}
              </th>
              <th 
                className={`sortable type-header ${sortField === 'type' ? 'active' : ''}`}
                onClick={() => handleSort('type')}
              >
                <span className="column-header-content">
                  Type
                  <span className="sort-indicator">{renderSortIndicator('type')}</span>
                </span>
                {renderResizeHandle('type')}
              </th>
              <th 
                className={`sortable visible-header ${sortField === 'visible' ? 'active' : ''}`}
                onClick={() => handleSort('visible')}
              >
                <span className="column-header-content">
                  Visible
                  <span className="sort-indicator">{renderSortIndicator('visible')}</span>
                </span>
                {renderResizeHandle('visible')}
              </th>
              <th 
                className={`sortable invisible-header ${sortField === 'invisible' ? 'active' : ''}`}
                onClick={() => handleSort('invisible')}
              >
                <span className="column-header-content">
                  Not Visible
                  <span className="sort-indicator">{renderSortIndicator('invisible')}</span>
                </span>
                {renderResizeHandle('invisible')}
              </th>
              <th 
                className={`sortable total-header ${sortField === 'total' ? 'active' : ''}`}
                onClick={() => handleSort('total')}
              >
                <span className="column-header-content">
                  Total
                  <span className="sort-indicator">{renderSortIndicator('total')}</span>
                </span>
                {renderResizeHandle('total')}
              </th>
              <th className="actions-header">
                <span className="column-header-content">Actions</span>
                {renderResizeHandle('actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedQueues.map((queue) => {
              const total = getTotalMessages(queue)
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
                      <span className="queue-name" title={queue.name}>{queue.name}</span>
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

      {!loading && !error && filteredAndSortedQueues.length === 0 && (
        <div className="no-queues">
          {queues.length === 0 ? 'No queues found' : 'No queues match the filter'}
        </div>
      )}
    </div>
  )
}

export default App
