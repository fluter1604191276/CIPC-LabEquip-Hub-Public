import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const stableVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/;
const commitShaPattern = /^[0-9a-f]{40}$/i;

export function normalizeVersion(value) {
  const version = String(value || "").trim();
  if (!versionPattern.test(version)) throw new Error("版本号格式无效");
  return version.startsWith("v") ? version.slice(1) : version;
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left).split("-")[0].split(".").map(Number);
  const b = normalizeVersion(right).split("-")[0].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function assertStable(value) {
  const version = String(value || "").trim();
  if (!stableVersionPattern.test(version)) throw new Error("升级版本必须是稳定版本");
  return normalizeVersion(version);
}

function assertCommitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!commitShaPattern.test(sha)) throw new Error("版本提交 SHA 无效");
  return sha;
}

function githubUrl(repository, suffix) {
  return `https://api.github.com/repos/${repository}${suffix}`;
}

export function createUpdateManager({
  repository = process.env.UPDATE_REPOSITORY || "fluter1604191276/CIPC-LabEquip-Hub-Public",
  currentVersion = "0.0.0",
  requestFile = process.env.UPDATE_REQUEST_FILE || "apps/api/data/upgrade/request.json",
  statusFile = process.env.UPDATE_STATUS_FILE || "apps/api/data/upgrade/status.json",
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedRepository = String(repository).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepository)) throw new Error("UPDATE_REPOSITORY 格式无效");
  const normalizedCurrentVersion = normalizeVersion(currentVersion);

  async function githubJson(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "laboratory-resource-hub-updater" },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`版本仓库返回 HTTP ${response.status}`);
    return response.json();
  }

  async function resolveCommitSha(release, latestVersion, releaseTag) {
    const embeddedSha = release?.commit?.sha || release?.target_commitish;
    if (commitShaPattern.test(String(embeddedSha || "").trim())) return assertCommitSha(embeddedSha);
    const commit = await githubJson(githubUrl(normalizedRepository, `/commits/${encodeURIComponent(releaseTag || `v${latestVersion}`)}`));
    return assertCommitSha(commit?.sha);
  }

  async function check() {
    let release;
    try {
      release = await githubJson(githubUrl(normalizedRepository, "/releases/latest"));
    } catch (error) {
      const tags = await githubJson(githubUrl(normalizedRepository, "/tags?per_page=30"));
      const candidate = tags
        .filter((tag) => stableVersionPattern.test(String(tag?.name || "").trim()))
        .sort((a, b) => compareVersions(b.name, a.name))[0];
      if (!candidate) throw error;
      release = {
        tag_name: candidate.name,
        name: candidate.name,
        body: "",
        html_url: `https://github.com/${normalizedRepository}/releases/tag/${candidate.name}`,
        published_at: null,
        tarball_url: `https://github.com/${normalizedRepository}/archive/refs/tags/${candidate.name}.tar.gz`,
        commit: candidate.commit
      };
    }
    const releaseTag = String(release.tag_name || release.name || "").trim();
    if (!releaseTag) throw new Error("版本仓库未返回稳定标签");
    const latestVersion = assertStable(releaseTag);
    const commitSha = await resolveCommitSha(release, latestVersion, releaseTag);
    return {
      currentVersion: normalizedCurrentVersion,
      latestVersion,
      tagName: releaseTag,
      commitSha,
      updateAvailable: compareVersions(latestVersion, normalizedCurrentVersion) > 0,
      repository: normalizedRepository,
      releaseName: String(release.name || release.tag_name || latestVersion),
      releaseNotes: String(release.body || "").slice(0, 20_000),
      releaseUrl: release.html_url || `https://github.com/${normalizedRepository}/releases/tag/v${latestVersion}`,
      publishedAt: release.published_at || null,
      tarballUrl: release.tarball_url || `https://github.com/${normalizedRepository}/archive/refs/tags/v${latestVersion}.tar.gz`
    };
  }

  function getStatus() {
    return readJson(statusFile, { state: "idle", currentVersion: normalizedCurrentVersion, updatedAt: null, message: "尚未执行升级任务" });
  }

  let submissionPending = false;
  // Shared with manual/automatic agents. Never reclaim another writer's
  // incomplete guard: only the OS-flock owner may recover a proven dead owner.
  const admissionLockDirectory = resolve(dirname(requestFile), ".upgrade-lock");
  function acquireAdmissionLock() {
    mkdirSync(dirname(admissionLockDirectory), { recursive: true, mode: 0o700 });
    try { mkdirSync(admissionLockDirectory, { mode: 0o750 }); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("已有升级任务正在执行");
      throw error;
    }
    try {
      writeFileSync(`${admissionLockDirectory}/owner.json`, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { mode: 0o640 });
    } catch (error) {
      rmSync(admissionLockDirectory, { recursive: true, force: true });
      throw error;
    }
    return () => rmSync(admissionLockDirectory, { recursive: true, force: true });
  }
  function assertQueueAvailable(checkLock = true) {
    if (["queued", "running"].includes(getStatus().state) || existsSync(requestFile)
        || (checkLock && existsSync(admissionLockDirectory))) {
      throw new Error("已有升级任务正在执行");
    }
  }

  async function requestUpgrade(version, actor) {
    const targetVersion = assertStable(version);
    if (submissionPending) throw new Error("已有升级任务正在执行");
    assertQueueAvailable();
    submissionPending = true;
    try {
      const latest = await check();
      // Admission is claimed only after the network check, then rechecked while
      // holding an atomic cross-process lock so separate API workers cannot
      // overwrite one another's request during the await above.
      const releaseAdmission = acquireAdmissionLock();
      try {
        assertQueueAvailable(false);
        if (latest.latestVersion !== targetVersion || !latest.updateAvailable) throw new Error("目标版本不是当前可升级的稳定版本，请重新检查更新");
        const request = {
          id: randomUUID(),
          version: targetVersion,
          tagName: latest.tagName,
          commitSha: latest.commitSha,
          repository: normalizedRepository,
          requestedAt: new Date().toISOString(),
          actor: { id: actor?.id || null, username: actor?.username || "", displayName: actor?.displayName || "" }
        };
        // Publish queued status before the path watcher sees the request file.
        atomicWriteJson(statusFile, {
          state: "queued", requestId: request.id, currentVersion: normalizedCurrentVersion,
          targetVersion, commitSha: request.commitSha, requestedAt: request.requestedAt,
          updatedAt: request.requestedAt, message: "升级任务已排队，等待升级服务执行"
        });
        try {
          atomicWriteJson(requestFile, request);
        } catch (error) {
          atomicWriteJson(statusFile, {
            state: "failed", requestId: request.id, currentVersion: normalizedCurrentVersion,
            targetVersion, commitSha: request.commitSha, requestedAt: request.requestedAt,
            message: `升级请求写入失败：${error.message}`
          });
          throw error;
        }
        return getStatus();
      } finally {
        releaseAdmission();
      }
    } finally {
      submissionPending = false;
    }
  }

  return { check, getStatus, requestUpgrade, repository: normalizedRepository, currentVersion: normalizedCurrentVersion, requestFile, statusFile };
}
