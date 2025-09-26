export enum ApiResponseCode {
  Ok = 0,
  Error = -1,
  Unauthorized = -2,
}

export interface ApiResponse<T = unknown> {
  code: ApiResponseCode;
  message: string;
  data?: T;
}

export interface CreditQueryRequest {
  includeLedger?: boolean;
  ledgerLimit?: number;
  includeExpiring?: boolean;
}

export interface UserInfoRequest {
  includeCreditLedger?: boolean;
  creditLedgerLimit?: number;
}

export interface CreditGrantRequest {
  credits: number;
  orderNo?: string;
  expiredAt?: string;
  ledgerLimit?: number;
}
