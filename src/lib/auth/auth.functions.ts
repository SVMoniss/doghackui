import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getSessionToken, getSessionUser } from "./session-store";

/** Current session user (or null). Used by the route gate and session hook. */
export const authSession = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const token = request?.headers ? getSessionToken(request) : null;
  const user = token ? await getSessionUser(token) : null;
  return { user };
});
