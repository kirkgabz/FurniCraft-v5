import type { Shop } from "@/components/shops/shop-types";

/**
 * Row shapes the customer dashboard and its section components share. Moved
 * out of furnicraft-dashboard.tsx when its sections became their own files.
 */

export type { Shop };

export type Message = {
  id: string;
  sender: "user" | "shop";
  senderRole: "customer" | "shop_owner";
  text: string;
  time: string;
  shopId?: string;
  senderUserId?: string | null;
  targetUserId?: string | null;
  created_at?: string;
  /** 'text' for something a person typed, 'order_event' for a system card. */
  kind?: string;
  payload?: unknown;
  /**
   * A place to draw under an assistant answer. Set only on the reply to
   * "Where is your shop?", so the customer gets the map rather than a
   * pasted link. The address stays in `text`: this is what the chat adds,
   * not what it replaces, and quick_answers is read in places that have no
   * map to draw.
   */
  map?: { shopName: string; address: string | null; mapUrl: string | null };
};

export type DesignTemplate = {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  tag: string | null;
  cad_state: unknown;
  preview_url: string | null;
  /**
   * The finishes the shop will build this in; null means any. Read so that
   * opening the template can hold the customer to them -- without it, every
   * template opened from this dashboard offered every finish.
   */
  allowed_materials: string[] | null;
  /**
   * Where a generated model's file lives in storage, for the templates whose
   * piece was made by the studio rather than shipped with the app. Needed
   * when a template is copied into something that has to show the 3D
   * elsewhere -- a shared order link reads it to sign a short-lived URL.
   */
  model_path?: string | null;
  created_at: string;
};

export type CustomerDesign = {
  id: string;
  name: string;
  furniture_type: string | null;
  cad_state: unknown;
  preview_url: string | null;
  kind: "draft" | "saved";
  updated_at: string;
};

export type ReferenceImage = {
  name: string;
  dataUrl: string;
};

export type CustomerOrder = {
  id: string;
  shop_id: string;
  project_name: string;
  furniture_type: string | null;
  /** What the studio used to guess a piece would cost. Nothing writes it any
   *  more; it survives on orders sent before budgets existed. */
  estimated_price: number | null;
  /** What the customer said they hoped to spend. Null on older orders. */
  budget_min?: number | null;
  budget_max?: number | null;
  cad_state: unknown;
  preview_url: string | null;
  notes: string | null;
  reference_images: ReferenceImage[] | null;
  status: string;
  created_at: string;
  quoted_total: number | null;
  /** The shop's breakdown of quoted_total; see components/orders/quote-lines.ts. */
  quote_lines?: unknown;
  downpayment_percent: number | null;
  downpayment_amount: number | null;
  customer_response: string | null;
  payment_receipt_url?: string | null;
  payment_reference?: string | null;
  refund_status?: string | null;
  refund_reason?: string | null;
  refund_requested_at?: string | null;
  refund_declined_reason?: string | null;
  refund_decided_at?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
  payment_rejected_reason?: string | null;
  decline_reason?: string | null;
};
