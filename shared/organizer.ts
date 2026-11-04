/** Organizer contracts. The product ends at consented contact disclosure. */
export type Role = "admin" | "manager" | "reviewer";
export type TaskState = "draft" | "open" | "paused" | "closed" | "archived";
export type ApplicationState =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "expired";
export interface ContactMethod {
  type: "phone" | "wechat" | "email";
  label: string;
  value: string;
}
export interface Organization {
  id: string;
  name: string;
  verified: boolean;
  description: string;
  contacts: ContactMethod[];
  verificationStatus: string;
  demo: boolean;
}
export interface Membership {
  id: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  canViewContacts: boolean;
  taskIds: string[];
}
export interface Session {
  account: { id: string; name: string; email: string };
  memberships: Membership[];
}
export interface ContentBlock {
  type: "heading" | "paragraph" | "image" | "video" | "map" | "table";
  text?: string;
  url?: string;
  rows?: string[][];
  latitude?: number;
  longitude?: number;
  annotations?: MapAnnotation[];
}
export interface MapCoordinate {
  latitude: number;
  longitude: number;
}
export interface MapAnnotation {
  type: "point" | "path" | "area";
  coordinates: MapCoordinate[];
}
export interface OrganizerTask {
  id: string;
  incidentId: string;
  incidentTitle: string;
  title: string;
  summary: string;
  state: TaskState;
  capacity: number | null;
  startsAt: string;
  endsAt: string;
  deadline: string;
  location: string;
  meetingPoint: string;
  ownerId: string;
  ownerName: string;
  blocks: ContentBlock[];
  requiredFields: string[];
  contactFields: string[];
  updatedAt: string;
  version: number;
  pending: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
  expired: number;
}
export interface OrganizerApplication {
  id: string;
  taskId: string;
  taskTitle: string;
  status: ApplicationState;
  profile: Record<string, unknown>;
  contactFields: string[];
  contacts: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  response: string | null;
  note: string;
  reviewerName: string | null;
}
export interface ApplicationPage {
  items: OrganizerApplication[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ApplicationState, number>;
}
export interface Incident {
  id: string;
  title: string;
  region: string;
  address: string;
  latitude: number;
  longitude: number;
  status: string;
  version: number;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  canViewContacts: boolean;
  active: boolean;
  taskIds: string[];
}
export interface Activity {
  id: string;
  actor: string;
  action: string;
  subject: string;
  taskId: string | null;
  createdAt: string;
}
export interface OrganizationRequest {
  id: string;
  kind: "incident" | "verification";
  content: string;
  status: "pending" | "resolved" | "rejected";
  createdAt: string;
}
export interface ResultNotice {
  id: string;
  title: string;
  body: string;
  taskTitle: string;
  createdAt: string;
  readAt: string | null;
}
export interface Workspace {
  organization: Organization;
  membership: Membership;
  tasks: OrganizerTask[];
  incidents: Incident[];
  activities: Activity[];
  members: Member[];
  requests: OrganizationRequest[];
}
export interface TaskInput {
  title: string;
  summary: string;
  incidentId: string;
  capacity: number | null;
  startsAt: string;
  endsAt: string;
  deadline: string;
  location: string;
  meetingPoint: string;
  ownerId: string;
  blocks: ContentBlock[];
  requiredFields: string[];
  contactFields: string[];
  version?: number;
}
