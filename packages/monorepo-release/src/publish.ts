import { bold } from "yoctocolors"
import { type Config } from "./config.js"
import type { Commit, PackageToRelease } from "./types.js"

import { log, pkgJson, execSync } from "./utils.js"
import { exit } from "./index.js"

/** Make sure that packages that depend on other packages are released last. */
async function sortByDependency(pkgs: PackageToRelease[]) {
  const pkgsWithDeps = new Map<string, string[]>()

  for await (const pkg of pkgs) {
    const { dependencies } = await pkgJson.read(pkg.relativeDir)
    pkgsWithDeps.set(pkg.name, Object.keys(dependencies ?? {}))
  }

  pkgs.sort((a, b) => (pkgsWithDeps.get(a.name)?.includes(b.name) ? 1 : -1))
}

export async function publish(packages: PackageToRelease[], options: Config) {
  const { dryRun, RELEASE_COMMIT_MSG } = options

  execSync("pnpm build")

  await sortByDependency(packages)

  for await (const pkg of packages) {
    if (dryRun) {
      log.info(
        `Dry run won't release \`${bold(pkg.name + "@" + pkg.newVersion)}\``,
      )
    }

    log.debug(
      `Writing version "${bold(
        pkg.newVersion,
      )}" to package.json for package \`${bold(pkg.name)}\``,
    )
    await pkgJson.update(pkg.relativeDir, { version: pkg.newVersion })
    log.info("package.json file has been written, publishing.")

    let npmPublish = `pnpm publish --access public --registry=https://registry.npmjs.org --no-git-checks`
    if (dryRun) {
      npmPublish += " --dry-run"
      if (!options.verbose) npmPublish += " --silent"
    } else {
      execSync(
        "echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc",
        { cwd: pkg.relativeDir },
      )
    }

    execSync(npmPublish, { cwd: pkg.relativeDir })

    if (dryRun) {
      log.debug("Dry run, reverting version change.")
      await pkgJson.update(pkg.relativeDir, { version: pkg.oldVersion })
    }
  }

  if (dryRun) {
    log.debug("Dry run, skip release commit.")
  } else {
    log.debug("Commiting.")
    execSync(
      `git config --local user.name "GitHub Actions" && git config --local user.email "actions@github.com"`,
    )
    execSync(`git add -A && git commit -m "${RELEASE_COMMIT_MSG}"`)
    log.info("Commited.")
  }

  for (const pkg of packages) {
    const { name, newVersion } = pkg
    const gitTag = `${name}@${newVersion}`

    const changelog = createChangelog(pkg).trim()
    log.debug(`Changelog generated for \`${bold(pkg.name)}\`:\n`, changelog)

    if (!dryRun) {
      log.info(`Creating git tag.`)
      execSync(`git tag ${gitTag}`)
      execSync("git push --tags")
      log.info(`Creating GitHub release notes.`)
      execSync(`gh release create ${gitTag} --notes '${changelog}'`)
    }
  }
  if (dryRun) {
    log.debug("Pushing commits (dry run)")
    execSync(`git push --dry-run`)
  } else {
    log.info("Pushing commits")
    execSync(`git push`)
  }

  exit()
}

function createChangelog(pkg: PackageToRelease) {
  const {
    commits: { features, breaking, bugfixes, other },
  } = pkg
  log.debug(`Generating changelog for package \`${bold(pkg.name)}\`.`)

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
  let h = c.parsed.subject ?? c.parsed.header
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
