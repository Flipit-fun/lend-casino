/** Framework-free error type usable from routes, services, and tests. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ApiError";
  }
}
