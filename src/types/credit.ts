export interface CreditLedgerEntry {
  transNo: string;
  transType: string;
  credits: number;
  createdAt: string;
  orderNo?: string | null;
  expiredAt?: string | null;
}

export interface CreditSummary {
  balance: number;
  granted: number;
  consumed: number;
  expired: number;
  expiringSoon: CreditLedgerEntry[];
  ledger: CreditLedgerEntry[];
}
