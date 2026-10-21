"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// The Next.js client uses /api/auth; branch URLs and secrets stay on the server.
export const authClient = createAuthClient();
