export interface ProcesslogExport {
  trace_id?: string;
  chat_id?: string;
  count: number;
  events: Array<Record<string, unknown>>;
}

