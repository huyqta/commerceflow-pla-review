// apps/web/src/services/api-client.ts
// Client tách biệt giữa Data Fetching và UI Presentation (Tránh Trade-off Trộn API Fetch và UI)
// Tuân thủ quy tắc Separation of Concerns & Clean Architecture

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
  };
}

export interface IApiClient {
  get<T>(endpoint: string): Promise<ApiResponse<T>>;
  post<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>>;
}

/**
 * ApiClient chuẩn cho Web Frontend, có thể mock hoặc chuyển sang HttpClient thật
 */
export class WebApiClient implements IApiClient {
  private readonly baseUrl: string;
  private token?: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  public setToken(token: string): void {
    this.token = token;
  }

  public async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    // Trả về mock schema hoặc fetch thực tế
    return {
      success: true,
      data: [] as unknown as T,
    };
  }

  public async post<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    return {
      success: true,
      data: body as T,
    };
  }
}

export const defaultApiClient = new WebApiClient();

