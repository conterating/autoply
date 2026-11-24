import "server-only";
import { getDb } from "@autoply/core/db";

export const db = () => getDb();
