import type { Commit, GrouppedCommits, PackageToRelease } from "./types.js"
import type { Config } from "./config.js"
import { bold } from "yoctocolors"
import { log, execSync, pluralize, streamToArray } from "./utils.js"
import semver from "semver"
import * as commitlint from "@commitlint/parse"
// @ts-expect-error no types
import gitLog from "git-log-parser"
import { type Package, getPackages } from "@manypkg/get-packages"
import { getDependentsGraph } from "@changesets/get-dependents-graph"
import { exit } from "./index.js"

export async function analyze(config: Config): Promise<PackageToRelease[]> {
  const { BREAKING_COMMIT_MSG, RELEASE_COMMIT_MSG, RELEASE_COMMIT_TYPES } =
    config

  const packages = await getPackages(process.cwd())
  const packageList = packages.packages.filter((p) => !p.packageJson.private)
  const dependentsGraph = await getDependentsGraph({
    ...packages,
    packages: packageList,
    // @ts-expect-error See: https://github.com/Thinkmill/manypkg/blob/main/packages/get-packages/CHANGELOG.md#200
    root: packages.rootPackage,
  })

  log.debug("Identifying latest tag.")
  const latestTag = execSync("git describe --tags --abbrev=0", {
    stdio: "pipe",
  })
    .toString()
    .trim()

  log.info(`Latest tag identified: \`${bold(latestTag)}\``)

  log.debug("Identifying commits since the latest tag.")

  // TODO: Allow passing in a range of commits to analyze and print the changelog
  const range = `${latestTag}..HEAD`

  const stream = gitLog.parse({ _: range })

  // Get the commits since the latest tag
  const commitsSinceLatestTag = await streamToArray(stream).then((arr) =>
    Promise.all(
      arr.map(async (d) => {
        d.parsed = await commitlint.default.default(d.subject)
        return d
      }),
    ),
  )

  log.info(
    commitsSinceLatestTag.length,
    pluralize("commit", commitsSinceLatestTag),
    `found since \`${bold(latestTag)}\``,
  )
  log.debug(
    "Analyzing the following commits:",
    ...commitsSinceLatestTag.map((c) => `  ${c.subject}`),
  )

  const lastCommit = commitsSinceLatestTag[0]

  if (lastCommit?.parsed.raw === RELEASE_COMMIT_MSG) {
    log.debug("Already released.")
    exit()
  }

  log.debug("Identifying commits that modified package code.")
  function getChangedFiles(commitSha: string) {
    return execSync(
      `git diff-tree --no-commit-id --name-only -r ${commitSha}`,
      { stdio: "pipe" },
    )
      .toString()
      .trim()
      .split("\n")
  }
  const packageCommits = commitsSinceLatestTag.filter(({ commit }) => {
    const changedFiles = getChangedFiles(commit.short)
    return packageList.some(({ relativeDir }) =>
      changedFiles.some((changedFile) => changedFile.startsWith(relativeDir)),
    )
  })

  log.info(
    packageCommits.length,
    pluralize("commit", packageCommits),
    `modified package code`,
  )

  log.debug("Identifying packages that need a new release.")

  const packagesNeedRelease: Set<string> = new Set()
  const grouppedPackages = packageCommits.reduce<
    Record<string, GrouppedCommits & { version: semver.SemVer | null }>
  >((acc, commit) => {
    const changedFilesInCommit = getChangedFiles(commit.commit.short)

    for (const { relativeDir, packageJson } of packageList) {
      const { name: pkg } = packageJson
      if (
        changedFilesInCommit.some((changedFile) =>
          changedFile.startsWith(relativeDir),
        )
      ) {
        const dependents = dependentsGraph.get(pkg) ?? []
        // Add dependents to the list of packages that need a release
        if (dependents.length) {
          log.debug(
            `\`${bold(pkg)}\` will also bump: ${dependents
              .map((d) => bold(d))
              .join(", ")}`,
          )
        }

        if (!(pkg in acc))
          acc[pkg] = {
            version: semver.parse(packageJson.version),
            features: [],
            bugfixes: [],
            other: [],
            breaking: [],
            dependents,
          }

        const { type } = commit.parsed
        if (RELEASE_COMMIT_TYPES.includes(type)) {
          packagesNeedRelease.add(pkg)
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
  }, {})

  if (packagesNeedRelease.size) {
    const allPackagesToRelease = Object.entries(grouppedPackages).reduce(
      (acc, [pkg, { dependents }]) => {
        acc.add(bold(pkg))
        for (const dependent of dependents) acc.add(bold(dependent))
        return acc
      },
      new Set<string>(),
    )
    log.info(
      allPackagesToRelease.size,
      pluralize("package", allPackagesToRelease),
      `need${allPackagesToRelease.size > 1 ? "" : "s"} to be released:`,
      Array.from(allPackagesToRelease).join(", "),
    )
  } else {
    log.info("No need to release, exiting.")
    exit()
  }

  const packagesToRelease: Map<string, PackageToRelease> = new Map()
  for (const pkgName of packagesNeedRelease) {
    const pkg = grouppedPackages[pkgName]
    const releaseType: semver.ReleaseType = pkg.breaking.length
      ? // For 0.x.x we don't need to bump the major even if there are breaking changes
        // https://semver.org/#spec-item-4
        pkg.version?.major === 0
        ? "minor" // x.1.x
        : "major" // 1.x.x
      : pkg.features.length
      ? "minor" // x.1.x
      : "patch" // x.x.1

    addToPackagesToRelease(
      packageList,
      pkgName,
      releaseType,
      packagesToRelease,
      pkg,
    )

    const { dependents } = grouppedPackages[pkgName]

    // Dependent versioning follows the same release type as the dependency,
    // except for dependents, we should always bump the major version
    // if there are breaking changes in the dependency, regardless if the
    // dependency's current version is 0.x.x or 1.x.x
    const dependentReleaseType: semver.ReleaseType = pkg.breaking.length
      ? "major" // 1.x.x
      : pkg.features.length
      ? "minor" // x.1.x
      : "patch" // x.x.1

    for (const dependent of dependents)
      addToPackagesToRelease(
        packageList,
        dependent,
        dependentReleaseType,
        packagesToRelease,
        {
          features: [],
          bugfixes: [],
          breaking: [],
          // List dependency commits under the dependent's "other" category
          other: getDependencyMessage(
            [...pkg.features, ...pkg.bugfixes],
            pkgName,
          ),
          dependents: [],
        },
      )
  }

  const { ignored, toRelease } = Array.from(packagesToRelease.values()).reduce(
    (acc, p) => {
      if (config.ignorePackages.includes(p.name)) acc.ignored.push(p)
      else acc.toRelease.push(p)
      return acc
    },
    { ignored: [] as PackageToRelease[], toRelease: [] as PackageToRelease[] },
  )

  if (config.peek) {
    log.peekInfo(
      `Following packages are ignored from releasing:\n`,
      ...ignored.map((p) => `  - ${bold(p.name)}`),
    )
    log.peekInfo(
      "\nFollowing packages can be released:\n",
      ...toRelease.map(
        (p) => `  - ${bold(p.name)}: ${p.oldVersion} -> ${p.newVersion}`,
      ),
    )
    exit()
  }

  return toRelease
}

function addToPackagesToRelease(
  packageList: Package[],
  pkgName: string,
  releaseType: semver.ReleaseType,
  packagesToRelease: Map<string, PackageToRelease>,
  commits: GrouppedCommits,
) {
  const { packageJson, relativeDir } = packageList.find(
    (pkg) => pkg.packageJson.name === pkgName,
  )!
  const oldVersion = packageJson.version!
  const newSemVer = semver.parse(semver.inc(oldVersion, releaseType))!

  const pkgToRelease: PackageToRelease = {
    name: pkgName,
    oldVersion,
    relativeDir,
    commits,
    newVersion: `${newSemVer.major}.${newSemVer.minor}.${newSemVer.patch}`,
  }

  // Handle dependents
  const pkg = packagesToRelease.get(pkgName)
  if (pkg) {
    // If the package is already in the list of packages to release we need to
    // bump the version to set the highest semver of the existing and the new one.
    if (semver.gt(pkg.newVersion, newSemVer)) {
      pkgToRelease.newVersion = pkg.newVersion
    }

    pkgToRelease.commits.features.push(...pkg.commits.features)
    pkgToRelease.commits.bugfixes.push(...pkg.commits.bugfixes)
  }

  packagesToRelease.set(pkgName, pkgToRelease)
}

function getDependencyMessage(commits: Commit[], scope: string): Commit[] {
  const sorted = commits.sort((a, b) => {
    const aDate = new Date(a.committer.date)
    const bDate = new Date(b.committer.date)
    return aDate.getTime() - bDate.getTime()
  })

  // const first = sorted[0].commit.short
  const last = sorted[sorted.length - 1].commit.short
  const body = ""
  // const body = ` ([compare changes](https://github.com/user/repository/compare/${first}..${last}))`
  // TODO: Instead of last commit, try to get a link to the dependency's release notes
  const short = last
  const subject = `dependency update`
  const type = "chore"
  const raw = `${type}(${scope}): ${subject}`
  return [
    {
      body,
      commit: { short },
      parsed: { type, subject, scope, header: raw, raw },
    } as any,
  ]
}
