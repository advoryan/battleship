import { WebSocket } from 'ws';
import { RESPONSE_ID } from '../constants.js';

type SocketRawData = string | Buffer | ArrayBuffer | Buffer[] | undefined | null;

export const safeJSONParse = <T>(raw: SocketRawData, fallback: T): T => {
  try {
    if (raw === undefined || raw === null) {
      return fallback;
    }
    const source = typeof raw === 'string' ? raw : raw.toString();
    return JSON.parse(source) as T;
  } catch (error) {
    console.error('[PARSE_ERROR]', (error as Error).message);
    return fallback;
  }
};

const serialize = (data: unknown): string => (typeof data === 'string' ? data : JSON.stringify(data ?? {}));

export const sendMessage = (ws: WebSocket, type: string, data: unknown): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const payload = {
    type,
    data: serialize(data),
    id: RESPONSE_ID,
  };
  ws.send(JSON.stringify(payload));
};

export const broadcast = (clients: Iterable<WebSocket>, type: string, data: unknown): void => {
  const serialized = serialize(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, data: serialized, id: RESPONSE_ID }));
    }
  }
};

interface LogCommandOptions {
  direction: 'in' | 'out';
  type: string;
  data: unknown;
  result?: string;
}

export const logCommand = ({ direction, type, data, result }: LogCommandOptions): void => {
  const timestamp = new Date().toISOString();
  const summary = typeof data === 'string' ? data : JSON.stringify(data);
  const suffix = result ? ` => ${result}` : '';
  console.log(`[${timestamp}] ${direction.toUpperCase()} :: ${type} :: ${summary}${suffix}`);
};
