/**
 * Kysely table types for the Control Plane database.
 *
 * This is the typed surface repositories build queries against. It mirrors
 * docs/architecture/04-erd.md; migrations are the source of truth for the actual
 * DDL, and this file must track them. Migrations themselves use `Kysely<any>`, so
 * a table appears here when a repository or test needs to query it.
 *
 * Conventions:
 *   - `Generated<T>`  value is present after insert but not required on insert
 *                     (here: application-supplied ids and DB defaults).
 *   - `Timestamptz`   stored as timestamptz; read as Date, written as Date|string.
 *   - `| null`        nullable column.
 */

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

export type Timestamptz = ColumnType<Date, Date | string, Date | string>
/** Set by the database default/trigger; never written by the app. */
export type CreatedAt = ColumnType<Date, Date | string | undefined, never>
export type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>
export type Json = ColumnType<Record<string, unknown>, string | Record<string, unknown>, string | Record<string, unknown>>

// ─────────────────────────────────────────────────────────────── identity

export interface UsersTable {
  id: Generated<string>
  email: string
  email_verified_at: Timestamptz | null
  full_name: string
  phone: string | null
  avatar_url: string | null
  locale: Generated<string>
  timezone: Generated<string>
  status: Generated<string>
  last_login_at: Timestamptz | null
  failed_login_count: Generated<number>
  locked_until: Timestamptz | null
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: Timestamptz | null
}

export interface UserCredentialsTable {
  id: Generated<string>
  user_id: string
  password_hash: string
  algorithm: string
  password_changed_at: Timestamptz
  must_change_password: Generated<boolean>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface SessionsTable {
  id: Generated<string>
  user_id: string
  organization_id: string | null
  issued_at: Timestamptz
  expires_at: Timestamptz
  last_used_at: Timestamptz
  revoked_at: Timestamptz | null
  revoked_reason: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: CreatedAt
}

export interface RefreshTokensTable {
  id: Generated<string>
  session_id: string
  token_hash: string
  generation: number
  issued_at: Timestamptz
  expires_at: Timestamptz
  consumed_at: Timestamptz | null
  replaced_by_id: string | null
}

// ─────────────────────────────────────────────────────────── organizations

export interface OrganizationsTable {
  id: Generated<string>
  name: string
  slug: string
  legal_name: string | null
  status: Generated<string>
  suspended_at: Timestamptz | null
  suspension_reason: string | null
  industry: string | null
  country: string | null
  timezone: Generated<string>
  currency: Generated<string>
  billing_email: string | null
  metadata: Generated<Json>
  created_by_user_id: string | null
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: Timestamptz | null
}

export interface BranchesTable {
  id: Generated<string>
  organization_id: string
  name: string
  code: string | null
  address: Json | null
  timezone: string | null
  status: Generated<string>
  is_primary: Generated<boolean>
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: Timestamptz | null
}

export interface MembershipsTable {
  id: Generated<string>
  user_id: string
  organization_id: string
  status: string
  is_owner: Generated<boolean>
  all_branches: Generated<boolean>
  default_branch_id: string | null
  invited_by_user_id: string | null
  invited_at: Timestamptz | null
  joined_at: Timestamptz | null
  removed_at: Timestamptz | null
  last_active_at: Timestamptz | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface MembershipBranchesTable {
  membership_id: string
  branch_id: string
  organization_id: string
  created_at: CreatedAt
}

export interface InvitationsTable {
  id: Generated<string>
  organization_id: string
  email: string
  token_hash: string
  invited_by_user_id: string
  status: Generated<string>
  expires_at: Timestamptz
  accepted_at: Timestamptz | null
  accepted_user_id: string | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface InvitationRolesTable {
  invitation_id: string
  role_id: string
}

// ───────────────────────────────────────────────────────────────── rbac

export interface PermissionsTable {
  id: Generated<string>
  key: string
  scope: string
  product_id: string | null
  description: string
  is_dangerous: Generated<boolean>
  created_at: CreatedAt
}

export interface RolesTable {
  id: Generated<string>
  key: string | null
  name: string
  description: string | null
  scope: string
  product_id: string | null
  organization_id: string | null
  is_system: Generated<boolean>
  is_assignable: Generated<boolean>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface RolePermissionsTable {
  role_id: string
  permission_id: string
  created_at: CreatedAt
}

export interface MembershipRolesTable {
  membership_id: string
  role_id: string
  granted_by_user_id: string | null
  created_at: CreatedAt
}

export interface PlatformRoleAssignmentsTable {
  id: Generated<string>
  user_id: string
  role_id: string
  granted_by_user_id: string
  expires_at: Timestamptz | null
  revoked_at: Timestamptz | null
  created_at: CreatedAt
}

export interface CustomerAccountAssignmentsTable {
  id: Generated<string>
  organization_id: string
  user_id: string
  relationship: string
  assigned_by_user_id: string
  is_primary: Generated<boolean>
  created_at: CreatedAt
  updated_at: UpdatedAt
  ended_at: Timestamptz | null
}

// ──────────────────────────────────────────────────────────────── catalog

export interface ProductsTable {
  id: Generated<string>
  slug: string
  name: string
  tagline: string | null
  description: string | null
  icon_url: string | null
  accent_color: string | null
  category: string | null
  app_url: string | null
  marketing_url: string | null
  status: Generated<string>
  visibility: Generated<string>
  owner_team: string | null
  version: string | null
  sort_order: Generated<number>
  supports_sso: Generated<boolean>
  health_check_url: string | null
  metadata: Generated<Json>
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: Timestamptz | null
}

export interface FeaturesTable {
  id: Generated<string>
  product_id: string
  key: string
  name: string
  description: string | null
  type: string
  enforced_by: string
  countable_resource: string | null
  countable_scope: string | null
  unit: string | null
  is_public: Generated<boolean>
  sort_order: Generated<number>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

// ──────────────────────────────────────────────────────────────── billing

export interface PlansTable {
  id: Generated<string>
  product_id: string
  key: string
  name: string
  description: string | null
  tier: number
  price_amount: string | null
  price_currency: string | null
  billing_interval: string | null
  trial_days: Generated<number>
  support_level: string | null
  status: Generated<string>
  is_public: Generated<boolean>
  sort_order: Generated<number>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface PlanFeaturesTable {
  id: Generated<string>
  plan_id: string
  feature_id: string
  is_enabled: Generated<boolean>
  limit_value: string | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface SubscriptionsTable {
  id: Generated<string>
  organization_id: string
  product_id: string
  plan_id: string
  status: string
  started_at: Generated<Timestamptz>
  current_period_start: Timestamptz | null
  current_period_end: Timestamptz | null
  trial_ends_at: Timestamptz | null
  cancel_at_period_end: Generated<boolean>
  cancelled_at: Timestamptz | null
  ended_at: Timestamptz | null
  suspended_at: Timestamptz | null
  suspension_reason: string | null
  external_billing_ref: string | null
  created_by_user_id: string | null
  notes: string | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface SubscriptionOverridesTable {
  id: Generated<string>
  subscription_id: string
  feature_id: string
  is_enabled: boolean | null
  limit_value: string | null
  is_unlimited: Generated<boolean>
  reason: string
  granted_by_user_id: string
  expires_at: Timestamptz | null
  superseded_at: Timestamptz | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface SubscriptionEventsTable {
  id: Generated<string>
  subscription_id: string
  organization_id: string
  event_type: string
  from_plan_id: string | null
  to_plan_id: string | null
  from_status: string | null
  to_status: string | null
  actor_user_id: string | null
  metadata: Generated<Json>
  created_at: CreatedAt
}

// ───────────────────────────────────────────── seats (ADR-018)

export interface MembershipProductsTable {
  id: Generated<string>
  membership_id: string
  organization_id: string
  product_id: string
  granted_at: Generated<Timestamptz>
  granted_by_user_id: string
  revoked_at: Timestamptz | null
  revoked_by_user_id: string | null
}

export interface InvitationProductsTable {
  invitation_id: string
  product_id: string
}

// ──────────────────────────────────────────────────────────────── usage

export interface UsageCountersTable {
  id: Generated<string>
  organization_id: string
  subscription_id: string | null
  feature_id: string
  period_key: string
  period_start: Timestamptz | null
  period_end: Timestamptz | null
  used_value: Generated<string>
  updated_at: UpdatedAt
}

export interface ProductUsageReportsTable {
  id: Generated<string>
  organization_id: string
  product_id: string
  branch_id: string | null
  metric_key: string
  metric_value: string
  period_start: Timestamptz
  period_end: Timestamptz
  reported_at: Timestamptz
  idempotency_key: string
}

// ──────────────────────────────────────────────────────────── accounts

export interface CustomerAccountsTable {
  id: Generated<string>
  organization_id: string
  account_tier: string | null
  lifecycle_stage: Generated<string>
  health_score: number | null
  mrr_amount: string | null
  mrr_currency: string | null
  renewal_date: ColumnType<Date, Date | string, Date | string> | null
  churn_risk_note: string | null
  metadata: Generated<Json>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface OrganizationProductRequestsTable {
  id: Generated<string>
  organization_id: string | null
  product_id: string
  requested_by_user_id: string | null
  request_type: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  message: string | null
  status: Generated<string>
  assigned_to_user_id: string | null
  source: string | null
  created_at: CreatedAt
  updated_at: UpdatedAt
}

// ──────────────────────────────────────────────────────────────── audit

export interface AuditLogsTable {
  id: Generated<string>
  actor_user_id: string | null
  actor_type: string
  actor_label: string | null
  organization_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  resource_label: string | null
  outcome: string
  changes: Json | null
  metadata: Generated<Json>
  ip_address: string | null
  user_agent: string | null
  correlation_id: string | null
  created_at: CreatedAt
}

// ──────────────────────────────────────────────────────────────── outbox

export interface OutboxEventsTable {
  id: Generated<string>
  event_type: string
  event_version: Generated<number>
  organization_id: string | null
  aggregate_type: string
  aggregate_id: string
  payload: Json
  status: Generated<string>
  attempts: Generated<number>
  next_attempt_at: Generated<Timestamptz>
  last_error: string | null
  dispatched_at: Timestamptz | null
  correlation_id: string | null
  created_at: CreatedAt
}

// ───────────────────────────── derived read model (view, ERD §8)

/**
 * v_organization_products — read-only. The launcher's access-state source. There
 * is no `entitlements` table; entitlement is derived here (ADR-006).
 */
export interface VOrganizationProductsView {
  organization_id: string
  product_id: string
  slug: string
  subscription_id: string | null
  plan_id: string | null
  access_state: string
  payment_attention_required: boolean
  trial_ends_at: Timestamptz | null
  current_period_end: Timestamptz | null
}

// ─────────────────────────────────────────────────────── the database

export interface DB {
  v_organization_products: VOrganizationProductsView
  users: UsersTable
  user_credentials: UserCredentialsTable
  sessions: SessionsTable
  refresh_tokens: RefreshTokensTable

  organizations: OrganizationsTable
  branches: BranchesTable
  memberships: MembershipsTable
  membership_branches: MembershipBranchesTable
  invitations: InvitationsTable
  invitation_roles: InvitationRolesTable

  permissions: PermissionsTable
  roles: RolesTable
  role_permissions: RolePermissionsTable
  membership_roles: MembershipRolesTable
  platform_role_assignments: PlatformRoleAssignmentsTable
  customer_account_assignments: CustomerAccountAssignmentsTable

  products: ProductsTable
  features: FeaturesTable

  plans: PlansTable
  plan_features: PlanFeaturesTable
  subscriptions: SubscriptionsTable
  subscription_overrides: SubscriptionOverridesTable
  subscription_events: SubscriptionEventsTable

  membership_products: MembershipProductsTable
  invitation_products: InvitationProductsTable

  usage_counters: UsageCountersTable
  product_usage_reports: ProductUsageReportsTable

  customer_accounts: CustomerAccountsTable
  organization_product_requests: OrganizationProductRequestsTable

  audit_logs: AuditLogsTable
  outbox_events: OutboxEventsTable
}

// Convenience row types for the tables repositories use most.
export type Organization = Selectable<OrganizationsTable>
export type NewOrganization = Insertable<OrganizationsTable>
export type OrganizationUpdate = Updateable<OrganizationsTable>
export type Branch = Selectable<BranchesTable>
export type NewBranch = Insertable<BranchesTable>
export type Membership = Selectable<MembershipsTable>
export type NewMembership = Insertable<MembershipsTable>
export type AuditLog = Selectable<AuditLogsTable>
export type NewAuditLog = Insertable<AuditLogsTable>
export type NewOutboxEvent = Insertable<OutboxEventsTable>
