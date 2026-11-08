import type { AppType } from "@where-to-play/server";
import { hc } from "hono/client";

export const apiClient = hc<AppType>("/");
