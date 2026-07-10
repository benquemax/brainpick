/** brainpickd's library surface. */
export { createApi, type ApiOptions } from "./api";
export { DEFAULT_DAEMON_PORT, DEFAULT_SYNC_INTERVAL_MS, startDaemon, type DaemonOptions, type RunningDaemon } from "./daemon";
export { daemonTokenPath, ensureDaemonToken, loadDaemonToken, verifyDaemonToken } from "./daemonToken";
export { resolveEngineCommand, type EngineCommand } from "./engine";
export { cloneIfMissing, gitSshEnv, pullOnce, type CloneResult, type PullResult } from "./gitsync";
export { ensureBrainKey, keyDir, type BrainKey } from "./keys";
export { primaryNonLoopbackIPv4, resolveAdvertiseHost } from "./network";
export { configDir, dataDir, type Env } from "./paths";
export {
  addBrain,
  brainBundleRoot,
  clonedRepoDir,
  createRegistryStore,
  DEFAULT_HOST,
  findBrain,
  isLocalHost,
  isLocalRepo,
  loadRegistry,
  registryPath,
  removeBrain,
  saveRegistry,
  validateBrainInput,
  type BrainInput,
  type BrainRecord,
  type Registry,
  type RegistryStore,
  type ValidationResult,
} from "./registry";
export {
  DEFAULT_BACKOFF_MS,
  DEFAULT_STABLE_AFTER_MS,
  Supervisor,
  type BrainStatus,
  type SupervisorOptions,
} from "./supervisor";
export {
  addUser,
  defaultProvisioningUser,
  ensureLanToken,
  ensureLanTokenForBrain,
  findUser,
  hasBrainAccess,
  listProvisionedTokens,
  loadUsers,
  provisionToken,
  removeUser,
  revokeProvisionedToken,
  saveUsers,
  setUserPassword,
  usersPath,
  verifyUserPassword,
  type LanToken,
  type PasswordHash,
  type UserRecord,
  type Users,
} from "./users";
export { VERSION } from "./version";
