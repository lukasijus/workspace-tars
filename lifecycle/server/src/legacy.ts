import fs from "node:fs";
import path from "node:path";

function findLifecycleRoot(): string {
  let current = __dirname;

  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "lib", "db.js")) &&
      fs.existsSync(path.join(current, "submit_approved.js"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error("Could not locate lifecycle root from server runtime path.");
}

export const lifecycleRoot = findLifecycleRoot();
export const workspaceRoot = path.resolve(lifecycleRoot, "..");
export const guiDistRoot = path.join(lifecycleRoot, "gui", "dist");

function fromLifecycle<T = any>(relativePath: string): T {
  return require(path.join(lifecycleRoot, relativePath)) as T;
}

export const db = fromLifecycle("lib/db.js");
export const configModule = fromLifecycle("lib/config.js");
export const state = fromLifecycle("lib/state.js");
export const repository = fromLifecycle("lib/repository.js");
export const applicationDiscovery = fromLifecycle("lib/application-discovery.js");
export const submitApprovedModule = fromLifecycle("submit_approved.js");
export const applicantFactsModule = fromLifecycle("lib/applicant-facts.js");
export const applicantPolicyModule = fromLifecycle("lib/applicant-policy.js");

export const config = configModule.config;
export const {
  APPLICATION_STATUS,
  APPROVAL_STATE,
  FLOW_TYPE,
} = state;
