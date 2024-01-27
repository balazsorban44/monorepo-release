import { type Config, defaultConfig } from "./config.js"
import { shouldSkip } from "./skip.js"
import { analyze } from "./analyze.js"
import { publish } from "./publish.js"
import { log } from "./utils.js"
import { bold } from "yoctocolors"

// TODO: Allow user config
const userConfig: Partial<Config> = {}
const config = { ...defaultConfig, ...userConfig } satisfies Config

const endMsg = bold("Done")

console.time(endMsg)
export function exit() {
  console.log()
  console.timeEnd(endMsg)
  process.exit(0)
}

if (config.dryRun) {
  log.peekInfo(bold("Performing dry run, no packages will be released!\n"))
} else {
  log.info(bold("Let's release some packages!\n"))
}

log.debug("Configuration:", JSON.stringify(config, null, 2))

if (shouldSkip({ releaseBranches: config.releaseBranches })) exit()

if (config.dryRun) {
  log.debug("Dry run, skipping token validation...")
} else if (config.noVerify) {
  log.info("--no-verify or NO_VERIFY set, skipping token validation...")
} else {
  if (!process.env.NPM_TOKEN) throw new Error("NPM_TOKEN is not set")
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set")
}

const packages = await analyze(config)

log.debug(
  "Packages to release:",
  packages
    .map((p) => {
      const { features, bugfixes, other, breaking } = p.commits
      const commits = `${features.length} feature(s), ${bugfixes.length} bugfixe(s), ${other.length} other(s) and ${breaking.length} breaking change(s)`
      return JSON.stringify({ ...p, commits }, null, 2)
    })
    .join("\n"),
)

await publish(packages, config)
