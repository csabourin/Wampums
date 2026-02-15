import { ProgramProgressDashboard } from "./ProgramProgressDashboard.js";

export class ParentProgramProgress extends ProgramProgressDashboard {
  constructor(app) {
    super(app, {
      viewOnly: true,
      returnUrl: "/parent-dashboard",
      returnLabelKey: "back_to_parent_dashboard"
    });
  }
}
