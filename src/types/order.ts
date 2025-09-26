export interface Order {
  id?: number;
  order_no: string;
  created_at?: Date | null;
  user_uuid: string;
  user_email: string;
  amount: number;
  interval: string;
  expired_at?: Date | null;
  status: string;
  stripe_session_id?: string | null;
  credits: number;
  currency?: string | null;
  sub_id?: string | null;
  sub_interval_count?: number | null;
  sub_cycle_anchor?: number | null;
  sub_period_end?: number | null;
  sub_period_start?: number | null;
  sub_times?: number | null;
  product_id?: string | null;
  product_name?: string | null;
  valid_months?: number | null;
  order_detail?: string | null;
  paid_at?: Date | null;
  paid_email?: string | null;
  paid_detail?: string | null;
}
