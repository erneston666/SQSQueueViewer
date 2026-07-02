import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { finalize } from 'rxjs';

interface QueueStatistics {
  approximateNumberOfInvisibleMessages: number;
  approximateNumberOfMessagesDelayed: number;
  approximateNumberOfVisibleMessages: number;
}

interface Queue {
  name: string;
  statistics: QueueStatistics;
}

interface QueueViewModel {
  name: string;
  type: QueueType;
  visible: number;
  invisible: number;
  delayed: number;
  total: number;
  isFavorite: boolean;
}

type QueueType = 'FIFO' | 'Standard';
type FilterType = 'all' | 'standard' | 'fifo' | 'withMessages' | 'favorites';
type QueueOperation = 'purging' | 'deleting';
type SqsAction = 'PurgeQueue' | 'DeleteQueue';
type ColumnKey = 'name' | 'type' | 'visible' | 'invisible' | 'total' | 'actions';

const MIN_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  name: 280,
  type: 110,
  visible: 110,
  invisible: 140,
  total: 100,
  actions: 190
};

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  name: 460,
  type: 120,
  visible: 125,
  invisible: 150,
  total: 110,
  actions: 205
};

const FAVORITES_STORAGE_KEY = 'sqsQueueViewerFavorites';
const THEME_STORAGE_KEY = 'sqsQueueViewerTheme';
const QUEUE_STATS_URL = 'http://localhost:9325/statistics/queues';
const ELASTIC_MQ_URL = 'http://localhost:9324/';
const ACCOUNT_ID = '000000000000';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
    SelectButtonModule,
    TableModule,
    TagModule,
    ToastModule,
    TooltipModule
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  @ViewChild('tablePanel') private tablePanel?: ElementRef<HTMLElement>;

  protected readonly filterOptions: Array<{ label: string; value: FilterType }> = [
    { label: 'All', value: 'all' },
    { label: 'Standard', value: 'standard' },
    { label: 'FIFO', value: 'fifo' },
    { label: 'With Messages', value: 'withMessages' },
    { label: 'Favorites', value: 'favorites' }
  ];

  protected readonly queues = signal<Queue[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly lastUpdate = signal<Date | null>(null);
  protected readonly filterText = signal('');
  protected readonly filterType = signal<FilterType>('all');
  protected readonly operationInProgress = signal<Record<string, QueueOperation>>({});
  protected readonly favorites = signal<Set<string>>(new Set<string>());
  protected readonly isDarkMode = signal(false);
  protected readonly minColumnWidths = MIN_COLUMN_WIDTHS;
  protected readonly columnWidths = signal<Record<ColumnKey, number>>(DEFAULT_COLUMN_WIDTHS);

  protected readonly queueRows = computed<QueueViewModel[]>(() => {
    const favorites = this.favorites();
    const filterType = this.filterType();
    const filterTerms = this.filterText()
      .split(',')
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);

    return this.queues()
      .map((queue) => this.toViewModel(queue, favorites))
      .filter((queue) => this.matchesTypeFilter(queue, filterType))
      .filter((queue) => this.matchesTextFilter(queue.name, filterTerms));
  });

  protected readonly totalQueues = computed(() => this.queues().length);
  protected readonly totalVisibleMessages = computed(() =>
    this.queues().reduce((total, queue) => total + queue.statistics.approximateNumberOfVisibleMessages, 0)
  );
  protected readonly totalInvisibleMessages = computed(() =>
    this.queues().reduce((total, queue) => total + queue.statistics.approximateNumberOfInvisibleMessages, 0)
  );
  protected readonly totalMessages = computed(() =>
    this.queues().reduce((total, queue) => total + this.getTotalMessages(queue), 0)
  );
  protected readonly tableMinWidth = computed(() =>
    Object.values(this.columnWidths()).reduce((total, width) => total + width, 0)
  );

  private pollId: number | undefined;
  private requestInFlight = false;
  private hasAutoSizedInitialData = false;

  constructor() {
    this.loadFavorites();
    this.loadThemePreference();

    effect(() => {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(this.favorites())));
    });

    effect(() => {
      const darkMode = this.isDarkMode();

      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light');
      document.documentElement.classList.toggle('app-dark', darkMode);
    });
  }

  ngOnInit(): void {
    this.fetchQueues();
    this.pollId = window.setInterval(() => this.fetchQueues(), 1000);
  }

  ngOnDestroy(): void {
    if (this.pollId !== undefined) {
      window.clearInterval(this.pollId);
    }
  }

  protected toggleTheme(): void {
    this.isDarkMode.update((enabled) => !enabled);
  }

  protected setFilterType(filterType: FilterType): void {
    this.filterType.set(filterType);
  }

  protected setFilterText(filterText: string): void {
    this.filterText.set(filterText);
  }

  protected toggleFavorite(queueName: string): void {
    this.favorites.update((current) => {
      const next = new Set(current);

      if (next.has(queueName)) {
        next.delete(queueName);
      } else {
        next.add(queueName);
      }

      return next;
    });
  }

  protected confirmPurge(queueName: string): void {
    this.confirmationService.confirm({
      header: 'Purge queue',
      message: `Are you sure you want to purge all messages from queue "${queueName}"? This action cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Purge',
      rejectLabel: 'Cancel',
      accept: () => this.runQueueAction(queueName, 'PurgeQueue')
    });
  }

  protected confirmDelete(queueName: string): void {
    this.confirmationService.confirm({
      header: 'Delete queue',
      message: `Are you sure you want to DELETE the queue "${queueName}"? This will permanently remove the queue and ALL its messages. This action cannot be undone.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.runQueueAction(queueName, 'DeleteQueue')
    });
  }

  protected operationFor(queueName: string): QueueOperation | null {
    return this.operationInProgress()[queueName] ?? null;
  }

  protected isQueueBusy(queueName: string): boolean {
    return this.operationFor(queueName) !== null;
  }

  protected getStatusSeverity(): 'success' | 'danger' | 'warn' {
    if (this.error()) {
      return 'danger';
    }

    return this.loading() ? 'warn' : 'success';
  }

  protected getStatusLabel(): string {
    if (this.error()) {
      return 'Offline';
    }

    return this.loading() ? 'Loading' : 'Live';
  }

  protected autoSizeColumns(): void {
    const rows = this.queueRows();
    const longestQueueName = rows.reduce(
      (longest, queue) => (queue.name.length > longest.length ? queue.name : longest),
      'Queue Name'
    );
    const longestVisible = rows.reduce((longest, queue) => Math.max(longest, String(queue.visible).length), 7);
    const longestInvisible = rows.reduce((longest, queue) => Math.max(longest, String(queue.invisible).length), 11);
    const longestTotal = rows.reduce((longest, queue) => Math.max(longest, String(queue.total).length), 5);

    this.columnWidths.set({
      name: Math.max(MIN_COLUMN_WIDTHS.name, this.getTextWidth(longestQueueName) + 92),
      type: Math.max(MIN_COLUMN_WIDTHS.type, this.getTextWidth('Standard') + 52),
      visible: Math.max(MIN_COLUMN_WIDTHS.visible, longestVisible * 10 + 56),
      invisible: Math.max(MIN_COLUMN_WIDTHS.invisible, longestInvisible * 10 + 56),
      total: Math.max(MIN_COLUMN_WIDTHS.total, longestTotal * 10 + 56),
      actions: Math.max(MIN_COLUMN_WIDTHS.actions, DEFAULT_COLUMN_WIDTHS.actions)
    });
  }

  protected sizeColumnsToFit(): void {
    const panelWidth = this.tablePanel?.nativeElement.clientWidth ?? 0;
    const minimumWidth = Object.values(MIN_COLUMN_WIDTHS).reduce((total, width) => total + width, 0);
    const targetWidth = Math.max(panelWidth, minimumWidth);
    const preferredWidths = {
      ...DEFAULT_COLUMN_WIDTHS,
      name: Math.max(DEFAULT_COLUMN_WIDTHS.name, this.columnWidths().name)
    };
    const preferredTotal = Object.values(preferredWidths).reduce((total, width) => total + width, 0);
    const nextWidths = Object.entries(preferredWidths).reduce((widths, [key, width]) => {
      const column = key as ColumnKey;

      widths[column] = Math.max(MIN_COLUMN_WIDTHS[column], Math.floor((width * targetWidth) / preferredTotal));
      return widths;
    }, {} as Record<ColumnKey, number>);
    const nextTotal = Object.values(nextWidths).reduce((total, width) => total + width, 0);

    nextWidths.name += targetWidth - nextTotal;
    this.columnWidths.set(nextWidths);
  }

  private fetchQueues(): void {
    if (this.requestInFlight) {
      return;
    }

    this.requestInFlight = true;

    this.http
      .get<Queue[]>(QUEUE_STATS_URL)
      .pipe(
        finalize(() => {
          this.requestInFlight = false;
          this.loading.set(false);
        })
      )
      .subscribe({
        next: (queues) => {
          this.queues.set(Array.isArray(queues) ? queues : []);
          if (!this.hasAutoSizedInitialData && this.queues().length > 0) {
            this.autoSizeColumns();
            this.hasAutoSizedInitialData = true;
          }
          this.error.set(null);
          this.lastUpdate.set(new Date());
        },
        error: (err: unknown) => {
          this.error.set(this.formatError(err));
        }
      });
  }

  private runQueueAction(queueName: string, action: SqsAction): void {
    const operation: QueueOperation = action === 'PurgeQueue' ? 'purging' : 'deleting';
    const queueUrl = `${ELASTIC_MQ_URL}${ACCOUNT_ID}/${queueName}`;
    const body = new HttpParams()
      .set('Action', action)
      .set('QueueUrl', queueUrl)
      .set('Version', '2012-11-05');

    this.setOperation(queueName, operation);

    this.http
      .post(ELASTIC_MQ_URL, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'text'
      })
      .pipe(finalize(() => this.clearOperation(queueName)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: action === 'PurgeQueue' ? 'Queue purged' : 'Queue deleted',
            detail: queueName
          });
          this.fetchQueues();
        },
        error: (err: unknown) => {
          const detail = this.formatError(err);

          this.error.set(`Failed to ${operation === 'purging' ? 'purge' : 'delete'} queue "${queueName}": ${detail}`);
          this.messageService.add({
            severity: 'error',
            summary: action === 'PurgeQueue' ? 'Purge failed' : 'Delete failed',
            detail
          });
        }
      });
  }

  private setOperation(queueName: string, operation: QueueOperation): void {
    this.operationInProgress.update((current) => ({
      ...current,
      [queueName]: operation
    }));
  }

  private clearOperation(queueName: string): void {
    this.operationInProgress.update((current) => {
      const next = { ...current };
      delete next[queueName];
      return next;
    });
  }

  private loadFavorites(): void {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);

    if (!savedFavorites) {
      return;
    }

    try {
      const parsed = JSON.parse(savedFavorites);

      if (Array.isArray(parsed)) {
        this.favorites.set(new Set(parsed.filter((queueName): queueName is string => typeof queueName === 'string')));
      }
    } catch (err) {
      console.error('Failed to load favorites from localStorage:', err);
    }
  }

  private loadThemePreference(): void {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

    this.isDarkMode.set(savedTheme ? savedTheme === 'dark' : prefersDark);
  }

  private toViewModel(queue: Queue, favorites: Set<string>): QueueViewModel {
    const visible = queue.statistics.approximateNumberOfVisibleMessages;
    const invisible = queue.statistics.approximateNumberOfInvisibleMessages;
    const delayed = queue.statistics.approximateNumberOfMessagesDelayed;

    return {
      name: queue.name,
      type: this.getQueueType(queue.name),
      visible,
      invisible,
      delayed,
      total: visible + invisible + delayed,
      isFavorite: favorites.has(queue.name)
    };
  }

  private matchesTypeFilter(queue: QueueViewModel, filterType: FilterType): boolean {
    switch (filterType) {
      case 'standard':
        return queue.type === 'Standard';
      case 'fifo':
        return queue.type === 'FIFO';
      case 'withMessages':
        return queue.total > 0;
      case 'favorites':
        return queue.isFavorite;
      case 'all':
        return true;
    }
  }

  private matchesTextFilter(queueName: string, filterTerms: string[]): boolean {
    if (filterTerms.length === 0) {
      return true;
    }

    const queueNameLower = queueName.toLowerCase();
    return filterTerms.some((term) => queueNameLower.includes(term));
  }

  private getQueueType(queueName: string): QueueType {
    return queueName.toLowerCase().includes('.fifo') ? 'FIFO' : 'Standard';
  }

  private getTotalMessages(queue: Queue): number {
    return (
      queue.statistics.approximateNumberOfVisibleMessages +
      queue.statistics.approximateNumberOfMessagesDelayed +
      queue.statistics.approximateNumberOfInvisibleMessages
    );
  }

  private getTextWidth(text: string, averageCharacterWidth = 8): number {
    return Math.ceil(text.length * averageCharacterWidth);
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Unable to connect to local ElasticMQ/SQS endpoints.';
      }

      const errorText = typeof err.error === 'string' && err.error.trim() ? ` - ${err.error}` : '';
      return `${err.status} ${err.statusText || 'HTTP error'}${errorText}`;
    }

    return err instanceof Error ? err.message : 'Unknown error';
  }
}
