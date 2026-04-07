/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'express' {
  export interface Request {
    body: any;
    params: any;
    query: any;
    headers: any;
    rawBody?: string;
    url?: string;
    ip?: string;
    path: string;
    method: string;
    get(name: string): string | undefined;
    /** Attached by operator auth middleware when a valid API key is provided. */
    operator?: import('./operators/types.js').Operator;
  }
  export interface Response {
    statusCode?: number;
    status(code: number): Response;
    json(body: any): Response;
    send(body?: any): Response;
    set(field: string, value: string): Response;
    end(): void;
    on(event: string, listener: (...args: any[]) => void): Response;
  }
  export interface NextFunction {
    (err?: any): void;
  }
  export interface Application {
    [key: string]: any;
    use(...args: any[]): any;
    get(path: string, ...handlers: any[]): any;
    post(path: string, ...handlers: any[]): any;
    listen(port: number, callback?: () => void): any;
  }
  export type Express = Application;

  interface ExpressFunction {
    (): Application;
    json(options?: any): any;
    urlencoded(options?: any): any;
    static(root: string, options?: any): any;
    raw(options?: any): any;
    text(options?: any): any;
  }

  const express: ExpressFunction;
  export default express;
}
