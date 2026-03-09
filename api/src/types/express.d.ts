export {};

declare global {
  namespace Express {
    // Provided by cookie-parser

    interface Request {
      cookies?: Record<string, string>;
    }
  }
}
