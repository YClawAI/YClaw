/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'pg' {
  export interface QueryResult {
    rows: any[];
    rowCount: number;
    command: string;
    oid: number;
    fields: any[];
  }

  export class Pool {
    constructor(config?: any);
    query(text: string, values?: any[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class Client {
    constructor(config?: any);
    connect(): Promise<void>;
    query(text: string, values?: any[]): Promise<QueryResult>;
    end(): Promise<void>;
  }

  export class PoolClient {
    query(text: string, values?: any[]): Promise<QueryResult>;
    release(err?: boolean | Error): void;
  }
}
