declare module "pg" {
  export interface PoolConfig {
    host?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
  }

  export interface QueryResult<R = unknown> {
    command: "UPDATE" | "DELETE" | "INSERT" | "SELECT" | "MERGE";
    rowCount: number;
    rows: R[];
  }

  export interface CursorLike<T> {
    read(rowsCount: number): Promise<T[]>;
    close(): Promise<void>;
  }

  export interface PoolClient {
    query<R>(sql: string, parameters: ReadonlyArray<unknown>): Promise<QueryResult<R>>;
    query<R>(cursor: CursorLike<R>): CursorLike<R>;
    release(): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
