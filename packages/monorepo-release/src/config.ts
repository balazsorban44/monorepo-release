import { pkgJson } from "./utils.js"

export interface Config {
  releaseBranches: string[]
  BREAKING_COMMIT_MSG: string
  RELEASE_COMMIT_MSG: string
  RELEASE_COMMIT_TYPES: string[]
  noVerify: boolean
  dryRun: boolean
  verbose: boolean
  peek: boolean
}

const json = await pkgJson.read("./")

const peek = !!process.env.PEEK || process.argv.includes("--peek")
export const defaultConfig: Config = {
  releaseBranches: ["main"],
  BREAKING_COMMIT_MSG: "BREAKING CHANGE:",
  RELEASE_COMMIT_MSG: "chore(release): bump package version(s) [skip ci]",
  RELEASE_COMMIT_TYPES: ["feat", "fix"],
  noVerify:
    !!process.env.NO_VERIFY || process.argv.includes("--no-verify") || peek,
  dryRun:
    !process.env.CI ||
    !!process.env.DRY_RUN ||
    process.argv.includes("--dry-run"),
  verbose: !!process.env.VERBOSE || process.argv.includes("--verbose"),
  peek,
  ...json.release,
}
