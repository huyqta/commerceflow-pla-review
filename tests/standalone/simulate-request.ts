// Helper giả lập HTTP request tới getAppHandler bằng Node.js Readable stream
import { Readable } from 'node:stream';

export async function simulateRequest(
  handler: (req: any, res: any) => Promise<void>,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? JSON.stringify(options.body) : '';
    const reqStream = new Readable({
      read() {
        if (payload) {
          this.push(payload);
        }
        this.push(null);
      },
    });

    const reqHeaders: Record<string, string> = {
      host: 'localhost',
      'content-type': 'application/json',
      ...(options.headers || {}),
    };

    const req: any = Object.assign(reqStream, {
      method: options.method,
      url: options.url,
      headers: reqHeaders,
    });

    let statusCode = 200;
    const resHeaders: Record<string, string> = {};
    let responseBody = '';

    const res: any = {
      writeHead: (status: number, headers?: Record<string, string>) => {
        statusCode = status;
        if (headers) {
          Object.assign(resHeaders, headers);
        }
      },
      end: (chunk?: string) => {
        if (chunk) responseBody += chunk;
        let parsed: any;
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch {
          parsed = responseBody;
        }
        resolve({
          status: statusCode,
          headers: resHeaders,
          body: parsed,
        });
      },
    };

    handler(req, res).catch(reject);
  });
}

