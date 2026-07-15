export interface FacebookWebhookPayload {
  object: string;
  entry: FacebookWebhookEntry[];
}

export interface FacebookWebhookEntry {
  /** This is the Facebook Page ID — used to route the event to the right brand. */
  id: string;
  time: number;
  messaging?: FacebookMessagingEvent[];
}

export interface FacebookMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
  };
}
