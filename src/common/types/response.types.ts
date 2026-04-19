/**
 * Shared response interfaces for use across Service and Controller layers.
 * These are internal TypeScript types — not Swagger DTOs.
 */

// ─── Generic ──────────────────────────────────────────────────────────────────

export class AuthenticatedUser {
  id: string;
  email: string;
}

export interface SuccessResponse {
  success: boolean;
}

export interface SuccessMessageResponse extends SuccessResponse {
  message: string;
}

export interface CountResponse {
  count: number;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  nextCursor: string | null; // ISO updatedAt of last item; null when no more pages
  hasMore: boolean;
}

// ─── FCM ─────────────────────────────────────────────────────────────────────

export interface RegisterDeviceResponse {
  accountId: string;
  token: string;
  platform: string;
}
