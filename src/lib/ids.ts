import { randomBytes, randomUUID } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
export const newToken = () => randomUUID().replace(/-/g, "") + randomBytes(16).toString("hex");
