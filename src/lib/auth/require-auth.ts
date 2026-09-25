import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getSessionToken, getSessionUser } from "./session-store";

/** Local session gate: replaces the hosted-JWT middleware everywhere. */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request?.headers) throw new Error("Unauthorized: please sign in.");
  const token = getSessionToken(request);
  const user = token ? await getSessionUser(token) : null;
  if (!user) throw new Error("Unauthorized: please sign in.");
  return next({ context: { userId: user.id, user } });
});
