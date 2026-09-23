import { resolve } from "node:path";

export function resolveAmazonProfileDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return resolve(cwd, env.AMAZON_PROFILE_DIR ?? ".local/amazon-profile");
}
