/** Internal request operations shared by endpoint resource modules. */
export interface EndpointContext {
  global<T = unknown>(path: string): Promise<T>
  publication<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
}
