import { type Config } from "./config.js"
import type { Commit, PackageToRelease } from "./types.js"

import { debug, pkgJson, execSync } from "./utils.js"

/** Make sure that packages that depend on other packages are released last. */
async function sortByDependency(pkgs: PackageToRelease[]) {
	const pkgsWithDeps = new Map<string, string[]>()

	for await (const pkg of pkgs) {
		const { dependencies } = await pkgJson.read(pkg.path)
		pkgsWithDeps.set(pkg.name, Object.keys(dependencies ?? {}))
	}

	pkgs.sort((a, b) => (pkgsWithDeps.get(a.name)?.includes(b.name) ? 1 : -1))
}

export async function publish(packages: PackageToRelease[], options: Config) {
	const { dryRun, RELEASE_COMMIT_MSG } = options

	await sortByDependency(packages)

	for await (const pkg of packages) {
		if (dryRun) {
			console.log(
				`Dry run, \`npm publish\` would have released package \`${pkg.name}\` with version "${pkg.newVersion}".`
			)
		} else {
			console.log(
				`Writing version "${pkg.newVersion}" to package.json for package \`${pkg.name}\``
			)
			await pkgJson.update(pkg.path, { version: pkg.newVersion })
			console.log("package.json file has been written, publishing...")
		}

		let npmPublish = `pnpm publish --access public --registry=https://registry.npmjs.org --no-git-checks`
		// We use different tokens for `next-auth` and `@next-auth/*` packages

		if (dryRun) {
			console.log(
				`Dry run, skip \`npm publish\` for package \`${pkg.name}\`...\n`
			)
			npmPublish += " --dry-run --silent"
		} else {
			execSync(
				"echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc",
				{ cwd: pkg.path }
			)
		}

		execSync(npmPublish, { cwd: pkg.path })
	}

	// if (dryRun) {
	// 	console.log("Dry run, skip release commit...")
	// } else {
	execSync(`git add -A && git commit -m "${RELEASE_COMMIT_MSG}"`)
	// console.log("Commited.")
	// }

	for (const pkg of packages) {
		const { name, oldVersion, newVersion } = pkg
		const gitTag = `${name}@${newVersion}`

		console.log(
			`\n\n-------------------------------\n${name} ${oldVersion} -> ${newVersion}`
		)

		const changelog = createChangelog(pkg)
		debug("Changelog generated", changelog)

		if (dryRun) {
			console.log(`Dry run, skip git tag/release notes for package \`${name}\``)
		} else {
			console.log(`Creating git tag...`)
			execSync(`git tag ${gitTag}`)
			execSync("git push --tags")
			console.log(`Creating GitHub release notes...`)
			execSync(`gh release create ${gitTag} --notes '${changelog}'`)
		}
	}

	if (dryRun) execSync(`git push --dry-run`)
	else execSync(`git push`)
}

function createChangelog(pkg: PackageToRelease) {
	const {
		commits: { features, breaking, bugfixes, other },
	} = pkg
	console.log(`Creating changelog for package \`${pkg.name}\`...`)

	let changelog = ``
	changelog += listGroup("Features", features)
	changelog += listGroup("Bugfixes", bugfixes)
	changelog += listGroup("Other", other)

	if (breaking.length) {
		changelog += `
## BREAKING CHANGES

${breaking.map((c) => `  - ${c.body}`).join("\n")}`
	}

	return changelog.replace(/'/g, "'\\''")
}

function sortByScope(commits: Commit[]) {
	return commits.sort((a, b) => {
		if (a.parsed.scope && b.parsed.scope) {
			return a.parsed.scope.localeCompare(b.parsed.scope)
		} else if (a.parsed.scope) return -1
		else if (b.parsed.scope) return 1
		return a.body.localeCompare(b.body)
	})
}

function header(c: Commit) {
	let h = c.parsed.subject
	if (c.parsed.scope) {
		h = `**${c.parsed.scope}**: ${h} (${c.commit.short})`
	}
	return h
}

function listGroup(heading: string, commits: Commit[]) {
	if (!commits.length) return ""
	const list = sortByScope(commits)
		.map((c) => `  - ${header(c)}`)
		.join("\n")
	return `## ${heading}

${list}

`
}
