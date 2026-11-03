export type Theme = "light" | "dark";
export type ApplicationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn";

export interface Scene {
  id: string;
  label: string;
  chapter: string;
  title: [string, string];
  description: string;
  points: string[];
  route: string;
  expected: string[];
  cue: string;
  status?: ApplicationStatus;
  notices?: boolean;
}

export type DemoInput =
  | { type: "back" }
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x: number; y: number; endX: number; endY: number };

export interface DemoStatus {
  session: string;
  scene: string | null;
  revision: number;
  theme: Theme;
  busy: boolean;
  error: string | null;
  capturedAt: string | null;
  device: string;
}
