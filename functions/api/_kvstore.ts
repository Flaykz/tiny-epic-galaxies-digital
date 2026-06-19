// A Cloudflare KV–backed SnapshotStore for the multiplayer GameServer, so the
// whole backend runs on Cloudflare Pages Functions (no external database).
import { ConflictError } from 'digital-boardgame-framework/server';
import type {
  SnapshotStore, GameMeta, SnapshotRow, BugReportRow, ReportFilter, ChatMessage,
} from 'digital-boardgame-framework/server';

// Minimal KV surface (avoids depending on @cloudflare/workers-types here).
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string }): Promise<{ keys: { name: string }[] }>;
}

export class KvStore implements SnapshotStore {
  constructor(private kv: KV) {}

  private async getJSON<T>(k: string): Promise<T | null> {
    const v = await this.kv.get(k);
    return v ? (JSON.parse(v) as T) : null;
  }
  private putJSON(k: string, v: unknown) {
    return this.kv.put(k, JSON.stringify(v));
  }

  putGameMeta(m: GameMeta) { return this.putJSON(`meta:${m.gameId}`, m); }
  getGameMeta(id: string) { return this.getJSON<GameMeta>(`meta:${id}`); }

  async listActiveGames() {
    const { keys } = await this.kv.list({ prefix: 'meta:' });
    const out: GameMeta[] = [];
    for (const k of keys) {
      const m = await this.getJSON<GameMeta>(k.name);
      if (m && !m.resolved) out.push(m);
    }
    return out;
  }

  async postMessage(id: string, msg: ChatMessage) {
    const k = `msg:${id}`;
    const arr = (await this.getJSON<ChatMessage[]>(k)) ?? [];
    arr.push(msg);
    await this.putJSON(k, arr);
  }
  async listMessages(id: string, limit?: number) {
    const arr = (await this.getJSON<ChatMessage[]>(`msg:${id}`)) ?? [];
    return limit ? arr.slice(-limit) : arr;
  }

  async deleteGame(id: string) {
    await this.kv.delete(`meta:${id}`);
    await this.kv.delete(`msg:${id}`);
    const { keys } = await this.kv.list({ prefix: `snap:${id}:` });
    for (const k of keys) await this.kv.delete(k.name);
  }

  async putSnapshot(id: string, row: SnapshotRow) {
    const latest = await this.getLatest(id);
    if (latest && row.turn <= latest.turn) {
      throw new ConflictError(`stale snapshot: turn ${row.turn} <= ${latest.turn}`);
    }
    await this.putJSON(`snap:${id}:${String(row.turn).padStart(6, '0')}`, row);
    await this.putJSON(`snap:${id}:latest`, row);
  }
  getLatest(id: string) { return this.getJSON<SnapshotRow>(`snap:${id}:latest`); }
  async getHistory(id: string) {
    const { keys } = await this.kv.list({ prefix: `snap:${id}:` });
    const rows: SnapshotRow[] = [];
    for (const k of keys) {
      if (k.name.endsWith(':latest')) continue;
      const r = await this.getJSON<SnapshotRow>(k.name);
      if (r) rows.push(r);
    }
    return rows.sort((a, b) => a.turn - b.turn);
  }

  putReport(row: BugReportRow) { return this.putJSON(`report:${row.reportId}`, row); }
  async listReports(f?: ReportFilter) {
    const { keys } = await this.kv.list({ prefix: 'report:' });
    let rows: BugReportRow[] = [];
    for (const k of keys) {
      const r = await this.getJSON<BugReportRow>(k.name);
      if (r) rows.push(r);
    }
    if (f?.gameId) rows = rows.filter((r) => r.gameId === f.gameId);
    if (f?.unresolved) rows = rows.filter((r) => !r.resolution);
    if (f?.severity) rows = rows.filter((r) => r.severity === f.severity);
    if (f?.category) rows = rows.filter((r) => r.category === f.category);
    if (f?.since) rows = rows.filter((r) => r.createdAt >= f.since!);
    return rows;
  }
  async resolveReport(id: string, note: string) {
    const k = `report:${id}`;
    const r = await this.getJSON<BugReportRow>(k);
    if (r) { r.resolution = { at: new Date().toISOString(), note }; await this.putJSON(k, r); }
  }
}
