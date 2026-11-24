import { ashbyAdapter, createWorkdayAdapter, greenhouseAdapter, leverAdapter, type AtsAdapter } from "@autoply/ats";
import { getDb, getProfile } from "@autoply/core/db";

/** ATS adapters by kind. */
export const ADAPTERS: Record<string, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  // Workday accounts are created with the profile's confirmed email; the password lives in the OS keychain.
  workday: createWorkdayAdapter({
    email: () => {
      const e = getProfile(getDb()).identity.email;
      return e.confirmedByUser ? e.value : null;
    },
  }),
};
