"use server";

import { setDesired } from "@autoply/core/db";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export async function setWorkerDesired(desired: "running" | "paused") {
  setDesired(db(), desired);
  revalidatePath("/", "layout");
}
