export type NotificationEvent = Readonly<{
  eventId: string;
  kind: string;
}>;

export type DeliveryErrorCode =
  | 'channel_disabled'
  | 'unsupported_os'
  | 'invalid_event'
  | 'delivery_failed'
  | 'delivery_timeout'
  | 'delivery_outcome_unknown';

export type DeliveryResult = Readonly<{
  status: 'sent' | 'failed' | 'outcome_unknown';
  eventId: string;
  error?: Readonly<{
    code: DeliveryErrorCode;
    retryable: boolean;
  }>;
}>;

export interface NotificationChannel {
  /** `sent` means the channel command accepted the event, not that a person saw it. */
  deliver(event: NotificationEvent): Promise<DeliveryResult>;
}

export {
  createMacOSNotificationChannel,
  MACOS_NOTIFICATION_SCRIPT,
  type ExecRunner,
  type MacOSNotificationOptions,
} from './macos.js';
