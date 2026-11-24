import "server-only";
import { getSettings, isWorkerAlive, readWorkerState, submittedToday, todayCounts } from "@autoply/core/db";
import { db } from "./db";

export type WorkerView = {
  alive: boolean;
  desired: "running" | "paused";
  activity: string | null;
};

export function getWorkerView(): WorkerView {
  const state = readWorkerState(db());
  return {
    alive: isWorkerAlive(state),
    desired: state?.desired ?? "paused",
    activity: state?.activity ?? null,
  };
}

export function getShellState() {
  const d = db();
  const settings = getSettings(d);
  return {
    worker: getWorkerView(),
    waiting: todayCounts(d).waiting,
    sentToday: submittedToday(d),
    dailyCap: settings.dailyCap,
    dryRun: settings.dryRun,
  };
}
