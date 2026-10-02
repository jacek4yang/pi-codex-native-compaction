import { NativeError } from "./errors.js";
export type Phase =
  | "IDLE"
  | "SCHEDULED"
  | "SNAPSHOT"
  | "REQUESTING"
  | "BACKOFF"
  | "VALIDATING"
  | "COMMITTING"
  | "FAILED"
  | "CANCELLED"
  | "CIRCUIT_OPEN";
const edges: Record<Phase, readonly Phase[]> = {
  IDLE: ["SCHEDULED"],
  SCHEDULED: ["SNAPSHOT", "FAILED", "CANCELLED"],
  SNAPSHOT: ["REQUESTING", "FAILED", "CANCELLED"],
  REQUESTING: ["VALIDATING", "BACKOFF", "FAILED", "CANCELLED"],
  BACKOFF: ["REQUESTING", "FAILED", "CANCELLED"],
  VALIDATING: ["COMMITTING", "FAILED", "CANCELLED"],
  COMMITTING: ["IDLE", "FAILED", "CANCELLED"],
  FAILED: ["IDLE", "CIRCUIT_OPEN"],
  CANCELLED: ["IDLE"],
  CIRCUIT_OPEN: ["IDLE"],
};
export class StateMachine {
  phase: Phase = "IDLE";
  move(next: Phase) {
    if (!edges[this.phase].includes(next))
      throw new NativeError(
        "compatibility",
        "Illegal transition: " + this.phase + " -> " + next,
      );
    this.phase = next;
  }
}
