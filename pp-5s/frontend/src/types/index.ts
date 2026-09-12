import { Timestamp } from 'firebase/firestore';

// ── Roles ────────────────────────────────────────────────────────────────────
export type UserRole = 'superadmin' | 'plant_admin' | 'auditor' | 'area_owner' | 'action_owner' | 'viewer';

// ── User ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  plantIds: string[];
  department?: string;
  phone?: string;
  status: 'active' | 'inactive' | 'invited';
  createdAt: Timestamp;
  lastLoginAt?: Timestamp;
}

// ── Organization ─────────────────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  logoUrl?: string;
  timezone: string;
  settings: OrgSettings;
  createdAt: Timestamp;
}

export interface OrgSettings {
  scoringMethod: 'average' | 'weighted';
  passThreshold: number;
  excellentThreshold: number;
  goodThreshold: number;
  enableMagicLink: boolean;
  defaultAuditReminderDays: number;
  emailFromName: string;
}

// ── Plant ────────────────────────────────────────────────────────────────────
export interface Plant {
  id: string;
  orgId: string;
  name: string;
  code: string;
  location: string;
  adminIds: string[];
  status: 'active' | 'inactive';
  createdAt: Timestamp;
}

// ── Department / Area ─────────────────────────────────────────────────────────
export interface Department {
  id: string;
  plantId: string;
  name: string;
  code: string;
  status: 'active' | 'inactive';
}

export interface Area {
  id: string;
  plantId: string;
  deptId: string;
  name: string;
  code: string;
  ownerId?: string;
  status: 'active' | 'inactive';
}

// ── 5S Principles ────────────────────────────────────────────────────────────
export type Principle = 1 | 2 | 3 | 4 | 5;
export const PRINCIPLE_NAMES: Record<Principle, { short: string; long: string; jp: string }> = {
  1: { short: 'Sort', long: 'Sort (Seiri)', jp: 'Seiri' },
  2: { short: 'Set in Order', long: 'Set in Order (Seiton)', jp: 'Seiton' },
  3: { short: 'Shine', long: 'Shine (Seiso)', jp: 'Seiso' },
  4: { short: 'Standardize', long: 'Standardize (Seiketsu)', jp: 'Seiketsu' },
  5: { short: 'Sustain', long: 'Sustain (Shitsuke)', jp: 'Shitsuke' },
};

// ── Audit Template ───────────────────────────────────────────────────────────
export interface ChecklistItem {
  id: string;
  description: string;
  maxScore: number;
  weightage: number;
  guidance?: string;
}

export interface AuditCategory {
  id: string;
  name: string;
  principle: Principle;
  items: ChecklistItem[];
  weightage: number;
}

export interface AuditTemplate {
  id: string;
  orgId: string;
  plantId?: string;
  name: string;
  description?: string;
  version: number;
  categories: AuditCategory[];
  scoringRules: {
    maxItemScore: number;
    requireEvidence: boolean;
    requireObservation: boolean;
  };
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Audit Schedule ────────────────────────────────────────────────────────────
export type AuditFrequency = 'once' | 'weekly' | 'monthly' | 'quarterly';

export interface AuditSchedule {
  id: string;
  plantId: string;
  templateId: string;
  templateName: string;
  title: string;
  auditorIds: string[];
  areaId?: string;
  deptId?: string;
  dueDate: Timestamp;
  frequency: AuditFrequency;
  status: 'Scheduled' | 'InProgress' | 'Completed' | 'Overdue' | 'Cancelled';
  createdBy: string;
  createdAt: Timestamp;
}

// ── Audit Record ──────────────────────────────────────────────────────────────
export type AuditStatus = 'Draft' | 'Submitted' | 'UnderReview' | 'Approved' | 'Reopened';

export interface AuditScores {
  byCategory: Record<string, { score: number; maxScore: number; percentage: number }>;
  byPrinciple: Record<Principle, { score: number; maxScore: number; percentage: number }>;
  overall: { score: number; maxScore: number; percentage: number };
}

export interface Audit {
  id: string;
  scheduleId?: string;
  plantId: string;
  plantName: string;
  templateId: string;
  templateName: string;
  areaId?: string;
  areaName?: string;
  deptId?: string;
  deptName?: string;
  auditorId: string;
  auditorName: string;
  status: AuditStatus;
  scores: AuditScores;
  observations?: string;
  submittedAt?: Timestamp;
  reviewedAt?: Timestamp;
  approvedAt?: Timestamp;
  reviewerId?: string;
  approverId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuditResponse {
  id: string;
  auditId: string;
  itemId: string;
  categoryId: string;
  principle: Principle;
  score: number;
  maxScore: number;
  observation?: string;
  evidenceUrls: string[];
  createdAt: Timestamp;
}

// ── Corrective Action ─────────────────────────────────────────────────────────
export type ActionStatus =
  | 'Open' | 'InProgress' | 'SubmittedForVerification'
  | 'Verified' | 'Rejected' | 'Overdue' | 'Cancelled';

export type ActionPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface ActionHistory {
  status: ActionStatus;
  by: string;
  byName: string;
  at: Timestamp;
  comment?: string;
}

export interface CorrectiveAction {
  id: string;
  auditId?: string;
  plantId: string;
  areaId?: string;
  areaName?: string;
  deptId?: string;
  findingDescription: string;
  principle?: Principle;
  ownerId: string;
  ownerName: string;
  reviewerId?: string;
  reviewerName?: string;
  priority: ActionPriority;
  targetDate: Timestamp;
  status: ActionStatus;
  rootCause?: string;
  correction?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  evidenceUrls: string[];
  history: ActionHistory[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  overdueNotifiedAt?: Timestamp;
}

// ── Notification ──────────────────────────────────────────────────────────────
export type NotificationType =
  | 'user_invitation' | 'audit_assigned' | 'audit_reminder'
  | 'audit_submitted' | 'audit_approved' | 'action_assigned'
  | 'action_due_reminder' | 'action_overdue' | 'action_verified'
  | 'action_rejected' | 'management_summary';

export interface NotificationSetting {
  id: string;
  type: NotificationType;
  enabled: boolean;
  recipients: string[];
  scheduleExpr?: string;
  escalationHrs?: number;
  template: { subject: string; body: string };
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export interface PlantScoreSummary {
  plantId: string;
  plantName: string;
  overallScore: number;
  byPrinciple: Record<Principle, number>;
  auditCount: number;
  lastAuditDate?: Timestamp;
  openActions: number;
  overdueActions: number;
}

export interface DashboardStats {
  totalAudits: number;
  completedAudits: number;
  pendingAudits: number;
  overdueAudits: number;
  openActions: number;
  overdueActions: number;
  verifiedActions: number;
  averageScore: number;
}

// ── Activity Log ──────────────────────────────────────────────────────────────
export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  plantId?: string;
  details: Record<string, unknown>;
  timestamp: Timestamp;
}
