import { CreditSummary } from "./credit";

export interface UserCredits {
  left_credits: number;
  is_pro?: boolean;
  is_recharged?: boolean;
}

export interface UserProfile {
  id: string;
  uuid: string;
  email: string;
  nickname: string;
  avatarUrl?: string | null;
  locale?: string | null;
  inviteCode: string;
  invitedBy: string;
  isAffiliate: boolean;
  emailVerified: boolean;
  signinType?: string | null;
  signinProvider?: string | null;
  signinOpenid?: string | null;
  createdAt: string;
  updatedAt: string;
  credits: CreditSummary;
}
