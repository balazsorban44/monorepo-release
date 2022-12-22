import { pkgJson } from "./utils.js"

export interface Config {
	releaseBranches: string[]
	packageDirectories: string[]
	BREAKING_COMMIT_MSG: string
	RELEASE_COMMIT_MSG: string
	RELEASE_COMMIT_TYPES: string[]
	NO_VERIFY: boolean
	dryRun: boolean
	verbose: boolean
}

const json = await pkgJson.read("./")

export const defaultConfig: Config = {
	releaseBranches: ["main"],
	// TODO: Read from pnpm-workspace.yaml
	packageDirectories: ["packages"],
	BREAKING_COMMIT_MSG: "BREAKING CHANGE:",
	RELEASE_COMMIT_MSG: "chore(release): bump package version(s) [skip ci]",
	RELEASE_COMMIT_TYPES: ["feat", "fix"],
	NO_VERIFY: !!process.env.NO_VERIFY || process.argv.includes("--no-verify"),
	dryRun:
		!process.env.CI ||
		!!process.env.DRY_RUN ||
		process.argv.includes("--dry-run"),
	verbose: !!process.env.VERBOSE || process.argv.includes("--verbose"),
	...json.release,
}
