import type { Commit, GrouppedCommits, PackageToRelease } from "./types.js"
import type { Config } from "./config.js"

import { debug, pkgJson, execSync } from "./utils.js"
import semver from "semver"
import * as commitlint from "@commitlint/parse"
import gitLog from "git-log-parser"
import streamToArray from "stream-to-array"
import fs from "node:fs"
import path from "node:path"
import { type PackageJson } from "type-fest"

function getPackages(rootDir: string, packageDirectories: string[]) {
	const packages: string[] = []

	for (const dir of packageDirectories) {
		const packagesPath = path.join(rootDir, dir)
		for (const d of fs.readdirSync(packagesPath)) {
			const packageJSONPath = path.join(packagesPath, d, "package.json")
			const packageJSON = JSON.parse(
				fs.readFileSync(packageJSONPath, "utf8")
			) as Required<PackageJson>
			if (!packageJSON.private) packages.push(packageJSON.name)
		}
	}

	return packages
}

export async function analyze(config: Config): Promise<PackageToRelease[]> {
	const { BREAKING_COMMIT_MSG, RELEASE_COMMIT_MSG, RELEASE_COMMIT_TYPES } =
		config

	const packages = getPackages(process.cwd(), config.packageDirectories)

	console.log("Identifying latest tag...")
	const latestTag = execSync("git describe --tags --abbrev=0", {
		stdio: "ignore",
	})
		.toString()
		.trim()

	console.log(`Latest tag identified: ${latestTag}`)

	console.log()

	console.log("Identifying commits since the latest tag...")

	const range = `${latestTag}..HEAD`

	// Get the commits since the latest tag
	const commitsSinceLatestTag = await new Promise<Commit[]>(
		(resolve, reject) => {
			const stream = gitLog.parse({ _: range })
			streamToArray(stream, (err: Error, arr: any[]) => {
				if (err) return reject(err)

				Promise.all(
					arr.map(async (d) => {
						// @ts-ignore
						const parsed = await commitlint.default.default(d.subject)

						return { ...d, parsed }
					})
				).then((res) => resolve(res.filter(Boolean)))
			})
		}
	)

	console.log(commitsSinceLatestTag.length, `commits found since ${latestTag}`)
	debug(
		"Analyzing the following commits:",
		commitsSinceLatestTag.map((c) => `  ${c.subject}`).join("\n")
	)

	const lastCommit = commitsSinceLatestTag[0]

	if (lastCommit?.parsed.raw === RELEASE_COMMIT_MSG) {
		debug("Already released...")
		return []
	}

	console.log()
	console.log("Identifying commits that touched package code...")
	function getChangedFiles(commitSha: string) {
		return execSync(
			`git diff-tree --no-commit-id --name-only -r ${commitSha}`,
			{ stdio: "pipe" }
		)
			.toString()
			.trim()
			.split("\n")
	}
	const packageCommits = commitsSinceLatestTag.filter(({ commit }) => {
		const changedFiles = getChangedFiles(commit.short)
		return packages.some((packageFolder) =>
			changedFiles.some((changedFile) => changedFile.startsWith(packageFolder))
		)
	})

	console.log(packageCommits.length, "commits touched package code")

	console.log()

	console.log("Identifying packages that need a new release...")

	const packagesNeedRelease: string[] = []
	const grouppedPackages = packageCommits.reduce((acc, commit) => {
		const changedFilesInCommit = getChangedFiles(commit.commit.short)

		for (const [pkg, src] of Object.entries(packages)) {
			if (
				changedFilesInCommit.some((changedFile) => changedFile.startsWith(src))
			) {
				if (!(pkg in acc)) {
					acc[pkg] = { features: [], bugfixes: [], other: [], breaking: [] }
				}
				const { type } = commit.parsed
				if (RELEASE_COMMIT_TYPES.includes(type)) {
					if (!packagesNeedRelease.includes(pkg)) {
						packagesNeedRelease.push(pkg)
					}
					if (type === "feat") {
						acc[pkg].features.push(commit)
						if (commit.body.includes(BREAKING_COMMIT_MSG)) {
							const [, changesBody] = commit.body.split(BREAKING_COMMIT_MSG)
							acc[pkg].breaking.push({
								...commit,
								body: changesBody.trim(),
							})
						}
					} else acc[pkg].bugfixes.push(commit)
				} else {
					acc[pkg].other.push(commit)
				}
			}
		}
		return acc
	}, {} as Record<string, GrouppedCommits>)

	if (packagesNeedRelease.length) {
		console.log(
			packagesNeedRelease.length,
			`new release(s) needed: ${packagesNeedRelease.join(", ")}`
		)
	} else {
		console.log("No packages needed a new release, BYE!")

		return []
	}

	console.log()

	const packagesToRelease: PackageToRelease[] = []
	for await (const pkgName of packagesNeedRelease) {
		const commits = grouppedPackages[pkgName]
		const releaseType: semver.ReleaseType = commits.breaking.length
			? "major" // 1.x.x
			: commits.features.length
			? "minor" // x.1.x
			: "patch" // x.x.1

		const packageJson = await pkgJson.read(packages[pkgName])
		const oldVersion = packageJson.version!
		const newSemVer = semver.parse(semver.inc(oldVersion, releaseType))!

		packagesToRelease.push({
			name: pkgName,
			oldVersion,
			newVersion: `${newSemVer.major}.${newSemVer.minor}.${newSemVer.patch}`,
			commits,
			path: packages[pkgName],
		})
	}

	return packagesToRelease
}
